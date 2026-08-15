# Phase 2B: Algorithm - 자동 배치 최적화 엔진

## 목표
Web Worker 기반 Simulated Annealing으로 아티팩트와 석판의 최적 배치를 탐색한다.
effectEngine을 공유하여 정확한 채점을 보장하며, 1.5~2초 내에 최적해를 도출한다.

---

## 핵심 설계: effectEngine 공유

```
lib/effectEngine.ts (순수 함수, 외부 의존성 없음)
  │
  ├── import ← store/inventoryStore.ts (메인 스레드)
  └── import ← workers/optimizer.worker.ts (Worker 스레드)
```

Worker에서 Zustand 접근 불가 → effectEngine이 순수 함수여야 하는 이유.
**동일 입력 → 동일 출력** 보장으로 Store와 Worker의 계산 일관성 확보.

---

## Task 1: 채점 함수 (`evaluateBoard`)

### 점수 산출

```typescript
function evaluateBoard(
  slots: (PlacedItem | null)[],
  gridRows: GridRow[]
): number {
  // 1. effectEngine으로 전체 효과 계산
  const effectMap = calculateAllEffects(slots, gridRows)

  let score = 0
  let destroyed = false

  // 2. 아티팩트별 최종 레벨 계산
  slots.forEach((item, index) => {
    if (!item || item.data.type !== 'ARTIFACT') return
    const artifact = item as PlacedArtifact
    const key = slotToKey(index, gridRows)
    const bonus = typeof effectMap[key] === 'number' ? effectMap[key] : 0
    const finalLevel = artifact.level + bonus

    if (finalLevel <= 0) {
      destroyed = true
    }
    score += finalLevel
  })

  // 3. 절대 기피: 파괴 발생 시 폐기
  if (destroyed) return -99999

  // 4. 장외 홈런 & 석판 방패 가점
  slots.forEach((item, index) => {
    if (!item || !('rotation' in item)) return
    const tablet = item as PlacedTablet
    if (tablet.data.effectType !== 'simple') return  // 복합 석판은 별도 평가

    const pos = slotToPosition(index, gridRows)
    tablet.data.effects.forEach(effect => {
      const { newDx, newDy } = rotateEffect(effect.dx, effect.dy, tablet.rotation)
      const targetRow = pos.row + newDy
      const targetCol = pos.col + newDx

      if (effect.value < 0) {
        // 디버프가 그리드 밖 → 장외 홈런
        if (!isValidSlot(targetRow, targetCol, gridRows)) {
          score += 10
        }
        // 디버프가 석판에 흡수 → 석판 방패
        else {
          const targetSlot = positionToSlot(targetRow, targetCol, gridRows)
          if (targetSlot !== null && slots[targetSlot] && 'rotation' in slots[targetSlot]!) {
            score += 10
          }
        }
      }
    })
  })

  // 5. 복합 석판 배치 보너스 (위치 의존적 석판이 유리한 위치에 있을 때)
  slots.forEach((item, index) => {
    if (!item || !('rotation' in item)) return
    const tablet = item as PlacedTablet
    if (tablet.data.effectType !== 'complex') return
    // 정의: 맨 좌/우 열에 있으면 보너스
    // 차양: 첫 행에 있으면 보너스
    // 등 위치 적합성 평가 가점
    score += evaluateComplexPlacement(tablet, index, gridRows)
  })

  return score
}
```

### 점수 체계

| 요소 | 점수 | 설명 |
|------|------|------|
| 아티팩트 최종 레벨 | +N | 모든 아티팩트 (level + effectBonus) 총합 |
| 파괴 (최종레벨 ≤ 0) | -99999 | 단 하나라도 파괴되면 즉시 폐기 |
| 장외 홈런 | +10 | 디버프가 그리드 밖을 가리킴 |
| 석판 방패 | +10 | 디버프가 다른 석판에 흡수됨 |
| 복합 석판 최적 위치 | +5~15 | 위치 의존 석판이 유리한 위치에 배치됨 |

---

## Task 2: Simulated Annealing (`workers/optimizer.worker.ts`)

### 파라미터

```typescript
interface SAConfig {
  initialTemp: number      // 초기 온도 (기본: 100)
  coolingRate: number      // 냉각 속도 (기본: 0.9995)
  minTemp: number          // 최소 온도 (기본: 0.01)
  maxTimeMs: number        // 최대 실행 시간 (기본: 2000ms)
}
```

### Worker 메인 루프

```typescript
// onmessage: { slots, gridRows, config } 수신

function optimize(slots, gridRows, config): PlacedItem[] {
  let current = structuredClone(slots)
  let currentScore = evaluateBoard(current, gridRows)
  let best = structuredClone(current)
  let bestScore = currentScore
  let temp = config.initialTemp
  const startTime = performance.now()
  let iteration = 0

  while (temp > config.minTemp && performance.now() - startTime < config.maxTimeMs) {
    const neighbor = mutate(current, gridRows)
    const neighborScore = evaluateBoard(neighbor, gridRows)

    const delta = neighborScore - currentScore
    if (delta > 0 || Math.random() < Math.exp(delta / temp)) {
      current = neighbor
      currentScore = neighborScore
    }

    if (currentScore > bestScore) {
      best = structuredClone(current)
      bestScore = currentScore
    }

    temp *= config.coolingRate
    iteration++

    // 매 2000회마다 진행 상황 전송
    if (iteration % 2000 === 0) {
      postMessage({ type: 'progress', iteration, bestScore, temp })
    }
  }

  postMessage({ type: 'result', slots: best, score: bestScore, iterations: iteration })
}
```

### 변이(Mutation) 전략

```typescript
function mutate(slots, gridRows) {
  const clone = structuredClone(slots)

  // isLocked 아닌 아이템만 대상
  const movable = clone.map((item, i) => ({ item, index: i }))
    .filter(({ item }) => item && !('isLocked' in item && item.isLocked))

  const r = Math.random()

  if (r < 0.5) {
    // A. 랜덤 두 아이템 위치 스왑 (50%)
    // 빈 슬롯도 스왑 대상에 포함 (아이템을 빈 칸으로 이동하는 효과)
    swapTwoRandom(clone, gridRows)
  } else if (r < 0.8) {
    // B. 랜덤 석판 90도 회전 (30%) — rotatable인 석판만
    rotateRandomTablet(clone)
  } else {
    // C. 랜덤 아이템을 빈 슬롯으로 이동 (20%)
    moveToEmptySlot(clone, gridRows)
  }

  return clone
}
```

**변이 C 추가 이유**: 복합 석판은 특정 위치에서만 효과 발동 → 위치 변경이 중요.

---

## Custom Hook: `hooks/useOptimizer.ts`

```typescript
interface UseOptimizerReturn {
  isOptimizing: boolean
  progress: { iteration: number; bestScore: number; temp: number } | null
  optimize: (config?: Partial<SAConfig>) => void
  cancel: () => void
}
```

### 생명주기

```
1. optimize() 호출
2. 현재 store.slots + store.gridRows → Worker에 postMessage
3. isOptimizing = true
4. Worker 'progress' 메시지 → progress 상태 업데이트
5. Worker 'result' 메시지 → store.setGridFromWorker(result.slots)
6. store.recalculate() 자동 호출
7. isOptimizing = false
```

---

## 성능 최적화

| 항목 | 전략 |
|------|------|
| structuredClone 비용 | 슬롯 배열만 복사 (data 참조는 공유) |
| evaluateBoard 비용 | 복합 석판 수에 비례. 복합 석판이 적으면 빠름 |
| 증분 계산 (미래 최적화) | 변이 영향 범위만 재계산 (전체 recalculate 대신) |
| Worker 통신 | 최종 결과 + 2000회마다 progress만 전송 |

---

## 검증 기준

- [ ] `evaluateBoard`가 파괴 시 -99999 정확 적용
- [ ] 장외 홈런/석판 방패 가점 정확
- [ ] `isLocked` 아이템이 변이 대상에서 제외
- [ ] SA가 명백한 최적해를 2초 내에 수렴
- [ ] Worker가 메인 스레드를 블록하지 않음
- [ ] progress 메시지가 UI에 반영됨
- [ ] effectEngine을 Store와 Worker에서 동일하게 사용
- [ ] 복합 석판의 위치 이동이 점수에 유의미한 영향
