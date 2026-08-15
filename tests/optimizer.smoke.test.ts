import { describe, expect, it } from 'vitest'
import { evaluateBoard, TIEBREAK, DESTRUCTION_SCORE } from '@/lib/optimizerScore'
import { buildGridRows, positionToSlot } from '@/lib/gridUtils'
import { nextRotation } from '@/lib/rotationUtils'
import { getTabletEffect } from '@/data/tabletEffects'
import { DEFAULT_SA_CONFIG } from '@/types'
import type { GridRow, GridSlot, PlacedArtifact, PlacedTablet } from '@/types'

function tablet(value: string, rotation: 0 | 1 | 2 | 3 = 0): PlacedTablet {
  return {
    instanceId: `t-${value}-${rotation}`,
    type: 'TABLET',
    data: { value, ko_label: value, eng_label: value, tier: 'rare', image: '', rotate: true },
    effectDef: getTabletEffect(value) ?? { type: 'simple', effects: [] },
    rotation,
    isCustom: false,
  }
}

function artifact(id: string, level: number, locked = false): PlacedArtifact {
  return {
    instanceId: id,
    type: 'ARTIFACT',
    data: {
      id: 1, value: id, label_kor: id, label_eng: id, tier: 'common', level: 5,
      image: '', effect: { sets: [], content: '' }, description: '',
    },
    level, currentLevel: level, isLocked: locked,
  }
}

function mutate(slots: GridSlot[]): GridSlot[] {
  const next = JSON.parse(JSON.stringify(slots)) as GridSlot[]
  const r = Math.random()
  if (r < 0.5) {
    const idx = next.map((_, i) => i).filter(i => !next[i] || (next[i] as { type: string }).type !== 'ARTIFACT' || !(next[i] as PlacedArtifact).isLocked)
    if (idx.length < 2) return next
    const a = idx[Math.floor(Math.random() * idx.length)]
    let b = idx[Math.floor(Math.random() * idx.length)]
    if (a !== b) { const t = next[a]; next[a] = next[b]; next[b] = t }
  } else if (r < 0.8) {
    const rot = next.map((item, i) => ({ item, i })).filter(x => x.item?.type === 'TABLET' && (x.item as PlacedTablet).data.rotate)
    if (rot.length) {
      const { i } = rot[Math.floor(Math.random() * rot.length)]
      const t = next[i] as PlacedTablet
      next[i] = { ...t, rotation: nextRotation(t.rotation) }
    }
  } else {
    const filled = next.map((item, i) => ({ item, i })).filter(x => x.item && (x.item.type === 'TABLET' || !(x.item as PlacedArtifact).isLocked))
    const empty = next.map((item, i) => ({ item, i })).filter(x => !x.item)
    if (filled.length && empty.length) {
      const from = filled[Math.floor(Math.random() * filled.length)].i
      const to = empty[Math.floor(Math.random() * empty.length)].i
      next[to] = next[from]
      next[from] = null
    }
  }
  return next
}

function runSA(slots: GridSlot[], gridRows: GridRow[], maxTimeMs = 400) {
  let current = JSON.parse(JSON.stringify(slots)) as GridSlot[]
  let best = JSON.parse(JSON.stringify(slots)) as GridSlot[]
  let currentScore = evaluateBoard(current, gridRows)
  let bestScore = currentScore
  let temp = DEFAULT_SA_CONFIG.initialTemp
  const start = Date.now()
  let iteration = 0
  while (temp > DEFAULT_SA_CONFIG.minTemp && Date.now() - start < maxTimeMs) {
    const neighbor = mutate(current)
    const neighborScore = evaluateBoard(neighbor, gridRows)
    const delta = neighborScore - currentScore
    if (delta > 0 || Math.random() < Math.exp(delta / temp)) {
      current = neighbor
      currentScore = neighborScore
    }
    if (currentScore > bestScore) {
      best = JSON.parse(JSON.stringify(current))
      bestScore = currentScore
    }
    temp *= DEFAULT_SA_CONFIG.coolingRate
    iteration++
  }
  return { bestScore, startScore: evaluateBoard(slots, gridRows), iteration, best }
}

describe('optimizer smoke', () => {
  it('improves a deliberately bad layout and never destroys artifacts', () => {
    const slotNum = 34
    const gridRows = buildGridRows(slotNum)
    const slots: GridSlot[] = new Array(slotNum).fill(null)
    slots[0] = artifact('a1', 2)
    slots[1] = artifact('a2', 2)
    slots[2] = artifact('a3', 2)
    slots[6] = tablet('advent', 0)
    slots[7] = tablet('certitude', 2)
    slots[20] = tablet('yearning', 0)
    const start = evaluateBoard(slots, gridRows)
    expect(start).not.toBe(DESTRUCTION_SCORE)
    const { bestScore, iteration, best } = runSA(slots, gridRows, 500)
    expect(iteration).toBeGreaterThan(50)
    expect(bestScore).toBeGreaterThanOrEqual(start)
    expect(evaluateBoard(best, gridRows)).not.toBe(DESTRUCTION_SCORE)
    const artifactCount = best.filter(s => s?.type === 'ARTIFACT').length
    expect(artifactCount).toBe(3)
  })

  it('empty or tablet-only board does not throw', () => {
    const gridRows = buildGridRows(34)
    const slots: GridSlot[] = new Array(34).fill(null)
    expect(evaluateBoard(slots, gridRows)).toBe(0)
    slots[0] = tablet('miracle')
    expect(() => evaluateBoard(slots, gridRows)).not.toThrow()
  })

  it('level-sum outranks any amount of heuristic tie-breakers', () => {
    const gridRows = buildGridRows(34)
    // Artifacts sit on row 2 so shade/boundary/linear/flag do not change their levels.
    const mid = positionToSlot(2, 2, gridRows)!
    const mid2 = positionToSlot(2, 3, gridRows)!

    const better: GridSlot[] = new Array(34).fill(null)
    better[mid] = artifact('a1', 3)
    better[mid2] = artifact('a2', 3)

    const worse: GridSlot[] = new Array(34).fill(null)
    worse[mid] = artifact('a1', 2)
    worse[mid2] = artifact('a2', 3)
    worse[0] = tablet('shade', 0)
    worse[positionToSlot(5, 1, gridRows)!] = tablet('linear', 0)
    worse[1] = tablet('boundary', 0)
    worse[positionToSlot(0, 0, gridRows)!] = tablet('justice', 0)
    worse[positionToSlot(5, 0, gridRows)!] = tablet('flag', 0)

    const high = evaluateBoard(better, gridRows)
    const low = evaluateBoard(worse, gridRows)
    expect(Math.floor(high)).toBe(6)
    expect(Math.floor(low)).toBe(5)
    expect(high).toBeGreaterThan(low)
    expect(high - low).toBeGreaterThan(0.5)
  })

  it('keeps locked artifacts in place across mutations', () => {
    const slots: GridSlot[] = new Array(12).fill(null)
    slots[3] = artifact('locked', 4, true)
    slots[0] = artifact('free', 2)
    slots[1] = tablet('cheer', 0)
    for (let i = 0; i < 200; i++) {
      const next = mutate(slots)
      expect(next[3]?.type).toBe('ARTIFACT')
      expect((next[3] as PlacedArtifact).instanceId).toBe('locked')
      expect((next[3] as PlacedArtifact).isLocked).toBe(true)
    }
  })

  it('counts OOB debuffs from complex flag via the effect engine', () => {
    const gridRows = buildGridRows(34)
    const slots: GridSlot[] = new Array(34).fill(null)
    slots[0] = artifact('a1', 3)
    // flag on left edge of last row: down-1 is OOB
    const last = positionToSlot(5, 0, gridRows)
    expect(last).not.toBeNull()
    slots[last!] = tablet('flag', 0)
    const score = evaluateBoard(slots, gridRows)
    // primary = 3; OOB -1 from flag should add TIEBREAK
    expect(score).toBeGreaterThan(3)
    expect(score).toBeLessThan(4)
  })
})
