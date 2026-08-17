'use client'

import { useState, useRef, useCallback } from 'react'
import { useInventoryStore } from '@/store/inventoryStore'
import type {
  BoardConfig,
  GridRow,
  GridSlot,
  OptimizeLastResult,
  OptimizeProgress,
  OptimizeRequest,
  OptimizeResult,
  WorkerMessage,
} from '@/types'
import { DEFAULT_SA_CONFIG } from '@/types'
import { evaluateBoardDetail } from '@/lib/optimizerScore'
import { comboCounts, totalComboTiers } from '@/lib/comboEngine'
import { comboTiersMet } from '@/data/comboEffects'

export interface OptimizerProgress {
  iteration: number
  levelSum: number
  goalsMet: number
  /** 도달한 콤보 단계 수 총합 — 워커의 bestComboTiers (totalComboTiers 참고). */
  comboTiers: number
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

/** Human-readable board metrics. The banded objective itself is not one. */
function summarize(slots: GridSlot[], gridRows: GridRow[], board: BoardConfig) {
  // before/after 가 일관되도록 최적화 요청과 같은 board(칸 레벨)를 넘긴다.
  const detail = evaluateBoardDetail(slots, gridRows, undefined, board)
  let levelSum = 0
  let goalsMet = 0
  let goalsTotal = 0
  let constraintsMet = 0
  let constraintsTotal = 0

  for (const a of detail.artifacts) {
    levelSum += Math.max(0, a.finalLevel)
    if (a.target !== null) {
      goalsTotal += 1
      if (a.goalMet) goalsMet += 1
    }
    if (a.constraintKind) {
      constraintsTotal += 1
      if (a.constraintStatus !== 'unmet') constraintsMet += 1
    }
  }

  const counts = comboCounts(slots, gridRows)
  const comboTiers = totalComboTiers(counts)
  const targetComboTiers = board.targetCombo
    ? comboTiersMet(board.targetCombo, counts.get(board.targetCombo)?.total ?? 0)
    : null

  return {
    levelSum,
    goalsMet,
    goalsTotal,
    constraintsMet,
    constraintsTotal,
    comboTiers,
    targetComboTiers,
  }
}

export function useOptimizer(): UseOptimizerReturn {
  const workerRef = useRef<Worker | null>(null)
  const [progress, setProgress] = useState<OptimizerProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const {
    slots,
    gridRows,
    cellLevels,
    targetCombo,
    setOptimizing,
    setGridFromWorker,
    setLastOptimize,
    isOptimizing,
  } = useInventoryStore()

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
    const board: BoardConfig = { cellLevels, targetCombo }
    const before = summarize(slots, gridRows, board)
    setOptimizing(true)
    setProgress({
      iteration: 0,
      levelSum: before.levelSum,
      goalsMet: before.goalsMet,
      comboTiers: before.comboTiers,
      temp: DEFAULT_SA_CONFIG.initialTemp,
      progressPct: 0,
    })

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
          levelSum: p.bestLevelSum,
          goalsMet: p.bestGoalsMet,
          comboTiers: p.bestComboTiers,
          temp: p.temp,
          progressPct: timePct,
        })
      } else if (msg.type === 'result') {
        const r = msg as OptimizeResult
        const after = summarize(r.slots, gridRows, board)
        setGridFromWorker(r.slots)
        const last: OptimizeLastResult = {
          beforeLevelSum: before.levelSum,
          afterLevelSum: after.levelSum,
          goalsMet: after.goalsMet,
          goalsTotal: after.goalsTotal,
          constraintsMet: after.constraintsMet,
          constraintsTotal: after.constraintsTotal,
          comboTiers: after.comboTiers,
          targetComboTiers: after.targetComboTiers,
          iterations: r.iterations,
        }
        setLastOptimize(last)
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
      board,
    }
    worker.postMessage(request)
  }, [isOptimizing, slots, gridRows, cellLevels, targetCombo, setOptimizing, setGridFromWorker, setLastOptimize])

  return { isOptimizing, progress, error, optimize, cancel }
}
