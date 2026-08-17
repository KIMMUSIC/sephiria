// SA optimizer worker — shares effect math with lib/effectEngine.ts
import type {
  BoardConfig,
  GridRow,
  GridSlot,
  OptimizeRequest,
  PlacedTablet,
} from '@/types'
import { buildScoreWeights, evaluateBoard, evaluateBoardDetail } from '@/lib/optimizerScore'
import { comboCounts, totalComboTiers } from '@/lib/comboEngine'
import { nextRotation } from '@/lib/rotationUtils'

/** Progress readouts a human can act on — the banded score itself is not one. */
function readableProgress(slots: GridSlot[], gridRows: GridRow[], board: BoardConfig) {
  const detail = evaluateBoardDetail(slots, gridRows, undefined, board)
  let levelSum = 0
  let goalsMet = 0
  for (const a of detail.artifacts) {
    levelSum += Math.max(0, a.finalLevel)
    if (a.target !== null && a.goalMet) goalsMet += 1
  }
  const comboTiers = totalComboTiers(comboCounts(slots, gridRows))
  return { levelSum, goalsMet, comboTiers }
}

// ── Mutation ──
// 칸 레벨(BoardConfig.cellLevels)은 여기서 절대 움직이지 않는다: 칸에 각인된 값이라
// 아이템과 함께 이동하지 않고, 점수 쪽(evaluateBoardDetail)이 slot index 로 읽는다.
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
  const { type, slots, gridRows, config, board } = event.data
  if (type !== 'start') return

  // The artifact multiset never changes during the run, so the lexicographic band
  // units are fixed and can be computed once.
  const weights = buildScoreWeights(slots, board)
  // Temperature is expressed in plain-level units. Dividing the delta by the base
  // band unit keeps the annealing schedule meaningful across the priority bands:
  // a one-level trade reads as ~1, while giving up a goal reads as a large loss
  // that only a hot temperature will accept.
  const deltaScale = weights.baseUnit || 1

  let current: GridSlot[] = JSON.parse(JSON.stringify(slots))
  let best: GridSlot[] = JSON.parse(JSON.stringify(slots))
  let currentScore = evaluateBoard(current, gridRows, weights, board)
  let bestScore = currentScore
  let temp = config.initialTemp
  const startTime = performance.now()
  let iteration = 0

  while (temp > config.minTemp) {
    const elapsed = performance.now() - startTime
    if (elapsed >= config.maxTimeMs) break

    const neighbor = mutate(current, gridRows)
    const neighborScore = evaluateBoard(neighbor, gridRows, weights, board)
    const delta = neighborScore - currentScore

    if (delta > 0 || Math.random() < Math.exp(delta / deltaScale / temp)) {
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
      const readable = readableProgress(best, gridRows, board)
      self.postMessage({
        type: 'progress',
        iteration,
        bestScore,
        bestLevelSum: readable.levelSum,
        bestGoalsMet: readable.goalsMet,
        bestComboTiers: readable.comboTiers,
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
