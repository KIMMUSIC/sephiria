'use client'

import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-ctl border border-sephiria-border bg-sephiria-cell px-3 py-1',
        'text-sm text-sephiria-fg placeholder:text-sephiria-muted',
        'focus:border-sephiria-accent focus:outline-none focus:ring-1 focus:ring-sephiria-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
})

Input.displayName = 'Input'
