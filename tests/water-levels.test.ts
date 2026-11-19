import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { TileData } from '../src/core/types';
import type { WeatherKind } from '../src/data/weather';
import { REGIONS } from '../src/data/oldcity';
import { WATER_NET } from '../src/data/water';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;
const DAY = WATER_NET.daySeconds;
const region = (id: string) => REGIONS.find((r) => r.id === id)!;

function city(seed = 7) {
  const sim = new Sim(createInitialState(seed, 'oldcity'));
  sim.areas.clear(PARK, true);
  return sim;
}
/** E23.7.2's weather, held for the rest of the test. */
const weather = (sim: Sim, kind: WeatherKind) => sim.weather.forceForTest(kind, Infinity);
/** Runs the water for `days` game days in hour-long steps (the rest of the sim is not needed). */
const days = (sim: Sim, n: number) => {
  for (let i = 0; i < n * 24; i++) sim.water.tick(DAY / 24);
};

/** Saltwind's canal: its first data rectangle's top-left tile. */
const canalTile = (sim: Sim) => {
  const q = region('saltwind').water![0];
  return sim.grid.get(GROUND, q.x, q.z)!;
};
const pondTile = (sim: Sim) => {
  const q = region('cistern').water![0];
  return sim.grid.get(GROUND, q.x, q.z)!;
};

describe('E23.4.1: water levels (sim.water)', () => {
  it('a canal is one body of fresh water, full until used; the sea is not fresh', () => {
    const sim = city();
    const b = sim.water.bodyAt(canalTile(sim))!;
    expect(b).toBeDefined();
    const q = region('saltwind').water![0];
    // the canal's own water only (the sea beside it and the boardwalk's rubble bound it)
    expect(b.tiles.size).toBeGreaterThan(20);
    for (const id of b.tiles) {
      const t = sim.grid.byTileId(id)!;
      expect(t.x >= q.x && t.x < q.x + q.w && t.z >= q.z && t.z < q.z + q.d).toBe(true);
    }
    expect(b.capacity).toBe(b.tiles.size * WATER_NET.perTile);
    expect(sim.water.levelOf(b.id)).toBe(1);
    expect(sim.water.isFresh(sim.grid.get(GROUND, -40, 100))).toBe(false);
    expect(sim.state.water?.levels ?? {}).toEqual({}); // nothing saved until something changes
  });

  it('draw takes water and never goes below empty', () => {
    const sim = city();
    const b = sim.water.bodyAt(canalTile(sim))!;
    expect(sim.water.draw(b.id, 100)).toBe(100);
    expect(sim.water.levelOf(b.id)).toBeCloseTo(1 - 100 / b.capacity, 6);
    expect(sim.water.draw(b.id, 1e9)).toBeCloseTo(b.capacity - 100, 6);
    expect(sim.water.levelOf(b.id)).toBe(0);
    expect(sim.water.draw(b.id, 10)).toBe(0);
    expect(sim.water.fill(b.id, b.capacity * 2)).toBe(b.capacity);
    expect(sim.water.levelOf(b.id)).toBe(1);
  });

  it('drawNear and isWatered find the water within reach', () => {
    const sim = city();
    const c0 = canalTile(sim);
    const c = sim.grid.get(GROUND, c0.x, c0.z + 10)!; // mid-canal, away from the park's pond
    const bank = sim.grid.get(GROUND, c.x + 2 + WATER_NET.reach, c.z)!; // beyond reach
    const near = sim.grid.get(GROUND, c.x + 2, c.z)!; // just off the canal (it is 2 wide)
    expect(sim.water.isWatered(near)).toBe(true);
    expect(sim.water.isWatered(bank)).toBe(false);
    expect(sim.water.drawNear(bank, 10)).toBe(0);
    const b = sim.water.bodyAt(c)!;
    sim.water.draw(b.id, b.capacity);
    expect(sim.water.isWatered(near)).toBe(false);
    expect(sim.water.wetness(near)).toBe(0);
  });

  it('sunny days evaporate a little, never below the floor; cloud leaves it be', () => {
    const sim = city();
    const b = sim.water.bodyAt(canalTile(sim))!;
    sim.water.draw(b.id, b.capacity * 0.1); // tracked from now on, at 0.9
    weather(sim, 'cloudy');
    days(sim, 2);
    expect(sim.water.levelOf(b.id)).toBeCloseTo(0.9, 6);
    weather(sim, 'sunny');
    const evap = sim.weather.effects().evaporation;
    expect(evap).toBeGreaterThan(0);
    days(sim, 1);
    expect(sim.water.levelOf(b.id)).toBeCloseTo(0.9 - evap, 2);
    days(sim, Math.ceil(0.4 / evap) + 1);
    expect(sim.water.levelOf(b.id)).toBeCloseTo(WATER_NET.evaporationFloor, 6);
    // below the floor, evaporation takes nothing
    sim.water.draw(b.id, b.capacity);
    days(sim, 3);
    expect(sim.water.levelOf(b.id)).toBe(0);
  });

  it('rain fills everything back up over the day', () => {
    const sim = city();
    const b = sim.water.bodyAt(canalTile(sim))!;
    sim.water.draw(b.id, b.capacity);
    weather(sim, 'rain');
    days(sim, 0.125);
    const mid = sim.water.levelOf(b.id);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(1);
    days(sim, 1);
    expect(sim.water.levelOf(b.id)).toBe(1);
  });

  it("Cistern Basin's pond starts dry; rain fills it; its springs top it up once the Old Cistern wakes", () => {
    const sim = city();
    const p = sim.water.bodyAt(pondTile(sim))!;
    expect(p.region).toBe('cistern');
    expect(sim.water.levelOf(p.id)).toBe(0);
    weather(sim, 'cloudy');
    days(sim, 2);
    expect(sim.water.levelOf(p.id)).toBe(0); // no springs while it sleeps
    weather(sim, 'rain');
    days(sim, 0.1);
    expect(sim.water.levelOf(p.id)).toBeGreaterThan(0.2);
    sim.water.draw(p.id, p.capacity);
    sim.areas.clear('cistern', true);
    weather(sim, 'cloudy');
    days(sim, 0.25);
    expect(sim.water.levelOf(p.id)).toBeCloseTo(WATER_NET.springs.cistern! * 0.25, 2);
    // springs outrun the sun
    weather(sim, 'sunny');
    days(sim, 3);
    expect(sim.water.levelOf(p.id)).toBe(1);
    // and keep it full while the farm draws a little every hour
    for (let h = 0; h < 48; h++) {
      sim.water.draw(p.id, p.capacity * 0.03);
      sim.water.tick(DAY / 24);
    }
    expect(sim.water.levelOf(p.id)).toBeGreaterThan(0.9);
  });

  it('the springs only feed their own region', () => {
    const sim = city();
    sim.areas.clear('cistern', true);
    const b = sim.water.bodyAt(canalTile(sim))!;
    sim.water.draw(b.id, b.capacity);
    weather(sim, 'cloudy');
    days(sim, 2);
    expect(sim.water.levelOf(b.id)).toBe(0);
  });

  it("a shallow pond holds water once restored, and keeps its water as more of it is restored", () => {
    const sim = city();
    const pond: TileData[] = [];
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const t = sim.grid.get(GROUND, x, z)!;
        if (t.feature === 'water' && !t.blocked) pond.push(t);
      }
    expect(pond.length).toBeGreaterThan(3);
    expect(sim.water.bodyAt(pond[0])).toBeUndefined(); // a silted bed until restored
    // restore all but the last tile (sorted so the last one is the far corner: the anchor stays put)
    pond.sort((a, b) => a.z - b.z || a.x - b.x);
    const restore = (t: TileData) => {
      t.ground = 'restored';
      sim.grid.touch(t);
    };
    pond.slice(0, -1).forEach(restore);
    const b = sim.water.bodyAt(pond[0])!;
    expect(b.tiles.size).toBe(pond.length - 1);
    sim.water.draw(b.id, b.capacity / 2);
    restore(pond[pond.length - 1]);
    const b2 = sim.water.bodyAt(pond[0])!;
    expect(b2.tiles.size).toBe(pond.length);
    const n = pond.length;
    expect(sim.water.levelOf(b2.id)).toBeCloseTo((0.5 * (n - 1) + 1) / n, 6);
    expect(Object.keys(sim.state.water!.levels)).toEqual([b2.id]);
  });

  it('levels survive a save and load', () => {
    const sim = city();
    const b = sim.water.bodyAt(canalTile(sim))!;
    sim.water.draw(b.id, b.capacity * 0.4);
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(back.water.levelOf(b.id)).toBeCloseTo(0.6, 6);
    expect(back.water.tracked().map((x) => x.id)).toEqual([b.id]);
  });

  it('Gardener drones and Cultivators draw from the water near their work', () => {
    const sim = city();
    const pond: TileData[] = [];
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const t = sim.grid.get(GROUND, x, z)!;
        if (t.feature === 'water' && !t.blocked) pond.push(t);
      }
    for (const t of pond) {
      t.ground = 'restored';
      sim.grid.touch(t);
    }
    const b = sim.water.bodyAt(pond[0])!;
    // a growable tile beside the pond
    const edge = pond[pond.length - 1];
    const t = sim.grid.get(GROUND, edge.x + 1, edge.z)!;
    expect(t.feature).not.toBe('water');
    Object.assign(t, { ground: 'restored', pollution: 0, bloom: 1, blocked: false });
    delete t.occupantId;
    sim.grid.touch(t);
    sim.roles.complete({ id: 'd-test', hubId: 'none' } as never, { role: 'gardener', tileId: t.id });
    const afterGardener = sim.water.levelOf(b.id);
    expect(afterGardener).toBeLessThan(1);
    expect(afterGardener).toBeGreaterThan(0.9);
    // a tiller finishing a tile beside the pond
    const dock = { id: 'cv-test', type: 'cultivator', roofId: GROUND, x: 30, z: 30, size: 1, cult: { done: 0, units: [] } };
    const unit = { work: [t.id] };
    (sim.cultivators as unknown as { finished: (m: unknown, u: unknown, t: TileData) => void }).finished(dock, unit, t);
    expect(dock.cult.done).toBe(1);
    expect(sim.water.levelOf(b.id)).toBeCloseTo(afterGardener - WATER_NET.draw.cultivatorPerTile / b.capacity, 9);
  });
});
