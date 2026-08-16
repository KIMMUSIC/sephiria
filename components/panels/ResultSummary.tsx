'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Lock, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useInventoryStore } from '@/store/inventoryStore'
import { isArtifactDestroyed } from '@/lib/optimizerScore'
import type { PlacedArtifact } from '@/types'

export default function ResultSummary() {
  const [collapsed, setCollapsed] = useState(false)
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
    <div className="bg-sephiria-panel border border-sephiria-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-sephiria-grid transition-colors"
      >
        <span className="text-white font-semibold text-sm">결과 요약</span>
        {collapsed ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronUp size={16} className="text-gray-400" />}
      </button>

      {!collapsed && (
        <div className="p-3 grid grid-cols-2 gap-2">
          <StatCard label="아티팩트" value={artifacts.length} />
          <StatCard label="석판" value={tablets.length} />
          <StatCard
            label="기본 레벨 합"
            value={totalBaseLevel}
          />
          <StatCard
            label="현재 레벨 합"
            value={totalCurrentLevel}
            sub={
              levelDelta !== 0 ? (
                <span className={cn(
                  'text-[10px] font-semibold',
                  levelDelta > 0 ? 'text-blue-400' : 'text-red-400'
                )}>
                  ({deltaSign}{levelDelta})
                </span>
              ) : undefined
            }
          />

          {destroyedCount > 0 && (
            <div className="col-span-2 flex items-center gap-2 bg-red-900/40 border border-red-700/50 rounded p-2">
              <AlertTriangle size={14} className="text-red-400 shrink-0" />
              <span className="text-red-300 text-xs font-medium">
                파괴된 아티팩트: {destroyedCount}개
              </span>
            </div>
          )}

          {lockedCount > 0 && (
            <div className="col-span-2 flex items-center gap-2 bg-sephiria-cell rounded p-2">
              <Lock size={14} className="text-sephiria-gold shrink-0" />
              <span className="text-gray-300 text-xs">잠긴 아티팩트: {lockedCount}개</span>
            </div>
          )}

          {lastOptimize && (
            <div className="col-span-2 grid grid-cols-3 gap-2">
              <StatCard label="최적화 이전" value={Number(lastOptimize.beforeScore.toFixed(2))} />
              <StatCard label="최적화 이후" value={Number(lastOptimize.afterScore.toFixed(2))} />
              <StatCard label="반복 횟수" value={lastOptimize.iterations} />
            </div>
          )}
        </div>
      )}
    </div>
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
    <div className="bg-sephiria-cell rounded p-2 flex flex-col gap-0.5">
      <span className="text-gray-400 text-[10px]">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-white font-semibold text-sm">{value}</span>
        {sub}
      </div>
    </div>
  )
}
