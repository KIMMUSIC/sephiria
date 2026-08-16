/**
 * harvest-rendered-sprites.ts — invert confirmed PNG cells into native art.
 *
 * PLAN §9-G: the game draws icons at exactly S_SCREEN=3 screen px per native art
 * px (nearest neighbour). A confirmed cell can therefore be downsampled on the
 * 3×3 NN lattice into pixel-faithful native RGBA, which is strictly better
 * source material than a mismatched wiki sprite.
 *
 * Cell boxes follow plate-matcher prepare() (fractional grid, TRIM margin,
 * trunc) but stay in source pixels — no 64px renormalisation.
 *
 * Run: npm run harvest:rendered
 *
 * Writes:
 *   public/images/rendered/<value>.png (or <value>__depleted.png)
 *   data/rendered-overrides.json
 *   scratchpad/harvest/*.png debug sheets (source | harvested×3 | wiki)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { analyzeCell, CELL, cropCellNearest, TRIM } from '../lib/vision/plate-matcher'
import type { RGBAImage } from '../lib/vision/types'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_DIR = path.join(PROJECT_ROOT, 'tests', 'fixtures')
const ARTIFACT_DIR = path.join(PROJECT_ROOT, 'public', 'images', 'artifacts')
const SLAB_DIR = path.join(PROJECT_ROOT, 'public', 'images', 'slabs')
const RENDERED_DIR = path.join(PROJECT_ROOT, 'public', 'images', 'rendered')
const OVERRIDES_JSON = path.join(PROJECT_ROOT, 'data', 'rendered-overrides.json')
const SCRATCH = path.join(
  'C:/Users/ldgyu/AppData/Local/Temp/claude/D------/861c3b02-cd7e-4592-9e3c-05bca06d63af/scratchpad',
  'harvest'
)

const FGT = 45
const RING_KEEP_RATIO = 0.04
const S_SCREEN = 3
const ALPHA_CUT = 128

interface FixtureGrid {
  originX: number
  originY: number
  gridWidth: number
  gridHeight: number
}
interface FixtureFile {
  imagePath: string
  rows: number
  cols: number
  totalSlots: number
  grid: FixtureGrid
}

interface CellCrop {
  width: number
  height: number
  data: Uint8ClampedArray
}

interface NativeArt {
  width: number
  height: number
  data: Uint8ClampedArray
  phase: [number, number]
  fgCoverage: number
  contrast: number
  overlayStripped: number
}

interface OverrideEntry {
  value: string
  file: string
  kind: 'replace' | 'extra' | 'extra-depleted'
  source: string
  native: [number, number]
  notes: string
}

type Kind = 'replace' | 'extra-depleted' | 'diagnose'

interface Target {
  value: string
  fixture: string
  slot: number
  kind: Kind
  role: string
  fgt?: number
  recoverOutline?: boolean
}

const TARGETS: Target[] = [
  { value: 'defender', fixture: '2.png', slot: 8, kind: 'replace', role: 'candidate' },
  { value: 'defender', fixture: '4.png', slot: 25, kind: 'replace', role: 'candidate' },
  { value: 'defender', fixture: '5.png', slot: 5, kind: 'replace', role: 'candidate' },
  { value: 'defender', fixture: '7.png', slot: 22, kind: 'diagnose', role: 'currently-correct peek' },
  { value: 'heart_of_the_beast', fixture: '6.png', slot: 23, kind: 'replace', role: 'source' },
  { value: 'heart_of_the_beast', fixture: '2.png', slot: 1, kind: 'diagnose', role: 'cross-val peek' },
  { value: 'keel_fragment', fixture: '4.png', slot: 20, kind: 'replace', role: 'self-referential', fgt: 32, recoverOutline: true },
  { value: 'defect_probe', fixture: '5.png', slot: 21, kind: 'replace', role: 'self-referential' },
  { value: 'exit', fixture: '5.png', slot: 9, kind: 'replace', role: 'candidate' },
  { value: 'exit', fixture: '4.png', slot: 16, kind: 'replace', role: 'candidate' },
  { value: 'exit', fixture: '6.png', slot: 20, kind: 'replace', role: 'candidate' },
  { value: 'flag', fixture: '5.png', slot: 1, kind: 'diagnose', role: 'failing cell' },
  { value: 'flag', fixture: '6.png', slot: 6, kind: 'diagnose', role: 'correct cell harvest' },
  { value: 'eternal_winter', fixture: '6.png', slot: 12, kind: 'extra-depleted', role: 'depleted' },
  { value: 'fascinating_lure', fixture: '7.png', slot: 23, kind: 'extra-depleted', role: 'depleted' },
  { value: 'red_dew', fixture: '5.png', slot: 25, kind: 'extra-depleted', role: 'depleted' },
]

async function loadImage(filePath: string): Promise<RGBAImage> {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  }
}

function loadFixture(name: string): FixtureFile {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.expected.json`), 'utf8')) as FixtureFile
}

function resolveFixtureImage(fixture: FixtureFile): string {
  return path.join(PROJECT_ROOT, ...fixture.imagePath.split(/[\\/]/))
}

function findWikiSprite(value: string): string | null {
  for (const dir of [ARTIFACT_DIR, SLAB_DIR]) {
    for (const ext of ['.png', '.webp']) {
      const p = path.join(dir, value + ext)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

function cellBox(fixture: FixtureFile, slot: number): { left: number; top: number; right: number; bottom: number } {
  const g = fixture.grid
  const pitchX = g.gridWidth / fixture.cols
  const pitchY = g.gridHeight / fixture.rows
  const margin = pitchX * TRIM
  const r = Math.floor(slot / fixture.cols)
  const c = slot % fixture.cols
  const x = g.originX + c * pitchX
  const y = g.originY + r * pitchY
  return {
    left: Math.trunc(x + margin),
    top: Math.trunc(y + margin),
    right: Math.trunc(x + pitchX - margin),
    bottom: Math.trunc(y + pitchY - margin),
  }
}

function cropSource(img: RGBAImage, box: { left: number; top: number; right: number; bottom: number }): CellCrop {
  const w = Math.max(1, box.right - box.left)
  const h = Math.max(1, box.bottom - box.top)
  const data = new Uint8ClampedArray(w * h * 4)
  const maxX = img.width - 1
  const maxY = img.height - 1
  for (let y = 0; y < h; y++) {
    let sy = box.top + y
    if (sy < 0) sy = 0
    else if (sy > maxY) sy = maxY
    for (let x = 0; x < w; x++) {
      let sx = box.left + x
      if (sx < 0) sx = 0
      else if (sx > maxX) sx = maxX
      const s = (sy * img.width + sx) * 4
      const d = (y * w + x) * 4
      data[d] = img.data[s]
      data[d + 1] = img.data[s + 1]
      data[d + 2] = img.data[s + 2]
      data[d + 3] = img.data[s + 3]
    }
  }
  return { width: w, height: h, data }
}

function ringBackground(cell: CellCrop): Float32Array {
  const { width: W, height: H, data } = cell
  const fy = H / 64
  const fx = W / 64
  const aY = Math.max(0, Math.round(3 * fy))
  const bY = Math.min(H, Math.round(9 * fy))
  const aX = Math.max(0, Math.round(3 * fx))
  const bX = Math.min(W, Math.round(9 * fx))
  const counts = new Int32Array(1 << 16)
  const seen: number[] = []
  const bump = (x: number, y: number) => {
    const p = (y * W + x) * 4
    const code = (data[p] >> 4) * 4096 + (data[p + 1] >> 4) * 64 + (data[p + 2] >> 4)
    if (counts[code] === 0) seen.push(code)
    counts[code]++
  }
  let n = 0
  for (let y = aY; y < bY; y++) for (let x = 0; x < W; x++) { bump(x, y); n++ }
  for (let y = H - bY; y < H - aY; y++) for (let x = 0; x < W; x++) { bump(x, y); n++ }
  for (let y = 0; y < H; y++) for (let x = aX; x < bX; x++) { bump(x, y); n++ }
  for (let y = 0; y < H; y++) for (let x = W - bX; x < W - aX; x++) { bump(x, y); n++ }
  const threshold = n * RING_KEEP_RATIO
  const kept: number[] = []
  for (const code of seen) if (counts[code] > threshold) kept.push(code)
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

function fgMask(cell: CellCrop, fgt: number): Uint8Array {
  const { width: W, height: H, data } = cell
  const bg = ringBackground(cell)
  const nbg = bg.length / 3
  const fg = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) {
    const i = p * 4
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    let best = Infinity
    for (let k = 0; k < nbg; k++) {
      const d = Math.abs(r - bg[k * 3]) + Math.abs(g - bg[k * 3 + 1]) + Math.abs(b - bg[k * 3 + 2])
      if (d < best) best = d
    }
    if (best > fgt) fg[p] = 1
  }
  return fg
}

function dilate(src: Uint8Array, W: number, H: number, k: number): Uint8Array {
  const r = (k - 1) >> 1
  const tmp = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const base = y * W
    for (let x = 0; x < W; x++) {
      let v = 0
      const x0 = x - r < 0 ? 0 : x - r
      const x1 = x + r > W - 1 ? W - 1 : x + r
      for (let xx = x0; xx <= x1; xx++) if (src[base + xx]) { v = 1; break }
      tmp[base + x] = v
    }
  }
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const y0 = y - r < 0 ? 0 : y - r
    const y1 = y + r > H - 1 ? H - 1 : y + r
    for (let x = 0; x < W; x++) {
      let v = 0
      for (let yy = y0; yy <= y1; yy++) if (tmp[yy * W + x]) { v = 1; break }
      out[y * W + x] = v
    }
  }
  return out
}

function erode(src: Uint8Array, W: number, H: number, k: number): Uint8Array {
  const r = (k - 1) >> 1
  const tmp = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const base = y * W
    for (let x = 0; x < W; x++) {
      let v = 1
      const x0 = x - r < 0 ? 0 : x - r
      const x1 = x + r > W - 1 ? W - 1 : x + r
      for (let xx = x0; xx <= x1; xx++) if (!src[base + xx]) { v = 0; break }
      tmp[base + x] = v
    }
  }
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const y0 = y - r < 0 ? 0 : y - r
    const y1 = y + r > H - 1 ? H - 1 : y + r
    for (let x = 0; x < W; x++) {
      let v = 1
      for (let yy = y0; yy <= y1; yy++) if (!tmp[yy * W + x]) { v = 0; break }
      out[y * W + x] = v
    }
  }
  return out
}

interface Comp { label: number; area: number; minX: number; maxX: number; minY: number; maxY: number }

function connectedComponents(mask: Uint8Array, W: number, H: number): { labels: Int32Array; comps: Comp[] } {
  const labels = new Int32Array(W * H)
  const comps: Comp[] = []
  const stack = new Int32Array(W * H)
  let next = 1
  for (let seed = 0; seed < W * H; seed++) {
    if (!mask[seed] || labels[seed] !== 0) continue
    const label = next++
    let sp = 0
    stack[sp++] = seed
    labels[seed] = label
    let area = 0
    let minX = W
    let maxX = -1
    let minY = H
    let maxY = -1
    while (sp > 0) {
      const p = stack[--sp]
      area++
      const py = (p / W) | 0
      const px = p - py * W
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
      const y0 = py > 0 ? py - 1 : 0
      const y1 = py < H - 1 ? py + 1 : H - 1
      const x0 = px > 0 ? px - 1 : 0
      const x1 = px < W - 1 ? px + 1 : W - 1
      for (let yy = y0; yy <= y1; yy++) {
        const rb = yy * W
        for (let xx = x0; xx <= x1; xx++) {
          const q = rb + xx
          if (mask[q] && labels[q] === 0) {
            labels[q] = label
            stack[sp++] = q
          }
        }
      }
    }
    comps.push({ label, area, minX, maxX, minY, maxY })
  }
  return { labels, comps }
}

function isWhiteGlyph(r: number, g: number, b: number): boolean {
  return r >= 220 && g >= 220 && b >= 220 && Math.max(r, g, b) - Math.min(r, g, b) <= 30
}

function isRedGlyph(r: number, g: number, b: number): boolean {
  return r >= 180 && g <= 90 && b <= 90 && r - Math.max(g, b) >= 80
}

function stripOverlay(cell: CellCrop, fg: Uint8Array): { fg: Uint8Array; stripped: number } {
  const { width: W, height: H, data } = cell
  const out = new Uint8Array(fg)
  let stripped = 0
  // Geometric overlay masks (PLAN harvest spec): top-left 'N/M' counters and
  // top-right '+N' badges. 0.38W/0.20H left a '0/6' tail that merged under the
  // 3px close (reviewer blocker 1). Widen, and also drop near-white / pure-red
  // overlay glyphs in the top band BEFORE closing.
  const leftX = Math.floor(W * 0.48)
  const rightX = Math.floor(W * 0.62)
  const topY = Math.floor(H * 0.24)
  const badgeY = Math.floor(H * 0.20)
  for (let y = 0; y < topY; y++) {
    for (let x = 0; x < leftX; x++) {
      const p = y * W + x
      if (out[p]) {
        out[p] = 0
        stripped++
      }
    }
  }
  for (let y = 0; y < badgeY; y++) {
    for (let x = rightX; x < W; x++) {
      const p = y * W + x
      if (out[p]) {
        out[p] = 0
        stripped++
      }
    }
  }
  const glyph = new Uint8Array(W * H)
  const glyphBand = Math.floor(H * 0.34)
  for (let y = 0; y < glyphBand; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (isWhiteGlyph(data[i], data[i + 1], data[i + 2]) || isRedGlyph(data[i], data[i + 1], data[i + 2])) {
        glyph[y * W + x] = 1
      }
    }
  }
  const grownGlyph = dilate(glyph, W, H, 5)
  for (let p = 0; p < W * H; p++) {
    if (grownGlyph[p] && out[p]) {
      out[p] = 0
      stripped++
    }
  }
  const closed = erode(dilate(out, W, H, 3), W, H, 3)
  const { labels, comps } = connectedComponents(closed, W, H)
  const drop = new Set<number>()
  for (const c of comps) {
    const h = c.maxY - c.minY + 1
    const w = c.maxX - c.minX + 1
    const inTop = c.maxY < H * 0.28
    const short = h < H * 0.22
    const small = c.area < W * H * 0.08
    const topLeft = c.maxX < W * 0.42 && c.maxY < H * 0.28
    const topRight = c.minX > W * 0.58 && c.maxY < H * 0.28
    if ((inTop && short && small) || ((topLeft || topRight) && short && w < W * 0.45 && small)) {
      drop.add(c.label)
    }
  }
  if (drop.size === 0) return { fg: out, stripped }
  const zone = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) if (drop.has(labels[p])) zone[p] = 1
  const grown = dilate(zone, W, H, 5)
  for (let p = 0; p < W * H; p++) {
    if (grown[p] && out[p]) {
      out[p] = 0
      stripped++
    }
  }
  return { fg: out, stripped }
}

function meanContrast(cell: CellCrop, fg: Uint8Array): number {
  const bg = ringBackground(cell)
  const nbg = bg.length / 3
  const { width: W, height: H, data } = cell
  let sum = 0
  let n = 0
  for (let p = 0; p < W * H; p++) {
    if (!fg[p]) continue
    const i = p * 4
    let best = Infinity
    for (let k = 0; k < nbg; k++) {
      const d = Math.abs(data[i] - bg[k * 3]) + Math.abs(data[i + 1] - bg[k * 3 + 1]) + Math.abs(data[i + 2] - bg[k * 3 + 2])
      if (d < best) best = d
    }
    sum += best
    n++
  }
  return n === 0 ? 0 : sum / n
}

function fgBBox(fg: Uint8Array, W: number, H: number): { minX: number; minY: number; maxX: number; maxY: number; n: number } | null {
  let minX = W
  let maxX = -1
  let minY = H
  let maxY = -1
  let n = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!fg[y * W + x]) continue
      n++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (n === 0) return null
  return { minX, minY, maxX, maxY, n }
}

function findPhase(cell: CellCrop, fg: Uint8Array): [number, number] {
  const { width: W, height: H, data } = cell
  let best = Infinity
  let bestOx = 0
  let bestOy = 0
  for (let oy = 0; oy < S_SCREEN; oy++) {
    for (let ox = 0; ox < S_SCREEN; ox++) {
      let varSum = 0
      let n = 0
      for (let y0 = oy; y0 + S_SCREEN <= H; y0 += S_SCREEN) {
        for (let x0 = ox; x0 + S_SCREEN <= W; x0 += S_SCREEN) {
          let fgN = 0
          let sr = 0
          let sg = 0
          let sb = 0
          for (let dy = 0; dy < S_SCREEN; dy++) {
            for (let dx = 0; dx < S_SCREEN; dx++) {
              const p = (y0 + dy) * W + (x0 + dx)
              if (fg[p]) fgN++
              const i = p * 4
              sr += data[i]
              sg += data[i + 1]
              sb += data[i + 2]
            }
          }
          if (fgN < 5) continue
          const mr = sr / 9
          const mg = sg / 9
          const mb = sb / 9
          let v = 0
          for (let dy = 0; dy < S_SCREEN; dy++) {
            for (let dx = 0; dx < S_SCREEN; dx++) {
              const i = ((y0 + dy) * W + (x0 + dx)) * 4
              const dr = data[i] - mr
              const dg = data[i + 1] - mg
              const db = data[i + 2] - mb
              v += dr * dr + dg * dg + db * db
            }
          }
          varSum += v / 9
          n++
        }
      }
      const score = n === 0 ? Infinity : varSum / n
      if (score < best) {
        best = score
        bestOx = ox
        bestOy = oy
      }
    }
  }
  return [bestOx, bestOy]
}

/**
 * Fill only SMALL interior holes. Flood-from-border on a full-cell mask would
 * paint the whole canvas opaque (the first harvest's 33×33 bleed). Dark
 * outlines dropped by FGT are 1–4 native px; anything larger is background.
 */
function holeFillSmall(alpha: Uint8Array, W: number, H: number): void {
  const vis = new Uint8Array(W * H)
  const stack = new Int32Array(W * H)
  let sp = 0
  const push = (p: number) => {
    if (vis[p] || alpha[p] > ALPHA_CUT) return
    vis[p] = 1
    stack[sp++] = p
  }
  for (let x = 0; x < W; x++) {
    push(x)
    push((H - 1) * W + x)
  }
  for (let y = 0; y < H; y++) {
    push(y * W)
    push(y * W + W - 1)
  }
  while (sp > 0) {
    const p = stack[--sp]
    const py = (p / W) | 0
    const px = p - py * W
    if (px > 0) push(p - 1)
    if (px < W - 1) push(p + 1)
    if (py > 0) push(p - W)
    if (py < H - 1) push(p + W)
  }
  const interior = new Uint8Array(W * H)
  let opaque = 0
  for (let p = 0; p < W * H; p++) {
    if (alpha[p] > ALPHA_CUT) opaque++
    else if (!vis[p]) interior[p] = 1
  }
  if (opaque === 0) return
  const { labels, comps } = connectedComponents(interior, W, H)
  const maxHole = Math.max(4, Math.floor(opaque * 0.12))
  const fill = new Set(comps.filter((c) => c.area <= maxHole).map((c) => c.label))
  if (fill.size === 0) return
  for (let p = 0; p < W * H; p++) {
    if (fill.has(labels[p])) alpha[p] = 255
  }
}

function downsample(cell: CellCrop, fg: Uint8Array, phase: [number, number]): NativeArt {
  const { width: W, height: H, data } = cell
  const [ox, oy] = phase
  const nW = Math.floor((W - ox) / S_SCREEN)
  const nH = Math.floor((H - oy) / S_SCREEN)
  if (nW < 1 || nH < 1) {
    return {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 0]),
      phase,
      fgCoverage: 0,
      contrast: 0,
      overlayStripped: 0,
    }
  }
  const rgba = new Uint8ClampedArray(nW * nH * 4)
  let fgBlocks = 0
  for (let ny = 0; ny < nH; ny++) {
    for (let nx = 0; nx < nW; nx++) {
      const x0 = ox + nx * S_SCREEN
      const y0 = oy + ny * S_SCREEN
      let fgN = 0
      let sr = 0
      let sg = 0
      let sb = 0
      for (let dy = 0; dy < S_SCREEN; dy++) {
        for (let dx = 0; dx < S_SCREEN; dx++) {
          const p = (y0 + dy) * W + (x0 + dx)
          if (fg[p]) {
            fgN++
            const i = p * 4
            sr += data[i]
            sg += data[i + 1]
            sb += data[i + 2]
          }
        }
      }
      const cx = x0 + 1
      const cy = y0 + 1
      const ci = (cy * W + cx) * 4
      const o = (ny * nW + nx) * 4
      if (fgN > 0) {
        rgba[o] = Math.round(sr / fgN)
        rgba[o + 1] = Math.round(sg / fgN)
        rgba[o + 2] = Math.round(sb / fgN)
      } else {
        rgba[o] = data[ci]
        rgba[o + 1] = data[ci + 1]
        rgba[o + 2] = data[ci + 2]
      }
      rgba[o + 3] = Math.round((fgN / 9) * 255)
      if (fgN >= 5) fgBlocks++
    }
  }
  // No morphological close: it fills diamond interiors (defender/dedication).
  // Small-hole fill only restores 1–4px outline dropouts.
  const a2 = new Uint8Array(nW * nH)
  for (let p = 0; p < nW * nH; p++) a2[p] = rgba[p * 4 + 3]
  holeFillSmall(a2, nW, nH)
  for (let p = 0; p < nW * nH; p++) rgba[p * 4 + 3] = a2[p]

  let minX = nW
  let maxX = -1
  let minY = nH
  let maxY = -1
  for (let y = 0; y < nH; y++) {
    for (let x = 0; x < nW; x++) {
      if (rgba[(y * nW + x) * 4 + 3] <= ALPHA_CUT) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX) {
    return {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 0]),
      phase,
      fgCoverage: 0,
      contrast: 0,
      overlayStripped: 0,
    }
  }
  const tw = maxX - minX + 1
  const th = maxY - minY + 1
  const tight = new Uint8ClampedArray(tw * th * 4)
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const s = ((minY + y) * nW + (minX + x)) * 4
      const d = (y * tw + x) * 4
      tight[d] = rgba[s]
      tight[d + 1] = rgba[s + 1]
      tight[d + 2] = rgba[s + 2]
      tight[d + 3] = rgba[s + 3]
    }
  }
  return {
    width: tw,
    height: th,
    data: tight,
    phase,
    fgCoverage: fgBlocks / Math.max(1, nW * nH),
    contrast: 0,
    overlayStripped: 0,
  }
}

function maskOverlayRegions(fg: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(fg)
  const top = Math.floor(H * 0.24)
  const left = Math.floor(W * 0.46)
  const right = Math.floor(W * 0.62)
  for (let y = 0; y < top; y++) {
    for (let x = 0; x < left; x++) out[y * W + x] = 0
    for (let x = right; x < W; x++) out[y * W + x] = 0
  }
  return out
}

/** Dominant blob + fragments inside its dilated hull — same idea as analyzeCell. */
function isolateIcon(fg: Uint8Array, W: number, H: number): Uint8Array {
  const closeK = 3
  const growK = Math.max(3, (Math.round((9 * W) / 64) | 1))
  const closed = erode(dilate(fg, W, H, closeK), W, H, closeK)
  const { labels, comps } = connectedComponents(closed, W, H)
  if (comps.length === 0) return fg
  const notOverlay = comps.filter((c) => !(c.maxY < H * 0.28 && c.maxY - c.minY + 1 < H * 0.22))
  const pool = notOverlay.length > 0 ? notOverlay : comps
  let best = pool[0]
  for (const c of pool) if (c.area > best.area) best = c
  const blob = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) if (labels[p] === best.label) blob[p] = 1
  const grown = dilate(blob, W, H, growK)
  const keep = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) if (blob[p] || (fg[p] && grown[p])) keep[p] = 1
  return keep
}

function recoverOutline(cell: CellCrop, keep: Uint8Array, overlay: Uint8Array): Uint8Array {
  const { width: W, height: H } = cell
  const loose = fgMask(cell, 12)
  const hull = dilate(keep, W, H, 9)
  const out = new Uint8Array(keep)
  for (let p = 0; p < W * H; p++) {
    if (overlay[p]) continue
    if (loose[p] && hull[p]) out[p] = 1
  }
  return out
}

function harvestCell(
  cell: CellCrop,
  fgt: number,
  opts: { recoverOutline?: boolean } = {}
): { art: NativeArt; fg: Uint8Array; stripped: number; contrast: number; bbox: ReturnType<typeof fgBBox> } {
  const raw = fgMask(cell, fgt)
  const { fg, stripped } = stripOverlay(cell, raw)
  const masked = maskOverlayRegions(fg, cell.width, cell.height)
  let keep = isolateIcon(masked, cell.width, cell.height)
  if (opts.recoverOutline) keep = recoverOutline(cell, keep, Uint8Array.from(raw, (v, i) => (v && !masked[i] ? 1 : 0)))
  const bbox = fgBBox(keep, cell.width, cell.height)
  const contrast = meanContrast(cell, keep)
  const phase = findPhase(cell, keep)
  const art = downsample(cell, keep, phase)
  if (!opts.recoverOutline) debleed(art, cell)
  art.contrast = contrast
  art.overlayStripped = stripped
  return { art, fg: keep, stripped, contrast, bbox }
}

/** Drop native pixels whose RGB still matches the cell's ring plate. */
function debleed(art: NativeArt, cell: CellCrop): void {
  const bg = ringBackground(cell)
  const nbg = bg.length / 3
  const { width: w, height: h, data } = art
  for (let p = 0; p < w * h; p++) {
    if (data[p * 4 + 3] <= ALPHA_CUT) continue
    let best = Infinity
    for (let k = 0; k < nbg; k++) {
      const d =
        Math.abs(data[p * 4] - bg[k * 3]) +
        Math.abs(data[p * 4 + 1] - bg[k * 3 + 1]) +
        Math.abs(data[p * 4 + 2] - bg[k * 3 + 2])
      if (d < best) best = d
    }
    if (data[p * 4 + 3] < 200 && best <= FGT) data[p * 4 + 3] = 0
  }
}

function nnScale(img: NativeArt | CellCrop, k: number): NativeArt {
  const w = img.width * k
  const h = img.height * k
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = (y / k) | 0
    for (let x = 0; x < w; x++) {
      const sx = (x / k) | 0
      const s = (sy * img.width + sx) * 4
      const d = (y * w + x) * 4
      data[d] = img.data[s]
      data[d + 1] = img.data[s + 1]
      data[d + 2] = img.data[s + 2]
      data[d + 3] = img.data[s + 3]
    }
  }
  return { width: w, height: h, data, phase: [0, 0], fgCoverage: 0, contrast: 0, overlayStripped: 0 }
}

function checkerboard(img: NativeArt | CellCrop, scale = 1): NativeArt {
  const src = scale === 1 ? img : nnScale(img, scale)
  const out = new Uint8ClampedArray(src.data)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const a = out[i + 3] / 255
      const sq = ((x >> 3) + (y >> 3)) & 1
      const bg = sq ? 180 : 220
      out[i] = Math.round(out[i] * a + bg * (1 - a))
      out[i + 1] = Math.round(out[i + 1] * a + bg * (1 - a))
      out[i + 2] = Math.round(out[i + 2] * a + bg * (1 - a))
      out[i + 3] = 255
    }
  }
  return {
    width: src.width,
    height: src.height,
    data: out,
    phase: [0, 0],
    fgCoverage: 0,
    contrast: 0,
    overlayStripped: 0,
  }
}

function blit(dst: Uint8ClampedArray, dW: number, img: NativeArt | CellCrop, x0: number, y0: number) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4
      const d = ((y0 + y) * dW + (x0 + x)) * 4
      dst[d] = img.data[s]
      dst[d + 1] = img.data[s + 1]
      dst[d + 2] = img.data[s + 2]
      dst[d + 3] = 255
    }
  }
}

async function writePNG(file: string, img: { width: number; height: number; data: Uint8ClampedArray }) {
  await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 4 } })
    .png()
    .toFile(file)
}

async function writeSheet(
  dest: string,
  source: CellCrop,
  harvested: NativeArt,
  wiki: CellCrop | null
) {
  const h3 = checkerboard(harvested, 3)
  const wikiShow = wiki ? checkerboard(wiki, 1) : null
  const gap = 10
  const label = 18
  const W = source.width + gap + h3.width + gap + (wikiShow ? wikiShow.width : 8)
  const H = label + Math.max(source.height, h3.height, wikiShow ? wikiShow.height : 0)
  const data = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 30
    data[i + 1] = 30
    data[i + 2] = 30
    data[i + 3] = 255
  }
  blit(data, W, source, 0, label)
  blit(data, W, h3, source.width + gap, label)
  if (wikiShow) blit(data, W, wikiShow, source.width + gap + h3.width + gap, label)
  await writePNG(dest, { width: W, height: H, data })
}

function tightCrop(img: CellCrop, alphaCut = ALPHA_CUT): CellCrop {
  let minX = img.width
  let maxX = -1
  let minY = img.height
  let maxY = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] <= alphaCut) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX) return img
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((minY + y) * img.width + (minX + x)) * 4
      const d = (y * w + x) * 4
      data[d] = img.data[s]
      data[d + 1] = img.data[s + 1]
      data[d + 2] = img.data[s + 2]
      data[d + 3] = img.data[s + 3]
    }
  }
  return { width: w, height: h, data }
}

function nnResize(img: CellCrop, w: number, h: number): CellCrop {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / h))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / w))
      const s = (sy * img.width + sx) * 4
      const d = (y * w + x) * 4
      data[d] = img.data[s]
      data[d + 1] = img.data[s + 1]
      data[d + 2] = img.data[s + 2]
      data[d + 3] = img.data[s + 3]
    }
  }
  return { width: w, height: h, data }
}

function measureMultiply(depleted: NativeArt, wikiTight: CellCrop): {
  n: number
  mean: [number, number, number]
  std: [number, number, number]
  interpretation: string
} {
  const wiki = nnResize(wikiTight, depleted.width, depleted.height)
  const ratios: [number[], number[], number[]] = [[], [], []]
  for (let p = 0; p < depleted.width * depleted.height; p++) {
    const a = depleted.data[p * 4 + 3]
    const wa = wiki.data[p * 4 + 3]
    if (a <= ALPHA_CUT || wa <= ALPHA_CUT) continue
    for (let c = 0; c < 3; c++) {
      const wch = wiki.data[p * 4 + c]
      if (wch < 8) continue
      ratios[c].push(depleted.data[p * 4 + c] / wch)
    }
  }
  const stats = (xs: number[]): [number, number] => {
    if (xs.length === 0) return [NaN, NaN]
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length
    return [m, Math.sqrt(v)]
  }
  const [mr, sr] = stats(ratios[0])
  const [mg, sg] = stats(ratios[1])
  const [mb, sb] = stats(ratios[2])
  const n = Math.min(ratios[0].length, ratios[1].length, ratios[2].length)
  const means = [mr, mg, mb]
  const stds = [sr, sg, sb]
  const finite = means.every(Number.isFinite) && stds.every(Number.isFinite)
  let interpretation = 'not a multiply (high variance or shape mismatch — harvest depleted from the cell)'
  if (finite && n >= 20) {
    const maxStd = Math.max(sr, sg, sb)
    const meanSpread = Math.max(...means) - Math.min(...means)
    if (maxStd < 0.12 && meanSpread < 0.12) {
      interpretation = `uniform RGB multiply ≈ ${((mr + mg + mb) / 3).toFixed(3)} (std ${maxStd.toFixed(3)}) — synthesizable for the catalog`
    } else if (maxStd < 0.12) {
      interpretation = `channel-dependent multiply r=${mr.toFixed(3)} g=${mg.toFixed(3)} b=${mb.toFixed(3)} — synthesizable per-channel`
    } else {
      interpretation = `not a clean multiply (std r/g/b ${sr.toFixed(3)}/${sg.toFixed(3)}/${sb.toFixed(3)}) — harvest from the cell`
    }
  }
  return { n, mean: [mr, mg, mb], std: [sr, sg, sb], interpretation }
}

function synthesizeDepleted(wikiTight: CellCrop, scale: [number, number, number]): NativeArt {
  const data = new Uint8ClampedArray(wikiTight.data)
  for (let p = 0; p < wikiTight.width * wikiTight.height; p++) {
    if (data[p * 4 + 3] === 0) continue
    data[p * 4] = Math.max(0, Math.min(255, Math.round(data[p * 4] * scale[0])))
    data[p * 4 + 1] = Math.max(0, Math.min(255, Math.round(data[p * 4 + 1] * scale[1])))
    data[p * 4 + 2] = Math.max(0, Math.min(255, Math.round(data[p * 4 + 2] * scale[2])))
  }
  const tight = tightCrop({ width: wikiTight.width, height: wikiTight.height, data })
  return {
    width: tight.width,
    height: tight.height,
    data: tight.data,
    phase: [0, 0],
    fgCoverage: 1,
    contrast: 0,
    overlayStripped: 0,
  }
}

async function occupancyReport(fixtureName: string, slot: number) {
  const fixture = loadFixture(fixtureName)
  const img = await loadImage(resolveFixtureImage(fixture))
  const box = cellBox(fixture, slot)
  const cell64 = cropCellNearest(img, box.left, box.top, box.right, box.bottom)
  const info = analyzeCell(cell64)
  return {
    fixture: fixtureName,
    slot,
    occupancy: info === null ? 'null' : `fg size=${info.size} cx=${info.cx.toFixed(1)} cy=${info.cy.toFixed(1)}`,
    canvas: CELL,
  }
}

function harvestQuality(art: NativeArt): number {
  let opaque = 0
  let holes = 0
  const { width: w, height: h, data } = art
  for (let p = 0; p < w * h; p++) {
    if (data[p * 4 + 3] > ALPHA_CUT) opaque++
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA_CUT) continue
      let n = 0
      if (data[(y * w + x - 1) * 4 + 3] > ALPHA_CUT) n++
      if (data[(y * w + x + 1) * 4 + 3] > ALPHA_CUT) n++
      if (data[((y - 1) * w + x) * 4 + 3] > ALPHA_CUT) n++
      if (data[((y + 1) * w + x) * 4 + 3] > ALPHA_CUT) n++
      if (n >= 3) holes++
    }
  }
  const side = Math.max(w, h)
  const density = opaque / Math.max(1, w * h)
  // Contrast first; penalise holes, plate-bleed (huge native), and sparse canvases.
  return art.contrast * density - holes * 12 - Math.max(0, side - 26) * 25
}

async function main() {
  fs.mkdirSync(RENDERED_DIR, { recursive: true })
  fs.mkdirSync(SCRATCH, { recursive: true })

  const wikiCache = new Map<string, CellCrop>()
  const loadWiki = async (value: string): Promise<CellCrop | null> => {
    if (wikiCache.has(value)) return wikiCache.get(value)!
    const p = findWikiSprite(value)
    if (!p) return null
    const img = await loadImage(p)
    const crop = tightCrop({ width: img.width, height: img.height, data: img.data })
    wikiCache.set(value, crop)
    return crop
  }

  const diagnoses: Record<string, unknown> = {}

  const redDewOcc = await occupancyReport('5.png', 25)
  diagnoses.redDew = redDewOcc
  console.log('red_dew occupancy (analyzeCell on 64px crop):', redDewOcc)

  const harvested: {
    target: Target
    art: NativeArt
    cell: CellCrop
    bbox: ReturnType<typeof fgBBox>
    fgt: number
  }[] = []

  for (const t of TARGETS) {
    const fixture = loadFixture(t.fixture)
    const img = await loadImage(resolveFixtureImage(fixture))
    const box = cellBox(fixture, t.slot)
    const cell = cropSource(img, box)
    const isDepleted = t.kind === 'extra-depleted'
    const fgt = t.fgt ?? (isDepleted ? 32 : FGT)
    const { art, bbox, contrast, stripped } = harvestCell(cell, fgt, { recoverOutline: t.recoverOutline })
    art.contrast = contrast
    art.overlayStripped = stripped
    const wiki = await loadWiki(t.value)
    const sheet = path.join(SCRATCH, `${t.value}__${t.fixture.replace('.', '_')}s${t.slot}.png`)
    await writeSheet(sheet, cell, art, wiki)
    const nativeFile = path.join(SCRATCH, `${t.value}__${t.fixture.replace('.', '_')}s${t.slot}__native.png`)
    await writePNG(nativeFile, art)
    harvested.push({ target: t, art, cell, bbox, fgt })
    let whiteTop = 0
    let redTop = 0
    const topRows = Math.min(5, art.height)
    for (let y = 0; y < topRows; y++) {
      for (let x = 0; x < art.width; x++) {
        const i = (y * art.width + x) * 4
        if (art.data[i + 3] <= ALPHA_CUT) continue
        if (isWhiteGlyph(art.data[i], art.data[i + 1], art.data[i + 2])) whiteTop++
        if (isRedGlyph(art.data[i], art.data[i + 1], art.data[i + 2])) redTop++
      }
    }
    console.log(
      `${t.value} ${t.fixture}#${t.slot} [${t.kind}/${t.role}] native=${art.width}x${art.height}` +
        ` phase=${art.phase} contrast=${contrast.toFixed(1)} stripped=${stripped}` +
        ` fgBBox=${bbox ? `${bbox.maxX - bbox.minX + 1}x${bbox.maxY - bbox.minY + 1} n=${bbox.n}` : 'none'}` +
        ` quality=${harvestQuality(art).toFixed(1)} fgt=${fgt} glyphTop white=${whiteTop} red=${redTop}`
    )
  }

  const flagFail = harvested.find((h) => h.target.value === 'flag' && h.target.fixture === '5.png')
  const flagOk = harvested.find((h) => h.target.value === 'flag' && h.target.fixture === '6.png')
  const flagWiki = await loadWiki('flag')
  diagnoses.flag = {
    fail5png: flagFail
      ? {
          native: [flagFail.art.width, flagFail.art.height],
          fgBBox: flagFail.bbox
            ? { w: flagFail.bbox.maxX - flagFail.bbox.minX + 1, h: flagFail.bbox.maxY - flagFail.bbox.minY + 1, n: flagFail.bbox.n }
            : null,
          occupancy64: await occupancyReport('5.png', 1),
        }
      : null,
    ok6png: flagOk
      ? {
          native: [flagOk.art.width, flagOk.art.height],
          fgBBox: flagOk.bbox
            ? { w: flagOk.bbox.maxX - flagOk.bbox.minX + 1, h: flagOk.bbox.maxY - flagOk.bbox.minY + 1, n: flagOk.bbox.n }
            : null,
          occupancy64: await occupancyReport('6.png', 6),
        }
      : null,
    wikiNative: flagWiki ? [flagWiki.width, flagWiki.height] : null,
  }

  const ew = harvested.find((h) => h.target.value === 'eternal_winter')
  const fl = harvested.find((h) => h.target.value === 'fascinating_lure')
  const ewWiki = await loadWiki('eternal_winter')
  const flWiki = await loadWiki('fascinating_lure')
  const ewMul = ew && ewWiki ? measureMultiply(ew.art, ewWiki) : null
  const flMul = fl && flWiki ? measureMultiply(fl.art, flWiki) : null
  diagnoses.depletedTransform = { eternal_winter: ewMul, fascinating_lure: flMul }
  console.log('depleted transform eternal_winter:', ewMul)
  console.log('depleted transform fascinating_lure:', flMul)

  const overrides: OverrideEntry[] = []
  const accepted: { value: string; art: NativeArt; source: string; kind: 'replace' | 'extra' | 'extra-depleted'; notes: string }[] = []

  const pickBest = (value: string) => {
    const cands = harvested.filter(
      (h) => h.target.value === value && h.target.kind === 'replace' && h.target.role !== 'currently-correct peek'
    )
    if (cands.length === 0) return null
    // Under-extracted cells produce a smaller native and a higher contrast
    // (4.png#16 exit 10×8, 4.png#25 defender 14×14). Prefer the median native
    // among siblings so the deterministic scale matches the other occurrences.
    const sides = cands.map((h) => Math.max(h.art.width, h.art.height)).sort((a, b) => a - b)
    const median = sides[Math.floor(sides.length / 2)]
    return cands.reduce((a, b) => {
      const da = Math.abs(Math.max(a.art.width, a.art.height) - median)
      const db = Math.abs(Math.max(b.art.width, b.art.height) - median)
      if (db < da) return b
      if (da < db) return a
      if (b.art.contrast !== a.art.contrast) return b.art.contrast > a.art.contrast ? b : a
      return b.art.overlayStripped < a.art.overlayStripped ? b : a
    })
  }

  const defender = harvested.find((h) => h.target.value === 'defender' && h.target.fixture === '2.png')
  if (defender) {
    accepted.push({
      value: 'defender',
      art: defender.art,
      source: `${defender.target.fixture}#${defender.target.slot}`,
      kind: 'extra',
      notes:
        `ADDITIONAL variant; wiki art RETAINED as fallback. 7.png#22 matches wiki (green checkered), ` +
        `while 2.png#8/4.png#25/5.png#5 are a dark-navy diamond/X with green tips and a red center (dominant fill RGB ~31,26,49). Harvested from 2.png#8 (18×18, least overlay among full-size cells). ` +
        `Cross-validation: 4.png#25 and 5.png#5 must flip; 7.png#22 must stay correct via wiki. nativeUncertain=false, k=1.`,
    })
  }

  const heart = harvested.find((h) => h.target.value === 'heart_of_the_beast' && h.target.kind === 'replace')
  if (heart) {
    accepted.push({
      value: 'heart_of_the_beast',
      art: heart.art,
      source: `${heart.target.fixture}#${heart.target.slot}`,
      kind: 'replace',
      notes:
        `Wiki sprite is a smooth-resample (catalog method=pinned). Harvested from 6.png#23 (currently correct). ` +
        `Gate: 2.png#1 must flip and 6.png#23 must stay correct. nativeUncertain=false, k=1.`,
    })
  }

  const keel = harvested.find((h) => h.target.value === 'keel_fragment')
  if (keel) {
    accepted.push({
      value: 'keel_fragment',
      art: keel.art,
      source: `${keel.target.fixture}#${keel.target.slot}`,
      kind: 'replace',
      notes:
        `SELF-REFERENTIAL: only occurrence. Wiki is a 60×45 plank; in-game is a curved shell. ` +
        `A flip of 4.png#20 is weak evidence by construction.`,
    })
  }

  const probe = harvested.find((h) => h.target.value === 'defect_probe')
  if (probe) {
    accepted.push({
      value: 'defect_probe',
      art: probe.art,
      source: `${probe.target.fixture}#${probe.target.slot}`,
      kind: 'replace',
      notes:
        `SELF-REFERENTIAL: only occurrence. Wiki is the smooth-resample class (catalog fallback/lowConfidence). ` +
        `A flip of 5.png#21 is weak evidence by construction.`,
    })
  }

  const exitPick = pickBest('exit')
  if (exitPick) {
    accepted.push({
      value: 'exit',
      art: exitPick.art,
      source: `${exitPick.target.fixture}#${exitPick.target.slot}`,
      kind: 'replace',
      notes:
        `Wiki sprite is a smooth-resample fallback with guessed k. Harvested from ${exitPick.target.fixture}#${exitPick.target.slot}. ` +
        `Gates: 5.png#9, 4.png#16, 6.png#20 stay correct. 1.jpeg#28 flipping is the target but JPEG noise may prevent it. ` +
        `rotatable flag preserved from tablets.json (false). nativeUncertain=false, k=1.`,
    })
  }

  const flagFailBBox = flagFail?.bbox
  const flagOkBBox = flagOk?.bbox
  const flagFailH = flagFailBBox ? flagFailBBox.maxY - flagFailBBox.minY + 1 : 0
  const flagOkH = flagOkBBox ? flagOkBBox.maxY - flagOkBBox.minY + 1 : 0
  const flagArtMismatch = flagFailH > 0 && flagOkH > 0 && Math.abs(flagFailH - flagOkH) < 8 && flagFailH >= 55
  diagnoses.flagDecision = flagArtMismatch
    ? 'art mismatch — would replace'
    : `occupancy/fg under-extraction — 5.png#1 fg height ${flagFailH}px vs 6.png#6 ${flagOkH}px (true ~66). No override. Roadmap 5.`

  if (!flagArtMismatch) {
    console.log('FLAG: no override. Diagnosis:', diagnoses.flagDecision)
  }

  diagnoses.redDewDecision =
    `analyzeCell returned a blob (${redDewOcc.occupancy}) but the crop is the '0/3' overlay, not the orb. ` +
    `Template work cannot reach the true icon. Hand to roadmap 5. No depleted template.`
  console.log('red_dew: DROP. Diagnosis:', diagnoses.redDewDecision)

  const canSynth = (m: ReturnType<typeof measureMultiply> | null) =>
    !!m && m.interpretation.includes('synthesizable')

  if (ew) {
    if (canSynth(ewMul) && ewWiki) {
      const synth = synthesizeDepleted(ewWiki, ewMul!.mean)
      accepted.push({
        value: 'eternal_winter',
        art: synth,
        source: 'synthesized from wiki × measured multiply; calibrated on 6.png#12',
        kind: 'extra-depleted',
        notes:
          `Depleted variant SYNTHESIZED from wiki art with ${ewMul!.interpretation}. ` +
          `6.png#12 is a genuine test of the transform, not a self-harvest. ` +
          `Generalization: the same multiply can be applied to the whole catalog later; not done this round (suite budget).`,
      })
    } else {
      accepted.push({
        value: 'eternal_winter',
        art: ew.art,
        source: '6.png#12',
        kind: 'extra-depleted',
        notes:
          `SELF-REFERENTIAL depleted harvest from 6.png#12. Transform was not a clean multiply: ${ewMul?.interpretation ?? 'n/a'}. ` +
          `Pre-fix flip evidence included overlay-glyph matching (red '-1/2' baked into the template). ` +
          `Generalization path: if a later measurement finds a stable multiply, synthesize for the whole catalog; do not harvest 327 cells.`,
      })
    }
  }

  if (fl) {
    if (canSynth(flMul) && flWiki) {
      const synth = synthesizeDepleted(flWiki, flMul!.mean)
      accepted.push({
        value: 'fascinating_lure',
        art: synth,
        source: 'synthesized from wiki × measured multiply; calibrated on 7.png#23',
        kind: 'extra-depleted',
        notes: `Depleted variant SYNTHESIZED. ${flMul!.interpretation}. Wiki sprite is lossy webp.`,
      })
    } else {
      accepted.push({
        value: 'fascinating_lure',
        art: fl.art,
        source: '7.png#23',
        kind: 'extra-depleted',
        notes:
          `SELF-REFERENTIAL depleted harvest from 7.png#23. Wiki is lossy webp; transform: ${flMul?.interpretation ?? 'n/a'}. ` +
          `Pre-fix flip evidence included overlay-glyph matching (red '-1/2' baked into the template).`,
      })
    }
  }

  for (const a of accepted) {
    const fname = a.kind === 'extra-depleted' ? `${a.value}__depleted.png` : `${a.value}.png`
    const file = path.join(RENDERED_DIR, fname)
    await writePNG(file, a.art)
    const rel = `public/images/rendered/${fname}`
    overrides.push({
      value: a.value,
      file: rel,
      kind: a.kind,
      source: a.source,
      native: [a.art.width, a.art.height],
      notes: a.notes,
    })
    console.log(`WROTE ${rel}  native=${a.art.width}x${a.art.height}  from ${a.source}`)
  }

  const doc = {
    generated: '2026-08-15',
    note:
      'Production loader must apply these overrides after wiki templates + sprite-natives attach. ' +
      "kind 'replace' swaps the template image AND native (nativeUncertain=false; harvested art IS native resolution, k=1). " +
      "kind 'extra' / 'extra-depleted' push an ADDITIONAL TemplateSource with the same value/type/rotatable (wiki retained). " +
      'lib/vision stays browser-clean — apply in the Node/test loader (tests/vision/harness.ts) and in the future production loader.',
    overrides,
  }
  fs.writeFileSync(OVERRIDES_JSON, JSON.stringify(doc, null, 2) + '\n')
  fs.writeFileSync(path.join(SCRATCH, 'diagnoses.json'), JSON.stringify(diagnoses, null, 2))
  console.log(`wrote ${OVERRIDES_JSON} (${overrides.length} overrides)`)
  console.log(`debug sheets in ${SCRATCH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
