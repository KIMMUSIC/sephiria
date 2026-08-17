import type { FusedSource } from '@/types'
import { TABLET_ACTIVATION } from '@/lib/tabletMeta'

export const PREVIEW_COLS = 6
export const PREVIEW_ROW_COUNT = 5

/** TABLET_ACTIVATION 의 조건 문자열 하나를 이 칸이 만족하는가. */
export function satisfiesCondition(
  condition: string,
  row: number,
  col: number,
  rowCount: number,
  colCount: number
): boolean {
  switch (condition) {
    case '최상단':
      return row === 0
    case '최하단':
      return row === rowCount - 1
    case '왼쪽 끝':
      return col === 0
    case '오른쪽 끝':
      return col === colCount - 1
    default:
      // 모르는 조건 때문에 미리보기를 막지 않는다.
      return true
  }
}

export interface PreviewPlacement {
  row: number
  col: number
  /** row*PREVIEW_COLS + col */
  slot: number
  /** 이 자리에서 효과가 켜지는 재료 value 목록 (조건 없는 재료는 항상 포함) */
  firing: string[]
  /** 조건이 있는데 이 자리에서 꺼지는 재료 value 목록 */
  dormant: string[]
  /** 자리를 사람 말로. 예: '최하단 왼쪽 끝', '최상단', '가운데' */
  label: string
}

function firesAt(value: string, row: number, col: number): boolean {
  const conditions = TABLET_ACTIVATION[value] ?? []
  if (conditions.length === 0) return true
  // 한 석판 안의 조건은 OR 다. 정의(justice)는 왼쪽 끝 또는 오른쪽 끝.
  return conditions.some((condition) =>
    satisfiesCondition(condition, row, col, PREVIEW_ROW_COUNT, PREVIEW_COLS)
  )
}

function placementLabel(row: number, col: number): string {
  const parts: string[] = []
  if (row === 0) parts.push('최상단')
  if (row === PREVIEW_ROW_COUNT - 1) parts.push('최하단')
  if (col === 0) parts.push('왼쪽 끝')
  if (col === PREVIEW_COLS - 1) parts.push('오른쪽 끝')
  return parts.length === 0 ? '가운데' : parts.join(' ')
}

export function previewPlacement(sources: readonly FusedSource[]): PreviewPlacement {
  const centerRow = Math.floor((PREVIEW_ROW_COUNT - 1) / 2)
  const centerCol = Math.floor((PREVIEW_COLS - 1) / 2)

  let bestRow = 0
  let bestCol = 0
  let bestFiring: string[] = []
  let bestDormant: string[] = []
  let bestScore = -1
  let bestDist = Number.POSITIVE_INFINITY

  for (let row = 0; row < PREVIEW_ROW_COUNT; row++) {
    for (let col = 0; col < PREVIEW_COLS; col++) {
      const firing: string[] = []
      const dormant: string[] = []
      for (const source of sources) {
        if (firesAt(source.value, row, col)) firing.push(source.value)
        else dormant.push(source.value)
      }
      const score = firing.length
      const dist = Math.abs(row - centerRow) + Math.abs(col - centerCol)
      const better =
        score > bestScore ||
        (score === bestScore && dist < bestDist) ||
        (score === bestScore && dist === bestDist && row < bestRow) ||
        (score === bestScore && dist === bestDist && row === bestRow && col < bestCol)
      if (better) {
        bestRow = row
        bestCol = col
        bestFiring = firing
        bestDormant = dormant
        bestScore = score
        bestDist = dist
      }
    }
  }

  return {
    row: bestRow,
    col: bestCol,
    slot: bestRow * PREVIEW_COLS + bestCol,
    firing: bestFiring,
    dormant: bestDormant,
    label: placementLabel(bestRow, bestCol),
  }
}
