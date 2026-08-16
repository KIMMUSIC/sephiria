'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useInventoryStore } from '@/store/inventoryStore'
import type { Effect } from '@/types'

interface CustomTabletModalProps {
  slotIndex: number | null
  onClose: () => void
}

type CellValue = number

const GRID_SIZE = 5
const CENTER = 2

function initGrid(): CellValue[][] {
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => 0)
  )
}

function cellBg(value: CellValue, isCenter: boolean): string {
  if (isCenter) return 'bg-sephiria-confirm border-sephiria-gold'
  if (value > 0) return 'bg-sephiria-buff border-sephiria-buff-fg/40'
  if (value < 0) return 'bg-sephiria-debuff border-sephiria-debuff-fg/40'
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
      next[row][col] = cur === -1 ? 0 : -1
      return next
    })
  }

  function handleConfirm() {
    if (slotIndex === null) {
      onClose()
      return
    }

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
    <div className="fixed inset-0 z-[50] flex items-center justify-center bg-sephiria-ink/30 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-tablet-title"
        className="flex w-[360px] flex-col gap-4 rounded-shell border border-sephiria-border bg-sephiria-panel p-5 shadow-seph"
      >
        <div className="flex items-center justify-between">
          <h2 id="custom-tablet-title" className="text-base font-semibold text-sephiria-fg">
            커스텀 석판 편집
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sephiria-muted transition-colors duration-200 ease-seph hover:text-sephiria-fg"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-sephiria-muted">석판 이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-ctl border border-sephiria-border bg-sephiria-cell px-3 py-1.5 text-sm text-sephiria-fg focus:border-sephiria-accent focus:outline-none focus:ring-1 focus:ring-sephiria-accent"
          />
        </div>

        <div className="text-xs leading-relaxed text-sephiria-muted">
          <span className="text-sephiria-buff-fg">좌클릭</span>: 양수 증가 (0→+5→0)
          {'  '}
          <span className="text-sephiria-debuff-fg">우클릭</span>: 음수 토글 (0↔-1)
        </div>

        <div className="flex flex-col items-center gap-1">
          {grid.map((row, rowIdx) => (
            <div key={rowIdx} className="flex gap-1">
              {row.map((value, colIdx) => {
                const isCenter = rowIdx === CENTER && colIdx === CENTER
                return (
                  <button
                    key={colIdx}
                    type="button"
                    onClick={() => handleLeftClick(rowIdx, colIdx)}
                    onContextMenu={(e) => handleRightClick(e, rowIdx, colIdx)}
                    disabled={isCenter}
                    className={cn(
                      'h-12 w-12 select-none rounded-inner border-2 text-sm font-bold tabular-nums transition-colors duration-200 ease-seph',
                      cellBg(value, isCenter),
                      isCenter
                        ? 'cursor-default text-sephiria-gold'
                        : value > 0
                        ? 'text-sephiria-buff-fg hover:bg-sephiria-buff'
                        : value < 0
                        ? 'text-sephiria-debuff-fg hover:bg-sephiria-debuff'
                        : 'text-sephiria-muted hover:bg-sephiria-grid',
                    )}
                  >
                    {cellLabel(value, isCenter)}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="text-xs text-sephiria-muted">
          효과 셀: {
            grid.flat().filter((v, i) => {
              const row = Math.floor(i / GRID_SIZE)
              const col = i % GRID_SIZE
              return !(row === CENTER && col === CENTER) && v !== 0
            }).length
          }개
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            확인
          </Button>
        </div>
      </div>
    </div>
  )
}
