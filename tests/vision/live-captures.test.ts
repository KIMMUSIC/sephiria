import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PlateMatcherRecognizer } from '@/lib/vision/plate-matcher'
import {
  loadAllTemplates,
  loadFixture,
  loadRecognizeInput,
  score,
  type ScoreResult,
} from './harness'

const LIVE = ['live-6.png', 'live-7.png', 'live-8.png', 'live-9.png', 'live-new1.png']

/** Floors from 2026-08-15 remeasure after last-row + rerank + dump-reject. */
const FLOORS: Record<string, { top1: number; overall: number }> = {
  'live-6.png': { top1: 10, overall: 19 },
  'live-7.png': { top1: 6, overall: 14 },
  'live-8.png': { top1: 19, overall: 25 },
  'live-9.png': { top1: 9, overall: 14 },
  'live-new1.png': { top1: 22, overall: 26 },
}

describe('live captures 6-9', () => {
  const results: { name: string; result: ScoreResult }[] = []
  const rec = new PlateMatcherRecognizer()

  beforeAll(async () => {
    await rec.loadTemplates(await loadAllTemplates())
  })

  for (const name of LIVE) {
    it(`scores ${name}`, async () => {
      const fixture = loadFixture(name)
      const { img, opts } = await loadRecognizeInput(fixture, true)
      const predictions = await rec.recognize(img, opts)
      expect(predictions.length).toBeGreaterThan(0)
      const result = score(predictions, fixture)
      results.push({ name, result })
      const floor = FLOORS[name]
      expect(result.counts.top1Correct).toBeGreaterThanOrEqual(floor.top1)
      expect(result.counts.overallCorrect).toBeGreaterThanOrEqual(floor.overall)
    })
  }

  afterAll(() => {
    for (const { name, result } of results) {
      const c = result.counts
      console.log(
        `${name} top1=${c.top1Correct}/${c.itemTotal} overall=${c.overallCorrect}/${c.scored} empty=${c.emptyCorrect} skip=${c.skipped}`
      )
      for (const m of result.mismatches) {
        console.log(`  slot ${m.slotIndex} exp=${m.expected} pred=${m.predicted} conf=${m.confidence.toFixed(3)}`)
      }
    }
  })
})
