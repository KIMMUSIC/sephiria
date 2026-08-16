'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PanelProps {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  className?: string
  trailing?: ReactNode
}

export function Panel({ title, children, defaultOpen = true, className, trailing }: PanelProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section
      className={cn(
        'overflow-hidden rounded-shell border border-sephiria-border bg-sephiria-panel',
        className
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold text-sephiria-fg transition-colors duration-200 ease-seph hover:bg-sephiria-grid/60"
      >
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {trailing}
          <ChevronDown
            size={16}
            className={cn(
              'text-sephiria-muted transition-transform duration-200 ease-seph',
              open ? 'rotate-180' : ''
            )}
          />
        </span>
      </button>
      {open && (
        <div className="border-t border-sephiria-border px-4 py-3">
          {children}
        </div>
      )}
    </section>
  )
}
