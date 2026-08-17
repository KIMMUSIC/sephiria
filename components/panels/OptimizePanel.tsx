'use client'

import { Play, Square, Loader2 } from 'lucide-react'
import { Panel } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useOptimizer } from '@/hooks/useOptimizer'
import { useInventoryStore } from '@/store/inventoryStore'
import { COMBO_KO } from '@/data/wikiLabels'

export function OptimizePanel() {
  const { isOptimizing, progress, error, optimize, cancel } = useOptimizer()
  const lastOptimize = useInventoryStore((s) => s.lastOptimize)
  const targetCombo = useInventoryStore((s) => s.targetCombo)

  return (
    <Panel title="최적화">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          {!isOptimizing ? (
            <Button onClick={optimize} size="sm">
              <Play size={14} className="mr-2" />
              최적 배치 찾기
            </Button>
          ) : (
            <Button onClick={cancel} variant="destructive" size="sm">
              <Square size={14} className="mr-2" />
              취소
            </Button>
          )}
          {isOptimizing && (
            <Loader2 size={20} className="animate-spin self-center text-sephiria-accent" />
          )}
        </div>

        {error && (
          <p className="rounded-inner border border-sephiria-debuff-fg/20 bg-sephiria-debuff px-2 py-1.5 text-xs text-sephiria-debuff-fg">
            {error}
          </p>
        )}

        {isOptimizing && progress && (
          <div className="flex flex-col gap-2">
            <Progress value={progress.progressPct} />

            <div className="grid grid-cols-4 gap-2 text-xs">
              <Stat label="반복" value={progress.iteration.toLocaleString()} />
              <Stat label="레벨 합" value={String(progress.levelSum)} accent />
              <Stat label="목표 달성" value={String(progress.goalsMet)} />
              <Stat label="콤보 단계" value={String(progress.comboTiers)} />
            </div>

            <div className="text-center text-xs tabular-nums text-sephiria-muted">
              진행률 {progress.progressPct}%
            </div>
          </div>
        )}

        {!isOptimizing && lastOptimize && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="이전 레벨 합" value={String(lastOptimize.beforeLevelSum)} />
              <Stat label="이후 레벨 합" value={String(lastOptimize.afterLevelSum)} accent />
              <Stat label="반복" value={lastOptimize.iterations.toLocaleString()} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat
                label="목표 달성"
                value={`${lastOptimize.goalsMet} / ${lastOptimize.goalsTotal}`}
                accent={lastOptimize.goalsTotal > 0 && lastOptimize.goalsMet === lastOptimize.goalsTotal}
              />
              <Stat
                label="제약 충족"
                value={`${lastOptimize.constraintsMet} / ${lastOptimize.constraintsTotal}`}
                accent={
                  lastOptimize.constraintsTotal > 0 &&
                  lastOptimize.constraintsMet === lastOptimize.constraintsTotal
                }
              />
              <Stat
                label="콤보 단계"
                value={String(lastOptimize.comboTiers)}
                accent={lastOptimize.comboTiers > 0}
              />
            </div>
            {lastOptimize.targetComboTiers !== null && (
              <p
                className={
                  lastOptimize.targetComboTiers > 0
                    ? 'rounded-inner border border-sephiria-buff-fg/20 bg-sephiria-buff px-2 py-1.5 text-xs text-sephiria-buff-fg'
                    : 'rounded-inner border border-sephiria-confirm-fg/20 bg-sephiria-confirm px-2 py-1.5 text-xs text-sephiria-confirm-fg'
                }
              >
                목표 콤보{targetCombo ? ` (${COMBO_KO[targetCombo] ?? targetCombo})` : ''} —{' '}
                {lastOptimize.targetComboTiers > 0
                  ? `${lastOptimize.targetComboTiers}단계 도달`
                  : '아직 임계값에 도달하지 못했습니다'}
              </p>
            )}
            {lastOptimize.goalsTotal > lastOptimize.goalsMet && (
              <p className="rounded-inner border border-sephiria-confirm-fg/20 bg-sephiria-confirm px-2 py-1.5 text-xs text-sephiria-confirm-fg">
                목표 강화를 모두 채우지 못했습니다. 목표를 낮추거나 우선순위를 줄여 보세요.
              </p>
            )}
          </div>
        )}

        {!isOptimizing && !lastOptimize && (
          <p className="text-xs leading-relaxed text-sephiria-muted">
            콤보 패널에서 목표 콤보를 지정하면 그 콤보의 단계 달성을 다른 무엇보다 먼저 채웁니다.
            그 다음 우선순위가 높은 아이템의 목표 강화를 채우고, 나머지 레벨 합을 최대화합니다.
            제약이 있는 아티팩트는 제약을 만족하는 자리를, 필요하면 고양·이음·환대의 제약 무시 칸을 찾습니다.
          </p>
        )}
      </div>
    </Panel>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-inner bg-sephiria-grid p-1.5 text-center">
      <div className="text-sephiria-muted">{label}</div>
      <div className={accent ? 'font-medium tabular-nums text-sephiria-accent-fg' : 'font-medium tabular-nums text-sephiria-fg'}>
        {value}
      </div>
    </div>
  )
}
