import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { describe, it } from 'vitest'
import { calibrateGrid } from '@/lib/vision/grid-calibrate'
import { inferLastRowCols, slotCountFromGrid } from '@/lib/vision/last-row'
import { makeMatchScorer, PlateMatcherRecognizer } from '@/lib/vision/plate-matcher'
import { loadAllTemplates, loadImage, PROJECT_ROOT } from './harness'

const NAMES = ['6.png', '7.png', '8.png', '9.png']

describe('crop captures', () => {
  it('writes cell crops and top5', async () => {
    const templates = await loadAllTemplates()
    const rec = new PlateMatcherRecognizer()
    await rec.loadTemplates(templates)
    const scorer = makeMatchScorer(templates, { rows: 6, cols: 6 })
    const outRoot = '/tmp/sephiria-cells'
    fs.mkdirSync(outRoot, { recursive: true })
    const summary: unknown[] = []

    for (const name of NAMES) {
      const imgPath = path.join(PROJECT_ROOT, '인벤 예시', name)
      const img = await loadImage(imgPath)
      const grid = calibrateGrid(img, { cols: 6, scorer })
      if (!grid) continue
      const lastRowCols = inferLastRowCols(img, grid)
      const totalSlots = slotCountFromGrid(grid, lastRowCols)
      const preds = await rec.recognize(img, {
        rows: grid.rows,
        cols: grid.cols,
        totalSlots,
        grid,
      })
      const dir = path.join(outRoot, name.replace('.png', ''))
      fs.mkdirSync(dir, { recursive: true })
      const pitchX = grid.gridWidth / grid.cols
      const pitchY = grid.gridHeight / grid.rows
      const raw = await sharp(imgPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

      const cells = []
      for (const p of preds) {
        const r = Math.floor(p.slotIndex / grid.cols)
        const c = p.slotIndex % grid.cols
        const x = Math.max(0, Math.round(grid.originX + c * pitchX))
        const y = Math.max(0, Math.round(grid.originY + r * pitchY))
        const w = Math.max(1, Math.round(pitchX))
        const h = Math.max(1, Math.round(pitchY))
        const crop = Buffer.alloc(w * h * 4)
        for (let yy = 0; yy < h; yy++) {
          const sy = Math.min(raw.info.height - 1, y + yy)
          for (let xx = 0; xx < w; xx++) {
            const sx = Math.min(raw.info.width - 1, x + xx)
            const si = (sy * raw.info.width + sx) * 4
            const di = (yy * w + xx) * 4
            crop[di] = raw.data[si]
            crop[di + 1] = raw.data[si + 1]
            crop[di + 2] = raw.data[si + 2]
            crop[di + 3] = raw.data[si + 3]
          }
        }
        const file = `r${r + 1}c${c + 1}.png`
        await sharp(crop, { raw: { width: w, height: h, channels: 4 } }).png().toFile(path.join(dir, file))
        cells.push({
          slot: p.slotIndex,
          rc: `r${r + 1}c${c + 1}`,
          pred: p.matchedValue,
          type: p.type,
          conf: Number(p.confidence.toFixed(3)),
          top5: (p.candidates ?? []).slice(0, 5).map((x) => `${x.value}:${x.confidence.toFixed(3)}`),
        })
      }
      summary.push({ name, grid, lastRowCols, totalSlots, cells })
    }
    fs.writeFileSync('/tmp/sephiria-cells/summary.json', JSON.stringify(summary, null, 2))
  }, 180000)
})
