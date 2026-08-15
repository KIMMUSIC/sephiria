'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { ARTIFACTS } from '@/data/artifacts'
import { TABLETS } from '@/data/tablets'
import type {
  TemplateData,
  DetectedCell,
  CellRect,
  ManualGridSpec,
  VisionMatchResult,
  VisionResponse,
  ItemType,
} from '@/types'

// ── Public Interfaces ──

export interface VisionWorkerState {
  status: 'idle' | 'loading' | 'ready' | 'detecting' | 'done' | 'error'
  stage: string
  percent: number
  error: string | null
}

export interface VisionDetectionResult {
  cells: DetectedCell[]
  rects: CellRect[]
  matchResults?: VisionMatchResult[]
}

export interface UseVisionWorkerReturn {
  state: VisionWorkerState
  result: VisionDetectionResult | null
  init: () => void
  detect: (imageData: ImageData, manualGrid?: ManualGridSpec) => void
  resetState: () => void
}

// ── Template Preparation (Main Thread) ──
// Native resolution + alpha. Resizing to 64×64 destroys plate-matcher bbox/mask.

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function prepareTemplates(
  onProgress?: (done: number, total: number) => void,
): Promise<TemplateData[]> {
  const allItems = [
    ...ARTIFACTS.map(a => ({
      src: a.image, value: a.value,
      type: 'ARTIFACT' as ItemType, label: a.label_kor,
      rotatable: false,
    })),
    ...TABLETS.map(t => ({
      src: t.image, value: t.value,
      type: 'TABLET' as ItemType, label: t.ko_label,
      rotatable: !!t.rotate,
    })),
  ]

  const templates: TemplateData[] = []
  const total = allItems.length

  for (let i = 0; i < total; i += 20) {
    const batch = allItems.slice(i, i + 20)
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        const img = await loadImage(item.src)
        const width = img.naturalWidth
        const height = img.naturalHeight
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true })
        if (!ctx) throw new Error('canvas 2d context unavailable')
        ctx.clearRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, width, height)
        const copy = new Uint8ClampedArray(data.data)
        return {
          value: item.value,
          type: item.type,
          label: item.label,
          buffer: copy.buffer,
          width,
          height,
          rotatable: item.rotatable,
        } as TemplateData
      }),
    )

    for (const r of results) {
      if (r.status === 'fulfilled') templates.push(r.value)
    }

    onProgress?.(Math.min(i + 20, total), total)
  }

  return templates
}

// ── Hook ──

export function useVisionWorker(): UseVisionWorkerReturn {
  const workerRef = useRef<Worker | null>(null)
  const stateRef = useRef<VisionWorkerState>({
    status: 'idle', stage: '', percent: 0, error: null,
  })
  const [state, _setState] = useState<VisionWorkerState>(stateRef.current)
  const [result, setResult] = useState<VisionDetectionResult | null>(null)

  const setState = useCallback((next: VisionWorkerState) => {
    stateRef.current = next
    _setState(next)
  }, [])

  useEffect(() => {
    return () => { workerRef.current?.terminate() }
  }, [])

  const resetState = useCallback(() => {
    const hasWorker = !!workerRef.current
    const isReady = stateRef.current.status === 'done'
      || stateRef.current.status === 'error'
      || stateRef.current.status === 'ready'

    if (hasWorker && isReady) {
      setState({ status: 'ready', stage: '', percent: 0, error: null })
    }
    setResult(null)
  }, [setState])

  const init = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }

    setState({ status: 'loading', stage: '템플릿 준비 중...', percent: 0, error: null })
    setResult(null)

    const worker = new Worker(
      new URL('/workers/vision.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker

    const templatesPromise = prepareTemplates((done, total) => {
      setState({
        status: 'loading',
        stage: `템플릿 로딩 ${done}/${total}`,
        percent: Math.round((done / total) * 80),
        error: null,
      })
    })

    let workerReady = false
    let pendingTemplates: TemplateData[] | null = null

    const sendTemplates = (templates: TemplateData[]) => {
      const w = workerRef.current
      if (!w) return
      setState({
        status: 'loading',
        stage: '템플릿 전송 중...',
        percent: 85,
        error: null,
      })
      const transferables = templates.map(t => t.buffer)
      w.postMessage({ type: 'load-templates', templates }, transferables)
    }

    templatesPromise.then(templates => {
      if (workerRef.current !== worker) return
      if (workerReady) sendTemplates(templates)
      else pendingTemplates = templates
    }).catch(err => {
      setState({
        status: 'error', stage: '', percent: 0,
        error: `템플릿 로딩 실패: ${err?.message || err}`,
      })
    })

    worker.onmessage = (e: MessageEvent<VisionResponse>) => {
      const msg = e.data

      switch (msg.type) {
        case 'progress':
          setState({ ...stateRef.current, stage: msg.stage, percent: msg.percent })
          break

        case 'ready':
          workerReady = true
          if (pendingTemplates) {
            sendTemplates(pendingTemplates)
            pendingTemplates = null
          }
          break

        case 'templates-loaded':
          setState({
            status: 'ready',
            stage: `${msg.count}개 템플릿 준비 완료`,
            percent: 100,
            error: null,
          })
          break

        case 'detect-result':
          if (stateRef.current.status === 'detecting') {
            setResult({
              cells: msg.cells,
              rects: msg.rects,
              matchResults: msg.matchResults,
            })
            setState({ status: 'done', stage: '탐지 완료', percent: 100, error: null })
          }
          break

        case 'detect-failed':
          if (stateRef.current.status === 'detecting') {
            setState({ status: 'error', stage: '', percent: 0, error: msg.reason })
          }
          break

        case 'match-result':
          setResult(prev => prev ? { ...prev, matchResults: msg.results } : null)
          setState({ status: 'done', stage: '매칭 완료', percent: 100, error: null })
          break

        case 'error':
          setState({ status: 'error', stage: '', percent: 0, error: msg.message })
          break
      }
    }

    worker.onerror = (err) => {
      setState({ status: 'error', stage: '', percent: 0, error: err.message || 'Worker error' })
    }

    worker.postMessage({ type: 'init' })
  }, [setState])

  const detect = useCallback((imageData: ImageData, manualGrid?: ManualGridSpec) => {
    const w = workerRef.current
    if (!w || stateRef.current.status !== 'ready') return

    setState({ status: 'detecting', stage: '그리드 보정 중...', percent: 0, error: null })
    setResult(null)

    const copy = new Uint8ClampedArray(imageData.data)
    w.postMessage(
      { type: 'detect', buffer: copy.buffer, width: imageData.width, height: imageData.height, manualGrid },
      [copy.buffer],
    )
  }, [setState])

  return { state, result, init, detect, resetState }
}
