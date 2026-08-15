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

const ROTATION_DEGREES: Record<number, string> = {
  0: 'rotate-0',
  1: 'rotate-90',
  2: 'rotate-180',
  3: '-rotate-90',
}

export default function TabletCard({ tablet, size = 'md' }: TabletCardProps) {
  const { data, rotation, isCustom } = tablet

  const containerSize = size === 'sm' ? 'w-12 h-12' : 'w-full h-full'

  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center rounded border-2 overflow-hidden select-none',
        containerSize,
        TIER_BORDER[data.tier] ?? 'border-sephiria-border',
      )}
    >
      {/* Tablet image */}
      {data.image ? (
        <div className="relative w-full h-full flex items-center justify-center">
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

      {/* Rotation indicator */}
      {data.rotate && (
        <div className="absolute bottom-0 right-0 p-0.5">
          <RotateCw
            size={10}
            className={cn('text-sephiria-accent', ROTATION_DEGREES[rotation])}
          />
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
