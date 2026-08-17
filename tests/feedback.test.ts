import { describe, expect, it } from 'vitest'
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_MIN_LENGTH,
  formatFeedback,
  validateFeedback,
} from '@/lib/feedback'

describe('validateFeedback', () => {
  it.each(FEEDBACK_CATEGORIES)('유형 "%s" 을(를) 통과시킨다', (category) => {
    const result = validateFeedback({ category, message: '테스트 메시지입니다' })
    expect(result).toEqual({
      ok: true,
      value: { category, message: '테스트 메시지입니다' },
    })
  })

  it('객체가 아니면 거부한다', () => {
    for (const raw of [null, undefined, 'string', 42]) {
      expect(validateFeedback(raw)).toEqual({ ok: false, error: '잘못된 요청입니다' })
    }
  })

  it('알 수 없는 유형을 거부한다', () => {
    expect(validateFeedback({ category: '칭찬', message: '테스트 메시지입니다' })).toEqual({
      ok: false,
      error: '문의 유형을 선택해 주세요',
    })
  })

  it('message 가 문자열이 아니면 거부한다', () => {
    expect(validateFeedback({ category: '버그', message: 123 })).toEqual({
      ok: false,
      error: '내용을 입력해 주세요',
    })
  })

  // 경계는 상수가 아니라 숫자로 못 박는다. 상수로 길이를 만들면 상수를 바꿨을 때
  // 테스트가 따라 움직여서 초록으로 남고, 제품 요구(4자 거부 / 5자 통과,
  // 2000자 통과 / 2001자 거부)가 깨진 것을 CI 가 잡지 못한다.
  it('상수가 제품 요구와 일치한다', () => {
    expect(FEEDBACK_MIN_LENGTH).toBe(5)
    expect(FEEDBACK_MAX_LENGTH).toBe(2000)
  })

  it('4자는 거부하고 5자는 통과시킨다 (최소 길이 경계)', () => {
    expect(validateFeedback({ category: '버그', message: '가'.repeat(4) })).toEqual({
      ok: false,
      error: '내용을 5자 이상 입력해 주세요',
    })
    const result = validateFeedback({ category: '버그', message: '가'.repeat(5) })
    expect(result.ok).toBe(true)
  })

  it('2000자는 통과시키고 2001자는 거부한다 (최대 길이 경계)', () => {
    const result = validateFeedback({ category: '버그', message: '가'.repeat(2000) })
    expect(result.ok).toBe(true)
    expect(validateFeedback({ category: '버그', message: '가'.repeat(2001) })).toEqual({
      ok: false,
      error: '내용은 2000자까지 보낼 수 있습니다',
    })
  })

  it('공백뿐인 message 를 거부한다', () => {
    expect(validateFeedback({ category: '버그', message: '     \n\t   ' })).toEqual({
      ok: false,
      error: '내용을 5자 이상 입력해 주세요',
    })
  })

  it('message 를 trim 해서 담는다', () => {
    const result = validateFeedback({ category: '건의', message: '  앞뒤 공백 제거  ' })
    expect(result).toEqual({
      ok: true,
      value: { category: '건의', message: '앞뒤 공백 제거' },
    })
  })
})

describe('formatFeedback', () => {
  it('정확한 형식으로 출력한다', () => {
    expect(formatFeedback({ category: '데이터 오류', message: '유물 42번 수치가 다릅니다' })).toBe(
      '[세피리아 최적화 · 데이터 오류]\n유물 42번 수치가 다릅니다',
    )
  })
})
