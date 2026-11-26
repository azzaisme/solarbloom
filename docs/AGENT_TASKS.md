# Phase 7 task tracker

Work is tracked on GitHub: umbrella issue #712, one epic each with its stories as sub-issues. This file maps them.

| Epic | Issue | Stories | Status |
|---|---|---|---|
| P7-E27 Lighting correction and image calibration | #713 | #719–#725 | 🟢 calibrated on `p7-e27-lighting`; shots and numbers in `docs/review/p7/e27-report.md` |
| P7-E28 Vegetation composition and readable landscaping | #714 | #726–#733 | ⬜ |
| P7-E29 Tree canopy and vertical silhouettes | #715 | #734–#740 | 🟡 on `p7-e29-trees`: clustered crowns, beach trees, zoned placement, dapple, LOD; shots in `docs/review/p7/e29/` |
| P7-E30 Terrain elevation, banks and waterfalls | #716 | #741–#747 (+ #758 on-island wasteland) | 🟡 on `p7-e30-terrain`: Falls overlook, showcase waterfall, rocky Saltwind walls, wasteland; report `docs/review/p7/e30-report.md` |
| P7-E31 Environmental landmarks and guided exploration | #717 | #748–#754 | 🟡 on `p7-e31-landmarks`: hierarchy, stateful Sea Lock (ruined → restoring → thriving), its beacon, landmark dressing kit, vault outpost; report `docs/review/p7/e31-report.md` |
| P7-E32 Atmospheric world, skyline and distant ruins | #718 | #755–#762 | ⬜ |
| Bug: Tide's garden pond at the bottom of the park stairs | #763 | — | ⬜ |

Baseline: `docs/review/p7/before/` (3 cameras × early/mid/late, with and without HUD, `metrics.json`). High-tier
draw calls in the baseline: 980–1,040 early, 1,030–1,050 mid, 1,270–1,615 late.

## Working rules

- Each workstream runs in its own chat/session on its own issue, in build order (E27 first).
- One owner per file; shared files (`ChunkRenderer.ts`, `Game.ts`) only in the owner's named functions or a
  minimal marked hook.
- Nothing cosmetic is saved or read by the simulation.
- In the cloud container, serialise heavy jobs (shot runs, the full unit suite) with
  `flock /tmp/sb-heavy.lock <command>`: 4 cores, and software GL renders High at ~1 fps.
- Each PR lists files changed, before/after shots from `tests/e2e/p7-shots.mjs`, draw calls before→after, tests,
  and what still looks wrong.
