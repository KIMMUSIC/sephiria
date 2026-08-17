import type {
  ConstraintKind,
  GridRow,
  GridSlot,
  Position,
} from '@/types'
import { isValidPosition, slotToPosition, positionToSlot } from './gridUtils'

/**
 * Artifact `<제약>` support.
 *
 * Game rule (verified): an unsatisfied 제약 disables only the artifact's own 고유
 * effect. The level is untouched and 콤보(세트) effects still apply.
 *   "석판 효과로 레벨이 0보다 낮아지거나 제약이 걸린 아이템을 아이템의 제약 조건을
 *    준수하지 않고 배치하면 아이템의 효과가 적용되지 않는다" — namu.wiki/w/세피리아
 *   "[6] 콤보 효과는 적용된다." — same page, footnote on that sentence
 *
 * A separate rule that looks similar but is NOT a 제약: an artifact whose level is
 * driven to -1 or lower is 무효, and no 제약 무시 tablet can rescue it.
 *   "효과 무효는 인게임에서 제약으로 표기되지만, 아티팩트 자체의 제약이 아니므로
 *    석판이 가진 제약 무시 효과로 무시할 수 없다" — namu.wiki/w/세피리아/석판
 * That case lives in lib/optimizerScore.ts, not here.
 */

/** Recognised `<제약>` sentences, longest-first so 최상단/최하단 never match loosely. */
const CONSTRAINT_PATTERNS: Array<{ kind: ConstraintKind; test: RegExp }> = [
  { kind: 'bothSidesEmpty', test: /양쪽\s*칸이\s*모두\s*비어\s*있을\s*때/ },
  { kind: 'edge', test: /인벤토리\s*가장자리/ },
  { kind: 'top', test: /인벤토리\s*최상단/ },
  // 최하단 and "가장 아래 칸" name the same cells; sources disagree only on which
  // string 다용도 벨트 uses in-game, never on the meaning.
  { kind: 'bottom', test: /인벤토리\s*최하단/ },
  { kind: 'bottom', test: /인벤토리\s*가장\s*아래\s*칸/ },
  { kind: 'inner', test: /인벤토리\s*안쪽/ },
]

/** Parse the `<제약>` line out of an artifact's `effect.content`. */
export function parseConstraint(content: string | undefined): ConstraintKind | null {
  if (!content || !content.includes('<제약>')) return null
  for (const { kind, test } of CONSTRAINT_PATTERNS) {
    if (test.test(content)) return kind
  }
  return null
}

/** The human-readable `<제약>` sentence, for UI. */
export function constraintText(content: string | undefined): string | null {
  if (!content) return null
  const line = content.split('\n').find((l) => l.includes('<제약>'))
  return line ? line.replace('<제약>', '').trim() : null
}

export const CONSTRAINT_LABEL: Record<ConstraintKind, string> = {
  inner: '안쪽',
  edge: '가장자리',
  top: '최상단',
  bottom: '최하단',
  bothSidesEmpty: '양옆 빈칸',
}

// ── Geometry ──
// Neighbour-based: a cell is 가장자리 when any of its four orthogonal neighbours
// falls outside the grid. On a grid whose last row is partial (e.g. 34 = 6×5 + 4)
// this makes the "step" cells edges too, because their bottom neighbour is missing.

/** Is this cell on the boundary of the occupied grid shape? */
export function isEdgeCell(pos: Position, gridRows: GridRow[]): boolean {
  const { row, col } = pos
  return (
    !isValidPosition(row - 1, col, gridRows) ||
    !isValidPosition(row + 1, col, gridRows) ||
    !isValidPosition(row, col - 1, gridRows) ||
    !isValidPosition(row, col + 1, gridRows)
  )
}

/** 안쪽 is exactly the complement of 가장자리. */
export function isInnerCell(pos: Position, gridRows: GridRow[]): boolean {
  return isValidPosition(pos.row, pos.col, gridRows) && !isEdgeCell(pos, gridRows)
}

/** 최상단 — the whole first row. The grid always fills top-down, so this is row 0. */
export function isTopCell(pos: Position, gridRows: GridRow[]): boolean {
  const first = gridRows[0]
  return first !== undefined && pos.row === first.rowIndex
}

/**
 * 최하단 — the bottom-most existing cell of this cell's own column.
 * With a partial last row, columns beyond it bottom out one row earlier. This is the
 * same per-column notion the game uses for 차양: "각 열의 최하단 칸 전부를 강화하는"
 * — namu.wiki/w/세피리아/석판.
 */
export function isBottomCell(pos: Position, gridRows: GridRow[]): boolean {
  if (!isValidPosition(pos.row, pos.col, gridRows)) return false
  return !isValidPosition(pos.row + 1, pos.col, gridRows)
}

/**
 * 양쪽 칸이 모두 비어 있을 때 — both horizontal neighbours must be *real* grid cells
 * and both must hold no item.
 *
 * Game rule (verified in-game): the constraint text is "인벤토리 양쪽 칸이 모두 비어
 * 있을 때" (cold_lock) — it asks for two inventory *cells*, so a neighbour that does
 * not exist can never count as an empty cell. On the left/right end of a row, and on
 * the last cell of a partial last row where the right neighbour is missing, the
 * constraint is therefore never satisfied.
 */
export function hasBothSidesEmpty(
  pos: Position,
  slots: GridSlot[],
  gridRows: GridRow[]
): boolean {
  return sideIsEmpty(pos.row, pos.col - 1, slots, gridRows) &&
    sideIsEmpty(pos.row, pos.col + 1, slots, gridRows)
}

function sideIsEmpty(
  row: number,
  col: number,
  slots: GridSlot[],
  gridRows: GridRow[]
): boolean {
  // Off-grid is a FAIL, not "empty": there is no inventory cell there to be empty
  // (verified in-game — cold_lock never fires at row ends).
  if (!isValidPosition(row, col, gridRows)) return false
  const slot = positionToSlot(row, col, gridRows)
  return slot !== null && slots[slot] == null
}

/** Does the cell at `slotIndex` satisfy `kind`? */
export function isConstraintSatisfied(
  kind: ConstraintKind,
  slotIndex: number,
  slots: GridSlot[],
  gridRows: GridRow[]
): boolean {
  const pos = slotToPosition(slotIndex, gridRows)
  switch (kind) {
    case 'inner':
      return isInnerCell(pos, gridRows)
    case 'edge':
      return isEdgeCell(pos, gridRows)
    case 'top':
      return isTopCell(pos, gridRows)
    case 'bottom':
      return isBottomCell(pos, gridRows)
    case 'bothSidesEmpty':
      return hasBothSidesEmpty(pos, slots, gridRows)
  }
}

export type ConstraintStatus = 'none' | 'met' | 'waived' | 'unmet'

/**
 * Resolve an artifact's constraint status on the board.
 * `waived` means a 고양 / 이음 / 환대 cell covers it — the effect fires anyway.
 */
export function resolveConstraintStatus(
  kind: ConstraintKind | null,
  slotIndex: number,
  slots: GridSlot[],
  gridRows: GridRow[],
  constraintIgnore: ReadonlySet<string>
): ConstraintStatus {
  if (!kind) return 'none'
  if (isConstraintSatisfied(kind, slotIndex, slots, gridRows)) return 'met'
  const pos = slotToPosition(slotIndex, gridRows)
  if (constraintIgnore.has(`${pos.row}-${pos.col}`)) return 'waived'
  return 'unmet'
}

/** True when the artifact's own 고유 effect actually fires. */
export function isConstraintActive(status: ConstraintStatus): boolean {
  return status !== 'unmet'
}
