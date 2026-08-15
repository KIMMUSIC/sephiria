import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { calibrateGrid, type GridRect, type GridScorer } from '@/lib/vision/grid-calibrate'
import { makeMatchScorer, PlateMatcherRecognizer } from '@/lib/vision/plate-matcher'
import type { TemplateSource } from '@/lib/vision/types'
import {
  aggregateCounts,
  loadAllTemplates,
  loadFixture,
  loadImage,
  resolveFixtureImage,
  score,
  type Fixture,
  type ScoreResult,
} from './harness'

const FIXTURES = ['1.jpeg', '2.png', '3.png', '4.png', '5.png', '6.png', '7.png']

/**
 * Per-fixture minimums for the auto-detected grid, pinned to today's measured
 * numbers. The aggregate floor alone cannot see one fixture regressing while
 * another improves: 6.png fell 22 -> 18 in an earlier round and the total stayed
 * at 156 because 7.png gained 5 and 5.png gained 4.
 */
const AUTO_PER_FIXTURE: Record<string, { top1: number; overall: number }> = {
  '1.jpeg': { top1: 5, overall: 5 },
  '2.png': { top1: 14, overall: 30 },
  '3.png': { top1: 11, overall: 28 },
  '4.png': { top1: 7, overall: 25 },
  '5.png': { top1: 17, overall: 22 },
  '6.png': { top1: 17, overall: 18 },
  '7.png': { top1: 22, overall: 28 },
}

interface Row {
  name: string
  fixture: Fixture
  detected: GridRect | null
  handLabelled: ScoreResult
  auto: ScoreResult
  fallback: ScoreResult
  /** Row count detected with no `rows` hint — the production call. */
  autoRows: number
  fallbackRows: number | null
}

const rows: Row[] = []
let templates: TemplateSource[] = []
// One recognizer and one scorer for the whole file: both are stateless across
// calls apart from their sprite cache, and rebuilding that per fixture was the
// single largest cost in this suite.
let recognizer: PlateMatcherRecognizer
let scorer: GridScorer

/**
 * The fixtures' `grid` values were themselves produced by centroid regression
 * plus a score sweep, so "distance to the fixture grid" is a circular metric.
 * The verdict here is end-to-end recognition accuracy; the px error is printed
 * for reference only and carries no assertion.
 */
describe('grid calibration', () => {
  beforeAll(async () => {
    templates = await loadAllTemplates()
    recognizer = new PlateMatcherRecognizer()
    await recognizer.loadTemplates(templates)
    scorer = makeMatchScorer(templates, { rows: 6, cols: 6 })
  })

  for (const name of FIXTURES) {
    it(`calibrates ${name}`, async () => {
      const fixture = loadFixture(name)
      const img = await loadImage(resolveFixtureImage(fixture))

      const base = { rows: fixture.rows, cols: fixture.cols, totalSlots: fixture.totalSlots }

      const handLabelled = score(
        await recognizer.recognize(img, { ...base, grid: fixture.grid }),
        fixture
      )

      const detected = calibrateGrid(img, { cols: fixture.cols, rows: fixture.rows, scorer })
      expect(detected).not.toBeNull()
      const auto = score(await recognizer.recognize(img, { ...base, grid: detected! }), fixture)
      const min = AUTO_PER_FIXTURE[name]
      expect(auto.counts.top1Correct, `${name} auto top1`).toBeGreaterThanOrEqual(min.top1)
      expect(auto.counts.overallCorrect, `${name} auto overall`).toBeGreaterThanOrEqual(min.overall)

      // Same call without a scorer: exercises the brightness-profile fallback and
      // isolates how much the match score is actually worth.
      const fallbackGrid = calibrateGrid(img, { cols: fixture.cols, rows: fixture.rows })
      expect(fallbackGrid).not.toBeNull()
      const fallback = score(
        await recognizer.recognize(img, { ...base, grid: fallbackGrid! }),
        fixture
      )

      // The production call: the user never tells us the row count.
      const autoRows = calibrateGrid(img, { cols: fixture.cols, scorer })
      expect(autoRows).not.toBeNull()
      const fallbackRows = calibrateGrid(img, { cols: fixture.cols })

      rows.push({
        name,
        fixture,
        detected,
        handLabelled,
        auto,
        fallback,
        autoRows: autoRows!.rows,
        fallbackRows: fallbackRows?.rows ?? null,
      })
    })
  }

  it('detects the row count with no rows hint', () => {
    const wrong = rows.filter((r) => r.autoRows !== r.fixture.rows)
    expect(wrong.map((r) => `${r.name}: ${r.autoRows} != ${r.fixture.rows}`)).toEqual([])
  })

  it('holds the end-to-end accuracy floor', () => {
    const auto = aggregateCounts(rows.map((r) => r.auto.counts))
    expect(auto.counts.overallCorrect).toBeGreaterThanOrEqual(156)
    expect(auto.counts.top1Correct).toBeGreaterThanOrEqual(93)

    const fallback = aggregateCounts(rows.map((r) => r.fallback.counts))
    expect(fallback.counts.overallCorrect).toBeGreaterThanOrEqual(140)
  })

  afterAll(() => {
    console.log('\n' + report().join('\n'))
  })
})

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

function centers(
  g: { originX: number; originY: number; gridWidth: number; gridHeight: number },
  cols: number,
  rows_: number
): [number, number][] {
  const px = g.gridWidth / cols
  const py = g.gridHeight / rows_
  const out: [number, number][] = []
  for (let i = 0; i < cols * rows_; i++) {
    const r = Math.floor(i / cols)
    const c = i % cols
    out.push([g.originX + (c + 0.5) * px, g.originY + (r + 0.5) * py])
  }
  return out
}

function table(header: string[], body: string[][]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...body.map(line)]
}

function accuracyRows(pick: (r: Row) => ScoreResult): string[][] {
  const body = rows.map((r) => {
    const s = pick(r)
    return [
      r.name,
      String(s.counts.scored),
      pct(s.emptyAccuracy),
      `${pct(s.top1Accuracy)} (${s.counts.top1Correct}/${s.counts.itemTotal})`,
      `${pct(s.overallAccuracy)} (${s.counts.overallCorrect}/${s.counts.scored})`,
    ]
  })
  const totals = aggregateCounts(rows.map((r) => pick(r).counts))
  body.push([
    'TOTAL',
    String(totals.counts.scored),
    pct(totals.emptyAccuracy),
    `${pct(totals.top1Accuracy)} (${totals.counts.top1Correct}/${totals.counts.itemTotal})`,
    `${pct(totals.overallAccuracy)} (${totals.counts.overallCorrect}/${totals.counts.scored})`,
  ])
  return body
}

function report(): string[] {
  const out: string[] = []
  const header = ['image', 'scored', 'empty', 'top1', 'overall']

  out.push('End-to-end accuracy — HAND-LABELLED grid (control):')
  out.push(...table(header, accuracyRows((r) => r.handLabelled)))
  out.push('')
  out.push('End-to-end accuracy — AUTO-DETECTED grid (calibrateGrid + match scorer):')
  out.push(...table(header, accuracyRows((r) => r.auto)))
  out.push('')
  out.push('End-to-end accuracy — AUTO-DETECTED grid, no scorer (brightness-profile fallback):')
  out.push(...table(header, accuracyRows((r) => r.fallback)))
  out.push('')

  const geomHeader = ['image', 'cols x rows', 'mean err', 'max err', 'd originX', 'd originY']
  const geomBody = rows.map(({ name, detected, fixture }) => {
    if (!detected) return [name, 'FAILED', '-', '-', '-', '-']
    const a = centers(detected, detected.cols, detected.rows)
    const b = centers(fixture.grid!, fixture.cols, fixture.rows)
    const n = Math.min(a.length, b.length)
    let sum = 0
    let max = 0
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1])
      sum += d
      if (d > max) max = d
    }
    return [
      name,
      `${detected.cols}x${detected.rows}`,
      `${(sum / n).toFixed(2)}px`,
      `${max.toFixed(2)}px`,
      (detected.originX - fixture.grid!.originX).toFixed(2),
      (detected.originY - fixture.grid!.originY).toFixed(2),
    ]
  })
  out.push('Detected row count (fixture cols given, rows withheld):')
  out.push(
    ...table(
      ['image', 'true rows', 'auto + scorer', 'fallback (no scorer)'],
      rows.map((r) => [
        r.name,
        String(r.fixture.rows),
        `${r.autoRows}${r.autoRows === r.fixture.rows ? '' : '  MISMATCH'}`,
        r.fallbackRows === null
          ? 'null'
          : `${r.fallbackRows}${r.fallbackRows === r.fixture.rows ? '' : '  MISMATCH'}`,
      ])
    )
  )
  out.push('')
  out.push('Geometry vs the hand-labelled grid (reference only — circular metric):')
  out.push(...table(geomHeader, geomBody))
  out.push('')
  return out
}
