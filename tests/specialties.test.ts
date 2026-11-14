import { describe, expect, it } from 'vitest';
import type { ChainEvent } from '../src/gameplay/BloomChainSystem';
import { Sim } from '../src/gameplay/Sim';
import { TUNING } from '../src/data/tuning';
import { createInitialState } from '../src/core/GameState';
import { distToFootprint } from '../src/core/Grid';
import { awakenSeed, ground, rich } from './helpers';

const N = TUNING.neighbourhood;

function open(seed = 3) {
  const sim = new Sim(createInitialState(seed, { rooftops: true }));
  rich(sim);
  awakenSeed(sim);
  sim.hood.buildLink('seed-reservoir');
  sim.state.progression.cores.r2 = true;
  sim.hood.buildLink('seed-canopy');
  return sim;
}

function events(sim: Sim) {
  const out: ChainEvent[] = [];
  sim.bus.on('chain.event', (e) => out.push(e.event));
  return out;
}

describe('Reservoir Overflow', () => {
  it('condensers fill a Reservoir Garden; a full basin overflows into up to 3 eligible dry tiles, once', () => {
    const sim = open();
    for (const t of sim.grid.tilesOf('r2')) if (!t.occupantId && !t.blocked) ground(sim, 'r2', t.x, t.z, 'restored');
    const c = sim.build.place('condenser', 'r2', 2, 3)!;
    const g = sim.build.place('reservoirGarden', 'r2', 2, 5)!;
    expect(distToFootprint(g.x, g.z, c.x, c.z, c.size)).toBeLessThanOrEqual(N.reservoir.condenserRange);
    ground(sim, 'r2', 1, 5, 'prepared');
    ground(sim, 'r2', 3, 5, 'prepared');
    ground(sim, 'r2', 2, 6, 'polluted');
    ground(sim, 'r2', 4, 5, 'polluted');
    const ev = events(sim);
    let fills = 0;
    sim.bus.on('reservoir.fill', () => fills++);
    sim.advance(TUNING.condenser.threshold * N.reservoir.threshold + 2);
    expect(fills).toBeGreaterThanOrEqual(N.reservoir.threshold);
    const ov = ev.filter((e) => e.type === 'OVERFLOW');
    expect(ov).toHaveLength(1);
    expect(sim.state.progression.overflows).toBe(1);
    const irrigated = ev.filter((e) => e.cause === 'overflow' && e.type === 'RESTORE').map((e) => sim.grid.byTileId(e.target)!);
    expect(irrigated.length).toBe(N.reservoir.targets);
    for (const t of irrigated) {
      expect(t.ground).toBe('restored');
      expect(t.blocked).toBe(false);
      expect(t.occupantId).toBeUndefined();
      expect(distToFootprint(t.x, t.z, g.x, g.z, 1)).toBeLessThanOrEqual(N.reservoir.radius);
      expect(t.lushUntil).toBeGreaterThan(sim.time);
    }
    // mossy soil is irrigated before concrete
    expect(irrigated.slice(0, 2).every((t) => ['r2:1:5', 'r2:3:5'].includes(t.id))).toBe(true);
    expect(g.charge).toBeLessThan(N.reservoir.threshold);
  });

  it('a full basin never stalls: with nothing dry nearby it grows the green tiles, or just splashes', () => {
    const sim = open();
    for (const t of sim.grid.tilesOf('r2')) if (!t.occupantId && !t.blocked) {
      ground(sim, 'r2', t.x, t.z, 'restored');
      t.bloom = 3;
    }
    const g = sim.build.place('reservoirGarden', 'r2', 4, 5)!;
    sim.grid.get('r2', 4, 6)!.bloom = 1; // one green tile that can still grow
    g.charge = N.reservoir.threshold;
    const ev = events(sim);
    sim.advance(3);
    expect(ev.filter((e) => e.type === 'OVERFLOW')).toHaveLength(1);
    expect(ev.filter((e) => e.cause === 'overflow' && e.type === 'GROW').map((e) => e.target)).toEqual(['r2:4:6']);
    expect(sim.state.progression.overflows).toBe(1);
    // Everything in full bloom: it still spills (and counts), freshening the green around it.
    sim.grid.get('r2', 4, 6)!.bloom = 3;
    g.charge = N.reservoir.threshold;
    sim.advance(3);
    expect(ev.filter((e) => e.type === 'OVERFLOW')).toHaveLength(2);
    expect(sim.state.progression.overflows).toBe(2);
    expect(sim.grid.get('r2', 4, 4)!.lushUntil).toBeGreaterThan(sim.time);
  });

  it('lush tiles grow extra biomass, then go back to normal', () => {
    const sim = open();
    const t = ground(sim, 'r2', 3, 6, 'prepared');
    const base = (() => {
      const u = ground(sim, 'r2', 5, 6, 'restored');
      return sim.production.tileBiomassRate(u);
    })();
    sim.restoration.complete(t, 'overflow');
    expect(sim.production.tileBiomassRate(t)).toBeCloseTo(base * N.reservoir.lushMult);
    const r0 = sim.production.rates().biomass;
    sim.advance(N.reservoir.lushSeconds + 1);
    expect(sim.production.tileBiomassRate(t)).toBeCloseTo(base);
    expect(sim.production.rates().biomass).toBeLessThan(r0);
  });
});

describe('Canopy: the Elder Tree', () => {
  it('charges from blooms around it and releases one Canopy Burst, amplified by gardens inside its reach', () => {
    const sim = open();
    const tree = sim.state.machines.find((m) => m.type === 'core' && m.roofId === 'r3')!;
    for (const t of sim.grid.tilesOf('r3')) if (!t.occupantId && !t.blocked) ground(sim, 'r3', t.x, t.z, 'polluted');
    ground(sim, 'r3', 2, 3, 'restored');
    const garden = sim.build.place('pollinator', 'r3', 2, 3)!; // 2 tiles from the trunk: inside the burst
    expect(sim.chains.inCanopyBurst(tree, garden)).toBe(true);
    tree.charge = N.canopy.threshold - 1;
    const ev = events(sim);
    let bursts = 0;
    let amplified = 0;
    sim.bus.on('canopy.burst', (e) => {
      bursts++;
      amplified = e.gardens.length;
    });
    sim.restoration.complete(sim.grid.get('r3', 6, 3)!, 'pulse');
    sim.advance(8);
    expect(bursts).toBe(1);
    expect(amplified).toBe(1);
    expect(sim.state.progression.canopyBursts).toBe(1);
    expect(tree.charge).toBe(0);
    const hit = ev.filter((e) => e.cause === 'canopy' && (e.type === 'RESTORE' || e.type === 'GROW')).map((e) => sim.grid.byTileId(e.target)!);
    const beyond = hit.filter((t) => distToFootprint(t.x, t.z, tree.x, tree.z, tree.size) > sim.chains.canopyBurstRadius());
    expect(beyond.length).toBeGreaterThanOrEqual(1);
    expect(beyond.length).toBeLessThanOrEqual(N.canopy.gardenBonusTargets);
    // never recharges from its own burst in the same chain
    const burstSeq = ev.find((e) => e.type === 'CANOPY_BURST')!.seq;
    expect(ev.filter((e) => e.type === 'CHARGE' && e.target === tree.id && e.seq > burstSeq && e.chainId === ev[0].chainId)).toHaveLength(0);
  });
});

describe('Overcharge Pulse (active play near machines)', () => {
  it('a manual pulse next to a solar panel doubles its next burst, once; drones never boost', () => {
    const sim = open();
    for (const t of sim.grid.tilesOf('r1')) if (!t.occupantId && !t.blocked) ground(sim, 'r1', t.x, t.z, 'prepared');
    ground(sim, 'r1', 5, 5, 'restored');
    const solar = sim.build.place('solar', 'r1', 5, 5)!;
    const ev = events(sim);
    expect(sim.restoration.pulse('r1:5:4')).toBe(true);
    expect(solar.overchargeUntil).toBeGreaterThan(sim.time);
    sim.advance(3);
    const burst = ev.find((e) => e.type === 'PRODUCE_ENERGY' && e.target === solar.id)!;
    expect(burst.amount).toBeCloseTo(TUNING.solarBloomBoost.burstEnergy * sim.upgrades.solarMult * 2);
    expect(solar.overchargeUntil).toBe(0);
    sim.advance(TUNING.solarBloomBoost.seconds);
    sim.restoration.beginGrowth(sim.grid.get('r1', 4, 5)!, 'drone', 0.5);
    sim.advance(3);
    const second = ev.filter((e) => e.type === 'PRODUCE_ENERGY' && e.target === solar.id)[1];
    expect(second.amount).toBeCloseTo(TUNING.solarBloomBoost.burstEnergy * sim.upgrades.solarMult);
  });

  it('a boosted Pollinator Garden pollinates one extra neighbour in its next chain', () => {
    const count = (boost: boolean) => {
      const sim = open(11);
      for (const t of sim.grid.tilesOf('r1')) if (!t.occupantId && !t.blocked) ground(sim, 'r1', t.x, t.z, 'prepared');
      ground(sim, 'r1', 4, 4, 'restored');
      const g = sim.build.place('pollinator', 'r1', 4, 4)!;
      sim.upgrades.purchase('pollinatorReach');
      if (boost) g.overchargeUntil = sim.time + 10;
      const ev = events(sim);
      sim.restoration.complete(sim.grid.get('r1', 4, 3)!, 'pulse');
      sim.advance(4);
      return ev.filter((e) => e.type === 'POLLINATE' && e.source === g.id).length;
    };
    expect(count(true)).toBe(count(false) + 1);
  });
});

describe('Drone Dispatch', () => {
  it('an idle drone flies over the bridge, restores near the far relay, then comes home', () => {
    const sim = open();
    for (const t of sim.grid.tilesOf('r1')) if (!t.occupantId && !t.blocked) {
      ground(sim, 'r1', t.x, t.z, 'restored');
      t.bloom = 3;
    }
    const hub = sim.build.place('droneHub', 'r1', 5, 3)!;
    sim.upgrades.purchase('droneDispatch');
    const worked: string[] = [];
    sim.bus.on('drone.jobStarted', ({ tileId }) => worked.push(tileId));
    let crossed = false;
    for (let i = 0; i < 400; i++) {
      sim.tick();
      if (sim.state.drones.some((d) => d.cross)) crossed = true;
    }
    expect(crossed).toBe(true);
    const remote = worked.filter((id) => !id.startsWith('r1:'));
    expect(remote.length).toBeGreaterThanOrEqual(1);
    for (const id of remote) expect(sim.grid.byTileId(id)!.ground === 'restored' || sim.grid.byTileId(id)!.ground === 'growing').toBe(true);
    // nothing on locked rooftops, ever
    expect(worked.every((id) => sim.grid.isPlayable(id.split(':')[0]))).toBe(true);
    const d = sim.state.drones.find((x) => x.hubId === hub.id)!;
    expect(['r1', 'r2', 'r3']).toContain(sim.drones.roofOf(d));
  });
});
