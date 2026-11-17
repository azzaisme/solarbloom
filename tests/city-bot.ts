import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { distToFootprint } from '../src/core/Grid';
import type { BuildableType, TileData } from '../src/core/types';
import { HOME } from '../src/gameplay/ProgressionSystem';
import { Sim } from '../src/gameplay/Sim';

/**
 * The endless city, played by a scripted "reasonable player": the park first (machines next to each
 * other, pulses at synergy spots), then area after area: it works the area the objective points at,
 * pulses tiles at the fog's edge, builds a few machines there and wakes each landmark when ready.
 */
export async function playCity(seed: number, actionEvery = 3, minutes = 60, setup?: (sim: Sim) => void) {
  const sim = new Sim(createInitialState(seed));
  setup?.(sim);
  sim.cat.anchorView = () => 'offscreen';
  const parkOrder: BuildableType[] = ['solar', 'condenser', 'pollinator', 'droneHub', 'pollinator', 'motherTree', 'solar', 'pollinator'];
  const areaOrder: BuildableType[] = ['pollinator', 'droneHub', 'solar', 'pollinator'];
  const clears: number[] = [];
  sim.bus.on('area.cleared', ({ areaId }) => areaId !== PARK && clears.push(sim.time));
  const synergy = (t: TileData) =>
    sim.grid.machinesNear(t.roofId, t.x, t.z, 2).reduce((a, m) => {
      const d = distToFootprint(t.x, t.z, m.x, m.z, m.size);
      if (m.type === 'pollinator' && d === 1) return a + 3;
      if (m.type === 'motherTree' && d >= 1 && d <= sim.upgrades.treeRadius(m)) return a + 2;
      if (m.type === 'solar' && d === 1) return a + 1;
      return a;
    }, 0);
  const builtIn = (area: string, type: BuildableType) => sim.state.machines.filter((m) => m.type === type && !m.starter && sim.areas.areaOf(m) === area).length;
  const steps = Math.round((minutes * 60) / 0.1);
  for (let i = 0; i < steps; i++) {
    if (i % Math.round(actionEvery / 0.1) === 0) {
      const inPark = !sim.state.progression.coreActivated;
      const goal = inPark ? PARK : sim.areas.nextGoal();
      if (!inPark && goal && sim.areas.ready(goal)) sim.areas.clear(goal);
      const area = inPark ? PARK : sim.areas.nextGoal();
      const tiles = area ? (inPark ? sim.progression.tilesFor(HOME) : sim.areas.tiles(area)) : [];
      // 0. the landmark's specialty action (City 09.1) comes first: follow the advisor's next step for it
      const sp = !inPark && area ? sim.advisor.specialtyStep(area) : undefined;
      if (sp?.action.kind === 'build') sim.build.place(sp.action.type, GROUND, sp.action.x, sp.action.z);
      if (sp?.action.kind === 'focus') sim.restoration.pulse(sim.grid.get(sp.action.layer ?? GROUND, sp.action.x, sp.action.z)!.id);
      // 1. the next machine for this area, on the best synergy spot that's clear of fog
      const order = inPark ? parkOrder : areaOrder;
      const want = area ? order.find((t, k) => builtIn(area, t) < order.slice(0, k + 1).filter((x) => x === t).length) : undefined;
      // Saving up for the specialty's machine once the restore share is met: no other spending.
      const saving = !!area && sp?.action.kind === 'wait' && sim.areas.counts(area).restored >= sim.areas.need(area);
      if (sp?.action.kind !== 'build' && !saving && want && sim.build.isUnlocked(want) && sim.econ.canAfford(sim.build.cost(want))) {
        const spot = tiles.filter((t) => sim.build.check(want, GROUND, t.x, t.z).ok).sort((a, b) => synergy(b) - synergy(a) || a.x + a.z - (b.x + b.z))[0];
        if (spot) sim.build.place(want, GROUND, spot.x, spot.z);
      }
      // 2. pulse the most promising tile in the area (restore first, nurture in the park)
      const cands = tiles.filter((t) => sim.restoration.checkPulse(t).ok && (inPark || t.ground !== 'restored'));
      const rank = (t: TileData) => (t.ground === 'restored' ? 30 : 0) - synergy(t) * 4 + (t.ground === 'prepared' ? 0 : 3);
      cands.sort((a, b) => rank(a) - rank(b) || a.pollution - b.pollution);
      if (cands[0] && !saving) sim.restoration.pulse(cands[0].id);
      else if (sim.state.resources.energy.lt(3)) sim.harvestSun();
      // 3. upgrades, keeping enough for the next machine
      const nextCost = want ? (sim.build.cost(want).biomass ?? 0) : 0;
      for (const u of sim.upgrades.all()) {
        const st = sim.upgrades.status(u);
        if (st.ok && !saving && sim.state.resources.biomass.sub(st.cost).gte(nextCost)) sim.upgrades.purchase(u.id);
      }
      if (sim.progression.coreReady()) sim.progression.activateCore();
      // Phase 5 E15: every hiding cat (invasion cats too), ~40 s after it appeared.
      for (const c of sim.cat.spots()) if (sim.time - c.spawnedAt > 40) sim.cat.claim(c.id);
    }
    sim.tick();
    // Yield now and then: a long synchronous run starves the Vitest worker's RPC (CI "Timeout calling onTaskUpdate").
    if (i % 3000 === 2999) await new Promise((r) => setTimeout(r, 0));
  }
  return { sim, clears, fountain: sim.state.stats.firsts.core, stuck: sim.state.stats.stuckSeconds, maxCombo: sim.state.stats.maxCombo };
}
