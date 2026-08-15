import path from 'node:path'
import fs from 'node:fs'
import { describe, it } from 'vitest'
import { calibrateGrid } from '@/lib/vision/grid-calibrate'
import { inferLastRowCols, slotCountFromGrid } from '@/lib/vision/last-row'
import { makeMatchScorer, PlateMatcherRecognizer } from '@/lib/vision/plate-matcher'
import { loadAllTemplates, loadImage, PROJECT_ROOT } from './harness'

const NAMES = ['6.png', '7.png', '8.png', '9.png']

function labels(): Map<string, string> {
  const map = new Map<string, string>()
  const artifacts = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data/artifacts.json'), 'utf8'))
  const tablets = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data/tablets.json'), 'utf8'))
  for (const a of artifacts) map.set(a.value, a.label_kor || a.label_eng || a.value)
  for (const t of tablets) map.set(t.value, t.ko_label || t.eng_label || t.value)
  return map
}

describe('new captures 6-9', () => {
  it('prints predictions', async () => {
    const templates = await loadAllTemplates()
    const rec = new PlateMatcherRecognizer()
    await rec.loadTemplates(templates)
    const scorer = makeMatchScorer(templates, { rows: 6, cols: 6 })
    const kor = labels()
    const report: string[] = []

    for (const name of NAMES) {
      const imgPath = path.join(PROJECT_ROOT, '인벤 예시', name)
      const img = await loadImage(imgPath)
      const grid = calibrateGrid(img, { cols: 6, scorer })
      if (!grid) {
        report.push(`${name}: GRID FAIL`)
        continue
      }
      const lastRowCols = inferLastRowCols(img, grid)
      const totalSlots = slotCountFromGrid(grid, lastRowCols)
      const preds = await rec.recognize(img, {
        rows: grid.rows,
        cols: grid.cols,
        totalSlots,
        grid,
      })
      report.push(
        `${name} ${img.width}x${img.height} grid=${grid.rows}x${grid.cols} slots=${totalSlots} lastRow=${lastRowCols} origin=${grid.originX.toFixed(1)},${grid.originY.toFixed(1)}`
      )
      for (const p of preds) {
        const r = Math.floor(p.slotIndex / grid.cols) + 1
        const c = (p.slotIndex % grid.cols) + 1
        const id = p.matchedValue ?? 'empty'
        const ko = p.matchedValue ? kor.get(p.matchedValue) ?? '' : ''
        const conf = p.confidence.toFixed(3)
        report.push(`  r${r}c${c} ${id}${ko ? ` (${ko})` : ''} ${p.type ?? '-'} ${conf}`)
      }
    }
    const text = report.join('\n')
    fs.writeFileSync('/tmp/score-captures.txt', text)
    console.log(text)
  }, 180000)
})
