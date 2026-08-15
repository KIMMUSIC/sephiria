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
          'inline-flex items-center justify-center rounded-md font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sephiria-accent',
          'disabled:pointer-events-none disabled:opacity-50',
          {
            default:
              'bg-sephiria-accent text-white hover:bg-sephiria-accent/80',
            outline:
              'border border-sephiria-border bg-transparent text-gray-200 hover:bg-sephiria-panel',
            ghost:
              'bg-transparent text-gray-300 hover:bg-sephiria-panel hover:text-white',
            destructive:
              'bg-red-600 text-white hover:bg-red-700',
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
