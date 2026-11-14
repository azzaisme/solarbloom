# SOLARBLOOM — PHASE 4: DOPAMINE OVERDRIVE

**Implementation handover for Claude | PlayCanvas + TypeScript | Browser / mobile | Epic-based backlog | v1.0**

> Restore one tile. Trigger a chain. Buy an outrageous upgrade. Watch your machines multiply your power. Find a tiny lucky cat. Bring a whole park to life.

Phase 4 is not a content expansion. It is a focused effort to make the existing game delightfully satisfying to play. One excellent park is more valuable than ten mediocre neighbourhoods.

## 0. Instructions for Claude

- Continue the existing project; do not rewrite working systems or replace the isometric grid. Read the original, Round 2 and Phase 3 plans alongside this document. Phase 4 supersedes their pacing and polish targets where they conflict.
- Inspect the actual implementation first. The previous plans describe intentions, not proof of completed features. Preserve the existing park, fountain, unlocked areas, grid identities, machine placement, save data and working Lucky Cat behaviour. Do not force the earlier rooftop setting onto the park prototype.
- Use the existing architecture and package versions. Suggested names and values below are design proposals, not mandatory API names or final tuning.
- Work one epic at a time, with small testable stories. Keep the build playable after each epic. Do not implement all epics in a single unreviewable change.
- Before each epic, identify impacted files and existing functionality, then implement only missing or deficient behaviour. After each epic, report changes, tests actually run, remaining issues and tuning decisions. Do not claim playtests occurred if they did not.
- Put economy, timing, reward and upgrade tuning into central typed configuration. Preserve saves with versioned migrations and stable IDs.
- Prioritise mobile usability equally with desktop. No backend or additional framework unless genuinely necessary.
- No monetisation, loss streaks, forced return timers, punishment for breaks, or purchase-based random rewards. The goal is intrinsically satisfying play, not compulsory engagement.

## 1. Current baseline and known risks

The supplied mobile screenshot shows a clean isometric grid, a small restored green patch, flower bed, solar panel, water machine, park fountain objective and bottom toolbar. This is visual evidence only, not a runtime or code audit.

| Observation | Risk / action |
|---|---|
| Energy 60/60, +60/min; water 40/40, +69/min | Generation may be wasted; make overflow useful and spending meaningful. |
| Biomass 24/100, +76/min; Drone Hub costs 110 biomass | Potential hard progression block unless an accessible storage upgrade or overflow mechanism already solves it. Verify and fix. |
| 19/242 tiles restored; next objective 19/130 | Long gap to visible achievement; add achievable intermediate milestones. |
| Resource HUD and objective card overlap | Mobile responsiveness defect. |
| Large tutorial card and emoji-heavy controls | Too much screen obstruction and visual inconsistency. |
| Bright flat green squares, brown repeated tiles | Restore a living landscape rather than a colour-coded spreadsheet. |

## 2. Product goals and non-goals

**North star:** Players feel more capable every minute, and every increase in power is visible in their world.

Preserve: discrete isometric tiles, click/tap restoration, three resources (energy, water, biomass), placement synergies, active + automated play, Hidden Lucky Cat, landmark transformation, existing expansion if implemented.

Avoid: complex routing, citizen management, extra permanent currencies, mandatory micromanagement, endless repeated restoration tasks, new districts before the existing loop is proven, and graphics that obscure grid interactions.

### Target reward cadence (active play; initial hypotheses)

| Interval | Reward | Example |
|---|---|---|
| 1–3 seconds | Micro feedback | Tile pops, resource particles, growth, sound |
| 10–20 seconds | Small payoff | Chain, harvest, mini milestone |
| 30–60 seconds | Meaningful improvement | Larger pulse, faster drone, new synergy |
| 2–3 minutes | Discovery / special ability | First cat, new machine, Frenzy ready |
| 5–10 minutes | Major milestone | Landmark transformation, new area |

Intervals overlap; do not implement compulsory timers just to meet the table. Record actual playtest intervals and tune.

## 3. Epic roadmap

| Epic | Name | Priority | Depends on |
|---|---|---|---|
| E00 | Audit, instrumentation, baseline | P0 | — |
| E01 | Economy rescue and overflow | P0 | E00 |
| E02 | Mobile-first interface | P0 | E00 |
| E03 | Restoration juice and feedback | P0 | E00 |
| E04 | Power progression and reward cadence | P0 | E01, E03 |
| E05 | Evolving tiles and ecological synergies | P1 | E04 |
| E06 | Bloom Frenzy | P0 | E01, E04 |
| E07 | Hybrid automation and chain amplification | P1 | E04, E05 |
| E08 | Hidden Lucky Cat and discoveries | P1 | E01, E04 |
| E09 | Art direction, machines and living environment | P1 | E02, E03 |
| E10 | Landmark payoffs and first 15 minutes | P0 | E01–E09 |
| E11 | Performance, accessibility, saves and validation | P0 | Continuous; final gate after E10 |

Recommended delivery order: E00 → E01 → E02 → E03 → E04 → E05 → E06 → E07 → E08 → E09 → E10 → E11. Start performance and migration tests in E00; do not defer them all to the end. P0 means release blocker, P1 means essential polish/depth for this phase, not optional future content.

---

## EPIC E00 — Audit, instrumentation and baseline

**Outcome:** Establish what is working and what actually blocks progression before changing the game.

### Stories
- [ ] E00.1 Map existing grid, tile states, resource sources/sinks, upgrades, machine jobs, chain logic, Lucky Cat, milestones, UI, saves and touch controls. Reconcile actual code with previous plans.
- [ ] E00.2 Reproduce the screenshot economy on a fresh save and a progressed save. Test whether the Drone Hub is purchasable and how capacities are increased.
- [ ] E00.3 Capture a baseline first-15-minute run: timestamps, upgrade purchases, tiles restored, chain sizes, cap time, build failures, automation unlock and objective completion.
- [ ] E00.4 Add local debug event logging: pulse cast, tile transitioned, chain resolved, reward earned, resource overflow, upgrade purchased, machine unlocked, cat found, Frenzy ready/activated, milestone completed. No personal data or external telemetry required.
- [ ] E00.5 Add a debug reset, seeded randomness, balance presets and optional accelerated simulation for repeatable testing. Do not expose debug controls in production.

### Acceptance
- A concise audit distinguishes implemented, partial and absent systems.
- Baseline measurements are recorded or explicitly marked unavailable.
- Existing saves and core interaction work after instrumentation.

## EPIC E01 — Economy rescue and useful overflow

**Outcome:** The player never gets stuck because a required purchase exceeds capacity, and full storage is not wasted progress.

### Stories
- [ ] E01.1 Audit all mandatory purchase costs against reachable storage. If Drone Hub is still 110 biomass with a 100 cap, lower it to 80 initially or supply an earlier affordable capacity upgrade. Ensure both energy and biomass costs are reachable together.
- [ ] E01.2 Make the HUD show actual current balance, cap, net production and affordable upgrades. Distinguish gross production from consumption. Explain temporary boosts.
- [ ] E01.3 Introduce storage improvements with clear benefits (e.g. biomass 100 → 250 → 600, energy 60 → 150 → 400, water 40 → 100 → 250). These are example tiers; scale to actual economy.
- [ ] E01.4 Add spend opportunities: pulse power, range, regeneration, capacity, drone speed, garden yield. At least one useful choice should normally be nearby in early active play.
- [ ] E01.5 Route eligible excess energy/water/biomass into a bounded Frenzy contribution after E06 is available. Before then, track overflow for debugging; do not invent a fourth spendable currency.
- [ ] E01.6 Guarantee recovery: basic harvest or passive energy remains available at zero resources. No irreversible failures, no decay of restoration during absence.

### Initial tuning rules
- First upgrade target: 15–30 seconds after initial interaction; subsequent meaningful upgrades roughly 30–60 seconds during the first 10–15 minutes.
- First automation purchase affordable around minute 3–4 without waiting idle or requiring a lucky payout.
- Example overflow conversion: per simulation second, 0.1 charge per excess energy, 0.1 per water, 0.05 per biomass, capped at 0.15 charge/sec total. This intentionally limits passive overflow; tune after measurement. Overflow is consumed, not also added to stored resources. When Frenzy is ready or active, additional overflow cannot bank a second activation.
- Use atomic resource transactions: validate all costs, debit once, apply result once. No negative balances or charge from rejected actions. Clamp ordinary storage to capacity; only show intentional exceptions if designed and documented.

### Acceptance
- Every mandatory purchase has a reachable path from a fresh save without random bonuses.
- Simulate zero-energy, full-capacity and rapid-purchase cases; no deadlocks, duplicate rewards or negative balances.
- Player can recover without restarting, and storage upgrades show meaningful increases.

## EPIC E02 — Mobile-first interface

**Outcome:** The grid occupies most of the screen; it is obvious what to do without reading paragraphs.

### Stories
- [ ] E02.1 Replace overlapping top panels with a single responsive HUD layout. On narrow screens, use a compact resource strip with three icon/value/rate cells and a single-line objective below. Desktop may use side panels when space permits.
- [ ] E02.2 Keep bottom actions: Inspect, Build, Pulse, Harvest, Upgrades. Pulse is visually primary. Show selected tool, cost and affordability. Context panels open only when needed; avoid a persistent full-screen menu.
- [ ] E02.3 Replace long tutorials with short contextual prompts and world highlights. Example: “Build a Drone Hub · 24/80 biomass”. Tap Build highlights the hub; select it, then highlight valid tiles. Dismiss or collapse tutorials without losing access to help.
- [ ] E02.4 Use consistent custom icons for currencies, upgrades, tools and machines; emojis may remain temporary placeholders until assets exist. Provide text or accessible labels.
- [ ] E02.5 Add compact chain feedback, milestone progress and Frenzy meter without clutter. Upgrade affordability indicator reflects actual useful purchases rather than arbitrary notification counts.
- [ ] E02.6 Support safe-area insets, resize/orientation changes, pinch zoom, pan, tap and mouse selection. A pan/pinch must not accidentally restore or purchase. UI taps never pass through to the grid.

### Layout requirements
- Test widths 320, 360, 390, 430 CSS px and tablet/desktop; portrait and landscape. Use existing DOM HUD or PlayCanvas UI, not a duplicate UI framework.
- Touch targets ideally at least 44×44 CSS px. Account for browser chrome and bottom safe area. Keep critical information legible without zoom.
- Use readable contrast, non-colour-only affordability and selection, reduced motion and audio toggles. Do not paint full resources red as if they were errors.

### Acceptance
- No overlapping or clipped resource/objective panels at tested sizes.
- Complete build, restore, upgrade, inspect and cat discovery by touch.
- No mandatory tutorial covers the active grid for extended periods.

## EPIC E03 — Make every restoration feel incredible

**Outcome:** The simplest action feels good even before upgrades exist.

### Stories
- [ ] E03.1 Add a responsive tile hover/press preview and pulse footprint. Show eligible tiles, invalid reasons and resource cost before spending where appropriate.
- [ ] E03.2 On a successful pulse, run a brief expanding ring, tile colour/material transition, grass growth, flower pop and resource particles. Keep simulation rewards independent of presentation completion.
- [ ] E03.3 Add pooled number popups and resource particles that travel toward the correct counter. Aggregate large batches to avoid hundreds of labels.
- [ ] E03.4 Add a satisfying original sound palette: soft tap, restoration pop, rising chain tones, upgrade flourish, cat meow, landmark swell. Browser audio starts after user gesture. Provide volume and mute controls.
- [ ] E03.5 Give larger chains stronger feedback: escalating pitch, branching visible links, larger summary number, subtle camera emphasis. Do not obscure input or force camera shake.
- [ ] E03.6 Add invalid feedback that is brief and informative, without punishing sound or blocking dialogs.

### Presentation timing (starting values)
- Press response immediately / next frame; pulse ring 150–250 ms; growth 250–500 ms; chain step stagger 40–100 ms with overall animation budget around 1–2 seconds; payout summary disappears naturally. Repeated actions can overlap within VFX budgets.
- Honour reduced motion: short fades, static highlights, no forced zoom/shake or rapid flashing.

### Acceptance
- Repeated taps feel responsive; input works during ordinary effects.
- A fresh player can visually tell which tiles changed and why they earned a reward.
- Large effects use pooling and batched visual summaries; disabled effects do not alter gameplay outcomes.

## EPIC E04 — Exponential power and overlapping reward loops

**Outcome:** The player can feel the difference between minute one and minute ten, rather than grinding the same action faster by 2%.

### Stories
- [ ] E04.1 Build a progression ladder of perceptible upgrades. Offer a choice of pulse range, power, cooldown, biomass yield or automation strength. Avoid mandatory tiny percentage upgrades.
- [ ] E04.2 Increase pulse reach through explicit grid footprints; preview exact affected cells. Use integer grid coordinates and clip to eligible tiles. Suggested tiers below use Euclidean radius on an integer square grid, not visual world distance.
- [ ] E04.3 Introduce mini milestones with visible rewards, e.g. 5, 10, 20, 35, 50, 75, 100, 130 restored tiles in the current park. Preserve the fountain goal if it fits; don't replace it with a long empty gap.
- [ ] E04.4 Show the next reachable unlock and a useful upgrade at any point. Allow manual harvest, targeted restoration, placement or Frenzy preparation while automation operates.
- [ ] E04.5 Balance cost growth against production growth using config tables, not arbitrary inflation. Tune for meaningful choice rather than an identical mandatory path.

| Power tier | Example radius | Maximum footprint on unobstructed grid | Illustrative biomass/min |
|---|---:|---:|---:|
| Seed | 0 | 1 | 5 |
| Sprout | 1.5 | 9 | 45 |
| Bloom | 2.9 | 25 | 350 |
| Grove | 4.5 | 69 | 2,400 |
| Radiant | 7.1 | 161 | 18,000 |

Footprints are geometric maxima, not guaranteed eligible tiles; on small maps clip to remaining eligible space. These numbers show intended order-of-magnitude growth, not a promise of exact economy or a requirement to achieve late-game values in 15 minutes. Tune actual production and costs after baseline. Use bounded multipliers, finite numeric checks and abbreviated display for large values.

### Acceptance
- The first five minutes contains multiple distinct power increases; later actions visibly exceed early actions.
- No required milestone depends on waiting for a random reward.
- A player on a fully restored patch can still progress via tile evolution or unlocked areas.

## EPIC E05 — Evolving tiles and ecological synergies

**Outcome:** Restored tiles remain interesting, and the board becomes a living upgrade tree.

### Tile model

| Stage | Appearance | Gameplay |
|---|---|---|
| Barren | Dust, cracked stone, sparse debris | No regular production; restore to activate |
| Restored | Soft grass, tiny shoots | Basic biomass production |
| Blooming | Colourful wildflowers | Higher biomass; pollinator synergy |
| Thriving | Small shrubs / trees, layered vegetation | Higher yield, stronger adjacency |
| Radiant | Distinct luminous flowers, golden accents | Late-game high output and chain opportunity |

### Stories
- [ ] E05.1 Extend the existing tile state model with monotonic evolution; migrate old mossy/green states without undoing restoration. Keep stable tile IDs and separate machine occupancy from underlying tile state.
- [ ] E05.2 Progress via manual enrichment or automatic water/biomass growth. Suggested base requirements: Barren→Restored 1 successful pulse; Restored→Blooming 3 growth units; Blooming→Thriving 8; Thriving→Radiant 20. Initial production weights 0/1/2/4/8; tune to prevent runaway loops. One-time transition reward separate from recurring yield.
- [ ] E05.3 Never require permanent repetitive clicking on each tile. Drones and gardens automate early-stage work. Targeted pulses can accelerate evolution on chosen tiles.
- [ ] E05.4 Add simple adjacency recipes: Solar Flower near pollinator garden = temporary energy burst; condenser near plants = growth support; Mother Tree near thriving gardens = stored charge then restorative pulse. Prefer existing systems if present.
- [ ] E05.5 Display range and synergy previews before building. Use orthogonal adjacency or configured grid radius consistently; cross-area connections remain explicit.
- [ ] E05.6 Track unique restored tiles separately from stage advancement. A tile advancing to Radiant must not count as five restored tiles toward the fountain.

### Acceptance
- Every stage is visually distinguishable and affects output or synergy.
- Restored tiles do not regress or disappear when the player takes a break.
- Existing machine placement and selection remain correct across stages and saves.

## EPIC E06 — BLOOM FRENZY

**Outcome:** A player-earned burst of absurd power creates regular, intentional peaks of excitement.

### Stories
- [ ] E06.1 Add a 0–100 charge meter earned from successful tile transitions (example +2), meaningful chain resolutions (+1 per unique additional activation, capped per chain), and bounded resource overflow from E01. Tune toward one charge every 2–3 minutes of active early play.
- [ ] E06.2 At full charge, show a clear ready state and optional sound. The player chooses when to activate; no expiry while ready, no automatic consumption.
- [ ] E06.3 Activate for 15 seconds of simulation time. Initial fantasy targets: up to 5× pulse radius, 10× biomass production, 3× drone job speed, enhanced chain propagation. Clamp radius/affected tiles and chain events; a 5× radius can yield ~25× area. Start testing with smaller multipliers if necessary.
- [ ] E06.4 Give Frenzy a distinct golden-green visual identity, faster musical layer, special pulse and clear duration. Preserve ability to interact. No mandatory camera cut.
- [ ] E06.5 Prevent recursive self-charging: no Frenzy charge while active; no banked charges; chain effects bounded. Pause freezes timer and simulation. Save/restore remaining duration and charge, never duplicate payouts.
- [ ] E06.6 Define modifier composition centrally. Example: Frenzy biomass ×10 and cat biomass ×2 use the strongest overlapping multiplier (×10), not ×20, unless explicitly designed otherwise. Speed buffs likewise bounded; visual indicators explain active modifiers.

### Acceptance
- First Frenzy can be earned by normal restoration and activated without cat luck.
- End state restores normal multipliers exactly, even after pause/load.
- No infinite chain recursion, duplicated activations, or negative resource balances.
- The player can identify a real before/after increase in restoration power and output.

## EPIC E07 — Hybrid automation and chain amplification

**Outcome:** Automation takes over routine work while manual intervention becomes more powerful.

### Stories
- [ ] E07.1 Make the first drone visibly useful soon after purchase. Prioritise eligible barren tiles, then growth tasks when no barren targets remain. Use deterministic tie-breaking and target reservations so drones don't duplicate work.
- [ ] E07.2 Add impactful upgrades: speed ×2, additional drone, larger work radius, multi-tile restoration. Reuse existing upgrade system and ensure costs are affordable.
- [ ] E07.3 Make machine-to-machine interactions visible. A solar burst powers a condenser, nearby flowers bloom, Mother Tree releases its stored pulse; show flowing particles only during meaningful events or inspection.
- [ ] E07.4 Keep manual actions differentiated: target a dangerous-to-waste (but never destructive) high-value chain opportunity, accelerate a region, choose machine placements, activate Frenzy or seek cats. Do not simply make manual labour mandatory once automation exists.
- [ ] E07.5 Preserve existing relay/bridge links if implemented. Do not build new neighbourhoods in this phase merely to demonstrate bigger chains.

### Chain implementation safeguards
Use an iterative event queue, root chain ID, source/target IDs, visited keys and per-chain budgets (initially 128 logical activations, depth 12; tune to map size). Process long queues over bounded simulation work slices; prevent event duplication and resource creation through circular machine links. Count unique successful activations, not particle events. Aggregate payout once at chain resolution. If a budget is hit, finish consistently and expose a debug diagnostic, not a crash.

### Acceptance
- Two drones never collect the same one-time restoration reward.
- Automation stops gracefully when no work exists and resumes when new work becomes eligible.
- A manual action can trigger a chain larger than passive routine work.
- Cross-area chains remain bounded and only follow valid connections.

## EPIC E08 — Hidden Lucky Cat and delightful discoveries

**Outcome:** Optional surprises that reward curiosity without pressure or dependence on randomness.

### Stories
- [ ] E08.1 Preserve the existing Hidden Lucky Cat feature; add missing spawn, visibility, discovery and reward logic. First cat around minute 3–4, subsequent roughly every 3–5 minutes of active simulation after claim, tuned by playtests. One active hidden cat at a time initially.
- [ ] E08.2 Author grid-aligned hide anchors behind planters, near benches, beside machines and on visible ledges. Every spot must be reachable by camera and tappable at normal zoom. No spawn inside geometry, behind inaccessible UI or in locked areas.
- [ ] E08.3 Cat waits until found, with an optional gentle visual clue after a while. No expiring cat or lost streak. Spawn timer and reward age use active simulation time, not wall-clock absence.
- [ ] E08.4 Reward scales with current sustained production (exclude temporary boosts), with a sensible floor and bounded hidden-time bonus. Example: 30 seconds of biomass output, minimum 15, age bonus up to ×2; overflow use normal conversion, or reserve capacity before payout. Do not award a huge amount that silently disappears into a cap; show credited amount and overflow clearly.
- [ ] E08.5 Use a configurable reward pool: Lucky Harvest 40%, Solar Frenzy 20%, Mega Bloom 20%, Drone Party 15%, jackpot 5%. Example durations: 15–30 seconds for buffs. Mega Bloom restores/evolves eligible cells using the normal transaction path; Drone Party creates temporary extra jobs, not permanent free entities. Golden/Rainbow cat variants signal reward rarity; exact visuals and probabilities tune after testing.
- [ ] E08.6 On discovery: wave, meow, golden particles, brief “Lucky Cat Found!” banner and clear reward. No blocking modal. Claim exactly once even on double tap or save reload.
- [ ] E08.7 Add occasional rare golden flowers, unusual seeds or butterfly visitors as optional small discoveries if core cat feature is polished. Reuse the same discovery pipeline; no additional currency or collection chores required.

### Acceptance
- All cat positions are valid and discoverable on desktop and mobile.
- Missing a cat never causes a penalty; main progression works without cats.
- Reward seed/resolved reward, anchor, age and claim state survive save/load.
- Rapid taps cannot claim multiple rewards; temporary buffs compose with Frenzy safely.

## EPIC E09 — Beauty, machine personality and environment art

**Outcome:** A cute, premium stylised 3D solarpunk diorama, not a flat checkerboard.

### Art direction
Clean rounded hard-surface white/cream technology, soft sage and grass greens, warm timber accents, restrained gold and cyan indicators, pastel flowers. Soft daylight, readable shadows, cheerful rounded forms, playful toy-like proportions. Keep the fixed isometric grid as the interaction language. Avoid photorealism, neon-green uniform carpet and heavy realistic grime.

### Stories
- [ ] E09.1 Create modular terrain variants: cracked stone, dusty earth, moss, grass, flower clusters, shrubs, small trees. Use seeded variation by stable tile ID so plants do not jump when saves load. Connect adjacent restored tile edges visually without merging logical tiles.
- [ ] E09.2 Improve the park silhouette: authored edges, paths, planters, benches, steps, ponds and elevation accents. Preserve current map dimensions and stable tile IDs; don't invalidate saves. Decorative elevation must not break picking or obscure usable tiles. Distinguish blocked/decorative and restorable tiles.
- [ ] E09.3 Replace primitive machine placeholders with reusable modular models: solar panel, water condenser, flower bed, drone hub, drone, Mother Tree, fountain and Lucky Cat. Keep clear silhouettes and one consistent material family. Add tiny moving parts, water bubbles, solar tilt, drone expressions and status lights. Prefer stylised geometry achievable in PlayCanvas; optional GLB imports if assets exist, no dependency on nonexistent art files.
- [ ] E09.4 Introduce flora variation and environmental life: butterflies, leaves, wind sway, occasional birds, gentle fountain flow. Avoid per-object update loops for every grass blade; use shared animation/shader techniques or inexpensive batched updates.
- [ ] E09.5 Improve lighting, contact shadows and colour grading with a mobile-safe quality profile. Prioritise composition and materials over expensive post-processing. Keep grid boundaries visible on hover/build, not as permanent high-contrast lines.
- [ ] E09.6 Add visual tiers to upgrades: larger panel arrays, richer flower beds, upgraded drone shells and more elaborate Mother Tree canopy. Upgrades should affect silhouettes, not only stat numbers.

### Acceptance
- Before/after screenshots at the same camera angle visibly show dramatic environmental transformation.
- Machines are recognisable without tooltips at expected mobile zoom.
- Decorative detail never prevents tapping a valid tile; low quality retains readable state and feedback.
- Visuals are consistent with the previously supplied concept screenshots, scaled to the realistic scope of this browser game.

## EPIC E10 — Landmark payoffs and the first 15 minutes

**Outcome:** A complete, escalating mini-experience that demonstrates the full game fantasy.

### Stories
- [ ] E10.1 Rebuild onboarding as contextual actions, not a long text overlay. First pulse immediately available.
- [ ] E10.2 Place intermediate visible park milestones and reward them once. Use the existing fountain as a major climax; show staged restoration of its surroundings, basin, water flow and surrounding vegetation before final activation.
- [ ] E10.3 Landmark completion triggers a broad restoration spectacle, payout and next-area preview (only if available). If expansion is not implemented, show a finished park celebration and continued evolution, not a fake inaccessible button.
- [ ] E10.4 Verify the following pacing with fresh-save playtests. Unlocks are achievement-based, not mandatory clock gates; faster players can progress faster.

| Time target | Player experience | Evidence of success |
|---|---|---|
| 0–10 sec | First restoration | Green growth pops, sound and reward |
| 10–30 sec | Mini goal and first upgrade | Clear reachable improvement |
| 0:30–2:00 | Solar/water/flowers and bigger pulse | Production visible; footprint grows |
| 2–4 min | First meaningful chain, first drone, first cat opportunity | Routine jobs begin automating |
| 4–6 min | First Frenzy, tile evolution | Dramatic power spike |
| 6–9 min | Multiple drone jobs, bigger chains and thriving gardens | Player chooses where to amplify |
| 9–12 min | Fountain restoration approaches or completes | Large visual payoff and reward |
| 12–15 min | Upgraded ecosystem, another Frenzy or new area | Obvious next meaningful goal |

These targets supersede the slower earlier tutorial plan; they are hypotheses, not guaranteed timings or exact unlock conditions. Do not rely on finding the first cat to complete the timeline.

### Acceptance
- Fresh player understands restoration, upgrades, building and automation without a wall of text.
- Player experiences multiple upgrades, at least one meaningful chain, first drone and earned Frenzy in the first session under normal tuning.
- Fountain objective is reachable without RNG or long resource-cap stalls.
- Milestone celebrations happen once and leave the player with something useful to do.

## EPIC E11 — Performance, accessibility, saves and validation

**Outcome:** A reliable, responsive browser game suitable for repeated mobile play.

### Stories
- [ ] E11.1 Profile actual runtime on a representative mobile device and desktop. Aim for 60 FPS desktop, stable 30 FPS minimum mobile on supported hardware, including large chains. Record actual device/browser and frame metrics; do not claim compatibility without testing.
- [ ] E11.2 Use fixed-step or bounded delta simulation, pooled VFX, shared materials, instancing/batching where supported, capped particle counts, limited dynamic lights and quality settings. Avoid allocating scene entities on each pulse. Cap work per frame and coalesce visual events.
- [ ] E11.3 Preserve versioned saves: grid state, resources/caps, upgrades, machines/jobs, milestones, cat, Frenzy, random seed and relevant modifiers. Define pause/background semantics explicitly; default to no hidden-tab catch-up unless existing offline progress is supported. If supported, bound catch-up and prevent duplicate one-time rewards.
- [ ] E11.4 Test old save migration, fresh save, reload during active chain/Frenzy, cat claim, corrupted save handling and repeated purchase input. Migration must be idempotent and preserve existing progress. Keep backup/fallback before destructive migration.
- [ ] E11.5 Accessibility: reduced motion, separate music/SFX controls, high contrast, non-colour state cues, keyboard shortcuts where existing build supports them; touch and mouse parity. No intense flashing required for reward feedback.
- [ ] E11.6 Run the release playtest protocol below. Fix blockers before content expansion.

### Acceptance
- Build and relevant existing tests pass; new deterministic scenario tests pass.
- No uncaught errors during a 15-minute run, duplicate payouts or impossible mandatory purchases.
- Performance results documented honestly; unresolved limitations reported.
- Old saves tested with actual fixtures where available, not only invented examples.

---

## 4. Technical integration guidelines

Adapt to existing modules. Potential responsibilities (not a request to build a parallel architecture):

```text
Grid / TileState          stable cell IDs, eligibility, occupancy, stage
Economy / BalanceConfig   resource transactions, caps, generation, costs
Progression               upgrade unlocks, milestones, unique restore count
Pulse / ChainResolver     footprints, bounded work queue, successful events
Automation                drone reservations, job scheduling, machine synergy
Frenzy / ModifierSystem   charge, activation, duration, bounded buff stacking
Discovery                 cat spawn anchors, reward roll, claim transaction
Presentation              tile visuals, pooled VFX, sound, camera feedback
HUD / Input               responsive UI, touch gestures, tool selection
Save / Migration          versioned state, atomic progress persistence
Debug / Metrics           local event logs, seed, baseline and replay tools
```

Simulation owns truth. Presentation consumes committed events. A particle finishing, a sound ending or a UI animation must never award resources. Use unique transaction/event IDs for one-time payouts. Avoid coupling gameplay logic to mesh names or DOM elements. Keep existing PlayCanvas lifecycle and imports; verify API usage against installed engine version.

Suggested config groups: `economy`, `upgrades`, `pulseTiers`, `growthStages`, `chains`, `automation`, `frenzy`, `luckyCat`, `milestones`, `presentation`, `quality`. Validate nonnegative costs, finite rates, duration bounds, valid unlock dependencies and reachable capacity. Keep debug overrides separate from production defaults.

## 5. Playtest protocol and release gates

Run fresh-save tests on mobile and desktop; ideally 3–5 new players independently, plus a returning player with an existing save. If human testing is not available, run deterministic scripted scenarios and clearly distinguish them from player feedback.

Record: first interaction, upgrade timestamps, longest period without meaningful feedback, time spent capped, purchase failures, pulse footprint progression, first chain/drone/Frenzy/landmark, cat discovery, frame-time spikes, UI mis-taps, and whether players can explain why a chain occurred. Report median/range only if there are enough observations; do not fabricate data.

Ask after the session: What was your favourite moment? When did progress feel slow? Did you feel more powerful? Did you notice why chains happened? Which upgrade did you want next? Did the interface get in your way? Would you voluntarily play another five minutes?

### Release checklist
- [ ] No progression blockers, including the Drone Hub capacity issue.
- [ ] Responsive mobile HUD with no overlapping panels.
- [ ] Manual restoration feels rewarding and grows substantially in power.
- [ ] Automation handles routine work without making manual inputs pointless.
- [ ] Evolving tiles and bounded chain logic work together.
- [ ] Frenzy can be earned and activated without random events.
- [ ] Hidden Lucky Cat is optional, discoverable and rewarding; no penalties for breaks.
- [ ] Fountain / park transformation is a memorable payoff.
- [ ] Existing saves migrate successfully or limitations are documented.
- [ ] Build, regression tests, performance observations and real playtest results are reported separately.

## 6. Scope lock — not Phase 4

Do not add new districts, prestige, elaborate weather, extensive plant catalogues, additional permanent currencies, complex logistics, multiplayer or monetisation until the existing park proves satisfying. Existing Phase 3 content stays functional. If art resources are limited, prioritise tile transitions, machine silhouettes, HUD, audio and a beautiful fountain before decorative detail.

## 7. Claude kickoff prompt

> Read `SOLARBLOOM_PHASE_4_EPICS.md` and inspect the current Solarbloom PlayCanvas/TypeScript repository. The isometric grid and existing playable game are the foundation; do not rebuild them. The goal is a satisfying incremental restoration game, not a bigger city builder. Start with E00 only: identify implemented versus missing systems, reproduce the potential Drone Hub affordability issue, capture baseline pacing and inspect mobile HUD overlap. Then implement E01 as the first functional fix, preserving saves. Work through one epic at a time in the specified order, with testable stories, configurable values and a playable build after each. Report actual verification and unresolved issues. Prioritise frequent rewards, substantial power increases, useful automation, Bloom Frenzy, evolving tiles, Hidden Lucky Cat, clean mobile UI and beautiful visual/audio feedback. Treat all numeric values as initial tuning hypotheses. Do not add new neighbourhoods until the current park is demonstrably satisfying.

**Final principle:** A bigger game is not necessarily a better game. Every action should feel good, every upgrade should be felt, and every new ability should make the world visibly more alive.
