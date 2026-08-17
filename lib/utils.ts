import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

/**
 * 한글 받침을 보고 조사를 고른다. '선의은(는)' 같은 기계적인 표기를 피하기 위함이다.
 *
 * 한글 음절은 U+AC00 부터 28개씩 묶여 종성이 순환하므로, (코드 - 0xAC00) % 28 이
 * 0이면 받침이 없다. 한글이 아닌 문자로 끝나면 판단할 근거가 없으므로
 * 괄호 표기로 둘러대진다.
 */
export function withParticle(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) {
    return `${word}${withFinal}(${withoutFinal})`
  }
  return `${word}${(code - 0xac00) % 28 !== 0 ? withFinal : withoutFinal}`
}
