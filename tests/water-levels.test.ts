import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData, TileData } from '../src/core/types';
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

  it("Cistern Basin's pond stays dry until the Old Cistern wakes; waking fills it; its springs keep it topped up", () => {
    const sim = city();
    const p = sim.water.bodyAt(pondTile(sim))!;
    expect(p.region).toBe('cistern');
    expect(sim.water.levelOf(p.id)).toBe(0);
    expect(sim.water.dormant(p)).toBe(true);
    weather(sim, 'cloudy');
    days(sim, 2);
    expect(sim.water.levelOf(p.id)).toBe(0); // no springs while it sleeps
    weather(sim, 'storm');
    days(sim, 1);
    expect(sim.water.levelOf(p.id)).toBe(0); // and no rain: the pond is the landmark's payoff
    // the Old Cistern wakes: its pond fills before the player's eyes, over `wakeRush` seconds
    weather(sim, 'cloudy');
    sim.areas.clear('cistern', true);
    expect(sim.water.dormant(p)).toBe(false);
    for (let i = 0; i < WATER_NET.wakeRush / 2; i++) sim.water.tick(1);
    const half = sim.water.levelOf(p.id);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    for (let i = 0; i < WATER_NET.wakeRush / 2 + 1; i++) sim.water.tick(1);
    expect(sim.water.levelOf(p.id)).toBe(1);
    // after the rush, only the springs
    sim.water.draw(p.id, p.capacity);
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

  it('weather acts on every body alike, even one nothing has touched', () => {
    const sim = city();
    const b = sim.water.bodyAt(canalTile(sim))!;
    expect(sim.water.tracked()).toEqual([]);
    weather(sim, 'sunny');
    days(sim, 1);
    const evap = sim.weather.effects().evaporation;
    expect(sim.water.levelOf(b.id)).toBeCloseTo(1 - evap, 2);
    // every region's canals and ponds, not just the ones looked at
    for (const r of REGIONS)
      for (const q of r.water ?? []) {
        const w = sim.water.bodyAt(sim.grid.get(GROUND, q.x, q.z));
        if (!w || sim.water.dormant(w)) continue;
        expect(sim.water.levelOf(w.id), `${r.id} ${w.id}`).toBeLessThan(1);
        expect(sim.water.levelOf(w.id)).toBeGreaterThanOrEqual(WATER_NET.evaporationFloor);
      }
  });

  /** The park's shallow pond, restored. */
  const parkPond = (sim: Sim) => {
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
    return pond;
  };

  it('a body split in two keeps its level in both pieces (never full again), and the gone tile leaves it', () => {
    const sim = city();
    const pond = parkPond(sim);
    const b = sim.water.bodyAt(pond[0])!;
    expect(b.tiles.size).toBe(pond.length);
    sim.water.draw(b.id, b.capacity * 0.6); // at 0.4
    // silt up a whole column across the pond: it splits in two
    const xs = [...new Set(pond.map((t) => t.x))].sort((a, c) => a - c);
    const cut = xs[Math.floor(xs.length / 2)];
    const gone = pond.filter((t) => t.x === cut);
    const west = pond.filter((t) => t.x < cut);
    const east = pond.filter((t) => t.x > cut);
    expect(west.length).toBeGreaterThan(0);
    expect(east.length).toBeGreaterThan(0);
    for (const t of gone) {
      t.ground = 'polluted';
      sim.grid.touch(t);
    }
    for (const t of gone) expect(sim.water.bodyAt(t)).toBeUndefined();
    const w = sim.water.bodyAt(west[0])!;
    const e = sim.water.bodyAt(east[0])!;
    expect(w).not.toBe(e);
    expect(w.tiles.size + e.tiles.size).toBe(pond.length - gone.length);
    expect(sim.water.levelOf(w.id)).toBeCloseTo(0.4, 6);
    expect(sim.water.levelOf(e.id)).toBeCloseTo(0.4, 6);
    expect(Object.keys(sim.state.water!.levels).sort()).toEqual([w.id, e.id].sort());
    // joined again, the pool keeps what the pieces hold; the restored column arrives full
    for (const t of gone) {
      t.ground = 'restored';
      sim.grid.touch(t);
    }
    const j = sim.water.bodyAt(pond[0])!;
    expect(j.tiles.size).toBe(pond.length);
    expect(sim.water.levelOf(j.id)).toBeCloseTo((0.4 * (pond.length - gone.length) + gone.length) / pond.length, 6);
    // a bloom on a water tile is not a change of shape: the cache stays
    pond[0].bloom = 2;
    sim.grid.touch(pond[0]);
    expect(sim.water.bodyAt(pond[0])).toBe(j);
  });

  it('as a pond drains, its lily pads and koi keep to the water still there (the bank bares first)', () => {
    const sim = city();
    const pond = parkPond(sim);
    const b = sim.water.bodyAt(pond[0])!;
    const { d, max } = sim.water.depths(b);
    const bank = pond.find((t) => d.get(t.id) === 1)!;
    const deep = pond.find((t) => d.get(t.id) === max)!;
    expect(max).toBeGreaterThan(1);
    expect(pond.every((t) => sim.water.covered(t))).toBe(true);
    sim.water.draw(b.id, b.capacity * 0.5);
    expect(sim.water.covered(bank)).toBe(false);
    expect(sim.water.covered(deep)).toBe(true);
    // some of the pond is still water (the park pond is small: its bank is most of it)
    const wet = pond.filter((t) => sim.water.covered(t)).length;
    expect(wet).toBeGreaterThan(0);
    expect(wet).toBeLessThan(pond.length);
    sim.water.draw(b.id, b.capacity);
    expect(pond.some((t) => sim.water.covered(t))).toBe(false);
    expect(sim.water.covered(sim.grid.get(GROUND, 30, 30))).toBe(false); // not water at all
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
  it("tells E23.1.5's advisor which area is short of water (a body there below the fade line), and only that one", () => {
    const sim = city();
    const t = canalTile(sim);
    const b = sim.water.bodyAt(t)!;
    const area = sim.areas.map.areaOfCell(t.x, t.z);
    const other = sim.areas.map.areaOfCell(pondTile(sim).x, pondTile(sim).z);
    expect(area).not.toBe(other);
    weather(sim, 'cloudy');
    sim.areas.clear(area, true); // seen
    expect(sim.water.isLow(area)).toBe(false); // full
    sim.water.draw(b.id, b.capacity * (1 - WATER_NET.fadeBelow) - 1); // just above the line
    expect(sim.water.isLow(area)).toBe(false);
    sim.water.draw(b.id, 2);
    expect(sim.water.isLow(area)).toBe(true);
    expect(sim.water.isLow(PARK)).toBe(false);
    sim.water.fill(b.id, b.capacity);
    expect(sim.water.isLow(area)).toBe(false);
    // Cistern Basin's pond starts dry, but that is its landmark's story, not a shortage (and unseen at first)
    expect(sim.water.isLow(other)).toBe(false);
    sim.areas.clear(other, true); // seen, and the Old Cistern wakes
    const pond = sim.water.bodyAt(pondTile(sim))!;
    expect(sim.water.isLow(other)).toBe(sim.water.levelOf(pond.id) < WATER_NET.fadeBelow);
    sim.water.draw(pond.id, pond.capacity);
    expect(sim.water.isLow(other)).toBe(true);
  });

  it('the advisor never hints at an area the player has not seen (still behind the clouds)', () => {
    const sim = city();
    const t = canalTile(sim);
    const b = sim.water.bodyAt(t)!;
    const area = sim.areas.map.areaOfCell(t.x, t.z);
    sim.state.areas[area].sealed = true; // behind the clouds, as before its gate opens
    expect(sim.areas.fog(area)).toBe('hidden');
    sim.water.draw(b.id, b.capacity);
    expect(sim.water.isLow(area)).toBe(false);
    delete sim.state.areas[area].sealed; // its gate opens
    expect(sim.water.isLow(area)).toBe(true);
  });
  it("E23.5's planters drink from the water in reach: a dry pond wilts them (never kills them), and refilling brings them back", () => {
    const sim = city();
    weather(sim, 'sunny'); // dry days (rain would water the bed itself)
    const c = canalTile(sim);
    const b = sim.water.bodyAt(c)!;
    // open land two tiles from the canal
    let spot: TileData | undefined;
    for (let dz = -3; dz <= 3 && !spot; dz++)
      for (let dx = -3; dx <= 3 && !spot; dx++) {
        const t = sim.grid.get(GROUND, c.x + dx, c.z + dz);
        if (t && t.feature !== 'water' && !t.blocked && !t.occupantId && t.feature !== 'building' && sim.water.bodyNear(t)?.id === b.id) spot = t;
      }
    expect(spot).toBeDefined();
    Object.assign(spot!, { ground: 'restored', pollution: 0 });
    const m: MachineData = { id: sim.newId('m'), type: 'planter', roofId: GROUND, x: spot!.x, z: spot!.z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
    sim.state.machines.push(m);
    spot!.occupantId = m.id;
    sim.grid.indexMachine(m);
    (sim.state.salvage!.crops ??= []).push('radish');
    sim.inventory.add('seeds', 5);
    expect(sim.farm.plant(m, 'radish')).toBe(true);
    expect(sim.water.isWatered(m as unknown as TileData)).toBe(true);
    expect(sim.farm.look(m).wilting).toBe(false);
    // a growing bed drinks from the canal
    const before = sim.water.amountOf(b.id);
    for (let i = 0; i < 24; i++) {
      sim.state.time += DAY / 48;
      sim.farm.tick(DAY / 48);
    }
    expect(sim.water.amountOf(b.id)).toBeLessThan(before);
    // the canal runs dry: the bed wilts (growth waits), and nothing is lost
    sim.water.draw(b.id, b.capacity);
    const grown = sim.state.salvage!.planters![m.id].grown;
    expect(sim.farm.look(m).wilting).toBe(true);
    for (let i = 0; i < 24; i++) {
      sim.state.time += DAY / 48;
      sim.farm.tick(DAY / 48);
    }
    expect(sim.state.salvage!.planters![m.id]).toMatchObject({ crop: 'radish', grown });
    expect(sim.state.machines).toContain(m);
    // water back: it grows on
    sim.water.fill(b.id, b.capacity);
    expect(sim.farm.look(m).wilting).toBe(false);
    for (let i = 0; i < 4; i++) {
      sim.state.time += DAY / 48;
      sim.farm.tick(DAY / 48);
    }
    expect(sim.state.salvage!.planters![m.id].grown).toBeGreaterThan(grown!);
  });
});
