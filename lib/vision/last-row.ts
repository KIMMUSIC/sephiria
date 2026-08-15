import { analyzeCell, CELL_RING_INDICES, cropCellNearest, TRIM } from './plate-matcher'
import type { GridRect } from './grid-calibrate'
import type { RGBAImage } from './types'

type RGB = [number, number, number]

function cellBox(grid: GridRect, index: number) {
  const pitchX = grid.gridWidth / grid.cols
  const pitchY = grid.gridHeight / grid.rows
  const margin = pitchX * TRIM
  const r = Math.floor(index / grid.cols)
  const c = index % grid.cols
  const x = grid.originX + c * pitchX
  const y = grid.originY + r * pitchY
  return {
    left: Math.trunc(x + margin),
    top: Math.trunc(y + margin),
    right: Math.trunc(x + pitchX - margin),
    bottom: Math.trunc(y + pitchY - margin),
  }
}

function inside(img: RGBAImage, b: { top: number; left: number; bottom: number; right: number }) {
  return b.top >= 0 && b.left >= 0 && b.bottom <= img.height && b.right <= img.width
}

function ringMean(cell: Float32Array): RGB {
  let r = 0, g = 0, b = 0
  for (let k = 0; k < CELL_RING_INDICES.length; k++) {
    const q = CELL_RING_INDICES[k] * 3
    r += cell[q]; g += cell[q + 1]; b += cell[q + 2]
  }
  const n = CELL_RING_INDICES.length
  return [r / n, g / n, b / n]
}

function medianOf3(v: RGB[]): RGB {
  const out: number[] = []
  for (let c = 0; c < 3; c++) {
    const a = v.map((x) => x[c]).sort((p2, q2) => p2 - q2)
    out.push(a.length % 2 ? a[a.length >> 1] : (a[(a.length >> 1) - 1] + a[a.length >> 1]) / 2)
  }
  return [out[0], out[1], out[2]]
}

function dist3(a: RGB, b: RGB) {
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3
}

/** Riveted inventory plate vs bag chrome / off-panel purple. */
export function looksLikeInventoryPlate(cell: Float32Array, w = 64): boolean {
  const spots: [number, number][] = [[4, 4], [4, w - 5], [w - 5, 4], [w - 5, w - 5]]
  let bright = 0
  for (const [cy, cx] of spots) {
    let s = 0
    let n = 0
    for (let y = cy - 2; y <= cy + 2; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) {
        const q = (y * w + x) * 3
        s += 0.299 * cell[q] + 0.587 * cell[q + 1] + 0.114 * cell[q + 2]
        n++
      }
    }
    if (s / n > 88) bright++
  }
  if (bright >= 2) return true
  const ring = ringMean(cell)
  // Bag chrome is blue-purple (B ≈ R, both > G). Red empty slots are
  // maroon (R >> B) and must stay as inventory.
  const purple =
    ring[2] > ring[1] + 6 && ring[0] > ring[1] + 4 && ring[2] >= ring[0] - 8
  return !purple
}

/**
 * Drop trailing last-row cells that are not inventory plates.
 * Empty inventory slots stay (ring matches the rest of the grid).
 * Chrome / frame / off-panel cells on a short last row are removed.
 * All-false => 0 (caller should drop the whole last row).
 */
export function trimTrailingNonInventory(isInventory: boolean[]): number {
  let n = isInventory.length
  while (n > 0 && !isInventory[n - 1]) n--
  return n
}

export function lastRowInventoryFlags(img: RGBAImage, grid: GridRect): boolean[] {
  const cols = grid.cols
  const rows = grid.rows
  const flags = new Array<boolean>(cols).fill(false)
  if (rows < 1 || cols < 1) return flags

  for (let c = 0; c < cols; c++) {
    const box = cellBox(grid, (rows - 1) * cols + c)
    if (!inside(img, box)) {
      flags[c] = false
      continue
    }
    const cell = cropCellNearest(img, box.left, box.top, box.right, box.bottom)
    if (!looksLikeInventoryPlate(cell)) {
      flags[c] = false
      continue
    }
    // Keep empty plates too (charcoal or red-tint). Ring-vs-occupied-median
    // used to drop red empty cells on the last row (new1 r5c6) because their
    // maroon fill is farther from occupied charcoal than the yard allows.
    // Off-panel purple already failed looksLikeInventoryPlate above.
    flags[c] = true
  }
  return flags
}

/** Last-row width in [0, cols]. 0 means the calibrated last row is entirely outside the inventory. */
export function inferLastRowCols(img: RGBAImage, grid: GridRect): number {
  return trimTrailingNonInventory(lastRowInventoryFlags(img, grid))
}

export function slotCountFromGrid(grid: GridRect, lastRowCols: number): number {
  const full = Math.max(0, grid.rows - 1) * grid.cols
  if (lastRowCols <= 0) return Math.max(grid.cols, full)
  return full + lastRowCols
}
