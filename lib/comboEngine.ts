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

/** 보드에 놓인 하얀 종이 장수. */
export function whitePaperCount(slots: GridSlot[]): number {
  let n = 0
  for (const slot of slots) {
    if (slot?.type === 'ARTIFACT' && slot.data.value === WHITE_PAPER_VALUE) n += 1
  }
  return n
}

/**
 * 하얀 종이가 이 콤보에 더해 줄 수 있는 최대 스택.
 *
 * 종이 한 장은 양옆에 그 콤보 아티팩트가 하나씩 있어야 하고, 줄지어 놓으면
 * A 종이 A 종이 A 처럼 가운데 아티팩트를 공유할 수 있다. 그래서 종이 k 장을
 * 모두 쓰려면 그 콤보 아티팩트가 k+1 개 필요하다. 격자 폭·빈칸 사정은 넣지
 * 않았으므로 이 값은 상한이다.
 */
export function whitePaperHeadroom(base: number, papers: number): number {
  if (base < 2 || papers < 1) return 0
  return Math.min(papers, base - 1)
}

export interface WhitePaperTarget {
  slug: string
  ko: string
  /** 종이 도움 없이 세어지는 스택 — 아티팩트 태그만. */
  base: number
  /** 종이를 최대한 활용했을 때 도달 가능한 스택. */
  achievable: number
  /** base 기준으로 다음 임계값. 이미 마지막 단계면 null. */
  nextTier: ComboTier | null
  /** achievable 이 base 보다 높은 단계에 닿는가. */
  crossesThreshold: boolean
}

/**
 * 하얀 종이를 붙일 수 있는 모든 콤보. 양옆에 놓을 같은 콤보 아티팩트가
 * 2개 이상이고 보드에 종이가 있으면 후보다. COMBO_ORDER(위키 3.1–3.20) 순서.
 *
 * 판정 기준은 base 다. entry.total 은 지금 종이가 붙어 있는지에 따라 흔들리므로,
 * 그 값을 기준으로 "+1 이 임계값을 넘는가" 를 물으면 **종이 한 장이 더 있어야
 * 가능한 목표**를 제안하게 된다. 바람노래 기본 6 + 종이 1 = 7 인 보드에서
 * 7→8 을 권하던 것이 그 경우다 — 종이가 한 장뿐이라 8 은 도달할 수 없다.
 */
export function whitePaperTargets(
  slots: GridSlot[],
  gridRows: GridRow[]
): WhitePaperTarget[] {
  const counts = comboCounts(slots, gridRows)
  const papers = whitePaperCount(slots)
  const out: WhitePaperTarget[] = []
  for (const slug of COMBO_ORDER) {
    const entry = counts.get(slug)
    if (!entry) continue
    const headroom = whitePaperHeadroom(entry.base, papers)
    if (headroom === 0) continue
    const achievable = entry.base + headroom
    out.push({
      slug,
      ko: COMBO_EFFECTS[slug].ko,
      base: entry.base,
      achievable,
      nextTier: nextComboTier(slug, entry.base),
      crossesThreshold:
        comboTiersMet(slug, achievable) > comboTiersMet(slug, entry.base),
    })
  }
  return out
}

/** 붙일 수 있는 콤보 중, 종이로 실제로 임계값을 넘기는 것만. */
export function whitePaperOpportunities(
  slots: GridSlot[],
  gridRows: GridRow[]
): WhitePaperTarget[] {
  return whitePaperTargets(slots, gridRows).filter((t) => t.crossesThreshold)
}
