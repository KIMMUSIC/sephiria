import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  buildTemplateSources,
  type RenderedOverridesDoc,
  type SpriteNativesDoc,
} from '@/lib/vision/template-catalog'
import type {
  CellPrediction,
  ItemKind,
  RecognizeOptions,
  RGBAImage,
  TemplateSource,
} from '@/lib/vision/types'

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const ARTIFACT_DIR = path.join(PROJECT_ROOT, 'public', 'images', 'artifacts')
const SLAB_DIR = path.join(PROJECT_ROOT, 'public', 'images', 'slabs')
const FIXTURE_DIR = path.join(PROJECT_ROOT, 'tests', 'fixtures')
const TABLETS_JSON = path.join(PROJECT_ROOT, 'data', 'tablets.json')
const SPRITE_NATIVES_JSON = path.join(PROJECT_ROOT, 'data', 'sprite-natives.json')
const RENDERED_OVERRIDES_JSON = path.join(PROJECT_ROOT, 'data', 'rendered-overrides.json')

export interface GridRect {
  originX: number
  originY: number
  gridWidth: number
  gridHeight: number
}

export interface FixtureExpectation {
  slotIndex: number
  matchedValue: string | null
  type: ItemKind | null
  rotation: 0 | 1 | 2 | 3 | 'any'
  _visualNote?: string
}

export interface Fixture {
  imagePath: string
  rows: number
  cols: number
  totalSlots: number
  grid?: GridRect
  expected: FixtureExpectation[]
}

export interface Mismatch {
  slotIndex: number
  expected: string | null
  predicted: string | null
  confidence: number
}

export interface ScoreCounts {
  scored: number
  skipped: number
  emptyCorrect: number
  itemTotal: number
  top1Correct: number
  typeCorrect: number
  overallCorrect: number
}

export interface ScoreResult {
  emptyAccuracy: number
  top1Accuracy: number
  typeAccuracy: number
  overallAccuracy: number
  mismatches: Mismatch[]
  counts: ScoreCounts
}

const imageCache = new Map<string, Promise<RGBAImage>>()
let templatesMemo: Promise<TemplateSource[]> | null = null

export async function loadImage(filePath: string): Promise<RGBAImage> {
  let hit = imageCache.get(filePath)
  if (!hit) {
    hit = sharp(filePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => ({
        width: info.width,
        height: info.height,
        data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      }))
    imageCache.set(filePath, hit)
  }
  return hit
}

export async function loadAllTemplates(): Promise<TemplateSource[]> {
  if (!templatesMemo) templatesMemo = loadAllTemplatesUncached()
  return templatesMemo
}

async function decodeHarness(pathOrUrl: string): Promise<RGBAImage> {
  const abs = path.isAbsolute(pathOrUrl) ? pathOrUrl : path.join(PROJECT_ROOT, pathOrUrl)
  return loadImage(abs)
}

/**
 * Directory listing (not data/artifacts.json) is the wiki sprite source so
 * the 267+60 on-disk files keep their current order. Assembly — native
 * attach, loud missing-entry errors, override kinds, webp↔png fallback —
 * lives in lib/vision/template-catalog.ts.
 */
async function loadAllTemplatesUncached(): Promise<TemplateSource[]> {
  const tabletsJson: { value: string; rotate?: boolean }[] = JSON.parse(
    fs.readFileSync(TABLETS_JSON, 'utf8')
  )
  const rotatableTablets = new Set(tabletsJson.filter((t) => t.rotate === true).map((t) => t.value))
  const natives: SpriteNativesDoc = JSON.parse(fs.readFileSync(SPRITE_NATIVES_JSON, 'utf8'))
  const overrides: RenderedOverridesDoc = fs.existsSync(RENDERED_OVERRIDES_JSON)
    ? JSON.parse(fs.readFileSync(RENDERED_OVERRIDES_JSON, 'utf8'))
    : { overrides: [] }

  const artifacts = fs.readdirSync(ARTIFACT_DIR).map((file) => ({
    value: path.basename(file, path.extname(file)),
    image: path.join(ARTIFACT_DIR, file),
  }))
  const tablets = fs.readdirSync(SLAB_DIR).map((file) => {
    const value = path.basename(file, path.extname(file))
    return {
      value,
      image: path.join(SLAB_DIR, file),
      rotate: rotatableTablets.has(value),
    }
  })

  return buildTemplateSources({
    artifacts,
    tablets,
    natives,
    overrides,
    decode: decodeHarness,
  })
}

export function loadFixture(name: string): Fixture {
  const file = path.join(FIXTURE_DIR, `${name}.expected.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Fixture
}

export function resolveFixtureImage(fixture: Fixture): string {
  return path.join(PROJECT_ROOT, ...fixture.imagePath.split(/[\\/]/))
}

/** Integer sub-rectangle extraction. No resampling. */
export function cropRGBA(img: RGBAImage, rect: GridRect): RGBAImage {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.round(rect.originX)))
  const y0 = Math.max(0, Math.min(img.height - 1, Math.round(rect.originY)))
  const w = Math.max(1, Math.min(img.width - x0, Math.round(rect.gridWidth)))
  const h = Math.max(1, Math.min(img.height - y0, Math.round(rect.gridHeight)))

  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.width + x0) * 4
    out.set(img.data.subarray(src, src + w * 4), y * w * 4)
  }
  return { width: w, height: h, data: out }
}

/**
 * Loads the fixture image already reduced to its grid area, so the recognizer
 * can treat the whole input as the grid. Falls back to the full image when the
 * fixture carries no `grid` field.
 */
export async function loadFixtureGridImage(fixture: Fixture): Promise<RGBAImage> {
  const img = await loadImage(resolveFixtureImage(fixture))
  return fixture.grid ? cropRGBA(img, fixture.grid) : img
}

export interface RecognizeInput {
  img: RGBAImage
  opts: RecognizeOptions
}

/**
 * Grid-aware recognizers get the untouched source image plus the fixture's
 * fractional grid rect, because `cropRGBA` has to round the rect to integers
 * and that shifts cell spans by up to a pixel.
 *
 * `gridAware: false` keeps the pre-cropped path for the baseline recognizer,
 * whose published numbers are a fixed reference point and must not move.
 */
export async function loadRecognizeInput(
  fixture: Fixture,
  gridAware: boolean
): Promise<RecognizeInput> {
  // Production recognizes the whole calibrated rect and trims afterwards
  // (lib/vision/inventory-scan.ts), so the harness feeds rows*cols here.
  // `fixture.totalSlots` is the inventory's real size and is what the caller
  // trims the predictions to before scoring.
  const opts: RecognizeOptions = {
    rows: fixture.rows,
    cols: fixture.cols,
    totalSlots: fixture.rows * fixture.cols,
  }
  if (gridAware && fixture.grid) {
    return {
      img: await loadImage(resolveFixtureImage(fixture)),
      opts: { ...opts, grid: fixture.grid },
    }
  }
  return { img: await loadFixtureGridImage(fixture), opts }
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

export function score(predictions: CellPrediction[], fixture: Fixture): ScoreResult {
  const byIndex = new Map(predictions.map((p) => [p.slotIndex, p]))

  const counts: ScoreCounts = {
    scored: 0,
    skipped: 0,
    emptyCorrect: 0,
    itemTotal: 0,
    top1Correct: 0,
    typeCorrect: 0,
    overallCorrect: 0,
  }
  const mismatches: Mismatch[] = []

  for (const exp of fixture.expected) {
    if (exp.matchedValue === '???') {
      counts.skipped++
      continue
    }
    counts.scored++

    const pred = byIndex.get(exp.slotIndex)
    const predValue = pred?.matchedValue ?? null
    const predType = pred?.type ?? null
    const confidence = pred?.confidence ?? 0

    if ((exp.matchedValue === null) === (predValue === null)) counts.emptyCorrect++

    let overallCorrect: boolean
    if (exp.matchedValue === null) {
      overallCorrect = predValue === null
    } else {
      counts.itemTotal++
      if (predValue === exp.matchedValue) counts.top1Correct++
      if (predType === exp.type) counts.typeCorrect++
      overallCorrect = predValue === exp.matchedValue
    }

    if (overallCorrect) {
      counts.overallCorrect++
    } else {
      mismatches.push({
        slotIndex: exp.slotIndex,
        expected: exp.matchedValue,
        predicted: predValue,
        confidence,
      })
    }
  }

  return {
    emptyAccuracy: ratio(counts.emptyCorrect, counts.scored),
    top1Accuracy: ratio(counts.top1Correct, counts.itemTotal),
    typeAccuracy: ratio(counts.typeCorrect, counts.itemTotal),
    overallAccuracy: ratio(counts.overallCorrect, counts.scored),
    mismatches,
    counts,
  }
}

export function aggregateCounts(all: ScoreCounts[]): ScoreResult {
  const counts = all.reduce<ScoreCounts>(
    (acc, c) => ({
      scored: acc.scored + c.scored,
      skipped: acc.skipped + c.skipped,
      emptyCorrect: acc.emptyCorrect + c.emptyCorrect,
      itemTotal: acc.itemTotal + c.itemTotal,
      top1Correct: acc.top1Correct + c.top1Correct,
      typeCorrect: acc.typeCorrect + c.typeCorrect,
      overallCorrect: acc.overallCorrect + c.overallCorrect,
    }),
    {
      scored: 0,
      skipped: 0,
      emptyCorrect: 0,
      itemTotal: 0,
      top1Correct: 0,
      typeCorrect: 0,
      overallCorrect: 0,
    }
  )

  return {
    emptyAccuracy: ratio(counts.emptyCorrect, counts.scored),
    top1Accuracy: ratio(counts.top1Correct, counts.itemTotal),
    typeAccuracy: ratio(counts.typeCorrect, counts.itemTotal),
    overallAccuracy: ratio(counts.overallCorrect, counts.scored),
    mismatches: [],
    counts,
  }
}
