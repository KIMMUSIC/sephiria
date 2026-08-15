'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useInventoryStore } from '@/store/inventoryStore'
import type { Effect } from '@/types'

interface CustomTabletModalProps {
  slotIndex: number | null
  onClose: () => void
}

type CellValue = number // -1 ~ +5

const GRID_SIZE = 5
const CENTER = 2 // center row/col

function initGrid(): CellValue[][] {
  return Array.from({ length: GRID_SIZE }, (_, row) =>
    Array.from({ length: GRID_SIZE }, (_, col) =>
      row === CENTER && col === CENTER ? 0 : 0
    )
  )
}

function cellBg(value: CellValue, isCenter: boolean): string {
  if (isCenter) return 'bg-sephiria-gold/30 border-sephiria-gold'
  if (value > 0) return 'bg-blue-900/60 border-blue-500'
  if (value < 0) return 'bg-red-900/60 border-red-500'
  return 'bg-sephiria-cell border-sephiria-border'
}

function cellLabel(value: CellValue, isCenter: boolean): string {
  if (isCenter) return '★'
  if (value === 0) return ''
  if (value > 0) return `+${value}`
  return `${value}`
}

export function CustomTabletModal({ slotIndex, onClose }: CustomTabletModalProps) {
  const [grid, setGrid] = useState<CellValue[][]>(initGrid)
  const [name, setName] = useState('커스텀 석판')
  const { createTablet, placeItem } = useInventoryStore()

  function handleLeftClick(row: number, col: number) {
    if (row === CENTER && col === CENTER) return
    setGrid((prev) => {
      const next = prev.map((r) => [...r])
      const cur = next[row][col]
      // Cycle: 0 → 1 → 2 → 3 → 4 → 5 → 0
      // But if currently negative, left click resets to 0 first
      if (cur < 0) {
        next[row][col] = 0
      } else {
        next[row][col] = cur >= 5 ? 0 : cur + 1
      }
      return next
    })
  }

  function handleRightClick(e: React.MouseEvent, row: number, col: number) {
    e.preventDefault()
    if (row === CENTER && col === CENTER) return
    setGrid((prev) => {
      const next = prev.map((r) => [...r])
      const cur = next[row][col]
      // Toggle: anything → -1, -1 → 0
      next[row][col] = cur === -1 ? 0 : -1
      return next
    })
  }

  function handleConfirm() {
    if (slotIndex === null) {
      onClose()
      return
    }

    // Convert 5x5 grid to Effect[]
    const effects: Effect[] = []
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        if (row === CENTER && col === CENTER) continue
        const value = grid[row][col]
        if (value !== 0) {
          effects.push({
            dx: col - CENTER,
            dy: row - CENTER,
            value,
          })
        }
      }
    }

    const tabletData = {
      value: `custom_${Date.now()}`,
      ko_label: name || '커스텀 석판',
      eng_label: 'custom',
      tier: 'common' as const,
      image: '',
    }

    const tablet = createTablet(tabletData, true, effects)
    placeItem(tablet, slotIndex)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-sephiria-panel border border-sephiria-border rounded-xl shadow-2xl p-5 w-[360px] flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold text-base">커스텀 석판 편집</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Name input */}
        <div className="flex flex-col gap-1">
          <label className="text-gray-400 text-xs">석판 이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-sephiria-cell border border-sephiria-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-sephiria-accent"
          />
        </div>

        {/* Instructions */}
        <div className="text-xs text-gray-500 leading-relaxed">
          <span className="text-blue-400">좌클릭</span>: 양수 증가 (0→+5→0)
          &nbsp;&nbsp;
          <span className="text-red-400">우클릭</span>: 음수 토글 (0↔-1)
        </div>

        {/* 5x5 grid */}
        <div className="flex flex-col gap-1 items-center">
          {grid.map((row, rowIdx) => (
            <div key={rowIdx} className="flex gap-1">
              {row.map((value, colIdx) => {
                const isCenter = rowIdx === CENTER && colIdx === CENTER
                return (
                  <button
                    key={colIdx}
                    onClick={() => handleLeftClick(rowIdx, colIdx)}
                    onContextMenu={(e) => handleRightClick(e, rowIdx, colIdx)}
                    disabled={isCenter}
                    className={cn(
                      'w-12 h-12 rounded border-2 text-sm font-bold transition-colors select-none',
                      cellBg(value, isCenter),
                      isCenter
                        ? 'text-sephiria-gold cursor-default'
                        : value > 0
                        ? 'text-blue-300 hover:bg-blue-800/60'
                        : value < 0
                        ? 'text-red-300 hover:bg-red-800/60'
                        : 'text-gray-600 hover:bg-sephiria-grid',
                    )}
                  >
                    {cellLabel(value, isCenter)}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Effect preview */}
        <div className="text-xs text-gray-500">
          효과 셀: {
            grid.flat().filter((v, i) => {
              const row = Math.floor(i / GRID_SIZE)
              const col = i % GRID_SIZE
              return !(row === CENTER && col === CENTER) && v !== 0
            }).length
          }개
        </div>

        {/* Buttons */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-sephiria-border rounded hover:bg-sephiria-grid transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm bg-sephiria-accent hover:bg-purple-500 text-white font-semibold rounded transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  )
}
