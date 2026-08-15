# 09 — Embedding nearest-neighbor on synthetic inventory cells

작성: 2026-08-15 (KST). 실측. 학습은 카탈로그 스프라이트×합성 플레이트만. live 6–9 확정 칸은 검증 전용(점유 칸을 라벨로 쓰지 않음).

## Method (embed-v4)

- Feature recipe `embed-v4`, dim=812.
  - `[0:32]` 2×2 chroma-weighted hue hist (8 bins, `y>=TOPCUT=12`), weight 0.25
  - `[32:800]` **16×16 residual** of (inner cell − ring-median plate), /255, FG-masked (`|RGB−ring|_1 > 40` or chroma≥40), L2-normalized, weight 1.0
  - `[800:808]` 2×2 green/white ink hist, weight 0.20
  - `[808:812]` stats: chroma_med/255, lum_std/255, inner_std/255, energy, weight 0.20
  - Weighted concat then single L2. Cosine = dot.
- Unweighted concat let HUD-white ink + lum_std flip carrot→anvil (first v4 pass **27/45**). Residual alone already ranked carrot > criton > leaf > anvil.
- Inference: **nearest synthetic variant** (k-vote undid correct hits in v3).
- Occupied plates: **inpainted live 6–9 occupied cells** (item blob = dist-to-ring > 42 or chroma≥40, filled with ring/interior charcoal; riveted frame kept) + 8 procedural charcoal. Occupied live cells are never class labels. EMPTY is not trained on inpainted plates.
- Composite matches plate-matcher geometry: CELL=64, TRIM=0.07, TOPCUT=12, NEAREST resize onto matcher scales (core 28–44; lock-style canonical 32), offsets ∈ {−4,−2,0,2,4}, JPEG quality 65, 1px dark-navy alpha-edge outline.
- Global sat/lum pull (not per-class): sat_scale=1.045, lum_delta=+4.31 toward live occupied inner chroma/lum (live 26.05/72.79 vs preview 24.94/68.47).
- HUD `n/m` painted on ~85% of occupied synth so white-ink is not a class cue.
- Empty gate unchanged: `chroma_med >= 38` AND `lum_std <= 27`. Perfect on the 73 scored cells.
- Plate-matcher L1 constants were not touched. Old fixtures `tests/fixtures/{1-7}*.expected.json` were not overwritten. No commit.

## Counts

- Catalog sprites: **333** (artifacts 271, slabs 62, rotatable tablets 39)
- Occupied synth: **3996** (~12 variants / non-rotatable; rotatable: 4×3)
- Inpainted occupied plates: **45** (+ 8 procedural charcoal)
- Empty synth: **220** (28 real empty backgrounds)
- Prototypes: **451**
- Held-out synthetic NN value-acc: **0.368** (lower than v3 0.639 — residual is more pose-sensitive)

## Live 6–9 (confirmed cells only) — v4 nearest-variant

| 장 | top-1 | overall | empty | skip | 남은 오답 |
|---|---|---|---|---|---|
| live-6.png | 8/11 | 17/20 | 20/20 | 13 | #7 sheet_music_storm→wizard; #15 black_tea→sight; #32 heart_of_the_beast→rebellion |
| live-7.png | 4/6 | 12/14 | 14/14 | 19 | #5 mark_of_warrior→red_planet_observation_log; #12 pointed_bat→kunai |
| live-8.png | 16/19 | 22/25 | 25/25 | 5 | #15 wit→preparation; #18 binary_star→handshake; #19 shining_hourglass→warning |
| live-9.png | 4/9 | 9/14 | 14/14 | 16 | #1 cloak_of_the_green→pure_cloak; #2 rabbit_village_guard_helm→silver_plate; #7 shield_bag→thunder_judgment; #22 walter_work_monocle→wings; #28 palas_card→white_paper |
| 합 | **32/45** | **60/73** | 73/73 | 53 | |

Prototype-mean only: **23/45** top-1, **51/73** overall, 73/73 empty.

Plate-matcher floor: **44/45** top-1, **72/73** overall.
v3 nearest-variant (history): **34/45** top-1, **62/73** overall, 73/73 empty.

v4 vs v3: **−2 top-1**, carrot fixed, live-6 5→8, live-9 8→4. Not a lift over 34/45; well short of 44/45.

## live-6 slot 1 (heart_shaped_carrot)

- predicted: `heart_shaped_carrot`  conf=0.632  **correct** (v3: criton 0.929, true rank 45)
- top neighbors: carrot 0.632, pot_lid 0.583, piece_of_red_cloth 0.568, red_snake_eye 0.559, criton 0.558
- true class rank among value-best: **0** (sim 0.632)
- occupancy stats: chroma_med=15, lum_std=40.2 (correctly not empty)

## Hybrid (plate-matcher top-5 re-ranked by embed cosine)

Not a clear win. Do not swap the default recognizer.

- Plate-matcher top-1 on these 45 cells: **44/45** (only miss = carrot → golden_leaf).
- Carrot is **not in** plate-matcher raw matchCell top-5 (`point, last_stand, solis_pratu, advent, flame_sword`, scores ≈ 0.02…−0.03) nor in postPass candidates (`golden_leaf, advent, point`). Hybrid cannot recover it.
- Hybrid on postPass candidates: **35/45**. Fixes 4 embed misses (mark_of_warrior, rabbit_village_guard_helm, walter_work_monocle, palas_card) but **breaks 9 plate-matcher corrects** (sheet_music_storm, black_tea, heart_of_the_beast, pointed_bat, wit, binary_star, shining_hourglass, cloak_of_the_green, shield_bag).
- Hybrid on raw matchCell top-5: **33/45**, breaks 11 plate-matcher corrects.
- Net: embed is a useful second opinion on a few lookalikes when the true class is already in the matcher shortlist, but re-ranking the matcher top-5 by embed cosine is a regression vs 44/45.

## v3 history (embed-v3, 8×8 mean RGB, procedural charcoal only)

| 장 | top-1 | overall | empty | 남은 오답 |
|---|---|---|---|---|
| live-6.png | 5/11 | 14/20 | 20/20 | #1 carrot→criton; #15 black_tea→mini_balista; #21 silver_bracelet→stabbing_textbook; #22 pride→ignition; #23 plasma_helmet→shield; #32 heart_of_the_beast→preparation |
| live-7.png | 4/6 | 12/14 | 14/14 | #3 pride→red_dew; #12 pointed_bat→keel_fragment |
| live-8.png | 17/19 | 23/25 | 25/25 | #5 frozen_bow→blessing; #26 future→haste |
| live-9.png | 8/9 | 13/14 | 14/14 | #28 palas_card→arrow_lane |
| 합 | **34/45** | **62/73** | 73/73 | |

v3 carrot: criton 0.929, true rank **45**. Distinctive items already matched. Domain gap + 8×8 mean-RGB collision.

## Why v4 is still below the plate-matcher floor

1. **16×16 residual is still a coarse proxy for alpha-masked L1.** Plate-matcher scores the sprite pixels directly. Residual pooling + cosine collapses lookalikes (cloaks, white-paper tablets, kunai/bat).
2. **Catalog sprite ≠ in-game carrot enough for L1**, which is why carrot is the one plate-matcher miss and is absent from its top-5. Embed residual *does* hit carrot (rank 0) because the orange heart shape survives 16×16; that does not generalize to the other 13 misses.
3. **Tried in v4 and rejected:** unweighted concat (27/45, carrot→anvil); unmasked residual + mixed large scales (28/45, carrot rank 1 / red_thread); hybrid re-rank (35/45, 9 new matcher errors).

Empty detection remains solved (chroma/lumStd gate). Identity of small lookalikes is not.

## Wiring

- TS matcher **not** wired. 32/45 < 34/45 and < 44/45. Carrot is correct and empty did not regress, but a worse standalone matcher was not written into live test floors. Plate-matcher stays the default.
- Scripts + index + this note kept as a second opinion (carrot / a few lookalikes). Hybrid is documented, not shipped.

## Files

- `scripts/vision/synth_embed.py` — synth, embed, fit, live eval, export
- `data/vision/embed-index.json` — `embed-v4` prototypes + recipe + empty-gate constants
- `.cache/vision-synth/` — debug composites, `variants.npz`, `eval.json`, `plate_top5.json` (gitignored)
- `.venv/` — numpy / pillow / scikit-learn (gitignored)
