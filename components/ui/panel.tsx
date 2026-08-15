'use client'

import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PanelProps {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}

export function Panel({ title, children, defaultOpen = true, className }: PanelProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div
      className={cn(
        'rounded-lg border border-sephiria-border bg-sephiria-panel',
        className
      )}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold text-gray-200 hover:text-white"
      >
        <span>{title}</span>
        <svg
          className={cn(
            'h-4 w-4 transition-transform',
            open ? 'rotate-180' : ''
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-sephiria-border px-4 py-3">
          {children}
        </div>
      )}
    </div>
  )
}
