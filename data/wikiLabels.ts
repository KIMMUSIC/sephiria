import type { Tier } from '@/types'

/** Wiki rarity names (나무위키 세피리아/아티팩트). */
export const TIER_KO: Record<Tier, string> = {
  common: '일반',
  advanced: '고급',
  rare: '희귀',
  legend: '전설',
  solid: '결속',
}

/**
 * Combo tag names, wiki section 3.1–3.20 order.
 * Slugs stay English (catalog keys); UI shows these labels.
 */
export const COMBO_KO: Record<string, string> = {
  firmness: '견고',
  shadow: '그림자',
  glacier: '빙하',
  lake: '호수',
  spring_song: '바람노래',
  mystery: '신비',
  magic_engineering: '마법공학',
  ice_weapon: '얼음무구',
  planet: '행성',
  precision: '정밀',
  colleague: '동료',
  yinggalbul: '잉걸불',
  extrium: '먹구름',
  element: '원소',
  guardian: '수호',
  bargaining: '교섭',
  curse: '저주',
  academy: '아카데미',
  sun_sword: '태양검',
  alchemy: '연금술',
}

export const COMBO_ORDER = [
  'firmness',
  'shadow',
  'glacier',
  'lake',
  'spring_song',
  'mystery',
  'magic_engineering',
  'ice_weapon',
  'planet',
  'precision',
  'colleague',
  'yinggalbul',
  'extrium',
  'element',
  'guardian',
  'bargaining',
  'curse',
  'academy',
  'sun_sword',
  'alchemy',
] as const
