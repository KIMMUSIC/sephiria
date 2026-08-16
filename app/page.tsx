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
    <main id="main" className="min-h-[100dvh] px-4 py-6 md:px-8 md:py-10">
      <header className="mx-auto mb-8 max-w-[1400px]">
        <h1 className="text-2xl font-semibold tracking-tight text-sephiria-fg text-pretty md:text-3xl">
          세피리아 인벤토리 최적화
        </h1>
        <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-sephiria-muted">
          스크린샷을 올리거나 팔레트에서 배치한 뒤, 석판 효과를 반영한 최적 자리를 찾습니다.
        </p>
      </header>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 lg:flex-row lg:items-start">
          <section className="min-w-0 flex-1" aria-label="인벤토리 그리드">
            <InventoryGrid />
          </section>

          <aside className="flex w-full flex-col gap-3 lg:w-80 xl:w-96" aria-label="도구">
            <ScreenshotUploader />
            <ItemPalette />
            <OptimizePanel />
            <ResultSummary />
          </aside>
        </div>
      </DndContext>
    </main>
  )
}
