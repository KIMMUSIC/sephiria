import { ARTIFACTS } from '@/data/artifacts'
import { TABLETS } from '@/data/tablets'
import type { ItemType, RecognitionResult } from '@/types'

const HIST_BINS = 8 // per channel → 8*8*8 = 512 bins
const MATCH_THRESHOLD = 0.60
const UNCERTAIN_THRESHOLD = 0.40
const RESIZE = 40

interface ReferenceTemplate {
  value: string
  type: ItemType
  label: string
  histogram: Float32Array // 512 bins
}

let templates: ReferenceTemplate[] | null = null
let loadingPromise: Promise<ReferenceTemplate[]> | null = null

export async function loadTemplates(): Promise<ReferenceTemplate[]> {
  if (templates) return templates
  if (loadingPromise) return loadingPromise
  loadingPromise = doLoadTemplates()
  templates = await loadingPromise
  loadingPromise = null
  return templates
}

async function doLoadTemplates(): Promise<ReferenceTemplate[]> {
  const canvas = document.createElement('canvas')
  canvas.width = RESIZE
  canvas.height = RESIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const allItems = [
    ...ARTIFACTS.map((a) => ({ src: a.image, value: a.value, type: 'ARTIFACT' as ItemType, label: a.label_kor })),
    ...TABLETS.map((t) => ({ src: t.image, value: t.value, type: 'TABLET' as ItemType, label: t.ko_label })),
  ]

  const result: ReferenceTemplate[] = []

  for (let i = 0; i < allItems.length; i += 30) {
    const batch = allItems.slice(i, i + 30)
    const loaded = await Promise.all(
      batch.map(async (item) => {
        const imgData = await loadImageData(item.src, ctx, canvas)
        if (!imgData) return null
        const histogram = computeHistogram(imgData, true)
        if (!histogram) return null
        return { ...item, histogram }
      })
    )
    for (const t of loaded) {
      if (t) result.push(t)
    }
  }

  return result
}

function loadImageData(
  src: string,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement
): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      ctx.clearRect(0, 0, RESIZE, RESIZE)
      ctx.drawImage(img, 0, 0, RESIZE, RESIZE)
      resolve(ctx.getImageData(0, 0, RESIZE, RESIZE))
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/**
 * Compute a 3D color histogram (HIST_BINS^3 bins).
 * If hasAlpha=true, ignore transparent pixels.
 * Returns normalized histogram (sums to 1).
 */
function computeHistogram(data: ImageData, hasAlpha: boolean): Float32Array | null {
  const totalBins = HIST_BINS * HIST_BINS * HIST_BINS
  const hist = new Float32Array(totalBins)
  const d = data.data
  const len = d.length / 4
  let count = 0

  for (let i = 0; i < len; i++) {
    const a = d[i * 4 + 3]
    if (hasAlpha && a < 128) continue

    const r = d[i * 4]
    const g = d[i * 4 + 1]
    const b = d[i * 4 + 2]

    const ri = Math.min(HIST_BINS - 1, (r * HIST_BINS) >> 8)
    const gi = Math.min(HIST_BINS - 1, (g * HIST_BINS) >> 8)
    const bi = Math.min(HIST_BINS - 1, (b * HIST_BINS) >> 8)

    hist[ri * HIST_BINS * HIST_BINS + gi * HIST_BINS + bi]++
    count++
  }

  if (count < 20) return null

  // Normalize
  for (let i = 0; i < totalBins; i++) hist[i] /= count
  return hist
}

/**
 * Histogram intersection similarity (Swain & Ballard).
 * Returns 0.0 - 1.0 where 1.0 is identical distribution.
 */
function histogramIntersection(a: Float32Array, b: Float32Array): number {
  let intersection = 0
  for (let i = 0; i < a.length; i++) {
    intersection += Math.min(a[i], b[i])
  }
  return intersection // Already normalized, so max is 1.0
}

/**
 * Convert a cell's ImageData to a color histogram for matching.
 */
export function cellToHistogram(imageData: ImageData): Float32Array | null {
  let data = imageData
  if (imageData.width !== RESIZE || imageData.height !== RESIZE) {
    const canvas = document.createElement('canvas')
    canvas.width = RESIZE
    canvas.height = RESIZE
    const ctx = canvas.getContext('2d')!
    const srcCanvas = document.createElement('canvas')
    srcCanvas.width = imageData.width
    srcCanvas.height = imageData.height
    srcCanvas.getContext('2d')!.putImageData(imageData, 0, 0)
    ctx.drawImage(srcCanvas, 0, 0, RESIZE, RESIZE)
    data = ctx.getImageData(0, 0, RESIZE, RESIZE)
  }
  return computeHistogram(data, false)
}

export interface MatchResult {
  value: string
  type: ItemType
  label: string
  confidence: number
}

export function matchCell(cellHist: Float32Array, topN = 5): MatchResult[] {
  if (!templates || templates.length === 0) return []

  const scores: MatchResult[] = []
  for (const tmpl of templates) {
    const sim = histogramIntersection(cellHist, tmpl.histogram)
    scores.push({
      value: tmpl.value,
      type: tmpl.type,
      label: tmpl.label,
      confidence: sim,
    })
  }

  scores.sort((a, b) => b.confidence - a.confidence)
  return scores.slice(0, topN)
}

/**
 * Run recognition on all cropped cells.
 */
export async function recognizeAll(
  cellImages: { slotIndex: number; imageData: ImageData }[],
  onProgress?: (completed: number, total: number) => void
): Promise<RecognitionResult[]> {
  const tpls = await loadTemplates()
  if (tpls.length === 0) return []

  const results: RecognitionResult[] = []

  for (let i = 0; i < cellImages.length; i++) {
    const { slotIndex, imageData } = cellImages[i]
    const hist = cellToHistogram(imageData)

    if (!hist) {
      results.push({ slotIndex, matchedValue: null, type: null, level: 0, confidence: 0 })
      continue
    }

    const matches = matchCell(hist)
    const best = matches[0]

    if (best && best.confidence >= UNCERTAIN_THRESHOLD) {
      results.push({
        slotIndex,
        matchedValue: best.confidence >= MATCH_THRESHOLD ? best.value : null,
        type: best.type,
        level: 0,
        confidence: best.confidence,
      })
    } else {
      results.push({
        slotIndex,
        matchedValue: null,
        type: null,
        level: 0,
        confidence: best?.confidence ?? 0,
      })
    }

    if (i % 3 === 0) {
      onProgress?.(i + 1, cellImages.length)
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  onProgress?.(cellImages.length, cellImages.length)
  return results
}

export { MATCH_THRESHOLD, UNCERTAIN_THRESHOLD }
