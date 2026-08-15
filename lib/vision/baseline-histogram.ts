import type {
  CellPrediction,
  ItemKind,
  RGBAImage,
  RecognizeOptions,
  Recognizer,
  TemplateSource,
} from './types'

export const HIST_BINS = 8 // per channel -> 8*8*8 = 512 bins
export const RESIZE = 40
export const MATCH_THRESHOLD = 0.6
export const UNCERTAIN_THRESHOLD = 0.4

const TOTAL_BINS = HIST_BINS * HIST_BINS * HIST_BINS
const ICON_MARGIN_RATIO = 0.22
const EMPTY_STDDEV_THRESHOLD = 18
const MIN_HISTOGRAM_PIXELS = 20

interface ReferenceTemplate {
  value: string
  type: ItemKind
  histogram: Float32Array
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Emulates canvas `drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh)` with default
 * smoothing: bilinear sampling in premultiplied-alpha space, which is how a
 * canvas backing store interpolates. Straight-alpha interpolation would darken
 * sprite edges against transparent black and shift the reference histograms.
 */
export function resampleBilinear(
  src: RGBAImage,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): RGBAImage {
  const out = new Uint8ClampedArray(dw * dh * 4)
  const s = src.data
  const maxX = src.width - 1
  const maxY = src.height - 1
  const scaleX = sw / dw
  const scaleY = sh / dh

  for (let dy = 0; dy < dh; dy++) {
    const v = sy + (dy + 0.5) * scaleY - 0.5
    const vy = Math.floor(v)
    const fy = v - vy
    const y0 = clampInt(vy, 0, maxY)
    const y1 = clampInt(vy + 1, 0, maxY)

    for (let dx = 0; dx < dw; dx++) {
      const u = sx + (dx + 0.5) * scaleX - 0.5
      const ux = Math.floor(u)
      const fx = u - ux
      const x0 = clampInt(ux, 0, maxX)
      const x1 = clampInt(ux + 1, 0, maxX)

      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy

      const i00 = (y0 * src.width + x0) * 4
      const i10 = (y0 * src.width + x1) * 4
      const i01 = (y1 * src.width + x0) * 4
      const i11 = (y1 * src.width + x1) * 4

      const a00 = s[i00 + 3]
      const a10 = s[i10 + 3]
      const a01 = s[i01 + 3]
      const a11 = s[i11 + 3]

      const a = w00 * a00 + w10 * a10 + w01 * a01 + w11 * a11
      const pr = w00 * s[i00] * a00 + w10 * s[i10] * a10 + w01 * s[i01] * a01 + w11 * s[i11] * a11
      const pg =
        w00 * s[i00 + 1] * a00 +
        w10 * s[i10 + 1] * a10 +
        w01 * s[i01 + 1] * a01 +
        w11 * s[i11 + 1] * a11
      const pb =
        w00 * s[i00 + 2] * a00 +
        w10 * s[i10 + 2] * a10 +
        w01 * s[i01 + 2] * a01 +
        w11 * s[i11 + 2] * a11

      const o = (dy * dw + dx) * 4
      if (a > 0) {
        out[o] = pr / a
        out[o + 1] = pg / a
        out[o + 2] = pb / a
      }
      out[o + 3] = a
    }
  }

  return { width: dw, height: dh, data: out }
}

/**
 * 3D color histogram (HIST_BINS^3 bins), normalized to sum 1.
 * `hasAlpha` restricts the population to opaque pixels (alpha >= 128).
 */
export function computeHistogram(img: RGBAImage, hasAlpha: boolean): Float32Array | null {
  const hist = new Float32Array(TOTAL_BINS)
  const d = img.data
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

  if (count < MIN_HISTOGRAM_PIXELS) return null

  for (let i = 0; i < TOTAL_BINS; i++) hist[i] /= count
  return hist
}

/** Histogram intersection similarity (Swain & Ballard), 0.0 - 1.0. */
export function histogramIntersection(a: Float32Array, b: Float32Array): number {
  let intersection = 0
  for (let i = 0; i < a.length; i++) {
    intersection += Math.min(a[i], b[i])
  }
  return intersection
}

/** Low color variance = uniform background = empty cell. */
export function isCellEmpty(img: RGBAImage, threshold = EMPTY_STDDEV_THRESHOLD): boolean {
  const d = img.data
  const len = d.length / 4
  let sumR = 0
  let sumG = 0
  let sumB = 0
  for (let i = 0; i < len; i++) {
    sumR += d[i * 4]
    sumG += d[i * 4 + 1]
    sumB += d[i * 4 + 2]
  }
  const mR = sumR / len
  const mG = sumG / len
  const mB = sumB / len
  let v = 0
  for (let i = 0; i < len; i++) {
    v += (d[i * 4] - mR) ** 2 + (d[i * 4 + 1] - mG) ** 2 + (d[i * 4 + 2] - mB) ** 2
  }
  return Math.sqrt(v / len) < threshold
}

export interface CellCrop {
  slotIndex: number
  x: number
  y: number
  width: number
  height: number
}

export interface GridRect {
  originX: number
  originY: number
  gridWidth: number
  gridHeight: number
}

/** Uniform division of the grid rect, matching `computeCellCrops`. */
export function computeCellCrops(
  grid: GridRect,
  rows: number,
  cols: number,
  totalSlots: number
): CellCrop[] {
  const cellW = grid.gridWidth / cols
  const cellH = grid.gridHeight / rows
  const crops: CellCrop[] = []

  for (let i = 0; i < totalSlots; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    crops.push({
      slotIndex: i,
      x: grid.originX + col * cellW,
      y: grid.originY + row * cellH,
      width: cellW,
      height: cellH,
    })
  }
  return crops
}

/**
 * Faithful port of the shipped `lib/templateMatcher.ts` + `lib/gridDetector.ts`
 * pipeline. This is the accuracy baseline: its known defects (asymmetric
 * histogram normalization, shape-blind color histograms, shared candidate pool)
 * are reproduced deliberately and must not be "fixed" here.
 *
 * The input image is treated as the grid area itself — origin (0,0) with the
 * full width/height. Callers that know a tighter grid rect crop before calling.
 */
export class BaselineHistogramRecognizer implements Recognizer {
  readonly name = 'baseline-histogram'

  private templates: ReferenceTemplate[] = []

  loadTemplates(templates: TemplateSource[]): void {
    const loaded: ReferenceTemplate[] = []
    for (const t of templates) {
      const resized =
        t.image.width === RESIZE && t.image.height === RESIZE
          ? t.image
          : resampleBilinear(t.image, 0, 0, t.image.width, t.image.height, RESIZE, RESIZE)
      const histogram = computeHistogram(resized, true)
      if (!histogram) continue
      loaded.push({ value: t.value, type: t.type, histogram })
    }
    this.templates = loaded
  }

  async recognize(img: RGBAImage, opts: RecognizeOptions): Promise<CellPrediction[]> {
    const grid: GridRect = {
      originX: 0,
      originY: 0,
      gridWidth: img.width,
      gridHeight: img.height,
    }
    const crops = computeCellCrops(grid, opts.rows, opts.cols, opts.totalSlots)
    const predictions: CellPrediction[] = []

    for (const crop of crops) {
      const marginX = crop.width * ICON_MARGIN_RATIO
      const marginY = crop.height * ICON_MARGIN_RATIO
      const icon = resampleBilinear(
        img,
        crop.x + marginX,
        crop.y + marginY,
        crop.width - marginX * 2,
        crop.height - marginY * 2,
        RESIZE,
        RESIZE
      )

      if (isCellEmpty(icon)) {
        predictions.push(emptyPrediction(crop.slotIndex, 0))
        continue
      }

      const hist = computeHistogram(icon, false)
      if (!hist) {
        predictions.push(emptyPrediction(crop.slotIndex, 0))
        continue
      }

      const best = this.bestMatch(hist)
      if (best && best.confidence >= UNCERTAIN_THRESHOLD) {
        predictions.push({
          slotIndex: crop.slotIndex,
          matchedValue: best.confidence >= MATCH_THRESHOLD ? best.value : null,
          type: best.type,
          rotation: 0,
          confidence: best.confidence,
        })
      } else {
        predictions.push(emptyPrediction(crop.slotIndex, best?.confidence ?? 0))
      }
    }

    return predictions
  }

  private bestMatch(cellHist: Float32Array): ReferenceTemplate & { confidence: number } | null {
    let best: (ReferenceTemplate & { confidence: number }) | null = null
    for (const tmpl of this.templates) {
      const confidence = histogramIntersection(cellHist, tmpl.histogram)
      if (!best || confidence > best.confidence) {
        best = { ...tmpl, confidence }
      }
    }
    return best
  }
}

function emptyPrediction(slotIndex: number, confidence: number): CellPrediction {
  return { slotIndex, matchedValue: null, type: null, rotation: 0, confidence }
}
