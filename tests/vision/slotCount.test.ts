import { beforeAll, describe, expect, it } from 'vitest'
import { calibrateGrid, type GridScorer } from '@/lib/vision/grid-calibrate'
import { PlateMatcherRecognizer } from '@/lib/vision/plate-matcher'
import { scanInventory } from '@/lib/vision/inventory-scan'
import { loadAllTemplates, loadFixture, loadImage, resolveFixtureImage } from './harness'

/**
 * End-to-end slot-count detection.
 *
 * The pure helpers in tests/lastRow.test.ts only exercise synthetic arrays, so
 * nothing checked that a real screenshot resolves to the right inventory size.
 * The app shipped `rows * cols`, which reports a 32-slot bag as 36.
 *
 * This drives lib/vision/inventory-scan.ts — the same entry point the recognition
 * worker uses — so the count and the trimmed prediction list are both covered.
 */
const FIXTURES = [
  '1.jpeg',
  '2.png',
  '3.png',
  '4.png',
  '5.png',
  '6.png',
  '7.png',
  'live-6.png',
  'live-7.png',
  'live-8.png',
  'live-9.png',
  'live-new1.png',
]

let recognizer: PlateMatcherRecognizer

beforeAll(async () => {
  const templates = await loadAllTemplates()
  recognizer = new PlateMatcherRecognizer()
  recognizer.loadTemplates(templates)
}, 300_000)

describe('inventory slot count from a screenshot', () => {
  for (const name of FIXTURES) {
    it(`detects the slot count of ${name}`, async () => {
      const fixture = loadFixture(name)
      const img = await loadImage(resolveFixtureImage(fixture))

      const scorer: GridScorer = (im, rect) =>
        recognizer.scoreGrid(im, {
          rows: rect.rows,
          cols: rect.cols,
          totalSlots: rect.rows * rect.cols,
          grid: rect,
        })

      const grid = calibrateGrid(img, { cols: 6, scorer })
      expect(grid, `${name}: grid not calibrated`).not.toBeNull()

      const scan = await scanInventory(recognizer, img, grid!, {
        lossless: fixture.imagePath.endsWith('.png'),
      })

      // eslint-disable-next-line no-console
      console.log(
        `${name.padEnd(16)} grid ${grid!.rows}x${grid!.cols} ` +
          `lastRowCols=${scan.lastRowCols} inferred=${scan.slotCount} expected=${fixture.totalSlots}`
      )

      expect(scan.slotCount, `${name}: inferred slot count`).toBe(fixture.totalSlots)
      // The trim is what the grid is built from, so it must match exactly.
      expect(scan.predictions, `${name}: trimmed predictions`).toHaveLength(fixture.totalSlots)
    }, 120_000)
  }
})
