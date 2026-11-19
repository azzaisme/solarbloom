import { describe, expect, it } from 'vitest';
import type { ChainEvent } from '../src/gameplay/BloomChainSystem';
import { Sim } from '../src/gameplay/Sim';
import { TUNING } from '../src/data/tuning';
import { fill, GROUND, makeSim, rich, setGround } from './helpers';

function place(sim: Sim, type: Parameters<Sim['build']['place']>[0], x: number, z: number) {
  const size = type === 'droneHub' || type === 'motherTree' ? 2 : 1;
  for (let dz = 0; dz < size; dz++) for (let dx = 0; dx < size; dx++) setGround(sim, x + dx, z + dz, 'restored');
  const m = sim.build.place(type, 'r1', x, z);
  expect(m, `place ${type} at ${x},${z}`).toBeTruthy();
  return m!;
}

function collect(sim: Sim) {
  const events: ChainEvent[] = [];
  const ended: { combo: number }[] = [];
  sim.bus.on('chain.event', (e) => events.push(e.event));
  sim.bus.on('chain.ended', (e) => ended.push({ combo: e.combo }));
  return { events, ended };
}

describe('bloom chain engine', () => {
  it('a restored tile next to a garden pollinates a neighbour, at most N times per garden per chain', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'prepared');
    const p = place(sim, 'pollinator', 4, 4);
    const { events, ended } = collect(sim);
    sim.restoration.complete(sim.grid.get('r1', 4, 3)!, 'pulse');
    sim.advance(3);
    const pol = events.filter((e) => e.type === 'POLLINATE' && e.source === p.id);
    // a 1×1 garden has 4 neighbours; one is the tile that triggered it
    expect(pol.length).toBe(Math.min(TUNING.pollinator.triggersPerChain, 3));
    // every pollinated tile is adjacent to the garden
    for (const e of pol) {
      const t = sim.grid.byTileId(e.target)!;
      expect(Math.abs(t.x - 4) + Math.abs(t.z - 4)).toBe(1);
      expect(t.ground).toBe('restored');
    }
    expect(ended.length).toBe(1);
    expect(ended[0].combo).toBe(pol.length);
  });

  it('only grid adjacency triggers synergies (a garden two tiles away does nothing)', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'prepared');
    place(sim, 'pollinator', 4, 4);
    const { events } = collect(sim);
    sim.restoration.complete(sim.grid.get('r1', 4, 2)!, 'pulse');
    sim.advance(3);
    expect(events.filter((e) => e.type === 'POLLINATE')).toHaveLength(0);
  });

  it('a solar panel bursts once per chain however many neighbours bloom, shining brighter into the grid', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'prepared');
    const solar = place(sim, 'solar', 5, 5);
    place(sim, 'pollinator', 6, 4);
    const { events } = collect(sim);
    // (5,4) touches both the panel and the garden; the garden then pollinates (6,5), which touches the panel again.
    sim.restoration.complete(sim.grid.get('r1', 5, 4)!, 'pulse');
    sim.advance(4);
    expect(events.filter((e) => e.type === 'PRODUCE_ENERGY' && e.target === solar.id)).toHaveLength(1);
    expect(solar.boostUntil).toBeGreaterThan(sim.time);
    // E23.1.4: the burst is grid output, not a counter: the panel gives more while it shines
    const day = { sun: 1, solar: 1, cloudy: false, wind: 0, dark: 0 };
    const shining = sim.power.output(solar, day);
    solar.boostUntil = 0;
    expect(shining).toBeGreaterThan(sim.power.output(solar, day));
  });

  it('Mother Tree charges from nearby restorations, pulses at full charge, and never recharges from its own pulse', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'polluted');
    place(sim, 'droneHub', 0, 5); // unlock
    const tree = place(sim, 'motherTree', 3, 3);
    tree.charge = TUNING.motherTree.threshold - 1;
    const { events } = collect(sim);
    sim.restoration.complete(sim.grid.get('r1', 3, 2)!, 'pulse');
    sim.advance(5);
    const dis = events.filter((e) => e.type === 'DISCHARGE' && e.target === tree.id);
    expect(dis).toHaveLength(1);
    const afterPulse = events.filter((e) => e.type === 'CHARGE' && e.target === tree.id && e.seq > dis[0].seq && e.chainId === dis[0].chainId);
    expect(afterPulse).toHaveLength(0);
    expect(tree.charge).toBe(0);
    // the pulse restored tiles all around it
    expect(events.filter((e) => e.cause === 'motherTree' && (e.type === 'RESTORE' || e.type === 'GROW')).length).toBeGreaterThanOrEqual(8);
  });

  it('a Water Condenser waters dry soil beside it when its charge fills', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'polluted');
    const c = place(sim, 'condenser', 4, 4);
    setGround(sim, 4, 3, 'prepared');
    const { events } = collect(sim);
    sim.advance(TUNING.condenser.threshold + 0.5);
    expect(events.some((e) => e.type === 'PRODUCE_WATER' && e.target === c.id)).toBe(true);
    expect(sim.grid.get('r1', 4, 3)!.ground).toBe('restored');
  });

  it('a ×10+ chain can be built deliberately through placement', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'prepared');
    // A row of gardens flanked by solar panels: each new bloom touches the next element.
    for (const x of [1, 3, 5, 7]) place(sim, 'pollinator', x, 4);
    for (const x of [2, 4, 6]) {
      place(sim, 'solar', x, 3);
      place(sim, 'solar', x, 5);
    }
    const { ended } = collect(sim);
    sim.restoration.complete(sim.grid.get('r1', 0, 4)!, 'pulse');
    sim.advance(6);
    expect(Math.max(...ended.map((e) => e.combo))).toBeGreaterThanOrEqual(10);
  });

  it('cyclic machine layouts always terminate under the caps, with no tile transitioning twice in a chain', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'prepared');
    place(sim, 'droneHub', 0, 5);
    for (const [x, z] of [[2, 2], [5, 2], [2, 5], [5, 5]]) place(sim, 'pollinator', x, z);
    for (const [x, z] of [[3, 2], [2, 3], [4, 5], [5, 4]]) place(sim, 'solar', x, z);
    const tree = place(sim, 'motherTree', 3, 3);
    tree.charge = TUNING.motherTree.threshold - 2;
    sim.state.upgrades.pollinatorReach = 2;
    const { events } = collect(sim);
    sim.restoration.complete(sim.grid.get('r1', 1, 2)!, 'pulse');
    for (let i = 0; i < 200; i++) sim.tick();
    const perChain = new Map<number, ChainEvent[]>();
    for (const e of events) perChain.set(e.chainId, [...(perChain.get(e.chainId) ?? []), e]);
    for (const evs of perChain.values()) {
      expect(evs.length).toBeLessThanOrEqual(TUNING.chain.maxEvents + 60);
      const tileTransitions = evs.filter((e) => e.type === 'RESTORE' || e.type === 'GROW').map((e) => e.target);
      expect(new Set(tileTransitions).size).toBe(tileTransitions.length);
    }
    expect(sim.chains.pendingSteps).toBe(0);
    expect(sim.chains.activeRuns).toBe(0);
  });

  it('is deterministic: the same action on the same state gives the same events and state', () => {
    const build = () => {
      const sim = makeSim(99);
      rich(sim);
      fill(sim, 0, 0, 7, 7, 'prepared');
      place(sim, 'pollinator', 3, 3);
      place(sim, 'solar', 4, 3);
      place(sim, 'pollinator', 5, 3);
      return sim;
    };
    const run = (sim: Sim) => {
      const { events } = collect(sim);
      sim.restoration.pulse('r1:2:3');
      sim.advance(6);
      return { events: events.map((e) => `${e.type}:${e.source}>${e.target}@${e.depth}`), state: JSON.stringify(sim.state) };
    };
    const a = run(build());
    const b = run(build());
    expect(a.events).toEqual(b.events);
    expect(a.state).toBe(b.state);
  });

  it('mega bloom is bounded by its budget and may break concrete', () => {
    const sim = makeSim();
    rich(sim);
    setGround(sim, 4, 4, 'restored', GROUND); // in the park: a Mega Bloom only ever starts in revealed city areas
    let combo = 0;
    sim.bus.on('chain.ended', (e) => (combo = e.combo));
    expect(sim.chains.startMega(6)).toBe(true);
    sim.advance(4);
    expect(combo).toBeGreaterThan(0);
    expect(combo).toBeLessThanOrEqual(6 + 4); // budget tiles + at most a few solar/garden reactions
  });
});
