'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}

/**
 * 모달은 document.body 로 포털해서 띄운다.
 *
 * 제자리에서 렌더하면 조상이 만든 쌓임 맥락에 갇힌다. 이 앱의 3열
 * 레이아웃은 좌·우 열을 position: sticky 로 두는데, sticky 는 z-index 가
 * auto 여도 **항상 새 쌓임 맥락을 만든다** (relative 와 다른 점이다).
 * 그러면 모달의 z-index 가 그 열 안에서만 통해서, DOM 순서상 뒤에 오는
 * 그리드 열이 모달 위를 덮어버린다. 실제로 석판 합성 모달이 그렇게 묻혔다.
 * 열의 overflow-y-auto 도 같은 방향으로 작용한다.
 *
 * 포털은 모달을 body 직속으로 옮겨 이 문제를 원천에서 없애고, 앞으로 어느
 * 열에서 모달을 띄우든 같은 버그가 다시 나지 않게 한다.
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // 포털은 document 가 있어야 하므로 마운트 된 뒤에만 그린다 (SSR 안전).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!open || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[50] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-sephiria-ink/30"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'relative z-[50] max-h-[90vh] overflow-auto rounded-shell border border-sephiria-border bg-sephiria-panel p-6 shadow-seph',
          className
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="modal-title" className="text-lg font-semibold tracking-tight text-sephiria-fg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-ctl p-1 text-sephiria-muted transition-colors duration-200 ease-seph hover:bg-sephiria-grid hover:text-sephiria-fg"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}
