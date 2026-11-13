# SOLARBLOOM — ROUND 2 DEVELOPMENT PLAN

**Target:** Claude implementing in PlayCanvas (TypeScript), browser-first  
**Status:** Round 1 is playable and fun. This document defines the **next iteration**, not a rewrite.  
**Priority:** Increase satisfaction, depth, and replayability while keeping the isometric grid legible.

---

## 0. Instructions to the implementing agent

1. **Inspect the current project before changing anything.** Identify the existing tile grid, scene/camera, placement controls, resource economy, save format, and any existing restoration, automation, and Lucky Cat features. Do not assume this document's examples match current class names.
2. **Preserve the Round 1 build.** Create a checkpoint/branch and keep existing gameplay functional. Prefer extending current systems over introducing parallel replacements.
3. Implement milestones **sequentially**, with a running playable build after each milestone. No large visual redesign or major refactor unless strictly necessary.
4. The game must remain **grid-first**. All restoration, adjacency bonuses, machine footprints, and chains resolve on discrete isometric tiles. Visual beams and particles are cosmetic representations of deterministic tile events.
5. Keep the **one-more-upgrade** feeling. No compulsory pipe/cable routing, complex production recipes, punishing failures, or idle waiting for long timers.
6. All tuning values below are **initial playtest targets**, not sacred numbers. Put them in editable configuration, not hard-coded across scripts.
7. On completion, report **what changed, how to test it, files changed, known limitations, and next steps**.

---

## 1. Round 2 vision

**Fantasy:** “I restored a tile; now my entire rooftop is coming alive.”

Round 1 proved the basic restoration loop is enjoyable. Round 2 should make the player feel clever for arranging tiles and machines so that their **own ecosystem causes ever-larger cascading rewards**.

### Core pillars

- **Tactile restoration:** Every tile reacts immediately, clearly, and beautifully.
- **Delightful automation:** The game begins hands-on, then builds toward self-running networks. Manual actions remain useful as combo starters.
- **Grid-based synergy:** Smart adjacency creates meaningful builds without management busywork.
- **Readable spectacle:** Dramatic Bloom Chains, with the option to understand exactly why they happened.
- **Surprise:** Hidden Lucky Cat moments and small environmental discoveries.
- **Visible transformation:** Player progression changes the rooftop and skyline, not just HUD numbers.

### What Round 2 is NOT

- Not a full city-building simulation.
- Not a new engine or project rewrite.
- Not a sprawling multi-district campaign.
- Not a redesign into a clicker with only numerical rewards.

---

## 2. The improved minute-to-minute gameplay loop

**Observe → place/upgrade → trigger → watch the chain → collect → expand → repeat.**

1. The player sees a cluster of grey/restorable tiles and an opportunity for synergy.
2. They manually restore an important tile or place a generator/garden.
3. That event feeds energy, water, growth, and adjacency effects into nearby tiles.
4. An animated **Bloom Chain** spreads through connected/adjacent systems.
5. A reward burst pays out biomass and progress toward the next meaningful upgrade.
6. Automated machines continue the cycle while the player chooses the next opportunity.

**Target:** Within any 20–40 seconds of active play, the player should be able to cause a meaningful visible change, buy or approach an upgrade, or trigger a satisfying chain. Avoid forced waiting.

---

## 3. Milestone A — Make the grid irresistibly satisfying (highest priority)

Keep the existing isometric camera, tile shapes, and placement controls where possible.

### A1. Tile-state presentation

Each tile should have a clearly readable state:

- **Dead:** dull, cracked grey concrete / dry soil.
- **Restorable:** subtle outline on hover; affordable actions show a bright preview.
- **Restoring:** short pulse, cracks recede, sprouts emerge.
- **Alive:** clean, vibrant grass/flowers, subtle ambient movement.
- **Boosted:** restrained accent glow on active synergy/production tiles.

Use shaders/material swaps, squash-and-stretch, particles, or short mesh animations depending on the existing project. Avoid expensive geometry churn per tile.

### A2. Input feedback

- Hover: clearly show target tile and action cost.
- Click: instant feedback (<100 ms perceived), even if the full bloom animation takes longer.
- Success: bloom burst, small particles flowing toward the resource HUD, short sound cue.
- Insufficient resources: gentle shake/brief cost hint, not a disruptive modal.
- Restoration completion: adjacent cells briefly highlight when newly affected.

### A3. Chain readability

During a chain, highlight affected tiles in **ordered waves**, display a compact `BLOOM CHAIN ×N` counter, and add resource totals at the end. Limit full-screen flash and UI obstruction; provide a reduced-effects setting.

**Acceptance:** It is immediately clear which tile the player activated, which tiles followed, and what was earned. Interaction remains responsive during a 20+ tile chain.

---

## 4. Milestone B — Build the Bloom Chain engine

This should become Solarbloom's signature system.

### B1. Deterministic event pipeline

Implement an event-driven resolution queue, independent of VFX:

`PlayerAction / MachineTick → TileEvent → SynergyChecks → NewEvents → RewardAggregation → Presentation`

Suggested event types: `RESTORE`, `PRODUCE_ENERGY`, `PRODUCE_WATER`, `GROW`, `POLLINATE`, `CHARGE`, `DISCHARGE`, `REWARD`.

Each event carries source tile, target tile, chain ID, depth, and cause. Queue events in a reproducible order. Visuals consume the event history; they do not decide outcomes.

**Safety:** Cap the number of events and chain depth per chain, prevent the same one-time tile transition from retriggering endlessly, and prevent cycles such as flower → solar → flower from generating infinite rewards. If a chain reaches a cap, aggregate/fast-forward the remainder visibly rather than freezing the game.

### B2. Four synergies for Round 2

| Element | Base job | Synergy / chain trigger |
|---|---|---|
| **Solar Flower** | Generates energy periodically | Nearby bloom gives it a temporary production burst; once per chain per flower |
| **Rain Collector** | Produces water | When reaching its charge threshold, waters adjacent dry garden tiles |
| **Pollinator Garden** | Produces biomass from thriving plants | A newly restored adjacent plant triggers one bonus grow/restore attempt, with a per-chain limit |
| **Mother Tree** | Charges from nearby restoration events | At full charge, releases an area Bloom Pulse; cannot recharge from its own pulse |

Start with **orthogonal adjacency (N/E/S/W)** for basic bonuses. Special upgrades may unlock diagonal or radius-2 effects later. Show ranges as translucent overlays when selected.

### B3. Combo reward philosophy

- Each *new* restored tile grants its normal reward once.
- Chains earn a modest extra bonus for unique triggered tiles, not endlessly repeated events.
- Larger chains earn a visible milestone bonus (e.g., ×5, ×10, ×20) rather than uncontrolled compounding.
- Make bonuses meaningful but not so dominant that passive economy is irrelevant.

**Suggested initial milestones:** 5 linked tile effects → +10% bonus biomass; 10 → +25%; 20 → +50%. Apply the highest achieved milestone per chain (not all stacked). Tune in playtests.

**Acceptance:** A player can deliberately create a ×10+ Bloom Chain through placement. Two repeated identical actions in the same game state produce the same game outcome. No runaway event loop.

---

## 5. Milestone C — Automation that changes how you play

### C1. Restoration Drone

A drone automatically restores eligible tiles in its work radius, spending shared resources. It must **respect the same tile rules as the player**.

- Choose target by a simple deterministic priority: eligible, affordable, in range; prefer tiles that can trigger a synergy.
- Fly/hover to the target, pulse it, then go to the next task.
- Pause gracefully when resources are insufficient; resume when recovered.
- No complicated pathfinding needed: drone travel is cosmetic in this version.
- Clicking the drone highlights work radius and current task.

### C2. Meaningful drone upgrades

1. **Pulse Speed:** lower time between jobs.
2. **Work Radius:** reaches more tiles.
3. **Chain Intelligence:** prioritises tiles next to Pollinator Gardens or charged Mother Trees.
4. **Second Drone:** more parallel work, not just an invisible +100% multiplier.

### C3. Automation should be visible

Keep drones visibly active, with quick trails and restoration pulses. They should never obscure the tiles under them. Distinguish passive production from player-triggered effects through sound/particle intensity.

### C4. Active play remains useful

The player has a manual **Restoration Pulse** that can trigger chains quickly or choose a crucial target. It should be a strategic accelerator, not a task bots make obsolete.

**Acceptance:** After unlocking a drone, the player naturally spends more time designing synergies and less time restoring isolated cells. The player can still meaningfully speed progress through direct action.

---

## 6. Milestone D — Hidden Lucky Cat (signature surprise mechanic)

**Non-negotiable feature:** A small ceramic Maneki-neko appears in plausible hidden spots on the rooftop. Players discover it by observing the world, not by clicking a timer icon.

### D1. Spawn rules

- First appearance scripted within the **first 4–6 minutes** of a new run, once the player understands the grid.
- Later appearances after a random interval in a configurable range (suggested **4–8 minutes of active play**).
- Only one hidden cat at a time.
- Spawn from a curated list of valid visible-world hiding anchors: behind a planter, between solar panels, wall niche, balcony ledge, etc.
- Do not spawn where the camera cannot reasonably reveal it or under UI overlays.
- Missed cats remain discoverable; they must not permanently block further rewards.

### D2. Discovery interaction

- Cat does a tiny idle wave or ear twitch, but no giant arrow or objective marker.
- Mouse/touch click picks the cat via a generous collider without accidentally targeting the underlying grid cell.
- Found: unique **meow**, gold sparkle burst, short satisfying `LUCKY CAT FOUND!` callout, and reward animation.
- The cat vanishes after the interaction; a brief reward summary stays in a dismissible corner panel.

### D3. Reward pool

| Reward | Effect | Initial relative frequency |
|---|---|---:|
| **Lucky Harvest** | Grant ~60–120 seconds of current biomass production (with a minimum for new players) | 40% |
| **Solar Frenzy** | Solar energy production ×3 for 45 seconds | 25% |
| **Mega Bloom** | Trigger an extra area pulse using valid/restorable targets | 20% |
| **Drone Party** | Spawn 2 temporary drones for 45 seconds | 12% |
| **Jackpot!** | Two randomly selected compatible rewards together | 3% |

Reward values should scale to game state with sensible caps. The timer behind the reward may increase the reward slightly while the cat is unfound, but avoid pressure or fear of missing out.

### D4. Fairness

- No real-money systems, loot boxes, or paid boosts.
- No loss for missing a cat.
- Do not trigger new cats while the game is hidden/paused if it would create frustration.
- Save the hidden cat's active state, chosen anchor, and next spawn eligibility to avoid duplicate rewards after reloading.

**Acceptance:** The player can find the cat in the world, receive a clear surprise reward, and see the effect applied to actual gameplay. The event is fun, not mandatory for optimal progress.

---

## 7. Milestone E — Upgrades and the first major transformation

### E1. Upgrade choices

Offer upgrades that are **visually and mechanically obvious**, not fractional stat clutter:

- **Wide Pulse:** manual restoration radius increases.
- **Overcharge:** once every N pulses, a larger burst.
- **Water Bloom:** water collectors can trigger extra growth.
- **Pollinator Reach:** expands the adjacency radius of Pollinator Gardens.
- **Drone Dash:** drone becomes noticeably faster.
- **Mother Tree Resonance:** Mother Tree pulses reach one more tile.

Show a placement/range preview before the purchase if the upgrade affects area. Every major upgrade should produce an obvious feedback moment.

### E2. Visual progress stages

Stage the first building’s transformation based on restored coverage, for example:

- **25%:** moss, small flowers, cleaner tiles.
- **50%:** solar panels unfold, planters bloom, greenery hangs from edges.
- **75%:** architecture brightens, balconies and vines fill in.
- **100%:** activate **Rooftop Core** and play a short, spectacular building-wide restoration wave. Unlock a view of the next rooftop.

Use thresholds linked to restored tiles, but allow the final event to require a deliberate player-triggered activation. Never gate it behind a huge passive wait.

**Acceptance:** Screenshot comparisons between 0%, 50%, and 100% show a dramatic change. The final rooftop event is rewarding and does not stall the game.

---

## 8. A stronger first 15 minutes (Round 2 pacing)

These are **target experience beats**, not unskippable tutorials.

| Time | Desired event | Why it matters |
|---|---|---|
| 0:00–0:30 | Restore a grey tile; beautiful instant bloom and reward | Immediate delight |
| 0:30–1:30 | Restore a small patch and buy first clearly impactful pulse upgrade | First power spike |
| 1:30–3:00 | Place/activate first solar and water machines | Understand passive systems |
| 3:00–5:00 | Place Pollinator Garden; deliberately trigger first ×5+ chain | Discover the game's signature pleasure |
| 4:00–6:00 | First Hidden Lucky Cat appears naturally in scenery | Surprise and curiosity |
| 5:00–8:00 | Unlock first restoration drone | Shift from manual to hybrid |
| 8:00–11:00 | Assemble a useful machine + garden combo, trigger ×10+ chain | Feel clever and powerful |
| 11:00–13:00 | Unlock Mother Tree and release dramatic area pulse | Peak spectacle |
| 13:00–15:00 | Activate rooftop core; reveal adjacent rooftop | Strong next-session hook |

If the current Round 1 progression is faster or slower, adjust prices/timing around **actions and upgrades**, not hard-coded timestamps.

---

## 9. Isometric grid specification

### Keep the current grid

Preserve the current tile size and rooftop layout. If Round 1 already uses an 8×8 grid, keep it. If not, do **not** rebuild merely to match that dimension.

### Rules

- Use integer grid coordinates `(x, y)` as the source of truth.
- Map grid coordinates to PlayCanvas world positions through one central conversion utility.
- Use pointer raycasting for hover/click and support touch input for browser play.
- All placeable machines have explicit tile footprints and occupancy rules.
- For default synergies, check **4-neighbour adjacency**; render radius overlays for exceptions.
- Distinguish collision/occupancy, restorable terrain, decoration, and machine slots.
- Preserve grid-state information separately from mesh/render entities to support deterministic simulation and saves.
- Roof-to-roof expansion should eventually be separate grids sharing an economy; **do not implement multi-rooftop architecture until the single rooftop is fun and stable**.

### Visual legibility

- Tile borders should be subtle when idle, strong on hover or placement.
- Preview colour for placement: green valid, subdued red invalid.
- Keep machines sized so the grid remains visible.
- Chain traces should follow affected tile positions; avoid a screen full of permanent cables.

---

## 10. Technical architecture recommendations (PlayCanvas + TypeScript)

Adapt to the existing codebase. Suggested module responsibilities, not mandatory filenames:

```text
src/
  game/
    GameController.ts        # Session, pause, progression
    GameConfig.ts            # Economy, animation, chain and cat tuning
  grid/
    GridModel.ts             # Tile state, occupancy, neighbours
    GridView.ts              # Meshes, highlighting, tile transitions
    GridInput.ts             # Mouse/touch tile and prop picking
  sim/
    ResourceSystem.ts        # Energy, water, biomass, income and costs
    RestorationSystem.ts     # Validates and executes restoration
    BloomChainSystem.ts      # Deterministic event queue and caps
    SynergySystem.ts         # Adjacency bonuses and special triggers
    AutomationSystem.ts      # Machine ticks and drone task selection
  features/
    LuckyCatSystem.ts        # Spawn anchors, timing, rewards
    UpgradeSystem.ts         # Purchases, unlocks, modifiers
    ProgressionSystem.ts     # Rooftop stages and major events
  view/
    VFXController.ts         # Pooled particles, beams, pulses
    AudioController.ts       # Click, grow, combo and cat cues
    HUDController.ts         # Counters, upgrades, combo, tooltips
  persistence/
    SaveSystem.ts            # Versioned local save/load
```

**Important:** Do not build an elaborate architecture before it is needed. Clear responsibilities and a single event queue are more valuable than excessive abstraction.

### Performance practices

- Prefer batching/instancing repeated tile and decor meshes when supported by the current renderer setup.
- Pool transient particles, indicators, and text popups.
- Simulate chains in data, then animate their already-computed results.
- Cap simultaneous sounds and visual effects.
- Test on desktop browser and a mid-range mobile device; support quality presets/reduced effects.
- Keep 60 FPS as the desktop goal on a typical modern machine, with a practical 30 FPS minimum mobile target. Measure rather than guess.

### Save data

Save at minimum: schema version, grid tile states, placed machines and upgrades, resource totals, production tick state, restoration coverage, drone unlocks/tasks where necessary, Lucky Cat active position/eligibility, and progression flags. Include a migration/fallback path for existing Round 1 saves. Never silently overwrite an incompatible save.

---

## 11. Balance starting values (configurable)

These are **reference values for tuning**, not requirements to overwrite working Round 1 balance.

| Setting | Initial target |
|---|---:|
| Manual pulse cost | 2 energy |
| Base restoration reward | 2 biomass per newly restored tile |
| First meaningful upgrade | Affordable after 5–8 manual restorations |
| Drone cycle | ~4 seconds between restorations |
| First drone unlock | 5–8 minutes into typical play |
| Chain event safety cap | 100 events per chain (initial) |
| Chain milestone thresholds | 5 / 10 / 20 effects |
| First Lucky Cat | 4–6 minutes |
| Subsequent Lucky Cat checks | 4–8 minutes of active play |
| Rooftop core moment | 13–15 minutes |

Balance must ensure a reliable energy recovery route so players cannot soft-lock themselves when resources are empty.

---

## 12. HUD and UX

**Keep the game world dominant.** HUD supports a beautiful diorama, not the other way around.

- Top left: compact energy, water, biomass counters with per-minute rates.
- Near resources: compact chain combo display during active chains, fading after resolution.
- Top right: one current goal and optional progress bar.
- Bottom: small primary toolbar for restore, place, upgrade; desktop hotkeys, touch-friendly targets.
- Selected machine: show range, production rate, synergy partners, and next upgrade.
- Lucky Cat: short celebratory callout, reward panel fades or is dismissible.
- Avoid overlapping large reward windows, tooltips, and chain popups.
- Provide pause, sound controls, and reduced motion/effects options.

---

## 13. Milestone order and definition of done

### M1 — Grid juice (do first)

Implement tile hover, restore transitions, punchy feedback, resource collection visuals, readable chain indicator.  
**Done when:** Every manual restoration is satisfying and grid state is obvious.

### M2 — Chain engine + synergies

Add deterministic event queue and the four synergy elements.  
**Done when:** Player can intentionally build and reproduce a ×10+ chain; no infinite loops.

### M3 — Hybrid automation

Add working drone, visible jobs, upgrades, pause/resume.  
**Done when:** Drone use changes player decision-making; manual pulse remains relevant.

### M4 — Hidden Lucky Cat

World-space cat spawning, discovery, five rewards, save safety.  
**Done when:** A surprise discovery changes the actual simulation and feels delightful.

### M5 — Visual transformation + polish

Progress-stage changes, Rooftop Core event, next-rooftop reveal, audio/VFX pass.  
**Done when:** A 15-minute playthrough tells a visible before-and-after story.

### M6 — Playtest and balance

Tune bottlenecks, reduce spam, profile performance, test touch controls and saves.  
**Done when:** A player can complete the first rooftop without confusion, long waits, soft-locks, or performance problems.

**Stretch after M6 only:** Alternative rooftop layouts, more synergies, cosmetic Lucky Cat variants, district expansion, weather, night/day power management, additional machines.

---

## 14. Test cases / acceptance checklist

- [ ] Existing Round 1 build still works after updating.
- [ ] Restoring a tile spends the correct resources once and produces the correct reward once.
- [ ] Clicking a restored tile cannot farm duplicate rewards.
- [ ] Hover and placement work on mouse and touch.
- [ ] Synergy triggers depend on grid adjacency, not screen proximity.
- [ ] A chain's event queue terminates safely, including cyclic machine arrangements.
- [ ] A ×10+ chain is achievable within the first session.
- [ ] Chain rewards and visuals correspond to the same events.
- [ ] Drone respects occupancy, resources, range, and already-restored tiles.
- [ ] Manual restoration remains useful after drone unlock.
- [ ] Hidden Lucky Cat spawns in a discoverable location and can be clicked independently of the grid.
- [ ] All Lucky Cat rewards have correct in-game effects and expire correctly.
- [ ] Reloading cannot duplicate a Lucky Cat reward.
- [ ] Saving/restoring preserves progression and as much of the current Run 1 save format as feasible.
- [ ] Players never run out of ways to regenerate energy.
- [ ] Rooftop visuals clearly evolve as restoration progresses.
- [ ] FPS stays responsive during a large chain and multiple active drones.

---

## 15. Playtesting questions for this round

Ask testers after a 15–20 minute run:

1. What was the most satisfying moment?
2. When did you first understand the purpose of arranging plants and machines together?
3. Did the drone feel like a meaningful upgrade or just a passive timer?
4. Could you tell why a Bloom Chain happened?
5. Did you notice the Lucky Cat without being instructed to search for one?
6. What made you want to continue playing? What made you consider stopping?

**Track:** time to first upgrade, first ×5 and ×10 chain, drone unlock, first cat find, Rooftop Core activation, time spent unable to act, and average chain size.

---

## 16. Copy-paste kickoff prompt for Claude

> You are continuing an existing **Solarbloom** prototype in **PlayCanvas + TypeScript**. Round 1 is already fun; do not rebuild it from scratch. Read `SOLARBLOOM_ROUND_2_PLAN.md` and inspect the current project first. Preserve the existing isometric grid, camera, controls, and gameplay. Begin with **M1: Grid juice**, then implement milestones in order, ensuring the project runs after each milestone. Prioritise feel, readable tile-based Bloom Chains, meaningful automation, and the world-space Hidden Lucky Cat. Keep the architecture pragmatic, all tuning data configurable, and test against the acceptance checklist. At the end of each milestone, summarise changes, files touched, tests performed, and any unfinished work. Do not expand scope into city-building systems or multi-rooftop campaign content yet.

---

## Key principle

> **The best upgrade isn't a number becoming bigger. It's the player causing a more beautiful, larger, more exciting chain reaction than they could five minutes earlier.**
