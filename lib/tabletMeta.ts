import type { FusedSource, TabletEffectDef } from '@/types'
import { TABLET_EFFECTS } from '@/data/tabletEffects'
import { TABLET_MAP } from '@/data/tablets'

/**
 * Tablet 활성화 조건 ([위치] lines on each namu.wiki tablet card) and 제약 무시 sources.
 *
 * The applicators in lib/effectEngine.ts already gate on these positions; this map
 * exists so the UI — and 석판 합성, which inherits 배치 제약 — can state them.
 *   "합성한 석판은 증감 영역, 레벨 증감량, 제약 무시 영역, 회전 제약, 배치 제약 등
 *    재료가 된 두 석판의 모든 효과를 계승한다" — namu.wiki/w/세피리아
 */
export const TABLET_ACTIVATION: Record<string, string[]> = {
  // "석판 활성화 조건[ 위치 ] 최하단" — namu.wiki/w/세피리아/석판#선의
  linear: ['최하단'],
  // "석판 활성화 조건[ 위치 ] 최상단" — same page, 차양
  shade: ['최상단'],
  // "석판 활성화 조건[ 위치 ] 왼쪽 끝[ 위치 ] 오른쪽 끝" — same page, 정의
  justice: ['왼쪽 끝', '오른쪽 끝'],
  // "석판 활성화 조건[ 위치 ] 왼쪽 끝" — same page, 깃발
  flag: ['왼쪽 끝'],
}

/**
 * Tablets that grant 아티팩트 제약 조건 무시 — exactly three.
 *   "석판의 효과는 아티팩트 레벨 증가, 아티팩트 레벨 감소, 아티팩트 제약 조건 무시
 *    3가지가 있으며" — namu.wiki/w/세피리아/석판
 */
export const CONSTRAINT_IGNORE_TABLETS = ['home_town', 'connection', 'hospitality'] as const

export function grantsConstraintIgnore(value: string): boolean {
  if ((CONSTRAINT_IGNORE_TABLETS as readonly string[]).includes(value)) return true
  const def = TABLET_EFFECTS[value]
  return def?.type === 'simple' && def.effects.some((e) => e.flag === 'ignore')
}

/** Can this catalog tablet be turned — on the grid, and as a fusion material? */
export function canRotate(value: string): boolean {
  return TABLET_MAP.get(value)?.rotate === true
}

/** Is this tablet a 석판 합성 product? Those may not be used as materials again. */
export function isFusedValue(value: string, def?: TabletEffectDef): boolean {
  return (def ?? TABLET_EFFECTS[value])?.type === 'fused' || value.startsWith('fused_')
}

/** Flatten a definition to the catalog tablet values that actually produce its effects. */
export function effectSourcesOf(value: string, def?: TabletEffectDef): string[] {
  const resolved = def ?? TABLET_EFFECTS[value]
  if (resolved?.type === 'fused') return resolved.sources.map((s) => s.value)
  return [value]
}

/** Every 활성화 조건 a tablet (or fusion product) must satisfy, deduplicated. */
export function activationConditionsOf(sources: readonly FusedSource[]): string[] {
  const out: string[] = []
  for (const source of sources) {
    for (const condition of TABLET_ACTIVATION[source.value] ?? []) {
      if (!out.includes(condition)) out.push(condition)
    }
  }
  return out
}

/** A fusion product rotates only when every material rotates. */
export function isRotatable(sources: readonly FusedSource[]): boolean {
  return sources.length > 0 && sources.every((s) => canRotate(s.value))
}
