import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { calibrateGrid, type GridRect, type GridScorer } from '@/lib/vision/grid-calibrate'
import { PlateMatcherRecognizer } from '@/lib/vision/plate-matcher'
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
  // Raised to the numbers measured after the §9-G rework (per-sprite
  // deterministic scales, prefilter removed, recenter-free grid scorer),
  // then re-pinned after the round-3 label corrections (user-confirmed
  // relabels of 10 cells in 3.png/5.png changed the yardstick itself).
  // Raised after roadmap 4 (rendered-sprite harvest / depleted extras).
  // 6.png auto 29/30 -> 28/29: roadmap 4 fix: contaminated-template flip removed
  // (eternal_winter depleted no longer matches via baked-in red '-1/2' glyph
  // on the auto-detected grid; hand grid still holds 28/29).
  // roadmap 5: auto per-fixture floors held (140/201); fallback rose 176 -> 184.
  // roadmap 6: exact re-rank on auto rects. 4.png 14/32 -> 15/33 (frozen_bow;
  // defender still a transfer-margin miss on the auto crop). 6.png 28/29 -> 29/30.
  '1.jpeg': { top1: 8, overall: 8 },
  '2.png': { top1: 19, overall: 35 },
  '3.png': { top1: 17, overall: 33 },
  '4.png': { top1: 15, overall: 33 },
  '5.png': { top1: 25, overall: 29 },
  '6.png': { top1: 29, overall: 30 },
  '7.png': { top1: 29, overall: 35 },
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

function sameRect(
  a: { originX: number; originY: number; gridWidth: number; gridHeight: number } | null | undefined,
  b: { originX: number; originY: number; gridWidth: number; gridHeight: number } | null | undefined
): boolean {
  return (
    !!a &&
    !!b &&
    a.originX === b.originX &&
    a.originY === b.originY &&
    a.gridWidth === b.gridWidth &&
    a.gridHeight === b.gridHeight
  )
}

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
    // Same instance as the predictor: sprite cache + scoreGrid memo are shared,
    // and the scorer lambda is exactly makeMatchScorer's body (rect.rows wins).
    scorer = (img, rect) =>
      recognizer.scoreGrid(img, {
        rows: rect.rows,
        cols: rect.cols,
        totalSlots: rect.rows * rect.cols,
        grid: rect,
      })
  })

  for (const name of FIXTURES) {
    it(`calibrates ${name}`, async () => {
      const fixture = loadFixture(name)
      const img = await loadImage(resolveFixtureImage(fixture))

      const base = {
        rows: fixture.rows,
        cols: fixture.cols,
        totalSlots: fixture.totalSlots,
        lossless: name.endsWith('.png'),
      }

      const handLabelled = score(
        await recognizer.recognize(img, { ...base, grid: fixture.grid }),
        fixture
      )

      const detected = calibrateGrid(img, { cols: fixture.cols, rows: fixture.rows, scorer })
      expect(detected).not.toBeNull()
      const auto = sameRect(detected, fixture.grid)
        ? handLabelled
        : score(await recognizer.recognize(img, { ...base, grid: detected! }), fixture)
      const min = AUTO_PER_FIXTURE[name]
      expect(auto.counts.top1Correct, `${name} auto top1`).toBeGreaterThanOrEqual(min.top1)
      expect(auto.counts.overallCorrect, `${name} auto overall`).toBeGreaterThanOrEqual(min.overall)

      // Same call without a scorer: exercises the brightness-profile fallback and
      // isolates how much the match score is actually worth.
      const fallbackGrid = calibrateGrid(img, { cols: fixture.cols, rows: fixture.rows })
      expect(fallbackGrid).not.toBeNull()
      const fallback = sameRect(fallbackGrid, detected)
        ? auto
        : sameRect(fallbackGrid, fixture.grid)
          ? handLabelled
          : score(await recognizer.recognize(img, { ...base, grid: fallbackGrid! }), fixture)

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
    // Measured after the §9-G rework + round-3 label corrections, then
    // raised after roadmap 4: auto 141/202, fallback 177.
    // Re-pinned after glyph-clean: auto 140/201, fallback 176.
    // roadmap 4 fix: contaminated-template flip removed (6.png#12
    // eternal_winter depleted on auto/fallback grids).
    // roadmap 5: auto held 140/201; fallback 176 -> 184.
    // roadmap 6: auto 140/201 -> 142/203 (4.png frozen_bow + 6.png);
    // fallback 184 -> 195.
    const auto = aggregateCounts(rows.map((r) => r.auto.counts))
    expect(auto.counts.overallCorrect).toBeGreaterThanOrEqual(203)
    expect(auto.counts.top1Correct).toBeGreaterThanOrEqual(142)

    const fallback = aggregateCounts(rows.map((r) => r.fallback.counts))
    expect(fallback.counts.overallCorrect).toBeGreaterThanOrEqual(195)
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
