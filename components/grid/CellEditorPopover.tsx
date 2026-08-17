'use client'

import { useEffect, useMemo, useRef } from 'react'
import Image from 'next/image'
import {
  Lock,
  Minus,
  Plus,
  Replace,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useInventoryStore } from '@/store/inventoryStore'
import { evaluateBoardDetail } from '@/lib/optimizerScore'
import { CONSTRAINT_LABEL, constraintText } from '@/lib/constraints'
import { TIER_KO } from '@/data/wikiLabels'
import type { ArtifactPriority, PlacedArtifact, PlacedTablet } from '@/types'

/** ArtifactListPanel 의 우선순위 컨트롤과 같은 문구/힌트 — 두 UI 가 항상 같은 말을 하게 유지한다. */
const PRIORITY_OPTIONS: Array<{ value: ArtifactPriority; label: string; hint: string }> = [
  {
    value: 'high',
    label: '높음',
    hint: '이 아이템의 목표를 가장 먼저 채웁니다. 목표를 지정하지 않으면 풀강을 목표로 봅니다',
  },
  { value: 'normal', label: '보통', hint: '기본값 — 전체 최적 배치를 따릅니다' },
  {
    value: 'exclude',
    label: '제외',
    hint: '세트 효과만 받으면 충분한 아이템. 강화는 다른 아이템에 양보합니다',
  },
]

const TIER_BORDER: Record<string, string> = {
  common: 'border-tier-common',
  advanced: 'border-tier-advanced',
  rare: 'border-tier-rare',
  legend: 'border-tier-legend',
  solid: 'border-tier-solid',
}

/**
 * 칸 레벨 툴팁. 칸 레벨은 석판 효과가 아니라 칸에 각인된 값이다:
 *   "인벤토리가 -12칸 줄어들지만, '석판 각인' 기능이 활성화 됩니다. 석판을 소모하여
 *    해당하는 인벤토리 칸에 효과를 남깁니다" — namu.wiki/w/세피리아/재능 (생존 20)
 */
const CELL_LEVEL_HINT =
  '석판 각인·기적 등으로 이 칸 자체에 붙은 레벨입니다. 여기에 놓이는 아티팩트에 더해집니다.'

/** 친타마니 돌: "부서진 곳의 인벤토리 레벨 +3" — data/artifacts.json (chintamani_stone) */
const CHINTAMANI_VALUE = 'chintamani_stone'
const CHINTAMANI_NOTE = '부서지면 이 칸의 인벤토리 레벨 +3'

export function CellEditorPopover() {
  const editorSlot = useInventoryStore((s) => s.editorSlot)
  const setEditorSlot = useInventoryStore((s) => s.setEditorSlot)
  const slots = useInventoryStore((s) => s.slots)
  const gridRows = useInventoryStore((s) => s.gridRows)
  const cellLevels = useInventoryStore((s) => s.cellLevels)
  const targetCombo = useInventoryStore((s) => s.targetCombo)
  const setCellLevel = useInventoryStore((s) => s.setCellLevel)
  const setArtifactEnchant = useInventoryStore((s) => s.setArtifactEnchant)
  const setArtifactPriority = useInventoryStore((s) => s.setArtifactPriority)
  const setArtifactTargetLevel = useInventoryStore((s) => s.setArtifactTargetLevel)
  const toggleLock = useInventoryStore((s) => s.toggleLock)
  const rotateTablet = useInventoryStore((s) => s.rotateTablet)
  const removeItem = useInventoryStore((s) => s.removeItem)
  const recognitionMeta = useInventoryStore((s) => s.recognitionMeta)
  const setPickerSlot = useInventoryStore((s) => s.setPickerSlot)

  const contentRef = useRef<HTMLDivElement | null>(null)

  const evaluation = useMemo(() => {
    if (editorSlot === null) return undefined
    return evaluateBoardDetail(slots, gridRows, undefined, { cellLevels, targetCombo }).artifacts.find(
      (a) => a.slotIndex === editorSlot
    )
  }, [editorSlot, slots, gridRows, cellLevels, targetCombo])

  // 열릴 때 첫 (활성) 컨트롤로 포커스. Modal 의 닫기 버튼이 DOM 상 먼저 오므로
  // 내용 영역 안에서 직접 찾는다.
  useEffect(() => {
    if (editorSlot === null) return
    contentRef.current
      ?.querySelector<HTMLElement>('button:not(:disabled), select:not(:disabled)')
      ?.focus()
  }, [editorSlot])

  if (editorSlot === null) return null

  const item = slots[editorSlot] ?? null
  const cellLevel = cellLevels[editorSlot] ?? 0
  const meta = recognitionMeta[editorSlot]
  const close = () => setEditorSlot(null)

  const cellLevelControl = (
    <div
      className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-[10px]"
      title={CELL_LEVEL_HINT}
    >
      <span className="text-sephiria-muted">칸 레벨</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setCellLevel(editorSlot, cellLevel - 1)}
          disabled={cellLevel <= -9}
          aria-label={`칸 ${editorSlot + 1} 칸 레벨 감소`}
          className="flex h-5 w-5 items-center justify-center rounded-ctl border border-sephiria-border text-sephiria-fg transition-colors duration-200 ease-seph hover:bg-sephiria-grid disabled:opacity-40"
        >
          <Minus size={10} />
        </button>
        <span className="w-6 text-center font-semibold tabular-nums text-sephiria-fg">
          {cellLevel}
        </span>
        <button
          type="button"
          onClick={() => setCellLevel(editorSlot, cellLevel + 1)}
          disabled={cellLevel >= 9}
          aria-label={`칸 ${editorSlot + 1} 칸 레벨 증가`}
          className="flex h-5 w-5 items-center justify-center rounded-ctl border border-sephiria-border text-sephiria-fg transition-colors duration-200 ease-seph hover:bg-sephiria-grid disabled:opacity-40"
        >
          <Plus size={10} />
        </button>
        <span className="ml-1 text-sephiria-muted">-9 ~ 9 · 칸에 각인된 값</span>
      </div>
    </div>
  )

  return (
    <Modal open onClose={close} title={`칸 ${editorSlot + 1} 편집`} className="w-[min(400px,92vw)]">
      <div ref={contentRef} className="flex flex-col gap-3" aria-label={`칸 ${editorSlot + 1} 편집`}>
        {item?.type === 'ARTIFACT' && (
          <ArtifactEditor
            slotIndex={editorSlot}
            artifact={item as PlacedArtifact}
            evaluation={evaluation}
            onEnchant={setArtifactEnchant}
            onPriority={setArtifactPriority}
            onTarget={setArtifactTargetLevel}
            onToggleLock={toggleLock}
          />
        )}

        {item?.type === 'TABLET' && (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-xs font-semibold text-sephiria-fg">
                  {item.data.ko_label}
                </span>
                <span className="shrink-0 text-[10px] text-sephiria-muted">
                  {TIER_KO[item.data.tier]} 석판
                </span>
              </div>
            </div>
            {(item as PlacedTablet).data.rotate === true && (
              <button
                type="button"
                onClick={() => rotateTablet(editorSlot)}
                aria-label={`${item.data.ko_label} 회전`}
                className="flex items-center gap-1 rounded-ctl border border-sephiria-border px-2 py-1 text-[10px] font-medium text-sephiria-fg transition-colors duration-200 ease-seph hover:bg-sephiria-grid active:scale-[0.98]"
              >
                <RotateCw size={11} />
                회전
              </button>
            )}
          </div>
        )}

        {!item && <p className="text-xs text-sephiria-muted">빈 칸</p>}

        {cellLevelControl}

        {(item || meta) && (
          <div className="flex flex-col gap-1.5 border-t border-sephiria-border pt-3">
            {meta && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  // 기존 CellConfirmPicker 흐름 유지 — 에디터는 닫고 픽커를 연다.
                  close()
                  setPickerSlot(editorSlot)
                }}
              >
                <Replace size={13} className="mr-2" />
                다른 아이템으로 교체
              </Button>
            )}
            {item && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => removeItem(editorSlot)}
                aria-label={`칸 ${editorSlot + 1} 비우기`}
              >
                <Trash2 size={13} className="mr-2" />
                칸 비우기
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

interface ArtifactEditorProps {
  slotIndex: number
  artifact: PlacedArtifact
  evaluation: ReturnType<typeof evaluateBoardDetail>['artifacts'][number] | undefined
  onEnchant: (slotIndex: number, level: number) => void
  onPriority: (slotIndex: number, priority: ArtifactPriority) => void
  onTarget: (slotIndex: number, target: number | null) => void
  onToggleLock: (slotIndex: number) => void
}

/** ArtifactListPanel 의 행과 같은 마크업/문구/디스에이블 조건 — 두 UI 의 일관성이 목적이다. */
function ArtifactEditor({
  slotIndex,
  artifact,
  evaluation,
  onEnchant,
  onPriority,
  onTarget,
  onToggleLock,
}: ArtifactEditorProps) {
  const maxLevel = artifact.data.level ?? 0
  const enchantable = maxLevel > 0
  const isExcluded = artifact.priority === 'exclude'
  const constraintSentence = constraintText(artifact.data.effect?.content)
  const constraintKind = evaluation?.constraintKind ?? null
  const constraintStatus = evaluation?.constraintStatus

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div
          className={cn(
            'relative h-9 w-9 shrink-0 overflow-hidden rounded-inner border-2 bg-sephiria-panel',
            TIER_BORDER[artifact.data.tier] ?? 'border-sephiria-border'
          )}
        >
          {artifact.data.image ? (
            <Image
              src={artifact.data.image}
              alt={artifact.data.label_kor}
              fill
              className="object-contain p-0.5"
              unoptimized
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-xs font-semibold text-sephiria-fg">
              {artifact.data.label_kor}
            </span>
            <span className="shrink-0 text-[10px] text-sephiria-muted">
              {TIER_KO[artifact.data.tier]}
            </span>
          </div>
          {evaluation && (
            <div className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums text-sephiria-muted">
              <span
                className={cn(
                  'font-semibold',
                  evaluation.finalLevel < 0 ? 'text-sephiria-destroy-fg' : 'text-sephiria-fg'
                )}
              >
                Lv {evaluation.finalLevel} / {maxLevel}
              </span>
              {evaluation.tabletBonus !== 0 && (
                <span
                  className={
                    evaluation.tabletBonus > 0 ? 'text-sephiria-buff-fg' : 'text-sephiria-debuff-fg'
                  }
                >
                  석판 {evaluation.tabletBonus > 0 ? `+${evaluation.tabletBonus}` : evaluation.tabletBonus}
                </span>
              )}
              {evaluation.cellLevel !== 0 && (
                <span
                  className={
                    evaluation.cellLevel > 0 ? 'text-sephiria-buff-fg' : 'text-sephiria-debuff-fg'
                  }
                >
                  칸 {evaluation.cellLevel > 0 ? `+${evaluation.cellLevel}` : evaluation.cellLevel}
                </span>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onToggleLock(slotIndex)}
          aria-pressed={artifact.isLocked}
          aria-label={artifact.isLocked ? '자리 고정 해제' : '이 자리에 고정'}
          title={artifact.isLocked ? '자리 고정 해제' : '이 자리에 고정'}
          className={cn(
            'shrink-0 rounded-ctl p-1 transition-colors duration-200 ease-seph',
            artifact.isLocked
              ? 'bg-sephiria-confirm text-sephiria-confirm-fg'
              : 'text-sephiria-muted hover:bg-sephiria-grid hover:text-sephiria-fg'
          )}
        >
          <Lock size={12} />
        </button>
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-[10px]">
        <span className="text-sephiria-muted">인챈트</span>
        {enchantable ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onEnchant(slotIndex, artifact.level - 1)}
              disabled={artifact.level <= 0}
              aria-label={`${artifact.data.label_kor} 인챈트 감소`}
              className="flex h-5 w-5 items-center justify-center rounded-ctl border border-sephiria-border text-sephiria-fg transition-colors duration-200 ease-seph hover:bg-sephiria-grid disabled:opacity-40"
            >
              <Minus size={10} />
            </button>
            <span className="w-6 text-center font-semibold tabular-nums text-sephiria-fg">
              {artifact.level}
            </span>
            <button
              type="button"
              onClick={() => onEnchant(slotIndex, artifact.level + 1)}
              disabled={artifact.level >= maxLevel}
              aria-label={`${artifact.data.label_kor} 인챈트 증가`}
              className="flex h-5 w-5 items-center justify-center rounded-ctl border border-sephiria-border text-sephiria-fg transition-colors duration-200 ease-seph hover:bg-sephiria-grid disabled:opacity-40"
            >
              <Plus size={10} />
            </button>
            <span className="ml-1 flex items-center gap-0.5 text-sephiria-muted">
              <Sparkles size={9} />
              게임 내 인챈트 횟수
            </span>
          </div>
        ) : (
          <span className="text-sephiria-muted">강화 불가 (별 0)</span>
        )}

        <span className="text-sephiria-muted">우선순위</span>
        <div className="flex gap-1">
          {PRIORITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onPriority(slotIndex, option.value)}
              title={option.hint}
              aria-pressed={artifact.priority === option.value}
              className={cn(
                'rounded-ctl px-2 py-0.5 font-medium transition-colors duration-200 ease-seph',
                artifact.priority === option.value
                  ? 'bg-sephiria-accent-soft text-sephiria-accent-fg'
                  : 'border border-sephiria-border text-sephiria-muted hover:text-sephiria-fg'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <span className="text-sephiria-muted">목표 강화</span>
        {/* ArtifactListPanel 과 동일하게 RAW targetLevel 에 바인딩한다 — effectiveTarget 참고. */}
        <select
          value={artifact.targetLevel === null ? 'auto' : String(artifact.targetLevel)}
          onChange={(e) =>
            onTarget(slotIndex, e.target.value === 'auto' ? null : Number(e.target.value))
          }
          disabled={isExcluded || !enchantable}
          aria-label={`${artifact.data.label_kor} 목표 강화 레벨`}
          className="w-full rounded-ctl border border-sephiria-border bg-sephiria-panel px-1.5 py-0.5 text-[10px] text-sephiria-fg focus:border-sephiria-accent focus:outline-none disabled:opacity-40"
        >
          <option value="auto">
            {artifact.priority === 'high' ? '풀강 (높음 기본값)' : '최적 (목표 없음)'}
          </option>
          {Array.from({ length: maxLevel }, (_, i) => maxLevel - i).map((lv) => (
            <option key={lv} value={lv}>
              {lv === maxLevel ? `${lv}강 (풀강)` : `${lv}강`}
            </option>
          ))}
        </select>
      </div>

      {artifact.data.value === CHINTAMANI_VALUE && (
        <p className="rounded-ctl bg-sephiria-grid px-2 py-1 text-[10px] leading-snug text-sephiria-muted">
          {CHINTAMANI_NOTE} — 점수에 자동 반영되지 않으니 필요하면 칸 레벨을 직접 올리세요.
        </p>
      )}

      {constraintKind && (
        <div
          className={cn(
            'flex items-start gap-1.5 rounded-ctl px-2 py-1 text-[10px] leading-snug',
            constraintStatus === 'unmet'
              ? 'bg-sephiria-debuff text-sephiria-debuff-fg'
              : constraintStatus === 'waived'
              ? 'bg-sephiria-confirm text-sephiria-confirm-fg'
              : 'bg-sephiria-buff text-sephiria-buff-fg'
          )}
          title={constraintSentence ?? undefined}
        >
          {constraintStatus === 'unmet' ? (
            <ShieldAlert size={11} className="mt-px shrink-0" />
          ) : (
            <ShieldCheck size={11} className="mt-px shrink-0" />
          )}
          <span>
            제약 · {CONSTRAINT_LABEL[constraintKind]}
            {constraintStatus === 'met' && ' — 충족'}
            {constraintStatus === 'waived' && ' — 석판이 무시시킴'}
            {constraintStatus === 'unmet' && ' — 미충족, 고유 효과가 꺼집니다'}
          </span>
        </div>
      )}
    </div>
  )
}
