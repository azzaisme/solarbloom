# SOLARBLOOM — PHASE 5: ECOLOGICAL OVERDRIVE

**Claude implementation handover | Existing PlayCanvas + TypeScript project | Browser / mobile | Epics E12–E17**

> Restore a park. Merge your machines. Build extraordinary structures. Trigger a living ecosystem that becomes more powerful and beautiful with every upgrade.

## 0. Instructions for Claude

Read the existing project and `SOLARBLOOM_PHASE_4_EPICS.md` first. This is a continuation, not a rewrite. Preserve the existing isometric grid, park layout, fountain, grove, mobile controls, saves, restoration, tile evolution, drones, Bloom Chains, Bloom Frenzy and Hidden Lucky Cat wherever implemented. Reuse existing architecture and installed PlayCanvas version. Do not treat old design documents as proof of implementation.

Implement one epic at a time, in order. Before coding, inspect affected systems, identify missing prerequisites, reproduce defects and record baseline metrics. After each epic, provide a playable build, changed files, tests actually run, balance changes and unresolved issues. Do not claim human playtests without conducting them. Keep tuning data centrally configurable. Avoid unnecessary dependencies, new permanent currencies, complex logistics or punitive events.

### Current screenshot baseline (November 15, 2026)

| Observation | Investigation required |
|---|---|
| Energy 60/60, +120/min | Useful demand or overflow may be insufficient. |
| Water 40/40, +9/min | Check net versus gross rate and overflow. |
| Biomass 100/100, +3,552/min | Hard cap likely undermines incremental progression; verify. |
| Park appears largely green, with white paths and repeated small trees | Add vertical silhouettes and differentiated evolution, not more random clutter. |
| Next objective: Clear the grove, 0/166 tiles; one area cleared | Check whether this is the next locked area or a counter defect. Break large objectives into smaller payoffs. |
| Efficient Pulse: energy cost -25%, while energy is full | Low perceived value; prioritize power, coverage and synergy. |
| Frenzy meter appears at 0% | Verify charging in completed areas and during automation. |

This is screenshot evidence, not a code or gameplay audit. If any issue is already solved, retain the working solution and test it rather than duplicating it.

## 1. Phase goal

Turn the current park into an incremental playground with repeatable, meaningful interactions even after restoration is complete. The player's original machines should evolve into spectacular landmarks. More content is only worthwhile if it changes the way the player plays.

Design pillars: immediate tactile rewards; visible power escalation; optional active play that amplifies automation; interesting grid placement; surprising discoveries; a beautiful living environment. No punishment for taking breaks or missing events, no paid random rewards, no artificial scarcity designed to compel return visits.

| Epic | Priority | Dependencies |
|---|---|---|
| E12 — Economy scaling | P0 | Audit Phase 4 prerequisites |
| E13 — Machine merging | P0 | E12 |
| E14 — Superstructures | P0 | E12, E13 |
| E15 — World events | P1 | E12, modifier and chain systems |
| E16 — Living ecosystems | P1 | Tile evolution, E14 |
| E17 — Distinct districts | P2 | E12–E16 release gate |

## E12 — Economy scaling and useful overflow

**Player experience:** I accumulate wealth, see my production accelerate, and always have an exciting purchase in sight.

### Stories
- [ ] Audit resource transaction paths, caps, production display, affordability, overflow, Frenzy charging, progression counters and save version. Capture a fresh-save and existing-save baseline.
- [ ] Remove the gameplay storage cap on biomass. Retain energy and water caps where useful. Migrate existing biomass quantity exactly; do not invent previously discarded resources. Remove obsolete biomass-capacity purchases or convert them to equivalent useful upgrades with a documented migration.
- [ ] Store numeric amounts at adequate precision; use finite nonnegative arithmetic, deterministic rounding and abbreviated display (K/M/B/T). Establish a supported maximum and a safe large-number strategy before exceeding safe integer precision. Never silently clamp ordinary reachable wealth.
- [ ] Show actual net production and distinguish gross output, consumption and overflow in an inspect view. Do not advertise unusable production as collected income.
- [ ] Route energy/water overflow into bounded Frenzy charge or a useful bonus. Suggested charge: 10% of a normalized excess-production fraction per second at full utilization, tuned with a per-second cap; no charge from endlessly clicking an already-maxed tile. Normal successful restoration, evolution, machine merges and productive automation can also charge the meter. Stop charging during active Frenzy; no stockpiling unlimited queued activations.
- [ ] Replace repetitive percentage-only upgrades with visible power tiers: larger pulse, additional chain hops, multi-target drones, harvest bursts and merge unlocks. Keep efficiency as a secondary choice if operating costs actually constrain play.
- [ ] Add meaningful spending opportunities: machine construction/merges, superstructure projects, area relays, upgrades. Show the next affordable purchase and estimated time based on actual available income; never block interaction behind an overlay.
- [ ] Provide intermediate objectives (e.g. 10/25/50 restored tiles, first synergy, first merge); validate unique tile counts by area and distinguish evolved from newly restored tiles.

### Initial tuning hypotheses

| Active play time | Biomass/min target | Expected power beat |
|---|---:|---|
| 1 min | 10 | First meaningful pulse upgrade |
| 5 min | 250 | Automation and first chain |
| 15 min | 5,000 | First major landmark / merge |
| 30 min | 150,000 | First superstructure |
| 60 min | 5,000,000 | Multiple evolved networks |
| 120 min | 1,000,000,000 | District-scale production |

These are illustrative targets, not guaranteed rates or timer-gated unlocks. Existing economy may require a different curve. Tune using effective income and time-to-afford rather than multiplying every number blindly. Example upgrade cost formula: baseCost × 1.65^level; vary per tier and test against actual production. Ordinary upgrades should target 30–90 seconds of active earnings; major projects 3–8 minutes with intermediate rewards. Avoid making every purchase instantly affordable or leaving players idle for a mandatory wait.

### Acceptance criteria
- [ ] Biomass can exceed 100 and fund all reachable purchases; old saves preserve balances and unlocks.
- [ ] No impossible cost/cap combination; insufficient resources produce a clear explanation without spending anything.
- [ ] Overflow cannot be farmed via duplicated transactions or refunded placement loops; full storage is useful or clearly explained.
- [ ] Frenzy charges through legitimate productive activity even in restored areas and cannot recursively charge itself.
- [ ] Resource HUD stays readable at large values on mobile; economy tests cover zero, large values, insufficient funds, migration and modifier expiry.

## E13 — Merge and evolve machines

**Player experience:** Three ordinary machines combine into one gorgeous, much more powerful machine. The grid becomes a satisfying puzzle instead of a static checklist.

### Rules and initial balance

Merge three same-family, same-tier machines that form an orthogonally connected cluster on one unlocked grid. Diagonal contact alone does not qualify. Preview the anchor, output, cost, reclaimed tiles and affected synergies before confirmation. Any selected member can be the anchor if its destination footprint fits. Tier 3 is the initial maximum; do not implement an unbounded tier system yet.

| Family | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Solar | Panel | Array | Solar Megaflower |
| Water | Collector | Condenser Array | Water Nexus |
| Drone | Drone Hub | Fleet Hub | Drone Megahub |
| Ecology | Pollinator Garden | Bloom Garden | Tree of Life |

Suggested output index per machine: T1 = 1, T2 = 4, T3 = 18. Thus a merge improves total output from 3 to 4 or 12 to 18, before synergies. Start with no fee on first T2 merge; later test a modest biomass cost (roughly 15–30 seconds of current income). T3 merges create a core/project for E14 if implemented; before E14, cap at T2 rather than offering a nonfunctional unlock.

### Stories
- [ ] Implement reusable merge eligibility and preview using stable machine IDs and grid coordinates, not mesh position.
- [ ] Add a contextual merge action and optional highlight for valid clusters; no automatic irreversible merge. Support touch tap selection and cancel.
- [ ] Commit merge as one simulation transaction: validate inputs and footprint, charge cost, remove consumed machines, create upgraded machine/core, release occupancy and recalculate networks. Reject stale previews and duplicate input.
- [ ] Preserve underlying tile restoration/evolution state when occupancy changes. Reassign drones safely; cancel/requeue reserved jobs without double rewards. Keep existing upgrade investments according to an explicit rule (suggest highest applicable upgrade level retained; report any losses before confirmation).
- [ ] Animate machines converging into a bigger silhouette, with bounce, rising pitch, particles and output-number comparison. Simulation commits once; visuals never grant rewards.
- [ ] Add repeatable merge goals and affordable placement guidance. Avoid forcing players to demolish decorative paths or landmarks.

### Acceptance criteria
- [ ] Three valid same-tier machines merge once with output gain and reclaimed cells when footprint allows.
- [ ] Invalid tiers, diagonal-only clusters, blocked destination and insufficient funds cannot mutate state.
- [ ] Merge preserves tile state, saved progress, legitimate drone jobs and resource accounting.
- [ ] Mobile selection, preview and cancellation work; reload after merge does not resurrect consumed machines.

## E14 — Superstructures and landmark transformation

**Player experience:** My modest park becomes a futuristic paradise with imposing, adorable machines that change gameplay, not just bigger numbers.

| Structure | Suggested footprint | Distinct ability |
|---|---|---|
| Solar Megaflower | 2×2 | Charges a solar burst; supplies a temporary network production multiplier |
| Water Nexus | 2×2 | Sends irrigation waves across connected eligible tiles |
| Tree of Life | 3×3 | Stores productive bloom events and releases mass tile evolution |
| Drone Megahub | 2×2 | Dispatches a bounded swarm with multi-target restoration jobs |

### Stories
- [ ] Unlock each project through its family progression. A T3 merge produces a core, which can be placed as a superstructure on a valid footprint. Never consume the three T2 machines without either a valid placement or a durable stored core. Show footprint and total cost beforehand.
- [ ] Use staged construction (foundation → assembly → activation) with 2–3 resource contributions, visible progress and distinct silhouettes. No mandatory waiting timer after resources are supplied.
- [ ] Implement genuinely distinct abilities: solar burst 3× production for 15 seconds, Water Nexus wave up to 24 eligible tiles, Tree of Life evolution up to 12 eligible tiles, Megahub up to 6 concurrent drones. Initial values only; respect existing eligibility and resource rules.
- [ ] Charge abilities from successful productive events or actual resource flow, not raw frame count. Provide manual activation and an optional automation toggle after first use. Explain readiness and cooldown. If no eligible target remains, display that fact and preserve charge or offer a defined productive alternative.
- [ ] Add modular white/cream rounded hard-surface assets, solar gold and water cyan accents, animated unfolding, foliage, soft shadows and clean silhouettes. Keep grid footprint readable and selection possible under tall objects.
- [ ] Make the first completed project an event: camera nudge (optional), unfolding machinery, spreading light, sound crescendo, before/after view and clear permanent output increase. No blocking cinematic.
- [ ] Define ownership and interaction with existing fountain, Mother Tree, Elder Tree and landmark systems. Reuse or evolve existing structures where sensible, not duplicate names/mechanics. Do not count construction as newly restored tiles.

### Acceptance criteria
- [ ] At least one superstructure can be earned through normal play without debug resources, and substantially changes active gameplay.
- [ ] All four families have differentiated behavior, previews and valid placement; blocked footprints cannot consume cores.
- [ ] Charge persists across save/load; effects are bounded and cannot recursively generate unlimited chain/reward events.
- [ ] Larger meshes do not obstruct grid picking or essential HUD; reduced-motion mode remains functional.

## E15 — World events and Hidden Lucky Cat

**Player experience:** The world occasionally surprises me with a playful opportunity, never an obligation.

| Event | Suggested effect | Duration |
|---|---|---|
| Solar Supernova | 10× gross solar production (overflow rules still apply) | 20 s |
| Great Migration | Butterfly wave evolves up to 20 eligible tiles | 15 s |
| Super Rain | 3× water output and bounded irrigation waves | 25 s |
| Lucky Cat Invasion | Up to 3 discoverable cats with independent rewards | Cats persist until found or saved for later |

### Stories
- [ ] Implement a seeded event scheduler in simulation time; initial opportunity every 3–6 active minutes after automation unlock. Prefer events relevant to existing systems. No wall-clock deadlines, missed-event penalties or push notifications.
- [ ] Show a small nonblocking event banner, clear effect and timer where relevant. Let normal gameplay continue. Persist active event and remaining time; pause consistently with existing simulation controls.
- [ ] Reuse the modifier system for effects. Specify stack policy: same category uses strongest multiplier; cross-category multiplier capped initially at 20×; apply once to baseline, not repeatedly to already multiplied output. Tune with Frenzy and Lucky Cat together.
- [ ] Preserve standard, Golden and Rainbow Cats if present. Suggested discovery distribution 80/18/2; guarantee useful rewards even on completed areas. First discovery may be deterministic for onboarding. Do not add paid chances or chase mechanics.
- [ ] Spawn cats only on reachable, visible anchors, avoiding buildings that conceal the entire cat or UI overlays. Provide a subtle accessible hint after time or via inspect; no penalty for ignoring it. Persist cat IDs, positions and claimed state; award exactly once.
- [ ] Make reward selection meaningful: harvest scaled to effective production, a temporary solar modifier, Mega Bloom or drone party; use fallback payout if no eligible targets. Cap age-based growth and avoid rewarding intentional waiting more than playing.
- [ ] Celebrate with a meow, paw wave, gold sparkles and compact reward toast. Keep rare effects distinguishable without relying only on color.

### Acceptance criteria
- [ ] All event types trigger under seeded debug tests and resolve normally; no event is required to progress.
- [ ] Pausing, reload, event overlap and Frenzy stacking cannot duplicate rewards or create unbounded multipliers.
- [ ] Every spawned cat can be found or hinted, including on mobile; claiming twice gives one reward.
- [ ] Events with no eligible tiles still provide a useful alternative, not a misleading celebration of zero progress.

## E16 — Living ecosystems and visual differentiation

**Player experience:** Leaving the park alone for a moment reveals birds, butterflies, robots and beautiful new details created by my progress.

### Stories
- [ ] Derive biodiversity from existing tile stages, species/feature diversity and landmark unlocks; use it as a visible progress score, not another spendable currency.
- [ ] Unlock fauna in meaningful milestones (suggest 10 blooming tiles → butterflies; 20 thriving tree tiles → birds; restored pond → koi; first superstructure → friendly robots). Make conditions configurable and achievable in current maps.
- [ ] Add small cats sleeping near machines, distinct from collectible Lucky Cats. Decorative creatures must not impersonate reward objects.
- [ ] Cosmetic ambient fauna should use pooled actors and deterministic wander routes; only explicitly defined gameplay fauna produce bonuses. Never grant resources from cosmetic animation callbacks.
- [ ] Replace uniform tree repetition with seeded variants, flower clusters, shrubs, rocks, lawn edges, white path borders and local landmarks. Preserve grid semantics and restoration contrast; decoration must not occupy build cells unless clearly marked.
- [ ] Add gentle machine idle animation and active effects tied to real operation. Introduce optional warm dusk/fireflies as visual ambience only; no new night management penalties.
- [ ] Build asset budget and quality tiers: instanced/batched vegetation where feasible, shared materials, pooled particles and capped active actors. Prefer fewer high-quality assets to hundreds of unique meshes.

### Acceptance criteria
- [ ] Restored, Blooming, Thriving and Radiant states are visually distinguishable at gameplay zoom.
- [ ] Creature unlocks are observable and correctly tied to progression; decorative creatures never block inputs.
- [ ] Completed areas feel alive without requiring additional player chores.
- [ ] Test on representative mobile hardware where available; report frame times, memory and draw calls rather than claiming unsupported performance.

## E17 — Distinct districts (only after core release gate)

**Player experience:** A new district introduces a new way of becoming powerful; it is not the same restoration checklist again.

| District | Signature mechanic | Major payoff |
|---|---|---|
| Park / Grove | Existing restoration, tile evolution, merge tutorial | Living fountain / Elder Tree landmark |
| Wetlands | Water overflow and irrigation cascades | Water Nexus cascade and restored pond |
| Solar Fields | Bursts, solar placement synergies | Megaflower network activation |
| Sky Gardens | Cross-building relays and chains | Neighbourhood Bloom across rooftops |

### Stories
- [ ] Preserve existing Park/Grove progression and any already implemented Phase 3 districts. Audit their IDs and unlock dependencies before modifying map data.
- [ ] Build one new district first: Wetlands. Use authored grid layout with distinct water features, elevation, paths and clear landmarks; reuse existing grid renderer and simulation. Prove its mechanic before building the rest.
- [ ] Unlock through a reachable landmark and meaningful project rather than a giant raw tile count. Add intermediate goals involving irrigation, merges and chain size. Show next district preview early, without an intrusive prompt.
- [ ] Shared resource economy and persistent old districts; continue productive automation when users visit another district, using efficient aggregate simulation if needed. Do not load all meshes at once on mobile.
- [ ] Implement relay adjacency as explicit graph edges for permitted cross-area chains. Preserve local placement logic. Set chain event budget and visited IDs across districts to avoid loops.
- [ ] Once Wetlands is validated, implement Solar Fields, then Sky Gardens. Each must introduce at least one distinct reusable interaction with readable cause/effect. No extra resource currency needed.
- [ ] Provide return navigation and camera bookmarks. Ensure moving districts cannot reset event rewards, machine jobs or local progress.

### Acceptance criteria
- [ ] Core park loop passes release gate before new district work begins.
- [ ] Wetlands has a signature mechanic and measurable player benefit different from the Park; later districts follow the same rule.
- [ ] Returning to prior districts preserves machines, tile state, resources, cats and landmark progress.
- [ ] Cross-district chains are finite, correctly accounted and visually readable; mobile memory/performance budget is verified.

## 2. Technical integration contract

Use existing modules where possible; conceptual boundaries below are not mandatory class names.

```text
Economy / BalanceConfig     transactions, wealth, caps, overflow, net production
MachineRegistry / Grid      families, tier, footprint, occupancy, merge validation
Progression / Projects      unlock graph, stored cores, staged construction
Automation / ChainResolver  eligible jobs, reservations, visited IDs, bounded queue
ModifierSystem / Frenzy     charge sources, expiry, explicit stacking policy
WorldEvents / Discovery     seeded schedule, cat anchors, one-time claims
DistrictState               persistent map IDs, relays, aggregate inactive simulation
Presentation / HUD          responsive UI, preview, camera, audio, VFX, fauna
Save / Migration            versioned snapshots, stable IDs, migration fixtures
Metrics / Debug             local logs, repeatable seeds, performance counters
```

Simulation owns truth; presentation consumes committed events. Use transaction IDs and atomic validation for purchases, merges, rewards and construction. Use a bounded work queue for chain propagation (initial max 128 events per root chain, spread visual work over frames). Deduplicate per root/target/effect; do not repeatedly pay for unchanged tiles. Avoid multiplying raw production from multiple independent systems without a central stacking policy. Existing minimum recovery mechanisms must remain available.

Save fields to consider: schemaVersion, resource amounts, machine ID/family/tier/footprint, project cores and stages, district tile state, active modifiers and timers, Frenzy charge, seeded event state, cat IDs/claims, milestone flags. Use migration fixture tests from actual old saves. Document migration fallbacks and avoid destructive resets. Keep offline progression behavior consistent with existing game; do not add unlimited offline rewards in this phase.

## 3. Phase 5 playtest and reward pacing

| Window | Target experience (not forced timing) |
|---|---|
| 0–5 min, fresh save | Frequent restoration feedback, first power upgrade, useful automatic production |
| 5–15 min | Drone/chain play, first merge, first landmark, cat discovery or Frenzy opportunity |
| 15–30 min | Several merges, visible production increase, first staged superstructure |
| 30–60 min | Multiple structure abilities, evolved tiles and living ecosystem, optional events |
| 60–120 min | Distinct districts only if core is proven; return to enjoy evolved starting park |

Maintain Phase 4 micro feedback every 1–3 seconds of active play, small payoffs every 10–20 seconds, meaningful upgrades approximately 30–90 seconds, discoveries every few minutes and major milestones roughly 5–10 minutes where pacing permits. Do not force timers to meet metrics. Test returning saves as well as fresh progression. Measure time-to-afford, cap waste, idle stretches, merge frequency, feedback clarity, Frenzy usage, chain sizes, event rewards, input errors and frame time. Ask players what they are saving for and why, whether they feel stronger, and whether new districts feel genuinely different. Use scripted tests if human feedback is unavailable, labeling them accurately.

## 4. Definition of done / release gates

- [ ] Phase 4 regressions pass: mobile UI, restoration, tile evolution, automation, Frenzy, Lucky Cat, save/load.
- [ ] Resource economy stays usable at both early and advanced progression; no hardcap deadlocks or infinite reward exploits.
- [ ] Machine merging is repeatable, readable, rewarding and safe.
- [ ] Superstructures change gameplay and world silhouette, not just numerical output.
- [ ] World events are optional and modifiers stay bounded.
- [ ] The park remains visually readable and enjoyable after completion.
- [ ] Existing saves migrate; fresh and returning paths tested.
- [ ] Before E17, demonstrate a satisfying 15–30 minute loop with economy, merge and one superstructure. If feedback is weak, tune those systems first rather than adding districts. Human satisfaction cannot be certified by automated tests alone.
- [ ] Final build runs in target browser; desktop/touch input and supported orientation tested. Aim for smooth 60 fps desktop and at least 30 fps on representative mobile devices; report hardware and actual results, adjust quality tiers if needed.

## 5. Scope lock

No prestige/reset loop yet, new permanent currencies, mandatory day/night resource survival, manual pipe/cable routing, multiplayer, monetisation, extensive weather simulation or endless procedural districts. Avoid adding more content until the existing progression has a compelling next purchase and active action at every stage.

## 6. Claude kickoff prompt

> Read `SOLARBLOOM_PHASE_5_EPICS.md` and the existing Phase 4 spec. Inspect the current PlayCanvas/TypeScript repository and preserve the existing park, isometric grid, saves and completed functionality. Start with E12 only: audit real economy, objective counts and Frenzy, then implement uncapped biomass and useful bounded overflow, migrate saves and verify progression. Report actual tests before proceeding. Implement E13–E17 one epic at a time, with merge previews and atomic transactions, meaningful superstructures, optional events, living ecosystems and distinct districts only after the core loop is proven. Use existing architecture, central configuration and mobile performance safeguards. All supplied numerical values are playtest hypotheses. Do not rebuild the game or add unrelated features. Our goal is visible, escalating power and a world that becomes extraordinary through enjoyable play.

**Final principle:** A player returning to the starting park after an hour should barely recognise it — because their original creations have evolved, not because the game replaced them.
