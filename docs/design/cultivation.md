# Look 6: living transitions — design spike (#170)

Part of #169 (Look 6) and the art-direction epic #102. This doc decides the shape of the rest of Look 6: for every
tile transition, whether it takes **gameplay time** or is **visual catch-up**, how long it lasts, what speeds it up,
and what happens offline. Every number lives in `TUNING.transitions` / `TUNING.cultivator` (`src/data/tuning.ts`)
and **every number is a hypothesis**: the timings were picked by hand and then checked against the bots (seeds 7
and 21), not against people.

## The rule this spike lands on

**The sim keeps every timing it has today.** A pulse still turns a tile `restored` 0.8 s after the tap, a chain step
still restores its tile on the step, and a seep still drops pollution by 25 at once. Production, chain eligibility,
objective counts, area clears and costs all happen at exactly the moment they happen on `main`. On top of that,
**every change starts a transition** (`TileData.tr`) that the renderer plays out over seconds on the GPU, so nothing
in the world changes in a single frame.

Why not make the restore sequence take real gameplay time (the issue's "hybrid" recommendation of 20–60 s before
full production)?

- Production is cached per chunk from bloom counts (`ProductionSystem`, `bloomCounts`). A per-tile "establishing"
  multiplier means a per-tile production path, which costs CPU at chain scale and touches the Phase 5 economy.
- The Phase 5 pacing pass (first superstructure at 15–30 min in the merging bot) was tuned against instant
  restoration. Delaying 20–60 s of production on every tile delays the whole early economy. The brief's rule is
  "if a timed transition breaks a target, make it visual-only rather than retune other systems". Since the visual
  version is just as readable, this spike starts there.
- Chains, Frenzy, Mega Bloom, Irrigation Wave, Evolution, Great Migration and Super Rain must stay instant and
  punchy. With the sim unchanged they do by construction: the first stage (a glowing fracture) plays on the frame
  the tile restores, and the rest plays out behind the action.

**What does take gameplay time:** the **Cultivator** (new machine, #177). It is the one place where time *is*
the mechanic: it pushes dead tiles through softening → moss → growing → restored on its own, at its own pace, for
energy instead of pulse costs. Its tiles carry the same transitions marked as gameplay (`tr.g`), so the UI can show
a progress ring and "time remaining", and a tap can knock them along (within limits).

Passive reclaiming in the sim (restored tiles slowly softening dead neighbours) is **not** added. It would make
prepared tiles cheaper over time with no input, which is an economy change. Instead, cracks visibly cross tile
borders from living tiles (shader only), so the creep reads without changing any numbers. Revisit it after people
have played.

## Timing table

"Visual" = the sim flips at once and the look catches up over the duration. "Gameplay" = the new state's effects
wait for the transition. Durations are seconds of sim time. Feature multipliers (`transitions.feature`) scale every
visual duration on that ground type: paving 0.8, road 1.0, water 1.2, clay 0.9, litter 1.0, lawn 1.0.

| Transition | Trigger (code) | Visual / gameplay | Duration (s) | What speeds it up | Offline |
|---|---|---|---|---|---|
| Concrete softening (pollution falls) | `tile.softened` (`restore.seep`) | Visual | **3.0**, from the edge facing the restored neighbour | Stacks: a second seep mid-way continues from the current look | Finishes (no progress kept) |
| Concrete → moss | `tile.prepared` | Visual | **6.0** creep from the living edge, along the cracks | Stacks over softening (continues smoothly) | Finishes |
| Moss/concrete → growing → restored: player Pulse | `tile.restoring` (pulse) then `tile.restored` | Visual over sim (sim: 0.8 s as today) | **12.0** total: fracture 0–8 %, heave 8–34 %, crumble to soil 34–52 %, seedlings 46–70 %, turf knit 70–100 % | Tap knock (visual): +15 % per tap | Finishes |
| …Wide/Overcharge footprint (`broad`) | same | Visual | **10.0**, plus the existing ripple delay | — | Finishes |
| …drone, condenser, overflow, Mother Tree, relay, canopy, cat | `tile.restored` | Visual | **8.0** | — | Finishes |
| …chains, Mega Bloom, Frenzy, E14 abilities, E15 events | `tile.restored` (chain/mega/super/event sources, or any source during Frenzy) | Visual, **fast** | **5.0**; the fracture flash lands on the restore frame | — | Finishes |
| Bloom 1 → 2 (nurture) | `tile.nurtured` | Visual | **3.0**, flowers open staggered across the tile | Tap during growth: quick burst, +25 % | Finishes |
| Bloom 2 → 3 | `tile.nurtured` | Visual | **4.0** | same | Finishes |
| Bloom 3 → 4 (Radiant) | `tile.nurtured` | Visual | **5.0** | same | Finishes |
| …automatic nurtures (drones, Evolution, chains, events) | `tile.nurtured` with `auto` | Visual, fast | **×0.6** of the above | — | Finishes |
| Lush soak (Reservoir Overflow, irrigation) | `complete(…, 'overflow')` sets `lushUntil` | Visual | soak **2.5** from the water side | — | Wet mask follows `lushUntil` |
| Lush dry-back | `lushUntil` approaching | Visual | the last **10.0** before `lushUntil` | — | — |
| Paving reclaimed | as restore | Visual | ×0.8: grime washes off, moss in the joints, ends as clean stone | — | Finishes |
| Road reclaimed | as restore | Visual | ×1.0: asphalt cracks, verges creep in from the edges | — | Finishes |
| Water cleared | as restore | Visual | ×1.2: murky → blue from the inflow side | — | Finishes |
| Clay/soil, litter | as restore | Visual | ×0.9 / ×1.0: dries → darkens → sprouts; litter rots away | — | Finishes |
| Obstacle cleared (`unblocked`) | `AreaSystem` entry fix | Visual | **2.0** crumble | — | Finishes |
| District bloom | `district.bloom` | Visual wave | each tile delayed **0.05 s per tile** of distance from the district's first landmark (cap **3.0**), then a fast transition (5.0) | — | Instant in the sim, as today |
| Area clear / landmark wake (props) | `area.cleared` | Visual wave | delay **0.04 s/tile** from the landmark (cap **3.0**), **1.5** per prop | — | — |
| Fog lifting | `area.cleared`, `area.fogChanged` | Visual front | rolls from the landmark across the area over **3.0** | — | — |
| **Cultivator: softening** | Cultivator works a polluted tile | **Gameplay** | pollution falls at **20/s** × speed (100 → 0 in 5.0 s) | Speed upgrade; tap knock +15 % of the phase (≤ 3 per phase, 0.4 s apart) | Advanced by `OfflineSystem` at the offline rate |
| **Cultivator: moss → growing → restored** | pollution reaches 0 | **Gameplay** | growing **3.0** × 1/speed, then restored (source `cultivator`); the visual restore (8.0) continues after | same | same |

All visual transitions also play at full length with **reduced motion** on, as colour and mask fades with no
geometry motion (no heave, bob or bounce). On the Low tier and far zoom only the surface fade plays (no
transitional geometry).

## Chains, Mega Bloom, Frenzy, abilities and events stay punchy

- The sim is untouched, so every tile restores on the same frame as on `main`; the chain's combo counter, rewards
  and arcs are exactly as fast as before.
- The fast variant (5 s) is used for every automated mass restore. Its first 8 % is a **glowing fracture** that
  starts at the edge facing the chain's previous tile, so a chain reads as a crack racing across the city (#176).
- During Frenzy, every restore uses the fast variant too.

## Stacking

A tile has at most one active transition. A new change mid-transition **replaces** it, starting from the current
look: the new transition's `from` values are interpolated from the old one at its current progress (pollution for
softening/moss, bloom for nurtures), so nothing snaps. A tap knock moves `t0` back (more progress), never forward.

## Saving and offline

- `TileData.tr = { k, t0, d, dir?, from?, g? }` is saved in the `TilePack` extras (field 6). `SAVE_VERSION` goes
  to 7 (older saves are scrapped with the existing notice; no migration, as agreed).
- Visual transitions are keyed to sim time, so a tile loaded mid-transition continues where it was.
- Offline: the sim clock doesn't move while away (OfflineSystem design), so `OfflineSystem.apply` **finishes every
  visual transition** (clears `tr`). The Cultivator's gameplay work is advanced for the time away, at
  `offline.rate`, with its energy drawn from the same stores, and the summary reports it ("Your cultivator broke up
  12 slabs while you were away").
- Chunks with a gameplay transition stay loaded (like chunks with growth today).

## The Cultivator (#177–#179)

A solar tiller: a 1×1 base (the charging dock) plus one mobile unit that drives over dead tiles near the dock.

| | Value | Notes |
|---|---|---|
| Unlock | after the first Drone Hub | Same gate as the Mother Tree and the relay |
| Build cost | **140 🌿, 30 ⚡** | Biomass to build, an energy part (≤ 60 % of the cap, `machineCostMaxShare`) like every machine since E12 |
| Running cost | **0.5 ⚡/s while working** | Solar: it parks when energy is below the drone reserve (25 %) |
| Work radius | **5** tiles from the dock (**9** with auto-routing) | Rows: nearest dead tile first, then along the row |
| Drive speed | **0.8** tiles/s | |
| Per tile | soften 5.0 s (from 100 pollution), grow 3.0 s | ≈ 8 s/tile and ≈ 4 ⚡/tile (a drone pays a full pulse cost per tile, water included) |
| Reservations | the drones' reservation set | A drone and the Cultivator never take the same tile |
| Chains | its restores are `cultivator` restores: they can set off chains like a drone's | |

Per-machine upgrades (bought on the Cultivator, like the hub's):

| Upgrade | Price | Effect |
|---|---|---|
| Tiller Speed | ⚡ (energy) | +40 % work and drive speed per level (3 levels) |
| Wide Tines | ⚡ (energy) | works 2, then 3 tiles side by side (2 levels) |
| Seed Mix | 🌿 (biomass) | restored tiles start at bloom 2 (1 level) |
| Fog Seeker | 🌿 | auto-routes to the fog edge, radius 9 (1 level) |
| Second Tiller | 🌿 | a second unit from the same dock (1 level) |

**Merging:** the Cultivator does **not** merge. It is a mobile unit, and three docks in a row don't mean anything
spatially; its scale-up path is Wide Tines and the Second Tiller. (Saying so per the brief rather than forcing a
merge family.)

**Advisor:** suggests building one when a Drone Hub exists, no Cultivator is built and it is affordable.

## What stays a hook for later work

- **End states** (Look 3, Look 2.6): every end look comes from today's stage visuals. The surface colours come
  from `surfaceLook()` in `src/rendering/transitions/EndStates.ts` and the decorations come from the chunk renderer's
  existing per-stage builders, so Look 3 can swap textures, paving, grass, flowers and shrubs in one place each.
- **Quality tiers** (Look 1): the transition framework reads a tier (`low | medium | high`) through
  `TransitionRenderer.setTier`. Until Look 1's tier setting lands it follows the "Reduce effects" setting.
- **Camera follow for big waves** (City 14.5) is not part of this.

## Bot check

Before/after pacing numbers (bots, not people) are recorded in the #170 and #180 issue comments once the
implementation lands. Visual transitions can't move them by construction; the Cultivator is measured with a bot
that builds one.
