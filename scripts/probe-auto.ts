/**
 * Auto-grid vs hand-grid dump for roadmap 5.
 */
import { calibrateGrid, type GridScorer } from '../lib/vision/grid-calibrate'
import { PlateMatcherRecognizer } from '../lib/vision/plate-matcher'
import {
  loadAllTemplates,
  loadFixture,
  loadImage,
  resolveFixtureImage,
  score,
} from '../tests/vision/harness'

const FIXTURES = ['1.jpeg', '2.png', '3.png', '4.png', '5.png', '6.png', '7.png']

async function main() {
  const templates = await loadAllTemplates()
  const rec = new PlateMatcherRecognizer()
  rec.loadTemplates(templates)
  const scorer: GridScorer = (img, rect) =>
    rec.scoreGrid(img, {
      rows: rect.rows,
      cols: rect.cols,
      totalSlots: rect.rows * rect.cols,
      grid: rect,
    })

  let autoTop1 = 0
  let autoOverall = 0
  let fbOverall = 0
  let autoRowsOk = 0
  let fbRowsOk = 0

  for (const name of FIXTURES) {
    const fixture = loadFixture(name)
    const img = await loadImage(resolveFixtureImage(fixture))
    const base = { rows: fixture.rows, cols: fixture.cols, totalSlots: fixture.totalSlots }
    const hand = score(await rec.recognize(img, { ...base, grid: fixture.grid }), fixture)
    const detected = calibrateGrid(img, { cols: fixture.cols, rows: fixture.rows, scorer })
    const auto =
      detected &&
      fixture.grid &&
      detected.originX === fixture.grid.originX &&
      detected.originY === fixture.grid.originY &&
      detected.gridWidth === fixture.grid.gridWidth &&
      detected.gridHeight === fixture.grid.gridHeight
        ? hand
        : score(await rec.recognize(img, { ...base, grid: detected! }), fixture)
    const fallbackGrid = calibrateGrid(img, { cols: fixture.cols, rows: fixture.rows })
    const fallback = score(await rec.recognize(img, { ...base, grid: fallbackGrid! }), fixture)
    const autoRows = calibrateGrid(img, { cols: fixture.cols, scorer })
    const fbRows = calibrateGrid(img, { cols: fixture.cols })
    if (autoRows?.rows === fixture.rows) autoRowsOk++
    if (fbRows?.rows === fixture.rows) fbRowsOk++
    autoTop1 += auto.counts.top1Correct
    autoOverall += auto.counts.overallCorrect
    fbOverall += fallback.counts.overallCorrect
    const g = fixture.grid!
    const d = detected!
    console.log(
      `${name} hand=${hand.counts.top1Correct}/${hand.counts.overallCorrect} auto=${auto.counts.top1Correct}/${auto.counts.overallCorrect} fb=${fallback.counts.overallCorrect} rows=${autoRows?.rows}/${fbRows?.rows} ` +
        `dOrigin=(${(d.originX - g.originX).toFixed(2)},${(d.originY - g.originY).toFixed(2)}) dPitch=(${(d.gridWidth - g.gridWidth).toFixed(2)},${(d.gridHeight - g.gridHeight).toFixed(2)})`
    )
    const extra = auto.mismatches.filter(
      (m) => !hand.mismatches.some((h) => h.slotIndex === m.slotIndex && h.predicted === m.predicted)
    )
    const recovered = hand.mismatches.filter(
      (h) => !auto.mismatches.some((m) => m.slotIndex === h.slotIndex)
    )
    for (const m of auto.mismatches) {
      console.log(
        `  AUTO ${name}#${m.slotIndex} ${m.expected ?? '(empty)'} -> ${m.predicted ?? '(empty)'} @ ${m.confidence.toFixed(4)}`
      )
    }
    for (const m of extra) console.log(`  AUTO-ONLY ${name}#${m.slotIndex}`)
    for (const m of recovered) console.log(`  AUTO-RECOVERED ${name}#${m.slotIndex} was ${m.expected}->${m.predicted}`)
  }
  console.log({ autoTop1, autoOverall, fbOverall, autoRowsOk, fbRowsOk })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
