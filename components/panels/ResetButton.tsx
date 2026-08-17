'use client'

import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useInventoryStore } from '@/store/inventoryStore'

/**
 * 전체 초기화. Destructive and not undoable, so it always confirms first and the
 * dialog names every piece it throws away — 합성 석판 in particular took work to
 * build and would be a nasty surprise.
 */
export function ResetButton() {
  const [open, setOpen] = useState(false)
  const resetAll = useInventoryStore((s) => s.resetAll)
  const isOptimizing = useInventoryStore((s) => s.isOptimizing)
  const slots = useInventoryStore((s) => s.slots)
  const fusedTablets = useInventoryStore((s) => s.fusedTablets)

  const placed = slots.filter(Boolean).length
  const hasSomethingToClear = placed > 0 || fusedTablets.length > 0

  function handleConfirm() {
    resetAll()
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={isOptimizing || !hasSomethingToClear}
        title={
          isOptimizing
            ? '최적화가 끝난 뒤에 초기화할 수 있습니다'
            : hasSomethingToClear
              ? '배치와 설정을 모두 지우고 처음 상태로 되돌립니다'
              : '초기화할 내용이 없습니다'
        }
        className="flex items-center gap-1.5 rounded-ctl border border-sephiria-border px-3 py-1.5 text-xs font-medium text-sephiria-muted transition-colors duration-200 ease-seph hover:bg-sephiria-grid hover:text-sephiria-fg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
      >
        <RotateCcw size={13} />
        전체 초기화
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="전체 초기화"
        className="w-full max-w-[26rem]"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-sephiria-fg">
            처음 상태로 되돌립니다. 되돌릴 수 없습니다.
          </p>

          <ul className="flex flex-col gap-1.5 rounded-inner bg-sephiria-grid p-3 text-xs leading-relaxed text-sephiria-muted">
            <li>· 인벤에 배치된 아이템 {placed}개</li>
            <li>· 스크린샷 인식 결과와 확인 표시</li>
            <li>· 인챈트 · 우선순위 · 목표 강화 · 자리 고정 설정</li>
            <li>· 직접 만든 합성 석판 {fusedTablets.length}개</li>
            <li>· 최적화 결과와 팔레트 검색 · 필터</li>
            <li>· 슬롯 수는 기본값 34로 돌아갑니다</li>
          </ul>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button variant="destructive" size="sm" onClick={handleConfirm}>
              <RotateCcw size={13} className="mr-1.5" />
              전체 초기화
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
