
import { it } from 'vitest'
import { applyTabletShield, calculateAllEffects } from '@/lib/effectEngine'
import { buildGridRows, slotToPosition } from '@/lib/gridUtils'
import { nextRotation } from '@/lib/rotationUtils'
import { getTabletEffect } from '@/data/tabletEffects'
import { DEFAULT_SA_CONFIG } from '@/types'
import { DESTRUCTION_SCORE, isArtifactDestroyed } from '@/lib/optimizerScore'
import type { GridRow, GridSlot, PlacedArtifact, PlacedTablet } from '@/types'

function tablet(value: string, rotation: 0 | 1 | 2 | 3 = 0): PlacedTablet {
  return {
    instanceId: `t-${value}`,
    type: 'TABLET',
    data: { value, ko_label: value, eng_label: value, tier: 'rare', image: '', rotate: true },
    effectDef: getTabletEffect(value) ?? { type: 'simple', effects: [] },
    rotation,
    isCustom: false,
  }
}
function artifact(id: string, level: number): PlacedArtifact {
  return {
    instanceId: id, type: 'ARTIFACT',
    data: { id: 1, value: id, label_kor: id, label_eng: id, tier: 'common', level: 5, image: '', effect: { sets: [], content: '' }, description: '' },
    level, currentLevel: level, isLocked: false,
  }
}
function artifactScore(slots: GridSlot[], gridRows: GridRow[]): number {
  const bypass = new Set<string>()
  const raw = calculateAllEffects(slots, gridRows, bypass)
  const map = applyTabletShield(slots, gridRows, raw, bypass)
  let score = 0
  for (let i = 0; i < slots.length; i++) {
    const item = slots[i]
    if (!item || item.type !== 'ARTIFACT') continue
    const pos = slotToPosition(i, gridRows)
    const bonus = map[`${pos.row}-${pos.col}`]
    const finalLevel = item.level + (typeof bonus === 'number' ? bonus : 0)
    if (isArtifactDestroyed(finalLevel)) return DESTRUCTION_SCORE
    score += finalLevel
  }
  return score
}
function mutate(slots: GridSlot[]): GridSlot[] {
  const next = JSON.parse(JSON.stringify(slots)) as GridSlot[]
  const r = Math.random()
  if (r < 0.5) {
    const idx = next.map((_, i) => i).filter(i => !next[i] || (next[i] as any).type !== 'ARTIFACT' || !(next[i] as PlacedArtifact).isLocked)
    if (idx.length >= 2) {
      const a = idx[Math.floor(Math.random() * idx.length)]
      let b = idx[Math.floor(Math.random() * idx.length)]
      if (a !== b) { const t = next[a]; next[a] = next[b]; next[b] = t }
    }
  } else if (r < 0.8) {
    const rot = next.map((item, i) => ({ item, i })).filter(x => x.item?.type === 'TABLET')
    if (rot.length) {
      const { i } = rot[Math.floor(Math.random() * rot.length)]
      const t = next[i] as PlacedTablet
      next[i] = { ...t, rotation: nextRotation(t.rotation) }
    }
  } else {
    const filled = next.map((item, i) => ({ item, i })).filter(x => x.item)
    const empty = next.map((item, i) => ({ item, i })).filter(x => !x.item)
    if (filled.length && empty.length) {
      const from = filled[Math.floor(Math.random() * filled.length)].i
      const to = empty[Math.floor(Math.random() * empty.length)].i
      next[to] = next[from]; next[from] = null
    }
  }
  return next
}

it('bench print', () => {
  const gridRows = buildGridRows(34)
  const slots: GridSlot[] = new Array(34).fill(null)
  slots[0] = artifact('a1', 2)
  slots[1] = artifact('a2', 2)
  slots[2] = artifact('a3', 2)
  slots[3] = artifact('a4', 3)
  slots[6] = tablet('advent', 0)
  slots[7] = tablet('certitude', 2)
  slots[8] = tablet('yearning', 0)
  slots[9] = tablet('miracle', 0)
  const start = artifactScore(slots, gridRows)
  let current = JSON.parse(JSON.stringify(slots)) as GridSlot[]
  let best = current
  let currentScore = start
  let bestScore = start
  let temp = DEFAULT_SA_CONFIG.initialTemp
  const t0 = Date.now()
  let it = 0
  while (temp > DEFAULT_SA_CONFIG.minTemp && Date.now() - t0 < 2000) {
    const n = mutate(current)
    const ns = artifactScore(n, gridRows)
    if (ns - currentScore > 0 || Math.random() < Math.exp((ns - currentScore) / temp)) {
      current = n; currentScore = ns
    }
    if (currentScore > bestScore) { best = JSON.parse(JSON.stringify(current)); bestScore = currentScore }
    temp *= DEFAULT_SA_CONFIG.coolingRate
    it++
  }
  console.log(JSON.stringify({ start, bestScore, iterations: it, elapsedMs: Date.now() - t0 }))
})
