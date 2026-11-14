import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { Sim } from '../src/gameplay/Sim';
import { LINK_BY_ID } from '../src/data/rooftops';
import { TUNING } from '../src/data/tuning';
import { LINK_BY_ID as LINKS_BY_ID } from '../src/data/rooftops';
import { awakenSeed, ground, makeSim, MILESTONES, rich } from './helpers';

const saver = new SaveService(undefined);

describe('first expansion: the Skybridge Relay', () => {
  it('cannot be built before the Seed Core wakes, then builds exactly once and charges once', () => {
    const sim = makeSim();
    rich(sim);
    expect(sim.hood.linkStatus('seed-reservoir').ok).toBe(false);
    expect(sim.hood.buildLink('seed-reservoir')).toBe(false);
    awakenSeed(sim);
    const before = { ...sim.state.resources };
    expect(sim.hood.buildLink('seed-reservoir')).toBe(true);
    const cost = LINK_BY_ID['seed-reservoir'].cost;
    expect(sim.state.resources.biomass).toBeCloseTo(before.biomass - cost.biomass);
    expect(sim.state.resources.energy).toBeCloseTo(before.energy - cost.energy);
    expect(sim.hood.buildLink('seed-reservoir')).toBe(false);
    expect(sim.state.resources.biomass).toBeCloseTo(before.biomass - cost.biomass);
    expect(sim.grid.isPlayable('r2')).toBe(true);
    expect(sim.grid.isPlayable('r3')).toBe(false);
  });

  it('also needs a visible milestone: Seed tiles grown to full bloom', () => {
    const l = LINKS_BY_ID['seed-reservoir'];
    l.requiresFullBloom = MILESTONES['seed-reservoir'];
    try {
      const sim = makeSim();
      rich(sim);
      awakenSeed(sim);
      const need = sim.hood.bloomMilestone('seed-reservoir')!.need;
      const st = sim.hood.linkStatus('seed-reservoir');
      expect(st.ok).toBe(false);
      expect(st.reason).toMatch(/full bloom/);
      expect(sim.hood.objective().roofId).toBe('r1'); // the objective points at the Seed until it's done
      let n = 0;
      for (const t of sim.grid.tilesOf('r1')) if (!t.blocked && !t.occupantId && n++ < need) {
        ground(sim, 'r1', t.x, t.z, 'restored');
        t.bloom = 3;
      }
      expect(sim.hood.linkStatus('seed-reservoir').ok).toBe(true);
      expect(sim.hood.objective().roofId).toBe('r2');
    } finally {
      delete l.requiresFullBloom;
    }
  });

  it('opens the Reservoir for restoration, building and production without touching the Seed', () => {
    const sim = makeSim();
    rich(sim);
    awakenSeed(sim);
    const seedBefore = JSON.stringify(sim.grid.tilesOf('r1'));
    sim.state.upgrades.seedVault = 3;
    sim.state.caps.biomass = TUNING.start.caps.biomass * 2.5;
    sim.state.resources.biomass = 250;
    const capBefore = sim.state.caps.biomass;
    sim.hood.buildLink('seed-reservoir');
    expect(sim.state.caps.biomass).toBeGreaterThan(capBefore); // a new roof brings storage
    rich(sim);
    const t = sim.grid.get('r2', 2, 4)!;
    expect(sim.restoration.pulse(t.id)).toBe(true);
    sim.advance(2);
    expect(t.ground).toBe('restored');
    expect(sim.progression.restoredCount('r2')).toBeGreaterThanOrEqual(1);
    ground(sim, 'r2', 3, 5, 'restored');
    expect(sim.build.place('condenser', 'r2', 3, 5)).toBeTruthy();
    // the Seed's tiles changed only by time passing (no restoration there)
    expect(JSON.parse(seedBefore).map((x: { ground: string }) => x.ground)).toEqual(sim.grid.tilesOf('r1').map((x) => x.ground));
    // Reservoir Gardens only grow on the Reservoir
    ground(sim, 'r1', 5, 5, 'restored');
    expect(sim.build.check('reservoirGarden', 'r1', 5, 5).ok).toBe(false);
    ground(sim, 'r2', 4, 5, 'restored');
    expect(sim.build.check('reservoirGarden', 'r2', 4, 5).spotOk).toBe(true);
  });

  it('a drone hub on the Reservoir only works Reservoir tiles', () => {
    const sim = makeSim();
    rich(sim);
    awakenSeed(sim);
    sim.hood.buildLink('seed-reservoir');
    ground(sim, 'r2', 3, 3, 'restored');
    ground(sim, 'r2', 4, 3, 'restored');
    ground(sim, 'r2', 3, 4, 'restored');
    ground(sim, 'r2', 4, 4, 'restored');
    const hub = sim.build.place('droneHub', 'r2', 3, 3)!;
    expect(hub).toBeTruthy();
    const worked = new Set<string>();
    sim.bus.on('drone.jobStarted', ({ tileId }) => worked.add(tileId));
    sim.advance(40);
    expect(worked.size).toBeGreaterThan(2);
    for (const id of worked) expect(id.startsWith('r2:')).toBe(true);
  });

  it('survives save/load: the link stays built and is never charged again', () => {
    const sim = makeSim();
    rich(sim);
    awakenSeed(sim);
    sim.hood.buildLink('seed-reservoir');
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.grid.isPlayable('r2')).toBe(true);
    expect(copy.hood.isBuilt('seed-reservoir')).toBe(true);
    const b = copy.state.resources.biomass;
    expect(copy.hood.buildLink('seed-reservoir')).toBe(false);
    expect(copy.state.resources.biomass).toBe(b);
  });

  it('the objective walks through bridge → Cistern → bridge → Elder Tree → Bloom', () => {
    const sim = makeSim();
    rich(sim);
    awakenSeed(sim);
    expect(sim.hood.objective().step).toBe('link1');
    sim.hood.buildLink('seed-reservoir');
    expect(sim.hood.objective().step).toBe('core2');
    expect(sim.hood.activateRoofCore('r2')).toBe(false); // requirements not met
    expect(sim.hood.linkStatus('seed-canopy').ok).toBe(false);
    // Meet the Reservoir requirements directly.
    const r2 = sim.grid.roof('r2')!;
    let n = 0;
    for (const t of sim.grid.tilesOf(r2.id)) if (!t.blocked && !t.occupantId && n++ < TUNING.neighbourhood.cores.r2.restoredTiles) ground(sim, 'r2', t.x, t.z, 'restored');
    ground(sim, 'r2', 1, 4, 'restored');
    sim.build.place('reservoirGarden', 'r2', 1, 4);
    sim.state.progression.overflows = TUNING.neighbourhood.cores.r2.overflows;
    expect(sim.hood.coreReady('r2')).toBe(true);
    expect(sim.hood.activateRoofCore('r2')).toBe(true);
    expect(sim.hood.activateRoofCore('r2')).toBe(false);
    expect(sim.hood.objective().step).toBe('link2');
    expect(sim.hood.buildLink('seed-canopy')).toBe(true);
    expect(sim.hood.objective().step).toBe('core3');
    expect(sim.production.rates().water).toBeGreaterThan(TUNING.rainBarrelRate + TUNING.neighbourhood.reservoir.cisternWater - 1e-9);
  });
});

describe('the Neighbourhood Bloom', () => {
  const ready = () => {
    const sim = makeSim(17);
    rich(sim);
    awakenSeed(sim);
    sim.hood.buildLink('seed-reservoir');
    sim.state.progression.cores.r2 = true;
    sim.hood.buildLink('seed-canopy');
    return sim;
  };

  it('is only available once all three Cores are awake and both bridges are built', () => {
    const sim = ready();
    expect(sim.hood.bloomReady()).toBe(false);
    expect(sim.hood.neighbourhoodBloom()).toBe(false);
    sim.state.progression.cores.r3 = true;
    expect(sim.hood.bloomReady()).toBe(true);
    expect(sim.hood.objective().step).toBe('bloom');
  });

  it('fires once, pays once (even across a reload), and never touches the player’s machines', () => {
    const sim = ready();
    sim.state.progression.cores.r3 = true;
    ground(sim, 'r2', 3, 3, 'restored');
    sim.build.place('pollinator', 'r2', 3, 3);
    ground(sim, 'r1', 5, 5, 'restored');
    sim.build.place('solar', 'r1', 5, 5);
    const machines = JSON.stringify(sim.state.machines.map((m) => [m.id, m.type, m.roofId, m.x, m.z]));
    sim.state.resources.biomass = 0;
    let fired = 0;
    sim.bus.on('neighbourhood.bloom', () => fired++);
    expect(sim.hood.neighbourhoodBloom()).toBe(true);
    const got = sim.state.resources.biomass;
    expect(got).toBeGreaterThan(0);
    expect(sim.hood.neighbourhoodBloom()).toBe(false);
    expect(sim.state.resources.biomass).toBe(got);
    expect(fired).toBe(1);
    expect(JSON.stringify(sim.state.machines.map((m) => [m.id, m.type, m.roofId, m.x, m.z]))).toBe(machines);
    for (const r of sim.grid.rooftops)
      for (const t of sim.grid.tilesOf(r.id)) {
        if (t.blocked || t.occupantId) continue; // ground under machines is left exactly as the player built it
        expect(t.ground).toBe('restored');
      }
    expect(sim.hood.objective().step).toBe('done');
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.hood.bloomReady()).toBe(false);
    expect(copy.hood.neighbourhoodBloom()).toBe(false);
    expect(copy.state.resources.biomass).toBe(got);
    expect(copy.state.caps.biomass).toBeGreaterThanOrEqual(sim.state.caps.biomass);
  });
});
