# Phase 7 task tracker

Status: ⬜ not started · 🟡 in progress · ✅ done and verified in shots · ⚠️ done with caveats · ❌ dropped

| # | Stream / story | Owner | Branch | Status | Notes |
|---|---|---|---|---|---|
| 0 | Audit, plan, baseline shots, shot script | Lead | `claude/trusting-fermi-cgucwe` | 🟡 | `tests/e2e/p7-shots.mjs`, `docs/review/p7/before/` |
| 1 | P7-E27 lighting: sun/fill tint, cool sky + haze, haze distance, motes/shafts, pale sand, grade tint | Lead (Agent A) | main branch | 🟡 | config in `data/look.ts`, `data/sky.ts`; guarded by `tests/sunlit-look.test.ts` |
| 2 | P7-E28 planting zones (calm lawn / meadow / beds / shoreline / path edge / clearance) | Agent B | worktree | 🟡 | |
| 3 | P7-E29 tree canopy: beach trees, groves, bigger layered crowns | Agent B | worktree | 🟡 | |
| 4 | P7-E32 ruined skyline layers + cohesive clouds | Agent E | worktree | 🟡 | must differ from the skyline removed in #681 |
| 5 | P7-E30 relief, banks, showcase waterfall | Agent C/D | worktree | 🟡 | playable walk heights unchanged unless tested |
| 6 | P7-E31 landmark focal point | Lead, after CP2 | — | ⬜ | improve an existing landmark first |
| 7 | Integration, regression, scorecard, final shots | Lead (Agent F role) | main branch | ⬜ | |

## Integration checkpoints

- **CP1** E27 values committed; agents told to rebase.
- **CP2** B, E, C/D merged; typecheck, unit suite, p7-shots all stages with no page errors.
- **CP3** polish, golden hour + night, scorecard, documentation.

## Coordination rules

- One owner per file; shared files (`ChunkRenderer.ts`, `Game.ts`) only in the owner's named functions or a
  minimal marked hook. The lead resolves merge conflicts.
- Nothing cosmetic is saved or read by the simulation.
- Every agent reports files changed, shots, draw calls/triangles before→after, tests, and what still looks wrong.
