import { describe, expect, it } from 'vitest'
import {
  WHITE_PAPER_VALUE,
  comboCounts,
  totalComboTiers,
  whitePaperOpportunities,
} from '@/lib/comboEngine'
import { comboTiersMet } from '@/data/comboEffects'
import { buildScoreWeights, evaluateBoard } from '@/lib/optimizerScore'
import { buildGridRows, positionToSlot } from '@/lib/gridUtils'
import { ARTIFACT_MAP } from '@/data/artifacts'
import { getTabletEffect } from '@/data/tabletEffects'
import type { GridSlot, PlacedArtifact, PlacedTablet } from '@/types'

// 34 slots = five full rows of 6 plus a partial last row of 4.
const SLOT_NUM = 34
const ROWS = buildGridRows(SLOT_NUM)

function at(row: number, col: number): number {
  const index = positionToSlot(row, col, ROWS)
  if (index === null) throw new Error(`invalid ${row}-${col}`)
  return index
}

function tablet(value: string, rotation: 0 | 1 | 2 | 3 = 0): PlacedTablet {
  return {
    instanceId: `t-${value}-${rotation}`,
    type: 'TABLET',
    data: { value, ko_label: value, eng_label: value, tier: 'rare', image: '', rotate: true },
    effectDef: getTabletEffect(value) ?? { type: 'simple', effects: [] },
    rotation,
    isCustom: false,
  }
}

function fromCatalog(value: string, level = 0, extra: Partial<PlacedArtifact> = {}): PlacedArtifact {
  const data = ARTIFACT_MAP.get(value)
  if (!data) throw new Error(`unknown artifact ${value}`)
  return {
    instanceId: `a-${value}-${Math.random()}`,
    type: 'ARTIFACT',
    data,
    level,
    currentLevel: level,
    isLocked: false,
    priority: 'normal',
    targetLevel: null,
    ...extra,
  }
}

function board(): GridSlot[] {
  return new Array(SLOT_NUM).fill(null)
}

// Catalog artifacts used throughout:
//   shield_technique_manual — 견고(firmness) single tag
//   dried_flower, water_bag, straw — 호수(lake) single tag
//   libra, sealed_tejas — 결속, both tagged [yinggalbul, glacier]
//   white_paper — no sets, [고유] neighbour effect only

// ──────────────────────────────────────────────────────────────
describe('comboCounts — base stacks', () => {
  it('counts one stack per tag on a single-tag artifact', () => {
    const slots = board()
    slots[at(0, 0)] = fromCatalog('shield_technique_manual')

    const counts = comboCounts(slots, ROWS)
    expect(counts.get('firmness')).toEqual({
      slug: 'firmness', base: 1, whitePaper: 0, total: 1,
    })
    expect(counts.size).toBe(1)
  })

  it('counts a 결속 artifact toward both of its combos', () => {
    // 대립의 천칭 carries [yinggalbul, glacier].
    const slots = board()
    slots[at(0, 0)] = fromCatalog('libra')

    const counts = comboCounts(slots, ROWS)
    expect(counts.get('yinggalbul')?.base).toBe(1)
    expect(counts.get('glacier')?.base).toBe(1)
    expect(counts.size).toBe(2)
  })

  it('gives 하얀 종이 itself no base stack — it has no sets', () => {
    const slots = board()
    slots[at(0, 0)] = fromCatalog(WHITE_PAPER_VALUE)
    expect(comboCounts(slots, ROWS).size).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────
describe('comboCounts — 하얀 종이', () => {
  it('adds +1 when both neighbours share the same combo', () => {
    const slots = board()
    slots[at(0, 0)] = fromCatalog('dried_flower')
    slots[at(0, 1)] = fromCatalog(WHITE_PAPER_VALUE)
    slots[at(0, 2)] = fromCatalog('water_bag')

    const counts = comboCounts(slots, ROWS)
    expect(counts.get('lake')).toEqual({
      slug: 'lake', base: 2, whitePaper: 1, total: 3,
    })
  })

  it('adds nothing when the neighbours belong to different combos', () => {
    const slots = board()
    slots[at(0, 0)] = fromCatalog('dried_flower')
    slots[at(0, 1)] = fromCatalog(WHITE_PAPER_VALUE)
    slots[at(0, 2)] = fromCatalog('shield_technique_manual')

    const counts = comboCounts(slots, ROWS)
    expect(counts.get('lake')?.whitePaper).toBe(0)
    expect(counts.get('firmness')?.whitePaper).toBe(0)
  })

  it('adds nothing at the left or right end of a row', () => {
    // Left end: the left neighbour is off-grid.
    const leftEnd = board()
    leftEnd[at(0, 0)] = fromCatalog(WHITE_PAPER_VALUE)
    leftEnd[at(0, 1)] = fromCatalog('dried_flower')
    expect(comboCounts(leftEnd, ROWS).get('lake')?.whitePaper).toBe(0)

    // Right end: the right neighbour is off-grid.
    const rightEnd = board()
    rightEnd[at(0, 4)] = fromCatalog('dried_flower')
    rightEnd[at(0, 5)] = fromCatalog(WHITE_PAPER_VALUE)
    expect(comboCounts(rightEnd, ROWS).get('lake')?.whitePaper).toBe(0)
  })

  it('adds nothing when one side is a tablet or an empty cell', () => {
    // Tablet on one side.
    const withTablet = board()
    withTablet[at(0, 0)] = fromCatalog('dried_flower')
    withTablet[at(0, 1)] = fromCatalog(WHITE_PAPER_VALUE)
    withTablet[at(0, 2)] = tablet('cheer')
    expect(comboCounts(withTablet, ROWS).get('lake')?.whitePaper).toBe(0)

    // Empty cell on one side.
    const withGap = board()
    withGap[at(0, 0)] = fromCatalog('dried_flower')
    withGap[at(0, 1)] = fromCatalog(WHITE_PAPER_VALUE)
    expect(comboCounts(withGap, ROWS).get('lake')?.whitePaper).toBe(0)
  })

  it('applies each 하얀 종이 independently', () => {
    // lake, WP, lake, WP, lake — each paper sits between two lake artifacts.
    const slots = board()
    slots[at(0, 0)] = fromCatalog('dried_flower')
    slots[at(0, 1)] = fromCatalog(WHITE_PAPER_VALUE)
    slots[at(0, 2)] = fromCatalog('water_bag')
    slots[at(0, 3)] = fromCatalog(WHITE_PAPER_VALUE)
    slots[at(0, 4)] = fromCatalog('straw')

    const counts = comboCounts(slots, ROWS)
    expect(counts.get('lake')).toEqual({
      slug: 'lake', base: 3, whitePaper: 2, total: 5,
    })
  })

  it('adds +1 to every combo two 결속 neighbours share', () => {
    // 대립의 천칭 and 봉인된 테자스 both carry [yinggalbul, glacier], so the one
    // 하얀 종이 between them bumps both combos — "해당 콤보" read literally.
    const slots = board()
    slots[at(0, 0)] = fromCatalog('libra')
    slots[at(0, 1)] = fromCatalog(WHITE_PAPER_VALUE)
    slots[at(0, 2)] = fromCatalog('sealed_tejas')

    const counts = comboCounts(slots, ROWS)
    expect(counts.get('yinggalbul')).toEqual({
      slug: 'yinggalbul', base: 2, whitePaper: 1, total: 3,
    })
    expect(counts.get('glacier')).toEqual({
      slug: 'glacier', base: 2, whitePaper: 1, total: 3,
    })
  })
})

// ──────────────────────────────────────────────────────────────
describe('totalComboTiers', () => {
  it('sums the tiers reached across combos with different thresholds', () => {
    // 견고 2/4/6/8/10 → 2 stacks reach 1 tier. 호수 3/6/9 → 3 stacks reach 1 tier.
    const slots = board()
    slots[at(0, 0)] = fromCatalog('shield_technique_manual')
    slots[at(0, 1)] = fromCatalog('begonia_flavor_pocket')
    slots[at(1, 0)] = fromCatalog('dried_flower')
    slots[at(1, 1)] = fromCatalog('water_bag')
    slots[at(1, 2)] = fromCatalog('straw')

    expect(totalComboTiers(comboCounts(slots, ROWS))).toBe(2)
  })

  it('counts the 하얀 종이 stack toward tiers', () => {
    // 호수 base 2 reaches no tier; +1 from the paper crosses the 3 threshold.
    const slots = board()
    slots[at(0, 0)] = fromCatalog('dried_flower')
    slots[at(0, 1)] = fromCatalog(WHITE_PAPER_VALUE)
    slots[at(0, 2)] = fromCatalog('water_bag')

    expect(totalComboTiers(comboCounts(slots, ROWS))).toBe(1)
  })
})

// ──────────────────────────────────────────────────────────────
describe('whitePaperOpportunities', () => {
  /** 종이 한 장을 항상 보드에 놓는다 — 종이가 없으면 기회 자체가 없다. */
  function withPaper(values: string[], paperAt = at(4, 0)): GridSlot[] {
    const slots = board()
    values.forEach((v, i) => {
      slots[at(Math.floor(i / 6), i % 6)] = fromCatalog(v)
    })
    slots[paperAt] = fromCatalog(WHITE_PAPER_VALUE)
    return slots
  }

  it('lists 호수 at 2 stacks — one more crosses the 3 threshold', () => {
    const slots = withPaper(['dried_flower', 'water_bag'])

    const opportunities = whitePaperOpportunities(slots, ROWS)
    expect(opportunities).toHaveLength(1)
    expect(opportunities[0].slug).toBe('lake')
    expect(opportunities[0].ko).toBe('호수')
    expect(opportunities[0].base).toBe(2)
    expect(opportunities[0].achievable).toBe(3)
    expect(opportunities[0].nextTier!.count).toBe(3)
  })

  it('skips 견고 at 2 stacks — 3 is not a threshold on 2/4/6/8/10', () => {
    const slots = withPaper(['shield_technique_manual', 'begonia_flavor_pocket'])

    expect(whitePaperOpportunities(slots, ROWS)).toEqual([])
  })

  it('skips a combo with only one artifact even when +1 would cross a threshold', () => {
    // 연금술 thresholds are 1/2/3, so 1 + 1 = 2 does cross — but a 하얀 종이
    // needs a combo artifact on each side, so one is never enough.
    const slots = withPaper(['reinforced_potion_lid'])

    expect(whitePaperOpportunities(slots, ROWS)).toEqual([])
  })

  it('offers nothing with no 하얀 종이 on the board', () => {
    const slots = board()
    slots[at(0, 0)] = fromCatalog('dried_flower')
    slots[at(0, 1)] = fromCatalog('water_bag')

    expect(whitePaperOpportunities(slots, ROWS)).toEqual([])
  })

  // 사용자가 보고한 회귀: 바람노래 기본 6 + 종이 1 = 총 7 인 보드에서
  // 7→8 을 권했다. 종이는 한 장뿐이라 8 은 도달할 수 없는 목표였다.
  it('does not offer a target that needs a second 하얀 종이', () => {
    const six = [
      'windpool_shawl',
      'compression_band',
      'thornbush',
      'gold_cloak',
      'vane',
      'sheet_music_bree',
    ]
    // 종이가 이미 양옆에 붙어 기여하고 있는 상태를 만든다 (총 7).
    const slots = board()
    slots[at(0, 0)] = fromCatalog(six[0])
    slots[at(0, 1)] = fromCatalog(WHITE_PAPER_VALUE)
    slots[at(0, 2)] = fromCatalog(six[1])
    six.slice(2).forEach((v, i) => {
      slots[at(1, i)] = fromCatalog(v)
    })

    const counts = comboCounts(slots, ROWS)
    expect(counts.get('spring_song')).toMatchObject({ base: 6, whitePaper: 1, total: 7 })
    // 기본 6 에서 종이 한 장으로 닿는 최대가 7 이고, 7 은 임계값이 아니다.
    expect(whitePaperOpportunities(slots, ROWS).map((o) => o.slug)).not.toContain('spring_song')
  })

  it('offers 바람노래 once a seventh tagged artifact makes 8 reachable', () => {
    const seven = [
      'windpool_shawl',
      'compression_band',
      'thornbush',
      'gold_cloak',
      'vane',
      'sheet_music_bree',
      'silver_bracelet',
    ]
    const slots = board()
    seven.forEach((v, i) => {
      slots[at(Math.floor(i / 6), i % 6)] = fromCatalog(v)
    })
    slots[at(4, 0)] = fromCatalog(WHITE_PAPER_VALUE)

    const found = whitePaperOpportunities(slots, ROWS).find((o) => o.slug === 'spring_song')
    expect(found).toBeDefined()
    expect(found!.base).toBe(7)
    expect(found!.achievable).toBe(8)
    expect(found!.nextTier!.count).toBe(8)
  })

  it('sorts candidates in COMBO_ORDER', () => {
    // 호수(lake) precedes 연금술(alchemy) in the wiki order.
    const slots = board()
    slots[at(0, 0)] = fromCatalog('reinforced_potion_lid')
    slots[at(0, 1)] = fromCatalog('angry_potato')
    slots[at(1, 0)] = fromCatalog('dried_flower')
    slots[at(1, 1)] = fromCatalog('water_bag')
    slots[at(4, 0)] = fromCatalog(WHITE_PAPER_VALUE)

    const opportunities = whitePaperOpportunities(slots, ROWS)
    expect(opportunities.map((o) => o.slug)).toEqual(['lake', 'alchemy'])
  })
})

// ──────────────────────────────────────────────────────────────
// 목표 콤보 밴드는 단계 수가 아니라 스택 수를 센다. 단계 수만 세면 임계값
// 사이에서 점수가 평평해져 최적화기가 하얀 종이를 제자리에 붙일 이유를 잃는다.
describe('comboGoal band gradient', () => {
  const SIX = [
    'windpool_shawl',
    'compression_band',
    'thornbush',
    'gold_cloak',
    'vane',
    'sheet_music_bree',
  ]

  /** 종이를 flanked=true 면 바람노래 둘 사이에, false 면 멀리 떨어뜨려 놓는다. */
  function build(flanked: boolean): GridSlot[] {
    const slots = board()
    slots[at(0, 0)] = fromCatalog(SIX[0])
    slots[at(0, 2)] = fromCatalog(SIX[1])
    SIX.slice(2).forEach((v, i) => {
      slots[at(1, i)] = fromCatalog(v)
    })
    slots[flanked ? at(0, 1) : at(3, 0)] = fromCatalog(WHITE_PAPER_VALUE)
    return slots
  }

  it('바람노래 스택 6과 7은 도달 단계가 같다 — 단계만 세면 기울기가 없다', () => {
    expect(comboTiersMet('spring_song', 6)).toBe(comboTiersMet('spring_song', 7))
  })

  it('임계값을 넘기지 못해도 종이가 목표 콤보에 붙은 배치를 더 높게 친다', () => {
    const flanked = build(true)
    const adrift = build(false)

    expect(comboCounts(flanked, ROWS).get('spring_song')!.total).toBe(7)
    expect(comboCounts(adrift, ROWS).get('spring_song')!.total).toBe(6)

    const config = { targetCombo: 'spring_song' }
    const weights = buildScoreWeights(flanked, config)
    expect(evaluateBoard(flanked, ROWS, weights, config)).toBeGreaterThan(
      evaluateBoard(adrift, ROWS, weights, config)
    )
  })

  it('목표 콤보가 없으면 두 배치의 점수 차가 최상위 밴드에서 나오지 않는다', () => {
    const weights = buildScoreWeights(build(true))
    const flankedScore = evaluateBoard(build(true), ROWS, weights)
    const adriftScore = evaluateBoard(build(false), ROWS, weights)
    // comboAll 은 단계 수라 6과 7이 같은 값 — 목표를 지정하지 않으면 동점이다.
    expect(flankedScore).toBe(adriftScore)
  })
})
