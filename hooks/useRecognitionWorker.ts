'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CellPrediction, RGBAImage } from '@/lib/vision/types'

type WorkerResponse =
  | { type: 'progress'; stage: string; percent: number }
  | { type: 'ready'; templateCount: number }
  | { type: 'result'; predictions: CellPrediction[]; rows: number; cols: number }
  | { type: 'error'; message: string }

export interface RecognitionWorkerState {
  status: 'idle' | 'loading' | 'ready' | 'running' | 'done' | 'error'
  stage: string
  percent: number
  error: string | null
}

export interface RecognitionRunResult {
  predictions: CellPrediction[]
  rows: number
  cols: number
}

export interface UseRecognitionWorkerReturn {
  state: RecognitionWorkerState
  result: RecognitionRunResult | null
  init: () => void
  recognize: (image: RGBAImage, lossless: boolean) => void
  resetState: () => void
}

const INITIAL: RecognitionWorkerState = {
  status: 'idle',
  stage: '',
  percent: 0,
  error: null,
}

export function useRecognitionWorker(): UseRecognitionWorkerReturn {
  const workerRef = useRef<Worker | null>(null)
  const stateRef = useRef<RecognitionWorkerState>(INITIAL)
  const [state, _setState] = useState<RecognitionWorkerState>(INITIAL)
  const [result, setResult] = useState<RecognitionRunResult | null>(null)

  const setState = useCallback((next: RecognitionWorkerState) => {
    stateRef.current = next
    _setState(next)
  }, [])

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const resetState = useCallback(() => {
    const hasWorker = !!workerRef.current
    const s = stateRef.current.status
    if (hasWorker && (s === 'done' || s === 'error' || s === 'ready')) {
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

    const worker = new Worker(new URL('../workers/recognition.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      switch (msg.type) {
        case 'progress':
          setState({
            ...stateRef.current,
            stage: msg.stage,
            percent: msg.percent,
            error: null,
          })
          break
        case 'ready':
          setState({
            status: 'ready',
            stage: `${msg.templateCount}개 템플릿 준비 완료`,
            percent: 100,
            error: null,
          })
          break
        case 'result':
          if (stateRef.current.status === 'running') {
            setResult({
              predictions: msg.predictions,
              rows: msg.rows,
              cols: msg.cols,
            })
            setState({ status: 'done', stage: '인식 완료', percent: 100, error: null })
          }
          break
        case 'error':
          setState({ status: 'error', stage: '', percent: 0, error: msg.message })
          break
      }
    }

    worker.onerror = (err) => {
      setState({
        status: 'error',
        stage: '',
        percent: 0,
        error: err.message || 'Worker error',
      })
    }

    worker.postMessage({ type: 'init' })
  }, [setState])

  const recognize = useCallback(
    (image: RGBAImage, lossless: boolean) => {
      const w = workerRef.current
      if (!w) return
      if (stateRef.current.status !== 'ready' && stateRef.current.status !== 'done') return

      setState({ status: 'running', stage: '인식 중...', percent: 70, error: null })
      setResult(null)

      const copy = image.data.buffer.slice(
        image.data.byteOffset,
        image.data.byteOffset + image.data.byteLength
      )
      w.postMessage(
        { type: 'recognize', buffer: copy, width: image.width, height: image.height, lossless },
        [copy]
      )
    },
    [setState]
  )

  return { state, result, init, recognize, resetState }
}
