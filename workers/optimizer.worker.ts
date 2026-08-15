// SA optimizer worker — shares effect math with lib/effectEngine.ts
import type {
  GridRow,
  GridSlot,
  OptimizeRequest,
  PlacedTablet,
} from '@/types'
import { evaluateBoard } from '@/lib/optimizerScore'
import { nextRotation } from '@/lib/rotationUtils'

// ── Mutation ──
function mutate(slots: GridSlot[], _gridRows: GridRow[]): GridSlot[] {
  const newSlots = JSON.parse(JSON.stringify(slots)) as GridSlot[]
  const r = Math.random()

  if (r < 0.5) {
    const indices = newSlots.map((_, i) => i).filter((i) => {
      const item = newSlots[i]
      return !item || item.type === 'TABLET' || (item.type === 'ARTIFACT' && !item.isLocked)
    })
    if (indices.length < 2) return newSlots
    const i1 = indices[Math.floor(Math.random() * indices.length)]
    let i2 = indices[Math.floor(Math.random() * indices.length)]
    let tries = 0
    while (i2 === i1 && tries < 10) {
      i2 = indices[Math.floor(Math.random() * indices.length)]
      tries++
    }
    if (i2 !== i1) {
      const temp = newSlots[i1]
      newSlots[i1] = newSlots[i2]
      newSlots[i2] = temp
    }
  } else if (r < 0.8) {
    const rotatableIndices = newSlots
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => item && item.type === 'TABLET' && (item as PlacedTablet).data.rotate)
      .map(({ i }) => i)
    if (rotatableIndices.length === 0) return newSlots
    const idx = rotatableIndices[Math.floor(Math.random() * rotatableIndices.length)]
    const tablet = newSlots[idx] as PlacedTablet
    newSlots[idx] = { ...tablet, rotation: nextRotation(tablet.rotation) }
  } else {
    const filledIndices = newSlots
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => item && (item.type === 'TABLET' || (item.type === 'ARTIFACT' && !item.isLocked)))
      .map(({ i }) => i)
    const emptyIndices = newSlots.map((item, i) => ({ item, i })).filter(({ item }) => !item).map(({ i }) => i)
    if (filledIndices.length === 0 || emptyIndices.length === 0) return newSlots
    const fromIdx = filledIndices[Math.floor(Math.random() * filledIndices.length)]
    const toIdx = emptyIndices[Math.floor(Math.random() * emptyIndices.length)]
    newSlots[toIdx] = newSlots[fromIdx]
    newSlots[fromIdx] = null
  }

  return newSlots
}

// ── SA Main Loop ──
self.onmessage = (event: MessageEvent<OptimizeRequest>) => {
  const { type, slots, gridRows, config } = event.data
  if (type !== 'start') return

  let current: GridSlot[] = JSON.parse(JSON.stringify(slots))
  let best: GridSlot[] = JSON.parse(JSON.stringify(slots))
  let currentScore = evaluateBoard(current, gridRows)
  let bestScore = currentScore
  let temp = config.initialTemp
  const startTime = performance.now()
  let iteration = 0

  while (temp > config.minTemp) {
    const elapsed = performance.now() - startTime
    if (elapsed >= config.maxTimeMs) break

    const neighbor = mutate(current, gridRows)
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

    temp *= config.coolingRate
    iteration++

    if (iteration % 2000 === 0) {
      self.postMessage({
        type: 'progress',
        iteration,
        bestScore,
        temp,
      })
    }
  }

  self.postMessage({
    type: 'result',
    slots: best,
    score: bestScore,
    iterations: iteration,
  })
}
