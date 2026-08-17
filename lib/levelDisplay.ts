import { isArtifactDestroyed } from '@/lib/optimizerScore'

/**
 * 그리드 레벨 배지의 표시 상태.
 * - destroyed: 레벨이 -1 이하 — "아티팩트 레벨 감소로 레벨이 -1 이하가 된 아티팩트는
 *   효과가 무효" — namu.wiki/w/세피리아/석판. isArtifactDestroyed 와 같은 경계.
 * - fixed: 별 0짜리 강화 불가 아티팩트 (maxLevel 0, 데이터에 8개).
 * - maxed: 상한까지 강화됨 (풀강). maxLevel > 0 인 경우에만 — 별 0짜리를
 *   풀강으로 강조하면 안 된다.
 * - partial: 아직 덜 강화됨.
 */
export type ArtifactLevelState = 'destroyed' | 'maxed' | 'partial' | 'fixed'

export function artifactLevelState(currentLevel: number, maxLevel: number): ArtifactLevelState {
  if (isArtifactDestroyed(currentLevel)) return 'destroyed'
  if (maxLevel <= 0) return 'fixed'
  if (currentLevel >= maxLevel) return 'maxed'
  return 'partial'
}

/** 인게임 표기 그대로 `현재/최대`. 별 0짜리도 `0/0` 으로 나온다. */
export function artifactLevelText(currentLevel: number, maxLevel: number): string {
  return `${currentLevel}/${maxLevel}`
}
