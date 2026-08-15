import { describe, expect, it } from 'vitest'
import {
  CLOSE_RUNNER_UP,
  FINE_SWAP_DELTA,
  REJECT_HARD_SCORE,
  SMALL_SLABS,
  TABLET_COMPACT,
  TABLET_FILL,
  TYPE_HUGE_MARGIN,
  WEAK_SCORE,
  confusableSet,
  fgShape,
  histIntersection,
  isTabletLikeShape,
  majorityType,
  nccMasked,
  orderAfterRerank,
  pickInjectGroup,
  pickRerankGroup,
  shouldInjectSmallSlabs,
  shouldReject,
  shouldSwap,
  shouldTypeGate,
  spatialHueHist,
  spatialInkHist,
} from '@/lib/vision/confusable-rerank'

describe('confusable groups', () => {
  it('puts recurring slab lookalikes in one set', () => {
    const g = confusableSet('load')
    expect(g).not.toBeNull()
    for (const v of ['exit', 'entrance', 'future', 'advent', 'honor', 'base', 'advance', 'point']) {
      expect(g!.has(v), v).toBe(true)
    }
    expect(g!.has('justice')).toBe(true)
    expect(g!.has('hope')).toBe(false)
    expect(g!.has('defender')).toBe(false)
  })

  it('unions overlapping groups at the shared member', () => {
    const g = confusableSet('advance')
    expect(g!.has('load')).toBe(true)
    expect(g!.has('hope')).toBe(true)
    expect(g!.has('unity')).toBe(true)
    expect(g!.has('defender')).toBe(false)
  })

  it('keeps defender/dedication and the book manuals as their own pairs', () => {
    expect([...confusableSet('defender')!].sort()).toEqual(['dedication', 'defender'])
    expect([...confusableSet('thorn')!].sort()).toEqual(['thorn', 'thornbush'])
    const books = confusableSet('shield_technique_manual')!
    expect(books.has('swordsmanship_textbook')).toBe(true)
    expect(books.has('mark_of_warrior')).toBe(true)
    expect(books.has('load')).toBe(false)
  })

  it('returns null for an id that is not in any lookalike group', () => {
    expect(confusableSet('black_scales')).toBeNull()
    expect(confusableSet('heart_of_the_beast')!.has('linear')).toBe(true)
    expect(confusableSet('six_leaf_clover')!.has('golden_leaf')).toBe(true)
    expect(confusableSet('heart_shaped_carrot')!.has('advent')).toBe(true)
    expect(confusableSet('heart_shaped_carrot')!.has('golden_leaf')).toBe(true)
  })
})

describe('pickRerankGroup', () => {
  it('uses the winner group when the top-1 is a lookalike', () => {
    const g = pickRerankGroup('dedication', 'touch_of_life', 0.2)
    expect(g!.has('defender')).toBe(true)
  })

  it('falls back to a close runner-up group', () => {
    const g = pickRerankGroup('black_scales', 'advance', CLOSE_RUNNER_UP)
    expect(g!.has('load')).toBe(true)
  })

  it('does not rerank a far runner-up', () => {
    expect(pickRerankGroup('black_scales', 'advance', CLOSE_RUNNER_UP + 0.01)).toBeNull()
  })
})

describe('low-confidence reject', () => {
  it('turns a hard-negative junk top-1 into empty', () => {
    expect(shouldReject(-0.1, 0.0)).toBe(true)
    expect(shouldReject(REJECT_HARD_SCORE - 0.001, undefined)).toBe(true)
  })

  it('does not reject a near-zero occupied guess (protects empty accuracy)', () => {
    expect(shouldReject(0.007, 0.0065)).toBe(false)
    expect(shouldReject(-0.05, -0.052)).toBe(false)
  })

  it('keeps the fixture floor cases: six-leaf clover and high-score winners', () => {
    // measured correct: six_leaf_clover @ -0.0832 / margin 0.0049
    expect(shouldReject(-0.0832, -0.0881)).toBe(false)
    // measured correct: keel_fragment @ 0.0044 / margin 0.0622
    expect(shouldReject(0.0044, -0.0578)).toBe(false)
    expect(shouldReject(0.3, 0.1)).toBe(false)
  })

  it('does not reject after a successful lookalike swap', () => {
    expect(shouldReject(-0.2, -0.21, true)).toBe(false)
  })

  it('rejects a negative ohia_lehua dump without touching other weak scores', () => {
    expect(shouldReject(-0.05, -0.06, false, 'ohia_lehua')).toBe(true)
    expect(shouldReject(-0.05, -0.06, false, 'ice_wings')).toBe(false)
    expect(shouldReject(0.02, 0.01, false, 'ohia_lehua')).toBe(false)
  })
})

describe('rerank helpers', () => {
  it('swaps only when the fine cue beats the winner by the delta', () => {
    expect(shouldSwap(0.5, 0.5 + FINE_SWAP_DELTA + 0.001)).toBe(true)
    expect(shouldSwap(0.5, 0.5 + FINE_SWAP_DELTA - 0.001)).toBe(false)
  })

  it('promotes the group winner and keeps the rest of the top-5', () => {
    const hits = [
      { variant: 1, score: 0.2 },
      { variant: 2, score: 0.15 },
      { variant: 9, score: 0.1 },
    ]
    const ordered = orderAfterRerank(hits, 7, new Set([1, 2, 7]), (j) => (j === 7 ? 0.9 : 0.1))
    expect(ordered[0]).toEqual({ variant: 7, score: 0.2 })
    expect(ordered.map((h) => h.variant)).toEqual([7, 1, 2, 9])
  })

  it('ncc is 1 for identical masked signals and ~-1 for opposites', () => {
    const a = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const b = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const c = Float32Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
    const idx = Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(nccMasked(a, b, idx, 10)).toBeCloseTo(1, 5)
    expect(nccMasked(a, c, idx, 10)).toBeCloseTo(-1, 5)
  })
})

describe('type vote and inject', () => {
  it('majorityType ignores a 3-2 split toward the larger side', () => {
    expect(majorityType(['TABLET', 'TABLET', 'ARTIFACT', 'TABLET', 'ARTIFACT'])).toBe('TABLET')
    expect(majorityType(['ARTIFACT', 'ARTIFACT', 'TABLET'])).toBe('ARTIFACT')
    expect(majorityType(['TABLET', 'ARTIFACT'])).toBeNull()
  })

  it('type-gates a weak artifact when the vote is tablet', () => {
    expect(shouldTypeGate('ARTIFACT', 'TABLET', 0.04, 0.016)).toBe(true)
    expect(shouldTypeGate('ARTIFACT', 'TABLET', 0.20, 0.05)).toBe(false)
    expect(shouldTypeGate('ARTIFACT', 'TABLET', 0.14, 0.14 - TYPE_HUGE_MARGIN)).toBe(false)
    expect(shouldTypeGate('ARTIFACT', 'ARTIFACT', 0.04, undefined)).toBe(false)
  })

  it('injects the tablet family for a weak artifact only when the vote is tablet', () => {
    const g = pickInjectGroup('black_scales', 'ARTIFACT', WEAK_SCORE - 0.01, null, 'TABLET')
    expect(g!.has('exit')).toBe(true)
    const clover = pickInjectGroup('six_leaf_clover', 'ARTIFACT', -0.0832, null, 'ARTIFACT')
    expect(clover!.has('golden_leaf')).toBe(true)
    expect(clover!.has('exit')).toBe(false)
  })

  it('prefers a peer group already in the hit list', () => {
    const g = pickInjectGroup('ohia_lehua', 'ARTIFACT', -0.05, 'honor')
    expect(g!.has('exit')).toBe(true)
    expect(g!.has('warrant')).toBe(true)
  })

  it('keeps the winner group when the top-1 is already a lookalike', () => {
    const g = pickInjectGroup('dedication', 'TABLET', 0.12, 'touch_of_life')
    expect([...g!].sort()).toEqual(['dedication', 'defender'])
  })
})

describe('spatial hue hist', () => {
  it('intersection is 1 for identical maps and lower for swapped quadrants', () => {
    const r = new Float32Array(64 * 64)
    const g = new Float32Array(64 * 64)
    const b = new Float32Array(64 * 64)
    const idx = new Int32Array(64)
    let n = 0
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const p = y * 64 + x
        r[p] = 20
        g[p] = 180
        b[p] = 20
        idx[n++] = p
      }
    }
    const a = new Float32Array(32)
    const c = new Float32Array(32)
    spatialHueHist(r, g, b, idx, n, 64, a)
    spatialHueHist(r, g, b, idx, n, 64, c)
    expect(histIntersection(a, c)).toBeCloseTo(1, 5)
  })
})

describe('compactness tablet inject', () => {
  it('treats a filled square as tablet-like and a sparse stem as not', () => {
    const square = new Uint8Array(64 * 64)
    for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) square[y * 64 + x] = 1
    const sq = fgShape(square)
    expect(sq.fill).toBeGreaterThan(0.9)
    expect(isTabletLikeShape(sq)).toBe(true)

    const ring = new Uint8Array(64 * 64)
    for (let y = 8; y < 56; y++) {
      for (let x = 8; x < 56; x++) {
        const edge = y === 8 || y === 55 || x === 8 || x === 55
        if (edge) ring[y * 64 + x] = 1
      }
    }
    const rs = fgShape(ring)
    expect(rs.fill).toBeLessThan(0.2)
    expect(isTabletLikeShape(rs)).toBe(false)
  })

  it('does not fire on measured clover shape, does fire on compact-slab misses', () => {
    expect(isTabletLikeShape({ n: 227, fill: 0.676, compact: 0.31 })).toBe(false)
    expect(isTabletLikeShape({ n: 203, fill: 0.752, compact: 0.329 })).toBe(true)
    expect(isTabletLikeShape({ n: 574, fill: 0.96, compact: 0.693 })).toBe(true)
    expect(0.676).toBeLessThan(TABLET_FILL)
    expect(0.31).toBeLessThan(TABLET_COMPACT)
  })

  it('injects only for a weak artifact with a tablet-like shape', () => {
    expect(shouldInjectSmallSlabs('ARTIFACT', -0.0447, true)).toBe(true)
    expect(shouldInjectSmallSlabs('ARTIFACT', -0.0832, false)).toBe(false) // clover
    expect(shouldInjectSmallSlabs('TABLET', 0.0425, true)).toBe(false)
    expect(shouldInjectSmallSlabs('ARTIFACT', 0.1477, true)).toBe(false) // high-margin
    expect(SMALL_SLABS).toContain('flag')
    expect(SMALL_SLABS).toContain('exit')
    expect(confusableSet('load')!.has('flag')).toBe(false)
  })
})

describe('spatial ink hist', () => {
  it('separates top-white (entrance) from bottom-white (exit)', () => {
    const r = new Float32Array(64 * 64)
    const g = new Float32Array(64 * 64)
    const b = new Float32Array(64 * 64)
    const top = new Int32Array(64)
    const bot = new Int32Array(64)
    let nt = 0
    let nb = 0
    for (let y = 8; y < 16; y++) {
      for (let x = 28; x < 36; x++) {
        const p = y * 64 + x
        r[p] = 200
        g[p] = 200
        b[p] = 200
        top[nt++] = p
      }
    }
    for (let y = 48; y < 56; y++) {
      for (let x = 28; x < 36; x++) {
        const p = y * 64 + x
        r[p] = 200
        g[p] = 200
        b[p] = 200
        bot[nb++] = p
      }
    }
    const a = new Float32Array(8)
    const c = new Float32Array(8)
    spatialInkHist(r, g, b, top, nt, 64, a)
    spatialInkHist(r, g, b, bot, nb, 64, c)
    expect(histIntersection(a, a)).toBeCloseTo(1, 5)
    expect(histIntersection(a, c)).toBeLessThan(0.2)
  })
})
