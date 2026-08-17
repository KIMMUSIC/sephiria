import type {
  BoardEffects,
  Effect,
  EffectMap,
  GridRow,
  GridSlot,
  PlacedTablet,
  TabletEffectDef,
} from '@/types'
import {
  slotToPosition,
  isValidPosition,
  getMaxRow,
} from './gridUtils'
import { rotateEffect } from './rotationUtils'
import { TABLET_EFFECTS } from '@/data/tabletEffects'

// ── Main entry: calculate all tablet effects on the grid ──
export interface EffectStats {
  /** Negative simple-geometry effects that landed off the grid (incl. complex tablets that reuse applySimpleEffects). */
  oobDebuffs: number
}

/**
 * Mutable accumulator threaded through every applicator.
 *
 * `constraintIgnore` collects the cells whose artifact `<제약>` is waived. Per the wiki
 * a tablet has exactly three kinds of effect — level up, level down, and 제약 무시:
 *   "석판의 효과는 아티팩트 레벨 증가, 아티팩트 레벨 감소, 아티팩트 제약 조건 무시
 *    3가지가 있으며" — namu.wiki/w/세피리아/석판
 * 제약 무시 never suppresses another tablet's level effect on the same cell.
 */
interface ApplyCtx {
  effectMap: EffectMap
  gridRows: GridRow[]
  constraintIgnore: Set<string>
  shieldBypass: Set<string>
  stats?: EffectStats
}

export function calculateAllEffects(
  slots: GridSlot[],
  gridRows: GridRow[],
  shieldBypass?: Set<string>,
  stats?: EffectStats,
  constraintIgnore?: Set<string>
): EffectMap {
  const ctx: ApplyCtx = {
    effectMap: {},
    gridRows,
    constraintIgnore: constraintIgnore ?? new Set<string>(),
    shieldBypass: shieldBypass ?? new Set<string>(),
    stats,
  }

  // Initialize all valid positions with 0
  for (const row of gridRows) {
    for (let col = 0; col < row.cols; col++) {
      ctx.effectMap[`${row.rowIndex}-${col}`] = 0
    }
  }

  // Apply each tablet's effects
  slots.forEach((item, index) => {
    if (!item || item.type !== 'TABLET') return
    const tablet = item as PlacedTablet
    const pos = slotToPosition(index, gridRows)

    if (tablet.isCustom && tablet.customEffects) {
      applySimpleEffects(tablet.customEffects, pos, tablet.rotation, ctx)
      return
    }
    applyDef(tablet.effectDef, tablet.data.value, pos, tablet.rotation, ctx)
  })

  return ctx.effectMap
}

/** Dispatch one tablet definition. Fused tablets replay each source in turn. */
function applyDef(
  def: TabletEffectDef,
  value: string,
  pos: { row: number; col: number },
  rotation: 0 | 1 | 2 | 3,
  ctx: ApplyCtx
): void {
  if (def.type === 'simple') {
    applySimpleEffects(def.effects, pos, rotation, ctx)
    return
  }
  if (def.type === 'fused') {
    // Materials are always catalog tablets — 재합성 불가 — so this never recurses.
    // Each material carries the rotation it was turned to at fusion time; rotating the
    // product on the grid turns all of them together, so the two rotations compose.
    // Quarter turns compose by addition mod 4 (see rotateEffect).
    for (const source of def.sources) {
      const sourceDef = TABLET_EFFECTS[source.value]
      if (!sourceDef) continue
      const combined = (((rotation + source.rotation) % 4) + 4) % 4
      applyDef(sourceDef, source.value, pos, combined as 0 | 1 | 2 | 3, ctx)
    }
    return
  }
  applyComplexEffect(value, pos, rotation, ctx)
}

// ── Apply simple (relative coordinate) effects ──
// Wiki applicator `n` rotates by tablet.rotation and ADDS value (default 1).
// A flag:"ignore" effect (only 환대 carries one) additionally waives the target
// artifact's <제약>: "두 칸에 레벨 강화와 제약 무시를 동시에 제공한다"
// — namu.wiki/w/세피리아/석판. We also keep this app's tablet-shield bypass there.
function applySimpleEffects(
  effects: Effect[],
  pos: { row: number; col: number },
  rotation: 0 | 1 | 2 | 3,
  ctx: ApplyCtx
): void {
  for (const effect of effects) {
    const { newDx, newDy } = rotateEffect(effect.dx, effect.dy, rotation)
    const targetRow = pos.row + newDy
    const targetCol = pos.col + newDx
    const key = `${targetRow}-${targetCol}`

    if (!isValidPosition(targetRow, targetCol, ctx.gridRows)) {
      if ((effect.value ?? 1) < 0 && ctx.stats) ctx.stats.oobDebuffs += 1
      continue
    }

    const value = effect.value ?? 1
    ctx.effectMap[key] = (ctx.effectMap[key] ?? 0) + value

    if (effect.flag === 'ignore') {
      ctx.constraintIgnore.add(key)
      ctx.shieldBypass.add(key)
    }
  }
}

/** Mark one rotated neighbour as 제약 무시. Used by 고양 and 이음. */
function markConstraintIgnore(
  pos: { row: number; col: number },
  dx: number,
  dy: number,
  rotation: 0 | 1 | 2 | 3,
  ctx: ApplyCtx
): void {
  const { newDx, newDy } = rotateEffect(dx, dy, rotation)
  const targetRow = pos.row + newDy
  const targetCol = pos.col + newDx
  if (isValidPosition(targetRow, targetCol, ctx.gridRows)) {
    ctx.constraintIgnore.add(`${targetRow}-${targetCol}`)
  }
}

// ── Apply complex (position-dependent) tablet effects ──
function applyComplexEffect(
  value: string,
  pos: { row: number; col: number },
  rotation: 0 | 1 | 2 | 3,
  ctx: ApplyCtx
): void {
  const maxRowIndex = getMaxRow(ctx.gridRows)
  const { row, col } = pos

  switch (value) {
    case 'linear':
      applyLinear(row, col, maxRowIndex, ctx)
      break
    case 'home_town':
      applyHomeTown(row, col, rotation, ctx)
      break
    case 'agglutination':
      applyAgglutination(row, col, rotation, ctx)
      break
    case 'transition':
      applyTransition(row, col, rotation, ctx)
      break
    case 'justice':
      applyJustice(row, col, ctx)
      break
    case 'base':
      applyBase(row, col, ctx)
      break
    case 'concurrency':
      applyConcurrency(row, col, ctx)
      break
    case 'rebellion':
      applyRebellion(row, col, rotation, ctx)
      break
    case 'connection':
      applyConnection(row, col, rotation, ctx)
      break
    case 'shade':
      applyShade(row, maxRowIndex, ctx)
      break
    case 'boundary':
      applyBoundary(ctx)
      break
    case 'sheen':
      applySheen(row, col, rotation, ctx)
      break
    case 'miracle':
      applyMiracle(row, col, ctx)
      break
    case 'flag':
      applyFlag(row, col, ctx)
      break
  }
}

// Helper: add value to a cell (skips cells outside the grid)
function addEffect(key: string, value: number, ctx: ApplyCtx): void {
  if (ctx.effectMap[key] === undefined) return
  ctx.effectMap[key] += value
}

// ── 선의(linear): 활성화 조건 [위치] 최하단 → left/right +1 ──
function applyLinear(row: number, col: number, maxRowIndex: number, ctx: ApplyCtx): void {
  if (row !== maxRowIndex) return
  if (isValidPosition(row, col - 1, ctx.gridRows)) addEffect(`${row}-${col - 1}`, 1, ctx)
  if (isValidPosition(row, col + 1, ctx.gridRows)) addEffect(`${row}-${col + 1}`, 1, ctx)
}

/**
 * 고양(home_town): waives the `<제약>` of the artifact one cell in the rotation
 * direction. It grants no level change of its own.
 *   "심플하게 아티팩트의 제약조건을 해소하는 기능만 있는 석판. 차가운 자물쇠 같이
 *    제약조건이 까다로운 경우에 타 석판과 함께 혹은 석판 합성용으로 채용해 볼 만하다."
 *   — namu.wiki/w/세피리아/석판. The card's grid is `석판 | 무시`, i.e. the neighbour
 *   at {dx:1, dy:0} before rotation.
 */
function applyHomeTown(row: number, col: number, rotation: 0 | 1 | 2 | 3, ctx: ApplyCtx): void {
  markConstraintIgnore({ row, col }, 1, 0, rotation, ctx)
}

// ── 응집(agglutination): rot 1/3 → column -1, else row -1; +3 is rotated ──
function applyAgglutination(row: number, col: number, rotation: 0 | 1 | 2 | 3, ctx: ApplyCtx): void {
  if (rotation === 1 || rotation === 3) {
    for (const r of ctx.gridRows) {
      if (r.rowIndex !== row && col < r.cols) addEffect(`${r.rowIndex}-${col}`, -1, ctx)
    }
  } else {
    const gridRow = ctx.gridRows.find((r) => r.rowIndex === row)
    if (gridRow) {
      for (let c = 0; c < gridRow.cols; c++) {
        if (c !== col) addEffect(`${row}-${c}`, -1, ctx)
      }
    }
  }

  applySimpleEffects([{ dx: 0, dy: -1, value: 3 }], { row, col }, rotation, ctx)
}

// ── 전이(transition): rotation-dependent row +1/col -1 swap ──
function applyTransition(row: number, col: number, rotation: 0 | 1 | 2 | 3, ctx: ApplyCtx): void {
  const rowPositive = rotation === 0 || rotation === 2
  const gridRow = ctx.gridRows.find((r) => r.rowIndex === row)
  if (gridRow) {
    for (let c = 0; c < gridRow.cols; c++) {
      if (c !== col) addEffect(`${row}-${c}`, rowPositive ? 1 : -1, ctx)
    }
  }
  for (const r of ctx.gridRows) {
    if (r.rowIndex !== row && col < r.cols) {
      addEffect(`${r.rowIndex}-${col}`, rowPositive ? -1 : 1, ctx)
    }
  }
}

// ── 정의(justice): 활성화 조건 [위치] 왼쪽 끝 / 오른쪽 끝 → entire column +1 ──
function applyJustice(row: number, col: number, ctx: ApplyCtx): void {
  const gridRow = ctx.gridRows.find((r) => r.rowIndex === row)
  if (!gridRow) return
  const isEdge = col === 0 || col === gridRow.cols - 1
  if (!isEdge) return
  for (const r of ctx.gridRows) {
    if (col < r.cols && r.rowIndex !== row) addEffect(`${r.rowIndex}-${col}`, 1, ctx)
  }
}

// ── 기반(base): same row +1 (except self) ──
function applyBase(row: number, col: number, ctx: ApplyCtx): void {
  const gridRow = ctx.gridRows.find((r) => r.rowIndex === row)
  if (!gridRow) return
  for (let c = 0; c < gridRow.cols; c++) {
    if (c !== col) addEffect(`${row}-${c}`, 1, ctx)
  }
}

// ── 동시성(concurrency): same column +1 (except self) ──
function applyConcurrency(row: number, col: number, ctx: ApplyCtx): void {
  for (const r of ctx.gridRows) {
    if (r.rowIndex !== row && col < r.cols) addEffect(`${r.rowIndex}-${col}`, 1, ctx)
  }
}

// ── 반항(rebellion): two opposite diagonals until out of grid ──
function applyRebellion(row: number, col: number, rotation: 0 | 1 | 2 | 3, ctx: ApplyCtx): void {
  const sign = rotation === 1 || rotation === 3 ? -1 : 1
  const dirs: Array<[number, number]> = [[sign, -1], [-sign, 1]]

  for (const [dx, dy] of dirs) {
    let r = row + dy
    let c = col + dx
    for (;;) {
      const key = `${r}-${c}`
      if (ctx.effectMap[key] === undefined) break
      ctx.effectMap[key] += 1
      r += dy
      c += dx
    }
  }
}

/**
 * 이음(connection): +2 on one side and 제약 무시 on the opposite side.
 * The wiki treats it as a constraint-release tool alongside 고양:
 *   "이 정도는 고급의 고양 또는 희귀의 이음으로도 충분히 해결할 수 있다"
 *   — namu.wiki/w/세피리아/석판 (환대 writeup)
 * Base orientation follows this repo's scrape ("위 +2, 아래 방향은 효과 무시"); the
 * namu card draws the same shape horizontally, and the tablet rotates freely.
 */
function applyConnection(row: number, col: number, rotation: 0 | 1 | 2 | 3, ctx: ApplyCtx): void {
  const plus = rotateEffect(0, -1, rotation)
  addEffect(`${row + plus.newDy}-${col + plus.newDx}`, 2, ctx)
  markConstraintIgnore({ row, col }, 0, 1, rotation, ctx)
}

// ── 차양(shade): 활성화 조건 [위치] 최상단 → 각 열의 최하단 칸 전부 +1 ──
function applyShade(row: number, maxRowIndex: number, ctx: ApplyCtx): void {
  if (row !== 0 || ctx.gridRows.length < 2) return
  const lastRow = ctx.gridRows[ctx.gridRows.length - 1]
  const secondLast = ctx.gridRows[ctx.gridRows.length - 2]
  if (!lastRow || lastRow.rowIndex !== maxRowIndex) return

  for (let c = 0; c < lastRow.cols; c++) {
    addEffect(`${lastRow.rowIndex}-${c}`, 1, ctx)
  }
  if (secondLast.cols > lastRow.cols) {
    for (let c = lastRow.cols; c < secondLast.cols; c++) {
      addEffect(`${secondLast.rowIndex}-${c}`, 1, ctx)
    }
  }
}

// ── 경계(boundary): first + last row +1, plus second-to-last overhang ──
function applyBoundary(ctx: ApplyCtx): void {
  const bumpRow = (gridRow: GridRow) => {
    for (let c = 0; c < gridRow.cols; c++) addEffect(`${gridRow.rowIndex}-${c}`, 1, ctx)
  }

  const firstRow = ctx.gridRows[0]
  if (firstRow) bumpRow(firstRow)

  if (ctx.gridRows.length > 1) {
    const lastRow = ctx.gridRows[ctx.gridRows.length - 1]
    const secondLast = ctx.gridRows[ctx.gridRows.length - 2]
    bumpRow(lastRow)
    if (secondLast.cols > lastRow.cols) {
      for (let c = lastRow.cols; c < secondLast.cols; c++) {
        addEffect(`${secondLast.rowIndex}-${c}`, 1, ctx)
      }
    }
  }
}

// ── 광휘(sheen): rot 1/3 → column +1, else row +1; adjacent +2 is rotated ──
function applySheen(row: number, col: number, rotation: 0 | 1 | 2 | 3, ctx: ApplyCtx): void {
  if (rotation === 1 || rotation === 3) {
    for (const r of ctx.gridRows) {
      if (r.rowIndex !== row && col < r.cols) addEffect(`${r.rowIndex}-${col}`, 1, ctx)
    }
  } else {
    const gridRow = ctx.gridRows.find((r) => r.rowIndex === row)
    if (gridRow) {
      for (let c = 0; c < gridRow.cols; c++) {
        if (c !== col) addEffect(`${row}-${c}`, 1, ctx)
      }
    }
  }

  applySimpleEffects(
    [
      { dx: 0, dy: -1, value: 2 },
      { dx: 0, dy: 1, value: 2 },
    ],
    { row, col },
    rotation,
    ctx
  )
}

// ── 기적(miracle): same row + same col +1 (cross, except self) ──
function applyMiracle(row: number, col: number, ctx: ApplyCtx): void {
  const gridRow = ctx.gridRows.find((r) => r.rowIndex === row)
  if (gridRow) {
    for (let c = 0; c < gridRow.cols; c++) {
      if (c !== col) addEffect(`${row}-${c}`, 1, ctx)
    }
  }
  for (const r of ctx.gridRows) {
    if (r.rowIndex !== row && col < r.cols) addEffect(`${r.rowIndex}-${col}`, 1, ctx)
  }
}

// ── 깃발(flag): 활성화 조건 [위치] 왼쪽 끝, NO rotation ──
function applyFlag(row: number, col: number, ctx: ApplyCtx): void {
  if (col !== 0) return
  const effects: Effect[] = [
    { dx: 0, dy: -1, value: 1 },
    { dx: 1, dy: 0, value: 1 },
    { dx: 2, dy: 0, value: 2 },
    { dx: 3, dy: 0, value: 3 },
    { dx: 0, dy: 1, value: -1 },
  ]
  // Wiki does not pass tablet into `n` — rotation stays 0
  applySimpleEffects(effects, { row, col }, 0, ctx)
}

// ── Tablet shield: debuff on a tablet cell → 0, unless 환대 bypass ──
export function applyTabletShield(
  slots: GridSlot[],
  gridRows: GridRow[],
  effectMap: EffectMap,
  shieldBypass?: Set<string>
): EffectMap {
  const shielded = { ...effectMap }

  slots.forEach((item, index) => {
    if (!item || item.type !== 'TABLET') return
    const key = slotToPosition(index, gridRows)
    const posKey = `${key.row}-${key.col}`

    if (shieldBypass?.has(posKey)) return

    const val = shielded[posKey]
    if (typeof val === 'number' && val < 0) shielded[posKey] = 0
  })

  return shielded
}

// ── Full calculation with shield ──
export function calculateBoardEffects(
  slots: GridSlot[],
  gridRows: GridRow[]
): BoardEffects {
  const shieldBypass = new Set<string>()
  const constraintIgnore = new Set<string>()
  const raw = calculateAllEffects(slots, gridRows, shieldBypass, undefined, constraintIgnore)
  return {
    effects: applyTabletShield(slots, gridRows, raw, shieldBypass),
    constraintIgnore,
  }
}

/** Level map only — for callers that do not need 제약 무시 information. */
export function calculateEffectsWithShield(
  slots: GridSlot[],
  gridRows: GridRow[]
): EffectMap {
  return calculateBoardEffects(slots, gridRows).effects
}
