# P7-E27 (#713): lighting correction and image calibration — results

Branch `p7-e27-lighting`. Shots from `tests/e2e/p7-shots.mjs` (1920×1080, High tier, weather sunny).
Diagnosis: [`e27-diagnosis.md`](e27-diagnosis.md).

## Bright Day (day fraction 0.3), every stage

`before/` is the Phase 7 baseline (main @ ab2e5cd6); `after/` is this branch (which also carries `testing`'s
waymark, #764, so part of the draw-call change is the waymark's, not the lighting's).

| Shot | Draw calls | Clipped % | Mean lum | Mean sat |
|---|---|---|---|---|
| early-day-third | 981 → 1039 (+6%) | 0 → 0.01 | 160 → 178.2 | 0.358 → 0.263 |
| early-day-iso | 1012 → 1058 (+5%) | 0 → 0 | 180.4 → 191.5 | 0.145 → 0.133 |
| early-day-shore | 771 → 800 (+4%) | 0 → 0 | 170.9 → 192.8 | 0.354 → 0.221 |
| mid-day-third | 1033 → 1090 (+6%) | 0.03 → 0.03 | 148.5 → 157.7 | 0.628 → 0.512 |
| mid-day-iso | 1044 → 1160 (+11%) | 0 → 0 | 184.6 → 193.4 | 0.184 → 0.161 |
| mid-day-shore | 779 → 619 (-21%) | 0 → 0.01 | 150.6 → 170.3 | 0.602 → 0.467 |
| late-day-third | 1615 → 1673 (+4%) | 0.03 → 0.04 | 139.7 → 148.8 | 0.668 → 0.563 |
| late-day-iso | 1484 → 1481 (-0%) | 0 → 0 | 177.8 → 183.2 | 0.356 → 0.292 |
| late-day-shore | 1273 → 1303 (+2%) | 0 → 0 | 148.9 → 165.4 | 0.639 → 0.506 |

Draw calls stay inside the +25% budget (largest +11%; mid shore −21%). Nothing got darker: every shot is brighter
and less over-saturated; clipped pixels stay under 0.05% by day (target < 1%).

Probed on screen (sRGB), mid stage:

| Surface | Before | After | Brief |
|---|---|---|---|
| Sky, top of the follow camera's frame | 232, 235, 229 | 149, 193, 229 | ~142, 195, 240 |
| Sunlit grass | 160, 160, 37 | 143, 176, 75 | 110–150, 170–200, 60–90 |
| Dead sand | 227, 175, 111 | 212, 188, 150 … 233, 216, 160 | ~226, 207, 164 |
| Sunlit ivory paving | — | 200, 176, 124 (bevels visible) | 200–235 |
| A contact (box base) vs SSAO off | ~54% darker | ~10–20% darker | 10–20% |
| Open lawn vs SSAO off | ~22% darker | ~5–7% darker | ~0 |

## Golden Hour and Moonlit Garden (mid stage)

`before-golden-night/` is `testing` @ 7c675488 (no Phase 7 changes); `after-golden-night/` is this branch.

| Shot | Draw calls | Clipped % | Mean lum | Mean sat |
|---|---|---|---|---|
| mid-golden-third | 1067 → 1113 (+4%) | 0.12 → 0.18 | 110.5 → 109.2 | 0.669 → 0.618 |
| mid-golden-iso | 1164 → 1122 (-4%) | 0 → 0 | 161.4 → 162.7 | 0.176 → 0.196 |
| mid-golden-shore | 632 → 645 (+2%) | 0.01 → 0.01 | 103.2 → 112.6 | 0.639 → 0.584 |
| mid-night-third | 1183 → 1251 (+6%) | 1.48 → 1.38 | 95.5 → 91.7 | 0.563 → 0.529 |
| mid-night-iso | 1159 → 1097 (-5%) | 0.02 → 0.02 | 40.8 → 42.3 | 0.856 → 0.843 |
| mid-night-shore | 602 → 716 (+19%) | 0.14 → 0.08 | 54.8 → 54.7 | 0.775 → 0.801 |

Golden Hour now has a warm key and a warm sky band (it was a pale, cool afternoon); Moonlit Garden keeps the approved
night (#685). The night third-person shot clips ~1.4%: the waymark's lotus emblem (#764) glows ~8× its day
strength at night and blooms over Bloombot. It does so on `testing` too (1.48%), so it is not from this work; it
is the waymark's to tune (`WAYMARK.emblem.dayLight`) or `LOOK.bloom.night`'s, which the approved night uses for lamps.

## What changed (all in data/look.ts / data/sky.ts, tested in tests/p7-lighting.test.ts)

- Grade: saturation 1.1 → 1.0, vibrance 0.15 → 0, tint `#fffaf2` (the main cause of lime grass / orange timber).
- Sun `#fff0d6`, fill `#c8ddf2`; noon sun ~38–50° up.
- Sky: day values authored to land on the brief's screen colours (the dome is encoded once more on output); blue
  from 8°; a pale blue low band; warmth only toward the sun. Haze cool blue, 12/10 → 64/88.
- Motes 28 at glow 1.4, one faint shaft (were 90 at 3 and 5 shafts).
- SSAO 0.7 over 0.25–0.6 tiles (was 1 over 0.6–2): contacts grounded, open ground no longer dulled.
- Dead sand paler (GroundTex, Palette painted sand); Radiant grass a natural green.
- Cloud ring (owner's idea): the gate wall continues round the hidden city, 4 rows, back rows 1.3×, with wisps
  that rise and melt away (one dynamic batch).
- Presets: `LIGHT_PRESETS` (Bright Day, Golden Hour, Moonlit Garden) over DayNight; Golden Hour authored via
  `DAY_LIGHT.warmBelow` 0.6 and `DAY_LIGHT.duskSpan` 3.
- One handle (`look.cfg`, `look.sky`, `look.haze`, `look.day`) with live `look.apply()`; `sbDev.light()` panel and
  `sbDev.lightPreset()` on the dev server only; `tests/e2e/p7-tune.mjs` for live tuning against the fixed cameras.

## Still wrong (for later epics)

- The ring's clouds are puff balls with dark seams between puffs: P7-E32 reshapes them.
- From the high iso camera the hidden city beyond the ring is still a flat pale field (depth haze over grey ground).
- The night waymark emblem flare (above).
