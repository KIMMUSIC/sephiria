'use client'

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { InventoryGrid } from '@/components/grid/InventoryGrid'
import { ItemPalette } from '@/components/panels/ItemPalette'
import { OptimizePanel } from '@/components/panels/OptimizePanel'
import ResultSummary from '@/components/panels/ResultSummary'
import { ScreenshotUploader } from '@/components/upload/ScreenshotUploader'
import { useDragAndDrop } from '@/hooks/useDragAndDrop'

export default function Home() {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  const { handleDragStart, handleDragOver, handleDragEnd } = useDragAndDrop()

  return (
    <main className="min-h-screen p-4 md:p-6">
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-sephiria-gold md:text-3xl">
          세피리아 인벤토리 최적화
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          아티팩트와 석판의 최적 배치를 찾아보세요
        </p>
      </header>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row">
          <div className="flex-1">
            <InventoryGrid />
          </div>

          <div className="flex w-full flex-col gap-4 lg:w-80 xl:w-96">
            <ScreenshotUploader />
            <ItemPalette />
            <OptimizePanel />
            <ResultSummary />
          </div>
        </div>
      </DndContext>
    </main>
  )
}
