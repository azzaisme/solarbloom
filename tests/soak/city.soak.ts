import { big, toNum } from '../../src/core/Big';
/**
 * City 15.1: headless soak. Generates and simulates a 1,000-area city over 6 hours of game time and fails on
 * any violation: memory, save size, tick time, determinism, unreachable frontiers or stalls.
 * Run with `npm run test:soak`. Set SOAK_AREAS / SOAK_HOURS to shorten it locally.
 */
import { meetSpecialty } from '../city-helpers';
import { describe, expect, it } from 'vitest';
import { SaveService } from '../../src/app/SaveService';

// Saves stamp the wall clock (Phase 4 offline progress); fix it so saves compare byte for byte.
SaveService.clock = () => 0;
import { PARK } from '../../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../../src/core/GameState';
import type { MachineData, MachineType } from '../../src/core/types';
import { TUNING } from '../../src/data/tuning';
import { Sim } from '../../src/gameplay/Sim';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const AREAS = Number(env.SOAK_AREAS ?? 1000);
const HOURS = Number(env.SOAK_HOURS ?? 6);

/** Limits. Each one is a test failure when crossed. */
const LIMITS = {
  heapMB: 900, // JS heap after the run (generous: the whole 1,000-area world stays loaded headless)
  saveMB: 6, // compressed save stored
  tickMeanMs: 3, // mean cost of one sim tick
  tickP99Ms: 25, // 99th percentile tick
  tickWorstMs: 120, // any single tick (catches O(world) work hiding behind an event)
  saveMs: 400, // serialize + compress at the end
  stallSec: 0, // game seconds with no next goal at all
};

const saver = new SaveService(undefined);
const log = (s: string) => console.log(`  🧪 ${s}`); // eslint-disable-line no-console
const heapMB = () => ((globalThis as { process?: { memoryUsage(): { heapUsed: number } } }).process?.memoryUsage().heapUsed ?? 0) / 1048576;

function insert(sim: Sim, type: MachineType, x: number, z: number) {
  const t = sim.grid.get(GROUND, x, z);
  if (!t || t.blocked || t.occupantId || sim.isCoreTile(t)) return;
  const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  t.occupantId = m.id;
  sim.production.markNear(GROUND, x, z);
}

/** A deterministic "very fast player": clears the next goal (or a random frontier), builds a little, finds cats. */
async function play(seed: number, areas: number, hours: number, check: boolean) {
  const sim = new Sim(createInitialState(seed));
  const st = sim.state;
  st.caps.energy = big(1e9); st.caps.water = big(1e9);
  st.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  const ticks: number[] = [];
  const slow: string[] = [];
  let n = 0;
  const total = hours * 3600;
  const perArea = total / areas;
  const step = TUNING.simStep;
  let cleared = 1;
  let stall = 0;
  let unreachable = 0;
  const revealedNow: string[] = [];
  sim.bus.on('area.revealed', ({ areaId }) => revealedNow.push(areaId));
  while (sim.time < total) {
    // Clear one area per slot of game time.
    if (cleared < areas && sim.time >= cleared * perArea) {
      const goal = sim.areas.nextGoal();
      const frontier = sim.areas.revealed().filter((id) => sim.areas.fog(id) !== 'cleared');
      if (!goal || !frontier.length) stall += perArea;
      else {
        const id = cleared % 3 === 0 ? frontier[Math.floor(sim.rng.next() * frontier.length)] : goal;
        const tiles = sim.areas.tiles(id).filter((t) => isRestorable(t, st.machines) && t.ground !== 'restored');
        for (const t of tiles.slice(0, sim.areas.need(id) - sim.areas.counts(id).restored + 1)) {
          t.ground = 'restored';
          t.bloom = 1;
          t.pollution = 0;
          sim.grid.touch(t);
        }
        meetSpecialty(sim, id);
        if (sim.areas.clear(id)) {
          cleared++;
          // A little building in the new area: a garden or two, a solar panel, sometimes a drone hub.
          const spots = sim.areas.tiles(id).filter((t) => !t.blocked && !t.occupantId && t.ground === 'restored');
          const pick = () => spots[Math.floor(sim.rng.next() * spots.length)];
          for (const type of ['pollinator', 'solar', cleared % 4 === 0 ? 'pollinator' : 'solar', cleared % 25 === 0 ? 'droneHub' : 'solar'] as MachineType[]) {
            const t = pick();
            if (t) insert(sim, type, t.x, t.z);
          }
          if (check) for (const r of revealedNow) if (!sim.areas.entryTiles(r).length) unreachable++;
          revealedNow.length = 0;
        }
      }
    }
    // Some taps: a pulse near the frontier keeps chains running.
    if (Math.floor(sim.time / step) % 40 === 0) {
      const goal = sim.areas.nextGoal();
      const t = goal ? sim.areas.entryTiles(goal)[0] : undefined;
      if (t) {
        st.resources.energy = big(1e5); st.resources.water = big(1e5);
        sim.restoration.pulse(t.id);
      }
    }
    if (st.cat.active && sim.time - st.cat.active.spawnedAt > 20) sim.cat.claim();
    const t0 = performance.now();
    if (env.SOAK_PROFILE && check) {
      const parts: [string, () => void][] = [
        ['prod', () => sim.production.tick(step)],
        ['rest', () => sim.restoration.tick(step)],
        ['chains', () => sim.chains.tick()],
        ['drones', () => sim.drones.tick(step)],
        ['cat', () => sim.cat.tick()],
        ['prog', () => sim.progression.tick()],
        ['metrics', () => sim.metrics.tick(step)],
      ];
      st.time += step;
      st.buffs = st.buffs.filter((b) => b.until > st.time);
      const prof: string[] = [];
      for (const [k, fn] of parts) {
        const a = performance.now();
        fn();
        const d = performance.now() - a;
        if (d > 5) prof.push(`${k}:${d.toFixed(0)}`);
      }
      st.rngState = sim.rng.state;
      if (prof.length) slow.push(`${sim.time.toFixed(0)}:`), slow.push(prof.join(','));
    } else sim.tick(step);
    const dt = performance.now() - t0;
    if (check) {
      ticks.push(dt);
      if (dt > 50) slow.push(`${dt.toFixed(0)}ms@${sim.time.toFixed(0)}s chains=${sim.chains.activeRuns} pending=${sim.chains.pendingSteps}`);
    }
    // Yield now and then so the test runner's worker stays responsive.
    if (++n % 5000 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { sim, ticks, cleared, stall, unreachable, slow };
}

describe('soak: the endless city (City 15.1)', () => {
  it(`${AREAS} areas over ${HOURS} h of game time stay within limits`, { timeout: 30 * 60_000 }, async () => {
    const heap0 = heapMB();
    const t0 = performance.now();
    const { sim, ticks, cleared, stall, unreachable, slow } = await play(31, AREAS, HOURS, true);
    const wall = (performance.now() - t0) / 1000;
    ticks.sort((a, b) => a - b);
    const mean = ticks.reduce((a, b) => a + b, 0) / ticks.length;
    const p99 = ticks[Math.floor(ticks.length * 0.99)];
    const worst = ticks[ticks.length - 1];
    const s0 = performance.now();
    const stored = await saver.serializeCompressed(sim.state);
    const saveMs = performance.now() - s0;
    const saveMB = stored.length / 1048576;
    const heap = heapMB();
    log(`${cleared} areas cleared in ${(sim.time / 3600).toFixed(1)} h game time (${wall.toFixed(0)} s wall)`);
    log(`tiles loaded ${sim.grid.loadedChunks().length * 256} · machines ${sim.state.machines.length} · drones ${sim.state.drones.length}`);
    log(`tick mean ${mean.toFixed(3)} ms · p99 ${p99.toFixed(2)} ms · worst ${worst.toFixed(1)} ms`);
    log(`save ${saveMB.toFixed(2)} MB in ${saveMs.toFixed(0)} ms · heap ${heap.toFixed(0)} MB (start ${heap0.toFixed(0)} MB)`);
    if (slow.length) log(`slow ticks: ${slow.slice(-30).join(' · ')}`);
    log(`stalls ${stall.toFixed(0)} s · unreachable frontiers ${unreachable}`);
    expect(cleared).toBe(AREAS);
    expect(stall).toBeLessThanOrEqual(LIMITS.stallSec);
    expect(unreachable).toBe(0);
    expect(mean).toBeLessThan(LIMITS.tickMeanMs);
    expect(p99).toBeLessThan(LIMITS.tickP99Ms);
    expect(worst).toBeLessThan(LIMITS.tickWorstMs);
    // Incremental production bookkeeping agrees with a full re-sum.
    const live = toNum(sim.production.rates().biomass);
    sim.production.markDirty();
    expect(toNum(sim.production.rates().biomass)).toBeCloseTo(live, 3);
    expect(saveMB).toBeLessThan(LIMITS.saveMB);
    expect(saveMs).toBeLessThan(LIMITS.saveMs);
    expect(heap).toBeLessThan(LIMITS.heapMB);
    // Every revealed area still has a way in at the end.
    for (const id of sim.areas.revealed()) if (sim.areas.fog(id) !== 'cleared') expect(sim.areas.entryTiles(id).length, id).toBeGreaterThan(0);
    // The save round-trips exactly.
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(await SaveService.decode(stored))!);
    expect(saver.serialize(back.state)).toBe(json);
    // Look 6 (#180): mid-transition, too: every kind of transition on a few hundred tiles survives a save and load.
    const kinds = ['soften', 'moss', 'restore', 'bloom', 'unblock'] as const;
    let n = 0;
    for (const c of sim.grid.loadedChunks())
      for (const t of c.tiles) if (t && !t.blocked && n < 300) sim.transitions.begin(t, kinds[n % 5], 4 + (n++ % 7), { from: 50, dir: n % 5, g: n % 9 === 0 });
    sim.advance(1);
    const mid = saver.serialize(sim.state);
    const again = new Sim(saver.deserialize(mid)!);
    for (const c of again.grid.loadedChunks()) void c;
    expect(saver.serialize(again.state)).toBe(mid);
    log(`mid-transition save: ${sim.transitions.liveCount} tiles mid-transition round-trip exactly`);
  });

  it('is deterministic: the same seed plays out to the same save', { timeout: 10 * 60_000 }, async () => {
    const a = await play(5, Math.min(AREAS, 60), Math.min(HOURS, 0.5), false);
    const b = await play(5, Math.min(AREAS, 60), Math.min(HOURS, 0.5), false);
    expect(a.cleared).toBe(b.cleared);
    expect(saver.serialize(b.sim.state)).toBe(saver.serialize(a.sim.state));
  });
});
