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
