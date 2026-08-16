'use client'

import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ARTIFACTS } from '@/data/artifacts'
import { TABLETS } from '@/data/tablets'
import { COMBO_KO, COMBO_ORDER, TIER_KO } from '@/data/wikiLabels'
import type { ArtifactData, TabletData, Tier } from '@/types'
import Image from 'next/image'

const TIER_FILTERS: Array<{ label: string; value: 'all' | Tier }> = [
  { label: '전체', value: 'all' },
  { label: TIER_KO.common, value: 'common' },
  { label: TIER_KO.advanced, value: 'advanced' },
  { label: TIER_KO.rare, value: 'rare' },
  { label: TIER_KO.legend, value: 'legend' },
  { label: TIER_KO.solid, value: 'solid' },
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
        'relative flex aspect-square w-full cursor-grab items-center justify-center overflow-hidden rounded-inner border-2 bg-sephiria-cell active:cursor-grabbing',
        `border-tier-${artifact.tier}`,
        isDragging && 'opacity-40',
      )}
      title={`${artifact.label_kor} · ${TIER_KO[artifact.tier]}`}
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
        'relative flex aspect-square w-full cursor-grab items-center justify-center overflow-hidden rounded-inner border-2 bg-sephiria-cell active:cursor-grabbing',
        `border-tier-${tablet.tier}`,
        isDragging && 'opacity-40',
      )}
      title={`${tablet.ko_label} · ${TIER_KO[tablet.tier]}`}
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
  const [filterTier, setFilterTier] = useState<'all' | Tier>('all')
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
    if (filterSet === 'none') {
      if ((a.effect.sets ?? []).length > 0) return false
    } else if (filterSet !== 'all' && !(a.effect.sets ?? []).includes(filterSet)) {
      return false
    }
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
            {TIER_FILTERS.map((t) => (
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
              aria-label="콤보 필터"
            >
              <option value="all">전체 콤보</option>
              <option value="none">콤보 없음</option>
              {COMBO_ORDER.map((slug) => (
                <option key={slug} value={slug}>
                  {COMBO_KO[slug]}
                </option>
              ))}
            </select>
          )}

          <div className="max-h-80 overflow-y-auto">
            {tab === 'artifact' ? (
              filteredArtifacts.length === 0 ? (
                <p className="py-6 text-center text-xs text-sephiria-muted">검색 결과가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
                  {filteredArtifacts.map((artifact) => {
                    const scalable = artifact.level > 0
                    return (
                      <div key={artifact.id} className="flex min-w-0 flex-col items-stretch gap-1">
                        <ArtifactThumb artifact={artifact} level={getArtifactLevel(artifact)} />
                        {scalable ? (
                          <label className="flex items-center gap-0.5">
                            <span className="sr-only">{artifact.label_kor} 강화 레벨</span>
                            <span className="text-[9px] text-sephiria-muted" aria-hidden>
                              Lv
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={artifact.level}
                              value={getArtifactLevel(artifact)}
                              onChange={(e) => setArtifactLevel(artifact.id, Number(e.target.value), artifact.level)}
                              onClick={(e) => e.stopPropagation()}
                              title={`강화 레벨 (최대 ${artifact.level})`}
                              className="min-w-0 flex-1 rounded-ctl border border-sephiria-border bg-sephiria-cell py-0.5 text-center text-[10px] tabular-nums text-sephiria-fg focus:border-sephiria-accent focus:outline-none"
                            />
                          </label>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )
            ) : (
              filteredTablets.length === 0 ? (
                <p className="py-6 text-center text-xs text-sephiria-muted">검색 결과가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1.5">
                  {filteredTablets.map((tablet) => (
                    <TabletThumb key={tablet.value} tablet={tablet} />
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
