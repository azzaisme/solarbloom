# E18 drone roles: baseline and results

The plan is `docs/DRONE_ROLES_EPIC.md` (epic #199). This file records what each E18 story measured.

**How to read the numbers:** every number here comes from **scripted bots** (`tests/bots.ts`, the city
player in `tests/pacing-city.test.ts`), not people. Bots act every 3 s and buy every affordable upgrade, so
people will be slower and buy less. No human playtests and no real-device measurements were done.

## E18.0: baseline before drone roles (#200)

Measured on `d1716b1` (main after Look 5 and Look 6) with `tests/e18-baseline.test.ts`:

```bash
E18_REPORT=1 npx vitest run --mode full tests/e18-baseline.test.ts   # ~16 min
```

- **Park bots** (`runBot`): active and hands-off, seeds 7, 21 and 99, 15 and 30 minutes each. The hands-off
  bot plays like the active one until its first Drone Hub stands, then never taps again (it still builds,
  buys upgrades and wakes landmarks).
- **City bot** (`playCity`): seeds 7 and 21, 60 minutes.
- **Drone time** is sampled once per simulated second over every hub drone (the old drone runs on sunlight
  and never waits, so it's left out). `waitingEnergy` is the game's own status name: it means a job was
  found but `payJob` refused it, for **either** store.
- **Short ⚡ / 💧** counts refused payments by the store that was below the drone reserve (25% of its cap)
  or empty, checked read-only. One drone retries every second, so these are retries, not lost jobs.

### Park: hands-off share, drone jobs and drone time

Hands-off share = tiles restored after the hands-off bot stopped tapping, against the active bot's tiles over
the same window (the Phase 4 E00.3 definition behind the "30–36%" in `PROGRESS.md`).

| Seed | Length | Hands-off share | Drone jobs/min (active / hands-off) | `waitingEnergy` (active / hands-off) | Napping | Short ⚡ / 💧 (active) |
|---|---|---|---|---|---|---|
| 7 | 15 min | **30%** (713 / 2394) | 30.7 / 51.2 | 94% / 87% | 0% | 36 / 10,613 |
| 21 | 15 min | **30%** (775 / 2604) | 26.3 / 53.7 | 95% / 86% | 0% | 26 / 12,947 |
| 99 | 15 min | **31%** (759 / 2438) | 23.9 / 54.0 | 96% / 89% | 0% | 32 / 13,550 |
| 7 | 30 min | **15%** (836 / 5716) | 32.3 / 53.5 | 97% / 92% | 0% | 36 / 45,604 |
| 21 | 30 min | **24%** (931 / 3810) | 88.4 / 53.7 | 93% / 92% | 0% | 26 / 49,778 |
| 99 | 30 min | **15%** (976 / 6690) | 66.5 / 55.5 | 95% / 93% | 0% | 32 / 52,311 |

First Drone Hub at 1:15–1:18 in every run.

### Park: time to the full-bloom goals

| Seed | 10 tiles in full bloom (Gardener unlock), active / hands-off | Park full-bloom goal (24), active / hands-off | Fountain, active / hands-off |
|---|---|---|---|
| 7 | 3:36 / 4:58 | 5:05 / 7:18 | 5:33 / 8:09 |
| 21 | 3:42 / 5:18 | 4:50 / 7:05 | 5:12 / 7:36 |
| 99 | 4:00 / 5:31 | 4:53 / 6:31 | 5:21 / 7:48 |

### City: 60 minutes

| Seed | Fountain | Areas cleared | Per hour after the fountain | First area | Hubs / drones at 60 min | Drone jobs/min | `waitingEnergy` | Napping | Short ⚡ / 💧 | Big chains you / automation |
|---|---|---|---|---|---|---|---|---|---|---|
| 7 | 4:30 | 74 | 80 | 5:24 | 61 / 300 | 233 | 92% | 4% | 8 / 414,904 | 67 / 47 |
| 21 | 4:45 | 93 | 101 | 6:45 | 82 / 391 | 427 | 84% | 11% | 8 / 510,749 | 57 / 51 |

No stuck time in either run.

### What the baseline says

1. **The "30–36%" hands-off share holds only for the first 15 minutes.** At 15 min it's 30–31% on all three
   seeds; over 30 min it falls to 15–24%, because the active bot keeps accelerating while hands-off play
   levels off. E18's 40–60% target needs a stated window: these numbers suggest measuring both.
2. **Hub drones almost never lack work; they lack money.** 84–97% of hub-drone time is spent with a job found
   and the payment refused, and napping (nothing to do) is 0% in the park and 4–11% in the city. Adding
   reach or speed won't move hands-off play; making jobs payable will.
3. **Water is the store that stops them, not energy.** In every park run, energy refused a payment 26–36
   times, and water refused 10,600–13,600 times in 15 minutes and 45,600–52,300 in 30; in the 60-minute city
   runs it was 8 against 415,000–511,000. A restore costs
   3–6 ⚡ + 1 💧 and a nurture 8–18 ⚡ + 2–5 💧, and park water income is small, so water runs out first.
   **This changes the Gardener's premise (design doc 2.3, 2.5):** it was priced in water only "to take
   energy out of the fight", but water is what the fight is about. As priced, a Gardener competes for the
   scarcest store. The design doc's own rule is to "lower the price before changing the rule" if Gardeners
   sit idle. E18.2 should measure exactly that, and it may be worth deciding before then whether to:
   - keep water-only and lower the per-visit price (it already grows 3 tiles for one tile's nurture water);
   - price the Gardener in energy, which drones barely touch, and leave water to Restorers; or
   - tie Gardener speed to condensers beyond the unlock (e.g. its water doesn't count against the reserve
     while a condenser in reach is full).
4. **The player still starts most big chains** (city 67/47 and 57/51), the Phase 5 E12 check E18 must keep.

### Golden saves

`tests/e18-baseline.test.ts` also plays the park bot (seed 7, 20 min, 41 drones, 590 jobs) and the city bot
(seed 21, 30 min, 201 drones, 557 jobs) and compares a SHA-256 of each save with
`tests/fixtures/e18-golden.json`, recorded on `d1716b1` before any E18 code. It runs in `npm run test:full`
(~75 s). While every hub is a Restorer, E18 must keep both hashes. Re-record with `E18_GOLDEN=write` only for
an intended gameplay change, and say so in the commit.

## E18.1: role framework (#201)

- **Data:** `DroneRole` (`restorer`, `gardener`, `scout`, `courier`, `spark`, `harvester`),
  `MachineData.role` (unset = Restorer), `MachineData.roles` (refits owned) and `DroneData.role` (the role
  of the job in flight, unset for a Restorer's). All three are only written for non-Restorer roles, so old
  saves load unchanged and there is no save version bump. Role text is in `src/data/droneRoles.ts`; icons
  are Look 5.2's `ROLE_ICONS`.
- **Strategy:** `DroneSystem` asks a `RoleStrategy` for each step (find a target, price it, work it, sweep
  around it, credit it offline). Restorer is the pre-E18 code moved into one, unchanged. Reach, networks,
  reservations, the reserve and "save up" (`payJob`), far flights, Drone Party and offline pacing are shared
  by every role. A role can only be picked once its strategy is registered, so no role reaches players
  before its story (E18.2–E18.6) builds it.
- **Roles per hub** (`sim.droneRoles`): unlocks from 2.2 with `lockedReason`; a refit is one atomic purchase
  at the 2.3 price (biomass ×1.5 per other hub already refitted to that role; energy and water never grow
  and never pass 60% of the store); switching between owned roles is free and never refunds; a stale call
  (hub gone, not a hub, role already current, unknown role) changes nothing. A drone in flight finishes the
  job it paid for in that job's role, then follows the hub's new role.
- **Area switches:** "Leave this area alone" stops every role (strategies skip `areaMode(t) === 'off'`). The
  role-specific pulls ("Keep blooming" pulls Gardeners first, "Focus the frontier" Scouts and Restorers) land
  with those roles in E18.2 and E18.3.
- **Offline:** only roles whose strategy has an `offline` step earn while away (2.7); Restorer's is the old
  code path.
- **Merges:** a merged Fleet Hub owns every refit its three hubs had and keeps the anchor's role (refits
  are hardware, like upgrade levels). Two role slots are E18.8.
- **Numbers:** all in `TUNING.drone.roles`.

**Checks** (`tests/drone-roles.test.ts`, in `npm test`): refit charged once and all or nothing; a refit it
can't afford changes nothing; stale calls change nothing; locked roles say why; biomass growth and the 60%
cap; every refit fits the starting stores; a switch mid-flight finishes the paid job in its role; the reserve
applies to every role; a reload mid-flight keeps role and target; no two drones of any role share a target
over 600 ticks; Drone Party drones copy the role; offline credits only offline roles; merges keep refits.
The golden saves above still match with the framework in place.

**Known failures not from E18:** on `d1716b1`, `tests/icons.test.ts` (emoji without an icon in `Game.ts`,
`AreaPanel.ts` and `upgrades.ts`) and two `tests/upgrade-effects.test.ts` cases (City 09.4) already fail.
E18 adds none.
