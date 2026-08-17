import { describe, expect, it } from 'vitest'
import {
  applyTabletShield,
  calculateAllEffects,
  calculateBoardEffects,
  calculateEffectsWithShield,
} from '@/lib/effectEngine'
import { buildGridRows, positionToSlot } from '@/lib/gridUtils'
import { getTabletEffect } from '@/data/tabletEffects'
import type {
  GridRow,
  GridSlot,
  PlacedArtifact,
  PlacedTablet,
  TabletEffectDef,
} from '@/types'

const SLOT_NUM = 34

function makeTablet(
  value: string,
  rotation: 0 | 1 | 2 | 3 = 0,
  effectDef?: TabletEffectDef
): PlacedTablet {
  return {
    instanceId: `tablet-${value}`,
    type: 'TABLET',
    data: {
      value,
      ko_label: value,
      eng_label: value,
      tier: 'rare',
      image: '',
      rotate: true,
    },
    effectDef: effectDef ?? getTabletEffect(value) ?? { type: 'complex', description: value },
    rotation,
    isCustom: false,
  }
}

function makeArtifact(level = 3): PlacedArtifact {
  return {
    instanceId: 'artifact-1',
    type: 'ARTIFACT',
    data: {
      id: 1,
      value: 'dummy',
      label_kor: 'dummy',
      label_eng: 'dummy',
      tier: 'common',
      level: 5,
      image: '',
      effect: { sets: [], content: '' },
      description: '',
    },
    level,
    currentLevel: level,
    isLocked: false,
    priority: 'normal',
    targetLevel: null,
  }
}

function emptyBoard(slotNum = SLOT_NUM): { slots: GridSlot[]; gridRows: GridRow[] } {
  return {
    slots: new Array(slotNum).fill(null),
    gridRows: buildGridRows(slotNum),
  }
}

function place(
  board: { slots: GridSlot[]; gridRows: GridRow[] },
  row: number,
  col: number,
  item: NonNullable<GridSlot>
): void {
  const index = positionToSlot(row, col, board.gridRows)
  if (index === null) throw new Error(`invalid ${row}-${col}`)
  board.slots[index] = item
}

function effectsAt(
  board: { slots: GridSlot[]; gridRows: GridRow[] },
  bypass?: Set<string>
) {
  return calculateAllEffects(board.slots, board.gridRows, bypass)
}

function waivedAt(board: { slots: GridSlot[]; gridRows: GridRow[] }): Set<string> {
  return calculateBoardEffects(board.slots, board.gridRows).constraintIgnore
}

describe('flag (깃발)', () => {
  it('applies the unrotated pattern only on the left edge', () => {
    const board = emptyBoard()
    place(board, 2, 0, makeTablet('flag', 1))
    const map = effectsAt(board)

    expect(map['1-0']).toBe(1)
    expect(map['2-1']).toBe(1)
    expect(map['2-2']).toBe(2)
    expect(map['2-3']).toBe(3)
    expect(map['3-0']).toBe(-1)
    // rotation must be ignored — rot 1 would have moved these
    expect(map['2-0']).toBe(0)
    expect(map['1-1']).toBe(0)
  })

  it('is a no-op when not on the left edge', () => {
    const board = emptyBoard()
    place(board, 2, 1, makeTablet('flag', 0))
    const map = effectsAt(board)

    expect(map['1-1']).toBe(0)
    expect(map['2-2']).toBe(0)
    expect(map['2-3']).toBe(0)
    expect(map['2-4']).toBe(0)
    expect(map['3-1']).toBe(0)
  })
})

describe('home_town (고양)', () => {
  // "심플하게 아티팩트의 제약조건을 해소하는 기능만 있는 석판" — namu.wiki/w/세피리아/석판
  it('waives the <제약> of the cell to the RIGHT at rotation 0, and changes no level', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('home_town', 0))
    const map = effectsAt(board)
    const waived = waivedAt(board)

    expect(waived.has('2-3')).toBe(true)
    expect(waived.has('2-1')).toBe(false)
    expect(waived.has('1-2')).toBe(false)

    // It grants no level of its own, anywhere.
    expect(map['2-3']).toBe(0)
    expect(map['1-2']).toBe(0)
    expect(map['2-1']).toBe(0)
    expect(map['3-2']).toBe(0)
  })

  it('rotates the waived cell', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('home_town', 1))
    const waived = waivedAt(board)

    expect(waived.has('3-2')).toBe(true)
    expect(waived.has('2-3')).toBe(false)
  })
})

describe('hospitality (환대)', () => {
  // "두 칸에 레벨 강화와 제약 무시를 동시에 제공한다" — namu.wiki/w/세피리아/석판
  it('adds numeric bonuses AND waives <제약> on the same two cells', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('hospitality', 0))
    const map = effectsAt(board)
    const waived = waivedAt(board)

    expect(map['1-2']).toBe(1)
    expect(map['2-1']).toBe(2)
    expect(waived.has('1-2')).toBe(true)
    expect(waived.has('2-1')).toBe(true)
    expect(waived.has('2-3')).toBe(false)
  })

  it('bypass shield so hospitality-hit tablet cells are not zeroed', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('hospitality', 0))
    // extra -2 onto the hospitality +1 cell so the net is negative
    const debuff: PlacedTablet = {
      ...makeTablet('custom_debuff', 0, { type: 'simple', effects: [{ dx: 0, dy: 1, value: -2 }] }),
      isCustom: true,
      customEffects: [{ dx: 0, dy: 1, value: -2 }],
    }
    place(board, 0, 2, debuff)
    place(board, 1, 2, makeTablet('cheer', 0))

    const bypass = new Set<string>()
    const raw = calculateAllEffects(board.slots, board.gridRows, bypass)
    expect(raw['1-2']).toBe(-1)
    expect(bypass.has('1-2')).toBe(true)

    const withoutBypass = applyTabletShield(board.slots, board.gridRows, raw)
    expect(withoutBypass['1-2']).toBe(0)

    const withBypass = applyTabletShield(board.slots, board.gridRows, raw, bypass)
    expect(withBypass['1-2']).toBe(-1)

    expect(calculateEffectsWithShield(board.slots, board.gridRows)['1-2']).toBe(-1)
  })
})

describe('rebellion (반항)', () => {
  it('walks two opposite diagonals (rot 0: up-right and down-left)', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('rebellion', 0))
    const map = effectsAt(board)

    expect(map['1-3']).toBe(1)
    expect(map['0-4']).toBe(1)
    expect(map['3-1']).toBe(1)
    expect(map['4-0']).toBe(1)
    // old single-diagonal (up-left / down-right) must stay empty
    expect(map['1-1']).toBe(0)
    expect(map['0-0']).toBe(0)
    expect(map['3-3']).toBe(0)
    expect(map['4-4']).toBe(0)
  })
})

describe('connection (이음)', () => {
  it('rotates both the +2 and the 제약 무시 cell', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('connection', 1))
    const map = effectsAt(board)

    // rot 1: {0,-1} → right +2, {0,1} → left 제약 무시
    const waived = waivedAt(board)
    expect(map['2-3']).toBe(2)
    expect(waived.has('2-1')).toBe(true)
    // the waived cell keeps its own level untouched
    expect(map['2-1']).toBe(0)
    // unrotated up/+2 and down/waive must not apply
    expect(map['1-2']).toBe(0)
    expect(waived.has('3-2')).toBe(false)
  })
})

describe('제약 무시 does not block level effects', () => {
  // The old implementation zeroed a 고양-marked cell. The wiki gives 고양 no level
  // effect at all — it only resolves the artifact's own 제약 — so another tablet's
  // buff on that same cell must still land.
  it('lets another tablet buff a cell that 고양 waives', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('home_town', 0))
    // 환호(cheer) buffs the cell above it, so place it at (3,3) to hit (2,3).
    place(board, 3, 3, makeTablet('cheer', 0))
    const artifact = makeArtifact(4)
    place(board, 2, 3, artifact)

    const { effects, constraintIgnore } = calculateBoardEffects(board.slots, board.gridRows)
    expect(constraintIgnore.has('2-3')).toBe(true)
    expect(effects['2-3']).toBeGreaterThan(0)
  })
})


describe('agglutination (응집)', () => {
  it('uses row -1 at rot 0 and rotates the +3', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('agglutination', 0))
    const map = effectsAt(board)

    expect(map['1-2']).toBe(3)
    expect(map['2-0']).toBe(-1)
    expect(map['2-1']).toBe(-1)
    expect(map['2-3']).toBe(-1)
    expect(map['0-2']).toBe(0)
    expect(map['3-2']).toBe(0)
  })

  it('uses column -1 at rot 1 and rotates the +3 to the right', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('agglutination', 1))
    const map = effectsAt(board)

    expect(map['2-3']).toBe(3)
    expect(map['0-2']).toBe(-1)
    expect(map['1-2']).toBe(-1)
    expect(map['3-2']).toBe(-1)
    expect(map['2-0']).toBe(0)
    expect(map['2-1']).toBe(0)
  })
})

describe('sheen (광휘)', () => {
  it('buffs the row at rot 0 and rotates adjacent +2', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('sheen', 0))
    const map = effectsAt(board)

    expect(map['2-0']).toBe(1)
    expect(map['2-1']).toBe(1)
    expect(map['2-3']).toBe(1)
    expect(map['1-2']).toBe(2)
    expect(map['3-2']).toBe(2)
    expect(map['0-2']).toBe(0)
  })

  it('buffs the column at rot 1 and rotates adjacent +2 sideways', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('sheen', 1))
    const map = effectsAt(board)

    expect(map['0-2']).toBe(1)
    expect(map['1-2']).toBe(1)
    expect(map['3-2']).toBe(1)
    expect(map['2-3']).toBe(2)
    expect(map['2-1']).toBe(2)
    expect(map['2-0']).toBe(0)
  })
})

describe('shade / boundary overhang', () => {
  it('shade on row 0 also buffs second-to-last overhang cells', () => {
    const board = emptyBoard(34)
    place(board, 0, 1, makeTablet('shade', 0))
    const map = effectsAt(board)

    expect(map['5-0']).toBe(1)
    expect(map['5-3']).toBe(1)
    expect(map['4-4']).toBe(1)
    expect(map['4-5']).toBe(1)
    expect(map['4-0']).toBe(0)
    expect(map['0-0']).toBe(0)
  })

  it('boundary buffs first, last, and second-to-last overhang', () => {
    const board = emptyBoard(34)
    place(board, 2, 2, makeTablet('boundary', 0))
    const map = effectsAt(board)

    expect(map['0-0']).toBe(1)
    expect(map['0-5']).toBe(1)
    expect(map['5-0']).toBe(1)
    expect(map['5-3']).toBe(1)
    expect(map['4-4']).toBe(1)
    expect(map['4-5']).toBe(1)
    expect(map['4-0']).toBe(0)
    expect(map['2-2']).toBe(0)
  })
})
