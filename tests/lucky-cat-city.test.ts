import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import { TUNING } from '../src/data/tuning';
import type { MachineData } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';

type Applier = { apply(t: string, mult: number, hidden: number): string };
const saver = new SaveService(undefined);

/** The fountain is awake and `n` areas are cleared (directly, like a very fast player). */
function grownCity(seed: number, n: number) {
  const sim = new Sim(createInitialState(seed));
  sim.state.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  for (let i = 0; i < n; i++) {
    const id = sim.areas.nextGoal()!;
    for (const t of sim.areas.tiles(id)) {
      if (!isRestorable(t, sim.state.machines) || t.ground === 'restored') continue;
      t.ground = 'restored';
      t.bloom = 1;
      t.pollution = 0;
      sim.grid.touch(t);
    }
    sim.areas.clear(id);
  }
  return sim;
}

describe('Lucky Cat in the endless city (City 13)', () => {
  it('hides in the park at first, then in nooks beside obstacles of cleared areas', () => {
    const fresh = new Sim(createInitialState(4));
    expect(fresh.cat.candidates().every((a) => a.roofId === GROUND && !a.id.startsWith('nook:'))).toBe(true);
    const sim = grownCity(4, 6);
    const nooks = sim.cat.candidates().filter((a) => a.id.startsWith('nook:'));
    expect(nooks.length).toBeGreaterThan(3);
    for (const a of nooks) {
      const [x, z] = a.needsFreeTile!;
      const t = sim.grid.get(GROUND, x, z)!;
      expect(t.blocked).toBe(false);
      expect(sim.areas.fog(sim.areas.areaOf(t)!)).toBe('cleared');
      expect(sim.grid.neighbors(t).some((n) => n.blocked && !!n.prop)).toBe(true);
      expect(a.hint).toMatch(/^beside a /);
    }
  });

  it('soak: 200 spawns across a 40-area city are all valid, one at a time, never in fog', { timeout: 60000 }, () => {
    const sim = grownCity(9, 40);
    for (let i = 0; i < 200; i++) {
      sim.state.cat.active = undefined;
      expect(sim.cat.spawn()).toBe(true);
      expect(sim.cat.spawn()).toBe(false);
      const a = sim.cat.anchor(sim.state.cat.active!.anchorId)!;
      expect(a).toBeDefined();
      if (a.roofId === GROUND && a.needsFreeTile) {
        const t = sim.grid.get(GROUND, a.needsFreeTile[0], a.needsFreeTile[1])!;
        expect(['cleared', 'thinning']).toContain(sim.areas.fog(sim.areas.areaOf(t)!));
        expect(t.occupantId).toBeUndefined();
      }
    }
  });

  it('a cat in a city nook survives a reload in the same nook and pays once', () => {
    const sim = grownCity(12, 5);
    const nook = sim.cat.candidates().find((a) => a.id.startsWith('nook:'))!;
    expect(sim.cat.spawn(nook.id)).toBe(true);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.state.cat.active?.anchorId).toBe(nook.id);
    expect(copy.cat.anchor(nook.id)?.pos).toEqual(nook.pos);
    expect(copy.cat.claim()).toBeDefined();
    expect(copy.cat.claim()).toBeUndefined();
  });

  it('Fog Whisker restores the next fogged area from its edge inward, within the fog rules and its cap', () => {
    const before = new Sim(createInitialState(3));
    expect(before.cat.fogWhiskerTiles()).toEqual([]); // not before the fountain
    const sim = grownCity(3, 2);
    const id = sim.areas.nextGoal()!;
    const tiles = sim.cat.fogWhiskerTiles();
    expect(tiles.length).toBeGreaterThan(3);
    expect(tiles.length).toBeLessThanOrEqual(sim.cat.fogWhiskerCap(id));
    for (const t of tiles) expect(sim.areas.areaOf(t)).toBe(id);
    const summary = (sim.cat as unknown as Applier).apply('fogWhisker', 1, 0);
    expect(summary).toMatch(/fog thins/);
    sim.advance(5);
    for (const t of tiles) expect(t.ground).toBe('restored');
  });

  /** Every changed ground tile sits in a cleared or thinning area, never in fog. */
  function watchFog(sim: Sim) {
    const bad: string[] = [];
    sim.grid.touchListeners.push((t) => {
      if (t.roofId !== GROUND) return;
      if (t.ground !== 'restored' && t.ground !== 'growing') return;
      const fog = sim.areas.fog(sim.areas.areaOf(t)!);
      if (fog === 'hidden') bad.push(`${t.id}:${fog}`);
      else if (fog === 'frontier' && !sim.grid.neighbors(t).some((n) => sim.areas.isClear(n))) bad.push(`${t.id}:${fog}`);
    });
    return bad;
  }

  it("Cat's Garden blooms inside one cleared area away from the park", () => {
    const sim = grownCity(5, 4);
    expect(sim.cat.catsGardenAvailable()).toBe(true);
    for (let i = 0; i < 20; i++) {
      const tiles = sim.cat.catsGardenTiles();
      expect(tiles.length).toBeGreaterThan(0);
      const area = sim.areas.areaOf(tiles[0])!;
      expect(area).not.toBe(PARK);
      expect(sim.areas.fog(area)).toBe('cleared');
      for (const t of tiles) expect(sim.areas.areaOf(t)).toBe(area);
    }
    const bad = watchFog(sim);
    expect((sim.cat as unknown as Applier).apply('catsGarden', 1, 0)).toMatch(/garden blooms in the /);
    sim.advance(5);
    expect(bad).toEqual([]);
  });

  it('Golden Relay rides a green corridor: the next hop blooms extra tiles, then it is spent', () => {
    const sim = grownCity(6, 3);
    const st = sim.state;
    st.caps.energy = st.caps.water = st.caps.biomass = 1e7;
    st.resources.energy = st.resources.water = st.resources.biomass = 1e6;
    expect(sim.cat.goldenRelayAvailable()).toBe(false); // no corridor yet: it never rolls
    // Two street gardens five tiles apart inside the cleared park.
    const spots = sim.areas.tiles(PARK).filter((t) => !t.blocked && !t.occupantId && !sim.isCoreTile(t));
    const a = spots.find((t) => spots.some((o) => o.z === t.z && o.x === t.x + 5))!;
    const gardens = [a.x, a.x + 5].map((x) => {
      const t = sim.grid.get(GROUND, x, a.z)!;
      t.feature = 'paving';
      const m: MachineData = { id: sim.newId('m'), type: 'pollinator', roofId: GROUND, x, z: a.z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
      st.machines.push(m);
      sim.grid.indexMachine(m);
      t.occupantId = m.id;
      return m;
    });
    expect(sim.cat.goldenRelayAvailable()).toBe(true);
    expect((sim.cat as unknown as Applier).apply('goldenRelay', 1, 0)).toMatch(/green corridor/);
    expect(st.relayBonus).toBe(sim.cat.goldenCorridorTiles());
    expect(sim.cat.goldenRelayAvailable()).toBe(false); // one at a time
    const bad = watchFog(sim);
    const relayed: string[] = [];
    sim.bus.on('chain.event', (e) => {
      if (e.event.cause === 'relay') relayed.push(e.event.target);
    });
    const start = sim.grid.neighbors(sim.grid.get(GROUND, gardens[0].x, a.z)!).find((t) => !t.blocked && !t.occupantId)!;
    start.ground = 'polluted';
    sim.restoration.complete(start, 'pulse');
    sim.advance(10);
    expect(st.relayBonus).toBe(0);
    expect(relayed.length).toBeGreaterThan(0);
    expect(relayed.length).toBeLessThanOrEqual(sim.cat.goldenCorridorTiles());
    expect(bad).toEqual([]);
  });

  it('Mega Bloom and Drone Party pick from the player’s network and never touch fog', () => {
    const sim = grownCity(7, 5);
    const bad = watchFog(sim);
    for (let i = 0; i < 5; i++) (sim.cat as unknown as Applier).apply('megaBloom', 1, 0);
    sim.advance(30);
    expect(bad).toEqual([]);
    // With no hub, a party degrades to a harvest.
    expect((sim.cat as unknown as Applier).apply('droneParty', 1, 0)).toMatch(/🌿/);
  });

  it('every reward stays out of the fog over many claims', { timeout: 60000 }, () => {
    const sim = grownCity(8, 8);
    const bad = watchFog(sim);
    sim.state.cat.found = 1;
    for (let i = 0; i < 60; i++) {
      sim.state.cat.active = undefined;
      sim.cat.spawn();
      expect(sim.cat.claim()).toBeDefined();
      sim.advance(3);
    }
    sim.advance(20);
    expect(bad).toEqual([]);
  });

  it('city-scale rewards are capped: Fog Whisker never wakes an area alone, Golden Corridor tops out', { timeout: 60000 }, () => {
    const sim = grownCity(21, 2);
    const id = sim.areas.nextGoal()!;
    // Nearly ready: the whisker may only take it to one tile short.
    const need = sim.areas.need(id);
    const fillTo = (n: number) => {
      for (const t of sim.areas.tiles(id)) {
        if (sim.areas.counts(id).restored >= n) break;
        if (!isRestorable(t, sim.state.machines) || t.ground === 'restored') continue;
        t.ground = 'restored';
        t.bloom = 1;
        sim.grid.touch(t);
      }
    };
    fillTo(need - 4);
    expect(sim.areas.counts(id).restored).toBe(need - 4);
    expect(sim.cat.fogWhiskerCap(id)).toBe(3);
    expect(sim.cat.fogWhiskerTiles().length).toBeLessThanOrEqual(3);
    (sim.cat as unknown as Applier).apply('fogWhisker', 1, 0);
    sim.advance(5);
    expect(sim.areas.counts(id).restored).toBeLessThanOrEqual(need - 1);
    expect(sim.areas.ready(id)).toBe(false);
    // One tile short of ready: no Fog Whisker at all (it would be useless), so it degrades to a harvest.
    fillTo(need - 1);
    expect(sim.cat.fogWhiskerTiles()).toEqual([]);
    expect((sim.cat as unknown as Applier).apply('fogWhisker', 1, 0)).toMatch(/🌿/);
    // A huge city: the corridor bonus is capped.
    const big = grownCity(22, 150);
    expect(big.cat.goldenCorridorTiles()).toBe(TUNING.cat.goldenCorridorMax);
    expect(new Sim(createInitialState(22)).cat.goldenCorridorTiles()).toBe(TUNING.cat.goldenCorridorTiles);
  });

  it('the discovery log groups finds by area type and stays short in a huge city', { timeout: 120000 }, () => {
    const sim = grownCity(23, 500);
    sim.state.cat.found = 1;
    for (let i = 0; i < 300; i++) {
      sim.state.cat.active = undefined;
      sim.cat.spawn();
      sim.cat.claim();
    }
    const d = sim.cat.discoveries();
    expect(d.anchors).toEqual([]);
    expect(d.byType.length).toBeLessThanOrEqual(8); // one line per area type, however many areas
    expect(d.byType.reduce((a, t) => a + t.cats, 0)).toBe(300);
    expect(d.byType.filter((t) => t.cats > 0).length).toBeGreaterThan(3);
    for (const t of d.byType) expect(t.kinds).toBeLessThanOrEqual(t.totalKinds);
  });
});
