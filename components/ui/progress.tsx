'use client'

import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number // 0-100
  className?: string
}

export function Progress({ value, className }: ProgressProps) {
  return (
    <div
      className={cn(
        'h-2 w-full overflow-hidden rounded-full bg-sephiria-cell',
        className
      )}
    >
      <div
        className="h-full rounded-full bg-sephiria-accent transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}
