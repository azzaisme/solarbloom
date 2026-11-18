import { describe, expect, it } from 'vitest';
import { toNum } from '../src/core/Big';
import { PARK } from '../src/core/Areas';
import { TUNING } from '../src/data/tuning';
import type { DroneStatus } from '../src/gameplay/DroneSystem';
import { HOME } from '../src/gameplay/ProgressionSystem';
import type { Sim } from '../src/gameplay/Sim';
import { BOT_ROLE_PLAN, mmss, runBotAsync, type BotReport } from './bots';
import { playCity } from './city-bot';

/**
 * E18.0 (#200): the drone baseline before roles, measured by scripted bots (not people). Every later E18 story
 * compares against these numbers, and with every hub left as Restorer its fingerprint lines must not change.
 *
 * `E18=1 npx vitest run tests/e18-baseline.test.ts` (skipped otherwise: the city runs take minutes each).
 * Results are written up in `docs/E18_AUDIT.md`.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const run = !!env.E18;
/** E18.1+: `E18_ROLES=1` gives hubs roles by the bots' fixed rule (tests/bots.ts BOT_ROLE_PLAN). */
const roles = !!env.E18_ROLES;
const PARK_SEEDS = [7, 21, 99];
const PARK_MIN = 30;
// E18_CITY_SEEDS=3,42 overrides the city seeds (extra seeds for noisy results).
const CITY_SEEDS = env.E18_CITY_SEEDS ? env.E18_CITY_SEEDS.split(',').map(Number) : [7, 21];
const CITY_MIN = 60;

/** Read-only drone probe: sampled once per simulated second, never changes the sim. */
function probe() {
  const secs: Record<DroneStatus, number> = { working: 0, travelling: 0, waitingEnergy: 0, napping: 0, docked: 0 };
  const p = { secs, droneSeconds: 0, fullBloomAt: -1, areas: 0, hooked: false };
  const sample = (sim: Sim) => {
    if (!p.hooked) {
      sim.bus.on('area.cleared', ({ areaId }) => areaId !== PARK && p.areas++);
      p.hooked = true;
    }
    for (const d of sim.state.drones) {
      secs[sim.drones.statusOf(d)]++;
      p.droneSeconds++;
    }
    if (p.fullBloomAt < 0 && sim.progression.fullBloomCount(HOME) >= TUNING.park.fullBloomTiles) p.fullBloomAt = Math.round(sim.time);
  };
  return { p, sample };
}

const pct = (n: number, d: number) => `${d ? Math.round((100 * n) / d) : 0}%`;

function droneLine(sim: Sim, p: ReturnType<typeof probe>['p']) {
  const st = sim.state.stats;
  const hubAt = st.firsts.droneHub;
  const mins = hubAt === undefined ? 0 : (sim.time - hubAt) / 60;
  const jobsPerMin = mins > 0 ? (st.droneJobs / mins).toFixed(1) : '—';
  const s = p.secs;
  return (
    `drones ${sim.state.drones.length} · jobs ${st.droneJobs} (${jobsPerMin}/min since hub ${mmss(hubAt)}) · drone time: ` +
    `working ${pct(s.working, p.droneSeconds)} travelling ${pct(s.travelling, p.droneSeconds)} waitingEnergy ${pct(s.waitingEnergy, p.droneSeconds)} napping ${pct(s.napping, p.droneSeconds)}`
  );
}

/** E18.7: when the bot bought drone upgrades (levels across all hubs: how many, first and last). */
const DRONE_UPGRADES = ['droneSpeed', 'droneRadius', 'secondDrone', 'droneSweep', 'chainIntel', 'droneMesh'];
function upgradeLine(r: BotReport) {
  return (
    'drone upgrades: ' +
    DRONE_UPGRADES.map((id) => {
      const ts = r.upgrades.filter((u) => u.id === id).map((u) => u.t);
      return ts.length ? `${id} ×${ts.length} (${mmss(ts[0])}–${mmss(ts[ts.length - 1])})` : `${id} —`;
    }).join(' · ')
  );
}

/** E18: how many hubs have each role at the end. */
function roleMix(sim: Sim) {
  const n: Record<string, number> = {};
  for (const h of sim.state.machines) if (h.type === 'droneHub') n[sim.roles.roleOf(h)] = (n[sim.roles.roleOf(h)] ?? 0) + 1;
  return Object.entries(n).map(([k, v]) => `${k} ${v}`).join(' · ');
}

/** Same seed, same ticks: these values must match exactly while every hub stays Restorer. */
function fingerprint(sim: Sim) {
  const s = sim.state;
  const r = (k: 'energy' | 'water' | 'biomass') => Math.round(toNum(s.resources[k]));
  return `fingerprint t=${Math.round(sim.time)} tiles=${s.stats.tilesRestored} droneJobs=${s.stats.droneJobs} machines=${s.machines.length} drones=${s.drones.length} res=${r('energy')}/${r('water')}/${r('biomass')}`;
}

/** Tiles restored between `from` (sim seconds) and minute `upTo`. */
const tilesBetween = (r: BotReport, from: number, upTo: number) => {
  const a = r.minutesLog.find((m) => m.m * 60 >= from);
  const b = r.minutesLog.find((m) => m.m === upTo) ?? r.minutesLog[r.minutesLog.length - 1];
  return b.tiles - (a?.tiles ?? 0);
};

describe.skipIf(!run)('E18.0 drone baseline (scripted bots)', () => {
  // One test per bot run: a single synchronous test over ~40 s starves the Vitest worker's RPC (CI timeout).
  const reports: Record<string, BotReport> = {};
  for (const seed of PARK_SEEDS)
    for (const mode of ['active', 'handsOff'] as const)
    it(`park: ${mode}, ${PARK_MIN} min (seed ${seed})`, { timeout: 900_000 }, async () => {
      const out: string[] = [];
      {
        const { p, sample } = probe();
        let last: Sim | undefined;
        const r = await runBotAsync({
          seed,
          minutes: PARK_MIN,
          mode,
          roles,
          onSecond: (sim) => {
            sample(sim);
            last = sim;
          },
        });
        reports[`${seed}:${mode}`] = r;
        out.push(
          `seed ${seed} ${mode}: hub ${mmss(r.firsts.droneHub)} park full-bloom goal ${mmss(p.fullBloomAt)} fountain ${mmss(r.fountain)} · areas cleared ${p.areas} · tiles ${r.tilesRestored} · ` +
            `chains ${r.chains} maxCombo ${r.maxCombo} · stuck ${r.stuck}s`,
          `    ${droneLine(last!, p)}`,
          `    ${upgradeLine(r)}`,
          ...(roles ? [`    roles chosen: ${Object.entries(r.roleAt).map(([k, t]) => `${k} ${mmss(t)}`).join(' · ') || 'none'}`] : []),
          `    ${fingerprint(last!)}`,
        );
      }
      const active = reports[`${seed}:active`];
      const hands = reports[`${seed}:handsOff`];
      if (active && hands) {
        const at = hands.handsOffAt ?? 0;
        for (const m of [15, PARK_MIN]) {
          const h = tilesBetween(hands, at, m);
          const a = tilesBetween(active, at, m);
          out.push(`    hands-off share, tiles from ${mmss(at)} to ${m}:00: ${h} vs active ${a} (${pct(h, a)})`);
        }
      }
      // eslint-disable-next-line no-console
      console.log(out.join('\n'));
      expect(reports[`${seed}:${mode}`].tilesRestored).toBeGreaterThan(0);
    });

  for (const seed of CITY_SEEDS)
    it(`city: scripted player, ${CITY_MIN} min (seed ${seed})`, { timeout: 1_800_000 }, async () => {
      const { p, sample } = probe();
      const roleAt: Record<string, number> = {};
      // E18_PLAN=restorer,gardener,… overrides the role rule (attribution runs).
      const plan = (env.E18_PLAN?.split(',') as typeof BOT_ROLE_PLAN | undefined) ?? BOT_ROLE_PLAN;
      const r = await playCity(seed, 3, CITY_MIN, (sim) => {
        const tick = sim.tick.bind(sim);
        let n = 0;
        sim.tick = () => {
          tick();
          if (n++ % 10 === 9) sample(sim);
          // E18: the same fixed role rule as the park bots, checked every 3 s (refits only from spare biomass).
          if (roles && n % 30 === 0) {
            const hubs = sim.state.machines.filter((m) => m.type === 'droneHub').sort((a, b) => (Number(a.id.slice(1)) || 0) - (Number(b.id.slice(1)) || 0));
            hubs.forEach((h, i) => {
              const want = plan[Math.min(i, plan.length - 1)];
              if (sim.roles.roleOf(h) !== want && sim.roles.check(h.id, want).ok && sim.state.resources.biomass.gte(1000) && sim.roles.choose(h.id, want)) roleAt[want] ??= Math.round(sim.time);
            });
          }
        };
      });
      const perHour = (r.clears.length / Math.max(1, CITY_MIN * 60 - (r.fountain ?? 0))) * 3600;
      // eslint-disable-next-line no-console
      console.log(
        [
          `city seed ${seed}: fountain ${mmss(r.fountain)} · park full-bloom goal ${mmss(p.fullBloomAt)} · ${r.clears.length} areas in ${CITY_MIN} min (${perHour.toFixed(1)}/h after the fountain) · first ${mmss(r.clears[0])} · stuck ${Math.round(r.stuck)}s · big chains you ${r.sim.state.stats.bigChains?.player ?? 0} / automation ${r.sim.state.stats.bigChains?.auto ?? 0}`,
          `    ${droneLine(r.sim, p)}`,
          ...(roles ? [`    roles chosen: ${Object.entries(roleAt).map(([k, t]) => `${k} ${mmss(t)}`).join(' · ') || 'none'}`, `    hubs by role: ${roleMix(r.sim)}`] : []),
          `    ${fingerprint(r.sim)}`,
        ].join('\n'),
      );
      expect(r.fountain).toBeDefined();
    });
});
