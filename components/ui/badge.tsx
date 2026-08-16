'use client'

import { cn } from '@/lib/utils'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'buff' | 'debuff' | 'destroy' | 'tier'
  className?: string
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none',
        {
          default: 'bg-sephiria-grid text-sephiria-muted',
          buff: 'bg-sephiria-buff text-sephiria-buff-fg',
          debuff: 'bg-sephiria-debuff text-sephiria-debuff-fg',
          destroy: 'bg-sephiria-destroy text-sephiria-destroy-fg',
          tier: 'bg-sephiria-grid text-sephiria-fg',
        }[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
