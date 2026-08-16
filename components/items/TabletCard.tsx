'use client'

import Image from 'next/image'
import { RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PlacedTablet } from '@/types'

interface TabletCardProps {
  tablet: PlacedTablet
  size?: 'sm' | 'md'
}

const TIER_BORDER: Record<string, string> = {
  common: 'border-tier-common',
  advanced: 'border-tier-advanced',
  rare: 'border-tier-rare',
  legend: 'border-tier-legend',
  solid: 'border-tier-solid',
}

export default function TabletCard({ tablet, size = 'md' }: TabletCardProps) {
  const { data, rotation, isCustom } = tablet

  const containerSize = size === 'sm' ? 'w-12 h-12' : 'w-full h-full'
  // Engine rotation is 90° CW steps (rotateEffect rot1: (dx,dy)->(-dy,dx) on y-down).
  // CSS rotate(+deg) is also CW. rotation 0 is a no-op for non-rotatable tablets.
  const spriteTransform = {
    transform: `rotate(${rotation * 90}deg)`,
    transformOrigin: 'center',
    transition: 'transform 150ms',
  } as const

  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center rounded border-2 overflow-hidden select-none',
        containerSize,
        TIER_BORDER[data.tier] ?? 'border-sephiria-border',
      )}
    >
      {/* Tablet image — only the sprite rotates; badges stay upright */}
      {data.image ? (
        <div
          className="relative w-full h-full flex items-center justify-center"
          style={spriteTransform}
        >
          <Image
            src={data.image}
            alt={data.ko_label}
            fill
            className="object-contain p-0.5"
            unoptimized
          />
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-sephiria-cell">
          <span className="text-[9px] text-gray-400 text-center leading-tight px-0.5 break-words">
            {data.ko_label}
          </span>
        </div>
      )}

      {/* Rotation indicator (upright) */}
      {data.rotate && (
        <div className="absolute bottom-0 right-0 p-0.5">
          <RotateCw size={10} className="text-sephiria-accent" />
        </div>
      )}

      {/* Custom badge */}
      {isCustom && (
        <div className="absolute top-0 left-0 bg-sephiria-gold/90 text-black text-[8px] font-bold px-0.5 rounded-br leading-tight">
          커스텀
        </div>
      )}
    </div>
  )
}
