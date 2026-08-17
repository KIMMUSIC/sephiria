import type { GridRect } from './grid-calibrate'
import { inferLastRowCols, slotCountFromGrid } from './last-row'
import type { CellPrediction, RGBAImage, Recognizer } from './types'

export interface InventoryScan {
  /** Predictions for the real inventory only, indices 0..slotCount-1. */
  predictions: CellPrediction[]
  /** Real inventory size: full rows plus the measured last-row width. */
  slotCount: number
  /** Cells present in the last row, in [0, cols]. */
  lastRowCols: number
}

/**
 * Recognize a calibrated inventory and report its real size.
 *
 * The bag's last row is usually short — a 32-slot inventory calibrates as a 6x6
 * rect — so `rows * cols` overstates it. That was the shipped behaviour, and it
 * is why a 32-slot screenshot came back as 36.
 *
 * The recognizer still classifies the WHOLE calibrated rect and the result is
 * trimmed afterwards. Both halves are load-bearing:
 *  - Trimming is what makes the reported size correct.
 *  - Classifying the full rect keeps the empty-plate statistics intact. 인벤 예시/5.png
 *    is a bag with every one of its 32 slots occupied; the only empty-looking
 *    samples in the frame are the four chrome cells past the short last row.
 *    Narrowing the population to 32 removed them and three dim items — slots 25
 *    (red_dew), 26 (balisong) and 30 (black_planet) — flipped to "empty".
 */
export async function scanInventory(
  recognizer: Recognizer,
  img: RGBAImage,
  grid: GridRect,
  opts: { lossless?: boolean } = {}
): Promise<InventoryScan> {
  const lastRowCols = inferLastRowCols(img, grid)
  const slotCount = slotCountFromGrid(grid, lastRowCols)

  const predictions = await recognizer.recognize(img, {
    rows: grid.rows,
    cols: grid.cols,
    totalSlots: grid.rows * grid.cols,
    grid,
    ...(opts.lossless ? { lossless: true } : {}),
  })

  return {
    predictions: predictions.filter((p) => p.slotIndex < slotCount),
    slotCount,
    lastRowCols,
  }
}
