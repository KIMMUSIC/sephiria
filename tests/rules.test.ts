import { beforeEach, describe, expect, it } from 'vitest'
import {
  parseConstraint,
  isEdgeCell,
  isInnerCell,
  isTopCell,
  isBottomCell,
  hasBothSidesEmpty,
  resolveConstraintStatus,
} from '@/lib/constraints'
import { calculateBoardEffects } from '@/lib/effectEngine'
import {
  buildScoreWeights,
  evaluateBoard,
  evaluateBoardDetail,
  finalLevelOf,
} from '@/lib/optimizerScore'
import { COMBO_EFFECTS, maxComboTiers } from '@/data/comboEffects'
import { activationConditionsOf, isRotatable, grantsConstraintIgnore } from '@/lib/tabletMeta'
import { buildGridRows, positionToSlot } from '@/lib/gridUtils'
import { ARTIFACT_MAP } from '@/data/artifacts'
import { TABLET_MAP } from '@/data/tablets'
import { useInventoryStore } from '@/store/inventoryStore'
import { getTabletEffect } from '@/data/tabletEffects'
import type {
  ArtifactData,
  ArtifactPriority,
  FusedSource,
  GridSlot,
  PlacedArtifact,
  PlacedTablet,
} from '@/types'

function src(value: string, rotation: 0 | 1 | 2 | 3 = 0): FusedSource {
  return { value, rotation }
}

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
    instanceId: `a-${value}`,
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

function synthetic(
  id: string,
  maxLevel: number,
  level: number,
  priority: ArtifactPriority = 'normal',
  targetLevel: number | null = null
): PlacedArtifact {
  const data: ArtifactData = {
    id: 1,
    value: id,
    label_kor: id,
    label_eng: id,
    tier: 'common',
    level: maxLevel,
    image: '',
    effect: { sets: [], content: '' },
    description: '',
  }
  return {
    instanceId: id,
    type: 'ARTIFACT',
    data,
    level,
    currentLevel: level,
    isLocked: false,
    priority,
    targetLevel,
  }
}

function board(): GridSlot[] {
  return new Array(SLOT_NUM).fill(null)
}

// ──────────────────────────────────────────────────────────────
describe('<제약> parsing', () => {
  const EXPECTED: Record<string, string> = {
    silver_plate: 'bottom',
    thornbush: 'inner',
    magic_carrot: 'top',
    keel_fragment: 'edge',
    cold_lock: 'bothSidesEmpty',
    gap: 'edge',
    swordsmanship_textbook: 'top',
    multi_use_belt: 'bottom',
    warm_stone: 'inner',
    riley_congregation_clock: 'bottom',
    green_ink_bottle_v2: 'edge',
  }

  it('classifies every constrained artifact in the catalog', () => {
    for (const [value, kind] of Object.entries(EXPECTED)) {
      const data = ARTIFACT_MAP.get(value)
      expect(data, value).toBeDefined()
      expect(parseConstraint(data!.effect.content), value).toBe(kind)
    }
  })

  it('finds no constraint on artifacts without a <제약> line', () => {
    const plain = ARTIFACT_MAP.get('reinforced_potion_lid')
    expect(plain).toBeDefined()
    expect(parseConstraint(plain!.effect.content)).toBeNull()
  })

  it('recognises exactly the catalog artifacts that carry <제약>', () => {
    const found = Array.from(ARTIFACT_MAP.values()).filter((a) =>
      parseConstraint(a.effect?.content)
    )
    expect(found.map((a) => a.value).sort()).toEqual(Object.keys(EXPECTED).sort())
  })
})

// ──────────────────────────────────────────────────────────────
describe('제약 geometry on a partial last row (34 = 6×5 + 4)', () => {
  it('treats any cell with a missing orthogonal neighbour as 가장자리', () => {
    // Whole first row.
    for (let c = 0; c < 6; c++) expect(isEdgeCell({ row: 0, col: c }, ROWS), `0-${c}`).toBe(true)
    // Both side columns.
    for (let r = 0; r < 5; r++) {
      expect(isEdgeCell({ row: r, col: 0 }, ROWS), `${r}-0`).toBe(true)
      expect(isEdgeCell({ row: r, col: 5 }, ROWS), `${r}-5`).toBe(true)
    }
    // The whole partial last row.
    for (let c = 0; c < 4; c++) expect(isEdgeCell({ row: 5, col: c }, ROWS), `5-${c}`).toBe(true)
  })

  it('counts the step left by the partial row as 가장자리', () => {
    // (4,4) has no cell beneath it because row 5 stops at column 3.
    expect(isEdgeCell({ row: 4, col: 4 }, ROWS)).toBe(true)
    // (4,3) still sits on top of (5,3), so it stays 안쪽.
    expect(isEdgeCell({ row: 4, col: 3 }, ROWS)).toBe(false)
  })

  it('makes 안쪽 the exact complement of 가장자리', () => {
    const inner: string[] = []
    for (const row of ROWS) {
      for (let col = 0; col < row.cols; col++) {
        const pos = { row: row.rowIndex, col }
        expect(isInnerCell(pos, ROWS)).toBe(!isEdgeCell(pos, ROWS))
        if (isInnerCell(pos, ROWS)) inner.push(`${pos.row}-${pos.col}`)
      }
    }
    expect(inner).toEqual([
      '1-1', '1-2', '1-3', '1-4',
      '2-1', '2-2', '2-3', '2-4',
      '3-1', '3-2', '3-3', '3-4',
      '4-1', '4-2', '4-3',
    ])
  })

  it('reads 최상단 as the whole first row', () => {
    for (let c = 0; c < 6; c++) expect(isTopCell({ row: 0, col: c }, ROWS)).toBe(true)
    expect(isTopCell({ row: 1, col: 0 }, ROWS)).toBe(false)
  })

  it('reads 최하단 as the bottom-most cell of each column', () => {
    // Columns 0-3 bottom out on the partial last row…
    for (let c = 0; c < 4; c++) expect(isBottomCell({ row: 5, col: c }, ROWS), `5-${c}`).toBe(true)
    // …columns 4 and 5 one row earlier.
    expect(isBottomCell({ row: 4, col: 4 }, ROWS)).toBe(true)
    expect(isBottomCell({ row: 4, col: 5 }, ROWS)).toBe(true)
    expect(isBottomCell({ row: 4, col: 0 }, ROWS)).toBe(false)
  })

  it('never satisfies 양쪽 칸이 모두 비어 있을 때 when a side is off-grid', () => {
    // Verified in-game: cold_lock needs two *real* inventory cells, both empty.
    // A missing neighbour at a row end can never count as an empty cell.
    const slots = board()
    // (0,0): the cells around it are empty, but the left neighbour is off-grid.
    expect(hasBothSidesEmpty({ row: 0, col: 0 }, slots, ROWS)).toBe(false)
    // (0,5): the right neighbour is off-grid.
    expect(hasBothSidesEmpty({ row: 0, col: 5 }, slots, ROWS)).toBe(false)
    // (5,3): last cell of the partial last row — the right neighbour is off-grid.
    expect(hasBothSidesEmpty({ row: 5, col: 3 }, slots, ROWS)).toBe(false)

    // (0,1): (0,0) and (0,2) both exist and are empty.
    expect(hasBothSidesEmpty({ row: 0, col: 1 }, slots, ROWS)).toBe(true)
    // (0,1) with an item at (0,2).
    slots[at(0, 2)] = synthetic('blocker', 3, 0)
    expect(hasBothSidesEmpty({ row: 0, col: 1 }, slots, ROWS)).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────
describe('제약 무시 석판', () => {
  it('names exactly 고양, 이음, 환대', () => {
    expect(grantsConstraintIgnore('home_town')).toBe(true)
    expect(grantsConstraintIgnore('connection')).toBe(true)
    expect(grantsConstraintIgnore('hospitality')).toBe(true)
    expect(grantsConstraintIgnore('base')).toBe(false)
    expect(grantsConstraintIgnore('cheer')).toBe(false)
  })

  it('reports 따뜻한 돌 as met inside, unmet on the edge, waived under 고양', () => {
    const inner = board()
    inner[at(2, 2)] = fromCatalog('warm_stone')
    let ignore = calculateBoardEffects(inner, ROWS).constraintIgnore
    expect(resolveConstraintStatus('inner', at(2, 2), inner, ROWS, ignore)).toBe('met')

    const edge = board()
    edge[at(0, 1)] = fromCatalog('warm_stone')
    ignore = calculateBoardEffects(edge, ROWS).constraintIgnore
    expect(resolveConstraintStatus('inner', at(0, 1), edge, ROWS, ignore)).toBe('unmet')

    // 고양 at (0,0) waives the cell to its right at rotation 0.
    const rescued = board()
    rescued[at(0, 0)] = tablet('home_town', 0)
    rescued[at(0, 1)] = fromCatalog('warm_stone')
    ignore = calculateBoardEffects(rescued, ROWS).constraintIgnore
    expect(resolveConstraintStatus('inner', at(0, 1), rescued, ROWS, ignore)).toBe('waived')
  })

  it('cannot rescue a level-based 무효 — that is not the artifact own 제약', () => {
    // "효과 무효는 인게임에서 제약으로 표기되지만, 아티팩트 자체의 제약이 아니므로
    //  석판이 가진 제약 무시 효과로 무시할 수 없다" — namu.wiki/w/세피리아/석판
    // 응집 drives its whole row to -1. 따뜻한 돌 sits on the top row, so its 안쪽
    // constraint is unmet and only 고양 waives it — yet the level still kills it.
    const slots = board()
    slots[at(0, 0)] = tablet('agglutination', 0)
    slots[at(0, 1)] = tablet('home_town', 0)
    slots[at(0, 2)] = fromCatalog('warm_stone', 0)

    const detail = evaluateBoardDetail(slots, ROWS)
    const evaluation = detail.artifacts.find((a) => a.slotIndex === at(0, 2))
    expect(evaluation).toBeDefined()
    // The placement constraint really is waived…
    expect(evaluation!.constraintStatus).toBe('waived')
    // …and the artifact is still dead, because -1 is a different rule.
    expect(evaluation!.finalLevel).toBe(-1)
    expect(detail.destroyed).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────
describe('인챈트 and the star cap', () => {
  it('caps the final level at the star maximum, wasting the surplus', () => {
    const artifact = synthetic('capped', 3, 3)
    expect(finalLevelOf(artifact, 0)).toBe(3)
    expect(finalLevelOf(artifact, 5)).toBe(3)
    expect(finalLevelOf(artifact, -1)).toBe(2)
  })

  it('lets a debuff drive an artifact below zero even from full enchant', () => {
    const artifact = synthetic('fragile', 1, 1)
    expect(finalLevelOf(artifact, -3)).toBe(-2)
  })

  it('adds enchant and tablet levels into the same pool', () => {
    const slots = board()
    // 환호 buffs the cell above it by +1.
    slots[at(3, 2)] = tablet('cheer', 0)
    slots[at(2, 2)] = synthetic('mix', 5, 2)

    const detail = evaluateBoardDetail(slots, ROWS)
    const evaluation = detail.artifacts[0]
    expect(evaluation.bonus).toBe(1)
    expect(evaluation.finalLevel).toBe(3)
  })
})

// ──────────────────────────────────────────────────────────────
describe('lexicographic objective', () => {
  it('prefers a high-priority goal over a larger plain level sum', () => {
    // Board A reaches the goal; board B trades it for +10 elsewhere.
    const makeBoard = (goalLevel: number, otherLevel: number): GridSlot[] => {
      const slots = board()
      slots[at(2, 1)] = synthetic('goal', 3, goalLevel, 'high', 3)
      slots[at(2, 2)] = synthetic('other1', 5, otherLevel)
      slots[at(2, 3)] = synthetic('other2', 5, otherLevel)
      return slots
    }

    const reachesGoal = makeBoard(3, 0)
    const biggerSum = makeBoard(2, 5)

    const weights = buildScoreWeights(reachesGoal)
    expect(buildScoreWeights(biggerSum).goalHigh).toBe(weights.goalHigh)

    expect(evaluateBoard(reachesGoal, ROWS, weights)).toBeGreaterThan(
      evaluateBoard(biggerSum, ROWS, weights)
    )
  })

  it('ranks a high-priority goal above a normal-priority goal', () => {
    const slots = board()
    slots[at(2, 1)] = synthetic('hi', 3, 3, 'high', 3)
    slots[at(2, 2)] = synthetic('mid', 3, 0, 'normal', 3)
    const weights = buildScoreWeights(slots)

    const swapped = board()
    swapped[at(2, 1)] = synthetic('hi', 3, 0, 'high', 3)
    swapped[at(2, 2)] = synthetic('mid', 3, 3, 'normal', 3)

    expect(evaluateBoard(slots, ROWS, weights)).toBeGreaterThan(
      evaluateBoard(swapped, ROWS, weights)
    )
  })

  it('treats an untargeted 높음 artifact as aiming for 풀강', () => {
    // Otherwise a throwaway item's 1강 target would sit in a band above the entire
    // level sum and outrank fully enhancing the item the user actually marked 높음.
    const make = (favouriteLevel: number, junkLevel: number): GridSlot[] => {
      const slots = board()
      slots[at(2, 1)] = synthetic('favourite', 5, favouriteLevel, 'high', null)
      slots[at(2, 2)] = synthetic('junk', 3, junkLevel, 'normal', 1)
      return slots
    }
    const weights = buildScoreWeights(make(0, 0))
    expect(weights.goalHigh).toBeGreaterThan(weights.goalNormal)

    // Fully enhancing the 높음 item beats hitting the junk item's 1강.
    expect(evaluateBoard(make(5, 0), ROWS, weights)).toBeGreaterThan(
      evaluateBoard(make(0, 1), ROWS, weights)
    )

    const detail = evaluateBoardDetail(make(5, 1), ROWS, weights)
    const favourite = detail.artifacts.find((a) => a.artifact.instanceId === 'favourite')
    expect(favourite!.target).toBe(5)
    expect(favourite!.goalMet).toBe(true)
  })

  it('leaves an untargeted 보통 artifact with no goal at all', () => {
    const slots = board()
    slots[at(2, 2)] = synthetic('plain', 5, 2, 'normal', null)
    const evaluation = evaluateBoardDetail(slots, ROWS).artifacts[0]
    expect(evaluation.target).toBeNull()
  })

  it('does not count levels above the target', () => {
    const withTarget = (level: number): GridSlot[] => {
      const slots = board()
      slots[at(2, 2)] = synthetic('t', 5, level, 'normal', 2)
      return slots
    }
    const weights = buildScoreWeights(withTarget(2))
    expect(evaluateBoard(withTarget(5), ROWS, weights)).toBe(
      evaluateBoard(withTarget(2), ROWS, weights)
    )
  })

  it('lets one level of a normal artifact outweigh a fully enhanced excluded one', () => {
    const make = (normalLevel: number, excludedLevel: number): GridSlot[] => {
      const slots = board()
      slots[at(2, 1)] = synthetic('keep', 5, normalLevel)
      slots[at(2, 2)] = synthetic('set-only', 5, excludedLevel, 'exclude')
      return slots
    }
    const weights = buildScoreWeights(make(0, 0))
    expect(evaluateBoard(make(1, 0), ROWS, weights)).toBeGreaterThan(
      evaluateBoard(make(0, 5), ROWS, weights)
    )
  })

  it('still rejects a board that destroys an excluded artifact', () => {
    const slots = board()
    slots[at(2, 0)] = tablet('agglutination', 0)
    slots[at(2, 2)] = synthetic('set-only', 5, 0, 'exclude')
    expect(evaluateBoardDetail(slots, ROWS).destroyed).toBe(true)
  })

  it('keeps the structural tie-breaker band below one unit of the band above it', () => {
    // A 합성 석판 replays one effect set per source, and 배수진 spills 3 negative effects
    // off a corner. Chain enough fusions and the raw OOB count passes what an unclamped
    // structural band could hold, which would let wasted-debuff count outrank a
    // high-priority goal. STRUCT_TIEBREAK_CAP is what stops that.
    const sources = new Array(4000).fill(null).map(() => src('last_stand'))
    const fused = {
      ...tablet('last_stand', 0),
      effectDef: { type: 'fused' as const, sources },
      fusedFrom: sources,
    }

    const make = (tabletRow: number, tabletCol: number, artifactLevel: number): GridSlot[] => {
      const slots = board()
      slots[at(tabletRow, tabletCol)] = fused
      slots[at(2, 2)] = synthetic('goal', 5, artifactLevel, 'high', 1)
      return slots
    }

    // Corner placement wastes a huge number of debuffs off-grid but misses the goal.
    const missesGoal = make(5, 0, 0)
    // A placement far from the artifact meets the goal and wastes nothing.
    const meetsGoal = make(0, 5, 1)

    const weights = buildScoreWeights(missesGoal)
    const missed = evaluateBoardDetail(missesGoal, ROWS, weights)
    const met = evaluateBoardDetail(meetsGoal, ROWS, weights)

    expect(missed.artifacts[0].goalMet).toBe(false)
    expect(met.artifacts[0].goalMet).toBe(true)
    expect(met.score).toBeGreaterThan(missed.score)
  })

  it('keeps every band product inside the safe integer range on a full board', () => {
    const slots: GridSlot[] = new Array(60).fill(null)
    for (let i = 0; i < 60; i++) {
      const priority: ArtifactPriority =
        i % 4 === 0 ? 'exclude' : i % 4 === 1 ? 'high' : 'normal'
      const target = i % 2 === 0 ? null : 14
      slots[i] = synthetic(`a${i}`, 14, 14, priority, target)
    }
    const weights = buildScoreWeights(slots)
    const worstCase = weights.goalHigh * 60 * 14
    expect(Number.isFinite(worstCase)).toBe(true)
    expect(worstCase).toBeLessThan(Number.MAX_SAFE_INTEGER)
  })

  it('keeps the top comboGoal band unit inside the safe integer range on a full 60-cell board', () => {
    // 사슬 최상단이 Number.MAX_SAFE_INTEGER 를 넘으면 정수 정밀도가 깨져 밴드가
    // 붕괴한다. 모든 콤보 태그를 단 60칸 꽉 찬 보드 + 목표 콤보라는 최악 조건에서
    // comboGoalUnit * (상한+1) 이 안전 범위 안임을 단언한다 — COMBO_TIEBREAK_CAP 가
    // comboAll 밴드를 클램프해서 지켜 주는 성질이다.
    const allSlugs = Object.keys(COMBO_EFFECTS)
    const slots: GridSlot[] = new Array(60).fill(null)
    for (let i = 0; i < 60; i++) {
      const priority: ArtifactPriority =
        i % 4 === 0 ? 'exclude' : i % 4 === 1 ? 'high' : 'normal'
      const target = i % 2 === 0 ? null : 14
      const artifact = synthetic(`c${i}`, 14, 14, priority, target)
      artifact.data.effect.sets = allSlugs
      slots[i] = artifact
    }
    const weights = buildScoreWeights(slots, {
      targetCombo: 'firmness',
      cellLevels: new Array(60).fill(9),
    })
    const topBand = weights.comboGoal * (maxComboTiers('firmness') + 1)
    expect(Number.isFinite(topBand)).toBe(true)
    expect(topBand).toBeLessThan(Number.MAX_SAFE_INTEGER)
  })

  it('reports 목표 달성 on the level alone, leaving 제약 to its own counter', () => {
    // 따뜻한 돌 on the edge with its level target reached: the level goal IS met, and
    // the unmet 제약 is reported separately rather than counted as a second failure.
    const slots = board()
    slots[at(0, 1)] = fromCatalog('warm_stone', 3, { priority: 'high', targetLevel: 3 })
    const evaluation = evaluateBoardDetail(slots, ROWS).artifacts[0]

    expect(evaluation.finalLevel).toBe(3)
    expect(evaluation.goalMet).toBe(true)
    expect(evaluation.constraintStatus).toBe('unmet')
  })

  it('rewards satisfying a <제약> over leaving it unmet', () => {
    const place = (row: number, col: number): GridSlot[] => {
      const slots = board()
      slots[at(row, col)] = fromCatalog('warm_stone')
      return slots
    }
    const weights = buildScoreWeights(place(2, 2))
    expect(evaluateBoard(place(2, 2), ROWS, weights)).toBeGreaterThan(
      evaluateBoard(place(0, 0), ROWS, weights)
    )
  })
})

// ──────────────────────────────────────────────────────────────
describe('석판 합성', () => {
  it('sums the per-cell values of both sources', () => {
    // 악수 (±1 vertical) fused with 수확 (±2 vertical) gives ±3 — the wiki says the
    // product "전설 등급 평화 석판과 동일하게 사용할 수 있다", and 평화 is ±3.
    const slots = board()
    slots[at(2, 2)] = {
      ...tablet('handshake', 0),
      effectDef: { type: 'fused', sources: [src('handshake'), src('harvesting')] },
      fusedFrom: [src('handshake'), src('harvesting')],
    }
    const { effects } = calculateBoardEffects(slots, ROWS)
    expect(effects['1-2']).toBe(3)
    expect(effects['3-2']).toBe(3)
    expect(effects['2-1']).toBe(0)
  })

  it('doubles a source that is used twice', () => {
    // "차양이 2개 이상인 경우 차양끼리 석판 합성을 하면" — the same tablet may be both
    // materials, and its values must add rather than collapse to one copy.
    const slots = board()
    slots[at(2, 2)] = {
      ...tablet('handshake', 0),
      effectDef: { type: 'fused', sources: [src('handshake'), src('handshake')] },
      fusedFrom: [src('handshake'), src('handshake')],
    }
    const { effects } = calculateBoardEffects(slots, ROWS)
    expect(effects['1-2']).toBe(2)
    expect(effects['3-2']).toBe(2)
  })

  it('unions the 제약 무시 areas of both sources', () => {
    const slots = board()
    slots[at(2, 2)] = {
      ...tablet('home_town', 0),
      effectDef: { type: 'fused', sources: [src('home_town'), src('connection')] },
      fusedFrom: [src('home_town'), src('connection')],
    }
    const { effects, constraintIgnore } = calculateBoardEffects(slots, ROWS)
    // 고양 waives the right cell, 이음 waives the cell below and adds +2 above.
    expect(constraintIgnore.has('2-3')).toBe(true)
    expect(constraintIgnore.has('3-2')).toBe(true)
    expect(effects['1-2']).toBe(2)
  })

  it('replays a complex source so its position condition still gates it', () => {
    const fused = {
      effectDef: { type: 'fused' as const, sources: [src('linear'), src('handshake')] },
      fusedFrom: [src('linear'), src('handshake')],
    }

    // 선의 only fires on 최하단; off the bottom row only 악수 contributes.
    const middle = board()
    middle[at(2, 2)] = { ...tablet('handshake', 0), ...fused }
    expect(calculateBoardEffects(middle, ROWS).effects['2-1']).toBe(0)
    expect(calculateBoardEffects(middle, ROWS).effects['1-2']).toBe(1)

    // On the last row 선의 adds its left/right +1.
    const bottom = board()
    bottom[at(5, 2)] = { ...tablet('handshake', 0), ...fused }
    expect(calculateBoardEffects(bottom, ROWS).effects['5-1']).toBe(1)
    expect(calculateBoardEffects(bottom, ROWS).effects['5-3']).toBe(1)
  })

  it('cancels a + and a - that land on the same cell', () => {
    // 환호 puts +1 on the cell above. 도래 turned 180° puts -1 there. Fused, they net 0.
    const slots = board()
    slots[at(2, 2)] = {
      ...tablet('cheer', 0),
      effectDef: { type: 'fused', sources: [src('cheer'), src('advent', 2)] },
      fusedFrom: [src('cheer'), src('advent', 2)],
    }
    const { effects } = calculateBoardEffects(slots, ROWS)

    expect(effects['1-2']).toBe(0) // +1 from 환호 and -1 from the turned 도래
    expect(effects['0-2']).toBe(-1) // 도래's outer debuff, with nothing to cancel it
    expect(effects['3-2']).toBe(1) // 도래's buff, now pointing down
  })

  it('lets a rotatable material be turned before it is combined', () => {
    // 악수 is a vertical ±1. Turned 90° and fused with an upright copy it makes a cross.
    const slots = board()
    slots[at(2, 2)] = {
      ...tablet('handshake', 0),
      effectDef: { type: 'fused', sources: [src('handshake', 0), src('handshake', 1)] },
      fusedFrom: [src('handshake', 0), src('handshake', 1)],
    }
    const { effects } = calculateBoardEffects(slots, ROWS)

    expect(effects['1-2']).toBe(1)
    expect(effects['3-2']).toBe(1)
    expect(effects['2-1']).toBe(1)
    expect(effects['2-3']).toBe(1)
  })

  it('composes the product rotation with each material fusion rotation', () => {
    const sources = [src('cheer', 0), src('cheer', 1)]
    const make = (rotation: 0 | 1 | 2 | 3): GridSlot[] => {
      const slots = board()
      slots[at(2, 2)] = {
        ...tablet('cheer', rotation),
        effectDef: { type: 'fused', sources },
        fusedFrom: sources,
      }
      return slots
    }

    // Upright: 환호 copies point up and right.
    const upright = calculateBoardEffects(make(0), ROWS).effects
    expect(upright['1-2']).toBe(1)
    expect(upright['2-3']).toBe(1)

    // Turned once on the grid: the whole pattern turns with it, to right and down.
    const turned = calculateBoardEffects(make(1), ROWS).effects
    expect(turned['2-3']).toBe(1)
    expect(turned['3-2']).toBe(1)
    expect(turned['1-2']).toBe(0)
  })

  it('inherits 회전 제약 and 배치 제약 from every source', () => {
    // 악수 and 수확 both rotate, so their product does.
    expect(isRotatable([src('handshake'), src('harvesting')])).toBe(true)
    // 정의 is 회전 불가, so anything fused with it is too.
    expect(isRotatable([src('handshake'), src('justice')])).toBe(false)

    expect(activationConditionsOf([src('handshake'), src('harvesting')])).toEqual([])
    expect(activationConditionsOf([src('handshake'), src('justice')])).toEqual([
      '왼쪽 끝',
      '오른쪽 끝',
    ])
    // Constraints accumulate rather than cancel.
    expect(activationConditionsOf([src('linear'), src('shade')])).toEqual(['최하단', '최상단'])
  })
})

// ──────────────────────────────────────────────────────────────
describe('석판 합성 store rules', () => {
  beforeEach(() => {
    useInventoryStore.setState({ fusedTablets: [] })
  })

  it('builds a recipe from exactly two catalog materials', () => {
    const recipe = useInventoryStore
      .getState()
      .addFusedTablet([src('handshake'), src('harvesting')], '내 석판')

    expect(recipe).not.toBeNull()
    expect(recipe!.sources).toEqual([src('handshake'), src('harvesting')])
    expect(recipe!.data.ko_label).toBe('내 석판')
    // 수확 is 희귀 and 악수 is 일반, so the product keeps the higher grade.
    expect(recipe!.data.tier).toBe(TABLET_MAP.get('harvesting')!.tier)
    expect(useInventoryStore.getState().fusedTablets).toHaveLength(1)
  })

  it('refuses to fuse a 합성 석판 again', () => {
    const first = useInventoryStore
      .getState()
      .addFusedTablet([src('handshake'), src('harvesting')], 'A')
    expect(first).not.toBeNull()

    // A product is not a catalog tablet, so it cannot be a material.
    expect(
      useInventoryStore.getState().addFusedTablet([src(first!.data.value), src('cheer')], 'B')
    ).toBeNull()
    expect(
      useInventoryStore.getState().addFusedTablet([src(first!.data.value), src(first!.data.value)], 'C')
    ).toBeNull()
    expect(useInventoryStore.getState().fusedTablets).toHaveLength(1)
  })

  it('refuses anything other than two materials', () => {
    const store = useInventoryStore.getState()
    expect(store.addFusedTablet([src('handshake')], 'one')).toBeNull()
    expect(
      store.addFusedTablet([src('handshake'), src('cheer'), src('advent')], 'three')
    ).toBeNull()
    expect(store.addFusedTablet([src('handshake'), src('not_a_tablet')], 'bogus')).toBeNull()
  })

  it('drops a fusion rotation asked of a 회전 불가 material, and locks the product', () => {
    // 정의 prints 회전 불가 on its card, so it can be neither turned nor turned later.
    const recipe = useInventoryStore
      .getState()
      .addFusedTablet([src('handshake', 1), src('justice', 3)], '')

    expect(recipe).not.toBeNull()
    expect(recipe!.sources).toEqual([src('handshake', 1), src('justice', 0)])
    expect(recipe!.data.rotate).toBeUndefined()
  })

  it('keeps a fusion rotation on a rotatable material and stays rotatable', () => {
    const recipe = useInventoryStore
      .getState()
      .addFusedTablet([src('handshake', 0), src('handshake', 1)], '')

    expect(recipe!.sources).toEqual([src('handshake', 0), src('handshake', 1)])
    expect(recipe!.data.rotate).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────
describe('전체 초기화', () => {
  it('returns every part of the board to its first-load state', () => {
    // Earlier suites share this store, so start from a known point.
    useInventoryStore.getState().resetAll()

    // Dirty every field 전체 초기화 claims to clear.
    useInventoryStore.getState().setSlotNum(48)
    useInventoryStore.getState().addFusedTablet([src('handshake'), src('harvesting')], '내 석판')
    useInventoryStore.getState().placeItem(fromCatalog('warm_stone', 2), 0)
    useInventoryStore.getState().placeItem(tablet('cheer', 0), 1)
    useInventoryStore.getState().setArtifactPriority(0, 'high')
    useInventoryStore.getState().setArtifactTargetLevel(0, 3)
    useInventoryStore.getState().toggleLock(0)
    useInventoryStore.getState().setFilterTier('legend')
    useInventoryStore.getState().setSearchQuery('돌')
    useInventoryStore.getState().setCellLevel(0, 5)
    useInventoryStore.getState().setTargetCombo('lake')
    useInventoryStore.getState().setEditorSlot(3)
    useInventoryStore.getState().setLastOptimize({
      beforeLevelSum: 1,
      afterLevelSum: 2,
      goalsMet: 1,
      goalsTotal: 1,
      constraintsMet: 1,
      constraintsTotal: 1,
      comboTiers: 0,
      targetComboTiers: null,
      iterations: 10,
    })
    useInventoryStore.getState().loadFromRecognition([
      { slotIndex: 0, matchedValue: 'warm_stone', type: 'ARTIFACT', level: 0, confidence: 0.9 },
    ])

    const before = useInventoryStore.getState()
    expect(before.slotNum).toBe(48)
    expect(before.fusedTablets).toHaveLength(1)
    expect(Object.keys(before.recognitionMeta).length).toBeGreaterThan(0)
    const tokenBefore = before.resetToken

    useInventoryStore.getState().resetAll()

    const after = useInventoryStore.getState()
    expect(after.slotNum).toBe(34) // DEFAULT_SLOT_NUM
    expect(after.slots).toHaveLength(34)
    expect(after.slots.every((s) => s === null)).toBe(true)
    expect(after.gridRows).toEqual(buildGridRows(34))
    expect(after.fusedTablets).toEqual([])
    expect(after.recognitionMeta).toEqual({})
    expect(after.pickerSlot).toBeNull()
    expect(after.lastOptimize).toBeNull()
    expect(after.dragPreviewSlots).toBeNull()
    expect(after.effectMap).toEqual({})
    expect(after.constraintIgnore.size).toBe(0)
    expect(after.filterTier).toBe('all')
    expect(after.filterSet).toBe('all')
    expect(after.searchQuery).toBe('')
    expect(after.isOptimizing).toBe(false)
    // 칸 레벨은 전부 0으로, 목표 콤보와 셀 에디터는 닫힘으로.
    expect(after.cellLevels).toEqual(new Array(34).fill(0))
    expect(after.targetCombo).toBeNull()
    expect(after.editorSlot).toBeNull()
    // Components with their own local state watch this.
    expect(after.resetToken).toBe(tokenBefore + 1)
  })
})
