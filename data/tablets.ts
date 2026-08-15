import type { TabletData } from '@/types'
import rawTablets from './tablets.json'

// Map to local paths in public/images/slabs/
export const TABLETS: TabletData[] = (rawTablets as TabletData[]).map((t) => {
  const ext = t.image.endsWith('.webp') ? 'webp' : 'png'
  return { ...t, image: `/images/slabs/${t.value}.${ext}` }
})

export const TABLET_MAP = new Map<string, TabletData>(
  TABLETS.map((t) => [t.value, t])
)
