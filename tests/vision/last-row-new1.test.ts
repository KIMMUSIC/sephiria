import { describe, expect, it } from 'vitest'
import { calibrateGrid } from '@/lib/vision/grid-calibrate'
import { inferLastRowCols, slotCountFromGrid } from '@/lib/vision/last-row'
import { makeMatchScorer, PlateMatcherRecognizer } from '@/lib/vision/plate-matcher'
import { loadAllTemplates, loadImage, PROJECT_ROOT } from './harness'
import path from 'node:path'

describe('new1 last row is a full 6', () => {
  it('keeps the trailing red empty cell (30 slots)', async () => {
    const templates = await loadAllTemplates()
    const rec = new PlateMatcherRecognizer()
    await rec.loadTemplates(templates)
    const scorer = makeMatchScorer(templates, { rows: 6, cols: 6 })
    const img = await loadImage(path.join(PROJECT_ROOT, '인벤 예시', 'new1.png'))
    const grid = calibrateGrid(img, { cols: 6, scorer })
    expect(grid).not.toBeNull()
    const last = inferLastRowCols(img, grid!)
    expect(last).toBe(6)
    expect(slotCountFromGrid(grid!, last)).toBe(30)
  }, 60000)
})
