'use client'

import { useMemo, useRef } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useInventoryStore } from '@/store/inventoryStore'
import { evaluateBoardDetail } from '@/lib/optimizerScore'
import { slotToPosition } from '@/lib/gridUtils'
import type { ConstraintStatus } from '@/lib/constraints'
import GridCell from '@/components/grid/GridCell'
import { CellConfirmPicker } from '@/components/upload/CellConfirmPicker'
import { CellEditorPopover } from '@/components/grid/CellEditorPopover'

export function InventoryGrid() {
  const {
    slots,
    gridRows,
    dragPreviewSlots,
    removeItem,
    rotateTablet,
    setSlotNum,
    slotNum,
    recognitionMeta,
    cellLevels,
    targetCombo,
    setEditorSlot,
  } = useInventoryStore()

  // While dragging, everything on screen describes the board as it *would* be — levels,
  // 제약 무시 washes and 제약 미충족 badges alike. Deriving all three from one board keeps
  // them from disagreeing mid-drag. 칸 레벨·목표 콤보도 같은 BoardConfig 로 넘겨
  // 드래그 프리뷰가 칸 레벨을 반영하게 한다.
  const previewBoard = dragPreviewSlots ?? slots
  const view = useMemo(() => {
    const detail = evaluateBoardDetail(previewBoard, gridRows, undefined, {
      cellLevels,
      targetCombo,
    })
    const statuses = new Map<number, ConstraintStatus>()
    for (const evaluation of detail.artifacts) {
      if (evaluation.constraintKind) statuses.set(evaluation.slotIndex, evaluation.constraintStatus)
    }
    return { effects: detail.effects, constraintIgnore: detail.constraintIgnore, statuses }
  }, [previewBoard, gridRows, cellLevels, targetCombo])
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 모든 칸에서 클릭은 셀 에디터를 연다. 인식 교체(CellConfirmPicker)는 에디터 안의
  // '다른 아이템으로 교체' 버튼으로 이어진다.
  function handleClick(slotIndex: number) {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null
      setEditorSlot(slotIndex)
    }, 220)
  }

  function handleDoubleClick(slotIndex: number) {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
    removeItem(slotIndex)
  }

  function handleContextMenu(e: React.MouseEvent, slotIndex: number) {
    e.preventDefault()
    rotateTablet(slotIndex)
  }

  const isEmpty = slots.every((slot) => slot == null)

  return (
    <div className="flex flex-col gap-4">
      {/*
        One 6-column CSS grid rather than a row of flex rows. Slot order already
        matches reading order, so a short last row left-aligns on its own, and the
        cells can size themselves against the column instead of a fixed 80px —
        which is what left the card with dead space on wide screens and overflowed
        on narrow ones.
      */}
      <div className="w-full max-w-full rounded-shell border border-sephiria-border bg-sephiria-panel p-3 sm:w-fit md:p-4">
        <div className="grid w-full grid-cols-6 gap-1 sm:w-[31rem]">
          {slots.map((_, slotIndex) => {
            const pos = slotToPosition(slotIndex, gridRows)
            const key = `${pos.row}-${pos.col}`
            const effectValue = view.effects[key]
            const meta = recognitionMeta[slotIndex]
            return (
              <GridCell
                key={slotIndex}
                slotIndex={slotIndex}
                item={previewBoard[slotIndex] ?? null}
                effectValue={effectValue}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
                onClick={handleClick}
                cellLevel={cellLevels[slotIndex] ?? 0}
                lowConfidence={
                  !!meta && !meta.overridden && meta.lowConfidence && !!previewBoard[slotIndex]
                }
                constraintIgnored={view.constraintIgnore.has(key)}
                constraintStatus={view.statuses.get(slotIndex)}
              />
            )
          })}
        </div>
      </div>

      {isEmpty && (
        <p className="text-sm text-sephiria-muted">
          스크린샷을 올리거나 아이템 팔레트에서 끌어다 놓으세요.
        </p>
      )}

      <div className="flex items-center gap-2">
        <span className="text-sm text-sephiria-muted">슬롯</span>
        <button
          type="button"
          onClick={() => setSlotNum(slotNum - 1)}
          className="flex h-6 w-6 items-center justify-center rounded-ctl border border-sephiria-border bg-sephiria-panel text-sephiria-fg transition-colors duration-200 ease-seph hover:bg-sephiria-grid active:scale-[0.98]"
          aria-label="슬롯 줄이기"
        >
          <Minus size={12} />
        </button>
        <span className="w-6 text-center text-sm font-medium tabular-nums text-sephiria-fg">
          {slotNum}
        </span>
        <button
          type="button"
          onClick={() => setSlotNum(slotNum + 1)}
          className="flex h-6 w-6 items-center justify-center rounded-ctl border border-sephiria-border bg-sephiria-panel text-sephiria-fg transition-colors duration-200 ease-seph hover:bg-sephiria-grid active:scale-[0.98]"
          aria-label="슬롯 늘리기"
        >
          <Plus size={12} />
        </button>
      </div>
      <CellConfirmPicker />
      <CellEditorPopover />
    </div>
  )
}
