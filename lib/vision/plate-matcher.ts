import type { GridScorer } from './grid-calibrate'
import type {
  CellPrediction,
  ItemKind,
  RGBAImage,
  RecognizeOptions,
  Recognizer,
  TemplateSource,
} from './types'
import {
  boxBlur3,
  combineFamilyCues,
  combineFineCues,
  emptyRejected,
  fgShape,
  FINE_FAMILY_DELTA,
  FINE_OUTSIDER_DELTA,
  FINE_SWAP_DELTA,
  HUE_HIST_LEN,
  histIntersection,
  isFamilyGroup,
  isTabletLikeShape,
  majorityType,
  nccMasked,
  orderAfterRerank,
  confusableSet,
  pickInjectGroup,
  pickRerankGroup,
  shouldInjectSmallSlabs,
  shouldReject,
  shouldSwap,
  SMALL_SLAB_SET,
  sobelMag,
  spatialHueHist,
  type Hit,
  type ItemTypeVote,
} from './confusable-rerank'

/**
 * Analysis-by-synthesis matcher. Port of `tests/vision/REFERENCE.py`.
 *
 * Every constant below is frozen: they were swept against the fixtures and the
 * reference numbers only reproduce with these exact values.
 */
export const CELL = 64
export const TOPCUT = Math.floor(CELL * 0.19) // 12
export const TRIM = 0.07
const FGT = 45
const SWIN = 6
const TOPK = 28
const RI = 3
const QP = 65
const OFFS = [-2, 0, 2]
const RING_KEEP_RATIO = 0.04
const MIN_BLOB_RATIO = 0.045
const MIN_SHIFTED_FG = 20
const MIN_TEMPLATE_ALPHA_PIXELS = 12
const ALPHA_CUT = 128 // sprite alpha > 128 for the bbox, > 127.5 for the IoU mask

// Local second occupancy pass (does not change global FGT). Measured 2026-08-15:
// the 5 FG-null occupied cells already have FGT=45 pixels but fail MIN_BLOB
// (blobs 38..104 < 150). They are interior-darker than their ring
// (ivr -5.8..-26.3, lumStd 16..45); true-empty FG-null cells are not
// (ivr >= -0.28, and the one slightly-negative empty has lumStd 0).
const LOCAL_IVR_CUT = -4
const LOCAL_LUM_STD = 12
const LOCAL_MIN_BLOB = 35

// Reduced settings for the grid-calibration scorer only. The scorer runs once
// per sweep candidate, so it trades candidate breadth for speed. It never
// produces predictions, so this cannot affect recognition accuracy.
const SCORER_TOPK = 8
const SCORER_OFFS = [0]

const CELL_PX = CELL * CELL
const VALID_FROM = TOPCUT * CELL // flat index of the first valid row
const N_VALID = CELL_PX - VALID_FROM

export const SCALES: number[] = (() => {
  const out: number[] = []
  for (let s = 26; s <= 60; s += 2) out.push(s)
  return out
})()

/** Border ring sample positions, in the exact concatenation order of the reference. */
export const CELL_RING_INDICES = (() => {
  const a = RI
  const b = RI + 6
  const idx: number[] = []
  for (let y = a; y < b; y++) for (let x = 0; x < CELL; x++) idx.push(y * CELL + x)
  for (let y = CELL - b; y < CELL - a; y++) for (let x = 0; x < CELL; x++) idx.push(y * CELL + x)
  for (let y = 0; y < CELL; y++) for (let x = a; x < b; x++) idx.push(y * CELL + x)
  for (let y = 0; y < CELL; y++) for (let x = CELL - b; x < CELL - a; x++) idx.push(y * CELL + x)
  return Int32Array.from(idx)
})()
const RING_N = CELL_RING_INDICES.length

/** Python's `round()`: half-to-even. Cell centroids land on exact .5 often enough to matter. */
function pyRound(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d > 0.5) return f + 1
  if (d < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

/** numpy `percentile(..., interpolation='linear')` on an ascending array. */
function percentile(sorted: number[], q: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  if (n === 1) return sorted[0]
  const idx = (q / 100) * (n - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function medianOf(values: Float64Array, n: number): number {
  const view = values.subarray(0, n)
  view.sort()
  const h = n >> 1
  return n % 2 === 1 ? view[h] : (view[h - 1] + view[h]) / 2
}

/**
 * Source-pixel table for PIL's NEAREST resize (`ImagingScaleAffine`). PIL walks
 * the source coordinate incrementally from `scale/2`, so the closed form
 * `trunc(scale * (i + 0.5))` disagrees with it wherever the accumulated double
 * lands on the other side of an integer. That off-by-one is visible in the
 * final scores, so the accumulation has to be reproduced literally.
 */
function nearestIndexTable(srcSpan: number, dstSpan: number): Int32Array {
  const table = new Int32Array(dstSpan)
  const scale = srcSpan / dstSpan
  let o = scale * 0.5
  for (let i = 0; i < dstSpan; i++) {
    table[i] = Math.trunc(o)
    o += scale
  }
  return table
}

/**
 * PIL `crop(box).resize((CELL, CELL), NEAREST)`.
 * Nearest neighbour is mandatory here — bilinear smears pixel-art palettes.
 */
export function cropCellNearest(
  img: RGBAImage,
  left: number,
  top: number,
  right: number,
  bottom: number
): Float32Array {
  const out = new Float32Array(CELL_PX * 3)
  const xs = nearestIndexTable(right - left, CELL)
  const ys = nearestIndexTable(bottom - top, CELL)
  const maxX = img.width - 1
  const maxY = img.height - 1
  const d = img.data

  for (let y = 0; y < CELL; y++) {
    let syi = top + ys[y]
    if (syi < 0) syi = 0
    else if (syi > maxY) syi = maxY
    const rowBase = syi * img.width
    for (let x = 0; x < CELL; x++) {
      let sxi = left + xs[x]
      if (sxi < 0) sxi = 0
      else if (sxi > maxX) sxi = maxX
      const s = (rowBase + sxi) * 4
      const o = (y * CELL + x) * 3
      out[o] = d[s]
      out[o + 1] = d[s + 1]
      out[o + 2] = d[s + 2]
    }
  }
  return out
}

/** Rectangular max filter, out-of-bounds ignored (cv2 morphology border default). */
function dilateRect(src: Uint8Array, k: number): Uint8Array {
  const r = (k - 1) >> 1
  const tmp = new Uint8Array(CELL_PX)
  for (let y = 0; y < CELL; y++) {
    const base = y * CELL
    for (let x = 0; x < CELL; x++) {
      let v = 0
      const x0 = x - r < 0 ? 0 : x - r
      const x1 = x + r > CELL - 1 ? CELL - 1 : x + r
      for (let xx = x0; xx <= x1; xx++) {
        if (src[base + xx]) {
          v = 1
          break
        }
      }
      tmp[base + x] = v
    }
  }
  const out = new Uint8Array(CELL_PX)
  for (let y = 0; y < CELL; y++) {
    const y0 = y - r < 0 ? 0 : y - r
    const y1 = y + r > CELL - 1 ? CELL - 1 : y + r
    for (let x = 0; x < CELL; x++) {
      let v = 0
      for (let yy = y0; yy <= y1; yy++) {
        if (tmp[yy * CELL + x]) {
          v = 1
          break
        }
      }
      out[y * CELL + x] = v
    }
  }
  return out
}

/** Rectangular min filter, out-of-bounds ignored. */
function erodeRect(src: Uint8Array, k: number): Uint8Array {
  const r = (k - 1) >> 1
  const tmp = new Uint8Array(CELL_PX)
  for (let y = 0; y < CELL; y++) {
    const base = y * CELL
    for (let x = 0; x < CELL; x++) {
      let v = 1
      const x0 = x - r < 0 ? 0 : x - r
      const x1 = x + r > CELL - 1 ? CELL - 1 : x + r
      for (let xx = x0; xx <= x1; xx++) {
        if (!src[base + xx]) {
          v = 0
          break
        }
      }
      tmp[base + x] = v
    }
  }
  const out = new Uint8Array(CELL_PX)
  for (let y = 0; y < CELL; y++) {
    const y0 = y - r < 0 ? 0 : y - r
    const y1 = y + r > CELL - 1 ? CELL - 1 : y + r
    for (let x = 0; x < CELL; x++) {
      let v = 1
      for (let yy = y0; yy <= y1; yy++) {
        if (!tmp[yy * CELL + x]) {
          v = 0
          break
        }
      }
      out[y * CELL + x] = v
    }
  }
  return out
}

interface Components {
  labels: Int32Array
  areas: number[] // index 0 is background
}

/** 8-connected labelling by iterative flood fill. */
function connectedComponents(mask: Uint8Array): Components {
  const labels = new Int32Array(CELL_PX)
  const areas: number[] = [0]
  const stack = new Int32Array(CELL_PX)
  let next = 1

  for (let seed = 0; seed < CELL_PX; seed++) {
    if (!mask[seed] || labels[seed] !== 0) continue
    const label = next++
    let sp = 0
    stack[sp++] = seed
    labels[seed] = label
    let area = 0
    while (sp > 0) {
      const p = stack[--sp]
      area++
      const py = (p / CELL) | 0
      const px = p - py * CELL
      const y0 = py > 0 ? py - 1 : 0
      const y1 = py < CELL - 1 ? py + 1 : CELL - 1
      const x0 = px > 0 ? px - 1 : 0
      const x1 = px < CELL - 1 ? px + 1 : CELL - 1
      for (let yy = y0; yy <= y1; yy++) {
        const rb = yy * CELL
        for (let xx = x0; xx <= x1; xx++) {
          const q = rb + xx
          if (mask[q] && labels[q] === 0) {
            labels[q] = label
            stack[sp++] = q
          }
        }
      }
    }
    areas.push(area)
  }
  return { labels, areas }
}

export interface CellInfo {
  /** Final foreground mask (0/1), already restricted to the valid region. */
  fg: Uint8Array
  cy: number
  cx: number
  /** max(bbox width, bbox height) of the mask. */
  size: number
}

const ringScratch = new Int32Array(1 << 16)
const ringSeen = new Int32Array(RING_N)

const fineCellGray = new Float32Array(CELL_PX)
const fineCellHp = new Float32Array(CELL_PX)
const fineCellMag = new Float32Array(CELL_PX)
const fineCellR = new Float32Array(CELL_PX)
const fineCellG = new Float32Array(CELL_PX)
const fineCellB = new Float32Array(CELL_PX)
const fineSprGray = new Float32Array(CELL_PX)
const fineSprHp = new Float32Array(CELL_PX)
const fineSprMag = new Float32Array(CELL_PX)
const fineSprR = new Float32Array(CELL_PX)
const fineSprG = new Float32Array(CELL_PX)
const fineSprB = new Float32Array(CELL_PX)
const fineBlurTmp = new Float32Array(CELL_PX)
const fineIdx = new Int32Array(CELL_PX)
const fineCellFg = new Uint8Array(CELL_PX)
const fineCellHue = new Float32Array(HUE_HIST_LEN)
const fineSprHue = new Float32Array(HUE_HIST_LEN)

/**
 * Background colours sampled from the border ring, quantised to a 16-level cube.
 * A single median colour is not enough: tablet cells carry a diamond pattern
 * that then survives into the foreground (PLAN §10-2).
 */
function ringBackground(cell: Float32Array): Float32Array {
  let seenN = 0
  for (let i = 0; i < RING_N; i++) {
    const p = CELL_RING_INDICES[i] * 3
    const code =
      Math.floor(cell[p] / 16) * 4096 + Math.floor(cell[p + 1] / 16) * 64 + Math.floor(cell[p + 2] / 16)
    if (ringScratch[code] === 0) ringSeen[seenN++] = code
    ringScratch[code]++
  }
  const threshold = RING_N * RING_KEEP_RATIO
  const kept: number[] = []
  for (let i = 0; i < seenN; i++) {
    const code = ringSeen[i]
    if (ringScratch[code] > threshold) kept.push(code)
    ringScratch[code] = 0
  }
  kept.sort((a, b) => a - b)

  if (kept.length === 0) return Float32Array.from([60, 40, 60])
  const bg = new Float32Array(kept.length * 3)
  for (let i = 0; i < kept.length; i++) {
    const code = kept[i]
    bg[i * 3] = Math.floor(code / 4096) * 16 + 8
    bg[i * 3 + 1] = (Math.floor(code / 64) % 64) * 16 + 8
    bg[i * 3 + 2] = (code % 64) * 16 + 8
  }
  return bg
}

function ringMedianColor(cell: Float32Array): [number, number, number] {
  const buf = new Float64Array(RING_N)
  const out: number[] = []
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < RING_N; i++) buf[i] = cell[CELL_RING_INDICES[i] * 3 + c]
    out.push(medianOf(buf, RING_N))
  }
  return [out[0], out[1], out[2]]
}

function ringMeanAbsDiff(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < RING_N; i++) {
    const p = CELL_RING_INDICES[i] * 3
    sum += Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2])
  }
  return sum / (RING_N * 3)
}

/**
 * Occupancy + foreground extraction for one 64x64 cell.
 * Returns null for an empty cell.
 */
export function analyzeCell(cell: Float32Array): CellInfo | null {
  const bg = ringBackground(cell)
  const nbg = bg.length / 3

  const fg = new Uint8Array(CELL_PX)
  for (let p = VALID_FROM; p < CELL_PX; p++) {
    const p3 = p * 3
    const r = cell[p3]
    const g = cell[p3 + 1]
    const b = cell[p3 + 2]
    let best = Infinity
    for (let k = 0; k < nbg; k++) {
      const k3 = k * 3
      const d = Math.abs(r - bg[k3]) + Math.abs(g - bg[k3 + 1]) + Math.abs(b - bg[k3 + 2])
      if (d < best) best = d
    }
    if (best > FGT) fg[p] = 1
  }

  const closed = erodeRect(dilateRect(fg, 3), 3)
  const { labels, areas } = connectedComponents(closed)
  if (areas.length <= 1) return null

  let bi = 1
  for (let i = 2; i < areas.length; i++) if (areas[i] > areas[bi]) bi = i
  if (areas[bi] < N_VALID * MIN_BLOB_RATIO) return null

  const blob = new Uint8Array(CELL_PX)
  for (let p = 0; p < CELL_PX; p++) if (labels[p] === bi) blob[p] = 1
  const grown = dilateRect(blob, 9)

  // Pixel-art icons fragment into disconnected pieces; re-attach whatever sits
  // inside the dilated hull of the dominant blob.
  const keep = new Uint8Array(CELL_PX)
  let sy = 0
  let sx = 0
  let n = 0
  let minX = CELL
  let maxX = -1
  let minY = CELL
  let maxY = -1
  for (let p = 0; p < CELL_PX; p++) {
    if (!(blob[p] || (fg[p] && grown[p]))) continue
    keep[p] = 1
    const y = (p / CELL) | 0
    const x = p - y * CELL
    sy += y
    sx += x
    n++
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (n === 0) return null

  return {
    fg: keep,
    cy: sy / n,
    cx: sx / n,
    size: Math.max(maxX - minX + 1, maxY - minY + 1),
  }
}

function isLocalInterior(p: number): boolean {
  const y = (p / CELL) | 0
  const x = p - y * CELL
  return x >= 9 && x < CELL - 9 && y >= TOPCUT + 6 && y < CELL - 9
}

function maskToCellInfo(fg: Uint8Array, minBlob: number): CellInfo | null {
  const closed = erodeRect(dilateRect(fg, 3), 3)
  const { labels, areas } = connectedComponents(closed)
  if (areas.length <= 1) return null

  let bi = 1
  for (let i = 2; i < areas.length; i++) if (areas[i] > areas[bi]) bi = i
  if (areas[bi] < minBlob) return null

  const blob = new Uint8Array(CELL_PX)
  for (let p = 0; p < CELL_PX; p++) if (labels[p] === bi) blob[p] = 1
  const grown = dilateRect(blob, 9)

  const keep = new Uint8Array(CELL_PX)
  let sy = 0
  let sx = 0
  let n = 0
  let minX = CELL
  let maxX = -1
  let minY = CELL
  let maxY = -1
  for (let p = 0; p < CELL_PX; p++) {
    if (!(blob[p] || (fg[p] && grown[p]))) continue
    keep[p] = 1
    const y = (p / CELL) | 0
    const x = p - y * CELL
    sy += y
    sx += x
    n++
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (n === 0) return null
  return {
    fg: keep,
    cy: sy / n,
    cx: sx / n,
    size: Math.max(maxX - minX + 1, maxY - minY + 1),
  }
}

/**
 * Second occupancy pass for cells the frozen FGT=45 path calls empty.
 * Gate: interior darker than the ring AND high interior variance.
 * Mask: the same FGT=45 residual, accepted at a lower local blob floor.
 * Measured: 5/5 occupancy-miss cells pass the gate+blob; 0 true empties do.
 * kunai matches; amulet/swaying_eyes/colorless_cube occupy but ID wrong;
 * black_planet still hard-rejects (leftover).
 */
export function analyzeCellLocal(cell: Float32Array): CellInfo | null {
  let iSum = 0
  let iN = 0
  let iSq = 0
  let rSum = 0
  for (let p = VALID_FROM; p < CELL_PX; p++) {
    if (!isLocalInterior(p)) continue
    const p3 = p * 3
    const v = 0.299 * cell[p3] + 0.587 * cell[p3 + 1] + 0.114 * cell[p3 + 2]
    iSum += v
    iSq += v * v
    iN++
  }
  if (iN < 32) return null
  for (let i = 0; i < RING_N; i++) {
    const p3 = CELL_RING_INDICES[i] * 3
    rSum += 0.299 * cell[p3] + 0.587 * cell[p3 + 1] + 0.114 * cell[p3 + 2]
  }
  const iMean = iSum / iN
  const rMean = rSum / RING_N
  const iVar = iSq / iN - iMean * iMean
  const iStd = iVar > 0 ? Math.sqrt(iVar) : 0
  if (iMean - rMean >= LOCAL_IVR_CUT) return null
  if (iStd < LOCAL_LUM_STD) return null

  const bg = ringBackground(cell)
  const nbg = bg.length / 3
  const fg = new Uint8Array(CELL_PX)
  for (let p = VALID_FROM; p < CELL_PX; p++) {
    const p3 = p * 3
    const r = cell[p3]
    const g = cell[p3 + 1]
    const b = cell[p3 + 2]
    let best = Infinity
    for (let k = 0; k < nbg; k++) {
      const k3 = k * 3
      const d = Math.abs(r - bg[k3]) + Math.abs(g - bg[k3 + 1]) + Math.abs(b - bg[k3 + 2])
      if (d < best) best = d
    }
    if (best > FGT) fg[p] = 1
  }
  return maskToCellInfo(fg, LOCAL_MIN_BLOB)
}

function shiftToFloat(src: Uint8Array, dy: number, dx: number): Float32Array {
  const out = new Float32Array(CELL_PX)
  const ySrc0 = dy >= 0 ? 0 : -dy
  const ySrc1 = dy >= 0 ? CELL - dy : CELL
  const xSrc0 = dx >= 0 ? 0 : -dx
  const xSrc1 = dx >= 0 ? CELL - dx : CELL
  for (let y = ySrc0; y < ySrc1; y++) {
    const dstRow = (y + dy) * CELL
    const srcRow = y * CELL
    for (let x = xSrc0; x < xSrc1; x++) out[dstRow + x + dx] = src[srcRow + x]
  }
  return out
}

function shiftValidToFloat(dy: number, dx: number): Float32Array {
  const out = new Float32Array(CELL_PX)
  const ySrc0 = dy >= 0 ? 0 : -dy
  const ySrc1 = dy >= 0 ? CELL - dy : CELL
  const xSrc0 = dx >= 0 ? 0 : -dx
  const xSrc1 = dx >= 0 ? CELL - dx : CELL
  for (let y = ySrc0; y < ySrc1; y++) {
    if (y < TOPCUT) continue
    const dstRow = (y + dy) * CELL
    for (let x = xSrc0; x < xSrc1; x++) out[dstRow + x + dx] = 1
  }
  return out
}

interface Square {
  size: number
  data: Uint8Array // RGBA
}

interface Variant {
  value: string
  type: ItemKind
  rotation: 0 | 1 | 2 | 3
  square: Square
}

/**
 * A sprite rendered at one scale, reduced to its non-transparent pixels.
 * Fully transparent pixels composite to exactly the plate, so their error is
 * already inside the empty-cell baseline and never needs recomputing.
 */
interface Sprite {
  off: Int32Array // dy*CELL + dx, relative to the sprite's top-left
  ia: Float32Array // 1 - alpha
  pm: Float32Array // rgb * alpha, 3 per pixel
  maskRel: Int32Array // subset of off with alpha > 0.5, for the IoU prefilter
}

/** Tight alpha bbox crop, then centred square padding. */
function toSquare(img: RGBAImage): Square | null {
  let minX = img.width
  let maxX = -1
  let minY = img.height
  let maxY = -1
  let count = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > ALPHA_CUT) {
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (count < MIN_TEMPLATE_ALPHA_PIXELS) return null

  const h = maxY - minY + 1
  const w = maxX - minX + 1
  const s = Math.max(h, w)
  const data = new Uint8Array(s * s * 4)
  const oy = (s - h) >> 1
  const ox = (s - w) >> 1
  for (let y = 0; y < h; y++) {
    const src = ((minY + y) * img.width + minX) * 4
    data.set(img.data.subarray(src, src + w * 4), ((oy + y) * s + ox) * 4)
  }
  return { size: s, data }
}

/** `np.rot90(a, -k)` — clockwise. */
function rotateSquare(sq: Square, k: number): Square {
  if (k === 0) return sq
  let cur = sq
  for (let step = 0; step < k; step++) {
    const s = cur.size
    const out = new Uint8Array(s * s * 4)
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const src = ((s - 1 - x) * s + y) * 4
        const dst = (y * s + x) * 4
        out[dst] = cur.data[src]
        out[dst + 1] = cur.data[src + 1]
        out[dst + 2] = cur.data[src + 2]
        out[dst + 3] = cur.data[src + 3]
      }
    }
    cur = { size: s, data: out }
  }
  return cur
}

function buildSprite(sq: Square, s: number): Sprite {
  const S = sq.size
  const table = nearestIndexTable(S, s)
  const off: number[] = []
  const ia: number[] = []
  const pm: number[] = []
  const maskRel: number[] = []

  for (let y = 0; y < s; y++) {
    let syi = table[y]
    if (syi > S - 1) syi = S - 1
    for (let x = 0; x < s; x++) {
      let sxi = table[x]
      if (sxi > S - 1) sxi = S - 1
      const src = (syi * S + sxi) * 4
      const a = sq.data[src + 3]
      if (a === 0) continue
      const alpha = a / 255
      const rel = y * CELL + x
      off.push(rel)
      ia.push(1 - alpha)
      pm.push(sq.data[src] * alpha, sq.data[src + 1] * alpha, sq.data[src + 2] * alpha)
      if (alpha > 0.5) maskRel.push(rel)
    }
  }

  return {
    off: Int32Array.from(off),
    ia: Float32Array.from(ia),
    pm: Float32Array.from(pm),
    maskRel: Int32Array.from(maskRel),
  }
}

function emptyPrediction(slotIndex: number): CellPrediction {
  return { slotIndex, matchedValue: null, type: null, rotation: 0, confidence: 0 }
}

interface PreparedGrid {
  cells: Float32Array[]
  infos: (CellInfo | null)[]
  plateOccupied: Float32Array | null
  plateEmpty: Float32Array | null
  scales: number[]
}

export class PlateMatcherRecognizer implements Recognizer {
  readonly name = 'plate-matcher'

  private variants: Variant[] = []
  private spriteBank = new Map<number, Sprite[]>()

  loadTemplates(templates: TemplateSource[]): void {
    const variants: Variant[] = []
    for (const t of templates) {
      const square = toSquare(t.image)
      if (!square) continue
      const rotations: (0 | 1 | 2 | 3)[] =
        t.type === 'TABLET' && t.rotatable ? [0, 1, 2, 3] : [0]
      for (const r of rotations) {
        variants.push({ value: t.value, type: t.type, rotation: r, square: rotateSquare(square, r) })
      }
    }
    this.variants = variants
    this.spriteBank.clear()
  }

  private spritesAt(scale: number): Sprite[] {
    let bank = this.spriteBank.get(scale)
    if (!bank) {
      bank = this.variants.map((v) => buildSprite(v.square, scale))
      this.spriteBank.set(scale, bank)
    }
    return bank
  }

  /** Cell decomposition, plate learning and scale lock — shared by matching and grid scoring. */
  private prepare(img: RGBAImage, opts: RecognizeOptions): PreparedGrid {
    const { rows, cols, totalSlots, grid } = opts
    // The grid rect stays fractional all the way down to the per-cell trunc().
    // Rounding it first shifts cell spans by up to a pixel, and under nearest
    // neighbour that re-picks the source column for most output columns.
    const originX = grid ? grid.originX : 0
    const originY = grid ? grid.originY : 0
    const pitchX = (grid ? grid.gridWidth : img.width) / cols
    const pitchY = (grid ? grid.gridHeight : img.height) / rows
    const margin = pitchX * TRIM // the reference uses the x pitch on both axes

    const cells: Float32Array[] = []
    const infos: (CellInfo | null)[] = []
    const occupied: number[] = []
    const empty: number[] = []
    for (let i = 0; i < totalSlots; i++) {
      const r = Math.floor(i / cols)
      const c = i % cols
      const x = originX + c * pitchX
      const y = originY + r * pitchY
      const cell = cropCellNearest(
        img,
        Math.trunc(x + margin),
        Math.trunc(y + margin),
        Math.trunc(x + pitchX - margin),
        Math.trunc(y + pitchY - margin)
      )
      cells.push(cell)
      const primary = analyzeCell(cell)
      infos.push(primary ?? analyzeCellLocal(cell))
      // Plates and scale lock stay on the frozen FGT occupancy so a local
      // recovery cannot shift the global plate or the locked scale.
      if (primary) occupied.push(i)
      else empty.push(i)
    }

    const plateOccupied = occupied.length >= 4 ? medianPlate(cells, occupied) : null
    const plateEmpty = empty.length >= 3 ? medianPlate(cells, empty) : null

    const sizes = occupied.map((i) => infos[i]!.size).sort((a, b) => a - b)
    let lock = sizes.length > 0 ? Math.trunc(percentile(sizes, QP)) : 42
    lock = SCALES.reduce((best, s) => (Math.abs(s - lock) < Math.abs(best - lock) ? s : best), SCALES[0])
    const candidateScales = SCALES.filter((s) => Math.abs(s - lock) <= SWIN)
    const scales = candidateScales.length > 0 ? candidateScales : [lock]
    for (const s of scales) this.spritesAt(s)

    return { cells, infos, plateOccupied, plateEmpty, scales }
  }

  async recognize(img: RGBAImage, opts: RecognizeOptions): Promise<CellPrediction[]> {
    const { cells, infos, plateOccupied, plateEmpty, scales } = this.prepare(img, opts)

    const predictions: CellPrediction[] = []
    for (let i = 0; i < opts.totalSlots; i++) {
      const info = infos[i]
      if (!info) {
        predictions.push(emptyPrediction(i))
        continue
      }
      const hits = this.matchCell(cells[i], info, plateOccupied, plateEmpty, scales)
      if (!hits.length) {
        predictions.push(emptyPrediction(i))
        continue
      }
      predictions.push(this.postPass(cells[i], info, scales, hits, i))
    }
    return predictions
  }

  /**
   * Total analysis-by-synthesis score over the occupied cells, used ONLY as a
   * grid-calibration objective. Deliberately cheaper than `recognize`: fewer
   * prefilter candidates and no offset search. It must never feed predictions.
   */
  scoreGrid(img: RGBAImage, opts: RecognizeOptions): number {
    const { cells, infos, plateOccupied, plateEmpty, scales } = this.prepare(img, opts)

    let total = 0
    for (let i = 0; i < opts.totalSlots; i++) {
      const info = infos[i]
      if (!info) continue
      const hits = this.matchCell(
        cells[i],
        info,
        plateOccupied,
        plateEmpty,
        scales,
        SCORER_TOPK,
        SCORER_OFFS
      )
      if (hits.length) total += hits[0].score
    }
    return total
  }

  private plateFor(
    cell: Float32Array,
    plateOccupied: Float32Array | null,
    plateEmpty: Float32Array | null
  ): Float32Array {
    let plate = plateOccupied
    if (plateEmpty && plateOccupied) {
      if (ringMeanAbsDiff(cell, plateEmpty) < ringMeanAbsDiff(cell, plateOccupied)) plate = plateEmpty
    }
    if (plate) return plate
    const [r, g, b] = ringMedianColor(cell)
    const flat = new Float32Array(CELL_PX * 3)
    for (let p = 0; p < CELL_PX; p++) {
      flat[p * 3] = r
      flat[p * 3 + 1] = g
      flat[p * 3 + 2] = b
    }
    return flat
  }

  private matchCell(
    cell: Float32Array,
    info: CellInfo,
    plateOccupied: Float32Array | null,
    plateEmpty: Float32Array | null,
    scales: number[],
    topk: number = TOPK,
    offs: number[] = OFFS
  ): { variant: number; score: number }[] {
    const plate = this.plateFor(cell, plateOccupied, plateEmpty)
    let dy = pyRound(CELL / 2 - info.cy)
    let dx = pyRound(CELL / 2 - info.cx)
    let fgf = shiftToFloat(info.fg, dy, dx)
    let valf = shiftValidToFloat(dy, dx)

    let nfg = 0
    for (let p = 0; p < CELL_PX; p++) nfg += fgf[p]
    if (nfg < MIN_SHIFTED_FG) {
      const local = analyzeCellLocal(cell)
      if (!local) return []
      dy = pyRound(CELL / 2 - local.cy)
      dx = pyRound(CELL / 2 - local.cx)
      fgf = shiftToFloat(local.fg, dy, dx)
      valf = shiftValidToFloat(dy, dx)
      nfg = 0
      for (let p = 0; p < CELL_PX; p++) nfg += fgf[p]
      if (nfg < MIN_SHIFTED_FG) return []
    }

    // --- stage 1: multi-scale IoU prefilter (never single-scale, PLAN §10-2) ---
    const nv = this.variants.length
    const iou = new Float64Array(nv)
    const order = new Int32Array(nv)
    const candidates = new Set<number>()
    for (const s of scales) {
      const bank = this.spritesAt(s)
      const o65 = ((CELL - s) >> 1) * (CELL + 1)
      for (let j = 0; j < nv; j++) {
        const rel = bank[j].maskRel
        let inter = 0
        let area = 0
        for (let k = 0; k < rel.length; k++) {
          const p = o65 + rel[k]
          inter += fgf[p]
          area += valf[p]
        }
        const union = area + nfg - inter
        iou[j] = inter / Math.max(union, 1e-6)
        order[j] = j
      }
      const sorted = Array.from(order).sort((a, b) => iou[b] - iou[a])
      for (let k = 0; k < Math.min(topk, nv); k++) candidates.add(sorted[k])
    }
    if (candidates.size === 0) return []

    // --- stage 2: analysis-by-synthesis against the learned plate ---
    const D = new Float32Array(CELL_PX)
    let dsum = 0
    for (let p = VALID_FROM; p < CELL_PX; p++) {
      const p3 = p * 3
      const d =
        Math.abs(cell[p3] - plate[p3]) +
        Math.abs(cell[p3 + 1] - plate[p3 + 1]) +
        Math.abs(cell[p3 + 2] - plate[p3 + 2])
      D[p] = d
      dsum += d
    }
    const base = Math.max(dsum / N_VALID, 1e-6)

    const ccy = -dy
    const ccx = -dx
    const cset = Array.from(candidates).sort((a, b) => a - b)
    const bestByVariant = new Map<number, number>()
    let bestScore = -1e9
    let bestVariant = -1

    for (const s of scales) {
      const bank = this.spritesAt(s)
      const o = (CELL - s) >> 1
      for (const j of cset) {
        const sp = bank[j]
        const n = sp.off.length
        for (const oy of offs) {
          const y0 = o + ccy + oy
          if (y0 < 0 || y0 + s > CELL) continue
          for (const ox of offs) {
            const x0 = o + ccx + ox
            if (x0 < 0 || x0 + s > CELL) continue
            const anchor = y0 * CELL + x0

            let delta = 0
            for (let k = 0; k < n; k++) {
              const p = anchor + sp.off[k]
              if (p < VALID_FROM) continue // invalid region: composite error and D are both 0
              const a = sp.ia[k]
              const p3 = p * 3
              const k3 = k * 3
              const dr = cell[p3] - (plate[p3] * a + sp.pm[k3])
              const dg = cell[p3 + 1] - (plate[p3 + 1] * a + sp.pm[k3 + 1])
              const db = cell[p3 + 2] - (plate[p3 + 2] * a + sp.pm[k3 + 2])
              delta +=
                (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db) - D[p]
            }

            const score = 1 - (dsum + delta) / N_VALID / base
            const prev = bestByVariant.get(j)
            if (prev === undefined || score > prev) bestByVariant.set(j, score)
            if (score > bestScore) {
              bestScore = score
              bestVariant = j
            }
          }
        }
      }
    }

    if (bestVariant < 0) return []
    // Top-1 is unchanged. Return a wider list so postPass can inject type peers.
    return Array.from(bestByVariant.entries())
      .map(([variant, score]) => ({ variant, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 16)
  }

  /**
   * Second pass after the frozen primary matcher: lookalike rerank, then
   * low-confidence reject. Never used by scoreGrid.
   */
  private postPass(
    cell: Float32Array,
    info: CellInfo,
    scales: number[],
    hits: Hit[],
    slotIndex: number
  ): CellPrediction {
    const headHits = hits.slice(0, 5)
    const seenVal = new Set<string>()
    const voteTypes: ItemTypeVote[] = []
    for (const h of headHits) {
      const tv = this.variants[h.variant]
      if (seenVal.has(tv.value)) continue
      seenVal.add(tv.value)
      voteTypes.push(tv.type)
    }
    const vote = majorityType(voteTypes)

    // Never promote before the fine cue: that replaced correct weak artifacts
    // (six_leaf_clover, black_planet) with a tablet, then a small in-group
    // delta locked the wrong slab in.
    const top = hits[0]
    const topV = this.variants[top.variant]
    const peer = this.peerForInject(headHits, topV.type, vote)
    const group = pickInjectGroup(topV.value, topV.type, top.score, peer, vote)
    const ownGroup = pickRerankGroup(topV.value, null, 1)
    const useGroup = group ?? ownGroup

    // IoU peers only when the type vote actually disagrees. Doing this for
    // every weak artifact dragged six_leaf_clover into the slab family.
    const iouType: ItemTypeVote | null =
      vote && vote !== topV.type ? vote : null
    let extra = iouType ? this.topIouOfType(info, scales, iouType, 8) : []
    // Compactness / bbox-fill says "maybe tablet": inject the small slab set
    // into the second pass. Clover is fill=0.676 / compact=0.310 so it does
    // not fire (measured). These winners are already weak artifacts — use
    // FINE_SWAP_DELTA, not the outsider 0.08 (that left exit/flag stuck).
    const compactInject = shouldInjectSmallSlabs(
      topV.type,
      top.score,
      isTabletLikeShape(fgShape(info.fg))
    )
    if (compactInject) {
      extra = extra.concat(this.bestIouPerValue(info, scales, SMALL_SLAB_SET))
    }

    let ordered = hits.slice(0, 5)
    let skipReject = false
    if (useGroup || extra.length) {
      const outsider = !ownGroup && !compactInject
      const reranked = this.rerankGroup(
        cell,
        info,
        scales,
        hits,
        useGroup ?? new Set<string>(),
        extra,
        outsider
      )
      ordered = reranked.hits
      // A foreign-family swap on junk (balisong→honor) must still be rejectable.
      skipReject = reranked.swapped && !outsider
    }

    const best = ordered[0]
    const v = this.variants[best.variant]
    const candidates = ordered.map((h) => {
      const tv = this.variants[h.variant]
      return { value: tv.value, type: tv.type, rotation: tv.rotation, confidence: h.score }
    })
    if (shouldReject(best.score, ordered[1]?.score, skipReject, v.value)) {
      return emptyRejected(slotIndex, best.score, candidates)
    }
    return {
      slotIndex,
      matchedValue: v.value,
      type: v.type,
      rotation: v.rotation,
      confidence: best.score,
      candidates,
    }
  }

  /** Best opposite-type (or same-type lookalike) value already in the hit list. */
  private peerForInject(
    hits: Hit[],
    winnerType: ItemTypeVote,
    vote: ItemTypeVote | null
  ): string | null {
    if (vote && vote !== winnerType) {
      for (const h of hits) {
        const v = this.variants[h.variant]
        if (v.type === vote) return v.value
      }
    }
    // Weak artifact with a lookalike tablet already in the top-5 (exit @ 5th).
    if (winnerType === 'ARTIFACT') {
      for (const h of hits) {
        const v = this.variants[h.variant]
        if (v.type === 'TABLET' && confusableSet(v.value)) return v.value
      }
    }
    return null
  }

  /** Top-k IoU variants of one type. Cheap mask overlap; does not change primary scores. */
  private topIouOfType(
    info: CellInfo,
    scales: number[],
    type: ItemTypeVote | null,
    k: number
  ): number[] {
    if (!type) return []
    const dy = pyRound(CELL / 2 - info.cy)
    const dx = pyRound(CELL / 2 - info.cx)
    const fgf = shiftToFloat(info.fg, dy, dx)
    const valf = shiftValidToFloat(dy, dx)
    let nfg = 0
    for (let p = 0; p < CELL_PX; p++) nfg += fgf[p]
    if (nfg < 8) return []

    const best = new Map<number, number>()
    const nv = this.variants.length
    for (const s of scales) {
      const bank = this.spritesAt(s)
      const o65 = ((CELL - s) >> 1) * (CELL + 1)
      for (let j = 0; j < nv; j++) {
        if (this.variants[j].type !== type) continue
        const rel = bank[j].maskRel
        let inter = 0
        let area = 0
        for (let t = 0; t < rel.length; t++) {
          const p = o65 + rel[t]
          inter += fgf[p]
          area += valf[p]
        }
        const union = area + nfg - inter
        const iou = inter / Math.max(union, 1e-6)
        const prev = best.get(j)
        if (prev === undefined || iou > prev) best.set(j, iou)
      }
    }
    return Array.from(best.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([j]) => j)
  }

  /** Best-IoU rotation of each value. Guarantees every small slab is scored. */
  private bestIouPerValue(info: CellInfo, scales: number[], values: Set<string>): number[] {
    if (values.size === 0) return []
    const dy = pyRound(CELL / 2 - info.cy)
    const dx = pyRound(CELL / 2 - info.cx)
    const fgf = shiftToFloat(info.fg, dy, dx)
    const valf = shiftValidToFloat(dy, dx)
    let nfg = 0
    for (let p = 0; p < CELL_PX; p++) nfg += fgf[p]
    if (nfg < 8) return []

    const bestIou = new Map<string, { j: number; iou: number }>()
    const nv = this.variants.length
    for (const s of scales) {
      const bank = this.spritesAt(s)
      const o65 = ((CELL - s) >> 1) * (CELL + 1)
      for (let j = 0; j < nv; j++) {
        const val = this.variants[j].value
        if (!values.has(val)) continue
        const rel = bank[j].maskRel
        let inter = 0
        let area = 0
        for (let t = 0; t < rel.length; t++) {
          const p = o65 + rel[t]
          inter += fgf[p]
          area += valf[p]
        }
        const iou = inter / Math.max(area + nfg - inter, 1e-6)
        const prev = bestIou.get(val)
        if (!prev || iou > prev.iou) bestIou.set(val, { j, iou })
      }
    }
    return Array.from(bestIou.values()).map((x) => x.j)
  }

  private iouByVariant(info: CellInfo, scales: number[], idxs: number[]): Map<number, number> {
    const dy = pyRound(CELL / 2 - info.cy)
    const dx = pyRound(CELL / 2 - info.cx)
    const fgf = shiftToFloat(info.fg, dy, dx)
    const valf = shiftValidToFloat(dy, dx)
    let nfg = 0
    for (let p = 0; p < CELL_PX; p++) nfg += fgf[p]
    const out = new Map<number, number>()
    if (nfg < 8) {
      for (const j of idxs) out.set(j, 0)
      return out
    }
    for (const s of scales) {
      const bank = this.spritesAt(s)
      const o65 = ((CELL - s) >> 1) * (CELL + 1)
      for (const j of idxs) {
        const rel = bank[j].maskRel
        let inter = 0
        let area = 0
        for (let t = 0; t < rel.length; t++) {
          const p = o65 + rel[t]
          inter += fgf[p]
          area += valf[p]
        }
        const iou = inter / Math.max(area + nfg - inter, 1e-6)
        const prev = out.get(j)
        if (prev === undefined || iou > prev) out.set(j, iou)
      }
    }
    return out
  }

  private rerankGroup(
    cell: Float32Array,
    info: CellInfo,
    scales: number[],
    hits: Hit[],
    group: Set<string>,
    extraIdxs: number[] = [],
    outsider = false
  ): { hits: Hit[]; swapped: boolean } {
    this.prepareCellFine(cell, info)
    const dy = pyRound(CELL / 2 - info.cy)
    const dx = pyRound(CELL / 2 - info.cx)
    const family = isFamilyGroup(group)

    const groupIdxs: number[] = []
    for (let j = 0; j < this.variants.length; j++) {
      if (group.has(this.variants[j].value)) groupIdxs.push(j)
    }
    const groupSet = new Set(groupIdxs)
    for (const j of extraIdxs) groupSet.add(j)

    const fine = new Map<number, number>()
    const scoreOne = (j: number) => {
      if (!fine.has(j)) fine.set(j, this.fineScoreVariant(j, scales, dy, dx, family))
    }
    scoreOne(hits[0].variant)
    for (const j of groupIdxs) scoreOne(j)
    for (const j of extraIdxs) scoreOne(j)

    const winnerFine = fine.get(hits[0].variant) ?? -1
    const iou = outsider ? this.iouByVariant(info, scales, [...groupSet, hits[0].variant]) : null
    const rankOf = (j: number) => {
      const f = fine.get(j) ?? -1
      if (!iou) return f
      return 0.7 * f + 0.3 * (iou.get(j) ?? 0)
    }
    let bestJ = hits[0].variant
    let bestR = rankOf(bestJ)
    for (const j of groupSet) {
      const r = rankOf(j)
      if (r > bestR) {
        bestR = r
        bestJ = j
      }
    }

    const delta = outsider ? FINE_OUTSIDER_DELTA : family ? FINE_FAMILY_DELTA : FINE_SWAP_DELTA
    const swapped = bestJ !== hits[0].variant && shouldSwap(winnerFine, fine.get(bestJ) ?? -1, delta)
    const winnerVariant = swapped ? bestJ : hits[0].variant
    const ordered = orderAfterRerank(hits, winnerVariant, groupSet, (j) => rankOf(j))
    return { hits: ordered, swapped }
  }

  private prepareCellFine(cell: Float32Array, info?: CellInfo): void {
    for (let p = 0; p < CELL_PX; p++) {
      const p3 = p * 3
      const r = cell[p3]
      const g = cell[p3 + 1]
      const b = cell[p3 + 2]
      fineCellR[p] = r
      fineCellG[p] = g
      fineCellB[p] = b
      fineCellGray[p] = 0.299 * r + 0.587 * g + 0.114 * b
    }
    boxBlur3(fineCellGray, fineBlurTmp, fineSprGray, CELL, CELL)
    // fineSprGray is scratch for the blur tmp-tmp; write hp from gray - blur
    // boxBlur3 wrote the blur into fineBlurTmp using fineSprGray as its tmp.
    for (let p = 0; p < CELL_PX; p++) fineCellHp[p] = fineCellGray[p] - fineBlurTmp[p]
    sobelMag(fineCellGray, fineCellMag, CELL, CELL)

    fineCellFg.fill(0)
    if (info) {
      const dy = pyRound(CELL / 2 - info.cy)
      const dx = pyRound(CELL / 2 - info.cx)
      for (let p = 0; p < CELL_PX; p++) {
        if (!info.fg[p]) continue
        const y = (p / CELL) | 0
        const x = p - y * CELL
        const ny = y + dy
        const nx = x + dx
        if (ny < 0 || ny >= CELL || nx < 0 || nx >= CELL) continue
        fineCellFg[ny * CELL + nx] = 1
      }
    }
  }

  private fineScoreVariant(
    variant: number,
    scales: number[],
    dy: number,
    dx: number,
    family = false
  ): number {
    let best = -1
    for (const s of scales) {
      const sp = this.spritesAt(s)[variant]
      const o = (CELL - s) >> 1
      for (const oy of OFFS) {
        const y0 = o - dy + oy
        if (y0 < 0 || y0 + s > CELL) continue
        for (const ox of OFFS) {
          const x0 = o - dx + ox
          if (x0 < 0 || x0 + s > CELL) continue
          const score = this.fineScoreAt(sp, y0 * CELL + x0, family)
          if (score > best) best = score
        }
      }
    }
    return best
  }

  private fineScoreAt(sp: Sprite, anchor: number, family = false): number {
    fineSprGray.fill(0)
    fineSprR.fill(0)
    fineSprG.fill(0)
    fineSprB.fill(0)
    let n = 0
    let nFg = 0
    const nPix = sp.off.length
    for (let k = 0; k < nPix; k++) {
      const p = anchor + sp.off[k]
      if (p < VALID_FROM || p >= CELL_PX) continue
      const a = 1 - sp.ia[k]
      if (a <= 0.5) continue
      const k3 = k * 3
      const r = sp.pm[k3] / a
      const g = sp.pm[k3 + 1] / a
      const b = sp.pm[k3 + 2] / a
      fineSprR[p] = r
      fineSprG[p] = g
      fineSprB[p] = b
      fineSprGray[p] = 0.299 * r + 0.587 * g + 0.114 * b
      fineIdx[n++] = p
      if (fineCellFg[p]) nFg++
    }
    if (n < 8) return -1
    // Prefer FG∩sprite pixels when there are enough; else keep the sprite mask.
    let useN = n
    if (nFg >= 8) {
      let w = 0
      for (let i = 0; i < n; i++) {
        const p = fineIdx[i]
        if (fineCellFg[p]) fineIdx[w++] = p
      }
      useN = w
    }
    boxBlur3(fineSprGray, fineBlurTmp, fineSprHp, CELL, CELL)
    for (let p = 0; p < CELL_PX; p++) fineSprHp[p] = fineSprGray[p] - fineBlurTmp[p]
    sobelMag(fineSprGray, fineSprMag, CELL, CELL)
    const color =
      (nccMasked(fineCellR, fineSprR, fineIdx, useN) +
        nccMasked(fineCellG, fineSprG, fineIdx, useN) +
        nccMasked(fineCellB, fineSprB, fineIdx, useN)) /
      3
    const hp = nccMasked(fineCellHp, fineSprHp, fineIdx, useN)
    const edge = nccMasked(fineCellMag, fineSprMag, fineIdx, useN)
    spatialHueHist(fineCellR, fineCellG, fineCellB, fineIdx, useN, CELL, fineCellHue)
    spatialHueHist(fineSprR, fineSprG, fineSprB, fineIdx, useN, CELL, fineSprHue)
    const hue = histIntersection(fineCellHue, fineSprHue)
    return family ? combineFamilyCues(color, hp, edge, hue) : combineFineCues(color, hp, edge, hue)
  }
}

/**
 * Grid-calibration objective backed by the real matcher: the summed
 * analysis-by-synthesis score of the occupied cells. Higher is better.
 *
 * A brightness profile cannot distinguish the true grid from a shifted one on
 * every screenshot (measured: on 2.png the profile cost ranks a grid 9px off
 * far better than the truth). The match score can, because a misaligned cell
 * cannot be explained by any sprite.
 */
export function makeMatchScorer(
  templates: TemplateSource[],
  opts: { rows: number; cols: number }
): GridScorer {
  const recognizer = new PlateMatcherRecognizer()
  recognizer.loadTemplates(templates)
  // The rect's own shape wins over `opts`: the calibrator searches over row
  // counts, so it hands this scorer rects with differing `rows`. Scoring those
  // against a fixed `opts.rows` would divide every candidate by the same pitch
  // and make the search meaningless. `opts` remains the declared default.
  return (img, rect) =>
    recognizer.scoreGrid(img, {
      rows: rect.rows,
      cols: rect.cols,
      totalSlots: rect.rows * rect.cols,
      grid: rect,
    })
}

/** Per-pixel median across a set of cells. Icons differ per cell, so they cancel. */
function medianPlate(cells: Float32Array[], indices: number[]): Float32Array {
  const n = indices.length
  const out = new Float32Array(CELL_PX * 3)
  const buf = new Float64Array(n)
  for (let c = 0; c < CELL_PX * 3; c++) {
    for (let k = 0; k < n; k++) buf[k] = cells[indices[k]][c]
    out[c] = medianOf(buf, n)
  }
  return out
}
