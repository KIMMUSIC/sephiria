import type {
  BoardConfig,
  ConstraintKind,
  EffectMap,
  GridRow,
  GridSlot,
  PlacedArtifact,
  PlacedTablet,
} from '@/types'
import { applyTabletShield, calculateAllEffects, type EffectStats } from '@/lib/effectEngine'
import { comboCounts, totalComboTiers, whitePaperCount, WHITE_PAPER_VALUE } from '@/lib/comboEngine'
import { comboTiersMet, maxComboTiers } from '@/data/comboEffects'
import { getMaxRow, slotToPosition } from '@/lib/gridUtils'
import {
  parseConstraint,
  resolveConstraintStatus,
  type ConstraintStatus,
} from '@/lib/constraints'

export const DESTRUCTION_SCORE = -1e15

/**
 * An artifact is 무효 once tablet debuffs drive it to -1 or lower. Level 0 is alive.
 *   "아티팩트 레벨 감소로 레벨이 -1 이하가 된 아티팩트는 효과가 무효되므로 배치를
 *    잘 해야 한다" — namu.wiki/w/세피리아/석판
 * No 제약 무시 tablet can rescue this: "아티팩트 자체의 제약이 아니므로 석판이 가진
 * 제약 무시 효과로 무시할 수 없다" — same page.
 */
export function isArtifactDestroyed(level: number): boolean {
  return level < 0
}

/**
 * Final level of an artifact in a cell.
 * The star count is a cap, so any surplus above it is wasted:
 *   "별은 아티팩트의 레벨 상한을 나타내며, 기본 레벨은 0이고 인챈트와 석판의 효과로
 *    현재 레벨을 상한까지 올릴 수 있다" — namu.wiki/w/세피리아/아티팩트
 */
export function finalLevelOf(artifact: PlacedArtifact, bonus: number): number {
  const cap = artifact.data.level ?? 0
  return Math.min(artifact.level + bonus, cap)
}

/**
 * 자르기 전 레벨 — 인챈트 + 석판 + 칸 레벨을 그대로 더한 값.
 *
 * 점수는 반드시 finalLevelOf 를 쓴다. 상한 초과분은 버려지는 값이라
 * (별은 상한이다 — namu.wiki/w/세피리아/아티팩트) 최적화가 그걸 쪻으면
 * 쓸데없는 자리를 고른다. 이 값은 오직 **표시용**이다 — 7/5 처럼
 * 얼마나 낭비되고 있는지 사용자에게 보여 주기 위해 쓴다.
 */
export function rawLevelOf(artifact: PlacedArtifact, bonus: number): number {
  return artifact.level + bonus
}

/** Satisfying a `<제약>` is worth about as much as fully enhancing that artifact. */
function constraintValue(artifact: PlacedArtifact): number {
  return Math.max(1, artifact.data.level ?? 0)
}

function constraintKindOf(artifact: PlacedArtifact): ConstraintKind | null {
  return parseConstraint(artifact.data.effect?.content)
}

/**
 * The goal this artifact is actually optimized toward, or null when it has none.
 *
 * Marking an artifact 높음 without naming a number means 풀강 — the user's own framing
 * of the feature is "최적의 배치보다 특정 아이템의 풀강이 더 중요할 수 있다". Leaving a
 * 높음 artifact out of the goal bands would invert the priorities it exists to express:
 * a throwaway item's 1강 target sits in a band above the entire level sum, so it would
 * outrank fully enhancing the item the user actually cares about.
 */
export function effectiveTarget(artifact: PlacedArtifact): number | null {
  if (artifact.priority === 'exclude') return null
  const cap = artifact.data.level ?? 0
  if (artifact.targetLevel !== null) return Math.max(0, Math.min(artifact.targetLevel, cap))
  return artifact.priority === 'high' && cap > 0 ? cap : null
}

// ── Score weights ──
// The objective is lexicographic, from the top: the user's target combo (comboGoal)
// outranks a targeted high-priority artifact's goal, which outranks every
// normal-priority goal, which outranks the plain level sum, which outranks the
// excluded items, which outranks the all-combo tie-breaker (comboAll), which outranks
// the structural tie-breakers. Band units are derived from the actual board so the
// separation is exact and the numbers stay small.

/**
 * Ceiling on the structural tie-breaker count.
 *
 * The other bands are bounded by the artifacts on the board, but one structural term
 * is not: OOB debuffs are counted per *effect*, and a 합성 석판 replays one effect set
 * per source, so a tablet fused down a long chain emits arbitrarily many. Left
 * unbounded the tie-breaker band overflows one unit of the band above it and inverts
 * the whole lexicographic order — a board that misses a high-priority goal can outscore
 * one that meets it purely on wasted-debuff count.
 *
 * Clamping costs tie-break resolution on a degenerate board and nothing else, which is
 * the failure mode to prefer. The value is far above anything a real board reaches
 * (a 60-slot grid of ordinary tablets stays under ~500) and far below the point where
 * the band products approach Number.MAX_SAFE_INTEGER.
 */
export const STRUCT_TIEBREAK_CAP = 4096

/**
 * Ceiling on the combo tie-breaker band, mirroring STRUCT_TIEBREAK_CAP.
 *
 * comboAll sits between exclude and struct, so every band above it is multiplied by
 * (comboAllCap + 1). An unclamped cap would let a pathological catalog push the top
 * of the unit chain past Number.MAX_SAFE_INTEGER, where integer arithmetic loses
 * precision and the lexicographic bands collapse into each other. 256 is far above
 * the real maximum (all 20 combos together reach 80 tiers — data/comboEffects.ts)
 * and keeps the chain product safely finite on a 60-cell board.
 */
export const COMBO_TIEBREAK_CAP = 256

/**
 * comboGoal 밴드가 세는 값의 절대 상한. 실제 상한은 보드에서 계산하고
 * (목표 콤보 아티팩트 수 + 하얀 종이 장수), 이 상수는 밴드 사슬이
 * Number.MAX_SAFE_INTEGER 를 넘지 않게 하는 마지막 빗장이다.
 */
export const COMBO_GOAL_STACK_CAP = 64

export interface ScoreWeights {
  /**
   * 최상위: targetCombo 의 **스택 수**. 목표 콤보가 없으면 상한 0.
   *
   * 단계 수가 아니라 스택 수를 세는 이유: 단계 수는 임계값 사이에서 평평해
   * 최적화기에 기울기를 주지 못한다. 바람노래는 임계값이 2/4/6/8/10 이라
   * 스택 6 과 7 이 둘 다 3단계이고, 그러면 하얀 종이가 양옆에 붙든 말든 점수가
   * 같아서 종이가 아무 데나 떠돌았다. 스택 수는 단계 수에 대해 단조이므로
   * 임계값을 넘길 수 있을 때는 같은 답을 고르고, 넘길 수 없을 때도 사용자가
   * 지정한 콤보 옆에 종이를 붙여 둔다.
   */
  comboGoal: number
  goalHigh: number
  goalNormal: number
  base: number
  exclude: number
  /** exclude 와 struct 사이: 전체 콤보 단계 수 tie-breaker. */
  comboAll: number
  struct: number
  /** Delta scale for simulated annealing — one unit of the plain level sum. */
  baseUnit: number
}

export function buildScoreWeights(slots: GridSlot[], config?: BoardConfig): ScoreWeights {
  let excludeCap = 0
  let baseCap = 0
  let goalNormalCap = 0
  let goalHighCap = 0
  const comboSlugs = new Set<string>()
  const targetCombo = config?.targetCombo ?? null
  let targetBase = 0
  let paperCount = 0

  for (const item of slots) {
    if (!item || item.type !== 'ARTIFACT') continue
    const artifact = item as PlacedArtifact
    const sets = artifact.data.effect?.sets ?? []
    for (const slug of sets) comboSlugs.add(slug)
    if (artifact.data.value === WHITE_PAPER_VALUE) paperCount += 1
    if (targetCombo && sets.includes(targetCombo)) targetBase += 1
    const maxLevel = Math.max(0, artifact.data.level ?? 0)
    const cval = constraintKindOf(artifact) ? constraintValue(artifact) : 0

    if (artifact.priority === 'exclude') {
      excludeCap += maxLevel
      continue
    }
    const target = effectiveTarget(artifact)
    if (target === null) {
      baseCap += priorityWeight(artifact.priority) * (maxLevel + cval)
      continue
    }
    const goal = target + cval
    if (artifact.priority === 'high') goalHighCap += goal
    else goalNormalCap += goal
  }

  // comboAll is bounded by the slugs actually on the board: a 하얀 종이 can only add
  // stacks to a combo both its neighbours already carry, so no placement invents a
  // slug outside this set. Clamped like the structural band — see COMBO_TIEBREAK_CAP.
  let comboAllCapRaw = 0
  comboSlugs.forEach((slug) => {
    comboAllCapRaw += maxComboTiers(slug)
  })
  const comboAllCap = Math.min(comboAllCapRaw, COMBO_TIEBREAK_CAP)

  // 목표 콤보의 스택은 보드에 있는 그 태그 아티팩트 수 + 하얀 종이 장수를
  // 넘을 수 없다. 상수 대신 이 실측값을 상한으로 쓰면 밴드 사슬이 불필요하게
  // 부풀지 않는다 — 오버플로 여유가 거기서 나온다.
  const comboGoalCap = targetCombo
    ? Math.min(targetBase + paperCount, COMBO_GOAL_STACK_CAP)
    : 0

  // Structural tie-breakers are counts, clamped so the band cannot overflow — see
  // STRUCT_TIEBREAK_CAP. evaluateBoardDetail applies the same clamp.
  const structUnit = 1
  const structCap = STRUCT_TIEBREAK_CAP

  const comboAllUnit = structUnit * (structCap + 1)
  const excludeUnit = comboAllUnit * (comboAllCap + 1)
  const baseUnit = excludeUnit * (excludeCap + 1)
  const goalNormalUnit = baseUnit * (baseCap + 1)
  const goalHighUnit = goalNormalUnit * (goalNormalCap + 1)
  const comboGoalUnit = goalHighUnit * (goalHighCap + 1)

  return {
    comboGoal: comboGoalUnit,
    goalHigh: goalHighUnit,
    goalNormal: goalNormalUnit,
    base: baseUnit,
    exclude: excludeUnit,
    comboAll: comboAllUnit,
    struct: structUnit,
    baseUnit,
  }
}

function priorityWeight(priority: PlacedArtifact['priority']): number {
  return priority === 'high' ? 3 : 1
}

function complexPositionTiebreak(tablet: PlacedTablet, row: number, col: number, gridRows: GridRow[]): number {
  if (tablet.effectDef.type === 'simple') return 0
  const maxRowIndex = getMaxRow(gridRows)
  switch (tablet.data.value) {
    case 'linear':
      return row === maxRowIndex ? 1 : 0
    case 'shade':
      return row === 0 ? 1 : 0
    case 'boundary':
      return 1
    case 'justice': {
      const gridRow = gridRows.find((r) => r.rowIndex === row)
      return gridRow && (col === 0 || col === gridRow.cols - 1) ? 1 : 0
    }
    case 'concurrency':
    case 'base':
      return 1
    default:
      return 1
  }
}

// ── Per-artifact evaluation, shared by the optimizer and the UI ──

export interface ArtifactEvaluation {
  slotIndex: number
  artifact: PlacedArtifact
  /** Applied level delta on this cell: tabletBonus + cellLevel. */
  bonus: number
  /** 이 칸의 인벤토리 레벨 — BoardConfig.cellLevels 에서 온 각인 값. */
  cellLevel: number
  /** 석판만의 델타 (쉴드 적용 후), 칸 레벨 제외. */
  tabletBonus: number
  /** enchant + bonus, capped at the star maximum. 점수는 이 값만 쓴다. */
  finalLevel: number
  /** 자르기 전 enchant + bonus. 표시 전용 — rawLevelOf 주석 참고. */
  rawLevel: number
  destroyed: boolean
  constraintKind: ConstraintKind | null
  constraintStatus: ConstraintStatus
  /** Effective goal — see effectiveTarget. null when the artifact has none. */
  target: number | null
  /**
   * Whether the LEVEL target is reached. Deliberately independent of `constraintStatus`:
   * the UI reports 목표 강화 and 제약 충족 as two counters, so folding the constraint in
   * here would report a met level target as missed and count one failure twice.
   */
  goalMet: boolean
}

export interface BoardEvaluation {
  score: number
  destroyed: boolean
  artifacts: ArtifactEvaluation[]
  weights: ScoreWeights
  /** Post-shield level deltas, so callers need only one pass over the board. */
  effects: EffectMap
  /** Cells whose artifact `<제약>` is waived by 고양 / 이음 / 환대. */
  constraintIgnore: Set<string>
}

export function evaluateBoardDetail(
  slots: GridSlot[],
  gridRows: GridRow[],
  weights?: ScoreWeights,
  config?: BoardConfig
): BoardEvaluation {
  const w = weights ?? buildScoreWeights(slots, config)
  const shieldBypass = new Set<string>()
  const constraintIgnore = new Set<string>()
  const stats: EffectStats = { oobDebuffs: 0 }
  const rawEffects = calculateAllEffects(slots, gridRows, shieldBypass, stats, constraintIgnore)
  const effectMap = applyTabletShield(slots, gridRows, rawEffects, shieldBypass)

  const artifacts: ArtifactEvaluation[] = []
  let goalHigh = 0
  let goalNormal = 0
  let base = 0
  let exclude = 0
  let shieldCount = 0
  let positionBonus = 0
  let destroyed = false

  for (let i = 0; i < slots.length; i++) {
    const item = slots[i]
    if (!item) continue
    const pos = slotToPosition(i, gridRows)
    const posKey = `${pos.row}-${pos.col}`

    if (item.type === 'ARTIFACT') {
      const artifact = item as PlacedArtifact
      const tabletBonus = effectMap[posKey] ?? 0
      // 칸 레벨은 석판 효과가 아니라 칸에 각인된 값이므로 applyTabletShield 의 대상이
      // 아니다 — 쉴드는 석판 칸에 떨어진 음수 '석판 효과'만 0으로 만든다.
      //   "인벤토리가 -12칸 줄어들지만, '석판 각인' 기능이 활성화 됩니다. 석판을
      //    소모하여 해당하는 인벤토리 칸에 효과를 남깁니다"
      //   — namu.wiki/w/세피리아/재능 (생존 20)
      //   친타마니 돌: "부서진 곳의 인벤토리 레벨 +3" — data/artifacts.json
      // 칸 레벨이 음수라 finalLevel 이 -1 이하가 되면 isArtifactDestroyed 가 그대로
      // 작동한다 (의도된 동작).
      const cellLevel = config?.cellLevels?.[i] ?? 0
      const bonus = tabletBonus + cellLevel
      const finalLevel = finalLevelOf(artifact, bonus)
      const rawLevel = rawLevelOf(artifact, bonus)
      const isDestroyed = isArtifactDestroyed(finalLevel)
      if (isDestroyed) destroyed = true

      const kind = constraintKindOf(artifact)
      const status = resolveConstraintStatus(kind, i, slots, gridRows, constraintIgnore)
      const cval = kind && status !== 'unmet' ? constraintValue(artifact) : 0
      const target = effectiveTarget(artifact)
      const goalMet = target === null ? true : finalLevel >= target

      artifacts.push({
        slotIndex: i,
        artifact,
        bonus,
        cellLevel,
        tabletBonus,
        finalLevel,
        rawLevel,
        destroyed: isDestroyed,
        constraintKind: kind,
        constraintStatus: status,
        target,
        goalMet,
      })

      if (artifact.priority === 'exclude') {
        // 세트 효과는 제약과 무관하게 적용되므로, 제외 항목은 생존만 하면 충분하다.
        exclude += Math.max(0, finalLevel)
      } else if (target === null) {
        base += priorityWeight(artifact.priority) * (Math.max(0, finalLevel) + cval)
      } else {
        // 목표 초과분은 세지 않는다 (캡).
        const attained = Math.min(Math.max(0, finalLevel), target) + cval
        if (artifact.priority === 'high') goalHigh += attained
        else goalNormal += attained
      }
    } else if (item.type === 'TABLET') {
      const rawVal = rawEffects[posKey]
      if (typeof rawVal === 'number' && rawVal < 0 && !shieldBypass.has(posKey)) {
        shieldCount += 1
      }
      positionBonus += complexPositionTiebreak(item as PlacedTablet, pos.row, pos.col, gridRows)
    }
  }

  const struct = Math.min(
    stats.oobDebuffs + shieldCount + positionBonus,
    STRUCT_TIEBREAK_CAP
  )

  // 콤보 밴드. comboAll 을 항상 켜 두어도 안전한 이유: 콤보 수치는 하얀 종이 인접을
  // 통해서만 배치에 의존한다 ("[고유] 양쪽 칸에 배치된 아티팩트가 동일한 콤보인 경우,
  // 해당 콤보 수치 1 증가" — data/artifacts.json white_paper). 하얀 종이가 없는
  // 보드에서는 base 스택만 남아 이 항이 모든 순열에서 상수가 되므로 승패를 바꾸지
  // 못한다.
  const counts = comboCounts(slots, gridRows)
  const comboAll = Math.min(totalComboTiers(counts), COMBO_TIEBREAK_CAP)
  const targetCombo = config?.targetCombo ?? null
  // 단계 수가 아니라 스택 수 — 이유는 ScoreWeights.comboGoal 주석 참고.
  const comboGoal = targetCombo
    ? Math.min(counts.get(targetCombo)?.total ?? 0, COMBO_GOAL_STACK_CAP)
    : 0

  const score = destroyed
    ? DESTRUCTION_SCORE
    : w.comboGoal * comboGoal +
      w.goalHigh * goalHigh +
      w.goalNormal * goalNormal +
      w.base * base +
      w.exclude * exclude +
      w.comboAll * comboAll +
      w.struct * struct

  return { score, destroyed, artifacts, weights: w, effects: effectMap, constraintIgnore }
}

/** SA objective. Destruction is an absolute reject. */
export function evaluateBoard(
  slots: GridSlot[],
  gridRows: GridRow[],
  weights?: ScoreWeights,
  config?: BoardConfig
): number {
  return evaluateBoardDetail(slots, gridRows, weights, config).score
}

/** Plain capped level sum, for the UI's before/after readout. */
export function levelSumOnly(
  slots: GridSlot[],
  gridRows: GridRow[],
  config?: BoardConfig
): number {
  const detail = evaluateBoardDetail(slots, gridRows, undefined, config)
  if (detail.destroyed) return DESTRUCTION_SCORE
  return detail.artifacts.reduce((sum, a) => sum + a.finalLevel, 0)
}
