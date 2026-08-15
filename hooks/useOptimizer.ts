'use client'

import { useState, useRef, useCallback } from 'react'
import { useInventoryStore } from '@/store/inventoryStore'
import type { OptimizeProgress, OptimizeRequest, OptimizeResult, WorkerMessage } from '@/types'
import { DEFAULT_SA_CONFIG } from '@/types'
import { evaluateBoard } from '@/lib/optimizerScore'

export interface OptimizerProgress {
  iteration: number
  bestScore: number
  temp: number
  progressPct: number
}

export interface UseOptimizerReturn {
  isOptimizing: boolean
  progress: OptimizerProgress | null
  error: string | null
  optimize: () => void
  cancel: () => void
}

export function useOptimizer(): UseOptimizerReturn {
  const workerRef = useRef<Worker | null>(null)
  const [progress, setProgress] = useState<OptimizerProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { slots, gridRows, setOptimizing, setGridFromWorker, setLastOptimize, isOptimizing } = useInventoryStore()

  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    setOptimizing(false)
    setProgress(null)
  }, [setOptimizing])

  const optimize = useCallback(() => {
    if (isOptimizing) return

    setError(null)
    setLastOptimize(null)
    const beforeScore = evaluateBoard(slots, gridRows)
    setOptimizing(true)
    setProgress({ iteration: 0, bestScore: beforeScore, temp: DEFAULT_SA_CONFIG.initialTemp, progressPct: 0 })

    const worker = new Worker(new URL('/workers/optimizer.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data

      if (msg.type === 'progress') {
        const p = msg as OptimizeProgress
        const logInitial = Math.log(DEFAULT_SA_CONFIG.initialTemp)
        const logMin = Math.log(DEFAULT_SA_CONFIG.minTemp)
        const logCurrent = Math.log(Math.max(p.temp, DEFAULT_SA_CONFIG.minTemp))
        const timePct = Math.min(100, Math.round(((logInitial - logCurrent) / (logInitial - logMin)) * 100))
        setProgress({
          iteration: p.iteration,
          bestScore: p.bestScore,
          temp: p.temp,
          progressPct: timePct,
        })
      } else if (msg.type === 'result') {
        const r = msg as OptimizeResult
        setGridFromWorker(r.slots)
        setLastOptimize({
          beforeScore,
          afterScore: r.score,
          iterations: r.iterations,
        })
        setOptimizing(false)
        setProgress(null)
        worker.terminate()
        workerRef.current = null
      }
    }

    worker.onerror = (ev) => {
      const message = ev.message || '최적화 워커 오류'
      setError(message)
      setOptimizing(false)
      setProgress(null)
      worker.terminate()
      workerRef.current = null
    }

    const request: OptimizeRequest = {
      type: 'start',
      slots,
      gridRows,
      config: DEFAULT_SA_CONFIG,
    }
    worker.postMessage(request)
  }, [isOptimizing, slots, gridRows, setOptimizing, setGridFromWorker, setLastOptimize])

  return { isOptimizing, progress, error, optimize, cancel }
}
