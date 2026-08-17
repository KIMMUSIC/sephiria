import { describe, expect, it } from 'vitest'
import { artifactLevelState, artifactLevelText } from '@/lib/levelDisplay'

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
