import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BaselineHistogramRecognizer } from '@/lib/vision/baseline-histogram'
import { PlateMatcherRecognizer } from '@/lib/vision/plate-matcher'
import type { Recognizer } from '@/lib/vision/types'
import {
  aggregateCounts,
  loadAllTemplates,
  loadFixture,
  loadRecognizeInput,
  score,
  type ScoreResult,
} from './harness'

const FIXTURES = ['1.jpeg', '2.png', '3.png', '4.png', '5.png', '6.png', '7.png']

interface AccuracyFloor {
  emptyAccuracy: number
  top1Correct: number
  overallCorrect: number
}

interface RecognizerCase {
  label: string
  create: () => Recognizer
  /** Grid-aware recognizers take the fixture's fractional grid rect directly. */
  gridAware: boolean
  /** Baseline is a deliberately bad reference point, so it carries no floor. */
  floor?: AccuracyFloor
  /**
   * Per-fixture minimums. An aggregate floor alone lets one fixture regress
   * while another improves and hides it in the total.
   */
  perFixture?: Record<string, { top1: number; overall: number }>
}

const RECOGNIZERS: RecognizerCase[] = [
  { label: 'baseline', create: () => new BaselineHistogramRecognizer(), gridAware: false },
  {
    label: 'plate-matcher',
    create: () => new PlateMatcherRecognizer(),
    gridAware: true,
    // Re-baselined against the 145-label set (48 -> 86 -> 116 -> 145).
    // Expanding 48 -> 86 lowered top-1 from 70.8% to 66.3%: the 48-label set only
    // contained cells this matcher could already find. 6.png is user-supplied ground
    // truth with zero candidate assistance and scores 72.4%, which says the
    // self-labelled estimate was not inflated.
    // Re-raised after the §9-G rework (per-sprite deterministic scales, prefilter
    // removed): top-1 95 -> 119, overall 156 -> 181, empty 200/208.
    // Re-pinned after the round-3 label corrections (10 user-confirmed relabels
    // in 3.png/5.png; item labels 145 -> 147): top-1 128/147, overall 189/208.
    // Raised after roadmap 4 (rendered-sprite harvest / depleted extras),
    // then re-pinned after the glyph-clean reharvest (keel 4.png#20 flipped).
    // Raised after roadmap 5 (occupancy rework + nuisance masking): empty 200/208
    // -> 207/208, top-1 133 -> 141, overall 194 -> 202.
    // Raised after roadmap 6 (pixel-exact re-rank in original screenshot space):
    // top-1 141 -> 144, overall 202 -> 205. Flips: 2.png#1 heart, 4.png#23
    // frozen_bow, 4.png#25 defender. JPEG 1.jpeg unchanged (lossless=false).
    // 2026-08-17 slot-count correction: 2/3/4/5.png were labelled rows*cols = 36
    // when each bag really holds 32; the four extra cells per fixture were frame
    // chrome labelled as empty inventory. Removing those 16 trivially-correct
    // empties shrinks the yardstick, it does not move recognition:
    //   top-1      144 -> 144   (unchanged, every fixture identical)
    //   overall    205 -> 189   (-16, exactly the removed empties)
    //   empty acc  207/208 -> 191/192  (still exactly one empty error)
    // The recognizer still classifies the whole rows*cols rect and the result is
    // trimmed afterwards — see lib/vision/inventory-scan.ts for why.
    floor: { emptyAccuracy: 0.9947, top1Correct: 144, overallCorrect: 189 },
    // Measured, not aspirational: these are today's numbers pinned so a future
    // change cannot trade one fixture away against another.
    perFixture: {
      '1.jpeg': { top1: 9, overall: 9 },
      '2.png': { top1: 19, overall: 31 },
      '3.png': { top1: 17, overall: 29 },
      '4.png': { top1: 16, overall: 30 },
      '5.png': { top1: 25, overall: 25 },
      '6.png': { top1: 29, overall: 30 },
      '7.png': { top1: 29, overall: 35 },
    },
  },
]

interface Run {
  recognizerName: string
  results: { name: string; result: ScoreResult }[]
}

const runs: Run[] = []
let templateCount = 0

describe('recognition accuracy', () => {
  for (const { label, create, gridAware, floor, perFixture } of RECOGNIZERS) {
    describe(label, () => {
      let recognizer: Recognizer
      const results: { name: string; result: ScoreResult }[] = []

      beforeAll(async () => {
        const templates = await loadAllTemplates()
        templateCount = templates.length
        recognizer = create()
        await recognizer.loadTemplates(templates)
      })

      for (const name of FIXTURES) {
        it(`scores ${name}`, async () => {
          const fixture = loadFixture(name)
          const { img, opts } = await loadRecognizeInput(fixture, gridAware)
          const wide = await recognizer.recognize(img, {
            ...opts,
            lossless: name.endsWith('.png'),
          })

          expect(wide).toHaveLength(fixture.rows * fixture.cols)

          // Trim to the bag's real size, the same way inventory-scan does.
          const predictions = wide.filter((p) => p.slotIndex < fixture.totalSlots)
          expect(predictions).toHaveLength(fixture.totalSlots)

          const result = score(predictions, fixture)
          const min = perFixture?.[name]
          if (min) {
            expect(result.counts.top1Correct, `${name} top1`).toBeGreaterThanOrEqual(min.top1)
            expect(result.counts.overallCorrect, `${name} overall`).toBeGreaterThanOrEqual(
              min.overall
            )
          }
          results.push({ name, result })
        })
      }

      if (floor) {
        it('holds the accuracy floor', () => {
          const total = aggregateCounts(results.map((r) => r.result.counts))
          expect(total.emptyAccuracy).toBeGreaterThanOrEqual(floor.emptyAccuracy)
          expect(total.counts.top1Correct).toBeGreaterThanOrEqual(floor.top1Correct)
          expect(total.counts.overallCorrect).toBeGreaterThanOrEqual(floor.overallCorrect)
        })
      }

      afterAll(() => {
        runs.push({ recognizerName: recognizer?.name ?? label, results })
      })
    })
  }

  afterAll(() => {
    const out: string[] = ['']
    out.push(`templates: ${templateCount}`)
    for (const run of runs) out.push(...reportLines(run.recognizerName, run.results))
    out.push('')
    for (const run of runs) out.push(...mismatchLines(run.recognizerName, run.results))
    console.log(out.join('\n'))
  })
})

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

function reportLines(
  recognizerName: string,
  results: { name: string; result: ScoreResult }[]
): string[] {
  if (results.length === 0) return [``, `Recognizer: ${recognizerName}   (no results)`]

  const header = ['image', 'scored', 'skip', 'empty', 'top1', 'type', 'overall']
  const rows = results.map(({ name, result }) => [
    name,
    String(result.counts.scored),
    String(result.counts.skipped),
    pct(result.emptyAccuracy),
    `${pct(result.top1Accuracy)} (${result.counts.top1Correct}/${result.counts.itemTotal})`,
    pct(result.typeAccuracy),
    `${pct(result.overallAccuracy)} (${result.counts.overallCorrect}/${result.counts.scored})`,
  ])

  const total = aggregateCounts(results.map((r) => r.result.counts))
  rows.push([
    'TOTAL',
    String(total.counts.scored),
    String(total.counts.skipped),
    pct(total.emptyAccuracy),
    `${pct(total.top1Accuracy)} (${total.counts.top1Correct}/${total.counts.itemTotal})`,
    pct(total.typeAccuracy),
    `${pct(total.overallAccuracy)} (${total.counts.overallCorrect}/${total.counts.scored})`,
  ])

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ')

  const out: string[] = ['']
  out.push(`Recognizer: ${recognizerName}`)
  out.push(line(header))
  out.push(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const row of rows) out.push(line(row))
  return out
}

function mismatchLines(
  recognizerName: string,
  results: { name: string; result: ScoreResult }[]
): string[] {
  const out: string[] = [`Mismatches [${recognizerName}] (expected -> predicted @ confidence):`]
  for (const { name, result } of results) {
    if (result.mismatches.length === 0) {
      out.push(`  ${name}: none`)
      continue
    }
    out.push(`  ${name}: ${result.mismatches.length}`)
    for (const m of result.mismatches) {
      out.push(
        `    slot ${String(m.slotIndex).padStart(2)}: ${m.expected ?? '(empty)'} -> ` +
          `${m.predicted ?? '(empty)'} @ ${m.confidence.toFixed(4)}`
      )
    }
  }
  out.push('')
  return out
}
