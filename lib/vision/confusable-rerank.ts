import type { CellPrediction } from './types'

/**
 * Lookalike groups confirmed from fixture mismatches and sprite glyphs.
 * `advance` sits in two families; lookup returns the union.
 * Do not add one-off "if X then Y" overrides — only groups + a second score.
 */
export const CONFUSION_GROUPS: readonly (readonly string[])[] = [
  ['load', 'exit', 'entrance', 'future', 'advent', 'honor', 'base', 'advance', 'point'],
  ['defender', 'dedication'],
  ['thornbush', 'thorn'],
  ['shield_technique_manual', 'swordsmanship_textbook', 'mark_of_warrior'],
  ['hope', 'advance', 'connection', 'preparation', 'wit', 'unity', 'distribution'],
  ['warrant', 'honor'],
  ['load', 'justice'],
  ['heart_shaped_carrot', 'advent', 'magic_carrot'],
  ['heart_shaped_carrot', 'golden_leaf', 'magic_carrot'],
  ['six_leaf_clover', 'lightning_struck_tree_branch', 'golden_leaf', 'point'],
  ['heart_of_the_beast', 'linear', 'frozen_heart'],
  ['yellow_planet', 'flame_insect', 'firefly'],
  ['ohia_lehua', 'magma_bead'],
  ['solis_parvo', 'colorless_cube'],
  ['craving', 'blue_planet', 'sky_blue_planet', 'ice_star'],
  ['sharp_eye', 'shield_technique_manual', 'tactical_manual'],
  ['yearning', 'beating', 'binary_star', 'peace', 'entrance'],
]

const MEMBER_GROUPS: Map<string, Set<string>[]> = (() => {
  const map = new Map<string, Set<string>[]>()
  for (const g of CONFUSION_GROUPS) {
    const set = new Set(g)
    for (const v of g) {
      const list = map.get(v)
      if (list) list.push(set)
      else map.set(v, [set])
    }
  }
  return map
})()

/** Members of every group `value` belongs to. Shared members (advance) get the union. */
export function confusableSet(value: string): Set<string> | null {
  const groups = MEMBER_GROUPS.get(value)
  if (!groups) return null
  if (groups.length === 1) return groups[0]
  const merged = new Set<string>()
  for (const g of groups) for (const x of g) merged.add(x)
  return merged
}

/** Runner-up is "close" enough to pull its group into the second pass. */
export const CLOSE_RUNNER_UP = 0.02

/** Challenger must beat the current winner by this much on the fine cue. */
export const FINE_SWAP_DELTA = 0.02

/**
 * Extra delta when the primary winner is outside the group (runner-up trigger).
 * Stops a near-tie outsider from being replaced by a random lookalike.
 */
export const FINE_OUTSIDER_DELTA = 0.08

/**
 * Below the lowest correct occupied score on the fixtures (−0.0832).
 * Anything this weak is a junk top-1 (empty→vane, heart→shield_earring).
 * Soft near-zero reject is intentionally omitted: it flooded false empties.
 */
export const REJECT_HARD_SCORE = -0.09

/** Primary score below this is "weak" — inject type peers / lookalikes. */
export const WEAK_SCORE = 0.06

/** Keep a cross-type winner only if it beats the best other-type hit by this much. */
export const TYPE_HUGE_MARGIN = 0.12

/** Easier swap inside defender/dedication and the hope family (stronger cue). */
export const FINE_FAMILY_DELTA = 0.01

/** Seed of the tablet lookalike family, used when a weak artifact needs peers. */
export const TABLET_LOOKALIKE_SEED = 'exit'

/**
 * Compact green/grey slabs that the IoU prefilter often drops when the cell
 * is a small glyph. Injected into the second pass only — never a primary
 * override. `flag` stays out of CONFUSION_GROUPS (that smashed 1.jpeg).
 */
export const SMALL_SLABS: readonly string[] = [
  'load',
  'exit',
  'entrance',
  'future',
  'advent',
  'honor',
  'base',
  'advance',
  'flag',
  'defender',
  'dedication',
  'hope',
  'connection',
  'preparation',
  'wit',
  'unity',
  'distribution',
  'warrant',
]

export const SMALL_SLAB_SET = new Set(SMALL_SLABS)

export interface FgShape {
  n: number
  fill: number
  compact: number
}

/**
 * Measured on labelled fixtures (2026-08-15):
 *   clover (must not look like a tablet): fill=0.676 compact=0.310
 *   4.png#16 exit miss:                   fill=0.752 compact=0.329
 *   5.png#1 flag / #9 exit / 6.png#21:    fill>=0.960 compact>=0.693
 * Compactness is a poor type classifier (~50–68% vs green-ratio ~90%).
 * Use it only to decide whether to *inject* slab candidates.
 */
export const TABLET_FILL = 0.72
export const TABLET_COMPACT = 0.5

export function fgShape(fg: Uint8Array, w = 64): FgShape {
  const nPix = fg.length
  const h = (nPix / w) | 0
  let n = 0
  let peri = 0
  let minX = w
  let maxX = -1
  let minY = h
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (!fg[p]) continue
      n++
      if (x === 0 || !fg[p - 1]) peri++
      if (x === w - 1 || !fg[p + 1]) peri++
      if (y === 0 || !fg[p - w]) peri++
      if (y === h - 1 || !fg[p + w]) peri++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const fill = n && maxX >= minX ? n / ((maxX - minX + 1) * (maxY - minY + 1)) : 0
  const compact = peri > 0 ? (4 * Math.PI * n) / (peri * peri) : 0
  return { n, fill, compact }
}

export function isTabletLikeShape(shape: FgShape): boolean {
  return shape.fill >= TABLET_FILL || shape.compact >= TABLET_COMPACT
}

/** Inject the small-slab set: tablet-like shape, weak artifact, not a high-margin winner. */
export function shouldInjectSmallSlabs(
  topType: ItemTypeVote | null,
  topScore: number,
  tabletLike: boolean
): boolean {
  if (!tabletLike) return false
  if (topType !== 'ARTIFACT') return false
  return topScore < WEAK_SCORE
}

export type ItemTypeVote = 'TABLET' | 'ARTIFACT'

export function majorityType(types: readonly ItemTypeVote[]): ItemTypeVote | null {
  let t = 0
  let a = 0
  for (const x of types) {
    if (x === 'TABLET') t++
    else a++
  }
  if (t > a) return 'TABLET'
  if (a > t) return 'ARTIFACT'
  return null
}

export function shouldTypeGate(
  winnerType: ItemTypeVote,
  vote: ItemTypeVote | null,
  winnerScore: number,
  bestOtherScore?: number
): boolean {
  if (!vote || vote === winnerType) return false
  if (winnerScore >= 0.15) return false
  const other = bestOtherScore ?? -1
  return winnerScore - other < TYPE_HUGE_MARGIN
}

export function isFamilyGroup(group: Set<string>): boolean {
  return group.has('defender') || group.has('dedication') || group.has('hope') || group.has('wit')
}

/**
 * Group to evaluate in the second pass.
 * Winner's own group wins. Else a same/other-type peer in the hits can pull
 * its group (so exit can enter when honor made top-5). Else a weak artifact
 * gets the tablet lookalike family — exit cannot win if it was never a candidate.
 */
export function pickInjectGroup(
  topValue: string | null,
  topType: ItemTypeVote | null,
  topScore: number,
  peerValue: string | null,
  vote: ItemTypeVote | null = null
): Set<string> | null {
  if (topValue) {
    const g = confusableSet(topValue)
    if (g) return g
  }
  if (peerValue) {
    const g = confusableSet(peerValue)
    if (g) return g
  }
  // Only pull the tablet family when the type vote agrees the cell is a slab.
  // A weak green artifact (six_leaf_clover) must not be thrown into that family.
  if (topType === 'ARTIFACT' && topScore < WEAK_SCORE && vote === 'TABLET') {
    return confusableSet(TABLET_LOOKALIKE_SEED)
  }
  return null
}

export const HUE_QUAD_BINS = 8
export const HUE_HIST_LEN = 4 * HUE_QUAD_BINS

/** 2×2 spatial hue histogram, chroma-weighted. Low-chroma mass goes to bin 0. */
export function spatialHueHist(
  r: ArrayLike<number>,
  g: ArrayLike<number>,
  b: ArrayLike<number>,
  idx: ArrayLike<number>,
  n: number,
  w: number,
  out: Float32Array
): void {
  out.fill(0)
  if (n <= 0) return
  const mid = w / 2
  let mass = 0
  for (let i = 0; i < n; i++) {
    const p = idx[i]
    const y = (p / w) | 0
    const x = p - y * w
    const q = (y < mid ? 0 : 2) + (x < mid ? 0 : 1)
    const rv = r[p]
    const gv = g[p]
    const bv = b[p]
    const max = rv > gv ? (rv > bv ? rv : bv) : gv > bv ? gv : bv
    const min = rv < gv ? (rv < bv ? rv : bv) : gv < bv ? gv : bv
    const c = max - min
    let bin = 0
    if (c >= 12) {
      let h: number
      if (max === rv) h = (gv - bv) / c
      else if (max === gv) h = (bv - rv) / c + 2
      else h = (rv - gv) / c + 4
      if (h < 0) h += 6
      bin = Math.min(HUE_QUAD_BINS - 1, ((h / 6) * HUE_QUAD_BINS) | 0)
    }
    const wgt = c < 12 ? 8 : c
    out[q * HUE_QUAD_BINS + bin] += wgt
    mass += wgt
  }
  if (mass > 0) {
    for (let i = 0; i < out.length; i++) out[i] /= mass
  }
}

export function histIntersection(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += a[i] < b[i] ? a[i] : b[i]
  return s
}

export const INK_HIST_LEN = 8

/**
 * 2×2 green/white mass. Exit puts white on the bottom; entrance puts it on
 * the top. Defender is greener and less symmetric than dedication.
 */
export function spatialInkHist(
  r: ArrayLike<number>,
  g: ArrayLike<number>,
  b: ArrayLike<number>,
  idx: ArrayLike<number>,
  n: number,
  w: number,
  out: Float32Array
): void {
  out.fill(0)
  if (n <= 0) return
  const mid = w / 2
  let mass = 0
  for (let i = 0; i < n; i++) {
    const p = idx[i]
    const y = (p / w) | 0
    const x = p - y * w
    const q = (y < mid ? 0 : 2) + (x < mid ? 0 : 1)
    const rv = r[p]
    const gv = g[p]
    const bv = b[p]
    const lum = 0.299 * rv + 0.587 * gv + 0.114 * bv
    const chroma = (rv > gv ? (rv > bv ? rv : bv) : gv > bv ? gv : bv) - (rv < gv ? (rv < bv ? rv : bv) : gv < bv ? gv : bv)
    const isGreen = gv > rv + 8 && gv > bv + 4
    const isWhite = lum > 140 && chroma < 40
    if (isGreen) {
      out[q * 2] += 1
      mass++
    } else if (isWhite) {
      out[q * 2 + 1] += 1
      mass++
    }
  }
  if (mass > 0) {
    for (let i = 0; i < out.length; i++) out[i] /= mass
  }
}


export function pickRerankGroup(
  topValue: string | null,
  runnerUpValue: string | null,
  margin: number
): Set<string> | null {
  if (topValue) {
    const g = confusableSet(topValue)
    if (g) return g
  }
  if (runnerUpValue && margin <= CLOSE_RUNNER_UP) {
    return confusableSet(runnerUpValue)
  }
  return null
}

export function shouldSwap(winnerFine: number, challengerFine: number, delta = FINE_SWAP_DELTA): boolean {
  return challengerFine > winnerFine + delta
}

/** Weak dump ids: never a real top-1 when the score is negative. */
export const DUMP_REJECT = new Set(['ohia_lehua'])

export function shouldReject(
  top1: number,
  _top2?: number,
  skip = false,
  topValue?: string | null
): boolean {
  if (skip) return false
  if (top1 < REJECT_HARD_SCORE) return true
  if (topValue && DUMP_REJECT.has(topValue) && top1 < 0) return true
  return false
}

export function emptyRejected(slotIndex: number, confidence: number, candidates?: CellPrediction['candidates']): CellPrediction {
  return {
    slotIndex,
    matchedValue: null,
    type: null,
    rotation: 0,
    confidence,
    candidates,
  }
}

/** Normalized cross-correlation over the listed indices. */
export function nccMasked(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  idx: ArrayLike<number>,
  n: number
): number {
  if (n < 8) return -1
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    const p = idx[i]
    ma += a[p]
    mb += b[p]
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const p = idx[i]
    const xa = a[p] - ma
    const xb = b[p] - mb
    num += xa * xb
    da += xa * xa
    db += xb * xb
  }
  const den = Math.sqrt(da * db)
  return den < 1e-6 ? 0 : num / den
}

/** Separable 3×3 box blur. `tmp` must be at least `w*h`. */
export function boxBlur3(
  src: Float32Array,
  dst: Float32Array,
  tmp: Float32Array,
  w: number,
  h: number
): void {
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0
      const x1 = x < w - 1 ? x + 1 : w - 1
      let s = 0
      let c = 0
      for (let xx = x0; xx <= x1; xx++) {
        s += src[row + xx]
        c++
      }
      tmp[row + x] = s / c
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0
    const y1 = y < h - 1 ? y + 1 : h - 1
    for (let x = 0; x < w; x++) {
      let s = 0
      let c = 0
      for (let yy = y0; yy <= y1; yy++) {
        s += tmp[yy * w + x]
        c++
      }
      dst[y * w + x] = s / c
    }
  }
}

/** Sobel magnitude. Border pixels stay 0. */
export function sobelMag(src: Float32Array, out: Float32Array, w: number, h: number): void {
  out.fill(0)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx =
        -src[i - w - 1] +
        src[i - w + 1] -
        2 * src[i - 1] +
        2 * src[i + 1] -
        src[i + w - 1] +
        src[i + w + 1]
      const gy =
        -src[i - w - 1] -
        2 * src[i - w] -
        src[i - w + 1] +
        src[i + w - 1] +
        2 * src[i + w] +
        src[i + w + 1]
      out[i] = Math.hypot(gx, gy)
    }
  }
}

export interface FineMaps {
  gray: Float32Array
  hp: Float32Array
  mag: Float32Array
  r: Float32Array
  g: Float32Array
  b: Float32Array
}

/** Combine the cues the primary L1 residual misses. Hue/ink hists are optional. */
export function combineFineCues(
  colorNcc: number,
  hpNcc: number,
  edgeNcc: number,
  hueHist?: number,
  inkHist?: number
): number {
  let s = colorNcc + hpNcc + edgeNcc
  let n = 3
  if (hueHist !== undefined) {
    s += hueHist
    n++
  }
  if (inkHist !== undefined) {
    s += inkHist
    n++
  }
  return s / n
}

/** Heavier spatial weight for defender/dedication and the hope family. */
export function combineFamilyCues(
  colorNcc: number,
  hpNcc: number,
  edgeNcc: number,
  hueHist: number,
  inkHist?: number
): number {
  if (inkHist === undefined) return 0.2 * colorNcc + 0.15 * hpNcc + 0.15 * edgeNcc + 0.5 * hueHist
  return 0.15 * colorNcc + 0.1 * hpNcc + 0.1 * edgeNcc + 0.3 * hueHist + 0.35 * inkHist
}

export type Hit = { variant: number; score: number }

export function orderAfterRerank(
  hits: Hit[],
  winnerVariant: number,
  groupVariants: Set<number>,
  fineOf: (variant: number) => number
): Hit[] {
  const byVar = new Map(hits.map((h) => [h.variant, h]))
  const winnerScore = byVar.get(winnerVariant)?.score ?? hits[0]?.score ?? 0
  const head: Hit = byVar.get(winnerVariant) ?? { variant: winnerVariant, score: winnerScore }

  const restGroup = hits
    .filter((h) => h.variant !== winnerVariant && groupVariants.has(h.variant))
    .sort((a, b) => fineOf(b.variant) - fineOf(a.variant))
  const restOut = hits.filter((h) => h.variant !== winnerVariant && !groupVariants.has(h.variant))
  return [head, ...restGroup, ...restOut].slice(0, 5)
}

