import type { Tier } from '@/types'
import { TIER_KO } from '@/data/wikiLabels'

export { TIER_KO as TIER_LABELS }

export const TIER_COLORS: Record<Tier, string> = {
  common: 'border-tier-common text-tier-common',
  advanced: 'border-tier-advanced text-tier-advanced',
  rare: 'border-tier-rare text-tier-rare',
  legend: 'border-tier-legend text-tier-legend',
  solid: 'border-tier-solid text-tier-solid',
}

export const TIER_BG: Record<Tier, string> = {
  common: 'bg-tier-common/20',
  advanced: 'bg-tier-advanced/20',
  rare: 'bg-tier-rare/20',
  legend: 'bg-tier-legend/20',
  solid: 'bg-tier-solid/20',
}

export const ALL_TIERS: Tier[] = ['common', 'advanced', 'rare', 'legend', 'solid']
