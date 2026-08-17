'use client'

import { useEffect, useMemo } from 'react'
import { Panel } from '@/components/ui/panel'
import { useInventoryStore } from '@/store/inventoryStore'
import {
  WHITE_PAPER_VALUE,
  comboCounts,
  whitePaperTargets,
} from '@/lib/comboEngine'
import { comboTiersMet, nextComboTier } from '@/data/comboEffects'
import { COMBO_KO, COMBO_ORDER } from '@/data/wikiLabels'

/**
 * 보드의 콤보 현황과 하얀 종이 목표 콤보 선택기.
 *
 * 콤보는 누적식이라 '도달한 단계 수'가 곧 가치다:
 *   "콤보 효과의 적용 방식도 누적식으로 변경되어, 스택 10을 달성한 콤보는 2부터 10까지의
 *    모든 효과를 합산하여 적용받는다" — namu.wiki/w/세피리아/아티팩트
 * 하얀 종이: "[고유] 양쪽 칸에 배치된 아티팩트가 동일한 콤보인 경우, 해당 콤보 수치 1 증가"
 *   — data/artifacts.json (white_paper)
 */
export function ComboPanel() {
  const slots = useInventoryStore((s) => s.slots)
  const gridRows = useInventoryStore((s) => s.gridRows)
  const targetCombo = useInventoryStore((s) => s.targetCombo)
  const setTargetCombo = useInventoryStore((s) => s.setTargetCombo)

  const counts = useMemo(() => comboCounts(slots, gridRows), [slots, gridRows])
  const targets = useMemo(() => whitePaperTargets(slots, gridRows), [slots, gridRows])
  // 임계값을 넘기는 후보와, 넘기진 못해도 종이를 붙여 둘 수 있는 후보를 나눈다.
  const opportunities = useMemo(() => targets.filter((t) => t.crossesThreshold), [targets])
  const holdOnly = useMemo(() => targets.filter((t) => !t.crossesThreshold), [targets])

  const hasArtifacts = slots.some((slot) => slot?.type === 'ARTIFACT')
  const hasWhitePaper = slots.some(
    (slot) => slot?.type === 'ARTIFACT' && slot.data.value === WHITE_PAPER_VALUE
  )

  // 하얀 종이가 보드에서 사라졌는데 목표 콤보가 남아 있으면 유령 목표가 최적화의
  // 최상위 밴드(comboGoal)를 계속 흔든다 — 조용히 해제한다.
  useEffect(() => {
    if (!hasWhitePaper && targetCombo !== null) setTargetCombo(null)
  }, [hasWhitePaper, targetCombo, setTargetCombo])

  const rows = COMBO_ORDER.map((slug) => counts.get(slug)).filter(
    (entry): entry is NonNullable<typeof entry> => !!entry && entry.total > 0
  )

  return (
    <Panel title="콤보">
      {!hasArtifacts ? (
        <p className="text-xs text-sephiria-muted">배치된 아티팩트가 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.length === 0 && (
            <p className="text-xs text-sephiria-muted">콤보를 이루는 아티팩트가 없습니다.</p>
          )}
          {rows.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {rows.map((entry) => {
                const met = comboTiersMet(entry.slug, entry.total)
                const next = nextComboTier(entry.slug, entry.total)
                return (
                  <li
                    key={entry.slug}
                    className="rounded-inner border border-sephiria-border bg-sephiria-cell px-2 py-1.5"
                  >
                    <div className="flex items-baseline gap-1.5 text-xs">
                      <span className="font-semibold text-sephiria-fg">
                        {COMBO_KO[entry.slug] ?? entry.slug}
                      </span>
                      <span className="tabular-nums text-sephiria-fg">{entry.total}개</span>
                      {entry.whitePaper > 0 && (
                        <span className="text-[10px] tabular-nums text-sephiria-muted">
                          기본 {entry.base} + 종이 {entry.whitePaper}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] tabular-nums text-sephiria-muted">
                        {met}단계 도달
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-sephiria-muted">
                      {next ? `다음 ${next.count}개 — ${next.text}` : '최대 단계 달성'}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}

          {hasWhitePaper && (
            <div className="flex flex-col gap-1.5 border-t border-sephiria-border pt-3">
              <span className="text-[11px] font-semibold text-sephiria-fg">
                하얀 종이 목표 콤보
              </span>
              {targets.length > 0 ? (
                <>
                  <select
                    value={targetCombo ?? ''}
                    onChange={(e) => setTargetCombo(e.target.value || null)}
                    aria-label="하얀 종이 목표 콤보"
                    className="w-full rounded-ctl border border-sephiria-border bg-sephiria-cell px-2 py-1 text-xs text-sephiria-fg focus:border-sephiria-accent focus:outline-none"
                  >
                    <option value="">목표 없음</option>
                    {opportunities.length > 0 && (
                      <optgroup label="임계값을 넘깁니다">
                        {opportunities.map((o) => (
                          <option key={o.slug} value={o.slug}>
                            {o.ko} · {o.base} → {o.achievable}
                            {o.nextTier ? ` (${o.nextTier.text})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {/*
                      임계값을 넘기지 못해도 종이를 그 콤보에 붙여 두고 싶을 수 있다.
                      목표 밴드가 스택 수를 세므로 이쪽을 고르면 최적화가 종이를 양옆에
                      붙여 둔다 — 단계만 세면 임계값 사이에서 평평해 종이가 떠돌았던 그 문제다.
                    */}
                    {holdOnly.length > 0 && (
                      <optgroup label="임계값은 못 넘기지만 스택을 유지합니다">
                        {holdOnly.map((o) => (
                          <option key={o.slug} value={o.slug}>
                            {o.ko} · {o.base} → {o.achievable}
                            {o.nextTier ? ` (다음 ${o.nextTier.count}개)` : ' (최대 단계)'}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {/* 선택해 둔 목표가 배치 변경으로 목록에서 빠져도 현재 값은 보이게 유지한다. */}
                    {targetCombo && !targets.some((o) => o.slug === targetCombo) && (
                      <option value={targetCombo}>
                        {COMBO_KO[targetCombo] ?? targetCombo} (현재 목표)
                      </option>
                    )}
                  </select>
                  <p className="text-[10px] leading-snug text-sephiria-muted">
                    하얀 종이 양옆에 같은 콤보 아티팩트가 오도록 배치를 맞춥니다. 표시된 숫자는
                    종이를 뺀 순수 아티팩트 수 → 종이까지 합친 도달 가능 수입니다.
                  </p>
                </>
              ) : (
                <p className="text-[10px] leading-snug text-sephiria-muted">
                  하얀 종이를 붙일 수 있는 콤보가 없습니다. 종이 양옆에 놓으려면 같은 콤보
                  아티팩트가 2개 이상 배치되어 있어야 합니다.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
