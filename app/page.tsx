'use client'

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { InventoryGrid } from '@/components/grid/InventoryGrid'
import { ArtifactListPanel } from '@/components/panels/ArtifactListPanel'
import { ComboPanel } from '@/components/panels/ComboPanel'
import { ItemPalette } from '@/components/panels/ItemPalette'
import { OptimizePanel } from '@/components/panels/OptimizePanel'
import { ResetButton } from '@/components/panels/ResetButton'
import ResultSummary from '@/components/panels/ResultSummary'
import { ScreenshotUploader } from '@/components/upload/ScreenshotUploader'
import { useDragAndDrop } from '@/hooks/useDragAndDrop'
import { useInventoryStore } from '@/store/inventoryStore'

export default function Home() {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  const { handleDragStart, handleDragOver, handleDragEnd } = useDragAndDrop()
  const resetToken = useInventoryStore((s) => s.resetToken)

  return (
    <main id="main" className="min-h-[100dvh] px-4 py-6 md:px-8 md:py-10">
      <header className="mx-auto mb-8 flex w-full max-w-[1600px] flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-sephiria-fg text-pretty md:text-3xl">
            세피리아 인벤토리 최적화
          </h1>
          <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-sephiria-muted">
            스크린샷을 올리거나 팔레트에서 배치한 뒤, 석판 효과를 반영한 최적 자리를 찾습니다.
          </p>
        </div>
        <ResetButton />
      </header>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/*
          xl 이상 3열: [팔레트 | 그리드 | 도구]. 그리드는 6열 고정폭이라 자연폭을 갖고
          (flex-none), 남는 공간은 양옆 열이 나눠 쓴다. 양옆 열은 sticky + 자체
          overflow-y-auto 로 스스로 스크롤하므로 — 열 안의 패널은 자체 스크롤을 갖지
          않는다 — 그리드는 항상 화면에 남는다. xl 미만에서는 [그리드 | 도구] 2열에
          팔레트가 아래 전폭으로 내려가고(order + flex-wrap), sm 미만은 단일 열.

          열 폭 예산 — xl 시작점(1280px)에서 가용 폭은 1280 − md:px-8(64) − 세로
          스크롤바(≈17) ≈ 1199px. 그리드는 sm:w-[31rem]+md:p-4+border ≈ 530px 고정이라,
          좌 17rem(272) + 그리드 530 + 우 min 20rem(320) + gap-6×2(48) = 1170px 로
          맞춘다. 2xl(1536px)부터는 여유가 생기므로 좌 19rem / 우 min 22rem 로 넓힌다.
        */}
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 lg:flex-row lg:flex-wrap lg:items-start xl:flex-nowrap">
          <aside
            className="order-3 w-full min-w-0 xl:sticky xl:top-6 xl:order-1 xl:max-h-[calc(100dvh-3rem)] xl:w-[17rem] xl:shrink-0 xl:overflow-y-auto 2xl:w-[19rem]"
            aria-label="아이템 팔레트"
          >
            <ItemPalette key={resetToken} />
          </aside>

          <section className="order-1 min-w-0 lg:flex-none xl:order-2" aria-label="인벤토리 그리드">
            <InventoryGrid />
          </section>

          <aside
            className="order-2 flex w-full min-w-0 flex-col gap-3 lg:w-auto lg:flex-1 xl:sticky xl:top-6 xl:order-3 xl:max-h-[calc(100dvh-3rem)] xl:min-w-[20rem] xl:overflow-y-auto 2xl:min-w-[22rem]"
            aria-label="도구"
          >
            <ScreenshotUploader />
            <OptimizePanel />
            <ComboPanel />
            <ArtifactListPanel />
            <ResultSummary />
          </aside>
        </div>
      </DndContext>
    </main>
  )
}
