'use client'

import Image from 'next/image'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isArtifactDestroyed } from '@/lib/optimizerScore'
import { artifactLevelState, artifactLevelText } from '@/lib/levelDisplay'
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
  const { data, currentLevel, isLocked } = artifact
  const isDestroyed = isArtifactDestroyed(currentLevel)
  // 인게임과 같은 `현재/최대` 표기 — 별은 레벨 상한이다 (lib/optimizerScore.ts finalLevelOf).
  const maxLevel = data.level ?? 0
  const levelState = artifactLevelState(currentLevel, maxLevel)
  const levelText = artifactLevelText(currentLevel, maxLevel)

  const LEVEL_TITLE: Record<typeof levelState, string> = {
    destroyed: `레벨 ${currentLevel} — -1 이하라 효과가 무효입니다`,
    maxed: `풀강 ${levelText}`,
    fixed: '강화 불가 (별 0)',
    partial: `${levelText} 강화`,
  }

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
            // px-0.5: 별 상한 최대 14 라 `14/14`, `-1/14` 같은 5글자가 나온다.
            // 글자 크기는 줄이지 않는다 — 가독성이 이 기능의 요점이다.
            'absolute bottom-0 right-0 rounded-tl px-0.5 text-[10px] font-bold leading-tight tabular-nums',
            // 풀강만 강조 — partial 까지 색을 넣으면 보드 전체가 시끄러워진다.
            levelState === 'destroyed' && 'bg-sephiria-destroy text-sephiria-destroy-fg',
            levelState === 'maxed' && 'bg-sephiria-buff text-sephiria-buff-fg',
            (levelState === 'partial' || levelState === 'fixed') &&
              'bg-sephiria-ink/75 text-sephiria-bg',
          )}
          title={LEVEL_TITLE[levelState]}
        >
          {levelText}
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
