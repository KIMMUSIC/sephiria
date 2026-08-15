'use client'

import { useMemo, useState } from 'react'
import { ARTIFACTS } from '@/data/artifacts'
import { TABLETS } from '@/data/tablets'
import type { ItemType, VisionMatchResult } from '@/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export const LOW_CONFIDENCE = 0.18
export const LOW_MARGIN = 0.04

export function isLowConfidence(m: VisionMatchResult): boolean {
  if (!m.matchedValue) return false
  if (m.confidence < LOW_CONFIDENCE) return true
  const c = m.candidates
  if (c && c.length >= 2 && c[0].confidence - c[1].confidence < LOW_MARGIN) return true
  return false
}

function itemLabel(value: string | null, type: ItemType | null): string {
  if (!value) return '빈 칸'
  if (type === 'ARTIFACT') return ARTIFACTS.find((a) => a.value === value)?.label_kor ?? value
  if (type === 'TABLET') return TABLETS.find((t) => t.value === value)?.ko_label ?? value
  const a = ARTIFACTS.find((x) => x.value === value)
  if (a) return a.label_kor
  return TABLETS.find((t) => t.value === value)?.ko_label ?? value
}

function itemImage(value: string | null, type: ItemType | null): string | null {
  if (!value) return null
  if (type === 'ARTIFACT') return ARTIFACTS.find((a) => a.value === value)?.image ?? null
  if (type === 'TABLET') return TABLETS.find((t) => t.value === value)?.image ?? null
  return ARTIFACTS.find((a) => a.value === value)?.image
    ?? TABLETS.find((t) => t.value === value)?.image
    ?? null
}

interface RecognitionReviewProps {
  results: VisionMatchResult[]
  onChange: (next: VisionMatchResult[]) => void
  onApply: () => void
  onCancel: () => void
}

export function RecognitionReview({ results, onChange, onApply, onCancel }: RecognitionReviewProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<number | null>(null)

  const low = useMemo(() => results.filter(isLowConfidence), [results])
  const catalog = useMemo(() => {
    const q = query.trim().toLowerCase()
    const arts = ARTIFACTS.map((a) => ({
      value: a.value, type: 'ARTIFACT' as ItemType, label: a.label_kor, image: a.image,
    }))
    const tabs = TABLETS.map((t) => ({
      value: t.value, type: 'TABLET' as ItemType, label: t.ko_label, image: t.image,
    }))
    const all = [...arts, ...tabs]
    if (!q) return all.slice(0, 24)
    return all.filter((x) => x.label.toLowerCase().includes(q) || x.value.toLowerCase().includes(q)).slice(0, 40)
  }, [query])

  const patch = (index: number, next: Partial<VisionMatchResult>) => {
    onChange(results.map((r, i) => (i === index ? { ...r, ...next } : r)))
  }

  const applyChoice = (
    index: number,
    value: string | null,
    type: ItemType | null,
    rotation: 0 | 1 | 2 | 3 = 0,
    confidence = 1,
  ) => {
    patch(index, { matchedValue: value, type, rotation, confidence })
    setActive(null)
    setQuery('')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3 justify-center text-xs">
        <span className="text-green-400">매칭: {results.filter((r) => r.matchedValue).length}</span>
        <span className="text-yellow-400">낮은 신뢰도: {low.length}</span>
        <span className="text-gray-400">전체: {results.length}</span>
      </div>

      {low.length === 0 ? (
        <p className="text-[11px] text-gray-400 text-center">낮은 신뢰도 셀이 없습니다. 적용해도 됩니다.</p>
      ) : (
        <p className="text-[11px] text-yellow-400/80 text-center">
          낮은 신뢰도 셀을 다른 후보·검색·빈 칸으로 고칠 수 있습니다.
        </p>
      )}

      <div className="max-h-64 overflow-y-auto flex flex-col gap-1">
        {results.map((r, index) => {
          const lowCell = isLowConfidence(r)
          if (!lowCell && r.matchedValue) return null
          if (!lowCell && !r.matchedValue) return null
          const label = itemLabel(r.matchedValue, r.type)
          const img = itemImage(r.matchedValue, r.type)
          return (
            <div
              key={`${r.row}-${r.col}`}
              className={cn(
                'rounded px-2 py-1.5 text-[11px] flex flex-col gap-1',
                lowCell ? 'bg-yellow-900/25 border border-yellow-700/40' : 'bg-sephiria-cell',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-10">r{r.row}c{r.col}</span>
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt={label} className="w-5 h-5 object-contain" />
                )}
                <span className="text-gray-200 flex-1 truncate">{label}</span>
                <span className="text-gray-500">{Math.round(Math.max(0, r.confidence) * 100)}%</span>
                <button
                  className="text-[10px] text-gray-400 hover:text-white"
                  onClick={() => applyChoice(index, null, null, 0, 0)}
                >
                  빈 칸
                </button>
                <button
                  className="text-[10px] text-sephiria-accent hover:text-purple-300"
                  onClick={() => setActive(active === index ? null : index)}
                >
                  {active === index ? '닫기' : '수정'}
                </button>
              </div>

              {active === index && (
                <div className="flex flex-col gap-1.5 pl-10">
                  {r.candidates && r.candidates.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.candidates.map((c) => (
                        <button
                          key={`${c.value}-${c.rotation}`}
                          onClick={() => applyChoice(index, c.value, c.type, c.rotation, c.confidence)}
                          className="px-1.5 py-0.5 rounded bg-sephiria-grid text-[10px] text-gray-200 hover:bg-sephiria-accent"
                        >
                          {itemLabel(c.value, c.type)} ({Math.round(Math.max(0, c.confidence) * 100)}%)
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="이름 검색..."
                    className="w-full bg-sephiria-grid border border-sephiria-border rounded px-2 py-1 text-[11px] text-white"
                  />
                  <div className="max-h-28 overflow-y-auto flex flex-col gap-0.5">
                    {catalog.map((item) => (
                      <button
                        key={`${item.type}-${item.value}`}
                        onClick={() => applyChoice(index, item.value, item.type, 0, 1)}
                        className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-sephiria-grid text-left"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.image} alt="" className="w-4 h-4 object-contain" />
                        <span className="text-gray-200 truncate">{item.label}</span>
                        <span className="text-gray-500 text-[10px]">{item.type === 'TABLET' ? '석판' : '아티팩트'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onCancel}>다시</Button>
        <Button size="sm" className="flex-1" onClick={onApply}>그리드에 적용</Button>
      </div>
    </div>
  )
}
