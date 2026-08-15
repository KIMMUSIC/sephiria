'use client'

import { Button } from '@/components/ui/button'
import { useInventoryStore } from '@/store/inventoryStore'

interface ManualInputProps {
  mode: 'ai' | 'manual'
  onModeChange: (mode: 'ai' | 'manual') => void
}

export default function ManualInput({ mode, onModeChange }: ManualInputProps) {
  const clearGrid = useInventoryStore((s) => s.clearGrid)

  return (
    <div className="flex flex-col gap-4">
      {/* Mode toggle */}
      <div className="flex rounded-md border border-sephiria-border overflow-hidden w-fit">
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'ai'
              ? 'bg-sephiria-accent text-white'
              : 'bg-transparent text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => onModeChange('ai')}
        >
          AI 분석
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'manual'
              ? 'bg-sephiria-accent text-white'
              : 'bg-transparent text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => onModeChange('manual')}
        >
          수동 입력
        </button>
      </div>

      {mode === 'manual' && (
        <div className="flex flex-col gap-3 p-4 rounded-lg border border-sephiria-border bg-sephiria-panel/20">
          <p className="text-sm text-gray-300">
            팔레트에서 아이템을 드래그하여 인벤토리 그리드에 배치하세요.
          </p>
          <p className="text-xs text-gray-500">
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
