# Recognition Fixtures

This directory holds ground-truth annotations for sample inventory screenshots in `D:/세피리아/인벤 예시/`. They are consumed by:
- The smoke test in `tests/vision/recognition-1.test.ts` (per consensus plan §6).
- The artifact-regression measurement protocol (per consensus plan §3 SHOULD).

## Format

Each fixture file is a JSON document of shape:

```json
{
  "imagePath": "인벤 예시/1.jpeg",
  "rows": 5,
  "cols": 6,
  "totalSlots": 30,
  "expected": [
    {
      "slotIndex": 0,
      "matchedValue": "absolute_ring",
      "type": "ARTIFACT",
      "rotation": 0,
      "_visualNote": "row1-col1: small green vial / potion"
    },
    {
      "slotIndex": 24,
      "matchedValue": "thorn",
      "type": "TABLET",
      "rotation": 0,
      "_visualNote": "row5-col1: green 4-pointed cross/X (legend tier — gasi)"
    },
    {
      "slotIndex": 5,
      "matchedValue": null,
      "type": null,
      "rotation": 0,
      "_visualNote": "empty slot"
    }
  ]
}
```

### Field rules

| field | type | meaning |
|---|---|---|
| `slotIndex` | number | row × cols + col (0-indexed, top-left = 0) |
| `matchedValue` | `string \| null` | **EXACT** `value` field from `data/artifacts.json` or `data/tablets.json`. `null` for empty slots. `"???"` is allowed for cells you're unsure about — those are SKIPPED by the smoke test, not counted as fail. |
| `type` | `"ARTIFACT" \| "TABLET" \| null` | item type. `null` for empty/unknown |
| `rotation` | `0 \| 1 \| 2 \| 3 \| "any"` | rotation in 90° CW steps. Use `"any"` for point-symmetric tablets where 0° and 180° look identical. ARTIFACTS always use `0`. |
| `_visualNote` | string (optional) | free-text description of the cell's visual content — helps reviewers and future labelers |

### Rotation legend
- `0` = 0° (default orientation as drawn in `public/images/slabs/<value>.png`)
- `1` = 90° clockwise
- `2` = 180°
- `3` = 270° clockwise (== 90° counter-clockwise)
- `"any"` = point-symmetric (e.g. some tablets look identical at 0° and 180°). Smoke test accepts any rotation.

## How to label

1. Open `D:/세피리아/인벤 예시/N.png` (or `1.jpeg`) side-by-side with the JSON file.
2. For each non-empty cell, find the matching template in `public/images/slabs/` (54 files) or `public/images/artifacts/` (241 files).
3. Look up the exact `value` string in `data/tablets.json` or `data/artifacts.json` (search by image filename or Korean label).
4. Set `matchedValue`, `type`, and `rotation` accordingly.
5. Cells you're unsure about: keep `"???"` so the smoke test ignores them rather than failing the build.

## Coverage policy (per consensus plan §6)

- **`1.jpeg.expected.json`**: REQUIRED before smoke test runs. Implementer must NOT proceed past §3 MUST without this file having real values.
- **`2..5.expected.json`**: Recommended. Per-image accuracy is logged in `.omc/research/recognition-accuracy.md`. PR description must call out which fixtures were available.

## `grid` field (required)

Each fixture carries the inventory panel's location in the source image:

```json
"grid": { "originX": 50.4, "originY": 41.2, "gridWidth": 721.6, "gridHeight": 726.2 }
```

The harness crops to this rect and hands the recognizer a buffer whose origin is the grid's
top-left, so the recognizer divides its whole input uniformly into `rows × cols`. Automatic grid
detection is Phase 2 work — until then these values are authoritative.

Values were produced by two-stage self-calibration (foreground-centroid regression for pitch,
then a match-score sweep for origin) and visually verified against a gridline overlay on all five
screenshots. See `PLAN/06-Recognition-Rebuild.md` §10-1.

## Label status (round 3, 2026-08-15)

| image | slots | confirmed | empty | `???` |
|---|---|---|---|---|
| 1.jpeg | 30 | 11 | 0 | 19 |
| 2.png | 36 | 18 | 16 | 2 |
| 3.png | 36 | 17 | 16 | 3 |
| 4.png | 36 | 16 | 18 | 2 |
| 5.png | 36 | 26 | 4 | 6 |
| 6.png | 30 | 29 | 1 | 0 |
| 7.png | 35 | 29 | 6 | 0 |
| **total** | **239** | **147** | **61** | **31** |

**Round 3 (2026-08-15):** the 10 label suspects flagged by the §9-G failure census were
reviewed by the USER against side-by-side crops (cell | old label sprite | proposed sprite,
preserved at `.omc/research/vision-diagnosis-2026-08-15/vision-census/crops/`) and ALL TEN
were confirmed as label errors: 8 item relabels in 3.png/5.png (wit→preparation,
unity→distribution, hope→advance, hope→connection, keel_fragment→kaleidoscope,
shield_technique_manual→swordsmanship_textbook, warrant→honor, thornbush→thorn — the last
also fixing type ARTIFACT→TABLET) plus 2 empty-label fixes (3.png#10→swaying_eyes,
5.png#25→red_dew, identified by the user as 붉은 이슬; its "0/3" overlay suggests a
depleted-state rendering). Every suspect came from candidate-assisted self-labelling —
the user-truth fixtures (6/7.png) produced zero suspects, confirming the round-2 warning
below.

`6.png` and `7.png` are **user-supplied ground truth** — every cell named by the player, no
candidate assistance, no `???`.

**`7.png` has a partial last row.** It looks like 6×6 but the bottom row holds only 5 cells, so
`totalSlots` is **35** and index 35 falls outside the inventory panel. Recognizers iterate
`i < totalSlots`, so `rows: 6, cols: 6, totalSlots: 35` expresses this correctly. Grid detection
does not yet infer a partial last row.

`6.png` is **user-supplied ground truth** — every cell named by the player, no candidate
assistance, no `???`. Its `imagePath` points at the original Korean filename; the fixture is
named `6.png` only so the harness key stays short. It scores top-1 **72.4%**, slightly *above*
the 66.3% measured on the self-labelled fixtures, which says the candidate-assisted labelling
was not inflating the numbers.

It also caught two label errors: `1.jpeg` slot 9 was `load` but is `future` (the two slabs
differ only in whether the grey square sits bottom-left or bottom-right), and `2.png` slot 1
was `???` but is `heart_of_the_beast`.

Round 1 had 48 confirmed / 70 unknown. Expanding to 86 **lowered** measured top-1 from
70.8% to 66.3%, because round 1 labels came only from the matcher's own top-N proposals and
so silently excluded items it could not find. Round 2 additionally browsed the full
327-sprite catalog to label cells whose answer never appeared in the top-8 — that is where
the recurring slabs `load` (7 cells) and `exit` (5 cells) came from.

Round 2 also **corrected one wrong label**: `4.png` slot 15 was `swaying_eyes` (a dark oval);
the cell is a green checkmark, i.e. the slab `exit`.

Labelling is candidate-assisted, so treat measured top-1 as mildly optimistic even now.

- **empty/occupied** is verified for every slot in `2..5.png`.
- **Item identities** are recorded only where the cell was visually confirmed against the actual
  sprite. Everything else stays `"???"` — a wrong label silently corrupts every future
  measurement, so unverified guesses are not committed.
- **`1.jpeg` is fully `"???"`.** At 73px cells with JPEG compression the icons could not be
  identified reliably by inspection. Its earlier draft labels were removed for the same reason.
  Labelling it needs either a lossless recapture or a confirmed run of the Phase 3 engine.
- `rotation` is `"any"` for every TABLET: identity was verified, orientation was not.
