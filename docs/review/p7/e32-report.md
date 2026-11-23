# P7-E32 report: atmospheric world, skyline and distant ruins (#718)

Branch `p7-e32-skyline` (E27 final, then `claude/trusting-fermi-cgucwe` @6814d7ca with E27 + E28 + E29 merged in).
Audit of the old horizon: [`e32-audit.md`](e32-audit.md).

**Shots.** `e32/` is every stage from the three fixed cameras by day. `e32-golden-night/` is the mid stage at golden
hour and night. Before: E27's `after/` and `after-golden-night/`. Those have no E28/E29 vegetation, so compare the
horizons, not the planting. `e32-r2/` is the procedural-only round the lead reviewed (kept for the record).

| Key frame | What it shows |
|---|---|
| `e32/mid-day-shore.png` | The shore camera looking south: a cliff-mesa headland on the left with the broken dome, aqueduct arches and a derelict turbine; arches on the far shore to the right; the open sea between them |
| `e32/late-day-third.png` | Every area round the start cleared, so the cloud ring is gone: the whole ruined skyline stands behind the island (twin towers, arches, solar frames, turbines), fading blue |
| `e32/mid-day-third.png` | Early on, the skyline reads in the gap above the beach walls (the cloud ring is kept as tuned) |
| `e32-golden-night/mid-night-shore.png` | Night: dark blue silhouettes, one tiny warm light |

## What was built

- **The ruined city** (`src/rendering/Ruins.ts`, `src/data/ruins.ts`). Three bands of coast round the island: near
  ~225, mid ~350 and far ~500 units from its centre.
  - The near and mid bands stand the owner-approved authored models (`assets/raw/models/ruins/`: aqueduct, twin tower,
    broken dome, solar frame) on `ruin-cliff` mesas; twin mesas make headlands. The models are parsed by
    `RuinModels.ts` and baked into the band meshes.
  - The far band, and thin or long mid pieces (viaduct, turbine, spire), are procedural.
  - Up to three waterfalls, each with a mist foot, run off the near mesas.
  - No two identical pieces stand side by side.
  - Everything is seeded and never saved. If the models fail to load, all pieces fall back to procedural.
- **Composition.** The open sea due south of the start (345°–15°) stays open, framed by mid and near headlands;
  this is tested.
- **Values step back** (#761):
  - The near band is clearly darker and bluer than the sky (fade 0.10). The mid band fades 0.30 and the far band 0.50,
    toward the sky's horizon colour, read from `Sky` at runtime.
  - The ruins have their own height fog, so the coasts' feet melt into the sea haze.
  - At night the ruins are dark blue silhouettes, with at most 7 tiny warm lights.
- **Clouds as banks** (#760). Every puff is cut flat at one floor, giving a shaded underside and a lobed bank profile.
  Wall clouds lie along their edge and are drawn out along it. The sky's own ring is flat-bottomed banks.
  `LOOK.cloudRing`, its tiers, its wisps and the light panel are unchanged.

## How it is drawn

The scene fog is fully opaque 64–88 units out and the far clip follows it, so the ruins can't stand in the world at
their real distance. The obvious fix fails: drawing them first, behind everything, lets the island's own distance
paint over their bodies. That distance has gone wholly to haze but is still opaque, so only the ruins' tops showed,
floating.

So the ruins draw right after the world's opaque pass, and depth-test against it:
- **Projection.** In the vertex shader (`RUINS_TRANSFORM`), each vertex slides along its own ray from the camera into a
  thin band of depth, just short of where `LOOK.horizon`'s haze is full. Real distance maps in order onto that band.
- **Result.** The image on screen is exact, and the ruins hide one another correctly. The visible world in front of
  that band hides them, while the haze-coloured distance behind it doesn't.
- **Batching.** There is one mesh per band and 60° slice. Each frame, `Ruins.update` sets three uniforms and switches
  off the slices out of view. The camera can't cull them, because their real places lie past the far clip. When the
  horizon is above the top of the view (the overview camera), it switches off the whole set.

## Numbers

- **Ruins' own draw calls** (`tests/e2e/p7-ruins-cost.mjs`, High): third-person 6, shore 8, overview 0, out of 17
  meshes. The overview camera drew 9 before the horizon check, though it sees no horizon.
  Whole-frame totals in `metrics.json` swing with chunk streaming by more than that; the old budget for the ruins was
  9 drawn.
- **Triangles:** ~136k for the whole set, of which a third or less is in view.
- **CPU per moving frame** (`tests/e2e/p7-ruins-cpu.mjs`, 240 calls while turning; pure JS, so the number counts
  despite software GL):

  | Version | Third-person | Shore |
  |---|---|---|
  | CPU repositioning (first version) | median 10.4 ms, p95 16.1 ms | median 7.8 ms, p95 17.9 ms |
  | Vertex shader (now) | median 0.0 ms, max 0.1 ms | median 0.0 ms, max 0.1 ms |

- **Brightness:** `clipPct` stays under 1% everywhere by day. Night third-person is 1.53%; that's the lotus glow,
  already 1.38% in E27's set, not the ruins.
- **Tests:** typecheck clean; full unit suite 138 files, 1,380 passed, 2 skipped. `tests/p7-ruins.test.ts` is in the
  quick suite: determinism, band order and fades, clear of the island and the southern sea, budgets, lights, and
  parsing the models.

## Stories

| Story | State |
|---|---|
| #755 audit | Done: `e32-audit.md` |
| #756 layered ruined skyline | Done |
| #757 height and distance fog | Height fog inside the ruins layer only. **Deferred by the owner:** a height term on the world fog, at the final polish once everything is merged, so E27's calibration isn't redone twice |
| #758 wasteland character | **Split:** the distant derelict infrastructure (solar frames, turbines) is done here; the on-island dead ground goes to the P7-E30 terrain session (it's tile and terrace code) |
| #759 oasis vs wasteland | Nothing global tinted; `LOOK.grade` untouched. The ruins stay ruined while the island restores |
| #760 clouds | Done (banks, not balls); cloud ring values kept as tuned (owner) |
| #761 day, golden, night | Done; checked in all three presets |
| #762 LOD, batching, culling | Done: per-band and per-slice batches, slice culling, the overview off, the shader projection |

## What still looks wrong

- At golden hour the ruins pick up only a little of the warm key light; they read cool, close to the day look.
- The fog-of-war over hidden areas is untouched (the owner's decision). In the overview it is still the flat grey slabs.
- The waterfalls are simple sheets. They read at the near band's distance, but there's no animation.
- Draw-call totals in the cloud container are noisy (chunk streaming); the ruins' own count is the reliable figure.

## Polish pass (owner, 23 Nov)

On the base with E30 (the Falls overlook, the showcase waterfall, the wasteland) merged. Shots: `e32-polish/`
(`late-day-wide` and `late-day-overlook` are E30's `p7-falls-shots.mjs` framings).

| Owner's point | Fix | Shot |
|---|---|---|
| Ruins hang over the inland treeline | Each frame, `inlandToward` checks whether two of three rays across a slice cross island or mainland ground within the world's reach (~110 units). If so, that slice is rebaked with strong height fog (`heightFog.inland`: 0.9 over 16 m), so the feet sink into the haze. Over open sea the coasts keep their grounded mesas | `late-day-wide`, `late-day-overlook` |
| Late skyline too busy | No thin procedural pieces left (no spires, frames or viaducts; a rare turbine mid-distance). The authored models carry the skyline. Ruins stand only in **districts**, clusters ~11° wide every 24–36°, with open sky between; mesas between districts stand bare | `late-day-third` |
| A floating far slab | The far band has no procedural land any more. Its pieces sink into haze (`heightFog.far` 0.85 over 12 m) | `mid-golden-shore` |
| Golden hour reads cool | As `Sky.dusk` rises, the near and mid bands' sun-facing sides take up to 2.4× the warm key (`golden.sun` 1.4), and the cool day ambient eases halfway to neutral. Day (dusk 0) and night are unchanged; nothing global is tinted | `mid-golden-shore`, `mid-golden-third` |

Ruins' own draw calls (High): third-person 7, shore 6, overview 0, out of 16 meshes. Triangles: ~111k for the whole
set. The shader path and the procedural fallback are unchanged.
