/**
 * build-sprite-natives.ts — offline per-sprite native-size catalog builder.
 *
 * Implements the phase-free lattice fit validated in PLAN/06-Recognition-Rebuild.md §9-G:
 * wiki sprites are NN upscales of native pixel art by a per-sprite RATIONAL factor k.
 * For each sprite we collect the positions where adjacent fully-opaque pixel columns
 * (and rows) differ in RGB, fit those change positions c_i = o + m_i*p by greedy
 * multi-block integer assignment + least squares, and accept when the residual span
 * is < 1.0 on BOTH axes and |p_x - p_y| < 0.05. Then nativeSize = alphaBbox / k.
 *
 * Template enumeration mirrors tests/vision/harness.ts loadAllTemplates() exactly:
 * every file in public/images/artifacts (ARTIFACT) and public/images/slabs (TABLET),
 * value = basename without extension.
 *
 * Output: data/sprite-natives.json
 * Run:    npm run build:sprite-natives   (npx tsx scripts/build-sprite-natives.ts)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACT_DIR = path.join(PROJECT_ROOT, 'public', 'images', 'artifacts')
const SLAB_DIR = path.join(PROJECT_ROOT, 'public', 'images', 'slabs')
const OUT_FILE = path.join(PROJECT_ROOT, 'data', 'sprite-natives.json')

// ---------------------------------------------------------------------------
// §9-G pins: smooth-resampled sprites whose k is unrecoverable from the sprite
// itself. nativeMax was measured on screenshots (renderedBbox / S_SCREEN=3).
const PINS: Record<string, number> = {
  heart_of_the_beast: 15, // ARTIFACT
  storm: 16, // ARTIFACT (storm.webp)
}

// §9-G catalog mismatches: wiki art differs from the in-game rendering.
const ART_MISMATCH = new Set(['defender', 'keel_fragment'])

// Validation anchors (§9-G / task brief). Tolerance: k ±0.06, nativeMax ±1.
const ANCHORS: { value: string; k: number; nativeMax: number }[] = [
  { value: 'ruby_brooch', k: 2.45, nativeMax: 20 },
  { value: 'warrant', k: 3.0, nativeMax: 21 },
  { value: 'vow', k: 3.0, nativeMax: 21 },
  { value: 'shade', k: 3.0, nativeMax: 21 },
  { value: 'black_scales', k: 2.5, nativeMax: 25 },
  { value: 'compression', k: 2.5, nativeMax: 16 },
  { value: 'humility_crown', k: 2.5, nativeMax: 20 },
  { value: 'unclean_bandage', k: 2.5, nativeMax: 24 },
  { value: 'walter_work_monocle', k: 2.5, nativeMax: 24 },
  { value: 'sheet_music_storm', k: 2.45, nativeMax: 19 },
  { value: 'flux_mk2', k: 2.45, nativeMax: 21 },
  { value: 'ice_wings', k: 2.5, nativeMax: 24 },
  { value: 'touch_of_life', k: 2.5, nativeMax: 24 },
  { value: 'begonia_flavor_pocket', k: 2.5, nativeMax: 19 },
]

// ---------------------------------------------------------------------------

interface RGBAImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

interface SpriteEntry {
  file: string
  canvas: [number, number]
  bbox: [number, number]
  k: number
  kResidual: number | null
  native: [number, number]
  method: 'lattice' | 'fallback' | 'pinned'
  lowConfidence?: true
  artMismatch?: true
}

interface FitResult {
  p: number
  span: number
}

async function loadRGBA(filePath: string): Promise<RGBAImage> {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.channels !== 4 || data.length !== info.width * info.height * 4) {
    throw new Error(
      `${filePath}: unexpected raw output (channels=${info.channels}, bytes=${data.length}, ` +
        `expected ${info.width * info.height * 4}) — not RGBA8`
    )
  }
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  }
}

/**
 * Change positions along one axis: indices x such that some pixel pair
 * (x, x+1) — with BOTH pixels fully opaque (alpha === 255), and at least
 * MIN_SHARED such pairs in the column — differs in RGB.
 * axis 'x' compares adjacent columns, axis 'y' adjacent rows.
 * Mirrors sprite_k() in .omc/research/.../scale-verify/measure.py.
 */
function changePositions(img: RGBAImage, axis: 'x' | 'y'): number[] {
  const MIN_SHARED = 3
  const { width: w, height: h, data } = img
  const outer = axis === 'x' ? w : h
  const inner = axis === 'x' ? h : w
  const positions: number[] = []
  for (let x = 0; x < outer - 1; x++) {
    let shared = 0
    let changed = false
    for (let i = 0; i < inner; i++) {
      const idxA = axis === 'x' ? (i * w + x) * 4 : (x * w + i) * 4
      const idxB = axis === 'x' ? (i * w + x + 1) * 4 : ((x + 1) * w + i) * 4
      if (data[idxA + 3] !== 255 || data[idxB + 3] !== 255) continue
      shared++
      if (
        data[idxA] !== data[idxB] ||
        data[idxA + 1] !== data[idxB + 1] ||
        data[idxA + 2] !== data[idxB + 2]
      ) {
        changed = true
      }
    }
    if (shared >= MIN_SHARED && changed) positions.push(x)
  }
  return positions
}

/**
 * Greedy multi-block integer assignment for a candidate pitch p:
 * m_0 = 0, m_i = m_{i-1} + max(1, round((c_i - c_{i-1}) / p)).
 */
function assignBlocks(c: number[], p: number): number[] {
  const m = new Array<number>(c.length)
  m[0] = 0
  for (let i = 1; i < c.length; i++) {
    m[i] = m[i - 1] + Math.max(1, Math.round((c[i] - c[i - 1]) / p))
  }
  return m
}

/** Least-squares fit of c_i ≈ o + m_i * p. Returns refined p, or null if degenerate. */
function lstsqPitch(c: number[], m: number[]): number | null {
  const n = c.length
  let sm = 0
  let sc = 0
  let smm = 0
  let smc = 0
  for (let i = 0; i < n; i++) {
    sm += m[i]
    sc += c[i]
    smm += m[i] * m[i]
    smc += m[i] * c[i]
  }
  const det = n * smm - sm * sm
  if (det === 0) return null
  return (n * smc - sm * sc) / det
}

function residualSpan(c: number[], m: number[], p: number): number {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < c.length; i++) {
    const r = c[i] - m[i] * p
    if (r < lo) lo = r
    if (r > hi) hi = r
  }
  return hi - lo
}

/**
 * Phase-free rational pitch fit (PLAN 06 §9-G): scan candidate pitches, refine
 * each by alternating greedy assignment and least squares, keep the fit with
 * the minimal residual span. The pitch is constrained to [1.8, 4.01] exactly
 * like the validated fitter (fit_pitch in scale-verify/measure.py): because the
 * change positions are integer-rounded, sub-lattice harmonics such as k*2/3
 * (2.5 -> 1.667) and k/2 (3.0 -> 1.5) fit with SMALLER residual span than the
 * true k, so any refined pitch that escapes the window must be rejected — not
 * merely clamped — or every 2.5 sprite reports 1.667.
 */
const P_MIN = 1.8
const P_MAX = 4.01

function fitPitch(positions: number[]): FitResult | null {
  if (positions.length < 4) return null
  const c = positions.slice().sort((a, b) => a - b)
  let best: FitResult | null = null
  for (let p0 = P_MIN; p0 <= P_MAX + 1e-9; p0 += 0.01) {
    let p = p0
    let m = assignBlocks(c, p)
    let ok = true
    for (let iter = 0; iter < 4; iter++) {
      m = assignBlocks(c, p)
      const refined = lstsqPitch(c, m)
      if (refined === null || refined <= 1.05) {
        ok = false
        break
      }
      p = refined
    }
    if (!ok || p < P_MIN || p > P_MAX) continue
    const span = residualSpan(c, m, p)
    if (best === null || span < best.span) best = { p, span }
  }
  return best
}

function alphaBbox(img: RGBAImage): { w: number; h: number } | null {
  const { width, height, data } = img
  let x0 = width
  let x1 = -1
  let y0 = height
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

// ---------------------------------------------------------------------------

interface TemplateFile {
  value: string
  type: 'ARTIFACT' | 'TABLET'
  absPath: string
  relPath: string
}

/** Enumerate templates exactly as tests/vision/harness.ts loadAllTemplates() does. */
function enumerateTemplates(): TemplateFile[] {
  const entries: { dir: string; rel: string; file: string; type: 'ARTIFACT' | 'TABLET' }[] = [
    ...fs.readdirSync(ARTIFACT_DIR).map((file) => ({
      dir: ARTIFACT_DIR,
      rel: 'public/images/artifacts',
      file,
      type: 'ARTIFACT' as const,
    })),
    ...fs.readdirSync(SLAB_DIR).map((file) => ({
      dir: SLAB_DIR,
      rel: 'public/images/slabs',
      file,
      type: 'TABLET' as const,
    })),
  ]
  return entries.map((e) => ({
    value: path.basename(e.file, path.extname(e.file)),
    type: e.type,
    absPath: path.join(e.dir, e.file),
    relPath: `${e.rel}/${e.file}`,
  }))
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000
}

async function main(): Promise<void> {
  const templates = enumerateTemplates()

  // Collision handling: if a value appears in both sets, key as "<TYPE>:<value>".
  const valueCounts = new Map<string, number>()
  for (const t of templates) valueCounts.set(t.value, (valueCounts.get(t.value) ?? 0) + 1)
  const collisions = Array.from(valueCounts.entries())
    .filter(([, n]) => n > 1)
    .map(([v]) => v)

  const sprites: Record<string, SpriteEntry> = {}
  const anomalies: string[] = []
  const fallbackList: string[] = []
  const axisDisagreements: string[] = []
  const methodCounts = { lattice: 0, fallback: 0, pinned: 0 }
  const kHistogram = new Map<string, number>()

  for (const v of collisions) {
    anomalies.push(`value collision across sets: "${v}" — keyed as "<TYPE>:${v}"`)
  }

  for (const t of templates) {
    const key = collisions.includes(t.value) ? `${t.type}:${t.value}` : t.value
    const img = await loadRGBA(t.absPath)
    const bbox = alphaBbox(img)
    if (bbox === null) {
      anomalies.push(`${key}: fully transparent sprite — skipped (no entry)`)
      continue
    }
    const bboxMax = Math.max(bbox.w, bbox.h)
    const canvasMax = Math.max(img.width, img.height)

    const fitX = fitPitch(changePositions(img, 'x'))
    const fitY = fitPitch(changePositions(img, 'y'))
    const latticeOk =
      fitX !== null &&
      fitY !== null &&
      fitX.span < 1.0 &&
      fitY.span < 1.0 &&
      Math.abs(fitX.p - fitY.p) < 0.05

    let entry: SpriteEntry

    if (Object.prototype.hasOwnProperty.call(PINS, t.value) && t.type === 'ARTIFACT') {
      // §9-G screenshot-measured pins (smooth-resampled sprites).
      const nativeMax = PINS[t.value]
      const k = bboxMax / nativeMax
      entry = {
        file: t.relPath,
        canvas: [img.width, img.height],
        bbox: [bbox.w, bbox.h],
        k: round4(k),
        kResidual: null,
        native: [
          Math.max(1, Math.round((nativeMax * bbox.w) / bboxMax)),
          Math.max(1, Math.round((nativeMax * bbox.h) / bboxMax)),
        ],
        method: 'pinned',
      }
      if (latticeOk) {
        anomalies.push(
          `${key}: pinned (nativeMax=${nativeMax}) but lattice fit also succeeded ` +
            `(p_x=${round4(fitX.p)}, p_y=${round4(fitY.p)}) — pin kept`
        )
      }
    } else if (latticeOk) {
      const k = (fitX.p + fitY.p) / 2
      entry = {
        file: t.relPath,
        canvas: [img.width, img.height],
        bbox: [bbox.w, bbox.h],
        k: round4(k),
        kResidual: round4(Math.max(fitX.span, fitY.span)),
        native: [Math.max(1, Math.round(bbox.w / k)), Math.max(1, Math.round(bbox.h / k))],
        method: 'lattice',
      }
      // §9-G measured families: ~2.44-2.46 / exactly 2.5 / exactly 3.0.
      // A fit outside them (defender 2.60, flag 2.74, ...) is kept as measured
      // data but flagged low-confidence, mirroring §9-G's own labeling.
      const inFamily = Math.abs(k - 2.5) <= 0.07 || Math.abs(k - 3.0) <= 0.03
      if (!inFamily) {
        entry.lowConfidence = true
        anomalies.push(
          `${key}: off-family k=${round4(k)} (lattice, span=${entry.kResidual}) — lowConfidence`
        )
      }
    } else {
      // Fallback: assume the canonical export factor for the canvas family.
      if (fitX !== null && fitY !== null && fitX.span < 1.0 && fitY.span < 1.0) {
        axisDisagreements.push(
          `${key}: axes disagree p_x=${round4(fitX.p)} vs p_y=${round4(fitY.p)} ` +
            `(spans ${round4(fitX.span)}/${round4(fitY.span)})`
        )
      }
      const base = canvasMax >= 90 ? 3.0 : 2.5
      const nativeMax = Math.max(1, Math.round(bboxMax / base))
      const k = bboxMax / nativeMax
      entry = {
        file: t.relPath,
        canvas: [img.width, img.height],
        bbox: [bbox.w, bbox.h],
        k: round4(k),
        kResidual: null,
        native: [Math.max(1, Math.round(bbox.w / k)), Math.max(1, Math.round(bbox.h / k))],
        method: 'fallback',
        lowConfidence: true,
      }
      fallbackList.push(key)
    }

    if (ART_MISMATCH.has(t.value)) entry.artMismatch = true

    sprites[key] = entry
    methodCounts[entry.method]++
    const bucket = entry.method === 'lattice' ? entry.k.toFixed(2) : `(${entry.method})`
    kHistogram.set(bucket, (kHistogram.get(bucket) ?? 0) + 1)
  }

  for (const d of axisDisagreements) anomalies.push(`axis disagreement: ${d}`)

  const fallbackRatio = methodCounts.fallback / templates.length
  if (fallbackRatio > 0.15) {
    const webpFallback = fallbackList.filter((v) => {
      const e = sprites[v]
      return e !== undefined && e.file.endsWith('.webp')
    }).length
    anomalies.push(
      `fallback ratio ${(fallbackRatio * 100).toFixed(1)}% exceeds 15% ` +
        `(${webpFallback} lossy-webp + ${methodCounts.fallback - webpFallback} smooth/off-lattice png; ` +
        `anchors validate the fitter — see report)`
    )
  }

  // ---- anchor validation -------------------------------------------------
  interface AnchorRow {
    value: string
    expectedK: number
    expectedNativeMax: number
    gotK: number | null
    gotNativeMax: number | null
    method: string | null
    pass: boolean
  }
  const anchorRows: AnchorRow[] = ANCHORS.map((a) => {
    const e = sprites[a.value]
    if (!e) {
      return {
        value: a.value,
        expectedK: a.k,
        expectedNativeMax: a.nativeMax,
        gotK: null,
        gotNativeMax: null,
        method: null,
        pass: false,
      }
    }
    const gotNativeMax = Math.max(e.native[0], e.native[1])
    const pass =
      Math.abs(e.k - a.k) <= 0.06 && Math.abs(gotNativeMax - a.nativeMax) <= 1
    return {
      value: a.value,
      expectedK: a.k,
      expectedNativeMax: a.nativeMax,
      gotK: e.k,
      gotNativeMax,
      method: e.method,
      pass,
    }
  })

  // ---- write catalog -----------------------------------------------------
  const output = {
    generated: '2026-08-15',
    method: 'phase-free lattice fit (PLAN 06 §9-G)',
    sprites,
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8')

  // ---- report ------------------------------------------------------------
  const report = {
    templates: templates.length,
    entries: Object.keys(sprites).length,
    methodCounts,
    kHistogram: Object.fromEntries(
      Array.from(kHistogram.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    ),
    anchors: anchorRows,
    anchorsAllPass: anchorRows.every((r) => r.pass),
    fallbackList,
    anomalies,
    outFile: path.relative(PROJECT_ROOT, OUT_FILE),
  }
  console.log(JSON.stringify(report, null, 2))

  if (!report.anchorsAllPass) {
    console.error('ANCHOR VALIDATION FAILED')
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
