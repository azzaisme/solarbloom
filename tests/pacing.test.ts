import { describe, expect, it } from 'vitest';
import { distToFootprint } from '../src/core/Grid';
import { createInitialState, GROUND } from '../src/core/GameState';
import { HOME } from '../src/gameplay/ProgressionSystem';
import type { BuildableType, TileData } from '../src/core/types';
import { MACHINES } from '../src/data/machines';
import { Sim } from '../src/gameplay/Sim';

/**
 * A scripted "reasonable player": one action every few seconds, builds machines next to each
 * other, aims pulses at synergy tiles, buys upgrades when nothing better is pending.
 * It is a pacing guard, not a balance oracle: real players are slower and less optimal.
 */
export function playSession(seed: number, actionEvery = 3, minutes = 20) {
  const sim = new Sim(createInitialState(seed));
  const layer = GROUND;
  sim.cat.anchorView = () => 'offscreen';
  const order: BuildableType[] = ['solar', 'condenser', 'pollinator', 'droneHub', 'pollinator', 'motherTree', 'solar', 'pollinator'];
  const built: Record<string, number> = {};
  let next = 0;
  const tiles = () => sim.progression.tilesFor(HOME);
  const synergy = (t: TileData) =>
    sim.state.machines.reduce((a, m) => {
      const d = distToFootprint(t.x, t.z, m.x, m.z, m.size);
      if (m.type === 'pollinator' && d === 1) return a + 3;
      if (m.type === 'motherTree' && d >= 1 && d <= sim.upgrades.treeRadius(m)) return a + 2;
      if (m.type === 'solar' && d === 1) return a + 1;
      return a;
    }, 0);
  const steps = Math.round((minutes * 60) / 0.1);
  for (let i = 0; i < steps && !sim.state.progression.coreActivated; i++) {
    if (i % Math.round(actionEvery / 0.1) === 0) {
      // 1. build the next machine if affordable, next to existing ones
      const want = order[next];
      if (want) {
        const counts = sim.state.machines.filter((m) => m.type === want && !m.starter).length;
        if (counts > (built[want] ?? 0)) {
          built[want] = counts;
          next++;
        } else if (sim.build.isUnlocked(want) && sim.econ.canAfford(sim.build.cost(want))) {
          const size = MACHINES[want].size;
          const spots = tiles()
            .filter((t) => sim.build.check(want, layer, t.x, t.z).ok)
            .sort((a, b) => synergy(b) - synergy(a) || a.x + a.z - (b.x + b.z));
          if (spots[0] && sim.build.place(want, layer, spots[0].x, spots[0].z)) {
            built[want] = (built[want] ?? 0) + 1;
            next++;
            void size;
          }
        }
      }
      // 2. pulse the most promising tile
      const cands = tiles().filter((t) => sim.restoration.checkPulse(t).ok);
      const rank = (t: TileData) => (t.ground === 'restored' ? 30 : 0) - synergy(t) * 4 + (t.ground === 'prepared' ? 0 : 3);
      cands.sort((a, b) => rank(a) - rank(b) || a.pollution - b.pollution);
      if (cands[0]) sim.restoration.pulse(cands[0].id);
      else if (sim.state.resources.energy.lt(3)) sim.harvestSun();
      if (sim.progression.coreReady()) sim.progression.activateCore();
      // 4. find the cat ~40 s after it appears (players notice it eventually)
      const c = sim.state.cat.active;
      if (c && sim.time - c.spawnedAt > 40) sim.cat.claim();
    }
    sim.tick();
    if (i % 600 === 0 && (globalThis as { PACE_DEBUG?: boolean }).PACE_DEBUG) console.log(`${i / 600}m rates ${JSON.stringify(sim.production.rates())} restored ${sim.progression.restoredCount(HOME)}`);
  }
  const st = sim.state.stats;
  return {
    firsts: st.firsts,
    core: sim.state.progression.coreActivated ? Math.round(sim.time) : -1,
    stuck: Math.round(st.stuckSeconds),
    maxCombo: st.maxCombo,
    avgChain: st.chains ? Math.round((st.chainEffects / st.chains) * 10) / 10 : 0,
  };
}

describe('pacing in the city park (scripted player)', () => {
  it('hits the Round 2 beats in the park and wakes the fountain without long dead time', () => {
    for (const seed of [7, 21, 99]) {
      const r = playSession(seed, 3, 25);
      const fmt = (s?: number) => (s === undefined ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      // eslint-disable-next-line no-console
      console.log(
        `park seed ${seed}: upgrade ${fmt(r.firsts.upgrade)} condenser ${fmt(r.firsts.condenser)} garden ${fmt(r.firsts.pollinator)} cat ${fmt(r.firsts.cat)} drone ${fmt(r.firsts.droneHub)} tree ${fmt(r.firsts.motherTree)} fountain ${fmt(r.core)} | stuck ${r.stuck}s maxCombo ${r.maxCombo}`,
      );
      expect(r.core).toBeGreaterThan(0);
      expect(r.core).toBeLessThan(10 * 60); // the Round 2 window for the bot (people take about twice as long)
      expect(r.core).toBeGreaterThan(3 * 60); // Phase 4: a fast first climax by choice (people take ~1.5–2× the bot)
      expect(r.firsts.condenser).toBeLessThan(3 * 60);
      expect(r.firsts.cat).toBeDefined();
      expect(r.stuck).toBeLessThan(90);
    }
  });
});
