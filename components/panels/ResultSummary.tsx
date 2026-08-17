'use client'

import { Lock, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { useInventoryStore } from '@/store/inventoryStore'
import { isArtifactDestroyed } from '@/lib/optimizerScore'
import type { PlacedArtifact } from '@/types'

export default function ResultSummary() {
  const { slots, lastOptimize } = useInventoryStore()

  const placed = slots.filter(Boolean)
  const artifacts = placed.filter((s) => s?.type === 'ARTIFACT') as PlacedArtifact[]
  const tablets = placed.filter((s) => s?.type === 'TABLET')

  const totalBaseLevel = artifacts.reduce((sum, a) => sum + a.level, 0)
  const totalCurrentLevel = artifacts.reduce((sum, a) => sum + a.currentLevel, 0)
  const destroyedCount = artifacts.filter((a) => isArtifactDestroyed(a.currentLevel)).length
  const lockedCount = artifacts.filter((a) => a.isLocked).length

  const levelDelta = totalCurrentLevel - totalBaseLevel
  const deltaSign = levelDelta >= 0 ? '+' : ''

  return (
    <Panel title="결과 요약">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="아티팩트" value={artifacts.length} />
        <StatCard label="석판" value={tablets.length} />
        <StatCard label="기본 레벨 합" value={totalBaseLevel} />
        <StatCard
          label="현재 레벨 합"
          value={totalCurrentLevel}
          sub={
            levelDelta !== 0 ? (
              <span className={cn(
                'text-[10px] font-semibold',
                levelDelta > 0 ? 'text-sephiria-buff-fg' : 'text-sephiria-debuff-fg'
              )}>
                ({deltaSign}{levelDelta})
              </span>
            ) : undefined
          }
        />

        {destroyedCount > 0 && (
          <div className="col-span-2 flex items-center gap-2 rounded-inner border border-sephiria-debuff-fg/20 bg-sephiria-debuff p-2">
            <AlertTriangle size={14} className="shrink-0 text-sephiria-debuff-fg" />
            <span className="text-xs font-medium text-sephiria-debuff-fg">
              파괴된 아티팩트: {destroyedCount}개
            </span>
          </div>
        )}

        {lockedCount > 0 && (
          <div className="col-span-2 flex items-center gap-2 rounded-inner bg-sephiria-grid p-2">
            <Lock size={14} className="shrink-0 text-sephiria-gold" />
            <span className="text-xs text-sephiria-fg">잠긴 아티팩트: {lockedCount}개</span>
          </div>
        )}

        {lastOptimize && (
          <div className="col-span-2 grid grid-cols-3 gap-2">
            <StatCard label="최적화 이전" value={lastOptimize.beforeLevelSum} />
            <StatCard label="최적화 이후" value={lastOptimize.afterLevelSum} />
            <StatCard label="반복 횟수" value={lastOptimize.iterations} />
          </div>
        )}
      </div>
    </Panel>
  )
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string
  value: number
  sub?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-inner bg-sephiria-grid p-2">
      <span className="text-[10px] text-sephiria-muted">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-sm font-semibold tabular-nums text-sephiria-fg">{value}</span>
        {sub}
      </div>
    </div>
  )
}
