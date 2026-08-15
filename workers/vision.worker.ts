/// <reference lib="webworker" />
/* ================================================================
   vision.worker.ts — plate-matcher + grid-calibrate
   ================================================================
   Production recognition path. Templates stay at native resolution
   with alpha; OpenCV is not used.
   ================================================================ */

import { calibrateGrid, type GridRect, type GridScorer } from '../lib/vision/grid-calibrate'
import { inferLastRowCols, slotCountFromGrid } from '../lib/vision/last-row'
import { makeMatchScorer, PlateMatcherRecognizer } from '../lib/vision/plate-matcher'
import type { RGBAImage, TemplateSource } from '../lib/vision/types'
import type {
  CellRect,
  DetectedCell,
  TemplateData,
  VisionMatchResult,
} from '../types'

const DEFAULT_COLS = 6

let recognizer: PlateMatcherRecognizer | null = null
let scorer: GridScorer | null = null

function toTemplateSources(templates: TemplateData[]): TemplateSource[] {
  const out: TemplateSource[] = []
  for (const t of templates) {
    if (!t.buffer || t.width < 1 || t.height < 1) continue
    const expected = t.width * t.height * 4
    const raw = new Uint8ClampedArray(t.buffer)
    if (raw.byteLength < expected) continue
    out.push({
      value: t.value,
      type: t.type,
      rotatable: !!t.rotatable,
      image: {
        width: t.width,
        height: t.height,
        data: raw.byteLength === expected ? raw : raw.subarray(0, expected),
      },
    })
  }
  return out
}

function loadTemplatesInWorker(templates: TemplateData[]): number {
  const sources = toTemplateSources(templates)
  const next = new PlateMatcherRecognizer()
  next.loadTemplates(sources)
  recognizer = next
  scorer = makeMatchScorer(sources, { rows: DEFAULT_COLS, cols: DEFAULT_COLS })
  return sources.length
}

function cellsFromGrid(grid: GridRect, totalSlots: number): { cells: DetectedCell[]; rects: CellRect[] } {
  const pitchX = grid.gridWidth / grid.cols
  const pitchY = grid.gridHeight / grid.rows
  const cells: DetectedCell[] = []
  const rects: CellRect[] = []
  for (let i = 0; i < totalSlots; i++) {
    const row = Math.floor(i / grid.cols)
    const col = i % grid.cols
    const x = grid.originX + col * pitchX
    const y = grid.originY + row * pitchY
    rects.push({ x, y, width: pitchX, height: pitchY })
    cells.push({
      row,
      col,
      x,
      y,
      width: pitchX,
      height: pitchY,
      cropBuffer: new ArrayBuffer(0),
    })
  }
  return { cells, rects }
}

function predictionsToMatches(
  predictions: { slotIndex: number; matchedValue: string | null; type: 'ARTIFACT' | 'TABLET' | null; rotation: 0 | 1 | 2 | 3; confidence: number; candidates?: VisionMatchResult['candidates'] }[],
  cols: number,
): VisionMatchResult[] {
  return predictions.map((p) => ({
    row: Math.floor(p.slotIndex / cols),
    col: p.slotIndex % cols,
    matchedValue: p.matchedValue,
    type: p.type,
    confidence: p.confidence,
    rotation: p.rotation,
    candidates: p.candidates,
  }))
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  switch (msg.type) {
    case 'init': {
      self.postMessage({ type: 'ready' })
      break
    }

    case 'load-templates': {
      try {
        self.postMessage({ type: 'progress', stage: '템플릿 적재 중...', percent: 0 })
        const count = loadTemplatesInWorker(msg.templates)
        self.postMessage({ type: 'templates-loaded', count })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Template loading failed'
        self.postMessage({ type: 'error', message })
      }
      break
    }

    case 'detect': {
      try {
        if (!recognizer || !scorer) {
          self.postMessage({ type: 'detect-failed', reason: 'templates-not-loaded' })
          return
        }

        const img: RGBAImage = {
          width: msg.width,
          height: msg.height,
          data: new Uint8ClampedArray(msg.buffer),
        }

        let grid: GridRect
        let totalSlots: number
        if (msg.manualGrid) {
          // Fallback uploader: the user dragged the grid area and the store
          // knows the slot count — no calibration, same plate-matcher.
          const m = msg.manualGrid
          grid = {
            originX: m.originX,
            originY: m.originY,
            gridWidth: m.gridWidth,
            gridHeight: m.gridHeight,
            cols: m.cols,
            rows: m.rows,
          }
          totalSlots = Math.min(m.totalSlots, m.rows * m.cols)
        } else {
          self.postMessage({ type: 'progress', stage: '그리드 보정 중...', percent: 15 })
          const detected = calibrateGrid(img, { cols: DEFAULT_COLS, scorer })
          if (!detected) {
            self.postMessage({ type: 'detect-failed', reason: 'no-grid-found' })
            return
          }
          grid = detected
          const lastRowCols = inferLastRowCols(img, grid)
          totalSlots = slotCountFromGrid(grid, lastRowCols)
        }
        self.postMessage({ type: 'progress', stage: '전경 분리 매칭 중...', percent: 55 })
        const predictions = await recognizer.recognize(img, {
          rows: grid.rows,
          cols: grid.cols,
          totalSlots,
          grid,
        })

        const { cells, rects } = cellsFromGrid(grid, totalSlots)
        const matchResults = predictionsToMatches(predictions, grid.cols)

        self.postMessage({ type: 'progress', stage: '완료', percent: 100 })
        self.postMessage({ type: 'detect-result', cells, rects, matchResults })
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'detection-error'
        self.postMessage({ type: 'detect-failed', reason })
      }
      break
    }

    case 'match': {
      self.postMessage({
        type: 'error',
        message: 'match is no longer a separate step; use detect',
      })
      break
    }
  }
}
