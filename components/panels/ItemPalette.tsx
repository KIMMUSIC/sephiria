'use client'

import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ARTIFACTS, ARTIFACT_SETS } from '@/data/artifacts'
import { TABLETS } from '@/data/tablets'
import type { ArtifactData, TabletData, Tier } from '@/types'
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

// ── Draggable Artifact Thumb ──
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
        'relative w-12 h-12 rounded border-2 bg-sephiria-cell cursor-grab active:cursor-grabbing overflow-hidden flex items-center justify-center',
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
        <span className="text-[8px] text-gray-400 text-center leading-tight px-0.5 break-words">
          {artifact.label_kor}
        </span>
      )}
      {/* Level badge */}
      <div className="absolute bottom-0 right-0 bg-black/70 text-gray-200 text-[9px] px-0.5 rounded-tl leading-tight">
        {level}
      </div>
    </div>
  )
}

// ── Draggable Tablet Thumb ──
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
        'relative w-12 h-12 rounded border-2 bg-sephiria-cell cursor-grab active:cursor-grabbing overflow-hidden flex items-center justify-center',
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
        <span className="text-[8px] text-gray-400 text-center leading-tight px-0.5 break-words">
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
  // Per-artifact level inputs
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
    <div className="bg-sephiria-panel border border-sephiria-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-sephiria-grid transition-colors"
      >
        <span className="text-white font-semibold text-sm">아이템 팔레트</span>
        {collapsed ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronUp size={16} className="text-gray-400" />}
      </button>

      {!collapsed && (
        <div className="p-3 flex flex-col gap-3">
          {/* Tabs */}
          <div className="flex gap-1">
            {(['artifact', 'tablet'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'px-3 py-1 text-xs rounded font-medium transition-colors',
                  tab === t
                    ? 'bg-sephiria-accent text-white'
                    : 'bg-sephiria-cell text-gray-400 hover:text-white',
                )}
              >
                {t === 'artifact' ? '아티팩트' : '석판'}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이름 검색..."
              className="w-full bg-sephiria-cell border border-sephiria-border rounded px-6 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-sephiria-accent"
            />
          </div>

          {/* Tier filters */}
          <div className="flex flex-wrap gap-1">
            {TIERS.map((t) => (
              <button
                key={t.value}
                onClick={() => setFilterTier(t.value)}
                className={cn(
                  'px-2 py-0.5 text-[10px] rounded font-medium transition-colors flex items-center gap-1',
                  filterTier === t.value
                    ? 'bg-sephiria-accent text-white'
                    : 'bg-sephiria-cell text-gray-400 hover:text-white border border-sephiria-border',
                )}
              >
                {t.value !== 'all' && (
                  <span className={cn('w-1.5 h-1.5 rounded-full', TIER_DOT[t.value])} />
                )}
                {t.label}
              </button>
            ))}
          </div>

          {/* Set filter (artifacts only) */}
          {tab === 'artifact' && (
            <select
              value={filterSet}
              onChange={(e) => setFilterSet(e.target.value)}
              className="bg-sephiria-cell border border-sephiria-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-sephiria-accent"
            >
              <option value="all">전체 세트</option>
              {ARTIFACT_SETS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}

          {/* Item grid */}
          <div className="max-h-64 overflow-y-auto">
            {tab === 'artifact' ? (
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
                      className="w-12 bg-sephiria-cell border border-sephiria-border rounded text-center text-[10px] text-white py-0.5 focus:outline-none focus:border-sephiria-accent"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {filteredTablets.map((tablet) => (
                  <div key={tablet.value} className="flex flex-col items-center">
                    <TabletThumb tablet={tablet} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
