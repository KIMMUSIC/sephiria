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

  return (
    <div className="flex flex-col gap-3">
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

      {/* Slot count controls */}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-gray-400 text-sm">슬롯:</span>
        <button
          onClick={() => setSlotNum(slotNum - 1)}
          className="w-6 h-6 flex items-center justify-center rounded bg-sephiria-panel border border-sephiria-border hover:bg-sephiria-grid text-gray-300 transition-colors"
        >
          <Minus size={12} />
        </button>
        <span className="text-white text-sm font-medium w-6 text-center">{slotNum}</span>
        <button
          onClick={() => setSlotNum(slotNum + 1)}
          className="w-6 h-6 flex items-center justify-center rounded bg-sephiria-panel border border-sephiria-border hover:bg-sephiria-grid text-gray-300 transition-colors"
        >
          <Plus size={12} />
        </button>
      </div>
      <CellConfirmPicker />
    </div>
  )
}
