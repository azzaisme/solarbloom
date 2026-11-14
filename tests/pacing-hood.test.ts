import { describe, expect, it } from 'vitest';
import { distToFootprint } from '../src/core/Grid';
import { createInitialState } from '../src/core/GameState';
import type { BuildableType, TileData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

type Style = 'solar' | 'water';

/** Machines a scripted player builds on each rooftop, by play style. */
const PLAN: Record<Style, Record<string, BuildableType[]>> = {
  // Solar + drone: reliable passive throughput, fast clearing, frequent small chains.
  solar: {
    r1: ['solar', 'condenser', 'pollinator', 'droneHub', 'pollinator', 'motherTree', 'solar', 'solar'],
    r2: ['solar', 'droneHub', 'condenser', 'reservoirGarden', 'solar'],
    r3: ['solar', 'droneHub', 'solar', 'pollinator'],
  },
  // Water + pollinator: slower build-up, bigger bursts.
  water: {
    r1: ['solar', 'condenser', 'pollinator', 'droneHub', 'pollinator', 'motherTree', 'pollinator', 'condenser'],
    r2: ['condenser', 'reservoirGarden', 'condenser', 'pollinator', 'reservoirGarden'],
    r3: ['pollinator', 'pollinator', 'condenser', 'pollinator'],
  },
};

/**
 * A scripted "reasonable player" for the whole neighbourhood: one action every few seconds, works the
 * rooftop the objective points at, builds its style's machines next to synergy spots, builds bridges
 * and wakes Cores as soon as it can, and finds the Lucky Cat ~40 s after it appears.
 * A pacing guard, not a balance oracle: people are roughly 2× slower and less optimal.
 */
export function playNeighbourhood(seed: number, style: Style, actionEvery = 3, minutes = 75) {
  const sim = new Sim(createInitialState(seed));
  sim.cat.anchorView = () => 'visible';
  const done: Record<string, number> = {};
  const synergy = (t: TileData) =>
    sim.state.machines.reduce((a, m) => {
      if (m.roofId !== t.roofId) return a;
      const d = distToFootprint(t.x, t.z, m.x, m.z, m.size);
      if (d < 1) return a;
      if (m.type === 'pollinator' && d === 1) return a + 3;
      if (m.type === 'motherTree' && d <= sim.upgrades.treeRadius) return a + 2;
      if (m.type === 'core' && m.roofId === 'r3' && d <= TUNING.neighbourhood.canopy.chargeRadius) return a + 2;
      if (m.type === 'reservoirGarden' && d <= TUNING.neighbourhood.reservoir.radius) return a + 1;
      if (m.type === 'solar' && d === 1) return a + 1;
      return a;
    }, 0);
  const spotScore = (type: BuildableType, t: TileData) => {
    let v = synergy(t);
    for (const m of sim.state.machines) {
      if (m.roofId !== t.roofId) continue;
      const d = distToFootprint(t.x, t.z, m.x, m.z, m.size);
      if (type === 'reservoirGarden' && m.type === 'condenser' && d <= TUNING.neighbourhood.reservoir.condenserRange) v += 6;
      if (type === 'condenser' && m.type === 'reservoirGarden' && d <= TUNING.neighbourhood.reservoir.condenserRange) v += 6;
      if (type === 'pollinator' && m.type === 'core' && m.roofId === 'r3' && d <= sim.chains.canopyBurstRadius()) v += 5;
    }
    return v;
  };
  const activeRoof = () => (sim.state.progression.coreActivated ? sim.hood.objective().roofId : 'r1');
  let goalCost = 0;
  const steps = Math.round((minutes * 60) / 0.1);
  for (let i = 0; i < steps && sim.state.progression.neighbourhoodBloomAt < 0; i++) {
    if (i % Math.round(actionEvery / 0.1) === 0) {
      const roofId = sim.grid.isPlayable(activeRoof()) ? activeRoof() : 'r1';
      const roof = sim.grid.roof(roofId)!;
      // 1. the big goals first
      if (sim.progression.coreReady()) sim.progression.activateCore();
      const o = sim.state.progression.coreActivated ? sim.hood.objective() : undefined;
      goalCost = 0;
      if (o?.action?.kind === 'link') {
        if (!sim.hood.buildLink(o.action.id)) goalCost = sim.hood.linkCost(o.action.id).biomass ?? 0;
      } else if (o?.action?.kind === 'core') sim.hood.activateRoofCore(o.action.id);
      else if (o?.action?.kind === 'bloom') sim.hood.neighbourhoodBloom();
      // 2. this roof's next machine
      const plan = PLAN[style][roofId] ?? [];
      const have = (t: BuildableType) => sim.state.machines.filter((m) => m.type === t && m.roofId === roofId && !m.starter).length;
      const want = plan.find((t, k) => have(t) < plan.slice(0, k + 1).filter((x) => x === t).length);
      if (want && sim.build.isUnlocked(want)) {
        const cost = sim.build.cost(want);
        if (sim.econ.canAfford(cost)) {
          const spots = sim.grid.tilesOf(roof.id).filter((t) => sim.build.check(want, roofId, t.x, t.z).ok).sort((a, b) => spotScore(want, b) - spotScore(want, a) || a.x + a.z - (b.x + b.z));
          if (spots[0]) sim.build.place(want, roofId, spots[0].x, spots[0].z);
        } else goalCost = Math.max(goalCost, cost.biomass ?? 0);
      }
      // 3. pulse the most promising tile (the active roof first, then anywhere playable)
      const pool = sim.grid.rooftops.filter((r) => sim.grid.isPlayable(r.id)).flatMap((r) => sim.grid.tilesOf(r.id));
      const cands = pool.filter((t) => sim.restoration.checkPulse(t).ok);
      const rank = (t: TileData) => (t.roofId === roofId ? 0 : 20) + (t.ground === 'restored' ? 30 : 0) - synergy(t) * 4 + (t.ground === 'prepared' ? 0 : 3);
      cands.sort((a, b) => rank(a) - rank(b) || a.pollution - b.pollution);
      if (cands[0]) sim.restoration.pulse(cands[0].id);
      else if (sim.state.resources.energy < 3) sim.harvestSun();
      // 4. upgrades (Seed Vault first when the next goal doesn't fit in storage)
      if (goalCost > sim.econ.cap('biomass')) {
        const v = sim.upgrades.all().find((u) => u.id === 'seedVault')!;
        if (sim.upgrades.status(v).ok) sim.upgrades.purchase('seedVault');
      }
      for (const u of sim.upgrades.all()) {
        const st = sim.upgrades.status(u);
        if (st.ok && sim.state.resources.biomass - st.cost >= Math.min(goalCost, sim.state.caps.biomass * 0.6)) sim.upgrades.purchase(u.id);
      }
      const c = sim.state.cat.active;
      if (c && sim.time - c.spawnedAt > 40) sim.cat.claim();
    }
    sim.tick();
  }
  const f = sim.state.stats.firsts;
  for (const k of Object.keys(f)) done[k] = f[k];
  return { firsts: done, bloom: sim.state.progression.neighbourhoodBloomAt, stuck: Math.round(sim.state.stats.stuckSeconds), maxCombo: sim.state.stats.maxCombo, sim };
}

const fmt = (s?: number) => (s === undefined || s < 0 ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

describe('pacing across the neighbourhood (scripted player)', () => {
  for (const style of ['solar', 'water'] as const) {
    it(`a ${style} build reaches every Phase 3 beat and the Neighbourhood Bloom without dead time`, () => {
      for (const seed of [7, 21]) {
        const r = playNeighbourhood(seed, style);
        const f = r.firsts;
        // eslint-disable-next-line no-console
        console.log(
          `${style} seed ${seed}: core ${fmt(f.core)} skybridge ${fmt(f['bridge:seed-reservoir'])} cross-roof ${fmt(f.remoteChain)} cistern ${fmt(f['core:r2'])} canopy bridge ${fmt(f['bridge:seed-canopy'])} elder ${fmt(f['core:r3'])} bloom ${fmt(r.bloom)} | stuck ${r.stuck}s maxCombo ${r.maxCombo}`,
        );
        expect(r.bloom).toBeGreaterThan(0);
        expect(f['bridge:seed-reservoir'] - f.core).toBeLessThan(6 * 60); // first expansion shortly after the Core
        expect(f.remoteChain - f['bridge:seed-reservoir']).toBeLessThan(3 * 60); // the relay is used soon after
        expect(r.bloom - f.core).toBeLessThan(30 * 60);
        expect(r.stuck).toBeLessThan(120);
      }
      // A slower player (one action every 6 s, about how fast people play) still gets there, with no dead time.
      const slow = playNeighbourhood(7, style, 6, 90);
      const g = slow.firsts;
      // eslint-disable-next-line no-console
      console.log(
        `${style} slow: core ${fmt(g.core)} skybridge ${fmt(g['bridge:seed-reservoir'])} cross-roof ${fmt(g.remoteChain)} cistern ${fmt(g['core:r2'])} canopy bridge ${fmt(g['bridge:seed-canopy'])} elder ${fmt(g['core:r3'])} bloom ${fmt(slow.bloom)} | stuck ${slow.stuck}s`,
      );
      expect(slow.bloom).toBeGreaterThan(0);
      expect(slow.stuck).toBeLessThan(120);
    });
  }
});
