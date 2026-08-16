'use client'

import { Button } from '@/components/ui/button'
import { useInventoryStore } from '@/store/inventoryStore'
import { cn } from '@/lib/utils'

interface ManualInputProps {
  mode: 'ai' | 'manual'
  onModeChange: (mode: 'ai' | 'manual') => void
}

export default function ManualInput({ mode, onModeChange }: ManualInputProps) {
  const clearGrid = useInventoryStore((s) => s.clearGrid)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-fit overflow-hidden rounded-ctl border border-sephiria-border">
        <button
          type="button"
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors duration-200 ease-seph',
            mode === 'ai'
              ? 'bg-sephiria-accent-soft text-sephiria-accent-fg'
              : 'bg-transparent text-sephiria-muted hover:text-sephiria-fg'
          )}
          onClick={() => onModeChange('ai')}
        >
          AI 분석
        </button>
        <button
          type="button"
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors duration-200 ease-seph',
            mode === 'manual'
              ? 'bg-sephiria-accent-soft text-sephiria-accent-fg'
              : 'bg-transparent text-sephiria-muted hover:text-sephiria-fg'
          )}
          onClick={() => onModeChange('manual')}
        >
          수동 입력
        </button>
      </div>

      {mode === 'manual' && (
        <div className="flex flex-col gap-3 rounded-shell border border-sephiria-border bg-sephiria-panel p-4">
          <p className="text-sm text-sephiria-fg">
            팔레트에서 아이템을 드래그하여 인벤토리 그리드에 배치하세요.
          </p>
          <p className="text-xs text-sephiria-muted">
            아티팩트와 석판을 원하는 슬롯에 직접 놓을 수 있습니다.
          </p>
          <div className="flex gap-2 pt-1">
            <Button
              variant="destructive"
              size="sm"
              onClick={clearGrid}
            >
              그리드 초기화
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
