import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { big } from '../src/core/Big';
import { TUNING } from '../src/data/tuning';
import { HOME } from '../src/gameplay/ProgressionSystem';
import type { Sim } from '../src/gameplay/Sim';
import { mmss, runBot, type BotReport } from './bots';
import golden from './fixtures/e18-golden.json';

/**
 * E18.0 (#200): the drone baseline before drone roles, measured with the existing scripted bots (not people).
 *
 * - `E18_REPORT=1 npx vitest run --mode full tests/e18-baseline.test.ts` prints the numbers recorded in
 *   `docs/E18_AUDIT.md` (park active and hands-off, 15 and 30 min, seeds 7/21/99; city 60 min, seeds 7/21).
 * - The golden test always runs: it plays fixed seeds and compares a hash of the save with
 *   `tests/fixtures/e18-golden.json`. While every hub is a Restorer, E18 must not change a single byte
 *   (#199 "Done when"). `E18_GOLDEN=write` re-records it, only for an intended gameplay change.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Node's fs, loaded lazily (the project's tsconfig has no Node types). */
async function writeFile(path: string | URL, text: string) {
  const fs: { writeFileSync(p: string | URL, t: string): void } = await import(/* @vite-ignore */ `node:${'fs'}`);
  fs.writeFileSync(path, text);
}

/** Drone-seconds by status, jobs and full-bloom firsts, sampled once per simulated second. */
export interface DroneSample {
  /** drone-seconds by status (hub drones only: the old drone runs on sunlight and never waits) */
  status: Record<string, number>;
  /** sim time of the first Drone Hub, and drone jobs done since then */
  firstHub?: number;
  jobsAtHub: number;
  /** sim time the park reached 10 full-bloom tiles (the Gardener's unlock) and its full-bloom goal */
  full10?: number;
  fullGoal?: number;
  /** failed drone payments, by the store that was short (below the reserve or empty) */
  blocked: Record<string, number>;
}

export function droneSampler(): { sample: DroneSample; onSecond: (sim: Sim) => void } {
  const sample: DroneSample = { status: { working: 0, travelling: 0, napping: 0, waitingEnergy: 0 }, jobsAtHub: 0, blocked: { energy: 0, water: 0 } };
  let patched: Sim | undefined;
  const onSecond = (sim: Sim) => {
    const s = sim.state;
    if (patched !== sim) {
      // Which store stops a drone job: each part against the drone reserve, read-only (measurement only;
      // "save up" floors aren't counted, so a refusal can show neither store short).
      patched = sim;
      const pay = sim.drones.payJob.bind(sim.drones);
      sim.drones.payJob = (cost) => {
        const ok = pay(cost);
        if (!ok)
          for (const k of ['energy', 'water'] as const) {
            if (cost[k] === undefined) continue;
            const cap = sim.econ.cap(k);
            const left = sim.econ.get(k).sub(big(cost[k]!));
            if (left.lt(0) || (cap && left.lt(cap.mul(TUNING.drone.reserve)))) sample.blocked[k]++;
          }
        return ok;
      };
    }
    if (sample.firstHub === undefined && s.machines.some((m) => m.type === 'droneHub')) {
      sample.firstHub = sim.time;
      sample.jobsAtHub = s.stats.droneJobs;
    }
    for (const d of s.drones) if (!d.old) sample.status[sim.drones.statusOf(d)] = (sample.status[sim.drones.statusOf(d)] ?? 0) + 1;
    if (sample.full10 === undefined || sample.fullGoal === undefined) {
      const full = sim.progression.fullBloomCount(HOME);
      if (sample.full10 === undefined && full >= 10) sample.full10 = sim.time;
      if (sample.fullGoal === undefined && full >= TUNING.park.fullBloomTiles) sample.fullGoal = sim.time;
    }
  };
  return { sample, onSecond };
}

export function droneSummary(sample: DroneSample, droneJobs: number, endTime: number) {
  const total = Object.values(sample.status).reduce((a, b) => a + b, 0);
  const share = (k: string) => (total ? sample.status[k] / total : 0);
  const mins = sample.firstHub === undefined ? 0 : (endTime - sample.firstHub) / 60;
  return {
    jobsPerMin: mins > 0 ? (droneJobs - sample.jobsAtHub) / mins : 0,
    waiting: share('waitingEnergy'),
    napping: share('napping'),
    busy: share('working') + share('travelling'),
    blockedBy: sample.blocked,
    droneSeconds: total,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Tiles restored after the hands-off bot stopped tapping, in both runs (Phase 4 E00.3 definition). */
function handsOffShare(a: BotReport, h: BotReport) {
  const after = (r: BotReport) => {
    const at = h.handsOffAt ?? 0;
    const snap = r.minutesLog.find((m) => m.m * 60 >= at);
    return r.minutesLog[r.minutesLog.length - 1].tiles - (snap?.tiles ?? 0);
  };
  return { handsOff: after(h), active: after(a), share: after(h) / Math.max(1, after(a)) };
}

function parkRun(seed: number, minutes: number, mode: 'active' | 'handsOff') {
  const m = droneSampler();
  let sim: Sim | undefined;
  const r = runBot({
    seed,
    minutes,
    mode,
    onSecond: (s) => {
      sim = s;
      m.onSecond(s);
    },
  });
  return { r, sim: sim!, d: droneSummary(m.sample, sim!.state.stats.droneJobs, sim!.time), sample: m.sample };
}

async function cityRun(seed: number, minutes: number) {
  const { playCity } = await import('./pacing-city.test');
  const m = droneSampler();
  const r = await playCity(seed, 3, minutes, (sim) => {
    const tick = sim.tick.bind(sim);
    let n = 0;
    sim.tick = (...a: Parameters<Sim['tick']>) => {
      tick(...a);
      if (n++ % 10 === 0) m.onSecond(sim);
    };
  });
  return { r, d: droneSummary(m.sample, r.sim.state.stats.droneJobs, r.sim.time), sample: m.sample };
}

/** sha256 of the save with the wall clock fixed (saves stamp it for offline progress). */
async function saveHash(sim: Sim): Promise<string> {
  const saver = new SaveService(undefined);
  saver.now = () => 0;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(saver.serialize(sim.state)));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const GOLDEN = new URL('./fixtures/e18-golden.json', import.meta.url);

describe('E18.0: golden saves (all hubs Restorer must not change a byte)', () => {
  it('park bot (seed 7, 20 min) and city bot (seed 21, 30 min) save exactly as before drone roles', { timeout: 600_000 }, async () => {
    const park = parkRun(7, 20, 'active');
    const city = await cityRun(21, 30);
    const got = {
      park: { seed: 7, minutes: 20, drones: park.sim.state.drones.length, droneJobs: park.sim.state.stats.droneJobs, hash: await saveHash(park.sim) },
      city: { seed: 21, minutes: 30, drones: city.r.sim.state.drones.length, droneJobs: city.r.sim.state.stats.droneJobs, hash: await saveHash(city.r.sim) },
    };
    if (env.E18_GOLDEN === 'write') await writeFile(GOLDEN, JSON.stringify(got, null, 2) + '\n');
    const want = env.E18_GOLDEN === 'write' ? got : golden;
    // The runs must exercise drones, or the comparison proves nothing.
    expect(got.park.droneJobs).toBeGreaterThan(50);
    // Not much higher: city drones sit below the water reserve from about minute 10 to 30 (docs/E18_AUDIT.md).
    expect(got.city.droneJobs).toBeGreaterThan(50);
    expect(got).toEqual(want);
  });
});

describe.runIf(env.E18_REPORT)('E18.0: drone baseline report', () => {
  for (const seed of [7, 21, 99])
    for (const minutes of [15, 30])
      it(`park, active vs hands-off (seed ${seed}, ${minutes} min)`, { timeout: 600_000 }, async () => {
        const a = parkRun(seed, minutes, 'active');
        const h = parkRun(seed, minutes, 'handsOff');
        const share = handsOffShare(a.r, h.r);
        const row = (name: string, x: ReturnType<typeof parkRun>) =>
          `  ${name.padEnd(9)} hub ${mmss(x.sample.firstHub)} · jobs/min ${x.d.jobsPerMin.toFixed(1)} · waitingEnergy ${pct(x.d.waiting)} · napping ${pct(x.d.napping)} · busy ${pct(x.d.busy)} · short ⚡${x.d.blockedBy.energy}/💧${x.d.blockedBy.water} · ` +
          `10 full-bloom ${mmss(x.sample.full10)} · full-bloom goal ${mmss(x.sample.fullGoal)} · fountain ${mmss(x.r.fountain)} · tiles ${x.r.tilesRestored}`;
        // eslint-disable-next-line no-console
        console.log(
          `E18.0 park seed ${seed}, ${minutes} min: hands-off from ${mmss(h.r.handsOffAt)}, tiles after that ${share.handsOff} vs active ${share.active} = ${pct(share.share)}\n` +
            `${row('active', a)}\n${row('hands-off', h)}`,
        );
        if (env.E18_JSON) await writeFile(`${env.E18_JSON}/park-${seed}-${minutes}.json`, JSON.stringify({ seed, minutes, share, active: { ...a.d, ...a.sample, fountain: a.r.fountain }, handsOff: { ...h.d, ...h.sample, fountain: h.r.fountain, handsOffAt: h.r.handsOffAt } }, null, 2));
        expect(a.r.tilesRestored).toBeGreaterThan(0);
      });

  for (const seed of [7, 21])
    it(`city, 60 min (seed ${seed})`, { timeout: 900_000 }, async () => {
      const c = await cityRun(seed, 60);
      const after = c.r.clears.length ? (60 * 60 - (c.r.fountain ?? 0)) / 3600 : 0;
      const perHour = after > 0 ? c.r.clears.length / after : 0;
      const big = c.r.sim.state.stats.bigChains ?? { player: 0, auto: 0 };
      // eslint-disable-next-line no-console
      console.log(
        `E18.0 city seed ${seed}, 60 min: fountain ${mmss(c.r.fountain)} · ${c.r.clears.length} areas (${perHour.toFixed(1)}/h after the fountain) · first ${mmss(c.r.clears[0])} · ` +
          `hubs ${c.r.sim.state.machines.filter((m) => m.type === 'droneHub').length} · drones ${c.r.sim.state.drones.length} · jobs/min ${c.d.jobsPerMin.toFixed(1)} · waitingEnergy ${pct(c.d.waiting)} · ` +
          `napping ${pct(c.d.napping)} · busy ${pct(c.d.busy)} · short ⚡${c.d.blockedBy.energy}/💧${c.d.blockedBy.water} · full-bloom goal ${mmss(c.sample.fullGoal)} · big chains you ${big.player} / auto ${big.auto} · stuck ${Math.round(c.r.stuck)}s`,
      );
      if (env.E18_JSON) await writeFile(`${env.E18_JSON}/city-${seed}.json`, JSON.stringify({ seed, fountain: c.r.fountain, clears: c.r.clears, perHour, ...c.d, ...c.sample, big }, null, 2));
      expect(c.r.clears.length).toBeGreaterThan(0);
      expect(c.r.clears.every((t) => t > 0)).toBe(true);
    });
});

/**
 * E18.7: when drone upgrades are bought (park bot, active and hands-off, 30 min). Run on two builds to compare:
 * `E18_UPGRADES=1 npx vitest run --mode full tests/e18-baseline.test.ts -t timeline`.
 */
const DRONE_UPGRADES = ['droneSpeed', 'droneRadius', 'droneSweep', 'secondDrone', 'chainIntel', 'droneMesh'];
describe.runIf(env.E18_UPGRADES)('E18.7: drone upgrade timeline', () => {
  // One test per seed and mode: a long synchronous run starves the Vitest worker's RPC.
  for (const seed of [7, 21, 99])
    for (const mode of ['active', 'handsOff'] as const)
      it(`timeline (seed ${seed}, ${mode}, 30 min)`, { timeout: 600_000 }, () => {
        const x = parkRun(seed, 30, mode);
        const first = DRONE_UPGRADES.map((id) => `${id} ${mmss(x.r.upgrades.find((u) => u.id === id)?.t)}`).join(' · ');
        const by = (t: number) => x.r.upgrades.filter((u) => DRONE_UPGRADES.includes(u.id) && u.t <= t).length;
        const all = (t: number) => x.r.upgrades.filter((u) => u.t <= t).length;
        // eslint-disable-next-line no-console
        console.log(
          `E18.7 timeline seed ${seed} ${mode}: drone levels by 5/15/30 min ${by(300)}/${by(900)}/${by(1800)} (all upgrades ${all(300)}/${all(900)}/${all(1800)}) · tiles ${x.r.tilesRestored} · ` +
            `jobs/min ${x.d.jobsPerMin.toFixed(1)} · waiting ${pct(x.d.waiting)} · fountain ${mmss(x.r.fountain)} · machines ${x.r.machines.length}\n    first: ${first}`,
        );
      });
});
