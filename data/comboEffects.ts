import type { ComboTier } from '@/types'

/**
 * 콤보(태그) 효과 임계값 — 나무위키 세피리아/아티팩트 3.1~3.20 표를 그대로 옮긴 값.
 *
 * 콤보는 누적식이다:
 *   "콤보 효과의 적용 방식도 누적식으로 변경되어, 스택 10을 달성한 콤보는 2부터 10까지의
 *    모든 효과를 합산하여 적용받는다" — namu.wiki/w/세피리아/아티팩트
 * 그래서 한 콤보의 가치는 '도달한 단계 수'로 읽는다 — comboTiersMet 참고.
 *
 * 임계값이 콤보마다 다르다는 점이 중요하다. 대부분 2/4/6/8/10 이지만 호수는 3/6/9,
 * 원소는 2/4/6, 신비·교섭·저주는 2/4, 연금술은 1/2/3 이다. 하얀 종이의 +1 이
 * 실제로 효과를 만드는지는 이 표 없이는 판정할 수 없다.
 */
export interface ComboDef {
  /** UI 표기용 한글 이름. data/wikiLabels.ts의 COMBO_KO와 같은 값이다. */
  ko: string
  /** 임계값 오름차순. 각 단계의 텍스트는 툴팁으로 그대로 보여준다. */
  tiers: ComboTier[]
}

export const COMBO_EFFECTS: Record<string, ComboDef> = {
  firmness: {
    ko: "견고",
    tiers: [
      { count: 2, text: "+2 물리 피해" },
      { count: 4, text: "+4 물리 피해" },
      { count: 6, text: "+6 물리 피해" },
      { count: 8, text: "+8 물리 피해" },
      { count: 10, text: "+15% 물리 피해 증폭" },
    ],
  },
  shadow: {
    ko: "그림자",
    tiers: [
      { count: 2, text: "+2 회피" },
      { count: 4, text: "+4 회피" },
      { count: 6, text: "+6 회피" },
      { count: 8, text: "+8 회피" },
      { count: 10, text: "+10 회피" },
    ],
  },
  glacier: {
    ko: "빙하",
    tiers: [
      { count: 2, text: "서리 손길 효과 활성화" },
      { count: 4, text: "+6 얼음속성 피해" },
      { count: 6, text: "서리 손길 재사용 대기시간 가속 150%" },
      { count: 8, text: "+8 얼음속성 피해" },
      { count: 10, text: "빙결에 필요한 동상 중첩 수 -1" },
    ],
  },
  lake: {
    ko: "호수",
    tiers: [
      { count: 3, text: "+20 최대 MP, +5 MP 재생" },
      { count: 6, text: "+30 최대 MP, +10% MP를 소모하는 능력의 피해량" },
      { count: 9, text: "+40 최대 MP, +25% MP를 소모하는 능력의 피해량" },
    ],
  },
  spring_song: {
    ko: "바람노래",
    tiers: [
      { count: 2, text: "+8% 공격 속도" },
      { count: 4, text: "+12% 공격 속도" },
      { count: 6, text: "+16% 공격 속도" },
      { count: 8, text: "+20% 공격 속도" },
      { count: 10, text: "+15% 무기 피해량, +1 대시 횟수" },
    ],
  },
  mystery: {
    ko: "신비",
    tiers: [
      { count: 2, text: "무작위 1칸" },
      { count: 4, text: "무작위 2칸" },
    ],
  },
  magic_engineering: {
    ko: "마법공학",
    tiers: [
      { count: 2, text: "전격 손길 효과 활성화" },
      { count: 4, text: "+6 번개속성 피해" },
      { count: 6, text: "전격 손길 재사용 대기시간 가속 150%" },
      { count: 8, text: "+8 번개속성 피해" },
      { count: 10, text: "감전이 발동하는 시간 -1초" },
    ],
  },
  ice_weapon: {
    ko: "얼음무구",
    tiers: [
      { count: 2, text: "+6% 얼음 무구 충전 속도" },
      { count: 4, text: "+8% 얼음 무구 충전 속도" },
      { count: 6, text: "+6% 얼음 무구의 피해량" },
      { count: 8, text: "+8% 얼음 무구의 피해량" },
      { count: 10, text: "얼음 무구가 1회 추가 발동" },
    ],
  },
  planet: {
    ko: "행성",
    tiers: [
      { count: 2, text: "+8% 행성 피해량" },
      { count: 4, text: "+10% 행성 피해량" },
      { count: 6, text: "+12% 행성 피해량" },
      { count: 8, text: "+14% 행성 피해량" },
      { count: 10, text: "+16% 행성 피해량, +12% 행성 공격 속도" },
    ],
  },
  precision: {
    ko: "정밀",
    tiers: [
      { count: 2, text: "+4% 치명타 확률" },
      { count: 4, text: "+6% 치명타 확률" },
      { count: 6, text: "+8% 치명타 확률" },
      { count: 8, text: "+10% 치명타 확률" },
      { count: 10, text: "+30% 치명타 피해" },
    ],
  },
  colleague: {
    ko: "동료",
    tiers: [
      { count: 2, text: "+6% 동료가 입히는 피해량" },
      { count: 4, text: "+8% 동료가 입히는 피해량" },
      { count: 6, text: "+10% 동료가 입히는 피해량, +15 동료들의 방어력" },
      { count: 8, text: "+12% 동료가 입히는 피해량, +20 동료들의 방어력" },
      { count: 10, text: "+20% 동료가 입히는 피해량, +40% 동료 부활 시간 가속" },
    ],
  },
  yinggalbul: {
    ko: "잉걸불",
    tiers: [
      { count: 2, text: "화염 손길 효과 활성화" },
      { count: 4, text: "+6 화염속성 피해" },
      { count: 6, text: "화염 손길 재사용 대기시간 가속 150%" },
      { count: 8, text: "+8 화염속성 피해" },
      { count: 10, text: "화상의 기본 피해 배율이 18->28%로 변경" },
    ],
  },
  extrium: {
    ko: "먹구름",
    tiers: [
      { count: 2, text: "먹구름 활성화 (기본 용량 15)" },
      { count: 4, text: "+8 먹구름 용량" },
      { count: 6, text: "+12 먹구름 용량" },
      { count: 8, text: "+16 먹구름 용량" },
      { count: 10, text: "+20 먹구름 용량, 먹구름이 2점사로 공격함" },
    ],
  },
  element: {
    ko: "원소",
    tiers: [
      { count: 2, text: "+5 가장 높은 속성 피해" },
      { count: 4, text: "+6 가장 높은 속성 피해" },
      { count: 6, text: "모든 속성 피해 10% 증폭" },
    ],
  },
  guardian: {
    ko: "수호",
    tiers: [
      { count: 2, text: "+6 방어력" },
      { count: 4, text: "+7 방어력" },
      { count: 6, text: "+8 방어력" },
      { count: 8, text: "+10 방어력" },
      { count: 10, text: "+12 방어력, +5% 방어 관통" },
    ],
  },
  bargaining: {
    ko: "교섭",
    tiers: [
      { count: 2, text: "+10 협상력, +15% 잎 드롭" },
      { count: 4, text: "+15 협상력, 황금손: 소지한 잎 200개당 적에게 주는 피해 +1% (최대 20%)" },
    ],
  },
  curse: {
    ko: "저주",
    tiers: [
      { count: 2, text: "+10% 디버프로 가하는 피해량, +7% 이동 속도" },
      { count: 4, text: "+15% 디버프로 가하는 피해량" },
    ],
  },
  academy: {
    ko: "아카데미",
    tiers: [
      { count: 2, text: "+8 마법서 가속" },
      { count: 4, text: "+12 마법서 가속" },
      { count: 6, text: "+16 마법서 가속" },
      { count: 8, text: "+20 마법서 가속" },
      { count: 10, text: "+15% 마법서 피해량, +8 MP 재생" },
    ],
  },
  sun_sword: {
    ko: "태양검",
    tiers: [
      { count: 2, text: "효과 활성화(기본 검 ×5)" },
      { count: 4, text: "+6% 태양검 피해량" },
      { count: 6, text: "+8% 태양검 피해량, +1 태양검 개수 상한" },
      { count: 8, text: "+10% 태양검 피해량, +2 태양검 개수 상한" },
      { count: 10, text: "+12% 태양검 피해량, +6 태양검 개수 상한" },
    ],
  },
  alchemy: {
    ko: "연금술",
    tiers: [
      { count: 1, text: "+1 포션 가방 슬롯" },
      { count: 2, text: "+1 포션 가방 슬롯" },
      { count: 3, text: "무작위 포션 1개 (일반~희귀)" },
    ],
  },
}

/** 이 콤보에서 count개를 모았을 때 도달한 단계 수. 없는 콤보 슬러그는 0. */
export function comboTiersMet(slug: string, count: number): number {
  const def = COMBO_EFFECTS[slug]
  if (!def) return 0
  let met = 0
  for (const tier of def.tiers) {
    if (count >= tier.count) met += 1
  }
  return met
}

/** count 다음으로 노려볼 임계값. 이미 마지막 단계면 null. */
export function nextComboTier(slug: string, count: number): ComboTier | null {
  const def = COMBO_EFFECTS[slug]
  if (!def) return null
  return def.tiers.find((tier) => count < tier.count) ?? null
}

/** 한 콤보가 가질 수 있는 최대 단계 수 — 점수 밴드 상한 계산용. */
export function maxComboTiers(slug: string): number {
  return COMBO_EFFECTS[slug]?.tiers.length ?? 0
}
