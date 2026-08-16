'use client'

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
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
    </div>
  )
}
