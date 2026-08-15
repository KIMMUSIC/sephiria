'use client'

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { InventoryGrid } from '@/components/grid/InventoryGrid'
import { ItemPalette } from '@/components/panels/ItemPalette'
import { OptimizePanel } from '@/components/panels/OptimizePanel'
import ResultSummary from '@/components/panels/ResultSummary'
import { SmartUploader } from '@/components/upload/SmartUploader'
import { CustomTabletModal } from '@/components/editors/CustomTabletModal'
import { useDragAndDrop } from '@/hooks/useDragAndDrop'
import { useState } from 'react'

export default function Home() {
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [customSlotIndex, setCustomSlotIndex] = useState<number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  const { handleDragStart, handleDragOver, handleDragEnd } = useDragAndDrop()

  const handleCustomTabletNeeded = (slotIndex: number) => {
    setCustomSlotIndex(slotIndex)
    setShowCustomModal(true)
  }

  return (
    <main className="min-h-screen p-4 md:p-6">
      {/* Header */}
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-sephiria-gold md:text-3xl">
          세피리아 인벤토리 최적화
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          아티팩트와 석판의 최적 배치를 찾아보세요
        </p>
      </header>

      {/* DndContext wraps BOTH grid and palette so drag works between them */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row">
          {/* Left: Grid */}
          <div className="flex-1">
            <InventoryGrid />
          </div>

          {/* Right: Panels */}
          <div className="flex w-full flex-col gap-4 lg:w-80 xl:w-96">
            <SmartUploader onCustomTabletNeeded={handleCustomTabletNeeded} />
            <ItemPalette />
            <OptimizePanel />
            <ResultSummary />
          </div>
        </div>
      </DndContext>

      {/* Custom Tablet Modal */}
      {showCustomModal && (
        <CustomTabletModal
          slotIndex={customSlotIndex}
          onClose={() => {
            setShowCustomModal(false)
            setCustomSlotIndex(null)
          }}
        />
      )}
    </main>
  )
}
