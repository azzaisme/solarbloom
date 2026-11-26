# P7-E31 (#717): environmental landmarks and guided exploration

Branch `p7-e31-landmarks`, on `main` @0a241c1d. E27–E30 and E32 had all merged into main, and the old Phase 7 base
branch was gone. Shots come from `tests/e2e/p7-landmark-shots.mjs` (new):
- [`e31/after/`](e31/after/): every stage, day and night, with `metrics.json`.
- [`e31/before/`](e31/before/): the same cameras on main.

| Key frame | What it shows |
|---|---|
| `before/ruined-day-lock.png` vs `before/thriving-day-lock.png` | On main, the Sea Lock looks the same asleep and woken: only the land round it changes |
| `after/ruined-day-lock.png` | Ruined: the lock is drained grey stone, its gate shut, its lanterns dark, the beacon cold |
| `after/restoring-day-lock.png` | Restoring (Saltwind greening toward its need): the stone warms, the ivy greens |
| `after/thriving-day-lock.png` | Thriving (woken): its own ivory and gold, gate leaves open on the leaf emblem, ivy in flower, beacon lit |
| `after/thriving-night-third.png` | From the start at night: the lit beacon and lock mark the left of the view |
| `after/thriving-day-third.png` | From the start: the lock and beacon read as one destination; the vault (right) is now a garden outpost |

## What was built

- **Hierarchy (#748), `src/data/landmarks.ts`.** `landmarkHierarchy()` reads the layout data, so the list can't
  drift from the map:
  - major: one focal landmark per region, and the fountain for the park;
  - medium: each region's Keeper home, lookout and vault;
  - small: buried boxes and journal pages.
- **Stages (#751, #753).** `landmarkStage(awake, restored, need)`:
  - **ruined** below 15% of the region's need;
  - **restoring** from there (k 0.25 → 0.7);
  - **thriving** only on the wake.
  It runs only on goals the game already has (restored tiles, the Keeper-gated wake), so there is no new resource.
  Game marks a region dirty on `tile.restored` and refreshes its landmark twice a second.
- **Shared dressing (#750), `src/rendering/LandmarkDressing.ts`.** It applies to every region landmark that has a
  model (not the Elder Tree):
  - The model gets per-landmark copies of its materials. When ruined they are drained toward grey, darkened, matte
    and unlit; when thriving it shows its own palette.
  - Timber lantern posts on ivory footings with gold brackets, using the existing `lantern` model. Dark when ruined,
    an ember while restoring, a gold pulse when ready, lit one after another on the wake.
  - Ivy that greens with k and flowers on the wake, plus two-colour pots.
  - The colours live in `PALETTE.landmark` and the tunables in `LANDMARK_LOOK`.
- **The Sea Lock (#749, #752, #753).**
  - It keeps its model hierarchy, so on the wake the `leaf_left`/`leaf_right` gate leaves swing open (revealing the
    floating leaf emblem) and the `gear` turns.
  - It sits on an ivory stone apron.
  - The `sea-lock-light` model, which was in `assets/raw/models/final` but never placed, now stands on a rock in the
    canal beside the lock. Its lamp lights when the lock thrives, so the start view has a vertical marker with the
    lock beside it.
- **Saltwind's vault (#749).** It was a near-black box in the middle of the start view. It is now sandstone courses
  under a pale cap. Once forced with Pry II it becomes a garden outpost: ivory cap, gold band, turf and shrubs on
  the roof, ivy down its front.

## Layout protection (#754)

- Everything stands inside the landmark's own 2×2 footprint (already occupied), except the beacon.
- The beacon stands on canal water that no walk, move trip, landing or gate uses.
- `tests/p7-landmarks.test.ts` checks this against the real generated layout. It caught a first beacon position
  whose base touched the sand bank.
- Nothing is saved or read by the simulation (the test also checks that).

## Numbers

| Shot | Draw calls before → after |
|---|---|
| ruined day lock | 1,048 → 1,112 (+6%) |
| ruined day third | 1,096 → 1,151 (+5%) |
| thriving day lock | 1,113 → 1,200 (+8%) |
| thriving day third | 822 → 886 (+8%) |

- Every increase is within the +25% budget.
- Day clipPct is 0.01–0.19%. At night it is 1.3–1.6%: the waymark's glow and the lit beacon, the same order as
  main's night shots.
- `npm run typecheck` is clean, `npx vitest run` passes 1444 tests (2 skipped), and the shot runs had no page errors.

## Still to do / what looks wrong

- **Authored templates (#750)** go through the owner's Blender pipeline (`docs/art/meshy-assets.md`) and couldn't
  be made in the cloud container. Proposed briefs: an ivory-and-gold fountain variant, a botanical pavilion, a solar
  monument. The procedural dressing is the shared language they should match.
- The park fountain already had five tiered looks (E21.6) and was left as it is.
- The other eight landmarks get the generic dressing (tint, lanterns, pots), but only the Sea Lock was shot. Their
  lantern spots assume the model's front faces +z; check each from its region's camera.
- In the lock camera, a waymark goal (a crate with a gold lotus) stands in front of the gate on a fresh game. That
  is a goal placement, not touched here.
- Restoring lanterns barely show by day. That is deliberate: no glow spam.
