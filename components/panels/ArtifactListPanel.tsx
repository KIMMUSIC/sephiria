'use client'

import { useMemo } from 'react'
import Image from 'next/image'
import { Lock, Minus, Plus, RotateCcw, ShieldCheck, ShieldAlert, Sparkles, SquarePen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { useInventoryStore } from '@/store/inventoryStore'
import { evaluateBoardDetail, type ArtifactEvaluation } from '@/lib/optimizerScore'
import { CONSTRAINT_LABEL, constraintText } from '@/lib/constraints'
import { TIER_KO } from '@/data/wikiLabels'
import type { ArtifactPriority } from '@/types'

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

export function ArtifactListPanel() {
  const slots = useInventoryStore((s) => s.slots)
  const gridRows = useInventoryStore((s) => s.gridRows)
  const setArtifactEnchant = useInventoryStore((s) => s.setArtifactEnchant)
  const setArtifactPriority = useInventoryStore((s) => s.setArtifactPriority)
  const setArtifactTargetLevel = useInventoryStore((s) => s.setArtifactTargetLevel)
  const resetArtifactGoals = useInventoryStore((s) => s.resetArtifactGoals)
  const toggleLock = useInventoryStore((s) => s.toggleLock)
  const setEditorSlot = useInventoryStore((s) => s.setEditorSlot)
  const cellLevels = useInventoryStore((s) => s.cellLevels)
  const targetCombo = useInventoryStore((s) => s.targetCombo)

  const evaluations = useMemo(
    () => evaluateBoardDetail(slots, gridRows, undefined, { cellLevels, targetCombo }).artifacts,
    [slots, gridRows, cellLevels, targetCombo]
  )

  const goalsTotal = evaluations.filter((e) => e.target !== null).length
  const goalsMet = evaluations.filter((e) => e.target !== null && e.goalMet).length
  const constrained = evaluations.filter((e) => e.constraintKind)
  const constraintsUnmet = constrained.filter((e) => e.constraintStatus === 'unmet').length

  return (
    <Panel
      title="아티팩트 목록"
      trailing={
        <span className="text-xs font-normal tabular-nums text-sephiria-muted">
          {evaluations.length}개
        </span>
      }
    >
      {evaluations.length === 0 ? (
        <p className="py-4 text-center text-xs leading-relaxed text-sephiria-muted">
          인벤에 배치된 아티팩트가 없습니다.
          <br />
          스크린샷을 인식하거나 팔레트에서 끌어다 놓으세요.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-ctl bg-sephiria-grid px-2 py-1 tabular-nums text-sephiria-muted">
              목표 달성 <span className="font-semibold text-sephiria-fg">{goalsMet}/{goalsTotal}</span>
            </span>
            <span
              className={cn(
                'rounded-ctl px-2 py-1 tabular-nums',
                constraintsUnmet > 0
                  ? 'bg-sephiria-debuff text-sephiria-debuff-fg'
                  : 'bg-sephiria-grid text-sephiria-muted'
              )}
            >
              제약 충족{' '}
              <span className="font-semibold">
                {constrained.length - constraintsUnmet}/{constrained.length}
              </span>
            </span>
            {(goalsTotal > 0 || evaluations.some((e) => e.artifact.priority !== 'normal')) && (
              <button
                type="button"
                onClick={resetArtifactGoals}
                className="ml-auto flex items-center gap-1 rounded-ctl border border-sephiria-border px-2 py-1 text-sephiria-muted transition-colors duration-200 ease-seph hover:bg-sephiria-grid hover:text-sephiria-fg"
              >
                <RotateCcw size={11} />
                모두 최적으로
              </button>
            )}
          </div>

          {/* 자체 스크롤 없음 — 오른쪽 열(app/page.tsx)이 sticky + overflow-y-auto 로 대신 스크롤한다. */}
          <ul className="flex flex-col gap-2 pr-1">
            {evaluations.map((evaluation) => (
              <ArtifactRow
                key={evaluation.artifact.instanceId}
                evaluation={evaluation}
                onEnchant={setArtifactEnchant}
                onPriority={setArtifactPriority}
                onTarget={setArtifactTargetLevel}
                onToggleLock={toggleLock}
                onOpenEditor={setEditorSlot}
              />
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}

interface ArtifactRowProps {
  evaluation: ArtifactEvaluation
  onEnchant: (slotIndex: number, level: number) => void
  onPriority: (slotIndex: number, priority: ArtifactPriority) => void
  onTarget: (slotIndex: number, target: number | null) => void
  onToggleLock: (slotIndex: number) => void
  /** 그리드 셀 에디터(CellEditorPopover)를 이 칸으로 연다. */
  onOpenEditor: (slotIndex: number) => void
}

function ArtifactRow({
  evaluation,
  onEnchant,
  onPriority,
  onTarget,
  onToggleLock,
  onOpenEditor,
}: ArtifactRowProps) {
  const {
    artifact,
    slotIndex,
    finalLevel,
    rawLevel,
    tabletBonus,
    cellLevel,
    constraintKind,
    constraintStatus,
    target,
    goalMet,
  } = evaluation
  const maxLevel = artifact.data.level ?? 0
  const enchantable = maxLevel > 0
  const isExcluded = artifact.priority === 'exclude'
  const constraintSentence = constraintText(artifact.data.effect?.content)

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-inner border border-sephiria-border bg-sephiria-cell p-2',
        isExcluded && 'opacity-70',
        artifact.priority === 'high' && 'border-sephiria-accent/50 bg-sephiria-accent-soft/30'
      )}
    >
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
          <div className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums text-sephiria-muted">
            <span>
              칸 {slotIndex + 1}
            </span>
            {/*
              자르기 전 rawLevel 을 보여 그리드 배지와 숫자가 갈라지지 않게 한다.
              상한을 넘으면 초과분은 버려지므로 '주의' 색으로 드러낸다.
            */}
            <span
              className={cn(
                'font-semibold',
                rawLevel < 0
                  ? 'text-sephiria-destroy-fg'
                  : rawLevel > maxLevel
                  ? 'text-sephiria-confirm-fg'
                  : target !== null && goalMet
                  ? 'text-sephiria-buff-fg'
                  : 'text-sephiria-fg'
              )}
              title={
                rawLevel > maxLevel
                  ? `상한 초과 — ${rawLevel - maxLevel} 만큼은 버려집니다`
                  : undefined
              }
            >
              Lv {rawLevel} / {maxLevel}
            </span>
            {/* 석판 보너스와 칸 레벨은 출처가 다르다 — 석판은 아이템 효과, 칸 레벨은 칸에 각인된 값. */}
            {tabletBonus !== 0 && (
              <span className={tabletBonus > 0 ? 'text-sephiria-buff-fg' : 'text-sephiria-debuff-fg'}>
                석판 {tabletBonus > 0 ? `+${tabletBonus}` : tabletBonus}
              </span>
            )}
            {cellLevel !== 0 && (
              <span className={cellLevel > 0 ? 'text-sephiria-buff-fg' : 'text-sephiria-debuff-fg'}>
                칸 {cellLevel > 0 ? `+${cellLevel}` : cellLevel}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenEditor(slotIndex)}
          aria-label={`칸 ${slotIndex + 1} 셀 에디터 열기`}
          title="그리드 셀 에디터 열기"
          className="shrink-0 rounded-ctl p-1 text-sephiria-muted transition-colors duration-200 ease-seph hover:bg-sephiria-grid hover:text-sephiria-fg"
        >
          <SquarePen size={12} />
        </button>
        <button
          type="button"
          onClick={() => onToggleLock(slotIndex)}
          aria-pressed={artifact.isLocked}
          aria-label={`${artifact.data.label_kor} ${artifact.isLocked ? '자리 고정 해제' : '이 자리에 고정'}`}
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
        {/*
          Bound to the RAW targetLevel, not the effective one. A 높음 artifact with no
          explicit target is optimized toward 풀강, but its stored state is still "no
          target" — showing the derived level here would make the control disagree with
          what the user actually set, and hide that "풀강 (높음 기본값)" is the live option.
        */}
        <select
          value={artifact.targetLevel === null ? 'auto' : String(artifact.targetLevel)}
          onChange={(e) =>
            onTarget(slotIndex, e.target.value === 'auto' ? null : Number(e.target.value))
          }
          disabled={isExcluded || !enchantable}
          aria-label={`${artifact.data.label_kor} 목표 강화 레벨`}
          className="w-full rounded-ctl border border-sephiria-border bg-sephiria-panel px-1.5 py-0.5 text-[10px] text-sephiria-fg focus:border-sephiria-accent focus:outline-none disabled:opacity-40"
        >
          {/* 높음으로 두면 목표를 지정하지 않아도 풀강이 목표가 된다 — effectiveTarget 참고. */}
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

      {/* 친타마니 돌: "부서진 곳의 인벤토리 레벨 +3" — data/artifacts.json. 점수에 자동
          반영하지 않는다 — 사용자가 셀 에디터에서 칸 레벨을 직접 올리는 방식이다. */}
      {artifact.data.value === 'chintamani_stone' && (
        <p className="rounded-ctl bg-sephiria-grid px-2 py-1 text-[10px] leading-snug text-sephiria-muted">
          부서지면 이 칸의 인벤토리 레벨 +3 — 필요하면 셀 에디터에서 칸 레벨을 직접 올리세요.
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
    </li>
  )
}
