import type { ComboTier, GridRow, GridSlot } from '@/types'
import { isValidPosition, positionToSlot, slotToPosition } from './gridUtils'
import { COMBO_EFFECTS, comboTiersMet, nextComboTier } from '@/data/comboEffects'
import { COMBO_ORDER } from '@/data/wikiLabels'

/**
 * 콤보(태그) 카운팅.
 *
 * 하얀 종이: "[고유] 양쪽 칸에 배치된 아티팩트가 동일한 콤보인 경우, 해당 콤보 수치 1 증가"
 *   — data/artifacts.json (white_paper)
 * 콤보 누적식: "콤보 효과의 적용 방식도 누적식으로 변경되어, 스택 10을 달성한 콤보는
 *   2부터 10까지의 모든 효과를 합산하여 적용받는다" — namu.wiki/w/세피리아/아티팩트
 */

export const WHITE_PAPER_VALUE = 'white_paper'

export interface ComboCount {
  slug: string
  /** 배치된 아티팩트의 sets 태그에서 온 스택. 결속은 두 콤보 모두에 +1. */
  base: number
  /** 하얀 종이의 [고유] 효과에서 온 스택. */
  whitePaper: number
  total: number
}

/**
 * Count every combo stack on the board. Slugs whose total is 0 are absent from
 * the map.
 */
export function comboCounts(
  slots: GridSlot[],
  gridRows: GridRow[]
): Map<string, ComboCount> {
  const counts = new Map<string, ComboCount>()
  const bump = (slug: string, field: 'base' | 'whitePaper') => {
    let entry = counts.get(slug)
    if (!entry) {
      entry = { slug, base: 0, whitePaper: 0, total: 0 }
      counts.set(slug, entry)
    }
    entry[field] += 1
    entry.total += 1
  }

  // base: each placed ARTIFACT adds +1 per tag it carries. 결속(solid) artifacts
  // carry two tags and count toward both combos. 하얀 종이 has no sets, so it
  // contributes nothing here.
  for (const slot of slots) {
    if (slot?.type !== 'ARTIFACT') continue
    for (const slug of slot.data.effect.sets ?? []) bump(slug, 'base')
  }

  // whitePaper: each placed 하얀 종이 looks at its two horizontal neighbours.
  // Both must be real grid cells holding an ARTIFACT — a tablet, an empty cell,
  // or a missing cell at a row end gives nothing.
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    if (slot?.type !== 'ARTIFACT' || slot.data.value !== WHITE_PAPER_VALUE) continue
    const { row, col } = slotToPosition(i, gridRows)
    const left = neighbourSets(row, col - 1, slots, gridRows)
    const right = neighbourSets(row, col + 1, slots, gridRows)
    if (!left || !right) continue
    // "해당 콤보 수치 1 증가" read literally: every combo the two neighbours share
    // gets +1. So when two 결속 artifacts share both tags, both combos gain a
    // stack from the one 하얀 종이.
    left.forEach((slug) => {
      if (right.has(slug)) bump(slug, 'whitePaper')
    })
  }

  return counts
}

/** The neighbour's combo tags, or null when it is off-grid or not an artifact. */
function neighbourSets(
  row: number,
  col: number,
  slots: GridSlot[],
  gridRows: GridRow[]
): Set<string> | null {
  if (!isValidPosition(row, col, gridRows)) return null
  const slot = positionToSlot(row, col, gridRows)
  if (slot === null) return null
  const item = slots[slot]
  if (item?.type !== 'ARTIFACT') return null
  return new Set(item.data.effect.sets ?? [])
}

/** Sum of tiers reached across every counted combo — the board's combo value. */
export function totalComboTiers(counts: Map<string, ComboCount>): number {
  let sum = 0
  counts.forEach(({ slug, total }) => {
    sum += comboTiersMet(slug, total)
  })
  return sum
}

/**
 * Combos where one more 하얀 종이 stack actually crosses a threshold:
 * (a) the board holds 2+ artifacts of that combo (a 하얀 종이 needs one on each
 *     side), and
 * (b) total + 1 reaches a tier that total does not.
 * Sorted in COMBO_ORDER (wiki section 3.1–3.20) order.
 */
export function whitePaperOpportunities(
  slots: GridSlot[],
  gridRows: GridRow[]
): Array<{ slug: string; ko: string; count: number; nextTier: ComboTier }> {
  const counts = comboCounts(slots, gridRows)
  const out: Array<{ slug: string; ko: string; count: number; nextTier: ComboTier }> = []
  for (const slug of COMBO_ORDER) {
    const entry = counts.get(slug)
    if (!entry || entry.base < 2) continue
    if (comboTiersMet(slug, entry.total + 1) <= comboTiersMet(slug, entry.total)) continue
    const nextTier = nextComboTier(slug, entry.total)
    if (!nextTier) continue
    out.push({ slug, ko: COMBO_EFFECTS[slug].ko, count: entry.total, nextTier })
  }
  return out
}
