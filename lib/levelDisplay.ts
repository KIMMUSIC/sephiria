import { isArtifactDestroyed } from '@/lib/optimizerScore'

/**
 * 그리드 레벨 배지의 표시 상태.
 *
 * 받는 level 은 **자르기 전** 값이다 (lib/optimizerScore.ts rawLevelOf).
 * 그래야 7/5 처럼 상한을 넘어선 상황을 보여 줄 수 있다.
 *
 * - destroyed: 레벨이 -1 이하 — "아티팩트 레벨 감소로 레벨이 -1 이하가 된
 *   아티팩트는 효과가 무효" — namu.wiki/w/세피리아/석판. isArtifactDestroyed 와 같은 경계.
 * - over: 상한을 넘겼다. 효과는 상한에서 멈추고 초과분은 버려진다 —
 *   별 0짜리가 석판 몴을 받는 경우(2/0)도 여기 들어오므로 fixed 보다 먼저 검사한다.
 * - fixed: 별 0짜리 강화 불가 아티팩트 (maxLevel 0, 데이터에 8개).
 * - maxed: 상한까지 정확히 채웠다 (풀강). maxLevel > 0 인 경우에만.
 * - partial: 아직 덜 강화됨.
 */
export type ArtifactLevelState = 'destroyed' | 'over' | 'maxed' | 'partial' | 'fixed'

export function artifactLevelState(level: number, maxLevel: number): ArtifactLevelState {
  if (isArtifactDestroyed(level)) return 'destroyed'
  if (level > maxLevel) return 'over'
  if (maxLevel <= 0) return 'fixed'
  if (level >= maxLevel) return 'maxed'
  return 'partial'
}

/** 인게임 표기 그대로 `현재/최대`. 별 0짜리는 `0/0`, 초과는 `7/5` 로 나온다. */
export function artifactLevelText(level: number, maxLevel: number): string {
  return `${level}/${maxLevel}`
}

/** 상한을 넘어 버려지는 레벨 수. 초과가 아니면 0. */
export function wastedLevels(level: number, maxLevel: number): number {
  return Math.max(0, level - Math.max(0, maxLevel))
}
