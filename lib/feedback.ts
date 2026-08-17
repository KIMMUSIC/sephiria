export const FEEDBACK_CATEGORIES = ['버그', '건의', '데이터 오류', '기타'] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]
export const FEEDBACK_MIN_LENGTH = 5
export const FEEDBACK_MAX_LENGTH = 2000

export interface FeedbackInput {
  category: FeedbackCategory
  message: string
}

export type FeedbackValidation =
  | { ok: true; value: FeedbackInput }
  | { ok: false; error: string }

export function validateFeedback(raw: unknown): FeedbackValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: '잘못된 요청입니다' }
  }
  const { category, message } = raw as Record<string, unknown>
  if (!FEEDBACK_CATEGORIES.includes(category as FeedbackCategory)) {
    return { ok: false, error: '문의 유형을 선택해 주세요' }
  }
  if (typeof message !== 'string') {
    return { ok: false, error: '내용을 입력해 주세요' }
  }
  const trimmed = message.trim()
  if (trimmed.length < FEEDBACK_MIN_LENGTH) {
    return { ok: false, error: '내용을 5자 이상 입력해 주세요' }
  }
  if (trimmed.length > FEEDBACK_MAX_LENGTH) {
    return { ok: false, error: '내용은 2000자까지 보낼 수 있습니다' }
  }
  return { ok: true, value: { category: category as FeedbackCategory, message: trimmed } }
}

// 익명 원칙: IP, User-Agent, 시각 등 식별 가능한 정보는 붙이지 않는다.
export function formatFeedback(value: FeedbackInput): string {
  return `[세피리아 최적화 · ${value.category}]\n${value.message}`
}
