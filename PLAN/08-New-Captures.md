# 08 — 새 캡처 6~9 정답/오답과 정확도 계획

작성: 2026-08-15 (KST). 이미지는 `인벤 예시/{6,7,8,9}.png` (메일 PNG). 예전 fixture 6/7(스크린샷 2026-08-09, 스크린샷2)과 파일명이 겹침. 새 장은 live로 따로 둘 것.

정답은 칸 크롭 + 카탈로그 스프라이트 대조. 불확실은 ???.

## 확인된 오답 (예측 → 정답)

| 장 | 칸 | 예측 | 정답 | 원인 |
|---|---|---|---|---|
| 6 | r1c2 | advent | heart_shaped_carrot | 주황 하트형. 석판으로 오인 |
| 6 | r2c6 | lightning_struck_tree_branch | ??? 빨간 물방울 펜던트 | 저신뢰 오답 |
| 6 | r3c2 | thorn | ??? 녹색 화환/원 | 석판 형제 |
| 6 | r5c2 | helenas_staircase | ??? 0/14 금색 장식 (시계/망원 후보) | 오버레이 숫자 무시 |
| 6 | r6c1 | angry_potato | ??? 도넛 (감자 스프라이트와 불일치) | 갈색 원형 혼동 |
| 6 | r6c3 | linear | heart_of_the_beast | 은+녹 하트. 석판으로 오인 |
| 6 | r6c4-6 | empty×3 | 인벤 밖 | last-row를 6칸으로 잡음 |
| 7 | r4c4 | lightning_struck_tree_branch | six_leaf_clover | 클로버를 나뭇가지로 |
| 7 | r6c4-6 | empty×3 | 인벤 밖 | last-row 과대 |
| 9 | r1c6 | point | golden_leaf | 단풍잎 0/0 |
| 6/9 | 여러 | ohia_lehua (음수 점수) | 어두운 아이템/석판 | 저신뢰 dump |

맞을 가능성 큰 예측: 6 ice_wings / sheet_music_storm / flag / black_tea / frozen_egg / silver_bracelet / pride / plasma_helmet. 7 shade? / viscosity / pride / mark_of_warrior / home_town / pointed_bat. 8 frozen_bow / wings / glass_hammer / harvesting / cloth_armor×3 / shining_hourglass / dull_drop. 9 cloak_of_the_green / rabbit_village_guard_helm / yakumo_kodachi / shield_bag / oink_shaman_necklace / academy_brigendin / palas_card.

## 오답 유형
1. 짧은 마지막 줄 과대 (6, 7)
2. 석판/아티팩트 타입 전도 (당근→도래, 하트→선의)
3. 녹색 소형 형제 (클로버/가시/나뭇가지/단풍/도토리)
4. 어두운 아이템 → ohia_lehua 음수 top-1
5. HUD 숫자(0/14) 미사용

상수 재튜닝은 하지 않음 (1.jpeg 바닥 깨짐).


## 싼 수정 후 재측정 (2026-08-15)

넣은 것: last-row 플레이트 판정, 당근/클로버/하트 혼동 그룹, `ohia_lehua` 음수 dump 거절.
픽스처는 `tests/fixtures/live-{6,7,8,9}.png.expected.json` (옛 6/7과 분리). 확정 칸만 채점, 나머지는 skip.

| 장 | top-1 | overall | 남은 오답 |
|---|---|---|---|
| live-6 | 10/11 | 19/20 | slot 1 heart_shaped_carrot → golden_leaf (0.019) |
| live-7 | 6/6 | 14/14 | 없음 (`home-town` slug 수정) |
| live-8 | 8/9 | 14/15 | slot 21 shining_hourglass → overall_armband (0.497) |
| live-9 | 9/9 | 14/14 | 없음 |
| 합 | **33/35** | **61/63** | |

옛 1~7 이미지는 컴퓨터 업데이트 후 `인벤 예시`에서 사라짐. `recognition.test.ts` 바닥은 그대로 두고 live 스위트만 사용.
상수(CELL/TOPCUT/TRIM/FGT 등)는 안 건드림.


## 라벨 정정 후 (2026-08-15 이어짐)

live-8 slot 21은 모래시계가 아니라 `overall_armband`(채굴작업 총괄 완장). 진짜 모래시계는 slot 19.
추가로 확정: white_bread, dedication, preparation, exploitation, ray_known, sheet_music_bree, wit, binary_star, future.
주황 소형 그룹에 `heart_shaped_carrot`/`golden_leaf`/`magic_carrot` 추가. 6번 당근은 여전히 golden_leaf(0.019) — fine cue가 안 뒤집음.

| 장 | top-1 | overall |
|---|---|---|
| live-6 | 10/11 | 19/20 |
| live-7 | 6/6 | 14/14 |
| live-8 | 19/19 | 25/25 |
| live-9 | 9/9 | 14/14 |
| 합 | **44/45** | **72/73** |
