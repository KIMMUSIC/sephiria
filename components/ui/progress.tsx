'use client'

import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number
  className?: string
}

export function Progress({ value, className }: ProgressProps) {
  return (
    <div
      className={cn(
        'h-2 w-full overflow-hidden rounded-ctl bg-sephiria-grid',
        className
      )}
    >
      <div
        className="h-full rounded-ctl bg-sephiria-accent transition-[width] duration-300 ease-seph"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}
