'use client'

import Image from 'next/image'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isArtifactDestroyed } from '@/lib/optimizerScore'
import type { PlacedArtifact } from '@/types'

interface ArtifactCardProps {
  artifact: PlacedArtifact
  size?: 'sm' | 'md'
  showLevel?: boolean
}

const TIER_BORDER: Record<string, string> = {
  common: 'border-tier-common',
  advanced: 'border-tier-advanced',
  rare: 'border-tier-rare',
  legend: 'border-tier-legend',
  solid: 'border-tier-solid',
}

export default function ArtifactCard({ artifact, size = 'md', showLevel = true }: ArtifactCardProps) {
  const { data, level, currentLevel, isLocked } = artifact
  const isDestroyed = isArtifactDestroyed(currentLevel)
  const isBuffed = currentLevel > level
  const isDebuffed = currentLevel < level && !isDestroyed

  const containerSize = size === 'sm' ? 'w-12 h-12' : 'w-full h-full'

  return (
    <div
      className={cn(
        'relative flex select-none flex-col items-center justify-center overflow-hidden rounded-inner border-2',
        containerSize,
        TIER_BORDER[data.tier] ?? 'border-sephiria-border',
        isDestroyed && 'bg-sephiria-destroy/60 opacity-70',
      )}
    >
      {data.image ? (
        <div className="relative flex h-full w-full items-center justify-center">
          <Image
            src={data.image}
            alt={data.label_kor}
            fill
            className={cn('object-contain p-0.5', isDestroyed && 'grayscale')}
            unoptimized
          />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-sephiria-cell">
          <span className="break-words px-0.5 text-center text-[9px] leading-tight text-sephiria-muted">
            {data.label_kor}
          </span>
        </div>
      )}

      {showLevel && (
        <div
          className={cn(
            'absolute bottom-0 right-0 rounded-tl px-1 text-[10px] font-bold leading-tight tabular-nums',
            isDestroyed && 'bg-sephiria-destroy text-sephiria-destroy-fg',
            !isDestroyed && isBuffed && 'bg-sephiria-buff text-sephiria-buff-fg',
            !isDestroyed && isDebuffed && 'bg-sephiria-confirm text-sephiria-confirm-fg',
            !isDestroyed && !isBuffed && !isDebuffed && 'bg-sephiria-ink/75 text-sephiria-bg',
          )}
        >
          {currentLevel}
        </div>
      )}

      {isDestroyed && (
        <div className="absolute inset-0 flex items-center justify-center bg-sephiria-destroy/40">
          <span className="text-[9px] font-bold text-sephiria-destroy-fg">파괴</span>
        </div>
      )}

      {isLocked && (
        <div className="absolute left-0 top-0 p-0.5">
          <Lock size={10} className="text-sephiria-gold" />
        </div>
      )}
    </div>
  )
}
