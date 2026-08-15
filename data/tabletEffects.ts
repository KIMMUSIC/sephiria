import type { TabletEffectDef } from '@/types'
import rawEffects from './tabletEffects.json'

export const TABLET_EFFECTS: Record<string, TabletEffectDef> =
  rawEffects as Record<string, TabletEffectDef>

export function getTabletEffect(value: string): TabletEffectDef | undefined {
  return TABLET_EFFECTS[value]
}
