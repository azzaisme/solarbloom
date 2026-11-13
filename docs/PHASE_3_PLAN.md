# SOLARBLOOM — PHASE 3: THE LIVING NEIGHBOURHOOD

**Implementation handover for Claude · PlayCanvas + TypeScript · Browser-first · Version 1.0**

> **Premise:** The first rooftop is fun. Round 2 made it juicy and automated. Phase 3 turns that small, satisfying toy into a **connected neighbourhood** with new strategic choices, new sights, and much bigger Bloom Chains — without losing the simplicity of clicking an isometric grid tile and watching the world heal.

## 0. Instructions for Claude (read first)

1. **Continue the existing codebase. Do not rebuild the game.** Inspect the current project, scripts, scene hierarchy, grid/tile model, save format, economy, chain engine, camera, and HUD before changing anything.
2. Compare the implementation against `SOLARBLOOM_PLAYCANVAS_GAME_PLAN.md` and `SOLARBLOOM_ROUND_2_PLAN.md`. **The code is the source of truth for what actually exists.** Do not assume every previous milestone was completed.
3. Preserve working game feel, interaction responsiveness, the isometric grid, existing save data, and Hidden Lucky Cat behaviour. Use migrations where saves change.
4. Implement milestones in order. Keep the game playable at the end of each milestone, and provide a short changelog and verification notes.
5. Make new values **configuration-driven**, not scattered magic numbers. Suggested values below are starting points for playtesting, not requirements to hardcode.
6. Aim for a browser-based desktop experience first, with mouse and touch usability; avoid unnecessary dependencies or backend requirements.
7. Keep the scope **incremental/automation restoration**, not a complex city builder. No manually routing wires or pipes, citizens' needs, failure spirals, or punishing logistics.

---

## 1. Phase 3 vision

### The player fantasy

- **Minute 1:** “I can make this little rooftop beautiful.”
- **Minute 10:** “My drones and plants are helping me do it faster.”
- **Minute 20–30:** “I can extend my ecosystem onto another rooftop.”
- **Beyond:** “One well-placed trigger can make the whole neighbourhood burst into life.”

### Definition of success

Phase 3 is successful if a returning player can expand from one rooftop to **three distinct connected rooftops**; understand what links them; discover at least two viable build strategies; trigger a visible cross-rooftop Bloom Chain; and feel compelled to unlock the next rooftop. They should still enjoy directly clicking the grid, rather than managing menus.

### Design pillars

1. **The grid is the game.** Every important ecological interaction maps to a tile or an explicit structure anchor.
2. **Expansion is a visual reward.** Unlocking a rooftop reveals a new living canvas, not a spreadsheet.
3. **Automate the routine, amplify the player.** Drones handle small jobs; manual pulses initiate bigger events.
4. **Decisions are legible.** Placement, adjacency and rooftop-specialist bonuses should be understandable through visual feedback.
5. **Surprises delight.** Hidden Lucky Cat stays rare, optional, fair, and genuinely exciting.

### Explicitly out of scope

No citizens, housing demand, hunger/happiness, worker assignments, factory production trees, complex inventories, free-form terrain sculpting, multiplayer, monetisation, prestige resets, or elaborate weather survival. No separate second-level construction editor. Avoid adding a fourth permanent currency.

---

## 2. The neighbourhood: three rooftops

Create a **small authored map**, not an infinite procedural city. Existing rooftop remains unchanged as much as practical.

| Rooftop | Identity | New mechanic | Visual climax |
|---|---|---|---|
| **01 — The Seed** | Existing starter roof | Core restoration, first drones and chains | Rooftop Core blooms |
| **02 — The Reservoir** | Dry roof with old cistern and terraces | Water overflow and irrigation synergy | Dry basin becomes a cascading garden |
| **03 — The Canopy** | Overgrown but dormant roof | Pollination spread / Mother Tree charging | Huge tree canopy and a bridge of flowers |

**Recommended initial dimensions:** Seed retains current grid size (do not resize saves); Reservoir ~8×8; Canopy ~10×8. Sizes are illustrative. Distinct silhouettes and a small amount of variation in height are more important than sheer area.

### Layout rules

- Each rooftop owns its **own local integer grid coordinates** `(x, y)` and one `roofId`; use a local-to-world transform for rendering, picking and camera framing.
- Every tile has stable identity: `tileKey = roofId + ':' + x + ':' + y`.
- Connections between rooftops are **explicit bridge/relay edges**, not accidental world-space proximity.
- Interaction uses the same tile hover/selection/placement controls on every roof.
- Preserve crisp isometric composition. Do not rotate individual tile meshes in inconsistent ways; world layout is 3D but logical gameplay stays grid-aligned.
- New roofs begin partially dead, so their visual evolution is dramatic.

### Unlock flow

1. Restore the Seed rooftop's Core (existing milestone).
2. Earn enough biomass and energy to **activate the Skybridge Relay**.
3. The camera pans to reveal the Reservoir. Its tiles become interactable; existing machines remain running.
4. Complete a visible water-restoration milestone on the Reservoir to open the Canopy.
5. Build the final bridge/relay and trigger the **Neighbourhood Bloom** event.

Use resource costs and a clear milestone; **do not put unlocks behind a real-time waiting timer**. The first expansion should be achievable in a continuing playthrough roughly 5–10 minutes after the first core restoration, subject to playtesting.

---

## 3. Cross-rooftop network: power without cable spaghetti

### Design

A bridge is a **visual link and unlock**; a relay is a **mechanical connection**. No player-drawn wires or pipes.

- Building a bridge establishes traversal of resources across two roofs (shared resource pool by default).
- Activating a relay allows specified chain events to propagate between connected rooftop networks.
- Relay has an **upgradeable trigger limit / cooldown**, not a physical routing puzzle.
- Draw a tasteful animated green arc along the bridge only **when a chain actually crosses it**.
- Selecting a relay highlights connected rooftops and shows simple text: `Connected: 2 roofs`, `Next cross-roof pulse: ready`.

### Key restrictions

- Do not automatically make every tile adjacent across rooftops. Within-roof adjacency remains four-neighbour orthogonal on the logical grid unless existing rules explicitly differ.
- Cross-roof propagation occurs only through relay events at explicit link endpoints.
- A single originating chain must not loop back and retrigger itself infinitely via multiple relays. Existing Round 2 event IDs, visited tracking and maximum work budget should carry over.
- If a relay is inactive, its link produces no chain propagation but existing local automation still works.

### Suggested cross-roof chain event

`TileRestored → PlantBlooms → MotherTreeCharge → RelayPulse → RemoteRoofGardenBloom → BiomassReward`

Render the transfer distinctly: pulse gathers at relay, travels over skybridge, then flowers bloom on the target roof in a short readable cascade.

---

## 4. One meaningful specialty per roof

### Reservoir: water overflow

- Water Collectors produce water into the **existing shared Water resource**, no new currency.
- Place a Reservoir Garden in range of a water collector for an **Overflow** synergy.
- When triggered, Overflow irrigates up to N nearby dry tiles and gives a temporary biomass bonus to newly restored plants.
- Overflow is a **burst event**, not a permanent spam effect. Show a blue pulse, tiny water spray and immediate greening.
- Players should clearly understand the relationship by selecting either structure and seeing the affected tiles highlighted.

### Canopy: living propagation

- The Mother Tree builds charge from nearby successful blooms.
- At its charge threshold, it releases a **Canopy Burst** that restores or accelerates plants within a configurable radius.
- Pollinator Gardens can amplify the Burst or extend its chain by one eligible target.
- Display a visible charge ring around the Mother Tree, not just a progress bar in a menu.

### Build diversity

Two intended play styles should be viable:

- **Solar + drone:** reliable passive throughput, fast tile clearing, frequent small chains.
- **Water + pollinator:** slower buildup, more explosive bursts, larger high-score chains.

Avoid a single mandatory optimal layout. The goal is “I discovered a cool combo,” not “I solved an opaque production spreadsheet.”

---

## 5. Core loop for Phase 3

1. **Restore:** manually pulse a chosen tile or cluster.
2. **Observe:** machines and plants respond through visible, audible chains.
3. **Collect:** energy, water and biomass come in; show a subtle resource gain animation.
4. **Choose:** upgrade an existing mechanism, place a synergy piece, or invest in expansion.
5. **Automate:** drones and nature do repeated work while player seeks the next big combo.
6. **Expand:** unlock a new rooftop with a fresh local mechanic and visual payoff.
7. **Celebrate:** cross-roof chains and neighbourhood milestones create memorable spectacle.

### Keep active play valuable

Add or refine **Overcharge Pulse**: manual restoration on a tile adjacent to an active machine briefly boosts its next trigger (e.g., +1 eligible target or +25% local output). Automation still runs independently. Overcharge should be intuitive and immediately visible; no extra currency. If existing active-play mechanics already achieve this, improve those instead of creating redundant buttons.

---

## 6. Progression and upgrades

Prefer **spatial/visual upgrades** over generic multipliers.

| Unlock | Effect | What players see |
|---|---|---|
| Relay I | First cross-roof chain link | Skybridge lights up on transfer |
| Wide Pulse | Manual restoration radius +1 | Bigger visible tile wave |
| Drone Dispatch | Drone can switch to another connected roof when idle | Drone flies across bridge |
| Reservoir Overflow | Water burst restores adjacent eligible tiles | Water flows into dry planters |
| Mother Tree | Stores blooms to trigger Canopy Burst | Tree glows and blooms outward |
| Relay II | Additional remote chain target | Pulse splits toward two gardens |
| Neighbourhood Core | One-time grand restoration event | Large coordinated city-wide bloom |

### Upgrade UX

- Unlock notifications: short and satisfying, never block movement for long.
- All machine tooltips should show **what**, **why**, **current range**, and **next upgrade** in plain language.
- Hover or long-press previews affected tiles before placement.
- Never hide a required upgrade behind unrelated unlock trees.
- At least one useful purchase or goal should be visible at most times.

---

## 7. Hidden Lucky Cat — Phase 3 evolution

**Keep existing Round 2 Lucky Cat mechanics. Do not rewrite the base system.** Extend it to a multi-roof environment.

### New hiding behaviour

- Cat may spawn on **any unlocked, visible or inspectable rooftop** in a small eligible hiding spot (e.g., behind planter, beside condenser, balcony nook).
- Choose from authored candidate positions with a known clear line of sight at a reasonable camera zoom; never spawn under non-interactable geometry or off-camera permanently.
- At most **one active Lucky Cat** per player session unless a specific event explicitly allows another.
- Save the cat's roof, spot ID, spawn time/state, reward seed or resolved reward, and claim state.
- It should **never block a tile placement**, restoration, camera or any core objective.

### Phase 3 rewards

Retain the existing Round 2 reward pool; add two neighbourhood-level possibilities:

1. **Golden Relay:** next cross-roof chain sends one extra remote bloom pulse.
2. **Cat's Garden:** instantly decorates and restores a small eligible cluster on a random unlocked roof.

If no second roof exists, these either remain unavailable or degrade gracefully to a local equivalent. Never give a useless reward.

### Discovery feedback

A cat discovery should be a *moment*, not a modal interruption: a small golden sparkle, one distinct meow, a reward card that fades without stopping the game, and an obvious effect in the world. Offer accessibility setting to reduce sparkle intensity.

### Fairness

No mandatory cat hunting, no punitive expiry, no premium gating, and no massive irreversible balance advantage from lucky random spawns. Apply caps to time-based scaling. A bonus should feel fantastic without invalidating strategic play.

---

## 8. The Neighbourhood Bloom: Phase 3 climax

When all three Rooftop Cores are restored and the relays are connected, a prominent **Activate Neighbourhood Bloom** action becomes available.

**Sequence (target 8–12 seconds, skippable or speed-adjustable):**

1. Energy accumulates at each rooftop's core.
2. Each relay lights, showing an understandable path across the bridges.
3. Green waves propagate across the three rooftops, visibly cleaning remaining predefined decorative patches.
4. Dead facades become clean white; vines, flowers and trees unfold. Water begins moving through restored channels.
5. Final bright but controlled bloom, resources shower in, and the camera frames the whole neighbourhood.
6. A new **distant district silhouette** or locked next section appears, giving players a future goal.

**Do not** destroy/reset rooftop layouts. The climax enhances the player-built world and must remain visible afterward.

The event should be replayable visually from a menu in a **non-rewarding** mode, or otherwise easy to revisit without duplicating rewards.

---

## 9. Camera, interaction and presentation

### Isometric camera

- Retain the existing orthographic or near-orthographic isometric camera if it works well.
- Smooth pan/zoom to new rooftop, controlled zoom bounds, optional `Focus Active Roof` hotkey/button.
- When multiple roofs are shown, UI stays readable and tile hover stays accurate.
- Camera never forcibly snaps away while the player is actively placing an object.
- After an unlock reveal, return camera control immediately.

### Grid UX

- Highlight hovered tiles, legal placement tiles and synergy range cleanly.
- Dim unrelated roofs while placing a range-dependent building if visual noise is high.
- Represent occupied cells consistently (including multi-cell machine footprints if they exist).
- A restoration targeting tool must not accidentally select the bridge or a hidden cat.
- When zoomed out, replace per-tile clutter with simpler building indicators and aggregate chain effects.

### Visual direction

Preserve the previous screenshots' **clean white hard-surface solarpunk**, joyful green grass, bright flowers, rounded machinery, and cute floating drones. The look should be **stylized isometric game art**, not gritty sci-fi or generic flat tile icons. More advanced rooftops can be lusher, but the active selection and grid remain clear.

### Audio and motion

- Each click has an immediate sound and animation.
- Progressively larger chains should evolve in pitch/texture and particle count, not merely volume.
- Drones use subtle cheerful activity audio; avoid constant overlapping beeps.
- Reduce-motion and reduced-VFX options for accessibility.

---

## 10. PlayCanvas + TypeScript implementation approach

**Adapt to the real repository.** Suggested boundaries rather than mandatory filenames:

```text
src/
  game/
    GameState.ts
    EconomySystem.ts
    SaveSystem.ts
    Config.ts
  world/
    RooftopDefinition.ts
    RooftopInstance.ts
    GridTile.ts
    TilePicker.ts
    RooftopManager.ts
    BridgeRelaySystem.ts
  mechanics/
    RestorationSystem.ts
    BloomChainSystem.ts
    AutomationSystem.ts
    RooftopSpecialtySystem.ts
    LuckyCatSystem.ts
    ProgressionSystem.ts
  presentation/
    IsometricCameraController.ts
    GridFeedback.ts
    ChainVFX.ts
    HUDController.ts
    NeighbourhoodBloomSequence.ts
```

### Suggested data contracts

```ts
type RoofId = string;
type TileKey = `${string}:${number}:${number}`;

interface RooftopDefinition {
  id: RoofId;
  width: number;
  height: number;
  worldOffset: { x: number; y: number; z: number };
  authoredTiles: TileDefinition[];
  machineAnchors: MachineAnchor[];
  catHidingSpotIds: string[];
  unlockId: string;
  specialty: 'starter' | 'reservoir' | 'canopy';
}

interface RoofLink {
  id: string;
  fromRoofId: RoofId;
  toRoofId: RoofId;
  fromRelayTile: TileKey;
  toRelayTile: TileKey;
  unlocked: boolean;
  enabled: boolean;
  relayLevel: number;
}

interface ChainContext {
  chainId: string;
  originRoofId: RoofId;
  visitedEventKeys: Set<string>;
  eventBudgetRemaining: number;
  depth: number;
}
```

The contracts can vary based on existing architecture. **Do not duplicate the current chain engine or economy system.** Extend them so roof identifiers and links are first-class inputs.

### Simulation boundaries

- Simulation state is independent of PlayCanvas mesh entities.
- Use one authoritative grid state and render entities as projections of that state.
- Use a deterministic, bounded event queue for Bloom Chains, including cross-roof links.
- Keep resource production delta-time safe and preferably tick-based where current architecture supports it.
- Avoid searching all tiles or rebuilding all meshes every frame; track dirty cells / event-driven updates.
- Pool VFX, limit simultaneous sound and particles, batch/instance repeated tile meshes where appropriate.
- Keep a conservative particle cap for mobile and a graphics quality setting.

### Save migration

- Add a save version.
- Convert old single-roof tile IDs to stable Seed rooftop IDs during migration.
- Persist per-rooftop tiles, structures, unlocks, relay state, cumulative resources, automation settings, Lucky Cat state and one-time milestone claims.
- Test loading at least one valid Round 2 save and a fresh save.
- Never award an unlock or cat reward twice on save/load.

---

## 11. Starting balance targets (tune in data)

| Variable | Initial suggestion | Notes |
|---|---:|---|
| First bridge cost | 120 biomass + 60 energy | Adjust to actual Round 2 economy |
| Second bridge cost | 300 biomass + 140 energy | Clear objective, not idle wall |
| Relay transfer cooldown | 8 seconds | Prevent visual spam |
| Relay I remote targets | 1 | Simple to understand |
| Relay II remote targets | 2 | Noticeable upgrade |
| Reservoir overflow target count | 3 | Eligible dry cells only |
| Mother Tree charge threshold | 12 blooms | Should trigger within a short active session |
| Canopy Burst radius | 2 tiles | Show preview radius |
| Neighbourhood Bloom duration | 8–12 seconds | Skippable presentation |
| Maximum concurrent cats | 1 | Across all roofs |

**Important:** The previous build may use very different resource rates; tune costs against observed time-to-unlock rather than copying these numbers blindly. Keep economy self-recovering: energy generation cannot reach an irreversible zero-production state.

---

## 12. Milestones: implement in this order

### P3-M1 — Multi-roof grid foundation

- Add multiple authored roof definitions and stable roof-scoped tile IDs.
- Add camera pan/focus and tile picking across roofs.
- Render the Seed and locked Reservoir; preserve the original scene and gameplay.
- **Done when:** old save loads, interaction works correctly on Seed, camera can preview second roof, no mismatched tile selection.

### P3-M2 — First expansion + bridge

- Introduce Seed → Reservoir bridge unlock and objective.
- Allow restoration, placement, drones and resource flow on the second roof.
- Give Reservoir its distinctive visual state and first transformation.
- **Done when:** player can unlock and actively restore the second roof without resetting progress.

### P3-M3 — Cross-roof Bloom Chains

- Add relay endpoints and bounded cross-roof chain propagation.
- Show a readable bridge-crossing pulse and chain totals.
- Add relay highlight/tooltip and one meaningful upgrade.
- **Done when:** chain effects cross once per eligible event without loops, duplicate rewards or lag.

### P3-M4 — Specialty synergies + Canopy

- Add Reservoir Overflow.
- Add Canopy unlock and Mother Tree charge/burst behaviour.
- Validate two different viable build styles.
- **Done when:** both specialties feel distinct and their effects are visibly explained through the grid.

### P3-M5 — Lucky Cat expansion + surprises

- Make hidden cats eligible on any unlocked roof and add two new rewards.
- Preserve spawn fairness and save consistency.
- **Done when:** one cat across the neighbourhood spawns in valid locations and rewards never duplicate.

### P3-M6 — Neighbourhood Bloom + polish

- Add the three-roof climax event, camera shot, skyline reveal, and celebratory VFX/SFX.
- Refine zoomed-out readability, HUD, controls and quality settings.
- **Done when:** a player can complete the current neighbourhood and enjoy the visual payoff without stutters or confusion.

### P3-M7 — Balance, QA and instrumentation

- Review time-to-expansion, economy stalls, chain length, player attention, Lucky Cat discovery and technical performance.
- Fix regressions and remove unnecessary UI clutter.
- **Done when:** a new player can finish the intended experience and returning Round 2 saves remain functional.

---

## 13. Acceptance checklist

- [ ] Current PlayCanvas project runs before and after Phase 3 changes.
- [ ] At least one actual Round 2 save loads and migrates correctly.
- [ ] All three rooftops have distinct, clearly readable isometric grids.
- [ ] Selection and placement work with camera zoom/pan on every rooftop.
- [ ] Bridge unlocks are milestone-driven, never locked behind arbitrary waiting.
- [ ] Resources and automation continue to work on all unlocked roofs.
- [ ] Drones do not target locked roofs, blocked tiles, already-completed tiles or invalid cells.
- [ ] Cross-roof chains use explicit relays, not accidental world-coordinate adjacency.
- [ ] Cyclic relay arrangements cannot cause infinite events, resource duplication or endless audio.
- [ ] A cross-roof chain is visible and a player can tell where it travelled.
- [ ] Reservoir Overflow restores only eligible tiles and charges correct costs/rewards once.
- [ ] Mother Tree visually communicates charging and its burst has obvious effects.
- [ ] Active play stays valuable after automation has scaled.
- [ ] Hidden Lucky Cat can appear on unlocked roofs in discoverable spots only.
- [ ] Finding / reloading a cat cannot double-award its reward.
- [ ] Neighbourhood Bloom fires once for rewards and doesn't overwrite player builds.
- [ ] Camera sequences never steal control indefinitely; animations can be skipped.
- [ ] Reduced-VFX setting maintains essential gameplay readability.
- [ ] Gameplay remains responsive in browser during a large three-roof chain.
- [ ] No deadlocked energy or progression state in a normal playthrough.

---

## 14. Playtest targets and questions

**Experience targets:** first expansion feels earnable shortly after the existing core milestone; first successful cross-roof chain occurs soon after relay activation; both later roofs have at least one memorable unique interaction; grand neighbourhood restoration feels like a culmination, not a canned cutscene.

Ask five testers:

1. Could you tell what changed when you built the first bridge?
2. Did the relay make sense without an explanation?
3. Did you feel clever placing machines and plants on the grid?
4. Was each new rooftop meaningfully different, or just more tiles?
5. When did you feel most powerful? When did you feel bored or stuck?
6. Did automation make you want to do something bigger, or make you stop interacting?
7. Did the Lucky Cat surprise feel delightful or distracting?

**Optional local telemetry (no backend required):** record elapsed playtime to first bridge, first remote chain, Canopy unlock and grand Bloom; active click count; machine placements; biggest chain; cat find count; time spent with insufficient resources. Keep privacy-friendly and local unless there is an explicit later analytics requirement.

---

## 15. Suggested implementation notes / pitfalls

- **Do not build a new engine around this.** PlayCanvas + existing TypeScript architecture is sufficient.
- **Do not expand world size too fast.** Three strong roof experiences beat ten repetitive ones.
- **Do not produce overwhelming VFX.** At high chain counts, coalesce repeated events into grouped effects and totals.
- **Do not bury fun in menus.** Every new upgrade should have a visible spatial consequence.
- **Do not let the cat become a chore.** The hidden reward is a bonus, not an obligation.
- **Do not make the late game purely idle.** Provide a high-impact active interaction at each expansion scale.
- **Do not break earlier content.** Verify Seed roof, Round 2 chain combos, drones and cat after every milestone.

---

## 16. Copy-paste kickoff prompt for Claude

> You are continuing **Solarbloom**, an existing browser-based PlayCanvas + TypeScript isometric solarpunk incremental game. Round 1 was fun, and Round 2 deepened grid feel, Bloom Chains, automation and Hidden Lucky Cat. Read `SOLARBLOOM_PHASE_3_PLAN.md`, inspect the actual codebase, and start by reporting what is implemented versus assumed. Do **not** rewrite the working game. Implement **P3-M1 first**, preserve saves and existing grid interactions, then work milestone by milestone, keeping a playable build after each. The Phase 3 goal is three interconnected rooftops, distinct rooftop mechanics, readable cross-roof chain reactions, a multi-roof Lucky Cat, and a spectacular Neighbourhood Bloom payoff. Prioritise responsive isometric tile interactions, meaningful automation and clear spatial synergies over city-builder complexity. Use configurable balance, bounded deterministic events, tests for save migration and duplication, and concise completion notes for each milestone.

---

## North-star rule

**A good Phase 3 upgrade makes the player say: “Wait — I can make the *other rooftop* bloom from here?”**

That is the moment Solarbloom becomes more than a charming rooftop restoration prototype.
