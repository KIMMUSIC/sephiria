'use client'

import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ARTIFACTS, ARTIFACT_MAP } from '@/data/artifacts'
import { TABLETS, TABLET_MAP } from '@/data/tablets'
import { useInventoryStore, type CellRecognitionMeta } from '@/store/inventoryStore'
import type { ItemType } from '@/types'
import { cn } from '@/lib/utils'

function labelOf(value: string, type: ItemType | null): string {
  if (type === 'ARTIFACT') return ARTIFACT_MAP.get(value)?.label_kor ?? value
  if (type === 'TABLET') return TABLET_MAP.get(value)?.ko_label ?? value
  return (
    ARTIFACT_MAP.get(value)?.label_kor ??
    TABLET_MAP.get(value)?.ko_label ??
    value
  )
}

function imageOf(value: string, type: ItemType | null): string | null {
  if (type === 'ARTIFACT') return ARTIFACT_MAP.get(value)?.image ?? `/images/artifacts/${value}.png`
  if (type === 'TABLET') return TABLET_MAP.get(value)?.image ?? `/images/slabs/${value}.png`
  return ARTIFACT_MAP.get(value)?.image ?? TABLET_MAP.get(value)?.image ?? null
}

function Thumb({
  value,
  type,
  label,
  score,
  rotation = 0,
  onClick,
}: {
  value: string
  type: ItemType
  label: string
  score?: number
  rotation?: 0 | 1 | 2 | 3
  onClick: () => void
}) {
  const src = imageOf(value, type)
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-[88px] flex-col items-center gap-1 rounded-inner border border-sephiria-border bg-sephiria-cell p-1.5 transition-colors duration-200 ease-seph hover:border-sephiria-accent"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={label}
          className="h-12 w-12 object-contain"
          style={{
            transform: `rotate(${rotation * 90}deg)`,
            transformOrigin: 'center',
          }}
        />
      ) : (
        <div className="h-12 w-12" />
      )}
      <span className="line-clamp-2 w-full text-center text-[10px] leading-tight text-sephiria-fg">
        {label}
      </span>
      {score != null && (
        <span className="text-[9px] tabular-nums text-sephiria-muted">{score.toFixed(3)}</span>
      )}
    </button>
  )
}

export function CellConfirmPicker() {
  const pickerSlot = useInventoryStore((s) => s.pickerSlot)
  const recognitionMeta = useInventoryStore((s) => s.recognitionMeta)
  const setPickerSlot = useInventoryStore((s) => s.setPickerSlot)
  const overrideRecognizedCell = useInventoryStore((s) => s.overrideRecognizedCell)
  const [query, setQuery] = useState('')

  const meta: CellRecognitionMeta | undefined =
    pickerSlot == null ? undefined : recognitionMeta[pickerSlot]

  const candidates = useMemo(() => {
    if (!meta) return []
    if (meta.candidates && meta.candidates.length > 0) return meta.candidates.slice(0, 3)
    if (meta.matchedValue && meta.type) {
      return [
        {
          value: meta.matchedValue,
          type: meta.type,
          rotation: meta.rotation,
          score: meta.confidence,
        },
      ]
    }
    return []
  }, [meta])

  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const arts = ARTIFACTS.filter(
      (a) =>
        a.label_kor.toLowerCase().includes(q) ||
        a.value.toLowerCase().includes(q) ||
        a.label_eng.toLowerCase().includes(q)
    ).slice(0, 8)
    const tabs = TABLETS.filter(
      (t) =>
        t.ko_label.toLowerCase().includes(q) ||
        t.value.toLowerCase().includes(q) ||
        t.eng_label.toLowerCase().includes(q)
    ).slice(0, 8)
    return [
      ...arts.map((a) => ({ value: a.value, type: 'ARTIFACT' as ItemType, label: a.label_kor })),
      ...tabs.map((t) => ({ value: t.value, type: 'TABLET' as ItemType, label: t.ko_label })),
    ].slice(0, 12)
  }, [query])

  if (pickerSlot == null) return null

  return (
    <Modal
      open
      onClose={() => {
        setQuery('')
        setPickerSlot(null)
      }}
      title={`칸 ${pickerSlot + 1} 확인`}
      className="w-[min(420px,92vw)]"
    >
      <div className="flex flex-col gap-3">
        {meta && (
          <p className="text-[11px] text-sephiria-muted">
            {meta.matchedValue
              ? `현재: ${labelOf(meta.matchedValue, meta.type)} · 점수 ${meta.confidence.toFixed(3)}`
              : '현재: 빈 칸'}
            {meta.lowConfidence && !meta.overridden && (
              <span className="ml-2 text-sephiria-confirm-fg">확인 필요</span>
            )}
          </p>
        )}

        {candidates.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] text-sephiria-muted">후보</p>
            <div className="flex flex-wrap gap-2">
              {candidates.map((c) => (
                <Thumb
                  key={`${c.value}-${c.rotation}`}
                  value={c.value}
                  type={c.type}
                  label={labelOf(c.value, c.type)}
                  score={c.score}
                  rotation={c.rotation}
                  onClick={() => {
                    overrideRecognizedCell(pickerSlot, {
                      value: c.value,
                      type: c.type,
                      rotation: c.rotation,
                    })
                    setQuery('')
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            overrideRecognizedCell(pickerSlot, null)
            setQuery('')
          }}
        >
          비우기
        </Button>

        <div>
          <p className="mb-1.5 text-[11px] text-sephiria-muted">카탈로그 검색</p>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 검색"
            autoFocus
          />
          {searchHits.length > 0 && (
            <div className="mt-2 flex max-h-48 flex-col gap-0.5 overflow-y-auto">
              {searchHits.map((h) => (
                <button
                  key={`${h.type}-${h.value}`}
                  type="button"
                  className={cn(
                    'flex items-center gap-2 rounded-ctl px-2 py-1 text-left text-[12px]',
                    'text-sephiria-fg hover:bg-sephiria-grid'
                  )}
                  onClick={() => {
                    overrideRecognizedCell(pickerSlot, {
                      value: h.value,
                      type: h.type,
                      rotation: 0,
                    })
                    setQuery('')
                  }}
                >
                  {imageOf(h.value, h.type) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageOf(h.value, h.type)!}
                      alt=""
                      className="h-6 w-6 object-contain"
                    />
                  )}
                  <span className="flex-1 truncate">{h.label}</span>
                  <span className="text-[10px] text-sephiria-muted">
                    {h.type === 'ARTIFACT' ? '아티팩트' : '석판'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
