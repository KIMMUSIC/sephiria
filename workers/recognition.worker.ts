/**
 * Production recognition worker (PLAN §5 Phase 5).
 *
 * Templates are built IN-WORKER via fetch (lib/vision/browser-loader) so the
 * ~330 RGBA sprites are never transferred from the main thread. Main posts
 * only the screenshot RGBA buffer (transferable) plus `lossless`.
 *
 * Pipeline: calibrateGrid({ cols: 6 }) — no rows hint, match scorer on — then
 * scanInventory, which recognizes the calibrated rect and trims the result to the
 * bag's real size. See lib/vision/inventory-scan.ts for why those two steps are
 * separate. No OpenCV.
 */
import { calibrateGrid, type GridScorer } from '@/lib/vision/grid-calibrate'
import { scanInventory } from '@/lib/vision/inventory-scan'
import { PlateMatcherRecognizer } from '@/lib/vision/plate-matcher'
import { loadBrowserTemplates } from '@/lib/vision/browser-loader'
import type { CellPrediction, RGBAImage, TemplateSource } from '@/lib/vision/types'

export type RecognitionRequest =
  | { type: 'init' }
  | {
      type: 'recognize'
      buffer: ArrayBuffer
      width: number
      height: number
      lossless: boolean
    }

export type RecognitionResponse =
  | { type: 'progress'; stage: string; percent: number }
  | { type: 'ready'; templateCount: number }
  | {
      type: 'result'
      predictions: CellPrediction[]
      rows: number
      cols: number
      /** Real inventory size: full rows plus the measured last-row width. */
      slotCount: number
      /** Cells present in the last row, in [0, cols]. */
      lastRowCols: number
      grid: {
        originX: number
        originY: number
        gridWidth: number
        gridHeight: number
      }
    }
  | { type: 'error'; message: string }

let templates: TemplateSource[] | null = null
let recognizer: PlateMatcherRecognizer | null = null
let busy = false

function post(msg: RecognitionResponse): void {
  self.postMessage(msg)
}

async function ensureTemplates(): Promise<PlateMatcherRecognizer> {
  if (templates && recognizer) return recognizer
  templates = await loadBrowserTemplates((p) => {
    const percent = p.total ? Math.round((p.done / p.total) * 70) : 0
    post({ type: 'progress', stage: `템플릿 로딩 ${p.done}/${p.total}`, percent })
  })
  recognizer = new PlateMatcherRecognizer()
  recognizer.loadTemplates(templates)
  return recognizer
}

self.onmessage = async (e: MessageEvent<RecognitionRequest>) => {
  const msg = e.data
  if (busy) return
  busy = true
  try {
    if (msg.type === 'init') {
      post({ type: 'progress', stage: '템플릿 준비 중...', percent: 0 })
      await ensureTemplates()
      post({ type: 'ready', templateCount: templates!.length })
      return
    }

    if (msg.type === 'recognize') {
      const rec = await ensureTemplates()
      post({ type: 'progress', stage: '격자 탐지 중...', percent: 72 })

      const img: RGBAImage = {
        width: msg.width,
        height: msg.height,
        data: new Uint8ClampedArray(msg.buffer),
      }

      const scorer: GridScorer = (im, rect) =>
        rec.scoreGrid(im, {
          rows: rect.rows,
          cols: rect.cols,
          totalSlots: rect.rows * rect.cols,
          grid: rect,
        })

      const grid = calibrateGrid(img, { cols: 6, scorer })
      if (!grid) {
        post({ type: 'error', message: '인벤토리 격자를 찾지 못했습니다.' })
        return
      }

      post({ type: 'progress', stage: '아이템 인식 중...', percent: 88 })
      const { predictions, slotCount, lastRowCols } = await scanInventory(rec, img, grid, {
        lossless: msg.lossless,
      })

      post({
        type: 'result',
        predictions,
        rows: grid.rows,
        cols: grid.cols,
        slotCount,
        lastRowCols,
        grid: {
          originX: grid.originX,
          originY: grid.originY,
          gridWidth: grid.gridWidth,
          gridHeight: grid.gridHeight,
        },
      })
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  } finally {
    busy = false
  }
}
