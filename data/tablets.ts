import type { TabletData } from '@/types'
import rawTablets from './tablets.json'
import { publicMediaPath } from './mediaPaths'

export const TABLETS: TabletData[] = (rawTablets as TabletData[]).map((t) => ({
  ...t,
  image: publicMediaPath(t.image, 'slabs', t.value),
}))

export const TABLET_MAP = new Map<string, TabletData>(
  TABLETS.map((t) => [t.value, t])
)
