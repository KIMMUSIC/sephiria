import type { GridRow, GridSlot, PlacedArtifact, PlacedTablet } from '@/types'
import { applyTabletShield, calculateAllEffects, type EffectStats } from '@/lib/effectEngine'
import { getMaxRow, slotToPosition } from '@/lib/gridUtils'

/** Primary score is integer level-sum. Tie-breakers must stay below +1. */
export const TIEBREAK = 0.01
export const DESTRUCTION_SCORE = -99999

function complexPositionTiebreak(tablet: PlacedTablet, row: number, col: number, gridRows: GridRow[]): number {
  if (tablet.effectDef.type !== 'complex') return 0
  const maxRowIndex = getMaxRow(gridRows)
  switch (tablet.data.value) {
    case 'linear':
      return row === maxRowIndex ? 1 : 0
    case 'shade':
      return row === 0 ? 1 : 0
    case 'boundary':
      return 1
    case 'justice': {
      const gridRow = gridRows.find((r) => r.rowIndex === row)
      return gridRow && (col === 0 || col === gridRow.cols - 1) ? 1 : 0
    }
    case 'concurrency':
    case 'base':
      return 1
    default:
      return 1
  }
}

/**
 * SA objective.
 * Primary: sum of post-shield artifact final levels. Any finalLevel<=0 => destruction.
 * Secondary: OOB-debuff / tablet-shield / complex-position counts at TIEBREAK scale.
 */
export function evaluateBoard(slots: GridSlot[], gridRows: GridRow[]): number {
  const shieldBypass = new Set<string>()
  const stats: EffectStats = { oobDebuffs: 0 }
  const rawEffects = calculateAllEffects(slots, gridRows, shieldBypass, stats)
  const effectMap = applyTabletShield(slots, gridRows, rawEffects, shieldBypass)

  let levelSum = 0
  let shieldCount = 0
  let positionBonus = 0

  for (let i = 0; i < slots.length; i++) {
    const item = slots[i]
    if (!item) continue
    const pos = slotToPosition(i, gridRows)
    const posKey = `${pos.row}-${pos.col}`

    if (item.type === 'ARTIFACT') {
      const artifact = item as PlacedArtifact
      const effectVal = effectMap[posKey]
      const bonus = typeof effectVal === 'number' ? effectVal : 0
      const finalLevel = artifact.level + bonus
      if (finalLevel <= 0) return DESTRUCTION_SCORE
      levelSum += finalLevel
    } else if (item.type === 'TABLET') {
      const rawVal = rawEffects[posKey]
      if (typeof rawVal === 'number' && rawVal < 0 && !shieldBypass.has(posKey)) {
        shieldCount += 1
      }
      positionBonus += complexPositionTiebreak(item as PlacedTablet, pos.row, pos.col, gridRows)
    }
  }

  return levelSum + TIEBREAK * (stats.oobDebuffs + shieldCount + positionBonus)
}

export function levelSumOnly(slots: GridSlot[], gridRows: GridRow[]): number {
  const shieldBypass = new Set<string>()
  const rawEffects = calculateAllEffects(slots, gridRows, shieldBypass)
  const effectMap = applyTabletShield(slots, gridRows, rawEffects, shieldBypass)
  let score = 0
  for (let i = 0; i < slots.length; i++) {
    const item = slots[i]
    if (!item || item.type !== 'ARTIFACT') continue
    const pos = slotToPosition(i, gridRows)
    const bonus = effectMap[`${pos.row}-${pos.col}`]
    const finalLevel = item.level + (typeof bonus === 'number' ? bonus : 0)
    if (finalLevel <= 0) return DESTRUCTION_SCORE
    score += finalLevel
  }
  return score
}
