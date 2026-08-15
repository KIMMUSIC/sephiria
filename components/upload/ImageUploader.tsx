'use client'

// Retired: histogram matcher. SmartUploader fallback is manual placement, not this path.

import { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useRecognition } from '@/hooks/useRecognition'
import { useInventoryStore } from '@/store/inventoryStore'
import { ARTIFACTS } from '@/data/artifacts'
import { TABLETS } from '@/data/tablets'
import {
  autoDetectGrid,
  drawGridOverlay,
  type GridParams,
} from '@/lib/gridDetector'
import type { UploadPhase } from '@/types'

interface ImageUploaderProps {
  onCustomTabletNeeded: (slotIndex: number) => void
}

export function ImageUploader({ onCustomTabletNeeded }: ImageUploaderProps) {
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [screenshot, setScreenshot] = useState<HTMLImageElement | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [gridParams, setGridParams] = useState<GridParams | null>(null)
  const [autoDetected, setAutoDetected] = useState(false)

  // Drag selection state
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const slotNum = useInventoryStore((s) => s.slotNum)
  const loadFromRecognition = useInventoryStore((s) => s.loadFromRecognition)
  const { isRecognizing, progress, results, recognize, cancel } = useRecognition()

  // Get canvas scale factor
  const getScale = useCallback(() => {
    if (!canvasRef.current || !screenshot) return { sx: 1, sy: 1 }
    const maxW = canvasRef.current.parentElement?.clientWidth ?? 600
    const scale = Math.min(1, maxW / screenshot.naturalWidth)
    return { sx: scale, sy: scale }
  }, [screenshot])

  // Draw preview
  useEffect(() => {
    if (!screenshot || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')!
    const maxW = canvas.parentElement?.clientWidth ?? 600
    const scale = Math.min(1, maxW / screenshot.naturalWidth)
    canvas.width = screenshot.naturalWidth * scale
    canvas.height = screenshot.naturalHeight * scale
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(screenshot, 0, 0, canvas.width, canvas.height)

    if (gridParams) {
      drawGridOverlay(ctx, gridParams, scale, scale)
    }

    // Draw drag selection rectangle
    if (dragStart && dragEnd) {
      ctx.strokeStyle = 'rgba(245, 200, 66, 0.9)'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(
        dragStart.x,
        dragStart.y,
        dragEnd.x - dragStart.x,
        dragEnd.y - dragStart.y
      )
      ctx.setLineDash([])
    }
  }, [screenshot, gridParams, dragStart, dragEnd])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadImage(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) loadImage(file)
  }

  const loadImage = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      setScreenshot(img)
      setImageUrl(url)
      setDragStart(null)
      setDragEnd(null)

      const detected = autoDetectGrid(img, slotNum)
      if (detected) {
        setGridParams(detected)
        setAutoDetected(true)
      } else {
        setGridParams(null)
        setAutoDetected(false)
      }
      setPhase('validating')
    }
    img.src = url
  }, [slotNum])

  // ── Drag-to-select grid area ──
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setDragStart({ x, y })
    setDragEnd({ x, y })
    setGridParams(null) // clear existing grid while dragging
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragStart) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    setDragEnd({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [dragStart])

  const handleMouseUp = useCallback(() => {
    if (!dragStart || !dragEnd || !screenshot) return
    const { sx, sy } = getScale()

    // Convert canvas coords to image coords
    const x1 = Math.min(dragStart.x, dragEnd.x) / sx
    const y1 = Math.min(dragStart.y, dragEnd.y) / sy
    const x2 = Math.max(dragStart.x, dragEnd.x) / sx
    const y2 = Math.max(dragStart.y, dragEnd.y) / sy

    const w = x2 - x1
    const h = y2 - y1

    // Minimum size check
    if (w > 30 && h > 30) {
      setGridParams({
        originX: Math.round(x1),
        originY: Math.round(y1),
        gridWidth: Math.round(w),
        gridHeight: Math.round(h),
        cols: 6,
        slotNum,
      })
      setAutoDetected(false)
    }

    setDragStart(null)
    setDragEnd(null)
  }, [dragStart, dragEnd, screenshot, slotNum, getScale])

  const handleStartRecognition = async () => {
    if (!screenshot || !gridParams) return
    setPhase('recognizing')
    await recognize(screenshot, gridParams)
    setPhase('complete')
  }

  const handleApply = () => {
    const matched = results.filter((r) => r.matchedValue)
    loadFromRecognition(matched)
    results
      .filter((r) => !r.matchedValue && r.confidence > 0.2)
      .forEach((r) => onCustomTabletNeeded(r.slotIndex))
    handleReset()
  }

  const handleReset = () => {
    setPhase('idle')
    setScreenshot(null)
    setGridParams(null)
    setAutoDetected(false)
    setDragStart(null)
    setDragEnd(null)
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setImageUrl(null)
    cancel()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const matchedCount = results.filter((r) => r.matchedValue).length
  const totalCount = results.length

  // ── IDLE ──
  if (phase === 'idle') {
    return (
      <div className="rounded-lg border border-sephiria-border bg-sephiria-panel overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold text-gray-200 border-b border-sephiria-border">
          스크린샷 인식
        </div>
        <div className="p-3">
          <div
            className={cn(
              'w-full rounded-lg border-2 border-dashed border-sephiria-border',
              'flex flex-col items-center justify-center gap-2 py-8',
              'cursor-pointer transition-colors hover:border-sephiria-accent hover:bg-sephiria-panel/40'
            )}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <div className="text-3xl text-gray-500">&#128247;</div>
            <p className="text-xs font-medium text-gray-300">인벤토리 스크린샷 업로드</p>
            <p className="text-[10px] text-gray-500">자동 그리드 감지 + 템플릿 매칭</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </div>
      </div>
    )
  }

  // ── VALIDATING ──
  if (phase === 'validating') {
    return (
      <div className="rounded-lg border border-sephiria-border bg-sephiria-panel overflow-hidden">
        <div className="px-4 py-2.5 text-sm font-semibold text-gray-200 border-b border-sephiria-border flex items-center justify-between">
          <span>{autoDetected && gridParams ? '✅ 그리드 자동 감지됨' : '드래그로 그리드 영역을 선택하세요'}</span>
          <button onClick={handleReset} className="text-xs text-gray-400 hover:text-white">취소</button>
        </div>
        <div className="p-3 flex flex-col gap-3">
          <div className="rounded-md overflow-hidden border border-sephiria-border cursor-crosshair select-none">
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="w-full"
            />
          </div>

          {!gridParams && (
            <p className="text-[10px] text-yellow-400/80 text-center">
              인벤토리 그리드 영역을 마우스로 드래그해서 선택하세요
            </p>
          )}

          {gridParams && !autoDetected && (
            <p className="text-[10px] text-green-400/80 text-center">
              그리드 선택 완료 — 다시 드래그하면 재설정됩니다
            </p>
          )}

          <Button
            onClick={handleStartRecognition}
            className="w-full"
            disabled={!gridParams}
          >
            인식 시작
          </Button>
        </div>
      </div>
    )
  }

  // ── RECOGNIZING ──
  if (phase === 'recognizing') {
    const pct = progress?.total ? Math.round((progress.completed / progress.total) * 100) : 0
    const label = progress?.phase === 'loading' ? '참조 이미지 로딩...'
      : progress?.phase === 'cropping' ? '셀 크롭 중...'
      : progress?.phase === 'matching' ? '매칭 중...' : '처리 중...'

    return (
      <div className="rounded-lg border border-sephiria-border bg-sephiria-panel p-4 flex flex-col gap-3 items-center">
        <div className="text-xs text-gray-300">{label}</div>
        <Progress value={pct} />
        <div className="text-[10px] text-gray-500">{progress?.completed ?? 0} / {progress?.total ?? 0}</div>
        <Button variant="ghost" size="sm" onClick={() => { cancel(); setPhase('validating') }}>취소</Button>
      </div>
    )
  }

  // ── COMPLETE ──
  return (
    <div className="rounded-lg border border-sephiria-border bg-sephiria-panel overflow-hidden">
      <div className="px-4 py-2.5 text-sm font-semibold text-gray-200 border-b border-sephiria-border flex items-center justify-between">
        <span>인식 결과</span>
        <button onClick={handleReset} className="text-xs text-gray-400 hover:text-white">닫기</button>
      </div>
      <div className="p-3 flex flex-col gap-3">
        <div className="flex gap-3 justify-center text-xs">
          <span className="text-green-400">매칭: {matchedCount}</span>
          <span className="text-gray-400">전체: {totalCount}</span>
        </div>

        <div className="max-h-48 overflow-y-auto flex flex-col gap-1">
          {results.map((r) => {
            const item = r.type === 'ARTIFACT'
              ? ARTIFACTS.find((a) => a.value === r.matchedValue)
              : TABLETS.find((t) => t.value === r.matchedValue)
            const label = item
              ? ('label_kor' in item ? item.label_kor : item.ko_label)
              : '미인식'

            return (
              <div key={r.slotIndex} className={cn(
                'flex items-center gap-2 rounded px-2 py-1 text-[11px]',
                r.matchedValue ? 'bg-green-900/20' : 'bg-yellow-900/20'
              )}>
                <span className="text-gray-500 w-5 text-right">{r.slotIndex}</span>
                <span className={cn('w-2.5 h-2.5 rounded-full', r.matchedValue ? 'bg-green-500' : 'bg-yellow-500')} />
                {item && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt={label} className="w-5 h-5 object-contain" />
                )}
                <span className="text-gray-200 flex-1 truncate">{label}</span>
                <span className="text-gray-500">{Math.round(r.confidence * 100)}%</span>
              </div>
            )
          })}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={handleReset}>다시</Button>
          <Button size="sm" className="flex-1" onClick={handleApply} disabled={matchedCount === 0}>
            적용 ({matchedCount}개)
          </Button>
        </div>
        {totalCount > matchedCount && (
          <p className="text-[10px] text-yellow-400/80 text-center">
            미인식 {totalCount - matchedCount}개는 팔레트에서 직접 배치해 주세요
          </p>
        )}
      </div>
    </div>
  )
}
