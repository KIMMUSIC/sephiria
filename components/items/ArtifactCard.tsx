'use client'

import Image from 'next/image'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isArtifactDestroyed } from '@/lib/optimizerScore'
import { artifactLevelState, artifactLevelText, wastedLevels } from '@/lib/levelDisplay'
import type { PlacedArtifact } from '@/types'

interface ArtifactCardProps {
  artifact: PlacedArtifact
  size?: 'sm' | 'md'
  showLevel?: boolean
  /**
   * 이 칸에서 받는 레벨 델타 (석판 몴 + 칸 레벨).
   *
   * artifact.currentLevel 은 별 상한에서 잘린 값이라 7/5 같은 초과를
   * 표현할 수 없다. 그래서 그리드가 매 렌더마다 새로 계산한 델타를
   * 넣어 주면 여기서 자르지 않은 레벨을 만든다. 드래그 미리보기처럼
   * currentLevel 이 아직 반영되지 않은 순간에도 이쪽이 정확하다.
   * 안 넘기면 currentLevel 을 그대로 쓴다(예전 동작).
   */
  levelDelta?: number
}

const TIER_BORDER: Record<string, string> = {
  common: 'border-tier-common',
  advanced: 'border-tier-advanced',
  rare: 'border-tier-rare',
  legend: 'border-tier-legend',
  solid: 'border-tier-solid',
}

export default function ArtifactCard({
  artifact,
  size = 'md',
  showLevel = true,
  levelDelta,
}: ArtifactCardProps) {
  const { data, level, currentLevel, isLocked } = artifact
  const isDestroyed = isArtifactDestroyed(currentLevel)
  // 인게임과 같은 `현재/최대` 표기. 별은 레벨 상한이지만(finalLevelOf 가
  // 거기서 자른다) 배지는 자르기 전 값을 보여 초과를 드러낸다.
  const maxLevel = data.level ?? 0
  const shownLevel = levelDelta === undefined ? currentLevel : level + levelDelta
  const levelState = artifactLevelState(shownLevel, maxLevel)
  const levelText = artifactLevelText(shownLevel, maxLevel)
  const wasted = wastedLevels(shownLevel, maxLevel)

  const LEVEL_TITLE: Record<typeof levelState, string> = {
    destroyed: `레벨 ${shownLevel} — -1 이하라 효과가 무효입니다`,
    over: `상한 초과 ${levelText} — ${wasted} 만큼은 버려집니다`,
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
            // 초과는 풀강과 다른 색이다. 효과는 채워졌지만 낭비가 있으니
            // 석판을 옮길 자리라는 뜻으로 '주의' 색(confirm)을 쓴다.
            levelState === 'over' && 'bg-sephiria-confirm text-sephiria-confirm-fg',
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
