'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useRecognitionWorker } from '@/hooks/useRecognitionWorker'
import { useInventoryStore, type RecognitionIngest } from '@/store/inventoryStore'
import { decodeBrowserBlob } from '@/lib/vision/browser-decode'
import { isLowConfidence } from '@/lib/vision/confidence'

type Phase = 'idle' | 'running' | 'complete' | 'error'

export function ScreenshotUploader() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadFromRecognition = useInventoryStore((s) => s.loadFromRecognition)
  const setSlotNum = useInventoryStore((s) => s.setSlotNum)
  const { state, result, init, recognize, resetState } = useRecognitionWorker()

  useEffect(() => {
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyResult = useCallback(() => {
    if (!result) return
    const { predictions, rows, cols } = result
    const required = rows * cols
    if (required !== useInventoryStore.getState().slotNum) {
      setSlotNum(required)
    }
    const ingest: RecognitionIngest[] = predictions.map((p) => ({
      slotIndex: p.slotIndex,
      matchedValue: p.matchedValue,
      type: p.type,
      level: 0,
      confidence: p.confidence,
      rotation: p.rotation,
      candidates: p.candidates,
    }))
    loadFromRecognition(ingest)
    setPhase('complete')
  }, [result, loadFromRecognition, setSlotNum])

  useEffect(() => {
    if (phase !== 'running') return
    if (state.status === 'done' && result) applyResult()
    else if (state.status === 'error') {
      setError(state.error ?? '인식에 실패했습니다.')
      setPhase('error')
    }
  }, [phase, state.status, state.error, result, applyResult])

  const processFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return
      if (state.status !== 'ready' && state.status !== 'done') return
      setError(null)
      setPhase('running')
      try {
        const img = await decodeBrowserBlob(file)
        recognize(img, file.type === 'image/png')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPhase('error')
      }
    },
    [recognize, state.status]
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (phase !== 'idle') return
      if (state.status !== 'ready' && state.status !== 'done') return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const blob = item.getAsFile()
          if (blob) void processFile(blob)
          break
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [phase, state.status, processFile])

  const handleReset = useCallback(() => {
    setPhase('idle')
    setError(null)
    resetState()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [resetState])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void processFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) void processFile(file)
  }

  const isReady = state.status === 'ready' || state.status === 'done'
  const isLoading = state.status === 'loading'
  const lowCount = result
    ? result.predictions.filter((p) => isLowConfidence(p)).length
    : 0
  const matched = result
    ? result.predictions.filter((p) => p.matchedValue).length
    : 0

  if (phase === 'running') {
    return (
      <div className="rounded-lg border border-sephiria-border bg-sephiria-panel overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold text-gray-200 border-b border-sephiria-border">
          인벤토리 인식 중...
        </div>
        <div className="p-4 flex flex-col gap-3 items-center">
          <p className="text-xs text-gray-300 animate-pulse">
            {state.stage || '처리 중...'}
          </p>
          <Progress value={state.percent} />
          <Button variant="ghost" size="sm" onClick={handleReset}>
            취소
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'complete') {
    return (
      <div className="rounded-lg border border-sephiria-border bg-sephiria-panel overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold text-gray-200 border-b border-sephiria-border flex items-center justify-between">
          <span>인식 완료</span>
          <button onClick={handleReset} className="text-xs text-gray-400 hover:text-white">
            닫기
          </button>
        </div>
        <div className="p-3 flex flex-col gap-2">
          <div className="flex gap-3 justify-center text-xs">
            <span className="text-green-400">매칭: {matched}</span>
            <span className="text-gray-400">전체: {result?.predictions.length ?? 0}</span>
            {lowCount > 0 && (
              <span className="text-yellow-400">확인 필요: {lowCount}</span>
            )}
          </div>
          {lowCount > 0 && (
            <p className="text-[10px] text-yellow-400/80 text-center">
              노란 &quot;확인&quot; 칸을 클릭해 후보를 고르세요
            </p>
          )}
          <Button variant="outline" size="sm" className="w-full" onClick={handleReset}>
            다시 인식
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="rounded-lg border border-sephiria-border bg-sephiria-panel overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold text-gray-200 border-b border-sephiria-border">
          인식 실패
        </div>
        <div className="p-3 flex flex-col gap-2">
          <p className="text-xs text-red-400">{error}</p>
          <Button variant="outline" size="sm" onClick={handleReset}>
            다시 시도
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-sephiria-border bg-sephiria-panel overflow-hidden">
      <div className="px-4 py-2.5 text-sm font-semibold text-gray-200 border-b border-sephiria-border flex items-center justify-between">
        <span>스크린샷 인식</span>
        <div className="flex items-center gap-2">
          {isLoading && (
            <span className="text-[10px] text-yellow-400 animate-pulse">{state.stage}</span>
          )}
          {isReady && <span className="text-[10px] text-green-400">준비 완료</span>}
          {state.status === 'error' && (
            <button onClick={init} className="text-[10px] text-red-400 hover:text-red-300">
              재시도
            </button>
          )}
        </div>
      </div>
      <div className="p-3">
        <div
          className={cn(
            'w-full rounded-lg border-2 border-dashed border-sephiria-border',
            'flex flex-col items-center justify-center gap-2 py-8',
            'transition-colors',
            isReady
              ? 'cursor-pointer hover:border-sephiria-accent hover:bg-sephiria-panel/40'
              : 'opacity-60 cursor-wait'
          )}
          onClick={() => isReady && fileInputRef.current?.click()}
          onDrop={isReady ? handleDrop : undefined}
          onDragOver={(e) => e.preventDefault()}
        >
          <p className="text-xs font-medium text-gray-300">
            {isReady
              ? 'Ctrl+V 붙여넣기 또는 클릭하여 업로드'
              : state.status === 'error'
                ? '템플릿 로드 실패 — 재시도하세요'
                : '템플릿 준비 중...'}
          </p>
          {state.status === 'error' && state.error && (
            <p className="text-[10px] text-red-400/80">{state.error}</p>
          )}
          <p className="text-[10px] text-gray-500">PNG는 무손실 매칭을 사용합니다</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFileChange}
            disabled={!isReady}
          />
        </div>
      </div>
    </div>
  )
}
