# Phase 0+1: Leader - 데이터 준비 & 아키텍처 설계

## 목표
실제 게임 데이터(241 아티팩트, 54 석판)를 정적 데이터로 구축하고,
모든 파트가 공유하는 타입/효과엔진/스토어를 설계한다.

---

## Task 0: 정적 게임 데이터 구축

### `data/artifacts.ts`
sephiria.wiki에서 추출한 241개 아티팩트 데이터.
```typescript
export const ARTIFACTS: ArtifactData[] = [
  {
    value: "reinforced_potion_lid",
    label_kor: "강화 포션 뚜껑",
    tier: "common",
    maxLevel: 0,
    image: "https://img.sephiria.wiki/artifacts/reinforced_potion_lid.webp",
    sets: ["mystery"],
    description: "..."
  },
  // ... 241개
]
```

### `data/tablets.ts`
54개 석판 + 효과 패턴 데이터.
```typescript
export const TABLETS: TabletData[] = [
  {
    value: "chivalry",
    label_kor: "기사도",
    tier: "common",
    image: "https://sephiria.wiki/slabs/chivalry.png",
    rotatable: true,
    effectType: "simple",
    effects: [{ dx: -1, dy: -2, value: 1 }]
  },
  {
    value: "miracle",
    label_kor: "기적",
    tier: "legend",
    image: "https://sephiria.wiki/slabs/miracle.png",
    rotatable: false,
    effectType: "complex",
    effects: [],  // 복합 로직은 effectEngine에서 처리
    complexDescription: "같은 행 + 같은 열 전체 +1 (십자형)"
  },
  // ... 54개
]
```

---

## Task 1: 공통 타입 설계 (`types/index.ts`)

### 실제 게임 데이터 기반 타입

```typescript
// 좌표
type Position = { row: number; col: number }

// 석판 효과 (본체 기준 상대 좌표)
type Effect = {
  dx: number     // 열 오프셋
  dy: number     // 행 오프셋 (음수 = 위)
  value: number  // -1 ~ +5
  flag?: 'ignore' // 정정: 제약 무시 (환대). 석판 방패 우회는 이 앱의 부수 규칙
}

// 아이템 등급
type Tier = 'common' | 'advanced' | 'rare' | 'legend' | 'solid'

// 아이템 유형
type ItemType = 'ARTIFACT' | 'TABLET'

// 아티팩트 정적 데이터 (data/artifacts.ts용)
interface ArtifactData {
  value: string
  label_kor: string
  tier: Tier
  maxLevel: number
  image: string
  sets: string[]
  description: string
}

// 석판 정적 데이터 (data/tablets.ts용)
interface TabletData {
  value: string
  label_kor: string
  tier: Tier
  image: string
  rotatable: boolean
  effectType: 'simple' | 'complex'
  effects: Effect[]
  complexDescription?: string
}

// 그리드에 배치된 아티팩트 인스턴스
interface PlacedArtifact {
  instanceId: string
  data: ArtifactData
  level: number          // 유저가 설정한 현재 강화 레벨
  currentLevel: number   // 석판 효과 적용 후 계산된 레벨
  isLocked: boolean
}

// 그리드에 배치된 석판 인스턴스
interface PlacedTablet {
  instanceId: string
  data: TabletData
  rotation: 0 | 1 | 2 | 3  // 0=0°, 1=90°, 2=180°, 3=270°
}

type PlacedItem = PlacedArtifact | PlacedTablet

// 그리드 슬롯
type GridSlot = PlacedItem | null

// 그리드 행 구조 (6열 기반, 마지막 행은 나머지)
interface GridRow {
  rowIndex: number
  cols: number  // 이 행의 열 수 (보통 6, 마지막 행은 ≤6)
}

// 효과 맵: "row-col" → 누적 효과값
type EffectMap = Record<string, number>  // 정정: 'ignore' 센티널 제거, BoardEffects.constraintIgnore 로 분리
```

### 설계 포인트 (기존 대비 변경)

- **GridCell 대신 슬롯 기반**: `null | 'blocked'` 대신 가변 크기 슬롯 배열 사용
- **rotation을 0~3 정수로**: `0|90|180|270` 대신 `0|1|2|3`으로 간소화 (시뮬레이터와 동일)
- **Effect.value 범위 확장**: +1/-1이 아닌 -1~+5
- **Effect.flag**: `ignore` 플래그로 석판 방패 무시 가능
- **EffectMap**: "row-col" 문자열 키로 효과 누적 (시뮬레이터 로직과 동일)
- **PlacedItem 분리**: 정적 데이터(xxxData)와 인스턴스(Placedxxx)를 분리

---

## Task 2: 효과 엔진 (`lib/effectEngine.ts`) — 핵심 모듈

석판 효과 계산의 **단일 소스**. Store와 Worker 모두 이 모듈을 사용.

### 아키텍처

```
effectEngine.ts (순수 함수)
  ├── calculateAllEffects(slots, gridRows) → EffectMap
  ├── applySimpleEffect(tablet, position, effectMap, gridRows)
  ├── applyComplexEffect(tablet, position, effectMap, gridRows)
  └── rotateEffect(dx, dy, rotation) → {newDx, newDy}

↑ import          ↑ import
store/             workers/
inventoryStore.ts  optimizer.worker.ts
```

### 단순 석판 효과 적용

```typescript
function applySimpleEffect(
  effects: Effect[],
  col: number, row: number,
  effectMap: EffectMap,
  rotation: number
) {
  effects.forEach(effect => {
    const { newDx, newDy } = rotateEffect(effect.dx, effect.dy, rotation)
    const key = `${row + newDy}-${col + newDx}`
    if (effectMap[key] !== undefined && effectMap[key] !== 'ignore') {
      effectMap[key] += effect.value ?? 1
    }
  })
}
```

### 복합 석판 효과 (13개) — 개별 함수 필요

| 석판 | 로직 요약 |
|------|----------|
| `linear` (선의) | 마지막 행에 위치 시 좌우 +1 |
| `home_town` (고양) | 회전 방향 한 칸 아티팩트의 `<제약>` 해제 (레벨 효과 없음) |
| `agglutination` (응집) | 위 +3, 회전 방향에 따라 행/열 전체 -1 |
| `transition` (전이) | 회전에 따라 행 +1·열 -1 또는 행 -1·열 +1 |
| `justice` (정의) | 맨 좌/우 열에 위치 시 해당 열 전체 +1 |
| `base` (기반) | 같은 행 전체 +1 (자신 제외) |
| `concurrency` (동시성) | 같은 열 전체 +1 (자신 제외) |
| `rebellion` (반항) | 대각선 방향 끝까지 +1 |
| `connection` (이음) | 위 +2, 아래 칸 아티팩트의 `<제약>` 해제 |
| `shade` (차양) | 첫 행에 위치 시 마지막 행 전체 +1 |
| `boundary` (경계) | 첫 행 + 마지막 행 전체 +1 |
| `sheen` (광휘) | 행/열 전체 +1 (회전 의존) + 위아래 +2 |
| `miracle` (기적) | 같은 행 + 같은 열 전체 +1 (십자형) |

### 회전 변환

```typescript
function rotateEffect(dx: number, dy: number, rotation: number) {
  // rotation: 0=0°, 1=90°, 2=180°, 3=270°
  switch (rotation) {
    case 0: return { newDx: dx, newDy: dy }
    case 1: return { newDx: -dy, newDy: dx }
    case 2: return { newDx: -dx, newDy: -dy }
    case 3: return { newDx: dy, newDy: -dx }
  }
}
```

---

## Task 3: Zustand 스토어 (`store/inventoryStore.ts`)

```typescript
interface InventoryState {
  // 그리드 상태
  slots: (PlacedItem | null)[]   // 1차원 배열 (index → row/col 변환)
  slotNum: number                 // 총 슬롯 수 (18~60, 기본 34)
  gridRows: GridRow[]             // 행별 열 수 정보

  // 사이드 팔레트
  availableArtifacts: ArtifactData[]  // 선택 가능한 아티팩트 목록
  availableTablets: TabletData[]      // 선택 가능한 석판 목록

  // 계산 결과
  effectMap: EffectMap                // 석판 효과 누적 맵
  enhancedArtifacts: Record<string, number>  // 아티팩트별 최종 레벨

  // UI 상태
  isOptimizing: boolean
  filterSet: string | 'all'           // 세트 필터

  // 액션
  setSlotNum: (num: number) => void
  placeItem: (item: PlacedItem, slotIndex: number) => void
  removeItem: (slotIndex: number) => void
  swapItems: (from: number, to: number) => void
  rotateTablet: (slotIndex: number) => void
  recalculate: () => void             // effectEngine 호출
  setGridFromWorker: (slots: (PlacedItem | null)[]) => void
  loadFromVisionAPI: (data: VisionAPIResponse) => void
}
```

### 핵심: 1차원 슬롯 배열 → 2차원 변환

```typescript
// slotIndex → (row, col)
function slotToPosition(index: number, gridRows: GridRow[]): Position {
  let remaining = index
  for (const row of gridRows) {
    if (remaining < row.cols) return { row: row.rowIndex, col: remaining }
    remaining -= row.cols
  }
}

// gridRows 생성 (시뮬레이터와 동일 로직)
function buildGridRows(slotNum: number): GridRow[] {
  const fullRows = Math.floor(slotNum / 6)
  const remainder = slotNum % 6
  const rows = Array.from({ length: fullRows }, (_, i) => ({ rowIndex: i, cols: 6 }))
  if (remainder > 0) rows.push({ rowIndex: fullRows, cols: remainder })
  return rows
}
```

---

## 구현 순서

```
1. types/index.ts — 공통 타입 정의
2. data/artifacts.ts — 241개 아티팩트 데이터 (JSON → TS)
3. data/tablets.ts — 54개 석판 데이터 (JSON → TS)
4. lib/rotationUtils.ts — 회전 변환 함수
5. lib/effectEngine.ts — 효과 계산 엔진 (41 단순 + 13 복합)
6. lib/gridUtils.ts — 슬롯↔좌표 변환, gridRows 생성
7. store/inventoryStore.ts — Zustand 스토어
8. 단위 테스트: effectEngine 전수 검증 (sephiria.wiki 시뮬레이터와 비교)
```

## 검증 기준

- [ ] 54개 석판 모두 effectEngine에서 올바른 효과 계산
- [ ] 복합 석판 13개의 위치 의존적 로직 정확
- [ ] 회전 변환 4방향 정확 (rotatable 석판만)
- [ ] ignore 플래그 및 ignore 셀 마킹 동작
- [ ] slotNum 변경 시 gridRows 재계산 정확
- [ ] 1차원 슬롯 ↔ 2차원 좌표 변환 정확
- [ ] effectEngine이 순수 함수로 Store와 Worker에서 동일 결과 보장
