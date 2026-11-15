# SOLARBLOOM — E18: DRONE ROLES

**Design doc and epic | Existing PlayCanvas + TypeScript project | Follows Phase 5 (`docs/PHASE_5_EPICS.md`)**

> One Drone Hub, many jobs. Pick what each hub's drones are good at and watch your park run itself in a way you designed.

## 0. Instructions for Claude

Read `PROGRESS.md`, `docs/PHASE_5_EPICS.md` and `src/gameplay/DroneSystem.ts` first. This is a continuation, not a rewrite. Keep everything drones do today working as it does now: reservations, networks and Drone Mesh, far drones run by the clock, the 25% reserve, "save up" protection, area switches, Drone Party, offline drone work and the old drone.

Before coding, record a baseline with the existing bots: hands-off as a share of active (last measured 30–36%, target 40–60%), drone jobs per minute, how long the city bot takes to clear areas, and how often drones wait on energy (`waitingEnergy`). All numbers below are starting guesses to tune, not specs. Keep them in `TUNING.drone.roles`. Don't claim human playtests without running them.

## 1. Why

Today every drone does one job: restore the nearest eligible tile, or nurture a green one, paying the pulse cost. All five hub upgrades (Dash, Radius, Squad, Sweep, Chain Intelligence) make that same job faster or wider. That gives the player nothing to decide about drones beyond "buy more".

The audits keep pointing at the same gaps:

- **Hands-off play is below target** (30–36% of active, target 40–60%). More radius and speed have been tried. The drone reserve that protects taps keeps holding them back.
- **Energy is contested.** Taps and drones always find something to spend energy on (nurturing up to Radiant), so drones sit in `waitingEnergy` and the reserve has to stay.
- **Machines sit apart.** The Mother Tree, solar panels and relays only work together when the player sets them up by hand.

Drone roles answer this with a choice the player makes once per hub, and each role works with a system the game already has.

## 2. Design

### 2.1 Roles, not new buildings

A Drone Hub gets a **role** that every drone it launches follows. The player picks it from the hub's inspect panel. There are no new machines, no new currency and no new hotkeys.

| Role | Icon | Job | Runs on (see 2.3) | Never does |
|---|---|---|---|---|
| **Restorer** (default) | 🛸 | What drones do today: restore, then nurture | Normal pulse cost (⚡ + 💧) | — |
| **Gardener** | 🌱 | Waters restored tiles so they grow a stage, plus neighbours | 💧 only | Restore new tiles |
| **Scout** | 🔭 | Restores fog-edge tiles only, from farther away | ⚡, more the farther it flies | Nurture |
| **Courier** | 📦 | Takes charge to machines | What the machine runs on | Touch tiles |
| **Spark** (P1) | ✨ | Starts a small Bloom Chain in a ready garden cluster | ⚡ | Restore or nurture |
| **Harvester** (P1) | 🧺 | Turns its hub's lost income into biomass | A cut of what it collects | Touch tiles or machines |
| **Seeder** (P2) | 🌾 | Prepares barren tiles so later pulses cost less | 🌿 (seed) | Restore |

The old drone stays a Restorer. It has no role choice and no upgrades, as today.

### 2.2 Role rules

- **Saved per hub** as `MachineData.role` (missing = `restorer`). Old saves load unchanged, so no version bump is needed.
- **A hub is refitted for a role once, then switches freely.** The first time a hub takes a role it pays that role's refit price (2.3). The hub remembers its refits (`MachineData.roles`), so switching back to a role it already has is free and instant. Restorer is always owned. Each drone finishes the job it has already paid for, then follows the new role. Nothing is refunded or charged twice.
- **Unlocks come from progress; refits are the purchase.** A role becomes available when the system it serves exists. Locked roles show why (`lockedReason`), like upgrades do.

| Role | Unlocks when |
|---|---|
| Gardener | First Drone Hub built, 10 tiles at full bloom and a Water Condenser built (it runs on water) |
| Scout | A city area next to the park is in Frontier fog |
| Courier | A Mother Tree or a Bloom Relay is built |
| Spark | 3 Pollinator Gardens are built |
| Harvester | 60 s of income lost to full stores (from `sim.log.overflow`) |
| Seeder | 5 areas cleared |

- **Networks.** A role's drones roam the hub's whole network like today. Hubs with different roles in one network share reach but each drone keeps its own role's job search. Reservations stay unique across all roles.
- **Area switches still win.** "Leave this area alone" stops every role there. "Keep blooming" pulls Gardeners first. "Focus the frontier" pulls Scouts and Restorers first.
- **Frenzy and Drone Party.** Frenzy's drone ×3 applies to every role. Drone Party's temporary drones copy their hub's role.
- **The reserve and "save up" protection** apply to every role that pays.

### 2.3 Prices follow the job

A role costs what it uses. A drone that waters plants pays in water, one that flies far pays in energy, one that plants seeds pays in biomass. Both the one-time refit and the cost per trip follow this rule, so the price also tells the player what the role does and which machines feed it.

**Refit (one-time, per hub).** All refit prices fit inside the starting stores and stay under the existing 60% rule (`machineCostMaxShare`: at most 36 ⚡ and 24 💧 at the start). The biomass part grows ×1.5 for each other hub already refitted to that role. The energy and water parts don't grow, as with the capped machine prices from E12.

| Role | Refit price | Why this price |
|---|---|---|
| Restorer | Free | The default |
| Gardener | 60 🌿 + 20 💧 | Water tanks for watering |
| Scout | 60 🌿 + 30 ⚡ | Bigger batteries for long flights |
| Courier | 80 🌿 + 15 ⚡ + 15 💧 | Carries both kinds of charge |
| Spark | 120 🌿 + 30 ⚡ | A spark is stored energy |
| Harvester | 50 🌿 + 35 ⚡ + 20 💧 | Paid from the stores that are overflowing anyway, which is when it's useful |
| Seeder | 200 🌿 | A seed store |

**Running cost (per trip).** Paid through `payJob`, so the 25% reserve and "save up" protection still apply.

| Role | Per trip | Compared with a Restorer |
|---|---|---|
| Restorer | Pulse cost (restore 3–6 ⚡ + 1 💧; nurture 8/12/18 ⚡ + 2/3/5 💧) | — |
| Gardener | The target's nurture water only (2 / 3 / 5 💧), for the target **and** 2 neighbours | No energy at all; ~⅓ of the water per tile grown |
| Scout | Restore pulse cost + 1 ⚡ for every 4 tiles flown past the hub's base radius | Same restore price, plus flight |
| Courier | What the machine runs on: Mother Tree 4 💧, condenser or Reservoir Garden 4 ⚡, solar panel 3 💧 (washing the panel), relay link 6 ⚡ | Small, and spread across both stores |
| Spark | 10 ⚡ | — |
| Harvester | Nothing up front: it keeps 70% of what it collects as its cut and pays out the other 30% | Can't cost more than it earns |
| Seeder | 2 🌿 per tile | — |

**Two consequences:**

- **The Gardener is as fast as your water.** At the Phase 5 baseline water income (+9/min), one Gardener visits a tile every ~15–35 s. That's slow, but it never touches energy, which is the store taps and drones fight over. Building condensers makes it faster, so the role gives the player a reason to invest in water. That's why its unlock needs a condenser. If E18.0 shows Gardeners sitting idle most of the time, lower the price before changing the rule.
- **The Seeder spends biomass automatically.** Until now biomass has never been spent automatically: that rule kept the fountain's biomass price reachable. Since E12 biomass is uncapped and income is in the thousands per minute, so a small cost is safe if it's bounded: Seeders never spend biomass while the advisor is saving for anything, and never more than 5% of current biomass income. This needs your agreement before E18.7 (see open question 1).

### 2.4 How existing hub upgrades map to roles

Every existing upgrade keeps a meaning, so nobody's investment is wasted when they switch.

| Upgrade | Restorer | Gardener | Scout | Courier |
|---|---|---|---|---|
| Drone Dash | Faster | Faster | Faster | Faster |
| Work Radius | Reach | Reach | Reach (×1.5 base, see below) | Reach |
| Drone Squad | More drones | More drones | More drones | More drones |
| Drone Sweep | Free restores around | +1 grown neighbour per level (up to the Sweep count) | Free restores around, frontier tiles first | Each delivery also serves one more machine in range per 2 levels |
| Chain Intelligence | Synergy tiles first | Synergy tiles first | No effect (shown as such) | Machines closest to firing first |

Spark, Harvester and Seeder use only Dash, Radius and Squad at first. Their inspect text says which upgrades apply.

### 2.5 The three P0 roles in detail

**Gardener 🌱**
- Targets restored, unoccupied tiles below Radiant. It finishes full bloom first, then Radiant, using the same score as today's nurture fallback.
- Each visit grows the target **plus up to 2 orthogonal neighbours** one stage and pays **only the target's nurture water** (2 / 3 / 5 💧), no energy. Taking energy out of its cost is what eases the energy fight; its speed is set by water income (2.3).
- If nothing in reach can grow, it naps. It never falls back to restoring, so the choice stays a real one.
- Growth counts as automation growth for the Frenzy meter, as today.

**Scout 🔭**
- Reach is **1.5× the hub's radius** (before Work Radius) and it flies **1.5× faster**. It pays the normal restore cost plus 1 ⚡ for every 4 tiles flown past the hub's base radius, so long trips cost what they are.
- It restores only tiles at the fog's edge (the existing `frontierBonus` test). With nothing there, it restores any eligible tile like a Restorer, but **never nurtures**.
- This differs from "Focus the frontier": that switch is per area and changes every hub there. A Scout is per hub, reaches farther and doesn't stop pushing once its own area is cleared.
- P1 add-on: a Scout flying within 3 tiles of a hidden Lucky Cat makes the cat's nook give its subtle hint early (once per cat). This needs E15's hint; skip it if that isn't built yet.

**Courier 📦**
- Targets machines in reach, not tiles. It flies to the machine, works, and delivers:

| Machine | Delivery |
|---|---|
| Mother Tree | +2 charge (threshold 12) |
| Solar panel | The same boost a bloom beside it gives (`boostUntil`) |
| Bloom Relay link | −25% of the remaining recharge |
| Condenser / Reservoir Garden | +1 charge |

- Pays in what the machine runs on, through `payJob` (reserve applies): Mother Tree 4 💧, condenser or Reservoir Garden 4 ⚡, solar panel 3 💧, relay link 6 ⚡. If one store is low it serves the machines it can still pay for.
- **Bounded:** each machine accepts a Courier delivery at most once per 8 s, and a Mother Tree charged past its threshold this way still releases one Bloom Pulse, through its normal path. Machine targets need their own reservation set so two Couriers never stack on one machine.
- Picks machines closest to firing first (with Chain Intelligence) or nearest (without).

### 2.6 The later roles

- **Spark ✨ (P1):** finds a pollinator garden in reach with at least 2 gardens within its chain reach, flies to it and starts one Bloom Chain from it through `BloomChainSystem`. Normal caps, depth and fast-forward apply. At most one Spark chain per hub per 30 s. 10 ⚡ per trip.
- **Harvester 🧺 (P1):** while a store is full, its drones circle the hub and turn the income lost in the hub's area into biomass. It keeps 70% as its running cost and pays out 30% (valued at the Harvest rate), so it can never cost more than it earns. It reads the overflow log and doesn't change the Frenzy overflow rule. Only the overflow nobody else uses is converted, so there's no double counting.
- **Seeder 🌾 (P2):** turns barren tiles in reach into `prepared` ground (already cheaper to restore), fog-edge tiles first. One tile per 6 s, 2 🌿 per tile, within the biomass limits in 2.3. It never restores, so it can't replace tapping.

### 2.7 Offline and far drones

- Offline (`OfflineSystem`, half rate, up to 4 h): **Restorer, Gardener, Scout and Seeder** earn through the existing drone-job path and count toward `maxDroneJobs`. **Courier, Spark and Harvester do nothing offline**, because their payoffs set off machine pulses, chains or one-time conversions, which offline play never does.
- Far drones (by the clock): every role uses the same timed-flight path. Courier targets are machine centres.

### 2.8 Merges (E13) and the Megahub (E14)

- **Fleet Hub (T2):** has **two role slots**. Its drones split evenly between them (odd counts favour the first slot).
- **Drone Megahub (T3):** each of its up to 6 drones can take any unlocked role, set per drone in its panel.
- **Merging hubs with different roles:** the result takes the anchor's role in slot 1 and the most common other role in slot 2. The merge preview says this before the player confirms.
- If E18 ships before E13, these rules wait until E13 is built. Don't build a slot UI for machines that don't exist yet.

### 2.9 Look and sound

- Each role has its own **shell shape and a small icon over the drone**, not only a colour, so roles stay readable for colour-blind players and at gameplay zoom. Suggested: Gardener with a watering-can nozzle, Scout with a lens and longer wings, Courier with a little cargo pod, Spark with a glowing tail.
- The hub's status light and pads take the role's accent colour.
- Delivery and work sounds reuse the drone sound set with a per-role pitch or timbre. Keep the existing rule of no constant overlapping beeps.
- Inspect panel: role picker (icons + one-line job), current job, reach preview. For a Courier the preview highlights machines in reach instead of tiles.

## 3. Epic E18 — Drone roles

**Player experience:** My hubs don't all do the same thing. I chose what each one is for, and I can see them doing it.

| Story | Priority | Depends on |
|---|---|---|
| E18.0 Baseline | P0 | — |
| E18.1 Role framework | P0 | E18.0 |
| E18.2 Gardener | P0 | E18.1 |
| E18.3 Scout | P0 | E18.1 |
| E18.4 Courier | P0 | E18.1 |
| E18.5 Look, sound and panel | P0 | E18.2–E18.4 |
| E18.6 Spark and Harvester | P1 | E18.1 |
| E18.7 Seeder | P2 | E18.1 |
| E18.8 Merge slots | P1 | E13 (and E14 for the Megahub) |

### Stories

- [ ] **E18.0 Baseline.** Run the park and city bots and the hands-off bot. Record hands-off share, drone jobs/min, `waitingEnergy` share of drone time, areas cleared per hour and time to first full-bloom goals. Save these in a new section of `docs/PHASE_5_AUDIT.md` (or a new `docs/E18_AUDIT.md`).
- [ ] **E18.1 Role framework.** Add `DroneRole` and `MachineData.role` (default `restorer`, no save version bump). Move job search behind a per-role strategy in `DroneSystem` (find target, price, work, sweep) with Restorer as today's code path, unchanged byte for byte in saves when every hub is a Restorer (`tests/sim-scale.test.ts`-style comparison). Add role unlocks with `lockedReason`, refits as one atomic purchase with the prices in 2.3 (`MachineData.roles`, biomass part ×1.5 per hub already refitted), free switching between owned roles (current job finishes first), per-role running costs through `payJob`, area-switch precedence, Drone Party copying the role, and `TUNING.drone.roles`.
- [ ] **E18.2 Gardener.** Implement target choice, the 1 + 2 neighbour growth paid in the target's nurture water only, the nap-instead-of-restore rule and Sweep's extra neighbour. Offline credit through the existing path.
- [ ] **E18.3 Scout.** Implement the ×1.5 reach and speed, the flight surcharge, fog-edge-only restoring with the restore-only fallback, and its place in "Focus the frontier". Leave the cat-hint add-on for when E15's hint exists.
- [ ] **E18.4 Courier.** Add machine targets and a machine reservation set. Implement the four deliveries, each priced in what its machine runs on, the 8 s per-machine limit and Sweep's extra machine. Mother Tree pulses go through their normal release path only. No offline effect.
- [ ] **E18.5 Look, sound and panel.** Role shells and icons in `DroneVisuals.ts` (both renderers if both are live), hub accent colour, role picker in the hub's inspect panel with lock reasons, per-role reach preview, advisor hints ("Your Mother Tree is slow to charge: try a Courier hub nearby"), at most one hint per role. Check phone widths 320 / 390 and desktop, like the Phase 5 HUD shots.
- [ ] **E18.6 Spark and Harvester.** As in 2.6, with their caps. No offline effect. Spark chains count as automation-started chains in the metrics, so the "player still starts most big chains" check stays honest.
- [ ] **E18.7 Seeder.** As in 2.6. Make sure prepared ground made by Seeders doesn't count as restored for goals.
- [ ] **E18.8 Merge slots.** After E13: Fleet Hub two slots, merge preview text, role carried over by the rule in 2.8. After E14: per-drone roles on the Megahub.

### Acceptance criteria

- [ ] With every hub left as Restorer, a save played with E18 matches one played without it (same seed, same ticks).
- [ ] Each P0 role can be unlocked and chosen in normal play, without debug resources, before minute 15 of the park bot.
- [ ] A refit charges its price once, all or nothing; a stale button (hub gone, role already owned) changes nothing. Switching between owned roles is free and never refunds, double-charges or drops a paid job; reload mid-flight keeps the drone's role and target.
- [ ] Every role pays only in the resources listed in 2.3: a Gardener never spends energy, a Seeder never spends biomass while the advisor is saving, and no refit's energy or water part passes 60% of its store.
- [ ] Harvesters never pay out more than they collect.
- [ ] No two drones, of any role, share a tile or machine target at the same time (extend the existing reservation test).
- [ ] Couriers can't make a machine fire more often than once per 8 s from deliveries alone; Sparks can't start more than one chain per hub per 30 s; nothing loops.
- [ ] Offline progress only credits Restorer, Gardener, Scout and Seeder work, within `maxDroneJobs`.
- [ ] Hands-off share rises toward the 40–60% target with a sensible role mix (scripted hands-off bot picks roles by a fixed rule). Report the actual number, whether or not it lands in the target.
- [ ] Active play still beats hands-off, and the player still starts most big chains (Phase 5 E12 check).
- [ ] `waitingEnergy` time falls when Gardeners replace some Restorers, or the doc records why not.
- [ ] Every role is recognisable without colour at gameplay zoom, and the picker fits a 320 px phone.
- [ ] `npm run test:perf` stays inside its limits with the 50-hub soak using mixed roles.

## 4. Starting numbers (`TUNING.drone.roles`)

| Value | Start |
|---|---|
| Gardener extra neighbours per visit | 2 |
| Scout reach / speed multiplier | 1.5 / 1.5 |
| Courier deliveries | Mother Tree +2 charge, solar boost, relay −25% recharge, condenser/garden +1 charge |
| Courier per-machine limit | 1 per 8 s |
| Spark per-hub limit | 1 chain per 30 s |
| Seeder rate | 1 tile per 6 s |
| Refit prices | Gardener 60 🌿 + 20 💧; Scout 60 🌿 + 30 ⚡; Courier 80 🌿 + 15 ⚡ + 15 💧; Spark 120 🌿 + 30 ⚡; Harvester 50 🌿 + 35 ⚡ + 20 💧; Seeder 200 🌿 |
| Refit growth | Biomass part ×1.5 per hub already refitted to that role |
| Running costs | Gardener nurture water only; Scout restore cost + 1 ⚡ per 4 tiles past base radius; Courier 4 💧 / 4 ⚡ / 3 💧 / 6 ⚡ by machine; Spark 10 ⚡; Harvester keeps 70%; Seeder 2 🌿 per tile |
| Seeder biomass limit | Nothing while saving; at most 5% of biomass income |
| Unlocks | See 2.2 |

## 5. Open questions

1. **May the Seeder spend biomass?** It breaks the old "biomass is never spent automatically" rule. The limits in 2.3 should keep purchases safe now that biomass is uncapped, but this is a rule change to agree on before E18.7. If not, the Seeder could pay in water instead (it waters the seeds), at the cost of competing with the Gardener.
2. **Should switching between owned roles have a short cooldown?** It's free and instant here. If bots or players flip roles every few seconds to game Courier deliveries, add a 10 s cooldown.
3. **Is the Harvester worth shipping?** It overlaps with overflow already feeding Frenzy. If E12's overflow rule makes lost income rare in practice, drop it.
4. **Does the old drone get a role later?** The proposal says no, to keep it a simple starter. It could become a Gardener once the park is fully restored.
