'use client'

import { cn } from '@/lib/utils'
import type { PlacedItem } from '@/types'

interface EffectOverlayProps {
  effectValue: number | 'ignore' | undefined
  item?: PlacedItem | null
}

export default function EffectOverlay({ effectValue, item }: EffectOverlayProps) {
  if (effectValue === undefined) return null

  // Ignore overlay: gray striped pattern
  if (effectValue === 'ignore') {
    return (
      <div
        className="absolute inset-0 pointer-events-none rounded z-10"
        style={{
          background:
            'repeating-linear-gradient(45deg, rgba(100,100,100,0.3) 0px, rgba(100,100,100,0.3) 4px, transparent 4px, transparent 8px)',
        }}
      />
    )
  }

  if (effectValue === 0) return null

  // For artifacts: check if destroyed
  if (item?.type === 'ARTIFACT') {
    const artifact = item
    const currentLevel = artifact.currentLevel
    if (currentLevel <= 0) {
      return (
        <div className="absolute top-0 inset-x-0 flex justify-center z-10 pointer-events-none">
          <span className="bg-red-600 text-white text-[9px] font-bold px-1 rounded-b leading-tight">
            파괴
          </span>
        </div>
      )
    }
  }

  const isPositive = effectValue > 0
  const label = isPositive ? `+${effectValue}` : `${effectValue}`

  return (
    <div className="absolute top-0 right-0 z-10 pointer-events-none">
      <span
        className={cn(
          'text-[9px] font-bold px-1 rounded-bl leading-tight block',
          isPositive ? 'bg-blue-600 text-white' : 'bg-red-600 text-white',
        )}
      >
        {label}
      </span>
    </div>
  )
}
