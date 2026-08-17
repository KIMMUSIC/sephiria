import { describe, expect, it } from 'vitest'
import {
  WHITE_PAPER_VALUE,
  comboCounts,
  totalComboTiers,
  whitePaperOpportunities,
} from '@/lib/comboEngine'
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
  it('lists 호수 at 2 stacks — one more crosses the 3 threshold', () => {
    const slots = board()
    slots[at(0, 0)] = fromCatalog('dried_flower')
    slots[at(1, 0)] = fromCatalog('water_bag')

    const opportunities = whitePaperOpportunities(slots, ROWS)
    expect(opportunities).toHaveLength(1)
    expect(opportunities[0].slug).toBe('lake')
    expect(opportunities[0].ko).toBe('호수')
    expect(opportunities[0].count).toBe(2)
    expect(opportunities[0].nextTier.count).toBe(3)
  })

  it('skips 견고 at 2 stacks — 3 is not a threshold on 2/4/6/8/10', () => {
    const slots = board()
    slots[at(0, 0)] = fromCatalog('shield_technique_manual')
    slots[at(1, 0)] = fromCatalog('begonia_flavor_pocket')

    expect(whitePaperOpportunities(slots, ROWS)).toEqual([])
  })

  it('skips a combo with only one artifact even when +1 would cross a threshold', () => {
    // 연금술 thresholds are 1/2/3, so 1 + 1 = 2 does cross — but a 하얀 종이
    // needs a combo artifact on each side, so one is never enough.
    const slots = board()
    slots[at(0, 0)] = fromCatalog('reinforced_potion_lid')

    expect(whitePaperOpportunities(slots, ROWS)).toEqual([])
  })

  it('sorts candidates in COMBO_ORDER', () => {
    // 호수(lake) precedes 연금술(alchemy) in the wiki order.
    const slots = board()
    slots[at(0, 0)] = fromCatalog('reinforced_potion_lid')
    slots[at(0, 1)] = fromCatalog('angry_potato')
    slots[at(1, 0)] = fromCatalog('dried_flower')
    slots[at(1, 1)] = fromCatalog('water_bag')

    const opportunities = whitePaperOpportunities(slots, ROWS)
    expect(opportunities.map((o) => o.slug)).toEqual(['lake', 'alchemy'])
  })
})
