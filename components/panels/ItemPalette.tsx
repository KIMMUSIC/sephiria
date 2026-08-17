'use client'

import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ChevronDown, Search, Combine, Minus, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ARTIFACTS } from '@/data/artifacts'
import { TABLETS } from '@/data/tablets'
import { COMBO_KO, COMBO_ORDER, TIER_KO } from '@/data/wikiLabels'
import { useInventoryStore } from '@/store/inventoryStore'
import { TabletFusionModal } from '@/components/editors/TabletFusionModal'
import type { ArtifactData, FusedTabletRecipe, TabletData, Tier } from '@/types'
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

function FusedTabletThumb({ recipe }: { recipe: FusedTabletRecipe }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `palette-fused-${recipe.data.value}`,
    data: {
      source: 'palette',
      itemType: 'TABLET',
      itemData: recipe.data,
      fusedRecipe: recipe,
    },
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'relative flex aspect-square w-full cursor-grab items-center justify-center overflow-hidden rounded-inner border-2 bg-sephiria-cell active:cursor-grabbing',
        `border-tier-${recipe.data.tier}`,
        isDragging && 'opacity-40',
      )}
      title={`${recipe.data.ko_label} · 합성 석판`}
    >
      {recipe.data.image ? (
        <Image
          src={recipe.data.image}
          alt={recipe.data.ko_label}
          fill
          className="object-contain p-0.5 opacity-80"
          unoptimized
        />
      ) : null}
      <span className="absolute inset-x-0 bottom-0 truncate bg-sephiria-ink/70 px-0.5 text-center text-[7px] leading-tight text-sephiria-bg">
        {recipe.data.ko_label}
      </span>
      <span className="absolute left-0 top-0 rounded-br bg-sephiria-gold px-0.5 text-[7px] font-bold leading-tight text-sephiria-ink">
        합성
      </span>
    </div>
  )
}

export function ItemPalette() {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<'artifact' | 'tablet'>('artifact')
  const [search, setSearch] = useState('')
  const [filterTier, setFilterTier] = useState<'all' | Tier>('all')
  const [filterSet, setFilterSet] = useState<string>('all')
  const [defaultEnchant, setDefaultEnchant] = useState(0)
  const [fusionOpen, setFusionOpen] = useState(false)

  const fusedTablets = useInventoryStore((s) => s.fusedTablets)
  const removeFusedTablet = useInventoryStore((s) => s.removeFusedTablet)

  /**
   * 인챈트 a newly dragged artifact starts at. Every artifact begins at 0 in game —
   * "기본 레벨은 0이고 인챈트와 석판의 효과로 현재 레벨을 상한까지 올릴 수 있다"
   * (namu.wiki/w/세피리아/아티팩트) — and createArtifact clamps this to each
   * artifact's own star cap. Per-artifact editing lives in the 아티팩트 목록 panel;
   * a numeric input under all 267 thumbnails broke the catalog grid for a value
   * that is almost always 0.
   */
  const MAX_ENCHANT = 14

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
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex w-fit items-center gap-2 rounded-ctl bg-sephiria-grid px-2 py-1"
                title="여기서 꺼낸 아티팩트가 시작할 인챈트 횟수입니다. 아티팩트마다 별 상한까지만 적용됩니다."
              >
                <span className="text-[11px] text-sephiria-muted">기본 인챈트</span>
                <button
                  type="button"
                  onClick={() => setDefaultEnchant((v) => Math.max(0, v - 1))}
                  disabled={defaultEnchant <= 0}
                  aria-label="기본 인챈트 감소"
                  className="flex h-5 w-5 items-center justify-center rounded-ctl border border-sephiria-border bg-sephiria-panel text-sephiria-fg transition-colors duration-200 ease-seph hover:bg-sephiria-cell disabled:opacity-40"
                >
                  <Minus size={10} />
                </button>
                <span className="w-5 text-center text-xs font-medium tabular-nums text-sephiria-fg">
                  {defaultEnchant}
                </span>
                <button
                  type="button"
                  onClick={() => setDefaultEnchant((v) => Math.min(MAX_ENCHANT, v + 1))}
                  disabled={defaultEnchant >= MAX_ENCHANT}
                  aria-label="기본 인챈트 증가"
                  className="flex h-5 w-5 items-center justify-center rounded-ctl border border-sephiria-border bg-sephiria-panel text-sephiria-fg transition-colors duration-200 ease-seph hover:bg-sephiria-cell disabled:opacity-40"
                >
                  <Plus size={10} />
                </button>
              </div>
              <span className="text-[10px] text-sephiria-muted">
                배치 후에는 아티팩트 목록에서 개별로 조정합니다
              </span>
            </div>
          )}

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

          {/* 자체 스크롤 없음 — 왼쪽 열(app/page.tsx)이 sticky + overflow-y-auto 로 대신 스크롤한다. */}
          <div>
            {tab === 'artifact' ? (
              filteredArtifacts.length === 0 ? (
                <p className="py-6 text-center text-xs text-sephiria-muted">검색 결과가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
                  {filteredArtifacts.map((artifact) => (
                    <ArtifactThumb key={artifact.id} artifact={artifact} level={defaultEnchant} />
                  ))}
                </div>
              )
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-sephiria-fg">합성 석판</span>
                    <button
                      type="button"
                      onClick={() => setFusionOpen(true)}
                      className="flex items-center gap-1 rounded-ctl border border-sephiria-border px-2 py-0.5 text-[10px] font-medium text-sephiria-fg transition-colors duration-200 ease-seph hover:bg-sephiria-grid active:scale-[0.98]"
                    >
                      <Combine size={11} />
                      석판 합성
                    </button>
                  </div>
                  {fusedTablets.length === 0 ? (
                    <p className="rounded-inner bg-sephiria-grid px-2 py-1.5 text-[10px] leading-snug text-sephiria-muted">
                      게임에서 석판 조합기로 합친 석판은 인식으로 읽을 수 없습니다.
                      직접 만들어 두면 팔레트에서 꺼내 쓸 수 있습니다.
                    </p>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1.5">
                      {fusedTablets.map((recipe) => (
                        <div key={recipe.data.value} className="flex flex-col gap-0.5">
                          <FusedTabletThumb recipe={recipe} />
                          <button
                            type="button"
                            onClick={() => removeFusedTablet(recipe.data.value)}
                            aria-label={`${recipe.data.ko_label} 삭제`}
                            className="flex items-center justify-center rounded-ctl py-0.5 text-sephiria-muted transition-colors duration-200 ease-seph hover:bg-sephiria-grid hover:text-sephiria-debuff-fg"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {filteredTablets.length === 0 ? (
                  <p className="py-6 text-center text-xs text-sephiria-muted">검색 결과가 없습니다.</p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1.5">
                    {filteredTablets.map((tablet) => (
                      <TabletThumb key={tablet.value} tablet={tablet} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <TabletFusionModal open={fusionOpen} onClose={() => setFusionOpen(false)} />
    </section>
  )
}
