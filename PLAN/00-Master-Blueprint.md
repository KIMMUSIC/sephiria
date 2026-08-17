# 세피리아(Sephiria) 인벤토리 최적화 서비스 - 마스터 청사진

## 프로젝트 개요

세피리아 게임의 인벤토리(6열 x 가변행 그리드)에서 아티팩트와 석판을 최적으로 배치하는 웹 서비스.
스크린샷 → AI 인식 → 유저 검증 → 자동 최적 배치 파이프라인을 구현한다.

## 실제 게임 데이터 (sephiria.wiki 추출)

| 항목 | 수량 | 등급 분포 |
|------|------|-----------|
| 아티팩트 | 241개 | common(36), advanced(92), rare(66), legend(32), solid(15) |
| 석판 | 54개 | common(13), advanced(23), rare(8), legend(10) |

### 아티팩트 특성
- 최대 강화 레벨: 0~14 (대부분 1~5, 충격 증폭기가 14로 최고)
- 세트 효과(sets) 시스템 존재: `glacier`, `mystery`, `extrium`, `magic_engineering` 등
- 이미지: `https://img.sephiria.wiki/artifacts/{value}.webp|png`

### 석판 특성
- **단순 석판 (41개)**: 정적 상대 좌표 효과 (`{dx, dy, value}`)
- **복합 석판 (13개)**: 위치 의존적 동적 로직 (같은 행/열 전체, 대각선 무한 등)
- **효과값 범위**: -1 ~ +5 (단순 +1/-1이 아님!)
- **특수 플래그**: `ignore` (석판 방패 무시), `ignore` 셀 마킹
- 회전 가능 석판: 41개, 회전 불가: 13개
- 이미지: `https://sephiria.wiki/slabs/{value}.png|webp`

### 그리드 구조 (기존 청사진 대비 변경)
- **6열 고정, 행 수 가변** (슬롯 18~60개, 기본 34개)
- 행은 6열씩 채우고 마지막 행은 나머지 (예: 34슬롯 → 5행x6열 + 1행x4열)
- blocked 칸 없음 — 슬롯 수에 따라 그리드 크기가 결정됨

## 핵심 게임 메커니즘 (수정)

| 개념 | 설명 |
|------|------|
| **아티팩트(Artifact)** | 레벨을 가진 아이템. 석판 효과에 의해 레벨이 증감 |
| **석판(Tablet/Slab)** | 주변 칸에 버프/디버프 효과를 발산. 효과값은 +1~+5, -1 |
| **석판 방패** | 디버프 대상 칸에 다른 석판이 있으면 디버프 무효화 |
| **ignore 플래그** | ~~특정 석판(환대, 이음 등)은 석판 방패를 무시하고 효과 적용~~ → 환대의 `flag:'ignore'`는 **제약 무시** |
| **ignore 셀 마킹** | ~~고양, 이음 석판은 대상 셀을 "ignore" 상태로 만들어 다른 효과 차단~~ → 고양·이음은 대상 칸 아티팩트의 **`<제약>`을 해제**하며, 다른 석판 효과는 그대로 적용된다 |
| **파괴** | 아티팩트의 currentLevel ≤ 0이면 파괴 → 최적화에서 절대 회피 |
| **장외 홈런** | 디버프 방향이 그리드 밖이면 페널티 없음 |
| **복합 석판** | 위치에 따라 효과가 달라지는 석판 (기반, 정의, 차양, 경계 등) |
| **`<제약>`** | 아티팩트 11개가 배치 조건을 가진다. 미충족 시 **고유 효과만** 꺼지고 레벨·콤보는 그대로 |
| **인챈트** | 아티팩트 기본 레벨 0, 인챈트 1회당 +1. 카탈로그 `level`은 **별 상한**이며 시작값이 아니다 |
| **석판 합성** | 두 석판 → 하나. 증감 영역·레벨 증감량·제약 무시 영역·회전 제약·배치 제약을 모두 계승 |
> **[정정 2026-08-17]** 아래의 `ignore` 설명은 위키 문구 오독이었다. 나무위키 원문:
> "석판의 효과는 아티팩트 레벨 증가, 아티팩트 레벨 감소, **아티팩트 제약 조건 무시** 3가지가 있으며",
> "고양 석판 — 심플하게 아티팩트의 **제약조건을 해소하는 기능만** 있는 석판",
> "환대 — 두 칸에 **레벨 강화와 제약 무시를 동시에** 제공한다".
> 즉 `ignore`는 **셀의 석판 효과를 차단하는 것이 아니라, 그 칸 아티팩트의 `<제약>`을 해제**한다.
> 제약 무시 석판은 고양·이음·환대 3개뿐이다. 구현과 근거 인용은 `lib/effectEngine.ts`,
> `lib/constraints.ts`, `tests/rules.test.ts` 참조. 이 문서의 옛 서술은 이력 보존용으로만 남긴다.

| **세트 효과** | 아티팩트가 특정 세트에 속하며, 세트 필터링 UI 필요 |

## 기술 스택

```
Next.js 14+ (App Router) / React 18+ / TypeScript 5+
Tailwind CSS + shadcn/ui (스타일링)
Zustand (전역 상태 관리)
@dnd-kit/core (드래그 앤 드롭)
OpenAI API - gpt-4o (Vision 이미지 분석)
Web Worker (최적화 알고리즘 비동기 실행)
```

## 전체 데이터 플로우

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  1. 스크린샷     │────▶│  2. Vision API    │────▶│  3. 유저 검증    │
│  업로드          │     │  (gpt-4o)        │     │  + 커스텀 석판   │
│  ImageUploader   │     │  analyze-inventory│     │  CustomTabletModal│
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                        ┌──────────────────┐              │
                        │  2-B. 수동 입력   │──────────────┤
                        │  (직접 배치)      │              │
                        └──────────────────┘              │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  6. UI 렌더링    │◀────│  5. 결과 반영     │◀────│  4. 자동 배치    │
│  InventoryGrid   │     │  Zustand Store   │     │  Web Worker      │
│  (DnD + 시각화)  │     │  calculateLevels │     │  SA Algorithm    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## 프로젝트 디렉토리 구조

```
app/
├── api/
│   └── analyze-inventory/
│       └── route.ts              # Vision API 엔드포인트
├── layout.tsx
├── page.tsx                      # 메인 페이지
└── globals.css

components/
├── grid/
│   ├── InventoryGrid.tsx         # 6열 x N행 DnD 그리드
│   ├── GridCell.tsx              # 개별 셀 (오버레이 포함)
│   └── EffectOverlay.tsx         # 버프/디버프 시각화
├── items/
│   ├── ItemCard.tsx              # 아이템 카드 렌더링
│   ├── ArtifactCard.tsx          # 아티팩트 (레벨 뱃지)
│   └── TabletCard.tsx            # 석판 (효과 방향 표시)
├── upload/
│   ├── ImageUploader.tsx         # 스크린샷 업로드 + 검증
│   └── ManualInput.tsx           # 수동 아이템 선택 UI
├── editors/
│   └── CustomTabletModal.tsx     # 5x5 커스텀 석판 에디터
├── panels/
│   ├── ItemPalette.tsx           # 아이템/석판 선택 팔레트
│   ├── OptimizePanel.tsx         # 최적화 실행 패널
│   └── ResultSummary.tsx         # 최적화 결과 요약
└── ui/                           # shadcn/ui 컴포넌트

data/
├── artifacts.ts                  # 241개 아티팩트 정적 데이터
├── tablets.ts                    # 54개 석판 정적 데이터
└── tabletEffects.ts              # 석판 효과 패턴 (41 단순 + 13 복합)

lib/
├── gridUtils.ts                  # 그리드 계산 유틸리티
├── effectEngine.ts               # 석판 효과 계산 엔진 (핵심!)
└── rotationUtils.ts              # 회전 변환 함수

store/
└── inventoryStore.ts             # Zustand 전역 스토어

workers/
└── optimizer.worker.ts           # SA 알고리즘 Web Worker

hooks/
├── useOptimizer.ts               # Worker 호출 커스텀 훅
└── useDragAndDrop.ts             # DnD 로직 훅

types/
└── index.ts                      # 공통 타입 정의
```

## 개발 순서 (의존성 기반)

```
Phase 0: 데이터 준비
  ├── data/artifacts.ts           ← 241개 아티팩트 정적 데이터
  ├── data/tablets.ts             ← 54개 석판 정적 데이터
  └── data/tabletEffects.ts       ← 효과 패턴 함수

Phase 1: 기반 (Leader)
  ├── types/index.ts              ← 공통 타입 (실제 게임 데이터 기반)
  ├── lib/effectEngine.ts         ← 석판 효과 계산 엔진
  ├── lib/gridUtils.ts            ← 그리드 유틸리티
  └── store/inventoryStore.ts     ← 상태 관리

Phase 2: 핵심 로직 (Frontend + Algorithm 병렬)
  ├── [Frontend] InventoryGrid + DnD
  ├── [Frontend] 실시간 효과 시각화
  ├── [Algorithm] evaluateBoard()
  └── [Algorithm] optimizer.worker.ts

Phase 3: AI 연동 (Image)
  ├── analyze-inventory API Route
  ├── ImageUploader + 검증 플로우
  └── CustomTabletModal 연동

Phase 4: 통합 & 폴리싱
  ├── 전체 파이프라인 연결
  ├── 수동 입력 모드
  └── UI/UX 최종 마무리 (ui-ux-pro-max 활용)
```

## 핵심 아키텍처 변경 (기존 대비)

| 변경사항 | 기존 | 변경 후 |
|---------|------|---------|
| 그리드 크기 | 고정 6x4 | 6열 x 가변행 (슬롯 18~60) |
| 효과값 | +1/-1 | -1 ~ +5 다양 |
| 석판 효과 | 단순 상대좌표 | 41 단순 + 13 복합(위치의존적) |
| 석판 방패 | 일괄 적용 | ignore 플래그로 예외 존재 |
| 셀 상태 | null/blocked/Item | null/Item + "ignore" 효과 상태 |
| 데이터 소스 | Vision API만 | Vision API + 정적 데이터(241+54) + 수동입력 |
| effectEngine | Store 내부 | 별도 모듈(순수함수) → Store + Worker 공유 |

## 리스크 & 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 복합 석판 로직 오류 | 레벨 오산 | sephiria.wiki 시뮬레이터와 동일 결과 비교 테스트 |
| Vision API 인식률 불안정 | 잘못된 초기 상태 | 정적 데이터 매칭 + 수동 입력 폴백 |
| SA 복합 석판 평가 비용 | 성능 저하 | 복합 석판 캐싱, 변이 시 영향 범위만 재계산 |
| ignore 메커니즘 미구현 | 게임 룰 불일치 | effectEngine 단위 테스트로 전수 검증 |
