import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { Sim } from '../src/gameplay/Sim';
import { LINK_BY_ID } from '../src/data/rooftops';
import { TUNING } from '../src/data/tuning';
import { awakenSeed, ground, makeSim, rich } from './helpers';

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

  it('opens the Reservoir for restoration, building and production without touching the Seed', () => {
    const sim = makeSim();
    rich(sim);
    awakenSeed(sim);
    const seedBefore = JSON.stringify(sim.grid.roof('r1')!.tiles);
    sim.state.upgrades.seedVault = 2;
    sim.state.caps.biomass = TUNING.start.caps.biomass * 2;
    sim.state.resources.biomass = 200;
    const capBefore = sim.state.caps.biomass;
    sim.hood.buildLink('seed-reservoir');
    expect(sim.state.caps.biomass).toBeGreaterThan(capBefore); // a new roof brings storage
    const t = sim.grid.get('r2', 2, 4)!;
    expect(sim.restoration.pulse(t.id)).toBe(true);
    sim.advance(2);
    expect(t.ground).toBe('restored');
    expect(sim.progression.restoredCount('r2')).toBeGreaterThanOrEqual(1);
    ground(sim, 'r2', 3, 5, 'restored');
    expect(sim.build.place('condenser', 'r2', 3, 5)).toBeTruthy();
    // the Seed's tiles changed only by time passing (no restoration there)
    expect(JSON.parse(seedBefore).map((x: { ground: string }) => x.ground)).toEqual(sim.grid.roof('r1')!.tiles.map((x) => x.ground));
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
    for (const t of r2.tiles) if (!t.blocked && !t.occupantId && n++ < TUNING.neighbourhood.cores.r2.restoredTiles) ground(sim, 'r2', t.x, t.z, 'restored');
    ground(sim, 'r2', 1, 4, 'restored');
    sim.build.place('reservoirGarden', 'r2', 1, 4);
    sim.state.progression.overflows = 1;
    expect(sim.hood.coreReady('r2')).toBe(true);
    expect(sim.hood.activateRoofCore('r2')).toBe(true);
    expect(sim.hood.activateRoofCore('r2')).toBe(false);
    expect(sim.hood.objective().step).toBe('link2');
    expect(sim.hood.buildLink('seed-canopy')).toBe(true);
    expect(sim.hood.objective().step).toBe('core3');
    expect(sim.production.rates().water).toBeGreaterThan(TUNING.rainBarrelRate + TUNING.neighbourhood.reservoir.cisternWater - 1e-9);
  });
});
