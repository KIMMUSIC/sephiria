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
  const resetToken = useInventoryStore((s) => s.resetToken)
  const seenResetToken = useRef(resetToken)
  const { state, result, init, recognize, resetState } = useRecognitionWorker()

  useEffect(() => {
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyResult = useCallback(() => {
    if (!result) return
    // The bag's last row is usually short, so rows*cols overstates the inventory
    // (a 32-slot bag calibrates as a 6x6 rect). Use the measured slot count.
    const { predictions, slotCount } = result
    if (slotCount !== useInventoryStore.getState().slotNum) {
      setSlotNum(slotCount)
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

  // 전체 초기화 clears the board from the store; this panel also holds a phase and a
  // file input of its own. Remounting would work but would re-download all 335
  // templates, so it listens for the reset instead.
  useEffect(() => {
    if (seenResetToken.current === resetToken) return
    seenResetToken.current = resetToken
    handleReset()
  }, [resetToken, handleReset])

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
      <section className="overflow-hidden rounded-shell border border-sephiria-border bg-sephiria-panel">
        <div className="border-b border-sephiria-border px-4 py-2.5 text-sm font-semibold text-sephiria-fg">
          인벤토리 인식 중
        </div>
        <div className="flex flex-col items-center gap-3 p-4">
          <p className="text-xs text-sephiria-muted">
            {state.stage || '처리 중'}
          </p>
          <Progress value={state.percent} />
          <Button variant="ghost" size="sm" onClick={handleReset}>
            취소
          </Button>
        </div>
      </section>
    )
  }

  if (phase === 'complete') {
    return (
      <section className="overflow-hidden rounded-shell border border-sephiria-border bg-sephiria-panel">
        <div className="flex items-center justify-between border-b border-sephiria-border px-4 py-2.5 text-sm font-semibold text-sephiria-fg">
          <span>인식 완료</span>
          <button type="button" onClick={handleReset} className="text-xs text-sephiria-muted hover:text-sephiria-fg">
            닫기
          </button>
        </div>
        <div className="flex flex-col gap-2 p-3">
          <div className="flex justify-center gap-3 text-xs">
            <span className="text-sephiria-buff-fg">매칭 {matched}</span>
            <span className="text-sephiria-muted">전체 {result?.predictions.length ?? 0}</span>
            {lowCount > 0 && (
              <span className="text-sephiria-confirm-fg">확인 필요 {lowCount}</span>
            )}
          </div>
          {lowCount > 0 && (
            <p className="text-center text-[10px] text-sephiria-confirm-fg">
              노란 확인 칸을 클릭한 뒤 ‘다른 아이템으로 교체’에서 후보를 고르세요
            </p>
          )}
          <Button variant="outline" size="sm" className="w-full" onClick={handleReset}>
            다시 인식
          </Button>
        </div>
      </section>
    )
  }

  if (phase === 'error') {
    return (
      <section className="overflow-hidden rounded-shell border border-sephiria-border bg-sephiria-panel">
        <div className="border-b border-sephiria-border px-4 py-2.5 text-sm font-semibold text-sephiria-fg">
          인식 실패
        </div>
        <div className="flex flex-col gap-2 p-3">
          <p className="text-xs text-sephiria-debuff-fg">{error}</p>
          <Button variant="outline" size="sm" onClick={handleReset}>
            다시 시도
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-shell border border-sephiria-border bg-sephiria-panel">
      <div className="flex items-center justify-between border-b border-sephiria-border px-4 py-2.5 text-sm font-semibold text-sephiria-fg">
        <span>스크린샷 인식</span>
        <div className="flex items-center gap-2">
          {isLoading && (
            <span className="text-[10px] text-sephiria-confirm-fg">{state.stage}</span>
          )}
          {isReady && <span className="text-[10px] text-sephiria-buff-fg">준비 완료</span>}
          {state.status === 'error' && (
            <button type="button" onClick={init} className="text-[10px] text-sephiria-debuff-fg hover:text-sephiria-destroy-fg">
              재시도
            </button>
          )}
        </div>
      </div>
      <div className="p-3">
        <div
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 rounded-inner border border-dashed border-sephiria-border py-8',
            'transition-colors duration-200 ease-seph',
            isReady
              ? 'cursor-pointer hover:border-sephiria-accent hover:bg-sephiria-accent-soft/40'
              : 'cursor-wait opacity-60'
          )}
          onClick={() => isReady && fileInputRef.current?.click()}
          onDrop={isReady ? handleDrop : undefined}
          onDragOver={(e) => e.preventDefault()}
        >
          <p className="text-xs font-medium text-sephiria-fg">
            {isReady
              ? 'Ctrl+V 붙여넣기 또는 클릭하여 업로드'
              : state.status === 'error'
                ? '템플릿 로드 실패. 재시도하세요'
                : '템플릿 준비 중'}
          </p>
          {state.status === 'error' && state.error && (
            <p className="text-[10px] text-sephiria-debuff-fg">{state.error}</p>
          )}
          <p className="text-[10px] text-sephiria-muted">PNG는 무손실 매칭을 사용합니다</p>
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
    </section>
  )
}
