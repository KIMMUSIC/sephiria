import { describe, expect, it } from 'vitest'
import { looksLikeInventoryPlate, slotCountFromGrid, trimTrailingNonInventory } from '@/lib/vision/last-row'
import type { GridRect } from '@/lib/vision/grid-calibrate'

describe('last-row width', () => {
  it('trims trailing non-inventory cells', () => {
    expect(trimTrailingNonInventory([true, true, true, true, false, false])).toBe(4)
    expect(trimTrailingNonInventory([true, true, true, true, true, false])).toBe(5)
    expect(trimTrailingNonInventory([true, true, true, true, true, true])).toBe(6)
    expect(trimTrailingNonInventory([true, false, true, false, false, false])).toBe(3)
  })

  it('returns 0 when the whole last row is outside the inventory', () => {
    expect(trimTrailingNonInventory([false, false, false, false, false, false])).toBe(0)
  })

  it('does not drop an empty-but-real last row of inventory plates', () => {
    expect(trimTrailingNonInventory([true, true, true, true, true, true])).toBe(6)
  })

  it('computes slot count for a 35-slot short last row (7.png)', () => {
    const grid: GridRect = {
      originX: 0, originY: 0, gridWidth: 600, gridHeight: 600, cols: 6, rows: 6,
    }
    expect(slotCountFromGrid(grid, 5)).toBe(35)
    expect(slotCountFromGrid(grid, 4)).toBe(34)
    expect(slotCountFromGrid(grid, 6)).toBe(36)
    expect(slotCountFromGrid(grid, 0)).toBe(30)
  })
})

describe('inventory plate vs bag chrome', () => {
  it('rejects a flat purple cell and keeps a riveted one', () => {
    const purple = new Float32Array(64 * 64 * 3)
    for (let i = 0; i < purple.length; i += 3) {
      purple[i] = 59
      purple[i + 1] = 40
      purple[i + 2] = 60
    }
    expect(looksLikeInventoryPlate(purple)).toBe(false)

    const plate = new Float32Array(64 * 64 * 3)
    for (let i = 0; i < plate.length; i += 3) {
      plate[i] = 40
      plate[i + 1] = 42
      plate[i + 2] = 48
    }
    for (const [cy, cx] of [[4, 4], [4, 59], [59, 4], [59, 59]] as const) {
      for (let y = cy - 2; y <= cy + 2; y++) {
        for (let x = cx - 2; x <= cx + 2; x++) {
          const q = (y * 64 + x) * 3
          plate[q] = 160
          plate[q + 1] = 160
          plate[q + 2] = 170
        }
      }
    }
    expect(looksLikeInventoryPlate(plate)).toBe(true)

    const maroon = new Float32Array(64 * 64 * 3)
    for (let i = 0; i < maroon.length; i += 3) {
      maroon[i] = 85
      maroon[i + 1] = 46
      maroon[i + 2] = 66
    }
    expect(looksLikeInventoryPlate(maroon)).toBe(true)
  })
})

