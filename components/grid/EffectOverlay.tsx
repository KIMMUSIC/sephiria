'use client'

import { cn } from '@/lib/utils'
import { isArtifactDestroyed } from '@/lib/optimizerScore'
import type { PlacedItem } from '@/types'

interface EffectOverlayProps {
  effectValue: number | 'ignore' | undefined
  item?: PlacedItem | null
}

export default function EffectOverlay({ effectValue, item }: EffectOverlayProps) {
  if (effectValue === undefined) return null

  if (effectValue === 'ignore') {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-[10] rounded-inner"
        style={{
          background:
            'repeating-linear-gradient(45deg, rgba(138,122,116,0.16) 0px, rgba(138,122,116,0.16) 4px, transparent 4px, transparent 8px)',
        }}
      />
    )
  }

  if (effectValue === 0) return null

  if (item?.type === 'ARTIFACT') {
    const artifact = item
    const currentLevel = artifact.currentLevel
    if (isArtifactDestroyed(currentLevel)) {
      return (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[10] flex justify-center">
          <span className="rounded-b bg-sephiria-destroy px-1 text-[9px] font-bold leading-tight text-sephiria-destroy-fg">
            파괴
          </span>
        </div>
      )
    }
  }

  const isPositive = effectValue > 0
  const label = isPositive ? `+${effectValue}` : `${effectValue}`

  return (
    <div className="pointer-events-none absolute right-0 top-0 z-[10]">
      <span
        className={cn(
          'block rounded-bl px-1 text-[9px] font-bold leading-tight',
          isPositive
            ? 'bg-sephiria-buff text-sephiria-buff-fg'
            : 'bg-sephiria-debuff text-sephiria-debuff-fg',
        )}
      >
        {label}
      </span>
    </div>
  )
}
