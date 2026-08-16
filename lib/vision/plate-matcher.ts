import {
  deriveNativeArt,
  EXACT_WINDOW,
  exactFractionAt,
  nnUpscale,
  rotateNativeArt,
  searchExact,
  type ExactPatch,
  type NativeArt,
} from './exact-native'
import type { GridScorer } from './grid-calibrate'
import type {
  CellPrediction,
  ItemKind,
  RGBAImage,
  RecognizeOptions,
  Recognizer,
  TemplateSource,
} from './types'

/**
 * Analysis-by-synthesis matcher — the canonical implementation (PLAN §9-G).
 *
 * It began as a port of `tests/vision/REFERENCE.py`; that file is now a frozen
 * historical reference and this one no longer tracks it. The per-image scale
 * lock and scale sweep it inherited are gone: §9-G measured that the game
 * renders icons at an integer S_SCREEN screen px per native art px (nearest
 * neighbour) with a cell pitch of ~40 native px, so each sprite's render size
 * follows deterministically from its native size (`data/sprite-natives.json`)
 * and the cell pitch. Constants are validated against the fixture harness
 * (`npm run test:vision`) as a whole, never tuned to individual fixtures
 * (§9-F doctrine).
 */
export const CELL = 64
export const TOPCUT = Math.floor(CELL * 0.19) // 12
export const TRIM = 0.07
const FGT = 45
// Second-chance occupancy (§10-4 / roadmap 5): depleted-harvest already uses
// fgt=32 successfully. Tiny-icon floor (~32px) is gated by compactness,
// interior (non-ring) and centroid so empty overlay remnants stay empty.
const FGT2 = 32
const MIN_BLOB_RATIO2 = 0.01 // ~33px of N_VALID=3328; amulet is 82, swaying 38
const NUISANCE_TOP = TOPCUT + 10 // 22: overlay band just below TOPCUT
const SPARKLE_AREA = 12 // defender corner glints 5–12px; frozen_bow strokes are ≥16
const COUNTER_AREA = 80 // digit glyphs ~20–50px; body shine is larger / lower
const COUNTER_MAX_X = 22 // left-half overlay; centre-top is icon art
const BADGE_MIN_X = 44 // '+N' / depleted '-N' sit on the right edge
// True-empty cells prefer the empty plate by >>10 residual (p50 gap ~40);
// false-empties prefer occupied by 5–15. Slack 2 is insensitive on [0, 6].
const OCC_PREF_SLACK = 2
const RI = 3
const OFFS = [-2, 0, 2]
const RING_KEEP_RATIO = 0.04
const MIN_BLOB_RATIO = 0.045
const MIN_SHIFTED_FG = 20
const MIN_TEMPLATE_ALPHA_PIXELS = 12
const ALPHA_CUT = 128 // sprite alpha > 128 counts toward the tight bbox

// Deterministic per-sprite scale model (§9-G, measured): the game draws each
// icon at S_SCREEN = round(pitch / 40) screen px per native art px, so a
// sprite of native side N occupies S_SCREEN * N source px inside the cell.
// SLACK absorbs the ±1px uncertainty of the fg/alpha bboxes on each side.
// Measured on the harness: {-2..2} beats both {-1,0,1} and {-2,0,2} by 2+
// cells and is the only set that keeps empty accuracy at the 0.96 floor.
const NATIVE_PX_PER_PITCH = 40 // §9-G: pitch / S_SCREEN ≈ 39.6–40.1
const MAX_S_SCREEN = 8
const SLACK = [-2, -1, 0, 1, 2]
// Sprites whose catalog entry is lowConfidence carry a GUESSED k (lossy webp,
// smooth resample, off-family fit), so their deterministic scale inherits that
// uncertainty. The k families the catalog actually measured span ~2.4..3.4
// against guesses of 2.5/3.0, which maps to scale errors of roughly -25%..+4%
// — an asymmetric, downward window, at typical scales about -8..+2.
const LOWCONF_SLACK = [-8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2]
const MIN_SCALE = 8
const MAX_SCALE = 62

// Roadmap 6 exact re-rank (original screenshot space). BAR/GAP measured:
// true cells 0.93–1.00, lookalikes ~0.2–0.77 at their best offset.
const EXACT_TOPK = 8
export const EXACT_BAR = 0.9
export const EXACT_GAP = 0.15
// Sparse / lookalike cells: stage-2 rank of the truth can sit well past K=8
// (frozen_bow SAD ~0.07). Expand by a cheap seed-only scan of every native-art
// variant when the stage-2 winner is weak or has no native art.
const EXACT_EXPAND_SCORE = 0.12
const EXACT_SEED_KEEP = 0.25

// Reduced settings for the grid-calibration scorer only (~29 calls per image):
// a single scale and offset per variant. There is no IoU prefilter anywhere
// any more. On the prediction path it lost 40/140 truths even at TOPK=96, and
// in the scorer a TOPK=8 funnel scored the TRUE grid negative on 2.png (junk
// survivors only), flipping row detection to 7 — fg under-extraction on dark
// icons wrecks IoU ranking in both roles, so both paths score every variant.
const SCORER_OFFS = [0]
const SCORER_SLACK = [0]
// The game renders square cells (§9-G: ~40 native px pitch on both axes at
// one integer screen scale; the seven fixtures measure pitchY/pitchX of
// 0.978..1.021). A rect outside this envelope is physically impossible, and
// the row-count search generates exactly such rects (pitchY pinned to 0.9x
// pitchX) as aliases that squeeze an extra row in. Refuse to score them.
const SCORER_PITCH_RATIO_LO = 0.95
const SCORER_PITCH_RATIO_HI = 1.05

const CELL_PX = CELL * CELL
const VALID_FROM = TOPCUT * CELL // flat index of the first valid row
const N_VALID = CELL_PX - VALID_FROM

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
const nearestTableCache = new Map<string, Int32Array>()

function nearestIndexTable(srcSpan: number, dstSpan: number): Int32Array {
  const key = srcSpan + ':' + dstSpan
  const hit = nearestTableCache.get(key)
  if (hit) return hit
  const table = new Int32Array(dstSpan)
  const scale = srcSpan / dstSpan
  let o = scale * 0.5
  for (let i = 0; i < dstSpan; i++) {
    table[i] = Math.trunc(o)
    o += scale
  }
  nearestTableCache.set(key, table)
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
  cropCellNearestInto(img, left, top, right, bottom, out)
  return out
}

function cropCellNearestInto(
  img: RGBAImage,
  left: number,
  top: number,
  right: number,
  bottom: number,
  out: Float32Array
): void {
  const xs = nearestIndexTable(right - left, CELL)
  const ys = nearestIndexTable(bottom - top, CELL)
  const d = img.data
  const iw = img.width
  const maxX = iw - 1
  const maxY = img.height - 1

  // PIL's table is strictly inside [0, span), so a crop that sits inside the
  // image never needs per-pixel clamps. Edge grids still take the slow path.
  if (left >= 0 && top >= 0 && right <= iw && bottom <= img.height) {
    for (let y = 0; y < CELL; y++) {
      const rowBase = (top + ys[y]) * iw
      const oRow = y * CELL * 3
      for (let x = 0; x < CELL; x++) {
        const s = (rowBase + left + xs[x]) * 4
        const o = oRow + x * 3
        out[o] = d[s]
        out[o + 1] = d[s + 1]
        out[o + 2] = d[s + 2]
      }
    }
    return
  }

  for (let y = 0; y < CELL; y++) {
    let syi = top + ys[y]
    if (syi < 0) syi = 0
    else if (syi > maxY) syi = maxY
    const rowBase = syi * iw
    const oRow = y * CELL * 3
    for (let x = 0; x < CELL; x++) {
      let sxi = left + xs[x]
      if (sxi < 0) sxi = 0
      else if (sxi > maxX) sxi = maxX
      const s = (rowBase + sxi) * 4
      const o = oRow + x * 3
      out[o] = d[s]
      out[o + 1] = d[s + 1]
      out[o + 2] = d[s + 2]
    }
  }
}

const morphTmp = new Uint8Array(CELL_PX)
const ccStack = new Int32Array(CELL_PX)

/** Rectangular max filter, out-of-bounds ignored (cv2 morphology border default). */
function dilateRect(src: Uint8Array, k: number): Uint8Array {
  const r = (k - 1) >> 1
  const tmp = morphTmp
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
  const tmp = morphTmp
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
  const stack = ccStack
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
  /** Pixel count of `fg` (unshifted). */
  n: number
  /** Overlay-glyph / sparkle mask — excluded from fg AND from match SAD. */
  nuisance: Uint8Array
  /** Nuisance pixels in the valid (non-TOPCUT) region. */
  nMasked: number
  /** area / bbox area of the kept (grown) blob. */
  compact: number
  /** Dominant connected component before hull grow — occupancy gates use this. */
  ccN: number
  ccCompact: number
  ccSize: number
}

const ringScratch = new Int32Array(1 << 16)
const ringSeen = new Int32Array(RING_N)
/** [r,g,b,D] per pixel — reused across matchCell calls (single-threaded). */
const packedCell = new Float32Array(CELL_PX * 4)
const packedPlate = new Float32Array(CELL_PX * 4)
/** Packed cell RGB (r | g<<8 | b<<16) + integer D for the opaque SAD. */
const cellPack = new Uint32Array(CELL_PX)
const cellD = new Float32Array(CELL_PX)
const EMPTY_NUIS = new Uint8Array(CELL_PX)


function lowerBoundInt32(arr: Int32Array, n: number, cut: number): number {
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < cut) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Opaque SAD against integer cell RGB. Sprite colours are uint8, cell colours
 * are the same integers the Float32 path stored, so abs-diff is bit-identical
 * once promoted back into the float64 `delta` accumulator.
 */
function opaqueDelta(
  anchor: number,
  k0: number,
  n: number,
  off: Int32Array,
  rgb: Uint32Array,
  pack: Uint32Array,
  D: Float32Array
): number {
  let delta = 0
  let k = k0
  const n4 = n - ((n - k0) & 3)
  for (; k < n4; k += 4) {
    const p0 = anchor + off[k]
    const sv0 = rgb[k]
    const cv0 = pack[p0]
    const dr0 = (cv0 & 255) - (sv0 & 255)
    const dg0 = ((cv0 >>> 8) & 255) - ((sv0 >>> 8) & 255)
    const db0 = ((cv0 >>> 16) & 255) - ((sv0 >>> 16) & 255)
    const p1 = anchor + off[k + 1]
    const sv1 = rgb[k + 1]
    const cv1 = pack[p1]
    const dr1 = (cv1 & 255) - (sv1 & 255)
    const dg1 = ((cv1 >>> 8) & 255) - ((sv1 >>> 8) & 255)
    const db1 = ((cv1 >>> 16) & 255) - ((sv1 >>> 16) & 255)
    const p2 = anchor + off[k + 2]
    const sv2 = rgb[k + 2]
    const cv2 = pack[p2]
    const dr2 = (cv2 & 255) - (sv2 & 255)
    const dg2 = ((cv2 >>> 8) & 255) - ((sv2 >>> 8) & 255)
    const db2 = ((cv2 >>> 16) & 255) - ((sv2 >>> 16) & 255)
    const p3 = anchor + off[k + 3]
    const sv3 = rgb[k + 3]
    const cv3 = pack[p3]
    const dr3 = (cv3 & 255) - (sv3 & 255)
    const dg3 = ((cv3 >>> 8) & 255) - ((sv3 >>> 8) & 255)
    const db3 = ((cv3 >>> 16) & 255) - ((sv3 >>> 16) & 255)
    delta +=
      (dr0 < 0 ? -dr0 : dr0) +
      (dg0 < 0 ? -dg0 : dg0) +
      (db0 < 0 ? -db0 : db0) -
      D[p0] +
      (dr1 < 0 ? -dr1 : dr1) +
      (dg1 < 0 ? -dg1 : dg1) +
      (db1 < 0 ? -db1 : db1) -
      D[p1] +
      (dr2 < 0 ? -dr2 : dr2) +
      (dg2 < 0 ? -dg2 : dg2) +
      (db2 < 0 ? -db2 : db2) -
      D[p2] +
      (dr3 < 0 ? -dr3 : dr3) +
      (dg3 < 0 ? -dg3 : dg3) +
      (db3 < 0 ? -db3 : db3) -
      D[p3]
  }
  for (; k < n; k++) {
    const p = anchor + off[k]
    const sv = rgb[k]
    const cv = pack[p]
    const dr = (cv & 255) - (sv & 255)
    const dg = ((cv >>> 8) & 255) - ((sv >>> 8) & 255)
    const db = ((cv >>> 16) & 255) - ((sv >>> 16) & 255)
    delta += (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db) - D[p]
  }
  return delta
}

/** Same SAD, skipping nuisance pixels (contribution 0 on both sides, §10-2). */
function opaqueDeltaNuis(
  anchor: number,
  k0: number,
  n: number,
  off: Int32Array,
  rgb: Uint32Array,
  pack: Uint32Array,
  D: Float32Array,
  nuis: Uint8Array
): number {
  let delta = 0
  for (let k = k0; k < n; k++) {
    const p = anchor + off[k]
    if (nuis[p]) continue
    const sv = rgb[k]
    const cv = pack[p]
    const dr = (cv & 255) - (sv & 255)
    const dg = ((cv >>> 8) & 255) - ((sv >>> 8) & 255)
    const db = ((cv >>> 16) & 255) - ((sv >>> 16) & 255)
    delta += (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db) - D[p]
  }
  return delta
}

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

function isWhiteGlyph(r: number, g: number, b: number): boolean {
  return r >= 220 && g >= 220 && b >= 220 && Math.max(r, g, b) - Math.min(r, g, b) <= 30
}

function isRedGlyph(r: number, g: number, b: number): boolean {
  return r >= 180 && g <= 90 && b <= 90 && r - Math.max(g, b) >= 80
}

/**
 * Overlay-glyph / sparkle mask (roadmap 5, §10-2).
 *
 * Overlay counters ('N/M', '-N/M') and '+N' badges are near-pure white or red,
 * short, and sit in the top band just below TOPCUT. Sparkles are tiny isolated
 * white CCs anywhere. Icon art that happens to be white or red (kaleidoscope
 * loaf, ruby gem, defect_probe shine) is larger, lower, or less compact — those
 * CCs are left alone. The mask is applied to BOTH fg extraction and the match
 * SAD so it cannot bias score the way a one-sided TOPCUT did.
 */
function detectNuisance(cell: Float32Array): { mask: Uint8Array; nMasked: number } {
  const seed = new Uint8Array(CELL_PX)
  for (let p = 0; p < CELL_PX; p++) {
    const p3 = p * 3
    const r = cell[p3]
    const g = cell[p3 + 1]
    const b = cell[p3 + 2]
    if (isWhiteGlyph(r, g, b) || isRedGlyph(r, g, b)) seed[p] = 1
  }
  const { labels, areas } = connectedComponents(seed)
  const keep = new Uint8Array(CELL_PX)
  if (areas.length > 1) {
    const nComp = areas.length - 1
    const minX = new Int32Array(nComp + 1)
    const maxX = new Int32Array(nComp + 1)
    const minY = new Int32Array(nComp + 1)
    const maxY = new Int32Array(nComp + 1)
    minX.fill(CELL)
    minY.fill(CELL)
    maxX.fill(-1)
    maxY.fill(-1)
    for (let p = 0; p < CELL_PX; p++) {
      const lab = labels[p]
      if (lab === 0) continue
      const y = (p / CELL) | 0
      const x = p - y * CELL
      if (x < minX[lab]) minX[lab] = x
      if (x > maxX[lab]) maxX[lab] = x
      if (y < minY[lab]) minY[lab] = y
      if (y > maxY[lab]) maxY[lab] = y
    }
    const outline = new Float32Array(nComp + 1)
    const borderN = new Int32Array(nComp + 1)
    for (let p = 0; p < CELL_PX; p++) {
      const lab = labels[p]
      if (lab === 0) continue
      const y = (p / CELL) | 0
      const x = p - y * CELL
      const nbr = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= CELL || ny >= CELL) {
          borderN[lab]++
          return
        }
        const q = ny * CELL + nx
        if (labels[q] === lab) return
        borderN[lab]++
        const q3 = q * 3
        if (Math.max(cell[q3], cell[q3 + 1], cell[q3 + 2]) < 90) outline[lab]++
      }
      nbr(x - 1, y)
      nbr(x + 1, y)
      nbr(x, y - 1)
      nbr(x, y + 1)
    }
    const drop = new Uint8Array(nComp + 1)
    for (let i = 1; i <= nComp; i++) {
      const area = areas[i]
      const h = maxY[i] - minY[i] + 1
      const w = maxX[i] - minX[i] + 1
      const compact = area / (w * h)
      const aspect = w >= h ? w / h : h / w
      const outlined = borderN[i] > 0 && outline[i] / borderN[i] >= 0.25
      // Overlay CCs originate in the TOPCUT strip. Icon ice (frozen_bow) is also
      // near-white but starts lower (minY≥16) or is a 1–2px column — leave it.
      const fromStrip = minY[i] <= TOPCUT + 2
      const inTop = fromStrip && maxY[i] <= NUISANCE_TOP && h <= 12
      const sparkle = inTop && area <= SPARKLE_AREA && compact >= 0.5
      const counter =
        inTop &&
        outlined &&
        area <= COUNTER_AREA &&
        maxX[i] <= COUNTER_MAX_X &&
        w >= 4 &&
        aspect <= 4 &&
        compact >= 0.3
      const badge = inTop && outlined && area <= COUNTER_AREA && minX[i] >= BADGE_MIN_X && aspect <= 4
      if (sparkle || counter || badge) drop[i] = 1
    }
    for (let p = 0; p < CELL_PX; p++) if (drop[labels[p]]) keep[p] = 1
  }
  // Dilate-1 pulls in the dark outline without eating 3px of neighbouring art
  // (dilate-3 zeroed frozen_bow ice and flipped 7.png#4 to charcoal).
  const grown = dilateRect(keep, 1)
  let nMasked = 0
  for (let p = VALID_FROM; p < CELL_PX; p++) if (grown[p]) nMasked++
  return { mask: grown, nMasked }
}

function meanAbsValid(a: Float32Array, b: Float32Array, nuis: Uint8Array): number {
  let s = 0
  let n = 0
  for (let p = VALID_FROM; p < CELL_PX; p++) {
    if (nuis[p]) continue
    const p3 = p * 3
    s += Math.abs(a[p3] - b[p3]) + Math.abs(a[p3 + 1] - b[p3 + 1]) + Math.abs(a[p3 + 2] - b[p3 + 2])
    n++
  }
  return n ? s / n : 0
}

function fgTouchesRing(fg: Uint8Array): number {
  let n = 0
  for (let i = 0; i < RING_N; i++) if (fg[CELL_RING_INDICES[i]]) n++
  return n
}

interface AnalyzeOpts {
  /** Quantised palette background (default: the cell's own ring). */
  bg?: Float32Array
  fgt?: number
  minBlob?: number
  nuisance?: Uint8Array
  nMasked?: number
}

function pass2Accept(info: CellInfo): boolean {
  // Gates use the dominant CC (pre-grow). Dilate-9 hull drops compactness on
  // thin icons (kunai 0.49 → 0.27) and must not decide occupancy.
  // Empty-frame leftovers compact 0.06–0.30 or sit on the ring; recovered
  // items 0.38 (frozen_bow after overlay strip) – 0.91 (amulet).
  const ring = fgTouchesRing(info.fg)
  if (ring * 2 > info.n) return false
  if (info.cx < 10 || info.cx > CELL - 10) return false
  if (info.cy < 16 || info.cy > CELL - 10) return false
  // 0.35 rejects kunai (0.29) and 5.png#26 balisong (0.34). Empty leftovers
  // that pass 0.28 (4.png#17/30 overlay remnants, 7.png#33) prefer the empty
  // plate by >>10 residual so the closerToOcc trigger normally skips them —
  // but that trigger is unavailable when plateEmpty is null (<3 empty cells).
  // The load-bearing defense is THIS function's geometry gates plus the
  // score<=0 backstop: measured with the trigger force-disabled on all seven
  // fixtures, output is bit-identical and no empty cell false-occupies.
  // Insensitive on [0.28, 0.33] for false-occupied.
  if (info.ccSize > 48 || info.ccCompact < 0.28) return false
  return info.ccN >= N_VALID * MIN_BLOB_RATIO2
}

/**
 * Occupancy + foreground extraction for one 64x64 cell.
 * Returns null for an empty cell.
 */
export function analyzeCell(cell: Float32Array, opts?: AnalyzeOpts): CellInfo | null {
  // Default is the unmasked pass-1 extractor so grid-calibrate's centroid
  // regression and coverage probes keep the occupancy they were pinned on.
  // Recognition always passes a per-cell nuisance mask (prepare()).
  const nuis = opts?.nuisance ?? EMPTY_NUIS
  const nMasked = opts?.nMasked ?? 0
  const fgt = opts?.fgt ?? FGT
  const minBlob = opts?.minBlob ?? N_VALID * MIN_BLOB_RATIO
  const bg = opts?.bg ?? ringBackground(cell)
  const nbg = bg.length / 3

  const fg = new Uint8Array(CELL_PX)
  for (let p = VALID_FROM; p < CELL_PX; p++) {
    if (nuis[p]) continue
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
    if (best > fgt) fg[p] = 1
  }

  const closed = erodeRect(dilateRect(fg, 3), 3)
  const { labels, areas } = connectedComponents(closed)
  if (areas.length <= 1) return null

  let bi = 1
  for (let i = 2; i < areas.length; i++) if (areas[i] > areas[bi]) bi = i
  if (areas[bi] < minBlob) return null

  const blob = new Uint8Array(CELL_PX)
  let ccMinX = CELL
  let ccMaxX = -1
  let ccMinY = CELL
  let ccMaxY = -1
  for (let p = 0; p < CELL_PX; p++) {
    if (labels[p] !== bi) continue
    blob[p] = 1
    const y = (p / CELL) | 0
    const x = p - y * CELL
    if (x < ccMinX) ccMinX = x
    if (x > ccMaxX) ccMaxX = x
    if (y < ccMinY) ccMinY = y
    if (y > ccMaxY) ccMaxY = y
  }
  const ccW = ccMaxX - ccMinX + 1
  const ccH = ccMaxY - ccMinY + 1
  const ccN = areas[bi]
  const ccCompact = ccN / (ccW * ccH)
  const ccSize = Math.max(ccW, ccH)
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

  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  return {
    fg: keep,
    cy: sy / n,
    cx: sx / n,
    size: Math.max(bw, bh),
    n,
    nuisance: nuis,
    nMasked,
    compact: n / (bw * bh),
    ccN,
    ccCompact,
    ccSize,
  }
}

/** Count of fg pixels that remain in-bounds after a (dy, dx) shift. */
function countShiftedFg(src: Uint8Array, dy: number, dx: number): number {
  if (dy === 0 && dx === 0) {
    let n = 0
    for (let p = 0; p < CELL_PX; p++) n += src[p]
    return n
  }
  const ySrc0 = dy >= 0 ? 0 : -dy
  const ySrc1 = dy >= 0 ? CELL - dy : CELL
  const xSrc0 = dx >= 0 ? 0 : -dx
  const xSrc1 = dx >= 0 ? CELL - dx : CELL
  let n = 0
  for (let y = ySrc0; y < ySrc1; y++) {
    const srcRow = y * CELL
    for (let x = xSrc0; x < xSrc1; x++) n += src[srcRow + x]
  }
  return n
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
  /** max(nativeW, nativeH) from the sprite-natives catalog — rotation invariant. */
  nativeSide: number
  /** Catalog lowConfidence: k was guessed, so the scale window widens. */
  uncertain: boolean
  /** Null when native art is unreliable (fallback / failed round-trip). */
  nativeArt: NativeArt | null
}

/**
 * A sprite rendered at one scale, reduced to its non-transparent pixels.
 * Fully transparent pixels composite to exactly the plate, so their error is
 * already inside the empty-cell baseline and never needs recomputing. Fully
 * OPAQUE pixels — the overwhelming majority in NN-upscaled pixel art — have a
 * composite that is a constant colour independent of the plate, so they are
 * split into their own list whose inner loop reads neither plate nor alpha.
 */
interface Sprite {
  offO: Int32Array // opaque pixels: dy*CELL + dx, ascending
  rgbO: Uint32Array // opaque pixels: r | g<<8 | b<<16 (uint, exact)
  offB: Int32Array // blended (0 < alpha < 1) pixels, ascending
  apmB: Float32Array // blended pixels: [1 - alpha, r*alpha, g*alpha, b*alpha], stride 4
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
  let nO = 0
  let nB = 0
  for (let y = 0; y < s; y++) {
    let syi = table[y]
    if (syi > S - 1) syi = S - 1
    for (let x = 0; x < s; x++) {
      let sxi = table[x]
      if (sxi > S - 1) sxi = S - 1
      const a = sq.data[(syi * S + sxi) * 4 + 3]
      if (a === 255) nO++
      else if (a !== 0) nB++
    }
  }

  const offO = new Int32Array(nO)
  const rgbO = new Uint32Array(nO)
  const offB = new Int32Array(nB)
  const apmB = new Float32Array(nB * 4)
  let iO = 0
  let iB = 0

  for (let y = 0; y < s; y++) {
    let syi = table[y]
    if (syi > S - 1) syi = S - 1
    for (let x = 0; x < s; x++) {
      let sxi = table[x]
      if (sxi > S - 1) sxi = S - 1
      const src = (syi * S + sxi) * 4
      const a = sq.data[src + 3]
      if (a === 0) continue
      if (a === 255) {
        offO[iO] = y * CELL + x
        rgbO[iO] = sq.data[src] | (sq.data[src + 1] << 8) | (sq.data[src + 2] << 16)
        iO++
      } else {
        const alpha = a / 255
        offB[iB] = y * CELL + x
        const b4 = iB * 4
        apmB[b4] = 1 - alpha
        apmB[b4 + 1] = sq.data[src] * alpha
        apmB[b4 + 2] = sq.data[src + 1] * alpha
        apmB[b4 + 3] = sq.data[src + 2] * alpha
        iB++
      }
    }
  }

  return { offO, rgbO, offB, apmB }
}

function emptyPrediction(slotIndex: number): CellPrediction {
  return { slotIndex, matchedValue: null, type: null, rotation: 0, confidence: 0 }
}

interface MatchHit {
  variant: number
  score: number
  gain: number
  top: { variant: number; score: number }[]
}

interface PreparedGrid {
  cells: Float32Array[]
  infos: (CellInfo | null)[]
  plateOccupied: Float32Array | null
  plateEmpty: Float32Array | null
  /** Per-variant deterministic render scale for this image's pitch (§9-G). */
  baseScales: Int32Array
  sScreen: number
  originX: number
  originY: number
  pitchX: number
  pitchY: number
  margin: number
  cols: number
}

export class PlateMatcherRecognizer implements Recognizer {
  readonly name = 'plate-matcher'

  private variants: Variant[] = []
  /** Lazy per-(variant, scale) sprite cache — scales differ per variant now. */
  private spriteCache: Map<number, Sprite>[] = []
  /** Lazy NN-upscaled native patches for the current S_SCREEN. */
  private exactCache: (ExactPatch | null)[] = []
  private exactS = -1
  /** Per-variant best delta scratch for the exact-pass top-K. */
  private varDelta = new Float64Array(0)
  /**
   * scoreGrid memo. Grid calibration re-evaluates identical rects (the sweep
   * re-checks its own baseline every round) and scoreGrid is pure, so repeat
   * calls are answered from here. Keyed weakly by image, exactly by rect.
   */
  private scoreMemo = new WeakMap<RGBAImage, Map<string, number>>()
  private prepMemo = new WeakMap<RGBAImage, Map<string, PreparedGrid>>()

  loadTemplates(templates: TemplateSource[]): void {
    const variants: Variant[] = []
    for (const t of templates) {
      if (!t.native) {
        throw new Error(
          `plate-matcher: template "${t.value}" carries no native size — ` +
            'attach data/sprite-natives.json entries to TemplateSource.native (PLAN §9-G)'
        )
      }
      const square = toSquare(t.image)
      if (!square) continue
      const nativeSide = Math.max(t.native[0], t.native[1])
      const nativeArt = deriveNativeArt(t.image, t.native)
      const rotations: (0 | 1 | 2 | 3)[] =
        t.type === 'TABLET' && t.rotatable ? [0, 1, 2, 3] : [0]
      for (const r of rotations) {
        variants.push({
          value: t.value,
          type: t.type,
          rotation: r,
          square: rotateSquare(square, r),
          nativeSide,
          uncertain: t.nativeUncertain === true,
          nativeArt: nativeArt ? rotateNativeArt(nativeArt, r) : null,
        })
      }
    }
    this.variants = variants
    this.spriteCache = variants.map(() => new Map())
    this.exactCache = []
    this.exactS = -1
    this.varDelta = new Float64Array(variants.length)
    this.scoreMemo = new WeakMap()
    this.prepMemo = new WeakMap()
  }

  private gridKey(opts: RecognizeOptions): string {
    const g = opts.grid
    return g
      ? `${opts.rows}|${opts.cols}|${opts.totalSlots}|${g.originX}|${g.originY}|${g.gridWidth}|${g.gridHeight}`
      : `${opts.rows}|${opts.cols}|${opts.totalSlots}`
  }

  private spriteAt(variant: number, scale: number): Sprite {
    const cache = this.spriteCache[variant]
    let sprite = cache.get(scale)
    if (!sprite) {
      sprite = buildSprite(this.variants[variant].square, scale)
      cache.set(scale, sprite)
    }
    return sprite
  }

  private exactAt(variant: number, s: number): ExactPatch | null {
    const art = this.variants[variant].nativeArt
    if (!art) return null
    if (this.exactS !== s) {
      this.exactCache = new Array(this.variants.length).fill(null)
      this.exactS = s
    }
    let patch = this.exactCache[variant]
    if (!patch) {
      patch = nnUpscale(art, s)
      this.exactCache[variant] = patch
    }
    return patch
  }

  /**
   * Cell decomposition, plate learning and per-sprite scales.
   * `pass2` is recognition-only: a misaligned scorer grid produces garbage plates,
   * and second-chance occupancy then scores junk blobs as occupied (measured:
   * 5.png pitchY drifted +15px and auto floors dropped 2 cells).
   */
  private prepare(img: RGBAImage, opts: RecognizeOptions, pass2: boolean): PreparedGrid {
    const key = this.gridKey(opts) + (pass2 ? '|p2' : '|p1')
    let memo = this.prepMemo.get(img)
    if (!memo) {
      memo = new Map()
      this.prepMemo.set(img, memo)
    }
    const hit = memo.get(key)
    if (hit) return hit

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
    const nuisances: Uint8Array[] = []
    const nMasked: number[] = []
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
      const np = detectNuisance(cell)
      cells.push(cell)
      nuisances.push(np.mask)
      nMasked.push(np.nMasked)
      infos.push(analyzeCell(cell, { nuisance: np.mask, nMasked: np.nMasked }))
    }

    const occupied: number[] = []
    const empty: number[] = []
    for (let i = 0; i < totalSlots; i++) (infos[i] ? occupied : empty).push(i)

    const plateOccupied = occupied.length >= 4 ? medianPlate(cells, occupied) : null
    const plateEmpty = empty.length >= 3 ? medianPlate(cells, empty) : null

    // Pass 2 occupancy (roadmap 5, §10-4). Recognition only — see prepare().
    if (pass2) for (let i = 0; i < totalSlots; i++) {
      const info = infos[i]
      const cell = cells[i]
      const nuis = nuisances[i]
      const resOcc = plateOccupied ? meanAbsValid(cell, plateOccupied, nuis) : Infinity
      const resEmp = plateEmpty ? meanAbsValid(cell, plateEmpty, nuis) : Infinity
      const closerToOcc = !!plateOccupied && resOcc + OCC_PREF_SLACK < resEmp
      const overlayGrabbed = !!info && info.cy < 20
      const ringHit = info ? fgTouchesRing(info.fg) : 0
      const uncertainEmpty = !info && (plateEmpty ? closerToOcc : !!plateOccupied)
      const uncertainRing = !!info && ringHit >= 24 && info.n < 200
      if (!uncertainEmpty && !uncertainRing && !overlayGrabbed) continue

      const opts2 = {
        fgt: FGT2,
        minBlob: N_VALID * MIN_BLOB_RATIO2,
        nuisance: nuis,
        nMasked: nMasked[i],
      }
      // Learned-plate ring first (self-contaminated rings, overlay-stripped
      // bodies). Own-ring second: tiny dark icons wash against the occupied
      // plate (amulet/kunai/swaying). Prefer a plate blob that already meets
      // the pass-1 size floor so a 70px own-ring fragment cannot lock in.
      const plate = this.plateFor(cell, plateOccupied, plateEmpty)
      const fromPlate = analyzeCell(cell, { ...opts2, bg: ringBackground(plate) })
      const fromOwn = analyzeCell(cell, opts2)
      const plateOk = !!(fromPlate && pass2Accept(fromPlate))
      const ownOk = !!(fromOwn && pass2Accept(fromOwn))
      let retry = plateOk && fromPlate!.ccN >= N_VALID * MIN_BLOB_RATIO ? fromPlate : null
      if (!retry && ownOk) retry = fromOwn
      if (!retry && plateOk) retry = fromPlate
      if (!retry) continue
      if (!info) infos[i] = retry
      else if (
        overlayGrabbed &&
        retry.cy > info.cy + 6 &&
        retry.ccN >= info.ccN &&
        retry.ccCompact >= info.ccCompact
      ) {
        infos[i] = retry
      } else if (uncertainRing && retry.ccN > info.ccN && retry.ccCompact >= info.ccCompact) {
        infos[i] = retry
      }
    }

    // Deterministic per-sprite scales (§9-G). The cell canvas maps `span`
    // source px onto CELL px, so a sprite of native side N rendered at
    // S_SCREEN px/native px lands on S_SCREEN * N * CELL / span canvas px.
    // The old per-image scale lock (fg-size percentile) measured "what is in
    // this inventory", not the render scale, and drifted 42/42/34/40 across
    // same-pitch fixtures.
    const span = pitchX * (1 - 2 * TRIM)
    let sScreen = Math.round(pitchX / NATIVE_PX_PER_PITCH)
    if (sScreen < 1) sScreen = 1
    else if (sScreen > MAX_S_SCREEN) sScreen = MAX_S_SCREEN
    const baseScales = new Int32Array(this.variants.length)
    for (let j = 0; j < this.variants.length; j++) {
      let s = Math.round((sScreen * this.variants[j].nativeSide * CELL) / span)
      if (s < MIN_SCALE) s = MIN_SCALE
      else if (s > MAX_SCALE) s = MAX_SCALE
      baseScales[j] = s
    }

    const prepared: PreparedGrid = {
      cells,
      infos,
      plateOccupied,
      plateEmpty,
      baseScales,
      sScreen,
      originX,
      originY,
      pitchX,
      pitchY,
      margin,
      cols,
    }
    memo.set(key, prepared)
    return prepared
  }

  async recognize(img: RGBAImage, opts: RecognizeOptions): Promise<CellPrediction[]> {
    const prepared = this.prepare(img, opts, true)
    const { cells, infos, plateOccupied, plateEmpty, baseScales, sScreen } = prepared
    const lossless = opts.lossless === true && sScreen >= 1 && sScreen === (sScreen | 0)

    const predictions: CellPrediction[] = []
    for (let i = 0; i < opts.totalSlots; i++) {
      const info = infos[i]
      if (!info) {
        predictions.push(emptyPrediction(i))
        continue
      }
      const best = this.matchCell(cells[i], info, plateOccupied, plateEmpty, baseScales, null, OFFS, true, true)
      // Model comparison: score <= 0 means the best composite explains the
      // cell no better than the bare plate, so "no item" is the winning
      // hypothesis. Without the prefilter this is what keeps junk blobs
      // (overlay text on empty cells) from matching some tiny sprite — the
      // old code only escaped those by luck, when every locked-scale sprite
      // happened to be unplaceable. The boundary is 0 by construction, not a
      // tuned constant. Applied only here: the grid scorer keeps summing raw
      // scores so misalignment still shows up as negative contributions.
      if (!best || best.score <= 0) {
        predictions.push(emptyPrediction(i))
        continue
      }

      let winner = best.variant
      let confidence = best.score
      let ranked = best.top

      if (lossless) {
        const exact = this.exactRerank(img, prepared, i, info, best)
        // Stage-2 identity/confidence stay byte-identical unless BAR+GAP fires.
        if (exact?.overrode) {
          winner = exact.variant
          ranked = exact.top
          confidence = exact.frac
        }
      }

      const v = this.variants[winner]
      predictions.push({
        slotIndex: i,
        matchedValue: v.value,
        type: v.type,
        rotation: v.rotation,
        confidence,
        candidates: this.toCandidates(ranked, winner, confidence),
      })
    }
    return predictions
  }

  /**
   * Total analysis-by-synthesis score over the occupied cells, used ONLY as a
   * grid-calibration objective. Deliberately cheaper than `recognize`: one
   * scale per variant and no offset search. It must never feed predictions.
   * (Summing the raw un-normalized gain instead was measured and rejected: a
   * misaligned grid borrows fragments of two icons per cell and explains MORE
   * total deviation than the truth — 765k vs 664k on 5.png.)
   */
  scoreGrid(img: RGBAImage, opts: RecognizeOptions): number {
    const g = opts.grid
    const key = this.gridKey(opts)
    let memo = this.scoreMemo.get(img)
    if (!memo) {
      memo = new Map()
      this.scoreMemo.set(img, memo)
    }
    const hit = memo.get(key)
    if (hit !== undefined) return hit

    // Square-cell physics guard (§9-G) — see SCORER_PITCH_RATIO_*.
    if (g) {
      const ratio = g.gridHeight / opts.rows / (g.gridWidth / opts.cols)
      if (ratio < SCORER_PITCH_RATIO_LO || ratio > SCORER_PITCH_RATIO_HI) {
        memo.set(key, -1e9)
        return -1e9
      }
    }

    const { cells, infos, plateOccupied, plateEmpty, baseScales } = this.prepare(img, opts, false)

    let total = 0
    for (let i = 0; i < opts.totalSlots; i++) {
      const info = infos[i]
      if (!info) continue
      const best = this.matchCell(
        cells[i],
        info,
        plateOccupied,
        plateEmpty,
        baseScales,
        SCORER_SLACK,
        SCORER_OFFS,
        false
      )
      if (best) total += best.score
    }
    memo.set(key, total)
    return total
  }

  private toCandidates(
    ranked: { variant: number; score: number }[],
    winner: number,
    winnerScore: number
  ): CellPrediction['candidates'] {
    const out: NonNullable<CellPrediction['candidates']> = []
    const seen = new Set<string>()
    const push = (j: number, score: number) => {
      const v = this.variants[j]
      const key = v.value + '|' + v.type + '|' + v.rotation
      if (seen.has(key)) return
      seen.add(key)
      out.push({ value: v.value, type: v.type, rotation: v.rotation, score })
    }
    push(winner, winnerScore)
    for (const t of ranked) {
      if (out.length >= 3) break
      push(t.variant, t.score)
    }
    return out
  }

  /**
   * Pixel-exact re-rank in ORIGINAL screenshot space (roadmap 6).
   * Stage-2 top-K with native art are NN-upscaled by S_SCREEN and scored by
   * the fraction of opaque pixels that equal the source RGB exactly.
   */
  private exactRerank(
    img: RGBAImage,
    prep: PreparedGrid,
    slot: number,
    info: CellInfo,
    stage2: MatchHit
  ): { variant: number; frac: number; top: { variant: number; score: number }[]; overrode: boolean } | null {
    const { sScreen, originX, originY, pitchX, pitchY, margin, cols } = prep
    const r = Math.floor(slot / cols)
    const c = slot % cols
    const cellX = originX + c * pitchX
    const cellY = originY + r * pitchY
    const cellL = Math.trunc(cellX + margin)
    const cellT = Math.trunc(cellY + margin)
    const cellR = Math.trunc(cellX + pitchX - margin)
    const cellB = Math.trunc(cellY + pitchY - margin)
    if (cellR <= cellL || cellB <= cellT) return null

    const srcH = cellB - cellT
    const srcW = cellR - cellL
    const ys = nearestIndexTable(srcH, CELL)
    let minValid = srcH
    for (let y = TOPCUT; y < CELL; y++) if (ys[y] < minValid) minValid = ys[y]
    const validY0 = cellT + minValid
    const nuis = info.nMasked ? this.nuisanceSourceMask(info.nuisance, srcW, srcH) : null

    const pool: number[] = []
    const seen = new Uint8Array(this.variants.length)
    const consider = (j: number) => {
      if (j < 0 || seen[j] || !this.variants[j].nativeArt) return
      seen[j] = 1
      pool.push(j)
    }
    consider(stage2.variant)
    for (const t of stage2.top) consider(t.variant)
    if (pool.length > 0) {
      const wanted = new Set<string>()
      for (const j of pool) wanted.add(this.variants[j].value)
      for (let j = 0; j < this.variants.length; j++) {
        if (wanted.has(this.variants[j].value)) consider(j)
      }
    }

    const cxSrc = cellL + (info.cx / CELL) * srcW
    const cySrc = cellT + (info.cy / CELL) * srcH
    const winnerHasArt = !!this.variants[stage2.variant]?.nativeArt
    const expand = stage2.score < EXACT_EXPAND_SCORE || !winnerHasArt
    if (expand) {
      for (let j = 0; j < this.variants.length; j++) {
        if (seen[j] || !this.variants[j].nativeArt) continue
        const patch = this.exactAt(j, sScreen)
        if (!patch) continue
        const oxC = Math.round(cxSrc - 0.5 * patch.width)
        const oyC = Math.round(cySrc - 0.5 * patch.height)
        const ox0 = Math.round(cellL + (srcW - patch.width) / 2)
        const oy0 = Math.round(cellT + (srcH - patch.height) / 2)
        const fC = exactFractionAt(
          img, patch, oxC, oyC, cellL, cellT, cellR, cellB, validY0, nuis, cellL, cellT, srcW, EXACT_SEED_KEEP
        )
        const f0 = exactFractionAt(
          img, patch, ox0, oy0, cellL, cellT, cellR, cellB, validY0, nuis, cellL, cellT, srcW, EXACT_SEED_KEEP
        )
        if (Math.max(fC, f0) >= EXACT_SEED_KEEP) consider(j)
      }
    }
    if (pool.length === 0) return null

    let bestJ = -1
    let bestF = -1
    let secondF = -1
    const fracs = new Float64Array(this.variants.length)
    fracs.fill(-1)
    for (const j of pool) {
      const patch = this.exactAt(j, sScreen)
      if (!patch) continue
      const ox = Math.round(cxSrc - 0.5 * patch.width)
      const oy = Math.round(cySrc - 0.5 * patch.height)
      const f = searchExact(
        img,
        patch,
        ox,
        oy,
        EXACT_WINDOW,
        cellL,
        cellT,
        cellR,
        cellB,
        validY0,
        nuis,
        cellL,
        cellT,
        srcW
      )
      fracs[j] = f
      if (f > bestF) {
        secondF = bestF
        bestF = f
        bestJ = j
      } else if (f > secondF) {
        secondF = f
      }
    }
    if (bestJ < 0) return null

    const ranked = pool
      .filter((j) => fracs[j] >= 0)
      .sort((a, b) => fracs[b] - fracs[a] || a - b)
      .map((j) => ({ variant: j, score: fracs[j] }))

    const overrode =
      bestJ !== stage2.variant && bestF >= EXACT_BAR && bestF - Math.max(secondF, 0) >= EXACT_GAP
    return {
      variant: overrode ? bestJ : stage2.variant,
      frac: bestF,
      top: ranked,
      overrode,
    }
  }

  /** Map 64×64 CELL nuisance onto source-cell pixels via the same NN table as cropCellNearest. */
  private nuisanceSourceMask(nuis64: Uint8Array, srcW: number, srcH: number): Uint8Array {
    const xs = nearestIndexTable(srcW, CELL)
    const ys = nearestIndexTable(srcH, CELL)
    const out = new Uint8Array(srcW * srcH)
    for (let y = 0; y < CELL; y++) {
      const sy = ys[y]
      const row = sy * srcW
      const nRow = y * CELL
      for (let x = 0; x < CELL; x++) {
        if (nuis64[nRow + x]) out[row + xs[x]] = 1
      }
    }
    return out
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
    baseScales: Int32Array,
    slack: readonly number[] | null = null,
    offs: readonly number[] = OFFS,
    recenter: boolean = true,
    collectTop: boolean = false
  ): MatchHit | null {
    const plate = this.plateFor(cell, plateOccupied, plateEmpty)
    // Recognition recentres the foreground on its centroid to absorb sub-cell
    // misalignment. The grid scorer does not (recenter=false): its whole job
    // is to measure alignment, and recentring launders a misaligned cell's
    // borrowed fragment of a neighbour's icon into a clean match (measured on
    // 5.png — with recentring the scorer ranked a grid ~5px off above truth).
    const dy = recenter ? pyRound(CELL / 2 - info.cy) : 0
    const dx = recenter ? pyRound(CELL / 2 - info.cx) : 0
    const nfg = dy === 0 && dx === 0 ? info.n : countShiftedFg(info.fg, dy, dx)
    if (nfg < MIN_SHIFTED_FG) return null

    // Every variant is scored — there is no prefilter. The old multi-scale IoU
    // funnel at locked-window scales was the single largest error source (31
    // of 50 wrong cells, §9-G), and re-measuring it at each variant's own
    // deterministic scale still lost 40/140 truths at TOPK=96: fg
    // under-extraction on dark icons collapses the overlap ranking. The full
    // sweep costs ~0.15s per cell and is simply correct.
    // A null `slack` means per-variant: SLACK normally, LOWCONF_SLACK when the
    // catalog could only guess the sprite's k. The scorer passes an explicit
    // single-scale slack instead.
    const nv = this.variants.length

    // --- analysis-by-synthesis against the learned plate ---
    // Integer cell RGB + float64 D for the opaque majority; float packed buffers
    // remain for the blended minority (alpha composite is not integer).
    const C = packedCell
    const P = packedPlate
    const pack = cellPack
    const D = cellD
    const nuis = info.nuisance
    const nMasked = info.nMasked
    let dsum = 0
    D.fill(0, 0, VALID_FROM)
    for (let p = VALID_FROM; p < CELL_PX; p++) {
      const p3 = p * 3
      const p4 = p * 4
      const cr = cell[p3]
      const cg = cell[p3 + 1]
      const cb = cell[p3 + 2]
      const pr = plate[p3]
      const pg = plate[p3 + 1]
      const pb = plate[p3 + 2]
      C[p4] = cr
      C[p4 + 1] = cg
      C[p4 + 2] = cb
      P[p4] = pr
      P[p4 + 1] = pg
      P[p4 + 2] = pb
      if (nuis[p]) {
        pack[p] = 0
        C[p4 + 3] = 0
        D[p] = 0
        continue
      }
      pack[p] = cr | (cg << 8) | (cb << 16)
      const d = Math.abs(cr - pr) + Math.abs(cg - pg) + Math.abs(cb - pb)
      C[p4 + 3] = d
      D[p] = d
      dsum += d
    }
    const nValid = Math.max(N_VALID - nMasked, 1)
    const base = Math.max(dsum / nValid, 1e-6)

    const ccy = -dy
    const ccx = -dx
    let bestDelta = Infinity
    let bestVariant = -1
    const variants = this.variants
    const varDelta = this.varDelta
    if (collectTop) varDelta.fill(Infinity)

    for (let j = 0; j < nv; j++) {
      const baseScale = baseScales[j]
      const slk = slack ?? (variants[j].uncertain ? LOWCONF_SLACK : SLACK)
      let prevScale = -1
      for (let si = 0; si < slk.length; si++) {
        let s = baseScale + slk[si]
        if (s < MIN_SCALE) s = MIN_SCALE
        else if (s > MAX_SCALE) s = MAX_SCALE
        if (s === prevScale) continue // slack is ascending, so clamps dedup here
        prevScale = s
        const sp = this.spriteAt(j, s)
        const offO = sp.offO
        const rgbO = sp.rgbO
        const nO = offO.length
        const offB = sp.offB
        const apmB = sp.apmB
        const nB = offB.length
        const o = (CELL - s) >> 1
        for (let oi = 0; oi < offs.length; oi++) {
          const y0 = o + ccy + offs[oi]
          if (y0 < 0 || y0 + s > CELL) continue
          for (let oxi = 0; oxi < offs.length; oxi++) {
            const x0 = o + ccx + offs[oxi]
            if (x0 < 0 || x0 + s > CELL) continue
            const anchor = y0 * CELL + x0
            // Both offset lists are ascending, so pixels landing above the
            // valid region (composite error and D both 0 there) form a prefix
            // — binary search past it instead of branching on every pixel.
            const cut = VALID_FROM - anchor

            const k0 = cut > 0 ? lowerBoundInt32(offO, nO, cut) : 0
            let delta = nMasked
              ? opaqueDeltaNuis(anchor, k0, nO, offO, rgbO, pack, D, nuis)
              : opaqueDelta(anchor, k0, nO, offO, rgbO, pack, D)

            let kB = cut > 0 ? lowerBoundInt32(offB, nB, cut) : 0
            for (; kB < nB; kB++) {
              const p = anchor + offB[kB]
              if (nMasked && nuis[p]) continue
              const p4 = p * 4
              const k4 = kB * 4
              const a = apmB[k4]
              const dr = C[p4] - (P[p4] * a + apmB[k4 + 1])
              const dg = C[p4 + 1] - (P[p4 + 1] * a + apmB[k4 + 2])
              const db = C[p4 + 2] - (P[p4 + 2] * a + apmB[k4 + 3])
              delta +=
                (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db) - C[p4 + 3]
            }

            // score = 1 - (dsum+delta)/(nValid*base) is strictly decreasing in
            // delta (base > 0), so the argmax-score is the argmin-delta.
            if (delta < bestDelta) {
              bestDelta = delta
              bestVariant = j
            }
            if (collectTop && delta < varDelta[j]) varDelta[j] = delta
          }
        }
      }
    }

    if (bestVariant < 0) return null
    const bestScore = 1 - (dsum + bestDelta) / nValid / base
    const top: { variant: number; score: number }[] = []
    if (collectTop) {
      const nvTop = variants.length
      const taken = new Uint8Array(nvTop)
      const kMax = Math.min(EXACT_TOPK, nvTop)
      for (let t = 0; t < kMax; t++) {
        let bj = -1
        let bd = Infinity
        for (let j = 0; j < nvTop; j++) {
          if (taken[j] || varDelta[j] >= bd) continue
          bd = varDelta[j]
          bj = j
        }
        if (bj < 0 || bd === Infinity) break
        taken[bj] = 1
        top.push({ variant: bj, score: 1 - (dsum + bd) / nValid / base })
      }
    }
    return { variant: bestVariant, score: bestScore, gain: -bestDelta, top }
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
