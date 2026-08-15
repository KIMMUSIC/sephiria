import type { GridRow, Position } from '@/types'

const COLS = 6

export function buildGridRows(slotNum: number): GridRow[] {
  const fullRows = Math.floor(slotNum / COLS)
  const remainder = slotNum % COLS
  const rows: GridRow[] = Array.from({ length: fullRows }, (_, i) => ({
    rowIndex: i,
    cols: COLS,
  }))
  if (remainder > 0) {
    rows.push({ rowIndex: fullRows, cols: remainder })
  }
  return rows
}

export function getTotalRows(gridRows: GridRow[]): number {
  return gridRows.length
}

export function slotToPosition(index: number, gridRows: GridRow[]): Position {
  let remaining = index
  for (const row of gridRows) {
    if (remaining < row.cols) {
      return { row: row.rowIndex, col: remaining }
    }
    remaining -= row.cols
  }
  return { row: 0, col: 0 }
}

export function positionToSlot(
  row: number,
  col: number,
  gridRows: GridRow[]
): number | null {
  const gridRow = gridRows.find((r) => r.rowIndex === row)
  if (!gridRow || col < 0 || col >= gridRow.cols) return null
  let slot = 0
  for (const r of gridRows) {
    if (r.rowIndex === row) return slot + col
    slot += r.cols
  }
  return null
}

export function isValidPosition(
  row: number,
  col: number,
  gridRows: GridRow[]
): boolean {
  const gridRow = gridRows.find((r) => r.rowIndex === row)
  return gridRow !== undefined && col >= 0 && col < gridRow.cols
}

export function slotToKey(index: number, gridRows: GridRow[]): string {
  const { row, col } = slotToPosition(index, gridRows)
  return `${row}-${col}`
}

export function keyToPosition(key: string): Position {
  const [row, col] = key.split('-').map(Number)
  return { row, col }
}

export function getSlotCount(gridRows: GridRow[]): number {
  return gridRows.reduce((sum, r) => sum + r.cols, 0)
}

export function getMaxRow(gridRows: GridRow[]): number {
  return gridRows.length > 0 ? gridRows[gridRows.length - 1].rowIndex : 0
}

export function getMaxColInRow(row: number, gridRows: GridRow[]): number {
  const gridRow = gridRows.find((r) => r.rowIndex === row)
  return gridRow ? gridRow.cols - 1 : -1
}
