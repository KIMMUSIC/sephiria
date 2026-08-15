import type {
  Effect,
  EffectMap,
  GridRow,
  GridSlot,
  PlacedTablet,
} from '@/types'
import {
  slotToPosition,
  isValidPosition,
  getTotalRows,
  getMaxRow,
} from './gridUtils'
import { rotateEffect } from './rotationUtils'

// ── Main entry: calculate all tablet effects on the grid ──
export interface EffectStats {
  /** Negative simple-geometry effects that landed off the grid (incl. complex tablets that reuse applySimpleEffects). */
  oobDebuffs: number
}

export function calculateAllEffects(
  slots: GridSlot[],
  gridRows: GridRow[],
  shieldBypass?: Set<string>,
  stats?: EffectStats
): EffectMap {
  const effectMap: EffectMap = {}
  const bypass = shieldBypass ?? new Set<string>()

  // Initialize all valid positions with 0
  for (const row of gridRows) {
    for (let col = 0; col < row.cols; col++) {
      effectMap[`${row.rowIndex}-${col}`] = 0
    }
  }

  // Apply each tablet's effects
  slots.forEach((item, index) => {
    if (!item || item.type !== 'TABLET') return
    const tablet = item as PlacedTablet
    const pos = slotToPosition(index, gridRows)

    if (tablet.isCustom && tablet.customEffects) {
      applySimpleEffects(tablet.customEffects, pos, tablet.rotation, effectMap, gridRows, bypass, stats)
    } else if (tablet.effectDef.type === 'simple') {
      applySimpleEffects(tablet.effectDef.effects, pos, tablet.rotation, effectMap, gridRows, bypass, stats)
    } else {
      applyComplexEffect(tablet, pos, effectMap, gridRows, stats)
    }
  })

  return effectMap
}

// ── Apply simple (relative coordinate) effects ──
// Wiki applicator `n` rotates by tablet.rotation and ADDS value (default 1).
// It IGNORES flag:"ignore" on the effect object — hospitality just adds +1/+2.
// We still record those cells as shield-bypass (our game rule, not wiki).
function applySimpleEffects(
  effects: Effect[],
  pos: { row: number; col: number },
  rotation: 0 | 1 | 2 | 3,
  effectMap: EffectMap,
  gridRows: GridRow[],
  shieldBypass?: Set<string>,
  stats?: EffectStats
): void {
  for (const effect of effects) {
    const { newDx, newDy } = rotateEffect(effect.dx, effect.dy, rotation)
    const targetRow = pos.row + newDy
    const targetCol = pos.col + newDx
    const key = `${targetRow}-${targetCol}`

    if (!isValidPosition(targetRow, targetCol, gridRows)) {
      if ((effect.value ?? 1) < 0) stats && (stats.oobDebuffs += 1)
      continue
    }
    if (effectMap[key] === 'ignore') continue

    const value = effect.value ?? 1
    effectMap[key] = (effectMap[key] as number) + value

    if (effect.flag === 'ignore') {
      shieldBypass?.add(key)
    }
  }
}

// ── Apply complex (position-dependent) tablet effects ──
function applyComplexEffect(
  tablet: PlacedTablet,
  pos: { row: number; col: number },
  effectMap: EffectMap,
  gridRows: GridRow[],
  stats?: EffectStats
): void {
  const totalRows = getTotalRows(gridRows)
  const maxRowIndex = getMaxRow(gridRows)
  const { row, col } = pos
  const rotation = tablet.rotation

  switch (tablet.data.value) {
    case 'linear':
      applyLinear(row, col, maxRowIndex, effectMap, gridRows)
      break
    case 'home_town':
      applyHomeTown(row, col, rotation, effectMap, gridRows, stats)
      break
    case 'agglutination':
      applyAgglutination(row, col, rotation, effectMap, gridRows, stats)
      break
    case 'transition':
      applyTransition(row, col, rotation, effectMap, gridRows)
      break
    case 'justice':
      applyJustice(row, col, effectMap, gridRows)
      break
    case 'base':
      applyBase(row, col, effectMap, gridRows)
      break
    case 'concurrency':
      applyConcurrency(row, col, effectMap, gridRows, totalRows)
      break
    case 'rebellion':
      applyRebellion(row, col, rotation, effectMap)
      break
    case 'connection':
      applyConnection(row, col, rotation, effectMap, gridRows, stats)
      break
    case 'shade':
      applyShade(row, maxRowIndex, effectMap, gridRows)
      break
    case 'boundary':
      applyBoundary(effectMap, gridRows)
      break
    case 'sheen':
      applySheen(row, col, rotation, effectMap, gridRows, stats)
      break
    case 'miracle':
      applyMiracle(row, col, effectMap, gridRows, totalRows)
      break
    case 'flag':
      applyFlag(row, col, effectMap, gridRows, stats)
      break
  }
}

// Helper: add value to a cell (respects ignore / missing keys)
function addEffect(key: string, value: number, effectMap: EffectMap): void {
  if (effectMap[key] === undefined || effectMap[key] === 'ignore') return
  effectMap[key] = (effectMap[key] as number) + value
}

// ── 선의(linear): last row → left/right +1 ──
function applyLinear(
  row: number, col: number, maxRowIndex: number,
  effectMap: EffectMap, gridRows: GridRow[]
): void {
  if (row !== maxRowIndex) return
  if (isValidPosition(row, col - 1, gridRows)) addEffect(`${row}-${col - 1}`, 1, effectMap)
  if (isValidPosition(row, col + 1, gridRows)) addEffect(`${row}-${col + 1}`, 1, effectMap)
}

// ── 고양(home_town): rotate {dx:1, dy:0} (RIGHT at rot 0) → mark ignore ──
function applyHomeTown(
  row: number, col: number, rotation: 0 | 1 | 2 | 3,
  effectMap: EffectMap, gridRows: GridRow[],
  _stats?: EffectStats
): void {
  const { newDx, newDy } = rotateEffect(1, 0, rotation)
  const targetRow = row + newDy
  const targetCol = col + newDx
  if (isValidPosition(targetRow, targetCol, gridRows)) {
    effectMap[`${targetRow}-${targetCol}`] = 'ignore'
  }
}

// ── 응집(agglutination): rot 1/3 → column -1, else row -1; +3 is rotated ──
function applyAgglutination(
  row: number, col: number, rotation: 0 | 1 | 2 | 3,
  effectMap: EffectMap, gridRows: GridRow[],
  stats?: EffectStats
): void {
  if (rotation === 1 || rotation === 3) {
    for (const r of gridRows) {
      if (r.rowIndex !== row && col < r.cols) {
        addEffect(`${r.rowIndex}-${col}`, -1, effectMap)
      }
    }
  } else {
    const gridRow = gridRows.find((r) => r.rowIndex === row)
    if (gridRow) {
      for (let c = 0; c < gridRow.cols; c++) {
        if (c !== col) addEffect(`${row}-${c}`, -1, effectMap)
      }
    }
  }

  applySimpleEffects(
    [{ dx: 0, dy: -1, value: 3 }],
    { row, col },
    rotation,
    effectMap,
    gridRows,
    undefined,
    stats
  )
}

// ── 전이(transition): rotation-dependent row +1/col -1 swap ──
function applyTransition(
  row: number, col: number, rotation: 0 | 1 | 2 | 3,
  effectMap: EffectMap, gridRows: GridRow[]
): void {
  const rowPositive = rotation === 0 || rotation === 2
  const gridRow = gridRows.find((r) => r.rowIndex === row)
  if (gridRow) {
    for (let c = 0; c < gridRow.cols; c++) {
      if (c !== col) addEffect(`${row}-${c}`, rowPositive ? 1 : -1, effectMap)
    }
  }
  for (const r of gridRows) {
    if (r.rowIndex !== row && col < r.cols) {
      addEffect(`${r.rowIndex}-${col}`, rowPositive ? -1 : 1, effectMap)
    }
  }
}

// ── 정의(justice): leftmost or rightmost col → entire column +1 ──
function applyJustice(
  row: number, col: number,
  effectMap: EffectMap, gridRows: GridRow[]
): void {
  const gridRow = gridRows.find((r) => r.rowIndex === row)
  if (!gridRow) return
  const isEdge = col === 0 || col === gridRow.cols - 1
  if (!isEdge) return
  for (const r of gridRows) {
    if (col < r.cols && r.rowIndex !== row) {
      addEffect(`${r.rowIndex}-${col}`, 1, effectMap)
    }
  }
}

// ── 기반(base): same row +1 (except self) ──
function applyBase(
  row: number, col: number,
  effectMap: EffectMap, gridRows: GridRow[]
): void {
  const gridRow = gridRows.find((r) => r.rowIndex === row)
  if (!gridRow) return
  for (let c = 0; c < gridRow.cols; c++) {
    if (c !== col) addEffect(`${row}-${c}`, 1, effectMap)
  }
}

// ── 동시성(concurrency): same column +1 (except self) ──
function applyConcurrency(
  row: number, col: number,
  effectMap: EffectMap, gridRows: GridRow[], _totalRows: number
): void {
  for (const r of gridRows) {
    if (r.rowIndex !== row && col < r.cols) {
      addEffect(`${r.rowIndex}-${col}`, 1, effectMap)
    }
  }
}

// ── 반항(rebellion): two opposite diagonals until out of grid / non-number ──
function applyRebellion(
  row: number, col: number, rotation: 0 | 1 | 2 | 3,
  effectMap: EffectMap
): void {
  const sign = rotation === 1 || rotation === 3 ? -1 : 1
  const dirs: Array<[number, number]> = [[sign, -1], [-sign, 1]]

  for (const [dx, dy] of dirs) {
    let r = row + dy
    let c = col + dx
    for (;;) {
      const key = `${r}-${c}`
      const val = effectMap[key]
      if (val !== undefined && typeof val === 'number') {
        effectMap[key] = val + 1
      } else {
        break
      }
      r += dy
      c += dx
    }
  }
}

// ── 이음(connection): rotate BOTH +2 {0,-1} and ignore {0,1} ──
function applyConnection(
  row: number, col: number, rotation: 0 | 1 | 2 | 3,
  effectMap: EffectMap, gridRows: GridRow[],
  _stats?: EffectStats
): void {
  const plus = rotateEffect(0, -1, rotation)
  addEffect(`${row + plus.newDy}-${col + plus.newDx}`, 2, effectMap)

  const block = rotateEffect(0, 1, rotation)
  const targetRow = row + block.newDy
  const targetCol = col + block.newDx
  if (isValidPosition(targetRow, targetCol, gridRows)) {
    effectMap[`${targetRow}-${targetCol}`] = 'ignore'
  }
}

// ── 차양(shade): first row → last row +1, plus second-to-last overhang ──
function applyShade(
  row: number, maxRowIndex: number,
  effectMap: EffectMap, gridRows: GridRow[]
): void {
  if (row !== 0 || gridRows.length < 2) return
  const lastRow = gridRows[gridRows.length - 1]
  const secondLast = gridRows[gridRows.length - 2]
  if (!lastRow || lastRow.rowIndex !== maxRowIndex) return

  for (let c = 0; c < lastRow.cols; c++) {
    addEffect(`${lastRow.rowIndex}-${c}`, 1, effectMap)
  }
  if (secondLast.cols > lastRow.cols) {
    for (let c = lastRow.cols; c < secondLast.cols; c++) {
      addEffect(`${secondLast.rowIndex}-${c}`, 1, effectMap)
    }
  }
}

// ── 경계(boundary): first + last row +1, plus second-to-last overhang ──
function applyBoundary(
  effectMap: EffectMap, gridRows: GridRow[]
): void {
  const bumpRow = (gridRow: GridRow) => {
    for (let c = 0; c < gridRow.cols; c++) {
      addEffect(`${gridRow.rowIndex}-${c}`, 1, effectMap)
    }
  }

  const firstRow = gridRows[0]
  if (firstRow) bumpRow(firstRow)

  if (gridRows.length > 1) {
    const lastRow = gridRows[gridRows.length - 1]
    const secondLast = gridRows[gridRows.length - 2]
    bumpRow(lastRow)
    if (secondLast.cols > lastRow.cols) {
      for (let c = lastRow.cols; c < secondLast.cols; c++) {
        addEffect(`${secondLast.rowIndex}-${c}`, 1, effectMap)
      }
    }
  }
}

// ── 광휘(sheen): rot 1/3 → column +1, else row +1; adjacent +2 is rotated ──
function applySheen(
  row: number, col: number, rotation: 0 | 1 | 2 | 3,
  effectMap: EffectMap, gridRows: GridRow[],
  stats?: EffectStats
): void {
  if (rotation === 1 || rotation === 3) {
    for (const r of gridRows) {
      if (r.rowIndex !== row && col < r.cols) {
        addEffect(`${r.rowIndex}-${col}`, 1, effectMap)
      }
    }
  } else {
    const gridRow = gridRows.find((r) => r.rowIndex === row)
    if (gridRow) {
      for (let c = 0; c < gridRow.cols; c++) {
        if (c !== col) addEffect(`${row}-${c}`, 1, effectMap)
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
    effectMap,
    gridRows,
    undefined,
    stats
  )
}

// ── 기적(miracle): same row + same col +1 (cross, except self) ──
function applyMiracle(
  row: number, col: number,
  effectMap: EffectMap, gridRows: GridRow[], _totalRows: number
): void {
  const gridRow = gridRows.find((r) => r.rowIndex === row)
  if (gridRow) {
    for (let c = 0; c < gridRow.cols; c++) {
      if (c !== col) addEffect(`${row}-${c}`, 1, effectMap)
    }
  }
  for (const r of gridRows) {
    if (r.rowIndex !== row && col < r.cols) {
      addEffect(`${r.rowIndex}-${col}`, 1, effectMap)
    }
  }
}

// ── 깃발(flag): left edge only, NO rotation ──
function applyFlag(
  row: number, col: number,
  effectMap: EffectMap, gridRows: GridRow[],
  stats?: EffectStats
): void {
  if (col !== 0) return
  const effects: Effect[] = [
    { dx: 0, dy: -1, value: 1 },
    { dx: 1, dy: 0, value: 1 },
    { dx: 2, dy: 0, value: 2 },
    { dx: 3, dy: 0, value: 3 },
    { dx: 0, dy: 1, value: -1 },
  ]
  // Wiki does not pass tablet into `n` — rotation stays 0
  applySimpleEffects(effects, { row, col }, 0, effectMap, gridRows, undefined, stats)
}

// ── Tablet shield: debuff on a tablet cell → 0, unless hospitality bypass ──
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
    if (typeof val === 'number' && val < 0) {
      shielded[posKey] = 0
    }
  })

  return shielded
}

// ── Full calculation with shield ──
export function calculateEffectsWithShield(
  slots: GridSlot[],
  gridRows: GridRow[]
): EffectMap {
  const shieldBypass = new Set<string>()
  const raw = calculateAllEffects(slots, gridRows, shieldBypass)
  return applyTabletShield(slots, gridRows, raw, shieldBypass)
}
