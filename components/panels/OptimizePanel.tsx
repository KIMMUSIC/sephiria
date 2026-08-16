'use client'

import { Play, Square, Loader2 } from 'lucide-react'
import { Panel } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useOptimizer } from '@/hooks/useOptimizer'
import { useInventoryStore } from '@/store/inventoryStore'

export function OptimizePanel() {
  const { isOptimizing, progress, error, optimize, cancel } = useOptimizer()
  const lastOptimize = useInventoryStore((s) => s.lastOptimize)

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

            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="반복" value={progress.iteration.toLocaleString()} />
              <Stat label="최고 점수" value={progress.bestScore.toFixed(2)} accent />
              <Stat label="온도" value={progress.temp.toFixed(2)} />
            </div>

            <div className="text-center text-xs tabular-nums text-sephiria-muted">
              진행률 {progress.progressPct}%
            </div>
          </div>
        )}

        {!isOptimizing && lastOptimize && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="이전" value={lastOptimize.beforeScore.toFixed(2)} />
            <Stat label="이후" value={lastOptimize.afterScore.toFixed(2)} accent />
            <Stat label="반복" value={lastOptimize.iterations.toLocaleString()} />
          </div>
        )}

        {!isOptimizing && !lastOptimize && (
          <p className="text-xs leading-relaxed text-sephiria-muted">
            SA(모의 담금질)로 아티팩트 최종 레벨 합을 최대화합니다. 휴리스틱은 동점 처리용입니다.
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
