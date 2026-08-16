'use client'

import { useRef } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useInventoryStore } from '@/store/inventoryStore'
import GridCell from '@/components/grid/GridCell'
import { CellConfirmPicker } from '@/components/upload/CellConfirmPicker'

export function InventoryGrid() {
  const {
    slots,
    gridRows,
    effectMap,
    dragPreviewEffects,
    removeItem,
    rotateTablet,
    setSlotNum,
    slotNum,
    recognitionMeta,
    setPickerSlot,
  } = useInventoryStore()
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleClick(slotIndex: number) {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null
      setPickerSlot(slotIndex)
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

  const activeMap = dragPreviewEffects ?? effectMap
  const hasRecognition = Object.keys(recognitionMeta).length > 0
  const isEmpty = slots.every((slot) => slot == null)

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-shell border border-sephiria-border bg-sephiria-panel p-3 md:p-4">
        <div className="flex flex-col gap-1">
          {gridRows.map((row) => (
            <div key={row.rowIndex} className="flex gap-1">
              {Array.from({ length: row.cols }, (_, colIndex) => {
                let slotIndex = 0
                for (const r of gridRows) {
                  if (r.rowIndex === row.rowIndex) {
                    slotIndex += colIndex
                    break
                  }
                  slotIndex += r.cols
                }
                const key = `${row.rowIndex}-${colIndex}`
                const effectValue = activeMap[key]
                const meta = recognitionMeta[slotIndex]
                return (
                  <GridCell
                    key={slotIndex}
                    slotIndex={slotIndex}
                    item={slots[slotIndex] ?? null}
                    effectValue={effectValue}
                    onDoubleClick={handleDoubleClick}
                    onContextMenu={handleContextMenu}
                    onClick={hasRecognition ? handleClick : undefined}
                    lowConfidence={
                      !!meta && !meta.overridden && meta.lowConfidence && !!slots[slotIndex]
                    }
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {isEmpty && (
        <p className="text-sm text-sephiria-muted">
          스크린샷을 올리거나 오른쪽 팔레트에서 아이템을 끌어다 놓으세요.
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
    </div>
  )
}
