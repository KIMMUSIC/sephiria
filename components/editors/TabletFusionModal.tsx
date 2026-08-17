'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { X, Search, Plus, RotateCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useInventoryStore } from '@/store/inventoryStore'
import { TABLETS, TABLET_MAP } from '@/data/tablets'
import { TIER_KO } from '@/data/wikiLabels'
import { calculateBoardEffects } from '@/lib/effectEngine'
import { activationConditionsOf, canRotate, isRotatable } from '@/lib/tabletMeta'
import { nextRotation } from '@/lib/rotationUtils'
import type { FusedSource, GridRow, GridSlot, PlacedTablet, TabletData } from '@/types'

interface TabletFusionModalProps {
  open: boolean
  onClose: () => void
}

const PREVIEW_SIZE = 5
const PREVIEW_CENTER = 2
const PREVIEW_ROWS: GridRow[] = Array.from({ length: PREVIEW_SIZE }, (_, i) => ({
  rowIndex: i,
  cols: PREVIEW_SIZE,
}))
const PREVIEW_CENTER_SLOT = PREVIEW_CENTER * PREVIEW_SIZE + PREVIEW_CENTER

const TIER_BORDER: Record<string, string> = {
  common: 'border-tier-common',
  advanced: 'border-tier-advanced',
  rare: 'border-tier-rare',
  legend: 'border-tier-legend',
  solid: 'border-tier-solid',
}

/**
 * 석판 합성 (Tablet Combiner) — two tablets become one that keeps both sets of effects.
 * Recognition cannot read a fused tablet off a screenshot, so the user builds it here.
 *
 * Two rules the user confirmed from the game:
 *  - A 합성 석판 may NOT be fused again, so only catalog tablets appear as materials.
 *  - A rotatable material may be turned before it is combined, so the same pair can
 *    produce different patterns.
 */
export function TabletFusionModal({ open, onClose }: TabletFusionModalProps) {
  const addFusedTablet = useInventoryStore((s) => s.addFusedTablet)

  const [picked, setPicked] = useState<FusedSource[]>([])
  const [name, setName] = useState('')
  const [search, setSearch] = useState('')

  const options = useMemo(
    () =>
      TABLETS.filter((t) =>
        search ? t.ko_label.includes(search) || t.value.includes(search.toLowerCase()) : true
      ),
    [search]
  )

  const preview = useMemo(() => {
    if (picked.length < 2) return null
    const data: TabletData = {
      value: 'fusion_preview',
      ko_label: '미리보기',
      eng_label: 'preview',
      tier: 'common',
      image: '',
    }
    const tablet: PlacedTablet = {
      instanceId: 'fusion_preview',
      type: 'TABLET',
      data,
      effectDef: { type: 'fused', sources: picked },
      rotation: 0,
      isCustom: false,
      fusedFrom: picked,
    }
    const slots: GridSlot[] = new Array(PREVIEW_SIZE * PREVIEW_SIZE).fill(null)
    slots[PREVIEW_CENTER_SLOT] = tablet
    return calculateBoardEffects(slots, PREVIEW_ROWS)
  }, [picked])

  const conditions = activationConditionsOf(picked)
  const rotatable = isRotatable(picked)
  const canFuse = picked.length === 2

  /** Append a material. The same tablet may be chosen twice — 차양끼리 합성 is a real recipe. */
  function pick(value: string) {
    setPicked((prev) => {
      const next: FusedSource = { value, rotation: 0 }
      return prev.length >= 2 ? [prev[1], next] : [...prev, next]
    })
  }

  function unpick(index: number) {
    setPicked((prev) => prev.filter((_, i) => i !== index))
  }

  function rotateMaterial(index: number) {
    setPicked((prev) =>
      prev.map((source, i) =>
        i === index && canRotate(source.value)
          ? { ...source, rotation: nextRotation(source.rotation) }
          : source
      )
    )
  }

  function labelOf(value: string): string {
    return TABLET_MAP.get(value)?.ko_label ?? value
  }

  function handleFuse() {
    const recipe = addFusedTablet(picked, name)
    if (!recipe) return
    setPicked([])
    setName('')
    onClose()
  }

  // Escape 와 바탕 클릭으로 닫힌다 — components/ui/modal.tsx 와 같은 규약.
  // 이 모달은 공통 Modal 을 쓰지 않고 자체 쉘을 가지고 있어
  // 둘 다 직접 달아 준다.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // 공용 Modal 과 같은 이유로 body 로 포털한다 — components/ui/modal.tsx 주석 참고.
  // 이 모달은 왜쪽 sticky 팔레트 열 안의 ItemPalette 에서 렌더되므로
  // 포털 없이는 그 열의 쌓임 맥락에 갇혀 그리드에 덮인다.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!open || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-sephiria-ink/30" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fusion-title"
        className="relative z-[60] flex max-h-full w-full max-w-[42rem] flex-col gap-4 overflow-y-auto rounded-shell border border-sephiria-border bg-sephiria-panel p-5 shadow-seph"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="fusion-title" className="text-base font-semibold text-sephiria-fg">
              석판 합성
            </h2>
            <p className="mt-0.5 max-w-[52ch] text-xs leading-relaxed text-sephiria-muted">
              두 석판을 합쳐 하나로 만듭니다. 합성 석판은 재료 두 석판의 증감 영역, 레벨 증감량,
              제약 무시 영역, 회전 제약, 배치 제약을 모두 계승하고, 같은 칸에 겹치는 값은 더해집니다
              (+와 −는 상쇄). 인식으로는 읽을 수 없어 여기서 직접 만들어 팔레트에 추가합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-sephiria-muted transition-colors duration-200 ease-seph hover:text-sephiria-fg"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-sephiria-muted"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="석판 이름 검색"
                className="w-full rounded-ctl border border-sephiria-border bg-sephiria-cell py-1.5 pl-6 pr-2 text-xs text-sephiria-fg placeholder:text-sephiria-muted focus:border-sephiria-accent focus:outline-none focus:ring-1 focus:ring-sephiria-accent"
              />
            </div>

            <div className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1.5 overflow-y-auto pr-1">
              {options.map((option) => {
                const count = picked.filter((p) => p.value === option.value).length
                return (
                  /*
                    정사각 비율을 버튼이 아니라 래퍼 div 가 든다.
                    <button> 을 그리드 아이템으로 두면 aspect-ratio 로 유도된 높이가
                    행 크기 계산에 전달되지 않는다 — 버튼은 54px 로 그려지는데 행은
                    글자 높이(19.5px)로 잡혀서 아이템이 다음 행을 덮고 스프라이트가 겹쳐
                    보였다. alignSelf/display 조정으로는 바뀌지 않고 래퍼만 효과가 있다
                    (팔레트의 썸네일은 div 라 원래 멀줦했다).
                  */
                  <div key={option.value} className="relative aspect-square w-full">
                  <button
                    type="button"
                    onClick={() => pick(option.value)}
                    aria-pressed={count > 0}
                    title={`${option.ko_label} · ${TIER_KO[option.tier]}${option.rotate ? ' · 회전 가능' : ' · 회전 불가'}`}
                    className={cn(
                      'absolute inset-0 flex items-center justify-center overflow-hidden rounded-inner border-2 bg-sephiria-cell transition-transform duration-200 ease-seph active:scale-[0.98]',
                      TIER_BORDER[option.tier] ?? 'border-sephiria-border',
                      count > 0 && 'ring-2 ring-sephiria-accent'
                    )}
                  >
                    {option.image ? (
                      <Image
                        src={option.image}
                        alt={option.ko_label}
                        fill
                        className="object-contain p-0.5"
                        unoptimized
                      />
                    ) : (
                      <span className="px-0.5 text-center text-[8px] leading-tight text-sephiria-muted">
                        {option.ko_label}
                      </span>
                    )}
                    {count > 0 && (
                      <span className="absolute left-0 top-0 rounded-br bg-sephiria-accent px-1 text-[8px] font-bold leading-tight text-sephiria-bg">
                        ×{count}
                      </span>
                    )}
                  </button>
                  </div>
                )
              })}
            </div>

            <div className="flex items-stretch gap-1.5">
              {[0, 1].map((index) => {
                const source = picked[index]
                const turnable = source ? canRotate(source.value) : false
                return (
                  <div
                    key={index}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-1 rounded-ctl border px-2 py-1 text-[10px]',
                      source
                        ? 'border-sephiria-accent bg-sephiria-accent-soft text-sephiria-accent-fg'
                        : 'border-dashed border-sephiria-border text-sephiria-muted'
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {source ? labelOf(source.value) : `재료 ${index + 1}`}
                    </span>
                    {source && (
                      <>
                        <button
                          type="button"
                          onClick={() => rotateMaterial(index)}
                          disabled={!turnable}
                          aria-label={`재료 ${index + 1} 회전`}
                          title={turnable ? '재료를 돌려서 합성' : '회전 불가 석판'}
                          className="flex shrink-0 items-center gap-0.5 rounded-ctl px-1 py-0.5 tabular-nums transition-colors duration-200 ease-seph hover:bg-sephiria-panel disabled:opacity-40"
                        >
                          <RotateCw size={10} />
                          {turnable ? `${source.rotation * 90}°` : '고정'}
                        </button>
                        <button
                          type="button"
                          onClick={() => unpick(index)}
                          aria-label={`재료 ${index + 1} 비우기`}
                          className="shrink-0 transition-colors duration-200 ease-seph hover:text-sephiria-debuff-fg"
                        >
                          <X size={10} />
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            <p className="text-[10px] leading-snug text-sephiria-muted">
              재료 2개를 고르세요. 같은 석판을 두 번 눌러 같은 석판끼리도 합칠 수 있고,
              등급이 다른 조합도 가능합니다. 회전 가능한 재료는 돌려서 합성할 수 있습니다.
              <br />
              합성 석판은 다시 재료로 쓸 수 없어 목록에 나오지 않습니다.
            </p>
          </div>

          <div className="flex flex-col items-center gap-2">
            <span className="text-[10px] font-medium text-sephiria-muted">합성 결과 미리보기</span>
            <div className="flex flex-col gap-1">
              {Array.from({ length: PREVIEW_SIZE }, (_, row) => (
                <div key={row} className="flex gap-1">
                  {Array.from({ length: PREVIEW_SIZE }, (_, col) => {
                    const key = `${row}-${col}`
                    const isCenter = row === PREVIEW_CENTER && col === PREVIEW_CENTER
                    const value = preview?.effects[key] ?? 0
                    const waives = preview?.constraintIgnore.has(key) ?? false
                    return (
                      <div
                        key={col}
                        className={cn(
                          'flex h-9 w-9 flex-col items-center justify-center rounded-inner border text-[10px] font-bold leading-none tabular-nums',
                          isCenter
                            ? 'border-sephiria-gold bg-sephiria-confirm text-sephiria-gold'
                            : value > 0
                            ? 'border-sephiria-buff-fg/40 bg-sephiria-buff text-sephiria-buff-fg'
                            : value < 0
                            ? 'border-sephiria-debuff-fg/40 bg-sephiria-debuff text-sephiria-debuff-fg'
                            : 'border-sephiria-border bg-sephiria-cell text-sephiria-muted'
                        )}
                      >
                        {isCenter ? (
                          '석판'
                        ) : (
                          <>
                            <span>{value > 0 ? `+${value}` : value < 0 ? value : ''}</span>
                            {waives && (
                              <span className="text-[7px] font-semibold text-sephiria-accent-fg">
                                무시
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            <p className="max-w-[12rem] text-center text-[9px] leading-snug text-sephiria-muted">
              위치 조건이 있는 석판(선의·차양·정의·깃발)과 행/열 전체 석판은 실제 인벤 위치에서만
              발동하므로 이 미리보기에는 나타나지 않습니다.
            </p>
          </div>
        </div>

        {picked.length === 2 && (
          <div className="flex flex-wrap items-center gap-2 rounded-inner bg-sephiria-grid px-3 py-2 text-[10px]">
            <span className="text-sephiria-muted">계승:</span>
            <span
              className={cn(
                'rounded-ctl px-2 py-0.5 font-medium',
                rotatable
                  ? 'bg-sephiria-buff text-sephiria-buff-fg'
                  : 'bg-sephiria-debuff text-sephiria-debuff-fg'
              )}
            >
              {rotatable ? '회전 가능' : '회전 불가'}
            </span>
            {conditions.length > 0 ? (
              conditions.map((c) => (
                <span
                  key={c}
                  className="rounded-ctl bg-sephiria-confirm px-2 py-0.5 font-medium text-sephiria-confirm-fg"
                >
                  배치 제약 · {c}
                </span>
              ))
            ) : (
              <span className="rounded-ctl bg-sephiria-cell px-2 py-0.5 text-sephiria-muted">
                배치 제약 없음
              </span>
            )}
            <span className="text-sephiria-muted">
              재료:{' '}
              {picked
                .map((s) => `${labelOf(s.value)}${s.rotation ? ` ${s.rotation * 90}°` : ''}`)
                .join(' + ')}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="fusion-name" className="text-xs text-sephiria-muted">
            합성 석판 이름
          </label>
          <input
            id="fusion-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              picked.length === 2 ? picked.map((s) => labelOf(s.value)).join('+') : '이름을 지어 주세요'
            }
            className="rounded-ctl border border-sephiria-border bg-sephiria-cell px-3 py-1.5 text-sm text-sephiria-fg placeholder:text-sephiria-muted focus:border-sephiria-accent focus:outline-none focus:ring-1 focus:ring-sephiria-accent"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" onClick={handleFuse} disabled={!canFuse}>
            <Plus size={14} className="mr-1" />
            합성해서 팔레트에 추가
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
