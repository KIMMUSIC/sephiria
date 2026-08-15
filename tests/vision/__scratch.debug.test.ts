import { describe, it } from 'vitest'
import { PlateMatcherRecognizer } from '@/lib/vision/plate-matcher'
import { loadAllTemplates, loadFixture, loadRecognizeInput, score } from './harness'

describe('debug 1.jpeg + 7.png', () => {
  it('prints mismatches', async () => {
    const templates = await loadAllTemplates()
    const recognizer = new PlateMatcherRecognizer()
    recognizer.loadTemplates(templates)
    for (const name of ['1.jpeg', '7.png']) {
      const fixture = loadFixture(name)
      const { img, opts } = await loadRecognizeInput(fixture, true)
      const predictions = await recognizer.recognize(img, opts)
      const result = score(predictions, fixture)
      console.log(name, 'top1', result.counts.top1Correct, '/', result.counts.itemTotal,
        'overall', result.counts.overallCorrect, '/', result.counts.scored)
      for (const m of result.mismatches) {
        console.log(`  slot ${m.slotIndex}: ${m.expected} -> ${m.predicted} @ ${m.confidence.toFixed(4)}`)
      }
    }
  })
})
