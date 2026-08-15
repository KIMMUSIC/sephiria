'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useVisionWorker } from '@/hooks/useVisionWorker'
import { useInventoryStore } from '@/store/inventoryStore'
import { RecognitionReview, isLowConfidence } from './RecognitionReview'
import type { SmartUploadPhase, CellRect, RecognitionResult, VisionMatchResult } from '@/types'

interface SmartUploaderProps {
  onCustomTabletNeeded: (slotIndex: number) => void
}

export function SmartUploader({ onCustomTabletNeeded: _onCustomTabletNeeded }: SmartUploaderProps) {
  const [phase, setPhase] = useState<SmartUploadPhase>('idle')
  const [screenshot, setScreenshot] = useState<HTMLImageElement | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [highlightRects, setHighlightRects] = useState<CellRect[]>([])
  const [reviewResults, setReviewResults] = useState<VisionMatchResult[]>([])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadFromRecognition = useInventoryStore(s => s.loadFromRecognition)
  const setSlotNum = useInventoryStore(s => s.setSlotNum)
  const { state: workerState, result, init, detect, resetState } = useVisionWorker()

  // ── Worker 초기화 (마운트 시 1회) ──
  useEffect(() => {
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 전역 Ctrl+V 붙여넣기 핸들러 ──
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (phase !== 'idle' || workerState.status !== 'ready') return

      const items = e.clipboardData?.items
      if (!items) return

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const blob = item.getAsFile()
          if (blob) processImage(blob)
          break
        }
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [phase, workerState.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 이미지 처리 (붙여넣기 / 업로드 공통) ──
  const processImage = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return

    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      setScreenshot(img)
      setImageUrl(url)
      setPhase('detecting')

      // ImageData 추출 → Worker로 전송
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      detect(imageData)
    }
    img.src = url
  }, [detect])

  // ── Worker 상태 변화 감시 ──
  useEffect(() => {
    if (phase !== 'detecting') return

    if (workerState.status === 'done' && result) {
      // 성공 → 하이라이트 애니메이션
      setHighlightRects(result.rects)
      setPhase('highlighting')
    } else if (workerState.status === 'error') {
      // 실패 → 수동 모드 Fallback
      setPhase('fallback')
    }
  }, [phase, workerState.status, result])

  // ── 성공 시 초록색 하이라이트 애니메이션 (촤르륵) ──
  useEffect(() => {
    if (phase !== 'highlighting' || !canvasRef.current || !screenshot) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')!
    const maxW = canvas.parentElement?.clientWidth ?? 600
    const scale = Math.min(1, maxW / screenshot.naturalWidth)
    canvas.width = screenshot.naturalWidth * scale
    canvas.height = screenshot.naturalHeight * scale

    // 원본 이미지 그리기
    ctx.drawImage(screenshot, 0, 0, canvas.width, canvas.height)

    const rects = highlightRects
    if (rects.length === 0) {
      beginReview()
      return
    }

    let drawn = 0
    const interval = Math.max(15, 1000 / rects.length)

    const timer = setInterval(() => {
      if (drawn >= rects.length) {
        clearInterval(timer)
        // 0.5초 대기 후 결과 적용
        setTimeout(() => beginReview(), 500)
        return
      }

      const r = rects[drawn]
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.85)'
      ctx.lineWidth = 2
      ctx.shadowColor = 'rgba(74, 222, 128, 0.5)'
      ctx.shadowBlur = 6
      ctx.strokeRect(
        r.x * scale,
        r.y * scale,
        r.width * scale,
        r.height * scale,
      )
      ctx.shadowBlur = 0
      drawn++
    }, interval)

    return () => clearInterval(timer)
  }, [phase, highlightRects, screenshot]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 인식 결과 → 인벤토리 스토어에 적용 ──
  const applyResults = useCallback((matches: VisionMatchResult[]) => {
    if (!matches.length) {
      setPhase('complete')
      return
    }

    const COLS = 6
    const maxRow = Math.max(...matches.map(r => r.row), 0)
    const lastRowCols = Math.max(...matches.filter(r => r.row === maxRow).map(r => r.col), -1) + 1
    const requiredSlots = maxRow * COLS + Math.max(1, lastRowCols)
    setSlotNum(requiredSlots)

    const recognitionResults: RecognitionResult[] = matches.map(m => ({
      slotIndex: m.row * COLS + m.col,
      matchedValue: m.matchedValue,
      type: m.type,
      level: 0,
      confidence: m.confidence,
      rotation: m.rotation,
    }))

    const matched = recognitionResults.filter(r => r.matchedValue)
    if (matched.length > 0) {
      loadFromRecognition(matched)
    }

    setPhase('complete')
  }, [loadFromRecognition, setSlotNum])

  const beginReview = useCallback(() => {
    const matches = result?.matchResults ?? []
    setReviewResults(matches)
    if (matches.some(isLowConfidence)) {
      setPhase('reviewing')
      return
    }
    if (matches.length > 0) {
      applyResults(matches)
      return
    }
    setPhase('complete')
  }, [result, applyResults])

  // ── 리셋 ──
  const handleReset = useCallback(() => {
    setPhase('idle')
    setScreenshot(null)
    setHighlightRects([])
    setReviewResults([])
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setImageUrl(null)
    resetState() // Worker 상태를 'ready'로 복귀 (terminate하지 않음)
  }, [imageUrl, resetState])

  // ── 파일 입력 핸들러 ──
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processImage(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) processImage(file)
  }

  // ════════════════════════════════════════════════════
  //  Render
  // ════════════════════════════════════════════════════

  // ── IDLE: 대기 상태 ──
  if (phase === 'idle') {
    const isReady = workerState.status === 'ready'
    const isLoading = workerState.status === 'loading'
    const isError = workerState.status === 'error'
    const canFallback = isLoading || isError

    return (
      <div className="rounded-lg border border-sephiria-border bg-sephiria-panel overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold text-gray-200 border-b border-sephiria-border flex items-center justify-between">
          <span>스크린샷 인식</span>
          <div className="flex items-center gap-2">
            {isLoading && (
              <span className="text-[10px] text-yellow-400 animate-pulse">{workerState.stage}</span>
            )}
            {isReady && (
              <span className="text-[10px] text-green-400">AI 준비 완료</span>
            )}
            {isError && (
              <button onClick={init} className="text-[10px] text-red-400 hover:text-red-300">
                재시도
              </button>
            )}
            {canFallback && (
              <button
                onClick={() => setPhase('fallback')}
                className="text-[10px] text-gray-400 hover:text-gray-200"
              >
                수동 모드
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
                : 'opacity-60 cursor-wait',
            )}
            onClick={() => isReady && fileInputRef.current?.click()}
            onDrop={isReady ? handleDrop : undefined}
            onDragOver={(e) => e.preventDefault()}
          >
            <div className="text-3xl text-gray-500">&#128247;</div>
            <p className="text-xs font-medium text-gray-300">
              {isReady
                ? 'Ctrl+V 붙여넣기 또는 클릭하여 업로드'
                : isError
                  ? '인식 엔진 로드 실패 — 재시도 또는 수동 모드를 사용하세요'
                  : '인식 엔진 준비 중...'}
            </p>
            {isError && workerState.error && (
              <p className="text-[10px] text-red-400/80">{workerState.error}</p>
            )}
            <p className="text-[10px] text-gray-500">
              전경 분리 매칭 (plate-matcher) + 자동 그리드 보정
            </p>
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

  // ── DETECTING: 자동 탐지 진행 중 ──
  if (phase === 'detecting') {
    return (
      <div className="rounded-lg border border-sephiria-border bg-sephiria-panel overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold text-gray-200 border-b border-sephiria-border">
          인벤토리 자동 탐지 중...
        </div>
        <div className="p-4 flex flex-col gap-3 items-center">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-green-400/30 rounded-lg animate-ping" />
            <div className="absolute inset-2 border-2 border-green-400/60 rounded animate-pulse" />
          </div>
          <p className="text-xs text-gray-300 animate-pulse">
            {workerState.stage || '그리드 보정 및 전경 분리 매칭 중...'}
          </p>
          <Progress value={workerState.percent} />
          <Button variant="ghost" size="sm" onClick={handleReset}>
            취소
          </Button>
        </div>
      </div>
    )
  }

  // ── HIGHLIGHTING: 성공 — 초록 테두리 하이라이트 ──
  if (phase === 'highlighting') {
    return (
      <div className="rounded-lg border border-sephiria-border bg-sephiria-panel overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold text-green-400 border-b border-sephiria-border">
          {highlightRects.length}개 셀 탐지 완료
        </div>
        <div className="p-3">
          <div className="rounded-md overflow-hidden border border-green-500/30">
            <canvas ref={canvasRef} className="w-full" />
          </div>
        </div>
      </div>
    )
  }

  // ── REVIEWING: 낮은 신뢰도 수정 ──
  if (phase === 'reviewing') {
    return (
      <div className="rounded-lg border border-sephiria-border bg-sephiria-panel overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold text-gray-200 border-b border-sephiria-border">
          인식 결과 확인
        </div>
        <div className="p-3">
          <RecognitionReview
            results={reviewResults}
            onChange={setReviewResults}
            onApply={() => applyResults(reviewResults)}
            onCancel={handleReset}
          />
        </div>
      </div>
    )
  }

  // ── COMPLETE: 인식 결과 ──
  if (phase === 'complete') {
    const matched = result?.matchResults?.filter(r => r.matchedValue)?.length ?? 0
    const total = result?.matchResults?.length ?? 0

    return (
      <div className="rounded-lg border border-sephiria-border bg-sephiria-panel overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold text-gray-200 border-b border-sephiria-border flex items-center justify-between">
          <span>인식 완료</span>
          <button onClick={handleReset} className="text-xs text-gray-400 hover:text-white">닫기</button>
        </div>
        <div className="p-3 flex flex-col gap-3">
          <div className="flex gap-3 justify-center text-xs">
            <span className="text-green-400">매칭: {matched}</span>
            <span className="text-gray-400">전체: {total}</span>
            <span className="text-gray-400">셀 탐지: {highlightRects.length}</span>
          </div>
          {total > matched && (
            <p className="text-[10px] text-yellow-400/80 text-center">
              미인식 {total - matched}개는 팔레트에서 직접 배치해 주세요
            </p>
          )}
          <Button variant="outline" size="sm" className="w-full" onClick={handleReset}>
            다시 인식
          </Button>
        </div>
      </div>
    )
  }

  // ── FALLBACK: 자동 인식 실패 → 수동 모드 ──
  if (phase === 'fallback') {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-900/10 p-2.5 flex items-center justify-between">
          <p className="text-[11px] text-yellow-400">
            자동 인식에 실패했습니다. 히스토그램 매칭은 사용하지 않습니다. 오른쪽 팔레트에서 직접 배치하세요.
          </p>
          <button onClick={handleReset} className="text-[10px] text-gray-400 hover:text-white ml-2 shrink-0">
            다시 시도
          </button>
        </div>
        <div className="rounded-lg border border-sephiria-border bg-sephiria-panel p-3 text-[11px] text-gray-400">
          슬롯 수는 그리드 하단 +/− 로 맞춘 뒤, 아이템을 드래그해 올리세요.
        </div>
      </div>
    )
  }

  return null
}
