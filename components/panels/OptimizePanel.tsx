'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Play, Square, Loader2 } from 'lucide-react'
import { useOptimizer } from '@/hooks/useOptimizer'
import { useInventoryStore } from '@/store/inventoryStore'

export function OptimizePanel() {
  const [collapsed, setCollapsed] = useState(false)
  const { isOptimizing, progress, error, optimize, cancel } = useOptimizer()
  const lastOptimize = useInventoryStore((s) => s.lastOptimize)

  return (
    <div className="bg-sephiria-panel border border-sephiria-border rounded-lg overflow-hidden">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-sephiria-grid transition-colors"
      >
        <span className="text-white font-semibold text-sm">최적화</span>
        {collapsed ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronUp size={16} className="text-gray-400" />}
      </button>

      {!collapsed && (
        <div className="p-3 flex flex-col gap-3">
          <div className="flex gap-2">
            {!isOptimizing ? (
              <button
                onClick={optimize}
                className="flex items-center gap-2 px-4 py-2 bg-sephiria-accent hover:bg-purple-500 text-white text-sm font-semibold rounded transition-colors"
              >
                <Play size={14} />
                최적 배치 찾기
              </button>
            ) : (
              <button
                onClick={cancel}
                className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-sm font-semibold rounded transition-colors"
              >
                <Square size={14} />
                취소
              </button>
            )}
            {isOptimizing && (
              <Loader2 size={20} className="animate-spin text-sephiria-accent self-center" />
            )}
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-900/30 border border-red-700/40 rounded px-2 py-1.5">
              {error}
            </p>
          )}

          {isOptimizing && progress && (
            <div className="flex flex-col gap-2">
              <div className="w-full bg-sephiria-cell rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-sephiria-accent transition-all duration-300 rounded-full"
                  style={{ width: `${progress.progressPct}%` }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-sephiria-cell rounded p-1.5 text-center">
                  <div className="text-gray-400">반복</div>
                  <div className="text-white font-medium">{progress.iteration.toLocaleString()}</div>
                </div>
                <div className="bg-sephiria-cell rounded p-1.5 text-center">
                  <div className="text-gray-400">최고 점수</div>
                  <div className="text-sephiria-accent font-medium">{progress.bestScore.toFixed(2)}</div>
                </div>
                <div className="bg-sephiria-cell rounded p-1.5 text-center">
                  <div className="text-gray-400">온도</div>
                  <div className="text-white font-medium">{progress.temp.toFixed(2)}</div>
                </div>
              </div>

              <div className="text-xs text-gray-400 text-center">
                진행률: {progress.progressPct}%
              </div>
            </div>
          )}

          {!isOptimizing && lastOptimize && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-sephiria-cell rounded p-1.5 text-center">
                <div className="text-gray-400">이전</div>
                <div className="text-white font-medium">{lastOptimize.beforeScore.toFixed(2)}</div>
              </div>
              <div className="bg-sephiria-cell rounded p-1.5 text-center">
                <div className="text-gray-400">이후</div>
                <div className="text-sephiria-accent font-medium">{lastOptimize.afterScore.toFixed(2)}</div>
              </div>
              <div className="bg-sephiria-cell rounded p-1.5 text-center">
                <div className="text-gray-400">반복</div>
                <div className="text-white font-medium">{lastOptimize.iterations.toLocaleString()}</div>
              </div>
            </div>
          )}

          {!isOptimizing && !lastOptimize && (
            <p className="text-xs text-gray-500">
              SA(모의 담금질)로 아티팩트 최종 레벨 합을 최대화합니다. 휴리스틱은 동점 처리용입니다.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
