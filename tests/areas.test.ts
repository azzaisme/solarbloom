import { describe, expect, it } from 'vitest';
import { meetSpecialty } from './city-helpers';
import { SaveService } from '../src/app/SaveService';
import { AreaMap, PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import { Rng } from '../src/core/Rng';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

/** A sim where the city ground is playable (the park arrives in City 05). */
function city(seed = 4) {
  const sim = new Sim(createInitialState(seed));
  const g = sim.grid.layer(GROUND)!;
  g.unlocked = true;
  g.preview = false;
  const s = sim.state;
  s.caps.energy = s.caps.water = s.caps.biomass = 1e6;
  s.resources.energy = s.resources.water = s.resources.biomass = 1e5;
  return sim;
}

/** Restores enough of an area to wake its landmark (directly, like a very fast player). */
function restoreArea(sim: Sim, id: string, share: number = TUNING.city.clearShare, fast = false) {
  const tiles = sim.areas.tiles(id).filter((t) => isRestorable(t, sim.state.machines) && t.ground !== 'restored');
  const target = share >= 1 ? sim.areas.counts(id).restorable : sim.areas.need(id);
  const need = target - sim.areas.counts(id).restored;
  for (const t of tiles.slice(0, Math.max(0, need))) {
    if (!fast) {
      sim.restoration.complete(t, 'pulse');
      continue;
    }
    // Soak shortcut: the end state of a restoration, without chains and rewards.
    t.ground = 'restored';
    t.bloom = 1;
    t.pollution = 0;
    sim.grid.touch(t);
  }
}

describe('areas: the static layout (City 03.1)', () => {
  it('every chunk belongs to exactly one area, and each area lists it', () => {
    const map = new AreaMap(77);
    for (let cz = -12; cz <= 12; cz++)
      for (let cx = -12; cx <= 12; cx++) {
        const id = map.areaOfChunk(cx, cz);
        expect(map.info(id).chunks).toContainEqual([cx, cz]);
      }
    expect(map.areaOfChunk(0, 0)).toBe(PARK);
    expect(map.info(PARK).chunks).toEqual([[0, 0]]);
  });

  it('adjacency is symmetric, every area has neighbours, and sizes stay small', () => {
    const map = new AreaMap(31);
    const sizes: number[] = [];
    const ids = new Set<string>();
    for (let cz = -15; cz <= 15; cz++) for (let cx = -15; cx <= 15; cx++) ids.add(map.areaOfChunk(cx, cz));
    for (const id of ids) {
      const a = map.info(id);
      sizes.push(a.chunks.length);
      expect(a.neighbours.length).toBeGreaterThan(0);
      for (const nb of a.neighbours) expect(map.info(nb).neighbours).toContain(id);
    }
    const inner = [...ids].filter((id) => map.info(id).chunks.every(([x, z]) => Math.abs(x) < 13 && Math.abs(z) < 13));
    const s = inner.map((id) => map.info(id).chunks.length);
    expect(Math.max(...s)).toBeLessThanOrEqual(9);
    expect(s.reduce((a, b) => a + b, 0) / s.length).toBeGreaterThan(1.5);
    expect(s.reduce((a, b) => a + b, 0) / s.length).toBeLessThan(4.5);
  });

  it('is order-independent: the same seed gives the same areas whatever is asked first', () => {
    const a = new AreaMap(9);
    const b = new AreaMap(9);
    const cells: [number, number][] = [];
    for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) cells.push([i, j]);
    const ra = cells.map(([x, z]) => a.areaOfChunk(x, z));
    const rng = new Rng(3);
    for (const [x, z] of [...cells].sort(() => rng.next() - 0.5)) b.info(b.areaOfChunk(x, z));
    expect(cells.map(([x, z]) => b.areaOfChunk(x, z))).toEqual(ra);
  });
});

describe('areas: the fog (City 03.2–03.4)', () => {
  it('starts with only the park revealed; everything else is hidden and untouchable', () => {
    const sim = city();
    expect(sim.areas.fog(PARK)).toBe('thinning');
    const nb = sim.areas.info(PARK).neighbours[0];
    expect(sim.areas.fog(nb)).toBe('hidden');
    const t = sim.areas.tiles(nb).find((x) => !x.occupantId)!;
    expect(sim.restoration.checkPulse(t).ok).toBe(false);
    expect(sim.restoration.checkPulse(t).reason).toMatch(/fog/);
    // the park itself is home: any tile can be restored
    const p = sim.areas.tiles(PARK).find((x) => !x.occupantId && x.ground !== 'restored')!;
    expect(sim.restoration.checkPulse(p).ok).toBe(true);
  });

  it('waking the park reveals exactly its neighbours, as Frontier', () => {
    const sim = city();
    const revealed: string[] = [];
    sim.bus.on('area.revealed', ({ areaId }) => revealed.push(areaId));
    expect(sim.areas.clear(PARK)).toBe(false); // not restored enough yet
    restoreArea(sim, PARK);
    expect(sim.areas.ready(PARK)).toBe(true);
    expect(sim.areas.clear(PARK)).toBe(true);
    expect(sim.areas.fog(PARK)).toBe('cleared');
    expect(revealed.sort()).toEqual([...sim.areas.info(PARK).neighbours].sort());
    for (const id of revealed) {
      expect(sim.areas.fog(id)).toBe('frontier');
      expect(sim.areas.landmark(id)).toBeDefined();
      for (const far of sim.areas.info(id).neighbours) if (far !== PARK && !revealed.includes(far)) expect(sim.areas.fog(far)).toBe('hidden');
    }
    expect(sim.areas.clear(PARK)).toBe(false); // claimed once
  });

  it('in Frontier fog only tiles touching clear ground can be restored, so the fog recedes tile by tile', () => {
    const sim = city(12);
    restoreArea(sim, PARK, 1);
    sim.areas.clear(PARK);
    const id = sim.areas.info(PARK).neighbours[0];
    const tiles = sim.areas.tiles(id).filter((t) => !t.occupantId && !t.blocked);
    const edge = tiles.filter((t) => sim.grid.neighbors(t).some((n) => sim.areas.isClear(n)));
    const deep = tiles.filter((t) => !sim.grid.neighbors(t).some((n) => sim.areas.isClear(n)));
    expect(edge.length).toBeGreaterThan(0);
    expect(deep.length).toBeGreaterThan(0);
    for (const t of edge) expect(sim.restoration.isEligible(t)).toBe(true);
    for (const t of deep) expect(sim.restoration.isEligible(t)).toBe(false);
    // restore one edge tile: the tile behind it opens up
    const first = edge[0];
    const behind = sim.grid.neighbors(first).find((n) => deep.includes(n))!;
    expect(behind).toBeDefined();
    expect(sim.restoration.pulse(first.id)).toBe(true);
    expect(sim.areas.fog(id)).toBe('frontier');
    sim.advance(2);
    expect(sim.areas.fog(id)).toBe('thinning');
    expect(sim.restoration.isEligible(behind)).toBe(true);
    // fog thins as the area is restored, and is gone once cleared
    const d0 = sim.areas.density(id);
    restoreArea(sim, id);
    expect(sim.areas.density(id)).toBeLessThan(d0);
    meetSpecialty(sim, id);
    sim.areas.clear(id);
    expect(sim.areas.density(id)).toBe(0);
    expect(sim.areas.fog(id)).toBe('cleared');
  });

  it('fog state, landmarks and repaired entries survive a save', () => {
    const sim = city(5);
    restoreArea(sim, PARK);
    sim.areas.clear(PARK);
    const copy = new Sim(new SaveService(undefined).deserialize(new SaveService(undefined).serialize(sim.state))!);
    for (const id of sim.areas.revealed()) {
      expect(copy.areas.fog(id)).toBe(sim.areas.fog(id));
      expect(copy.areas.landmark(id)?.id).toBe(sim.areas.landmark(id)?.id);
    }
    expect(copy.state.machines.length).toBe(sim.state.machines.length);
  });
});

describe('areas: reachability (City 03.5)', () => {
  it('a Frontier area whose whole entry edge is blocked gets one obstacle cleared, and it is saved', () => {
    const sim = city(6);
    restoreArea(sim, PARK, 1);
    const id = sim.areas.info(PARK).neighbours[0];
    // Wall off the edge facing clear ground before it is revealed.
    for (const t of sim.areas.tiles(id)) if (sim.grid.neighbors(t).some((n) => sim.areas.areaOf(n) === PARK)) t.blocked = true;
    sim.areas.clear(PARK);
    const entries = sim.areas.entryTiles(id);
    expect(entries.length).toBeGreaterThan(0);
    const fixed = sim.areas.tiles(id).find((t) => t.unblocked)!;
    expect(fixed).toBeDefined();
    const copy = new Sim(new SaveService(undefined).deserialize(new SaveService(undefined).serialize(sim.state))!);
    expect(copy.grid.get(GROUND, fixed.x, fixed.z)).toMatchObject({ blocked: false, unblocked: true });
  });

  it('soak: 500 areas (2 seeds × 250) cleared in random order never leave a Frontier area without a way in', { timeout: 60000 }, () => {
    for (const seed of [1, 2]) {
      const sim = city(seed);
      const rng = new Rng(seed * 7);
      let cleared = 0;
      restoreArea(sim, PARK);
      sim.areas.clear(PARK);
      cleared++;
      const revealedNow: string[] = [];
      sim.bus.on('area.revealed', ({ areaId }) => revealedNow.push(areaId));
      while (cleared < 250) {
        const frontier = sim.areas.revealed().filter((id) => sim.areas.fog(id) !== 'cleared');
        // every newly revealed area has a way in; every 50 clears, re-check them all
        for (const id of cleared % 50 === 0 ? frontier : revealedNow) expect(sim.areas.entryTiles(id).length, `area ${id}`).toBeGreaterThan(0);
        revealedNow.length = 0;
        const id = frontier[Math.floor(rng.next() * frontier.length)];
        restoreArea(sim, id, TUNING.city.clearShare, true);
        meetSpecialty(sim, id);
        expect(sim.areas.clear(id)).toBe(true);
        cleared++;
      }
      // reveals only ever reach neighbours of cleared areas
      for (const id of sim.areas.revealed()) {
        if (id === PARK) continue;
        expect(sim.areas.info(id).neighbours.some((n) => sim.areas.fog(n) === 'cleared')).toBe(true);
      }
    }
  });
});
