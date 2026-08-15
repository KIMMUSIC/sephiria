import type { Effect } from '@/types'

export function rotateEffect(
  dx: number,
  dy: number,
  rotation: 0 | 1 | 2 | 3
): { newDx: number; newDy: number } {
  switch (rotation) {
    case 0:
      return { newDx: dx, newDy: dy }
    case 1:
      return { newDx: -dy, newDy: dx }
    case 2:
      return { newDx: -dx, newDy: -dy }
    case 3:
      return { newDx: dy, newDy: -dx }
  }
}

export function rotateEffects(effects: Effect[], rotation: 0 | 1 | 2 | 3): Effect[] {
  return effects.map((e) => {
    const { newDx, newDy } = rotateEffect(e.dx, e.dy, rotation)
    return { ...e, dx: newDx, dy: newDy }
  })
}

export function nextRotation(current: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  return ((current + 1) % 4) as 0 | 1 | 2 | 3
}
