import { analyzeCell, CELL, CELL_RING_INDICES, cropCellNearest, TRIM } from './plate-matcher'
import type { RGBAImage } from './types'

export interface GridRect {
  originX: number
  originY: number
  gridWidth: number
  gridHeight: number
  cols: number
  rows: number
}

/** Grid quality objective. Higher is better. See `makeMatchScorer`. */
export type GridScorer = (img: RGBAImage, rect: GridRect) => number

/** Internal objective, always higher-is-better, so both paths share one comparison. */
type Objective = (rect: GridRect) => number

const DEFAULT_COLS = 6
const MIN_ROWS = 3
const MAX_ROWS = 8
/** Profile band: the middle 64% of the opposite axis, avoiding the outer frame. */
const BAND_LO = 0.18
const BAND_HI = 0.82
/** The grid is assumed to cover at least this fraction of the screenshot. */
const MIN_SPAN_RATIO = 0.55
const PITCH_STEP = 0.25
const ORIGIN_STEP = 0.5
const GAP_WINDOW = 1
/** Fraction of the pitch trimmed off each end of a cell before sampling its interior. */
const INTERIOR_INSET = 0.25
const TIE_EPS = 1e-6
const REFINE_ITERATIONS = 3
const MAX_CENTROID_DRIFT = 0.22
const SWEEP_DY = [-6, -3, 0, 3, 6]
const SWEEP_DX = [-4, -2, 0, 2, 4]
/** Cap only; the sweep breaks as soon as a round finds nothing. 8 gives identical results. */
const SWEEP_ROUNDS = 4
const PITCH_RATIO_LO = 0.9
const PITCH_RATIO_HI = 1.15
const CELL_CENTER = (CELL - 1) / 2

function toGray(img: RGBAImage): Float32Array {
  const g = new Float32Array(img.width * img.height)
  const d = img.data
  for (let i = 0; i < g.length; i++) {
    g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  }
  return g
}

function columnProfile(gray: Float32Array, w: number, h: number): Float32Array {
  const y0 = Math.floor(h * BAND_LO)
  const y1 = Math.max(y0 + 1, Math.floor(h * BAND_HI))
  const out = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let y = y0; y < y1; y++) s += gray[y * w + x]
    out[x] = s / (y1 - y0)
  }
  return out
}

function rowProfile(gray: Float32Array, w: number, h: number): Float32Array {
  const x0 = Math.floor(w * BAND_LO)
  const x1 = Math.max(x0 + 1, Math.floor(w * BAND_HI))
  const out = new Float32Array(h)
  for (let y = 0; y < h; y++) {
    let s = 0
    for (let x = x0; x < x1; x++) s += gray[y * w + x]
    out[y] = s / (x1 - x0)
  }
  return out
}

interface AxisFit {
  pitch: number
  origin: number
  cost: number
}

type AxisScorer = (pitch: number, origin: number) => number

/**
 * Axis cost: `mean(internal gap brightness) - min(cell interior brightness)`.
 * Lower is better. Shared by the seed fit, the refinement gate and the sweep so
 * that all three stages optimise one objective.
 *
 * The gap term alone is not enough. It assumes there is no dark gap outside the
 * grid, and that is false: in `1.jpeg` the left outer frame (x=72) is darker
 * than every internal gap (33.95 vs 36.01-36.43), so a grid shifted one cell
 * over scored BETTER than the truth. The interior term closes that hole — a
 * shifted grid parks one cell on the dark outer margin and is penalised at once.
 */
function makeAxisScorer(profile: Float32Array, span: number, n: number): AxisScorer {
  // Prefix sums keep the interior term O(n) per candidate instead of O(span).
  const prefix = new Float64Array(span + 1)
  for (let i = 0; i < span; i++) prefix[i + 1] = prefix[i] + profile[i]

  return (pitch: number, origin: number): number => {
    let gapSum = 0
    for (let k = 1; k < n; k++) {
      const at = Math.round(origin + k * pitch)
      let m = Infinity
      for (let d = -GAP_WINDOW; d <= GAP_WINDOW; d++) {
        const idx = at + d
        if (idx < 0 || idx >= span) continue
        if (profile[idx] < m) m = profile[idx]
      }
      gapSum += m === Infinity ? 255 : m
    }

    // The DIMMEST cell interior, not the average. A one-cell shift parks exactly
    // one cell on the dark outer margin, which the minimum catches sharply while
    // staying flat for the small shifts that the gap term resolves. Averaging
    // instead tilts the fine plateau and cost 4.png's seed ~4.5px.
    const inset = pitch * INTERIOR_INSET
    let dimmest = Infinity
    for (let k = 0; k < n; k++) {
      const lo = Math.max(0, Math.ceil(origin + k * pitch + inset))
      const hi = Math.min(span, Math.floor(origin + (k + 1) * pitch - inset))
      if (hi <= lo) continue
      const mean = (prefix[hi] - prefix[lo]) / (hi - lo)
      if (mean < dimmest) dimmest = mean
    }
    if (dimmest === Infinity) dimmest = 0
    return gapSum / (n - 1) - dimmest
  }
}

function fitAxis(
  profile: Float32Array,
  span: number,
  n: number,
  minPitch: number,
  maxPitch: number
): AxisFit | null {
  if (n < 2) return null
  const evalCost = makeAxisScorer(profile, span, n)

  let minCost = Infinity
  for (let pitch = minPitch; pitch <= maxPitch + 1e-9; pitch += PITCH_STEP) {
    if (pitch * n > span) break
    const originMax = span - pitch * n
    for (let origin = 0; origin <= originMax + 1e-9; origin += ORIGIN_STEP) {
      const cost = evalCost(pitch, origin)
      if (cost < minCost) minCost = cost
    }
  }
  if (minCost === Infinity) return null

  // Exact-tie plateaus are common (100+ candidates on 2.png). Taking the first
  // minimum in ascending order lands on the plateau's edge; take its centre.
  const tiePitch: number[] = []
  const tieOrigin: number[] = []
  for (let pitch = minPitch; pitch <= maxPitch + 1e-9; pitch += PITCH_STEP) {
    if (pitch * n > span) break
    const originMax = span - pitch * n
    for (let origin = 0; origin <= originMax + 1e-9; origin += ORIGIN_STEP) {
      if (evalCost(pitch, origin) <= minCost + TIE_EPS) {
        tiePitch.push(pitch)
        tieOrigin.push(origin)
      }
    }
  }

  const ties = tiePitch.length
  let pitch = tiePitch.reduce((a, b) => a + b, 0) / ties
  let origin = tieOrigin.reduce((a, b) => a + b, 0) / ties

  // Averaging the two coordinates independently only lands inside the plateau
  // when it is a product set. When it is not, the centroid is a point that was
  // never evaluated and can be strictly worse (measured: 4.png Y, +0.0128).
  // Re-evaluate, and fall back to the real candidate nearest that centroid.
  let cost = evalCost(pitch, origin)
  if (cost > minCost + TIE_EPS) {
    let bestD = Infinity
    let bestI = 0
    for (let i = 0; i < ties; i++) {
      const dp = (tiePitch[i] - pitch) / PITCH_STEP
      const doo = (tieOrigin[i] - origin) / ORIGIN_STEP
      const d = dp * dp + doo * doo
      if (d < bestD) {
        bestD = d
        bestI = i
      }
    }
    pitch = tiePitch[bestI]
    origin = tieOrigin[bestI]
    cost = evalCost(pitch, origin)
  }

  return { pitch, origin, cost }
}

interface CellGeometry {
  left: number
  top: number
  right: number
  bottom: number
}

/** Identical cropping rule to PlateMatcherRecognizer, so calibration optimises what the matcher sees. */
function cellBox(grid: GridRect, index: number): CellGeometry {
  const pitchX = grid.gridWidth / grid.cols
  const pitchY = grid.gridHeight / grid.rows
  const margin = pitchX * TRIM
  const r = Math.floor(index / grid.cols)
  const c = index % grid.cols
  const x = grid.originX + c * pitchX
  const y = grid.originY + r * pitchY
  return {
    left: Math.trunc(x + margin),
    top: Math.trunc(y + margin),
    right: Math.trunc(x + pitchX - margin),
    bottom: Math.trunc(y + pitchY - margin),
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 === 1 ? s[h] : (s[h - 1] + s[h]) / 2
}

/**
 * Collapses each index to the median of its cells before regressing. A single
 * mis-segmented cell at index 0 or n-1 has enormous leverage on a plain
 * least-squares slope, and one bad iteration compounds over the next two.
 */
function medianByIndex(indices: number[], deltas: number[]): { xs: number[]; ys: number[] } {
  const groups = new Map<number, number[]>()
  for (let i = 0; i < indices.length; i++) {
    const g = groups.get(indices[i])
    if (g) g.push(deltas[i])
    else groups.set(indices[i], [deltas[i]])
  }
  const xs = Array.from(groups.keys()).sort((a, b) => a - b)
  const ys = xs.map((idx) => median(groups.get(idx)!))
  return { xs, ys }
}

function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length
  if (n < 3) return null
  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) {
    mx += xs[i]
    my += ys[i]
  }
  mx /= n
  my /= n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  if (den < 1e-9) return null
  const slope = num / den
  return { slope, intercept: my - slope * mx }
}

/**
 * Centroid regression. The per-cell foreground centroid drifts linearly away
 * from the cell centre when the pitch is wrong, so regressing that drift on the
 * cell index recovers a PITCH correction from the slope.
 *
 * Only the slope is used. The intercept does not converge to zero even when fed
 * the ground-truth grid (4.png still reports +1.44px after three iterations)
 * because sprites carry their own constant offset inside the cell, which the
 * regression cannot separate from a grid offset. Feeding it back moved the grid
 * away from the truth. Origin correction is left entirely to the sweep.
 */
function refineOnce(img: RGBAImage, grid: GridRect): GridRect | null {
  const out = { ...grid }
  const pitchX = out.gridWidth / out.cols
  const pitchY = out.gridHeight / out.rows
  const margin = pitchX * TRIM
  const scaleX = (pitchX - 2 * margin) / CELL
  const scaleY = (pitchY - 2 * margin) / CELL

  const cs: number[] = []
  const dxs: number[] = []
  const rs: number[] = []
  const dys: number[] = []

  for (let i = 0; i < out.cols * out.rows; i++) {
    const box = cellBox(out, i)
    const info = analyzeCell(cropCellNearest(img, box.left, box.top, box.right, box.bottom))
    if (!info) continue
    const dx = (info.cx - CELL_CENTER) * scaleX
    const dy = (info.cy - CELL_CENTER) * scaleY
    // A centroid cannot legitimately sit this far off centre; anything beyond
    // is a mis-segmentation (merged neighbours, overlay text) and would only
    // poison the regression.
    if (Math.abs(dx) < MAX_CENTROID_DRIFT * pitchX) {
      cs.push(i % out.cols)
      dxs.push(dx)
    }
    if (Math.abs(dy) < MAX_CENTROID_DRIFT * pitchY) {
      rs.push(Math.floor(i / out.cols))
      dys.push(dy)
    }
  }
  if (cs.length < 3 && rs.length < 3) return null

  const gx = medianByIndex(cs, dxs)
  const gy = medianByIndex(rs, dys)
  const fx = linearFit(gx.xs, gx.ys)
  const fy = linearFit(gy.xs, gy.ys)
  if (!fx && !fy) return null
  if (fx) out.gridWidth = (pitchX + fx.slope) * out.cols
  if (fy) out.gridHeight = (pitchY + fy.slope) * out.rows
  return out
}

/**
 * Monotone wrapper: an iteration is kept only when it improves the objective.
 * Without this the refinement walks away from an already-correct seed (4.png
 * seeded at 0.03px degraded to 10.77px).
 */
function refineByCentroids(img: RGBAImage, grid: GridRect, objective: Objective): GridRect {
  let current = grid
  let currentScore = objective(grid)

  for (let iter = 0; iter < REFINE_ITERATIONS; iter++) {
    const next = refineOnce(img, current)
    if (!next) break
    const nextScore = objective(next)
    if (!(nextScore > currentScore)) break
    current = next
    currentScore = nextScore
  }
  return current
}

/**
 * Origin sweep over the (dy, dx) offsets, maximising `objective`.
 * Monotone by construction: offset (0, 0) is in the candidate set.
 */
function sweepOrigin(grid: GridRect, objective: Objective): GridRect {
  let best = grid
  let bestScore = objective(grid)

  // Coordinate descent, repeated until a round finds nothing. A single fixed
  // 5x5 pass could only reach +-4px in x, but the measured origin residual runs
  // to +-11px, so the old sweep structurally could not correct it. Iterating
  // costs the same per round and converges instead of clipping.
  for (let round = 0; round < SWEEP_ROUNDS; round++) {
    let moved = false
    for (const axis of ['x', 'y'] as const) {
      const offsets = axis === 'x' ? SWEEP_DX : SWEEP_DY
      let localBest = best
      let localScore = bestScore
      for (const d of offsets) {
        if (d === 0) continue
        const candidate =
          axis === 'x'
            ? { ...best, originX: best.originX + d }
            : { ...best, originY: best.originY + d }
        const s = objective(candidate)
        if (s > localScore) {
          localScore = s
          localBest = candidate
        }
      }
      if (localBest !== best) {
        best = localBest
        bestScore = localScore
        moved = true
      }
    }
    if (!moved) break
  }
  return best
}

/**
 * Detects the inventory grid in a full screenshot.
 * Three stages: internal-gap seed, centroid regression, origin sweep.
 */
export function calibrateGrid(
  img: RGBAImage,
  hint?: { cols?: number; rows?: number; scorer?: GridScorer }
): GridRect | null {
  if (img.width < 32 || img.height < 32) return null

  const gray = toGray(img)
  const colProf = columnProfile(gray, img.width, img.height)
  const rowProf = rowProfile(gray, img.width, img.height)

  const cols = hint?.cols ?? DEFAULT_COLS
  const fitX = fitAxis(
    colProf,
    img.width,
    cols,
    (MIN_SPAN_RATIO * img.width) / cols,
    img.width / cols
  )
  if (!fitX) return null

  // A real match score is the only objective that separates the true grid from
  // a shifted one on every fixture; the brightness profile is the fallback.
  const scoreX = makeAxisScorer(colProf, img.width, cols)
  const rowScorers = new Map<number, AxisScorer>()
  const scoreYFor = (n: number): AxisScorer => {
    let s = rowScorers.get(n)
    if (!s) {
      s = makeAxisScorer(rowProf, img.height, n)
      rowScorers.set(n, s)
    }
    return s
  }
  const objective: Objective = hint?.scorer
    ? (rect) => hint.scorer!(img, rect)
    : (rect) =>
        -(
          scoreX(rect.gridWidth / rect.cols, rect.originX) +
          scoreYFor(rect.rows)(rect.gridHeight / rect.rows, rect.originY)
        )

  /** Best (pitch, origin) for a fixed row count, or null if the count cannot fit. */
  const fitRows = (n: number): GridRect | null => {
    // Same span floor as the X axis: without it a 3-row grid covering 46% of the
    // image is admissible, and it wins because a smaller grid can dodge every
    // dark cell.
    const lo = Math.max(PITCH_RATIO_LO * fitX.pitch, (MIN_SPAN_RATIO * img.height) / n)
    const hi = Math.min(PITCH_RATIO_HI * fitX.pitch, img.height / n)
    if (lo > hi) return null
    const f = fitAxis(rowProf, img.height, n, lo, hi)
    if (!f) return null
    return {
      originX: fitX.origin,
      originY: f.origin,
      gridWidth: fitX.pitch * cols,
      gridHeight: f.pitch * n,
      cols,
      rows: n,
    }
  }

  const ringMean = (cell: Float32Array): [number, number, number] => {
    let r = 0, g = 0, b = 0
    for (let k = 0; k < CELL_RING_INDICES.length; k++) {
      const q = CELL_RING_INDICES[k] * 3
      r += cell[q]; g += cell[q + 1]; b += cell[q + 2]
    }
    const n = CELL_RING_INDICES.length
    return [r / n, g / n, b / n]
  }
  const medianOf3 = (v: [number, number, number][]): [number, number, number] => {
    const out: number[] = []
    for (let c = 0; c < 3; c++) {
      const a = v.map((x) => x[c]).sort((p2, q2) => p2 - q2)
      out.push(a.length % 2 ? a[a.length >> 1] : (a[(a.length >> 1) - 1] + a[a.length >> 1]) / 2)
    }
    return [out[0], out[1], out[2]]
  }
  const dist3 = (a: [number, number, number], b: [number, number, number]) =>
    (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3
  const inside = (b: CellGeometry) =>
    b.top >= 0 && b.left >= 0 && b.bottom <= img.height && b.right <= img.width

  /**
   * Inventory cells the grid leaves outside itself, in the row immediately above
   * and below it.
   *
   * Counting only OCCUPIED cells is not enough: a real inventory is often only
   * partly filled, and when the true grid's last row happens to be empty (4.png)
   * a one-row-short candidate strands nothing, ties at zero, and the decision
   * falls back to the unnormalised sum it was meant to replace — there by a 3.0%
   * margin. So a probe cell also counts when its border ring matches the grid's
   * own cells, i.e. it is an empty inventory cell rather than frame or
   * background. The yardstick is the grid's own ring spread, so there is no
   * threshold to tune.
   */
  const panelCellsOutside = (rect: GridRect): number => {
    const own: [number, number, number][] = []
    for (let i = 0; i < rect.cols * rect.rows; i++) {
      const box = cellBox(rect, i)
      if (!inside(box)) continue
      own.push(ringMean(cropCellNearest(img, box.left, box.top, box.right, box.bottom)))
    }
    if (own.length === 0) return 0
    const M = medianOf3(own)
    const yard = Math.max(...own.map((o) => dist3(o, M)))
    const pitchY = rect.gridHeight / rect.rows
    let count = 0
    for (const probeRow of [-1, rect.rows]) {
      const probe: GridRect = { ...rect, originY: rect.originY + probeRow * pitchY, gridHeight: pitchY, rows: 1 }
      for (let c = 0; c < rect.cols; c++) {
        const box = cellBox(probe, c)
        if (!inside(box)) continue
        const cell = cropCellNearest(img, box.left, box.top, box.right, box.bottom)
        if (analyzeCell(cell)) { count++; continue }
        if (dist3(ringMean(cell), M) <= yard) count++
      }
    }
    return count
  }
  let seed: GridRect | null = null
  if (hint?.rows) {
    seed = fitRows(hint.rows)
  } else {
    // Row count is picked by the objective, never by comparing `fitAxis` costs
    // across n. That cost carries a `min` over n cells, so it drifts
    // monotonically with n (2.png: -30.68 at n=3 down to -17.07 at the correct
    // n=6) and always elects the smallest row count.
    let bestScore = -Infinity
    const candidates: GridRect[] = []
    for (let n = MIN_ROWS; n <= MAX_ROWS; n++) {
      const candidate = fitRows(n)
      if (!candidate) continue
      candidates.push(candidate)
    }

    // Coverage first, match score second. `scoreGrid` sums per-cell scores, so a
    // dense sub-grid that skips sparse rows can out-sum the true grid (4.png:
    // a 4-row grid at 1.0964 beat the true 6-row grid at 1.0600). Per-cell
    // averaging makes that worse, not better. What actually separates them is
    // that a sub-grid leaves inventory cells outside itself, which
    // `panelCellsOutside` measures directly and in the right units — cells, not
    // a weighted blend needing a magic coefficient.
    const missed = candidates.map(panelCellsOutside)
    const minMissed = Math.min(...missed)
    for (let i = 0; i < candidates.length; i++) {
      if (missed[i] !== minMissed) continue
      const s = objective(candidates[i])
      if (s > bestScore) {
        bestScore = s
        seed = candidates[i]
      }
    }
  }
  if (!seed || seed.rows < 2) return null

  return sweepOrigin(refineByCentroids(img, seed, objective), objective)
}
