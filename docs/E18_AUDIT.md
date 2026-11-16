# E18 — Drone roles: audit

Epic #199. Each section records what a story measured, so later stories can compare against it.

# E18.0 — Baseline before roles (#200)

Build: `edbbf1c` (main, before any E18 change). **Every number here comes from scripted bots (`tests/bots.ts`,
`tests/city-bot.ts`), not people.** People play slower and less systematically.

Reproduce with:

```bash
E18=1 npx vitest run --mode full tests/e18-baseline.test.ts
```

It is skipped without `E18` (about 7 minutes of wall time on this machine). The drone probe only reads state once
per simulated second, so it doesn't change the run. Each run ends with a **fingerprint line** (tiles, drone jobs,
machines, drones, resources at the end). Two runs on the same build gave identical fingerprints. With every hub
left as Restorer, later E18 stories must reproduce these exactly (the epic's "same seed, same ticks" rule).

## Bots and run lengths

| Bot | What it does | Seeds | Length |
|---|---|---|---|
| Park, active (`runBot`) | One action every 3 s: builds the park order, pulses synergy tiles, buys upgrades, claims cats, and after the fountain clears areas the advisor points to | 7, 21, 99 | 30 min |
| Park, hands-off (`runBot`, `handsOff`) | Same as active until its first Drone Hub stands, then never taps again (still buys machines and upgrades, wakes landmarks, fires Frenzy) | 7, 21, 99 | 30 min |
| City (`playCity`) | The pacing-city player: the park, then area after area, with specialties | 7, 21 | 60 min |

## Results

"Hands-off share" is the tiles the hands-off bot restored after its hub, divided by the active bot's tiles over
the same window (the measure used since the Phase 4 audit). "Drone time" adds up every drone's status, sampled once
per simulated second. "Full-bloom goal" is when the park first reaches `TUNING.park.fullBloomTiles` (52).

### Park bots, 30 minutes

| Seed | Bot | Hub | Full-bloom goal | Fountain | Areas cleared | Tiles | Drones at end | Drone jobs/min (since hub) | Working / travelling / **waitingEnergy** / napping |
|---|---|---|---|---|---:|---:|---:|---:|---|
| 7 | active | 1:18 | 5:05 | 5:33 | 9 | 6,560 | 61 | 72.0 | 6 / 1 / **91** / 2 % |
| 7 | hands-off | 1:18 | 7:18 | 8:09 | 2 | 1,301 | 31 | 55.7 | 8 / 1 / **88** / 3 % |
| 21 | active | 1:18 | 4:50 | 5:12 | 11 | 6,289 | 71 | 91.2 | 6 / 1 / **91** / 2 % |
| 21 | hands-off | 1:18 | 7:05 | 7:36 | 2 | 990 | 26 | 53.4 | 9 / 1 / **87** / 3 % |
| 99 | active | 1:15 | 4:53 | 5:21 | 8 | 6,664 | 56 | 64.0 | 5 / 0 / **92** / 2 % |
| 99 | hands-off | 1:15 | 6:31 | 7:48 | 1 | 947 | 26 | 54.4 | 8 / 1 / **87** / 3 % |

| Seed | Hands-off share to 15:00 | Hands-off share to 30:00 |
|---|---|---|
| 7 | 696 / 2,561 tiles = **27 %** | 1,252 / 6,501 = **19 %** |
| 21 | 737 / 2,475 = **30 %** | 941 / 6,232 = **15 %** |
| 99 | 712 / 2,577 = **28 %** | 897 / 6,605 = **14 %** |

### City bot, 60 minutes

| Seed | Fountain | Full-bloom goal | Areas cleared | Areas/hour after the fountain | First area | Big chains, you / automation | Drones at end | Drone jobs/min (since hub at 1:18) | Working / travelling / **waitingEnergy** / napping |
|---|---|---|---:|---:|---|---|---:|---:|---|
| 7 | 4:30 | 4:14 | 70 | 75.7 | 5:15 | 59 / 47 | 277 | 112.6 | 2 / 0 / **97** / 1 % |
| 21 | 4:45 | 4:10 | 80 | 86.9 | 6:45 | 71 / 56 | 348 | 255.1 | 3 / 0 / **93** / 4 % |

Neither bot was ever stuck (0 s in every run).

## What the baseline says

- **Drones mostly wait for energy.** 87–97 % of all drone time is `waitingEnergy`, in every run. Only 2–9 % is
  working. Drones are energy-bound, not job-bound (napping, meaning nothing to do, is 1–4 %). Adding more drones
  mostly adds more waiting: the active city bot ends with 277–348 drones, but jobs per drone fall. This is the
  epic's "taps and drones fight over energy" problem, and the main thing roles that pay in water (Gardener) or
  bring their own energy (Courier) should change.
- **Hands-off share is 27–30 % at 15 minutes and falls to 14–19 % at 30 minutes** (target 40–60 %). The 15-minute
  figure is close to the Phase 4 audit's 30–36 %, a little lower since main has moved on. The gap widens because
  the active bot keeps clearing areas (8–11 by 30:00) while hands-off clears 1–2.
- **Drone throughput:** about 54–56 jobs/min hands-off, 64–91 active, and 113–255 in the city (where the bot
  builds a hub per area).
- **Goals:** the park's full-bloom goal comes at 4:50–5:05 active and 6:31–7:18 hands-off. The fountain follows
  0:20–1:20 later. In the city run the full-bloom goal comes first (4:10–4:14) and the fountain at 4:30–4:45.
- **Active play still leads:** in the city the player starts most big chains (59 vs 47, 71 vs 56). Roles must
  keep it that way.
- The city run gave 70 / 80 areas in 60 minutes. The pacing pass recorded 76 / 82 on an older build, so main has
  drifted a little since then. These are the new reference.

## Tooling added

- `tests/e18-baseline.test.ts`: the opt-in runs above, with a read-only drone probe and the fingerprint line.
- `tests/city-bot.ts`: `playCity` moved out of `pacing-city.test.ts` so other tests can use it without also
  registering that file's tests (`pacing-city` and `sim-scale` import it from there now).
- `tests/bots.ts`: `runBotAsync`, the same run as `runBot` but handing the thread back every 300 simulated
  seconds. A 30-minute park run otherwise holds the Vitest worker for about 20 s, and Vitest reports
  `Timeout calling "onTaskUpdate"`. `runBot` is unchanged for existing callers.

# E18.7 — Drone upgrades priced by what they do (#207)

## What changed

| Upgrade | Before | Now (L = current level) |
|---|---|---|
| Drone Dash | 35 🌿 × 1.65^L | 25 🌿 × 1.65^L + 10 ⚡ × 1.4^L |
| Work Radius | 40 🌿 × 1.65^L | 28 🌿 × 1.65^L + 10 ⚡ × 1.4^L |
| Drone Sweep | 120 🌿 × 2^L | 85 🌿 × 2^L + 8 💧 × 1.4^L |
| Drone Squad | 70 🌿 × 2.5^L | unchanged |
| Chain Intelligence | 45 🌿 | 30 🌿 + 15 ⚡ |
| Drone Mesh | 200 🌿 × 2^L | 140 🌿 × 2^L + 25 ⚡ × 1.5^L |

- `UpgradeDef.parts` holds the energy or water part (base and growth). Each part stops at 60% of its store's cap
  (`machineCostMaxShare`), so no level is ever out of reach. Past that, only the biomass part rises.
- `UpgradeSystem.price()` returns the whole price; `status().price` carries it, and a purchase pays every part
  at once through `econ.spend` or nothing. `cost()` and `status().cost` stay the main (biomass) part, which is
  what "Upgrade all" and the bots sort and save by. "Need …" names the main part first, then the short part.
- **Drones leave the part alone.** `UpgradeSystem.pendingParts()` is the energy and water part of the cheapest
  drone upgrade whose biomass part is already there. `DroneSystem.payJob` keeps it, like a pending
  superstructure stage. Without this, drones drain energy to their 25% reserve (15 ⚡ at the first storage tier)
  and Drone Dash's energy part passes that from level 2. The advisor's own "save up" hint only covers machines,
  and only while the HUD asks for it, so it couldn't do this.
- The drawer, the hub's inspect panel, the upgrade button's price and the advisor's "Next:" line show every part.
  The part you're short of is underlined (wavy), so it reads without colour. Checked in the browser at desktop
  width and at 320 px: no button wraps or overflows.
- Saves store levels, not prices: nothing migrates.

## Measured (same bots and seeds as E18.0)

Before = E18.0 (`06f6e89`), after = this change, same report, run one after the other on the same machine.

| Run | Tiles, before → after | Drone jobs/min | waitingEnergy | Hands-off share at 15 / 30 min |
|---|---|---|---|---|
| Park 7 active | 6,560 → 6,772 | 72.0 → 97.7 | 91 → 89 % | |
| Park 7 hands-off | 1,301 → 1,294 | 55.7 → 50.6 | 88 → 89 % | 27 / 19 % → 27 / 19 % |
| Park 21 active | 6,289 → 5,802 | 91.2 → 73.7 | 91 → 92 % | |
| Park 21 hands-off | 990 → 1,025 | 53.4 → 50.2 | 87 → 88 % | 30 / 15 % → 31 / 17 % |
| Park 99 active | 6,664 → 6,306 | 64.0 → 49.6 | 92 → 93 % | |
| Park 99 hands-off | 947 → 886 | 54.4 → 50.9 | 87 → 88 % | 28 / 14 % → 30 / 13 % |
| City 7 (60 min) | 23,980 → 29,399 | 112.6 → 423.7 | 97 → 85 % | 70 → 78 areas |
| City 21 (60 min) | 26,471 → 27,447 | 255.1 → 376.9 | 93 → 85 % | 80 → 79 areas |

**When drone upgrades are bought (park bots):**

- The **first Drone Dash comes earlier** for the active bot: 3:45 / 3:54 / 3:30 → 3:21 / 3:15 / 3:18. Its biomass part is 25 instead of 35, and 10 ⚡ is there.
- **Work Radius comes later** for the active bot on seeds 7 and 21 (4:06 / 4:03 → 4:27 / 4:21), and a little earlier on 99 (4:24 → 4:21).
- **Drone Mesh comes earlier** for the active bot (6:12 / 6:24 / 5:54 → 5:27 / 5:54 / 5:33). Hands-off, it's earlier on seeds 7 and 21 (8:45 / 8:42 → 8:21 / 8:24) and later on 99 (7:45 → 8:09).
- **The total number of levels is the same.** Every bot buys every drone upgrade to its maximum. The active
  bots finish 1–2 minutes later (24:00–27:48 → 25:09–28:42), and seed 99 active stops at 60 Dash levels instead of 66,
  with one hub fewer at 30:00.
- The hands-off bot's last levels move later on seeds 7 and 21 (18:09 → 19:18, 11:06 → 13:24) and slightly
  earlier on seed 99 (11:00 → 10:24).

**Hands-off share is unchanged within noise** (27–31 % at 15 min, 13–19 % at 30 min). That was expected: pricing
alone doesn't add a job drones can do without energy. The roles (E18.1–E18.4) are meant to move it.

**The city bot changed the most, and it's the bot, not the drones.** At 25 minutes, seed 7 had 32 hubs and 9,319
tiles, against 17 hubs and 6,601 tiles before. The city bot buys every upgrade it can afford each action, so drone
upgrades costing ~30 % less biomass leave it more biomass for its next machine. More hubs give the jump in jobs per
minute, and drones napping (no job in reach) rises from 1–4 % to 9–10 %. Seed 7 cleared 78 areas instead of 70;
seed 21 is level (79 vs 80). People don't buy every upgrade the moment it's affordable, so treat this as an upper
bound.

**The E12 rule holds:** "keeps something to buy for 30 minutes and never stalls" passes, and no run was ever
stuck (0 s everywhere).

The E18.0 fingerprints changed, as they must: prices changed. E18.1 compares against the fingerprints printed by
this build, not E18.0's.

## Tests run (E18.7)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `tests/upgrade-prices.test.ts` (new, in the quick suite, 7 tests): every price matches the table at every level and Seed Vault tier; every level can be bought at every tier with exactly its price; short of energy spends nothing and says "Need 10 ⚡"; "Upgrade all" stops at the first level it can't pay; biomass-only upgrades are unchanged; drones keep the pending energy part; buy buttons underline the short part | pass |
| `npm test` (quick suite) | all pass except `icons.test.ts` (7 emoji without an illustrated icon, also failing on main) |
| `tests/economy-phase5.test.ts` (E12, 12 tests, 30-minute bot) | pass. Vitest also reports its known `Timeout calling "onTaskUpdate"` from the 30-minute synchronous run |
| `E18=1 … tests/e18-baseline.test.ts` before and after | 8 / 8 pass on both |
| In the browser (dev server, 800 px and 320 px) | drawer and inspect panel show both parts, underline the short one, nothing wraps; no new console errors |
