'use client'

import Image from 'next/image'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
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
  const isDestroyed = currentLevel <= 0
  const isBuffed = currentLevel > level
  const isDebuffed = currentLevel < level && !isDestroyed

  const containerSize = size === 'sm' ? 'w-12 h-12' : 'w-full h-full'

  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center rounded border-2 overflow-hidden select-none',
        containerSize,
        TIER_BORDER[data.tier] ?? 'border-sephiria-border',
        isDestroyed && 'opacity-60 bg-red-950/60',
      )}
    >
      {/* Artifact image */}
      {data.image ? (
        <div className="relative w-full h-full flex items-center justify-center">
          <Image
            src={data.image}
            alt={data.label_kor}
            fill
            className={cn('object-contain p-0.5', isDestroyed && 'grayscale')}
            unoptimized
          />
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-sephiria-cell">
          <span className="text-[9px] text-gray-400 text-center leading-tight px-0.5 break-words">
            {data.label_kor}
          </span>
        </div>
      )}

      {/* Level badge */}
      {showLevel && (
        <div
          className={cn(
            'absolute bottom-0 right-0 text-[10px] font-bold px-1 rounded-tl leading-tight',
            isDestroyed && 'bg-red-600 text-white',
            !isDestroyed && isBuffed && 'bg-blue-600 text-white',
            !isDestroyed && isDebuffed && 'bg-yellow-600 text-white',
            !isDestroyed && !isBuffed && !isDebuffed && 'bg-black/70 text-gray-200',
          )}
        >
          {currentLevel}/{data.level}
        </div>
      )}

      {/* Destroyed overlay */}
      {isDestroyed && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/40">
          <span className="text-red-400 text-[9px] font-bold">파괴</span>
        </div>
      )}

      {/* Lock icon */}
      {isLocked && (
        <div className="absolute top-0 left-0 p-0.5">
          <Lock size={10} className="text-sephiria-gold" />
        </div>
      )}
    </div>
  )
}
