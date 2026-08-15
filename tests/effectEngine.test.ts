import { describe, expect, it } from 'vitest'
import {
  applyTabletShield,
  calculateAllEffects,
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
  it('marks the cell to the RIGHT as ignore at rotation 0', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('home_town', 0))
    const map = effectsAt(board)

    expect(map['2-3']).toBe('ignore')
    expect(map['1-2']).toBe(0)
    expect(map['2-1']).toBe(0)
    expect(map['3-2']).toBe(0)
  })
})

describe('hospitality (환대)', () => {
  it('adds numeric bonuses and does not mark cells ignore', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('hospitality', 0))
    const map = effectsAt(board)

    expect(map['1-2']).toBe(1)
    expect(map['2-1']).toBe(2)
    expect(map['1-2']).not.toBe('ignore')
    expect(map['2-1']).not.toBe('ignore')
    expect(Object.values(map).some((v) => v === 'ignore')).toBe(false)
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
  it('rotates both the +2 and the ignore cell', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('connection', 1))
    const map = effectsAt(board)

    // rot 1: {0,-1} → right +2, {0,1} → left ignore
    expect(map['2-3']).toBe(2)
    expect(map['2-1']).toBe('ignore')
    // unrotated up/+2 and down/ignore must not apply
    expect(map['1-2']).toBe(0)
    expect(map['3-2']).toBe(0)
  })
})

describe('currentLevel bonus', () => {
  it('treats ignore cells as 0 bonus', () => {
    const board = emptyBoard()
    place(board, 2, 2, makeTablet('home_town', 0))
    const artifact = makeArtifact(4)
    place(board, 2, 3, artifact)
    const map = calculateEffectsWithShield(board.slots, board.gridRows)
    const bonus = typeof map['2-3'] === 'number' ? map['2-3'] : 0
    expect(map['2-3']).toBe('ignore')
    expect(bonus).toBe(0)
    expect(artifact.level + bonus).toBe(4)
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
