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
        'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none',
        {
          default: 'bg-sephiria-panel text-gray-300',
          buff: 'bg-blue-500/80 text-white',
          debuff: 'bg-red-500/80 text-white',
          destroy: 'bg-red-700 text-white animate-pulse',
          tier: 'bg-sephiria-panel text-gray-300',
        }[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
