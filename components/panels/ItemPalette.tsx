'use client'

import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ARTIFACTS, ARTIFACT_SETS } from '@/data/artifacts'
import { TABLETS } from '@/data/tablets'
import type { ArtifactData, TabletData } from '@/types'
import Image from 'next/image'

const TIERS: Array<{ label: string; value: string }> = [
  { label: '전체', value: 'all' },
  { label: '커먼', value: 'common' },
  { label: '어드밴스드', value: 'advanced' },
  { label: '레어', value: 'rare' },
  { label: '레전드', value: 'legend' },
  { label: '솔리드', value: 'solid' },
]

const TIER_DOT: Record<string, string> = {
  common: 'bg-tier-common',
  advanced: 'bg-tier-advanced',
  rare: 'bg-tier-rare',
  legend: 'bg-tier-legend',
  solid: 'bg-tier-solid',
}

function ArtifactThumb({ artifact, level }: { artifact: ArtifactData; level: number }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `palette-artifact-${artifact.id}`,
    data: {
      source: 'palette',
      itemType: 'ARTIFACT',
      itemData: artifact,
      level,
    },
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'relative flex h-12 w-12 cursor-grab items-center justify-center overflow-hidden rounded-inner border-2 bg-sephiria-cell active:cursor-grabbing',
        `border-tier-${artifact.tier}`,
        isDragging && 'opacity-40',
      )}
      title={artifact.label_kor}
    >
      {artifact.image ? (
        <Image
          src={artifact.image}
          alt={artifact.label_kor}
          fill
          className="object-contain p-0.5"
          unoptimized
        />
      ) : (
        <span className="break-words px-0.5 text-center text-[8px] leading-tight text-sephiria-muted">
          {artifact.label_kor}
        </span>
      )}
      <div className="absolute bottom-0 right-0 rounded-tl bg-sephiria-ink/75 px-0.5 text-[9px] leading-tight tabular-nums text-sephiria-bg">
        {level}
      </div>
    </div>
  )
}

function TabletThumb({ tablet }: { tablet: TabletData }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `palette-tablet-${tablet.value}`,
    data: {
      source: 'palette',
      itemType: 'TABLET',
      itemData: tablet,
    },
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'relative flex h-12 w-12 cursor-grab items-center justify-center overflow-hidden rounded-inner border-2 bg-sephiria-cell active:cursor-grabbing',
        `border-tier-${tablet.tier}`,
        isDragging && 'opacity-40',
      )}
      title={tablet.ko_label}
    >
      {tablet.image ? (
        <Image
          src={tablet.image}
          alt={tablet.ko_label}
          fill
          className="object-contain p-0.5"
          unoptimized
        />
      ) : (
        <span className="break-words px-0.5 text-center text-[8px] leading-tight text-sephiria-muted">
          {tablet.ko_label}
        </span>
      )}
    </div>
  )
}

export function ItemPalette() {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<'artifact' | 'tablet'>('artifact')
  const [search, setSearch] = useState('')
  const [filterTier, setFilterTier] = useState<string>('all')
  const [filterSet, setFilterSet] = useState<string>('all')
  const [levelMap, setLevelMap] = useState<Record<number, number>>({})

  function getArtifactLevel(artifact: ArtifactData): number {
    return levelMap[artifact.id] ?? artifact.level
  }

  function setArtifactLevel(id: number, val: number, maxLevel: number) {
    setLevelMap((prev) => ({ ...prev, [id]: Math.max(0, Math.min(maxLevel, val)) }))
  }

  const filteredArtifacts = ARTIFACTS.filter((a) => {
    if (search && !a.label_kor.includes(search) && !a.label_eng.toLowerCase().includes(search.toLowerCase())) return false
    if (filterTier !== 'all' && a.tier !== filterTier) return false
    if (filterSet !== 'all' && !a.effect.sets.includes(filterSet)) return false
    return true
  })

  const filteredTablets = TABLETS.filter((t) => {
    if (search && !t.ko_label.includes(search) && !t.eng_label.toLowerCase().includes(search.toLowerCase())) return false
    if (filterTier !== 'all' && t.tier !== filterTier) return false
    return true
  })

  return (
    <section className="overflow-hidden rounded-shell border border-sephiria-border bg-sephiria-panel">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold text-sephiria-fg transition-colors duration-200 ease-seph hover:bg-sephiria-grid/60"
      >
        <span>아이템 팔레트</span>
        <ChevronDown
          size={16}
          className={cn(
            'text-sephiria-muted transition-transform duration-200 ease-seph',
            collapsed ? '' : 'rotate-180'
          )}
        />
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-3 border-t border-sephiria-border p-3">
          <div className="flex gap-1">
            {(['artifact', 'tablet'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-ctl px-3 py-1 text-xs font-medium transition-colors duration-200 ease-seph',
                  tab === t
                    ? 'bg-sephiria-accent-soft text-sephiria-accent-fg'
                    : 'bg-sephiria-cell text-sephiria-muted hover:text-sephiria-fg',
                )}
              >
                {t === 'artifact' ? '아티팩트' : '석판'}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-sephiria-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이름 검색"
              className="w-full rounded-ctl border border-sephiria-border bg-sephiria-cell py-1 pl-6 pr-2 text-xs text-sephiria-fg placeholder:text-sephiria-muted focus:border-sephiria-accent focus:outline-none focus:ring-1 focus:ring-sephiria-accent"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {TIERS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setFilterTier(t.value)}
                className={cn(
                  'flex items-center gap-1 rounded-ctl px-2 py-0.5 text-[10px] font-medium transition-colors duration-200 ease-seph',
                  filterTier === t.value
                    ? 'bg-sephiria-accent-soft text-sephiria-accent-fg'
                    : 'border border-sephiria-border bg-sephiria-cell text-sephiria-muted hover:text-sephiria-fg',
                )}
              >
                {t.value !== 'all' && (
                  <span className={cn('h-1.5 w-1.5 rounded-full', TIER_DOT[t.value])} />
                )}
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'artifact' && (
            <select
              value={filterSet}
              onChange={(e) => setFilterSet(e.target.value)}
              className="rounded-ctl border border-sephiria-border bg-sephiria-cell px-2 py-1 text-xs text-sephiria-fg focus:border-sephiria-accent focus:outline-none"
            >
              <option value="all">전체 세트</option>
              {ARTIFACT_SETS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}

          <div className="max-h-64 overflow-y-auto">
            {tab === 'artifact' ? (
              filteredArtifacts.length === 0 ? (
                <p className="py-6 text-center text-xs text-sephiria-muted">검색 결과가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {filteredArtifacts.map((artifact) => (
                    <div key={artifact.id} className="flex flex-col items-center gap-1">
                      <ArtifactThumb artifact={artifact} level={getArtifactLevel(artifact)} />
                      <input
                        type="number"
                        min={0}
                        max={artifact.level}
                        value={getArtifactLevel(artifact)}
                        onChange={(e) => setArtifactLevel(artifact.id, Number(e.target.value), artifact.level)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-12 rounded-ctl border border-sephiria-border bg-sephiria-cell py-0.5 text-center text-[10px] tabular-nums text-sephiria-fg focus:border-sephiria-accent focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              )
            ) : (
              filteredTablets.length === 0 ? (
                <p className="py-6 text-center text-xs text-sephiria-muted">검색 결과가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {filteredTablets.map((tablet) => (
                    <div key={tablet.value} className="flex flex-col items-center">
                      <TabletThumb tablet={tablet} />
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </section>
  )
}
