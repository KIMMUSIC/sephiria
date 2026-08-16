# 07 — Fleet Fixes (optimizer scoring + recognition)

작성: 2026-08-14 (KST) · 대상 `/workspace/sephiria`

이 문서는 스크린샷 인식과 인벤토리 최적화의 **실제 버그 수정**을 기록한다. Fleet Console 에이전트가 같은 트리를 만질 수 있어, 착수 시점(13:45 UTC) 이후 mtime을 확인한 뒤 덮어쓰지 않고 병합했다. Fleet은 `07-Fleet-Fixes.md`를 만들지 않았고, 핵심 파일(`workers/*`, `lib/effectEngine.ts`, `store/*`)은 이 작업이 쓰기 전까지 13:12–13:25 UTC 이후 변경이 없었다.

---

## A. Optimizer scoring

### Findings
- `workers/optimizer.worker.ts`의 `evaluateBoard`가 **실제 레벨 합보다 큰 휴리스틱**을 더하고 있었다.
  - 장외 디버프 +10 / 석판 방패 +10 / 복합 석판 위치 +5~10
  - 예: 장외 홈런 2개(+20)가 아티팩트 +1 레벨보다 우선됨
- OOB 카운트가 **simple tablet만** 보고, `flag` 등 complex가 `applySimpleEffects`로 쏘는 디버프는 빠졌다.
- `DEFAULT_SA_CONFIG.maxTimeMs = 2000` → 34칸 보드에서 탐색이 일찍 끊김 (~18k iter 전에 시간 컷).
- `useOptimizer`가 결과를 그리드에만 넣고 **before/after 점수를 버림**. `worker.onerror`는 삼킴.
- `ResultSummary`는 존재했지만 `app/page.tsx`에 연결되어 있지 않음.

### Fixes
1. **Primary score** = 실드 적용 후 아티팩트 `finalLevel` 합. `finalLevel <= 0` → `-99999` (파괴).
2. 휴리스틱은 `TIEBREAK = 0.01` 스케일. +1 실레벨을 절대 이기지 못함.
3. OOB/실드는 **effect engine geometry를 재사용**.
   - `calculateAllEffects(..., stats)`가 simple·complex(flag / agglutination +3 / sheen)의 off-grid 음수 효과를 같은 `applySimpleEffects`에서 센다.
   - 석판 칸에 raw 음수가 떨어지면 실드 카운트 (hospitality bypass 제외).
4. Locked artifact는 mutate에서 그대로 고정 (swap/move 대상 제외).
5. `maxTimeMs: 8000`, `coolingRate: 0.9996`. 진행 메시지는 2000 iter마다 유지.
6. `lastOptimize: { beforeScore, afterScore, iterations }`를 스토어에 저장. OptimizePanel + ResultSummary에 표시.
7. `useOptimizer`: 시작 전 `evaluateBoard` 스냅샷, 결과 후 `setGridFromWorker` + `setLastOptimize`. `onerror`는 짧은 문자열로 패널에 표시.

### Files
- `lib/optimizerScore.ts` **new** — 공유 스코어 (worker / hook / tests)
- `lib/effectEngine.ts` — `EffectStats.oobDebuffs`
- `workers/optimizer.worker.ts` — 공유 `evaluateBoard` 사용, 휴리스틱 제거
- `types/index.ts` — `DEFAULT_SA_CONFIG`, `OptimizeLastResult`
- `store/inventoryStore.ts` — `lastOptimize`
- `hooks/useOptimizer.ts` — 스냅샷 / 에러
- `components/panels/OptimizePanel.tsx` — before/after/iter
- `components/panels/ResultSummary.tsx` — lastOptimize 카드
- `app/page.tsx` — ResultSummary 연결

`loadFromRecognition` / `recalculate`의 rotation·`currentLevel` 로직은 이미 올바랐고 유지했다.

### Correction (user-confirmed 2026-08-16)

Destruction only at `currentLevel`/`finalLevel` **<= -1** (`isArtifactDestroyed(level) => level < 0`). Level 0 is a valid alive state for the 8 level-less `[고유]` catalog artifacts. Supersedes `finalLevel <= 0 → -99999`.

---

## B. Recognition

### Findings
1. **Short last row**: `7.png`는 35칸 (마지막 줄 5칸). calibrator/worker는 `rows * cols = 36`으로 취급. `SmartUploader.applyResults`는 `(maxRow+1)*6`으로 슬롯을 늘려 유령 칸을 만들었다. fixtures README도 "Grid detection does not yet infer a partial last row"라고 적혀 있음.
2. **Fallback histogram**: `SmartUploader` fallback이 `ImageUploader` → `useRecognition` → `lib/templateMatcher.ts` 히스토그램 매처를 호출. PLAN/06이 증명한 대로 이 수식은 정답을 임계값 위로 올릴 수 없다.
3. **No correction UI**: detect 후 하이라이트 → 자동 적용. 낮은 신뢰도 셀을 고칠 UI가 없음.
4. plate-matcher top-1 (~64% in labelled fixtures) — 새 CV 스택은 만들지 않음. 안전한 개선: last-row phantom 제거 + top-5 후보를 보정 UI에 노출. 매칭 수식/임계값은 테스트 바닥을 깨지 않기 위해 그대로 둠.

### Fixes
1. `lib/vision/last-row.ts`
   - 마지막 줄 오른쪽부터 **인벤 플레이트가 아닌** 칸(프레임/크롬, 이미지 밖)을 자른다.
   - 빈 인벤 칸은 링 색이 나머지 그리드와 같으면 유지.
   - 마지막 줄 전체가 비인벤이면 0 → 한 줄 drop (`slotCountFromGrid`).
2. `workers/vision.worker.ts`는 `inferLastRowCols` 후 `totalSlots`만 줄여 recognize. 피치/원점은 그대로. `7.png` → 35.
3. `SmartUploader.applyResults`는 `(maxRow+1)*6` 대신 `maxRow*6 + lastRowCols`.
4. Fallback은 **수동 배치**만. ImageUploader/histogram 경로 차단. `useRecognition` / `ImageUploader`에 retired 주석.
5. 낮은 신뢰도(`confidence < 0.18` 또는 top1−top2 < 0.04)면 `RecognitionReview`:
   - 해당 셀 목록
   - plate-matcher top-5 후보 선택
   - 이름 검색으로 교체
   - 빈 칸
6. `VisionMatchResult.candidates` 추가. rotation은 그대로 store에 들어감.
7. plate-matcher `matchCell`이 top-5를 반환 (top-1 선택은 동일, UI만 확장).

### Files
- `lib/vision/last-row.ts` **new**
- `lib/vision/plate-matcher.ts` — top-5
- `lib/vision/types.ts` — `candidates`
- `workers/vision.worker.ts` — last-row + candidates
- `components/upload/RecognitionReview.tsx` **new**
- `components/upload/SmartUploader.tsx` — review / slot count / manual fallback
- `types/index.ts` — `VisionMatchCandidate`, `reviewing` phase
- `hooks/useRecognition.ts`, `components/upload/ImageUploader.tsx` — retired 주석

---

## C. Tests

```
python3 -c "import subprocess,sys; r=subprocess.run(['/usr/bin/node','./node_modules/vitest/vitest.mjs','run','tests/effectEngine.test.ts','tests/optimizer.smoke.test.ts','tests/lastRow.test.ts'],cwd='/workspace/sephiria'); sys.exit(r.returncode)"
```

결과 (2026-08-14 13:53 UTC / 22:53 KST):
- `tests/effectEngine.test.ts` — **14 passed** (기존 케이스 유지)
- `tests/optimizer.smoke.test.ts` — **5 passed** (공유 스코어, 레벨합 우선, lock, flag OOB)
- `tests/lastRow.test.ts` — **4 passed** (이미지 없이 row-width 로직)

`tsc --noEmit` — **clean**

---

## D. How to verify in UI

Dev server는 이미 `:3000`에서 이 레포를 서빙 중 (`next-server` cwd = `/workspace/sephiria`).

1. **인식**
   - 스크린샷 붙여넣기/업로드 → 하이라이트
   - 34/35칸 인벤이면 마지막 줄이 6칸으로 늘어나지 않아야 함
   - 낮은 신뢰도 셀이 있으면 노란 목록에서 후보/검색/빈 칸 수정 후 「그리드에 적용」
   - 석판 회전이 그리드에 유지되는지 확인 (우클릭 회전과 일치)
   - 엔진 로드 실패 시 「수동 모드」는 팔레트 안내만 (히스토그램 업로더 없음)
2. **최적화**
   - 아티팩트+석판 배치 후 「최적 배치 찾기」
   - 진행률 / 최고 점수 표시, 완료 후 이전·이후·반복 횟수
   - 잠근 아티팩트는 不动
   - 파괴(레벨 0 이하) 배치는 채택되지 않음
   - ResultSummary에 현재 레벨 합 + last optimize 점수

---

## Remaining risks
- last-row 링 매칭이 실패하면 (마지막 줄 크롬이 빈 슬롯처럼 보일 때) 유령 1칸이 남을 수 있음. 보정 UI에서 빈 칸으로 지울 수 있음.
- plate-matcher top-1 자체(~64%)는 수식을 바꾸지 않아 그대로. 보정 UI가 실질 정확도를 올림.
- SA는 확률적. 8초로 늘렸지만 전역 최적은 보장하지 않음.
- ~~인식 레벨은 여전히 0~~ → E-3 참고: 이제 팔레트 규약(최대 레벨)로 기본값 적용.
- Fleet이 이후 같은 파일을 다시 쓰면 이 문서의 스코어/last-row 변경과 충돌할 수 있음.

---

## E. Fleet Console pass — 추가 수정 및 잔여 발견 (2026-08-14, appended)

같은 트리에서 병행 작업한 Fleet Console 세션의 **고유 기여분**과 잔여 발견. 위 A–D와 겹치는 항목은 재작업하지 않았다.

### 적용된 수정 (이 패스가 직접 변경)

1. **비전 테스트 픽스처 디렉터리 인코딩 복구** — `인벤 예시/`의 실제 디렉터리·파일명이 바이트 단위로 깨져 있어 (`\xfd\xd8\xa9...`) `tests/vision/*`가 **하나도 실행되지 못했다** (sharp: Input file is missing). UTF-8 정상 이름의 `인벤 예시/` 디렉터리를 만들고 깨진 원본 파일로의 심링크 7개를 생성. 원본 바이트는 건드리지 않음.
2. **중복 템플릿 스프라이트 제거** — 바이트 동일(md5 일치)한 스프라이트 쌍 5개가 템플릿 뱅크에서 서로 경쟁하며 top-1을 뒤집고 있었다:
   - `artifacts/lightningboomerang.png` (= `lightning_boomerang.png`), `calges_2.png` (= `calges.png`), `green_ink_bottle.png` (= `green_ink_bottle_v2.png`), `broken.png` (= `broken_root.png`), `slabs/home-town.png` (= `home_town.png`)
   - 유지한 쪽은 전부 데이터 canonical value (`data/*.ts`가 `/images/**/${value}.png`로 매핑하는 이름). 삭제한 5개는 앱/데이터 어디에서도 참조되지 않음을 grep으로 확인.
   - `tests/fixtures/7.png.expected.json`의 `lightningboomerang`/`home-town`을 canonical `lightning_boomerang`/`home_town`으로 갱신.
   - 결과: `tests/vision/recognition.test.ts` **15/15 passed** — per-fixture 핀 전부 충족, 총 top1 **95/145 (floor 95 정확히 충족)**. (dedup 전에는 1.jpeg 5<6, 7.png 16<17로 floor 93<95 실패였음.)
3. **인식 아티팩트 레벨 기본값** — `store/inventoryStore.ts` `loadFromRecognition`: `res.level`이 0이면 `artifactData.level`(팔레트 기본값 = 최대 레벨)로 대체. 스크린샷은 레벨을 안 읽으므로 종전에는 전 아티팩트가 level 0 → `evaluateBoard`가 `finalLevel <= 0`으로 **보드 전체를 파괴(-99999) 판정**해 인식 직후 최적화가 무의미했다.
4. **수동 그리드 인식 배관 (호출자 없음, 무해)** — `types/index.ts` `ManualGridSpec`, `VisionRequest.detect.manualGrid`, `workers/vision.worker.ts`의 manualGrid 분기(캘리브레이션 생략, plate-matcher 직행), `hooks/useVisionWorker.ts` `detect(imageData, manualGrid?)`. 사용자가 드래그한 영역 + 스토어 slotNum으로 fallback 인식을 붙일 수 있는 준비물. **ImageUploader 개편은 동시 편집 충돌로 착륙시키지 않았고**, 현재 fallback은 B-4대로 수동 배치 안내만. 이 배관이 불필요하면 제거해도 무방 (참조 없음).

### 잔여 발견 (미수정 — 후속 작업 후보)

5. **optimizer.worker 반복 성능** — `mutate`/best 갱신이 여전히 `JSON.parse(JSON.stringify(...))` 딥카피. mutation은 참조 재배열/교체뿐이라 `slots.slice()`로 충분하며, 딥카피 제거 시 초당 반복수가 크게 늘어난다.
6. **SA가 8초 예산을 다 쓰지 못함** — `initialTemp 100 → minTemp 0.01`, `coolingRate 0.9996` 기준 냉각 완료까지 ≈ **23,000 iter**. 냉각이 끝나면 시간이 남아도 루프가 종료된다 (reheat 없음). "SA runs long enough"를 온전히 달성하려면 시간 잔여 시 재가열(restart) 또는 냉각률을 시간 기반으로 조정 필요.
7. **grid.test.ts 이 환경에서 2건 실패 (원인 미확정)** — auto-calibration 경로: `1.jpeg` auto top1 4 < 핀 5, 종합 overall 151 < floor 156 (top1 88 < 93), fallback(no scorer) row-count `7.png` 5행 ≠ 6행. dedup 전에도 유사 폭으로 실패했으므로 오늘 두 패스의 변경과 무관. 픽스처 핀이 다른 sharp/libvips 빌드에서 측정됐을 가능성(특히 JPEG 디코드 편차)이 유력하나 **[Unverified — 디코더 편차 가설 미검증]**. 핀 하향 재조정 전에 원측정 환경 재확인 권장.
8. **히스토그램 코드 잔존** — `lib/templateMatcher.ts`, `hooks/useRecognition.ts`는 retired 상태로 파일이 남아 있고 `ImageUploader.tsx`가 여전히 import. 프로덕션 경로에서는 도달 불가지만, 완전 제거(파일 삭제 + import 정리)가 안전하다.
9. **문서 정정** — 위 "Remaining risks"의 "인식 레벨은 여전히 0"은 E-3 적용으로 더 이상 사실이 아님.

### 검증
- `npx vitest run tests/vision` (2026-08-14 UTC): `recognition.test.ts` 15 passed / `grid.test.ts` 22 passed, 2 failed (E-7 항목).
- E-3/E-4 변경은 `tests/effectEngine.test.ts`·`tests/optimizer.smoke.test.ts` 통과 범위에 영향 없음 (스코어 경로 미변경).
