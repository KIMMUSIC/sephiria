'use client'

import { cn } from '@/lib/utils'
import { isArtifactDestroyed } from '@/lib/optimizerScore'
import type { PlacedItem } from '@/types'
import type { ConstraintStatus } from '@/lib/constraints'

interface EffectOverlayProps {
  effectValue: number | undefined
  item?: PlacedItem | null
  /** Whether a 고양 / 이음 / 환대 cell covers this square. */
  constraintIgnored?: boolean
  /** Resolved `<제약>` state of the artifact standing here. */
  constraintStatus?: ConstraintStatus
  /**
   * 칸에 각인된 인벤토리 레벨 — 석판 효과가 아니라 칸 자체의 속성이다:
   *   "석판을 소모하여 해당하는 인벤토리 칸에 효과를 남깁니다" — namu.wiki/w/세피리아/재능 (생존 20)
   *   친타마니 돌: "부서진 곳의 인벤토리 레벨 +3" — data/artifacts.json
   */
  cellLevel?: number
}

export default function EffectOverlay({
  effectValue,
  item,
  constraintIgnored,
  constraintStatus,
  cellLevel,
}: EffectOverlayProps) {
  const showIgnoreWash = constraintIgnored === true
  const showUnmet = constraintStatus === 'unmet'
  const showCellLevel = cellLevel !== undefined && cellLevel !== 0

  if (effectValue === undefined && !showIgnoreWash && !showUnmet && !showCellLevel) return null

  const destroyed =
    item?.type === 'ARTIFACT' && isArtifactDestroyed(item.currentLevel)

  // 아티팩트 칸은 우하단에 `현재/최대` 레벨 배지(ArtifactCard)를 보여주므로 우상단
  // 석판 델타를 겹쳐 놓지 않는다. 석판이 얼마를 줬는지는 아티팩트 목록과 셀 에디터의
  // `석판 +n` 에서 본다. 빈 칸과 석판 칸에서는 델타가 유일한 정보라 그대로 유지한다.
  const isArtifactCell = item?.type === 'ARTIFACT'

  return (
    <>
      {showIgnoreWash && (
        <div
          className="pointer-events-none absolute inset-0 z-[10] rounded-inner"
          title="제약 무시 칸 — 이 자리의 아티팩트는 제약을 지키지 않아도 효과가 발동합니다"
          style={{
            background:
              'repeating-linear-gradient(45deg, rgba(123,163,196,0.18) 0px, rgba(123,163,196,0.18) 4px, transparent 4px, transparent 8px)',
          }}
        />
      )}

      {destroyed ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[11] flex justify-center">
          <span className="rounded-b bg-sephiria-destroy px-1 text-[9px] font-bold leading-tight text-sephiria-destroy-fg">
            파괴
          </span>
        </div>
      ) : (
        !isArtifactCell &&
        effectValue !== undefined &&
        effectValue !== 0 && (
          <div className="pointer-events-none absolute right-0 top-0 z-[11]">
            <span
              className={cn(
                'block rounded-bl px-1 text-[9px] font-bold leading-tight',
                effectValue > 0
                  ? 'bg-sephiria-buff text-sephiria-buff-fg'
                  : 'bg-sephiria-debuff text-sephiria-debuff-fg',
              )}
            >
              {effectValue > 0 ? `+${effectValue}` : effectValue}
            </span>
          </div>
        )
      )}

      {/* 석판 델타(우상단 buff/debuff 색)와 헷갈리지 않도록 좌하단 + 금색 + '칸' 접두로 구분한다. */}
      {showCellLevel && (
        <div className="pointer-events-none absolute bottom-0 left-0 z-[11]">
          <span
            className="block rounded-tr bg-sephiria-gold px-1 text-[9px] font-bold leading-tight text-sephiria-ink"
            title="이 칸 자체에 각인된 인벤토리 레벨입니다. 여기에 놓이는 아티팩트에 더해집니다."
          >
            칸 {cellLevel! > 0 ? `+${cellLevel}` : cellLevel}
          </span>
        </div>
      )}

      {showUnmet && !destroyed && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[11] flex justify-center">
          <span
            className="rounded-t bg-sephiria-debuff px-1 text-[9px] font-bold leading-tight text-sephiria-debuff-fg"
            title="제약 미충족 — 이 아티팩트의 고유 효과가 발동하지 않습니다"
          >
            제약
          </span>
        </div>
      )}
    </>
  )
}
