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
  const spriteTransform = {
    transform: `rotate(${rotation * 90}deg)`,
    transformOrigin: 'center',
    transition: 'transform 150ms cubic-bezier(0.16, 1, 0.3, 1)',
  } as const

  return (
    <div
      className={cn(
        'relative flex select-none flex-col items-center justify-center overflow-hidden rounded-inner border-2',
        containerSize,
        TIER_BORDER[data.tier] ?? 'border-sephiria-border',
      )}
    >
      {data.image ? (
        <div
          className="relative flex h-full w-full items-center justify-center"
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
        <div className="flex h-full w-full items-center justify-center bg-sephiria-cell">
          <span className="break-words px-0.5 text-center text-[9px] leading-tight text-sephiria-muted">
            {data.ko_label}
          </span>
        </div>
      )}

      {data.rotate && (
        <div className="absolute bottom-0 right-0 p-0.5">
          <RotateCw size={10} className="text-sephiria-accent" />
        </div>
      )}

      {isCustom && (
        <div className="absolute left-0 top-0 rounded-br bg-sephiria-gold px-0.5 text-[8px] font-bold leading-tight text-sephiria-ink">
          커스텀
        </div>
      )}
    </div>
  )
}
