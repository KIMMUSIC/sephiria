import { describe, expect, it } from 'vitest'
import {
  PREVIEW_COLS,
  PREVIEW_ROW_COUNT,
  previewPlacement,
  satisfiesCondition,
} from '@/lib/fusionPreview'
import type { FusedSource } from '@/types'
import { withParticle } from '@/lib/utils'

function src(value: string): FusedSource {
  return { value, rotation: 0 }
}

describe('satisfiesCondition', () => {
  it('알 수 없는 문자열은 true 를 돌려 미리보기를 막지 않는다', () => {
    expect(satisfiesCondition('대각선', 2, 2, PREVIEW_ROW_COUNT, PREVIEW_COLS)).toBe(true)
    expect(satisfiesCondition('', 0, 0, PREVIEW_ROW_COUNT, PREVIEW_COLS)).toBe(true)
  })

  it('가장자리 조건을 칸 좌표로 판정한다', () => {
    expect(satisfiesCondition('최상단', 0, 3, PREVIEW_ROW_COUNT, PREVIEW_COLS)).toBe(true)
    expect(satisfiesCondition('최상단', 1, 3, PREVIEW_ROW_COUNT, PREVIEW_COLS)).toBe(false)
    expect(satisfiesCondition('최하단', PREVIEW_ROW_COUNT - 1, 2, PREVIEW_ROW_COUNT, PREVIEW_COLS)).toBe(
      true
    )
    expect(satisfiesCondition('왼쪽 끝', 2, 0, PREVIEW_ROW_COUNT, PREVIEW_COLS)).toBe(true)
    expect(satisfiesCondition('오른쪽 끝', 2, PREVIEW_COLS - 1, PREVIEW_ROW_COUNT, PREVIEW_COLS)).toBe(
      true
    )
  })
})

describe('previewPlacement', () => {
  it('조건 없는 석판(base) 하나는 중앙 · 가운데 · dormant 없음', () => {
    const p = previewPlacement([src('base')])
    expect(p.row).toBe(2)
    expect(p.col).toBe(2)
    expect(p.slot).toBe(2 * PREVIEW_COLS + 2)
    expect(p.label).toBe('가운데')
    expect(p.firing).toEqual(['base'])
    expect(p.dormant).toEqual([])
  })

  it('linear(선의) 는 최하단에 놓인다', () => {
    const p = previewPlacement([src('linear')])
    expect(p.row).toBe(PREVIEW_ROW_COUNT - 1)
    expect(p.label).toContain('최하단')
    expect(p.firing).toContain('linear')
    expect(p.dormant).toEqual([])
  })

  it('shade(차양) 는 최상단에 놓인다', () => {
    const p = previewPlacement([src('shade')])
    expect(p.row).toBe(0)
    expect(p.label).toContain('최상단')
    expect(p.firing).toContain('shade')
    expect(p.dormant).toEqual([])
  })

  it('flag(깃발) 는 왼쪽 끝에 놓인다', () => {
    const p = previewPlacement([src('flag')])
    expect(p.col).toBe(0)
    expect(p.label).toContain('왼쪽 끝')
    expect(p.firing).toContain('flag')
    expect(p.dormant).toEqual([])
  })

  it('justice(정의) 는 OR 로 왼쪽 끝 또는 오른쪽 끝에서 켜진다', () => {
    const p = previewPlacement([src('justice')])
    const onLeft = p.col === 0
    const onRight = p.col === PREVIEW_COLS - 1
    expect(onLeft || onRight).toBe(true)
    expect(p.dormant).toEqual([])
    expect(p.firing).toEqual(['justice'])
  })

  it('linear + flag 는 최하단 왼쪽 끝에서 둘 다 켠다', () => {
    const p = previewPlacement([src('linear'), src('flag')])
    expect(p.row).toBe(PREVIEW_ROW_COUNT - 1)
    expect(p.col).toBe(0)
    expect(p.label).toBe('최하단 왼쪽 끝')
    expect(p.firing).toEqual(['linear', 'flag'])
    expect(p.dormant).toEqual([])
  })

  it('linear + shade 는 동시에 만족 불가 — 하나만 켜고 하나만 끈다', () => {
    const p = previewPlacement([src('linear'), src('shade')])
    expect(p.firing).toHaveLength(1)
    expect(p.dormant).toHaveLength(1)
    expect([...p.firing, ...p.dormant].sort()).toEqual(['linear', 'shade'])
  })

  it('조건 있는 재료 + 조건 없는 재료는 조건 없는 쪽이 항상 firing 에 있다', () => {
    const p = previewPlacement([src('linear'), src('base')])
    expect(p.firing).toContain('base')
    expect(p.dormant).not.toContain('base')
  })
})

// ──────────────────────────────────────────────────────────────
// 안내 문구가 '선의은(는)' 처럼 나오지 않게 받침으로 조사를 고른다.
describe('withParticle', () => {
  it('받침이 없으면 는 / 가', () => {
    expect(withParticle('선의', '은', '는')).toBe('선의는')
    expect(withParticle('정의', '은', '는')).toBe('정의는')
    expect(withParticle('기적', '이', '가')).toBe('기적이')
  })

  it('받침이 있으면 은 / 이', () => {
    expect(withParticle('깃발', '은', '는')).toBe('깃발은')
    expect(withParticle('차양', '은', '는')).toBe('차양은')
  })

  it('여러 이름을 · 로 이어도 마지막 글자를 본다', () => {
    expect(withParticle('선의·차양', '은', '는')).toBe('선의·차양은')
    expect(withParticle('차양·선의', '은', '는')).toBe('차양·선의는')
  })

  it('한글이 아닌 문자로 끝나면 괄호 표기로 물러난다', () => {
    expect(withParticle('linear', '은', '는')).toBe('linear은(는)')
  })
})
