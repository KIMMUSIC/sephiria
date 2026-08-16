'use client'

import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center rounded-ctl font-medium',
          'transition-transform duration-200 ease-seph',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sephiria-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sephiria-bg',
          'disabled:pointer-events-none disabled:opacity-50',
          'active:scale-[0.98]',
          {
            default:
              'bg-sephiria-ink text-sephiria-bg hover:bg-sephiria-fg',
            outline:
              'border border-sephiria-border bg-transparent text-sephiria-fg hover:bg-sephiria-grid',
            ghost:
              'bg-transparent text-sephiria-muted hover:bg-sephiria-grid hover:text-sephiria-fg',
            destructive:
              'bg-sephiria-debuff text-sephiria-debuff-fg hover:bg-sephiria-destroy',
          }[variant],
          {
            sm: 'h-8 px-3 text-xs',
            md: 'h-9 px-4 text-sm',
            lg: 'h-11 px-6 text-base',
          }[size],
          className
        )}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'
