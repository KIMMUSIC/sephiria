import { describe, expect, it } from 'vitest'
import { artifactLevelState, artifactLevelText, wastedLevels } from '@/lib/levelDisplay'
import { buildScoreWeights, evaluateBoard, evaluateBoardDetail, finalLevelOf, rawLevelOf } from '@/lib/optimizerScore'
import { buildGridRows, positionToSlot } from '@/lib/gridUtils'
import { ARTIFACT_MAP } from '@/data/artifacts'
import type { GridSlot, PlacedArtifact } from '@/types'

describe('artifactLevelState / artifactLevelText', () => {
  it('5/5 → maxed', () => {
    expect(artifactLevelState(5, 5)).toBe('maxed')
    expect(artifactLevelText(5, 5)).toBe('5/5')
  })

  it('4/5 → partial', () => {
    expect(artifactLevelState(4, 5)).toBe('partial')
    expect(artifactLevelText(4, 5)).toBe('4/5')
  })

  it('0/5 → partial', () => {
    expect(artifactLevelState(0, 5)).toBe('partial')
    expect(artifactLevelText(0, 5)).toBe('0/5')
  })

  it('0/0 → fixed (별 0짜리는 풀강이 아니다)', () => {
    expect(artifactLevelState(0, 0)).toBe('fixed')
    expect(artifactLevelText(0, 0)).toBe('0/0')
  })

  it('-1/5 → destroyed', () => {
    expect(artifactLevelState(-1, 5)).toBe('destroyed')
    expect(artifactLevelText(-1, 5)).toBe('-1/5')
  })

  it('-3/4 → destroyed', () => {
    expect(artifactLevelState(-3, 4)).toBe('destroyed')
    expect(artifactLevelText(-3, 4)).toBe('-3/4')
  })

  it('별 14짜리 풀강 14/14 → maxed', () => {
    expect(artifactLevelState(14, 14)).toBe('maxed')
    expect(artifactLevelText(14, 14)).toBe('14/14')
  })

  it('currentLevel -1 이면 maxLevel 과 무관하게 destroyed', () => {
    expect(artifactLevelState(-1, 0)).toBe('destroyed')
    expect(artifactLevelState(-1, 1)).toBe('destroyed')
    expect(artifactLevelState(-1, 14)).toBe('destroyed')
  })
})

// ──────────────────────────────────────────────────────────────
describe('상한 초과 (7/5)', () => {
  it('상한을 넘으면 over 이고 자르지 않은 값으로 표기한다', () => {
    expect(artifactLevelState(7, 5)).toBe('over')
    expect(artifactLevelText(7, 5)).toBe('7/5')
    expect(wastedLevels(7, 5)).toBe(2)
  })

  it('상한과 같으면 여전히 maxed 다 (경계)', () => {
    expect(artifactLevelState(5, 5)).toBe('maxed')
    expect(wastedLevels(5, 5)).toBe(0)
    expect(artifactLevelState(6, 5)).toBe('over')
  })

  it('별 0짜리가 석판 몫을 받으면 fixed 가 아니라 over 다', () => {
    // 0 >= 0 이라 maxed 로, maxLevel <= 0 이라 fixed 로 잡힐 여지가 둘 다 있다.
    // 강화 불가 아이템 위에 석판을 얹는 것은 순수 낭비이므로 드러나야 한다.
    expect(artifactLevelState(2, 0)).toBe('over')
    expect(artifactLevelText(2, 0)).toBe('2/0')
    expect(artifactLevelState(0, 0)).toBe('fixed')
  })

  it('음수는 상한과 무관하게 destroyed 가 이긴다', () => {
    expect(artifactLevelState(-1, 0)).toBe('destroyed')
    expect(artifactLevelState(-2, 5)).toBe('destroyed')
  })
})

// ──────────────────────────────────────────────────────────────
// 표시는 자르지 않지만 점수는 잘라야 한다. 별은 상한이고 초과분은 버려지는 값이라
// (namu.wiki/w/세피리아/아티팩트), 점수가 초과를 세면 최적화가 쓸데없는 자리를 고른다.
describe('초과분은 점수에 들어가지 않는다', () => {
  const ROWS = buildGridRows(34)
  const at = (r: number, c: number) => positionToSlot(r, c, ROWS)!

  /** cold_lock 은 별 4짜리다. 인챈트를 상한까지 채워 둔다. */
  function boardAtCap(): GridSlot[] {
    const data = ARTIFACT_MAP.get('cold_lock')!
    const artifact: PlacedArtifact = {
      instanceId: 'a-cap', type: 'ARTIFACT', data,
      level: data.level, currentLevel: data.level,
      isLocked: false, priority: 'normal', targetLevel: null,
    }
    const slots: GridSlot[] = new Array(34).fill(null)
    slots[at(1, 1)] = artifact
    return slots
  }

  it('finalLevelOf 는 자르고 rawLevelOf 는 자르지 않는다', () => {
    const data = ARTIFACT_MAP.get('cold_lock')!
    const artifact = boardAtCap()[at(1, 1)] as PlacedArtifact
    expect(finalLevelOf(artifact, 2)).toBe(data.level)
    expect(rawLevelOf(artifact, 2)).toBe(data.level + 2)
  })

  it('칸 레벨로 상한을 넘겨도 점수가 오르지 않는다', () => {
    const slots = boardAtCap()
    const none = new Array(34).fill(0)
    const surplus = new Array(34).fill(0)
    surplus[at(1, 1)] = 2

    const detailNone = evaluateBoardDetail(slots, ROWS, undefined, { cellLevels: none })
    const detailOver = evaluateBoardDetail(slots, ROWS, undefined, { cellLevels: surplus })

    // 표시는 갈라진다
    expect(detailNone.artifacts[0].rawLevel).toBe(4)
    expect(detailOver.artifacts[0].rawLevel).toBe(6)
    // 점수는 같다
    expect(detailOver.artifacts[0].finalLevel).toBe(detailNone.artifacts[0].finalLevel)
    const weights = buildScoreWeights(slots)
    expect(evaluateBoard(slots, ROWS, weights, { cellLevels: surplus })).toBe(
      evaluateBoard(slots, ROWS, weights, { cellLevels: none })
    )
  })
})
