import { describe, it } from 'vitest'
import { PlateMatcherRecognizer } from '@/lib/vision/plate-matcher'
import { loadAllTemplates, loadFixture, loadRecognizeInput } from './harness'

const FIXTURES = ['1.jpeg', '2.png', '3.png', '4.png', '5.png', '6.png', '7.png']
const GROUPS = [
  ['load', 'exit', 'entrance', 'future', 'advent', 'honor', 'base', 'advance', 'point'],
  ['defender', 'dedication'],
  ['thornbush', 'thorn'],
  ['shield_technique_manual', 'swordsmanship_textbook', 'mark_of_warrior'],
  ['hope', 'advance', 'connection', 'preparation', 'wit', 'unity', 'distribution'],
]
const IN_GROUP = new Set(GROUPS.flat())

describe('diag joint', () => {
  it('dumps joint stats', async () => {
    const templates = await loadAllTemplates()
    const rec = new PlateMatcherRecognizer()
    rec.loadTemplates(templates)
    const lines: string[] = []
    for (const name of FIXTURES) {
      const fixture = loadFixture(name)
      const { img, opts } = await loadRecognizeInput(fixture, true)
      const predictions = await rec.recognize(img, opts)
      const byIndex = new Map(predictions.map((p) => [p.slotIndex, p]))
      for (const exp of fixture.expected) {
        if (exp.matchedValue === '???' || exp.matchedValue === null) continue
        const pred = byIndex.get(exp.slotIndex)
        if (!pred || pred.matchedValue !== exp.matchedValue) continue
        const cands = pred.candidates ?? []
        const top1 = cands[0]?.confidence ?? pred.confidence
        const top2 = cands[1]?.confidence
        const margin = top2 === undefined ? 1 : top1 - top2
        if (top1 < 0.16 || margin < 0.06 || IN_GROUP.has(exp.matchedValue)) {
          lines.push(
            `${name}#${exp.slotIndex} ${exp.matchedValue} score=${top1.toFixed(4)} margin=${margin.toFixed(4)} inGroup=${IN_GROUP.has(exp.matchedValue)} cands=${cands
              .slice(0, 3)
              .map((c) => c.value + '@' + c.confidence.toFixed(3))
              .join(',')}`
          )
        }
      }
    }
    console.log('\n' + lines.join('\n'))
  }, 120000)
})
