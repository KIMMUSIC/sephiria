# Phase 3: Image - Vision API 연동 & 검증 플로우

## 목표
게임 인벤토리 스크린샷을 OpenAI Vision API로 분석하여 그리드 상태를 자동 추출하고,
**241개 아티팩트 + 54개 석판 정적 데이터와 매칭**하여 정확도를 높인다.

---

## 핵심 변경: 정적 데이터 매칭 전략

Vision API의 raw 응답을 그대로 사용하지 않고, **정적 데이터와 매칭**한다.

```
Vision API 응답: "강화 포션 뚜껑" (이름 인식)
        ↓
정적 데이터 매칭: artifacts.find(a => a.label_kor === "강화 포션 뚜껑")
        ↓
매칭 성공 → 정적 데이터의 image, maxLevel, sets 등 활용
매칭 실패 → isCustom: true 플래그
```

이미지 매칭도 보조 수단으로 활용 가능:
- Vision API가 이름을 정확히 못 읽어도, 이미지 유사도로 매칭 가능
- 아티팩트: `https://img.sephiria.wiki/artifacts/{value}.webp|png`
- 석판: `https://sephiria.wiki/slabs/{value}.png|webp`

---

## Task 1: Vision API 엔드포인트 (`app/api/analyze-inventory/route.ts`)

### API 설계

```
POST /api/analyze-inventory
Content-Type: application/json

Request:
{
  "image": "data:image/png;base64,...",
  "slotNum": 34  // 유저가 설정한 슬롯 수
}

Response:
{
  "slots": [
    {
      "slotIndex": 0,
      "recognized": {
        "name": "강화 포션 뚜껑",
        "type": "ARTIFACT",
        "level": 3,
        "matchedValue": "reinforced_potion_lid",  // 정적 데이터 매칭 키
        "confidence": 0.95
      }
    },
    {
      "slotIndex": 5,
      "recognized": {
        "name": "알 수 없는 합성 석판",
        "type": "TABLET",
        "matchedValue": null,     // 매칭 실패
        "isCustom": true,
        "confidence": 0.3
      }
    },
    { "slotIndex": 7, "recognized": null }  // 빈 슬롯
  ]
}
```

### 시스템 프롬프트 (영문)

```
You are an expert at analyzing game inventory screenshots from "Sephiria".

The inventory grid has 6 columns. Analyze the screenshot and identify each item:

**Known Artifacts** (return exact name match from this list):
[List of 241 artifact Korean names]

**Known Tablets/Slabs** (return exact name match from this list):
[List of 54 tablet Korean names]

For each occupied slot, return:
- name: exact Korean name as shown
- type: "ARTIFACT" or "TABLET"
- level: enhancement level number (for artifacts only, shown as +N)
- slotIndex: position in the grid (0-indexed, left-to-right, top-to-bottom)
- confidence: 0.0-1.0 how certain you are about this identification

CRITICAL: If an item doesn't match any known name (especially composite/fused tablets
from jar synthesis), set isCustom: true and DO NOT guess. Return whatever partial
name you can read.

Return JSON array of slot objects. Empty slots should have recognized: null.
```

### 후처리: 정적 데이터 매칭

```typescript
function matchWithStaticData(recognized: RecognizedItem): MatchResult {
  if (recognized.type === 'ARTIFACT') {
    // 이름 정확 매칭
    let match = ARTIFACTS.find(a => a.label_kor === recognized.name)
    // 퍼지 매칭 (유사도 0.8 이상)
    if (!match) match = fuzzyMatch(recognized.name, ARTIFACTS, 'label_kor', 0.8)
    if (match) return { matched: true, data: match, isCustom: false }
    return { matched: false, isCustom: true }
  }

  if (recognized.type === 'TABLET') {
    let match = TABLETS.find(t => t.label_kor === recognized.name)
    if (!match) match = fuzzyMatch(recognized.name, TABLETS, 'label_kor', 0.8)
    if (match) return { matched: true, data: match, isCustom: false }
    return { matched: false, isCustom: true }
  }
}
```

---

## Task 2: 검증 UI (`components/upload/ImageUploader.tsx`)

### 전체 플로우

```
┌──────────┐    ┌───────────┐    ┌────────────┐    ┌──────────────┐
│ 이미지    │───▶│ API 호출   │───▶│ 정적 데이터  │───▶│ 유저 검증     │
│ 업로드    │    │ + 매칭     │    │ 매칭 결과   │    │ + 수정       │
└──────────┘    └───────────┘    └────────────┘    └──────┬───────┘
                                                          │
                                                     isCustom 있음?
                                                          │
                                                   ┌──────▼───────┐
                                                   │ Custom Tablet │
                                                   │ Modal (5x5)  │
                                                   └──────┬───────┘
                                                          │
                                                   ┌──────▼───────┐
                                                   │ 스토어 반영    │
                                                   └──────────────┘
```

### 검증 화면

```
┌────────────────────────────────────────────────┐
│ 📷 인식 결과 검증                               │
│                                                │
│ ┌──────────────────┐  ┌──────────────────────┐ │
│ │ 원본 스크린샷     │  │ 인식 결과 그리드       │ │
│ │ (좌측)           │  │ (우측 - 미리보기)      │ │
│ │                  │  │                      │ │
│ └──────────────────┘  └──────────────────────┘ │
│                                                │
│ 인식된 아이템: 15/34                            │
│ ✅ 매칭 성공: 12  ⚠️ 불확실: 2  ❌ 미인식: 1    │
│                                                │
│ ⚠️ 불확실 항목:                                 │
│   슬롯 5: "강화 포..." → [강화 포션 뚜껑 ▼]     │
│   슬롯 12: "합성 석판" → [커스텀 입력 필요 🔧]   │
│                                                │
│ [다시 분석]  [수동으로 전체 입력]  [확인 & 적용]  │
└────────────────────────────────────────────────┘
```

### 불확실 항목 수정 UI

- 드롭다운으로 정적 데이터 목록에서 직접 선택
- confidence < 0.7인 항목은 자동으로 "불확실"로 표시
- isCustom 항목은 CustomTabletModal 자동 오픈

### 상태 흐름

```typescript
type UploadPhase =
  | 'idle'
  | 'uploading'
  | 'analyzing'       // Vision API 호출 중
  | 'matching'        // 정적 데이터 매칭 중
  | 'validating'      // 유저 검증 대기
  | 'custom-input'    // 커스텀 석판 입력 중
  | 'complete'
  | 'error'
```

---

## Task 3: 수동 입력 모드 (`components/upload/ManualInput.tsx`)

Vision API 없이도 사용 가능한 수동 입력 경로:
- ItemPalette에서 직접 아이템을 드래그하여 배치
- 아티팩트: 목록에서 선택 → 강화 레벨 입력 → 그리드에 배치
- 석판: 목록에서 선택 → 그리드에 배치 → 우클릭으로 회전

이 모드는 Vision API가 불안정할 때의 완전한 폴백.

---

## 에러 처리

| 에러 | 메시지 | 복구 |
|------|--------|------|
| API 키 없음 | "OpenAI API 키가 필요합니다" | 설정 안내 + 수동 입력 유도 |
| 이미지 크기 초과 | "이미지가 너무 큽니다 (최대 4MB)" | 자동 리사이즈 시도 |
| 인식 결과 0건 | "아이템을 인식하지 못했습니다" | 수동 입력 유도 |
| 매칭률 < 50% | "인식 정확도가 낮습니다" | 수동 검증 강조 |
| 네트워크 에러 | "서버 연결 실패" | 재시도 + 수동 입력 |

---

## 검증 기준

- [ ] Vision API가 정상 이미지에서 아이템을 JSON으로 추출
- [ ] 정적 데이터 매칭으로 241+54 항목과 올바르게 연결
- [ ] 퍼지 매칭으로 약간의 오타도 처리
- [ ] confidence < 0.7 항목이 "불확실"로 표시
- [ ] isCustom 석판에 대해 CustomTabletModal 자동 오픈
- [ ] 모든 검증 완료 전 스토어 미반영
- [ ] 수동 입력 모드로 Vision API 없이도 완전한 사용 가능
- [ ] API 에러 시 적절한 에러 메시지 + 수동 입력 폴백
