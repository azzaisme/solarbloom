import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData, MachineType, TileData, WeatherKind } from '../src/core/types';
import { WATER_NET } from '../src/data/water';
import { Sim } from '../src/gameplay/Sim';
import { plantId } from '../src/gameplay/WaterPipes';

const DAY = WATER_NET.daySeconds;
const HOUR = DAY / 24;
const weather = (sim: Sim, kind: WeatherKind) => (sim.state.salvage!.weather = { kind, until: Infinity });

function city() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.areas.clear(PARK, true);
  sim.state.salvage!.keepers.sluice = { step: 'request1' }; // Cistern Basin's unlocks held (E23.8.2)
  weather(sim, 'clear');
  // midday, all day (E23.7.1's clock turns the sun off at night; the dry-spell test keeps the panels in sun: "enough power")
  const noon = { ...sim.power.sky(), sun: 1, solar: 1 };
  sim.power.skyOverride = () => noon;
  return sim;
}

function put(sim: Sim, type: MachineType, x: number, z: number, size = type === 'pump' || type === 'solar' ? 1 : 2): MachineData {
  const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  for (const t of sim.grid.footprint(GROUND, x, z, size)) if (t) t.occupantId = m.id;
  sim.grid.indexMachine(m);
  return m;
}

const land = (t: TileData | undefined): t is TileData => !!t && t.feature !== 'water' && !t.blocked && !t.occupantId && t.feature !== 'building';
/** Land bloombot can reach now (not under the fog). */
const open = (sim: Sim, t: TileData | undefined): t is TileData => land(t) && sim.areas.fog(sim.areas.map.areaOfCell(t.x, t.z)) !== 'hidden';

/** A 2×2 spot on the shore by the Landing, and a straight run of land inland from it (for pipe and farm). */
function shore(sim: Sim) {
  for (let z = 47; z >= 36; z--)
    for (let x = 2; x <= 26; x++) {
      const foot = sim.grid.footprint(GROUND, x, z, 2);
      if (!foot.every((t) => open(sim, t)) || !foot.some((t) => sim.water.onShore(t!))) continue;
      // a run of 8 land tiles north of the plant's west column, with land on its east side for the farm
      const run: [number, number][] = [];
      for (let k = 1; k <= 8; k++) run.push([x, z - k]);
      const ok = run.every(([a, b]) => open(sim, sim.grid.get(GROUND, a, b)) && open(sim, sim.grid.get(GROUND, a + 1, b)) && !sim.water.onShore(sim.grid.get(GROUND, a + 1, b)!));
      if (!ok) continue;
      for (const t of [...foot, ...run.flatMap(([a, b]) => [sim.grid.get(GROUND, a, b), sim.grid.get(GROUND, a + 1, b)])])
        Object.assign(t!, { ground: 'restored', pollution: 0 });
      return { x, z, run, farm: run.slice(2).map(([a, b]) => sim.grid.get(GROUND, a + 1, b)!) };
    }
  throw new Error('no shore spot');
}

/** Solar panels on land touching the plant (diagonals count), enough to carry its load in daylight. */
function panels(sim: Sim, m: MachineData, n: number, avoid: [number, number][] = []) {
  const out: MachineData[] = [];
  for (let dz = -1; dz <= m.size && out.length < n; dz++)
    for (let dx = -1; dx <= m.size && out.length < n; dx++) {
      if (dx >= 0 && dx < m.size && dz >= 0 && dz < m.size) continue;
      const t = sim.grid.get(GROUND, m.x + dx, m.z + dz);
      if (land(t) && !avoid.some(([x, z]) => x === t.x && z === t.z)) out.push(put(sim, 'solar', t.x, t.z, 1));
    }
  expect(out.length).toBe(n);
  sim.power.tick(1);
  return out;
}

const gridOff = (sim: Sim) => {
  const night = { ...sim.power.sky(), sun: 0, solar: 0, wind: 0 };
  sim.power.skyOverride = () => night;
  sim.power.tick(1);
};

describe('E23.4.3: the desalination plant', () => {
  it('is built only on the shore (never inland, never in the water), with its recipe paid exactly', () => {
    const sim = city();
    const s = shore(sim);
    sim.bot = { roofId: GROUND, x: s.x + 1, z: s.z - 1 };
    sim.state.salvage!.pack = { scrap: 10, copper: 3, clay: 2, glass: 8 };
    expect(sim.build.check('desalination', GROUND, s.x, s.z - 6).reason).toMatch(/shore/);
    for (const [x, z] of [[2, 10], [3, 10], [2, 11], [3, 11]]) Object.assign(sim.grid.get(GROUND, x, z)!, { ground: 'restored', pollution: 0 });
    expect(sim.build.check('desalination', GROUND, 2, 10).reason).toMatch(/water/); // the park's pond
    expect(sim.build.check('desalination', GROUND, s.x, s.z).ok).toBe(true);
    expect(sim.build.place('desalination', GROUND, s.x, s.z)).toBeDefined();
    expect(sim.state.salvage!.pack).toEqual({});
  });

  it('is locked until Sluice wakes in Cistern Basin', () => {
    const sim = city();
    sim.state.salvage!.keepers = {};
    expect(sim.build.isUnlocked('desalination')).toBe(false);
    expect(sim.build.lockLabel('desalination')).toMatch(/Cistern Basin/);
  });

  it('turns sea water into fresh on grid power, in any weather, and is a heavy load', () => {
    const sim = city();
    const s = shore(sim);
    const m = put(sim, 'desalination', s.x, s.z);
    const pump = put(sim, 'pump', 4, 11);
    panels(sim, m, 4);
    const rates: number[] = [];
    for (const kind of ['clear', 'cloudy', 'rain', 'mist', 'windy'] as WeatherKind[]) {
      weather(sim, kind);
      sim.water.draw(plantId(m), 1e9);
      sim.water.tick(HOUR / 4);
      sim.power.tick(1);
      sim.water.tick(HOUR / 4);
      rates.push(sim.water.amountOf(plantId(m)));
    }
    expect(rates[0]).toBeGreaterThan(0);
    for (const r of rates) expect(r).toBeCloseTo(rates[0], 6); // weather makes no difference
    expect(sim.power.draw(m)).toBe(WATER_NET.desal.power);
    expect(sim.power.draw(m)).toBeGreaterThan(WATER_NET.pump.power * 3);
    expect(pump).toBeDefined();
    // the grid switched off: it stops, nothing breaks
    sim.water.draw(plantId(m), 1e9);
    gridOff(sim);
    sim.water.tick(HOUR);
    sim.power.tick(1);
    sim.water.tick(HOUR);
    expect(sim.water.amountOf(plantId(m))).toBe(0);
    expect(sim.machine(m.id)).toBeDefined();
  });

  it('empties into a pond or canal on its bank', () => {
    const sim = city();
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const t = sim.grid.get(GROUND, x, z)!;
        if (t.feature === 'water' && !t.blocked) {
          t.ground = 'restored';
          sim.grid.touch(t);
        }
      }
    const pond = sim.water.body('1,10')!;
    sim.water.draw(pond.id, pond.capacity);
    const m = put(sim, 'desalination', 4, 10); // (rule bent for the test: the park has no shore; the bank logic is what's tested)
    panels(sim, m, 4);
    for (let i = 0; i < 8; i++) {
      sim.water.tick(HOUR / 2);
      sim.power.tick(1);
    }
    expect(sim.water.levelOf(pond.id)).toBeGreaterThan(0.5);
  });

  it('keeps a farm watered through a dry spell, with enough power: through a pipe from the shore', () => {
    const sim = city();
    const s = shore(sim);
    const m = put(sim, 'desalination', s.x, s.z);
    panels(sim, m, 4, [...s.run, ...s.farm.map((t) => [t.x, t.z] as [number, number])]);
    sim.state.salvage!.pack = { copper: 10, clay: 20 };
    for (const [x, z] of s.run) expect(sim.water.pipes.layProblem(GROUND, x, z) ?? 'ok', `${x},${z}`).toBe('ok');
    for (const [x, z] of s.run) expect(sim.water.pipes.lay(GROUND, x, z)).toBe(true);
    // the farm: six plots beside the pipe, far from any pond or canal (planters, E23.5, will draw the same way)
    for (const t of s.farm) expect(sim.water.wetness(t)).toBe(0);
    const perPlotHour = 10;
    let short = 0;
    // five sunny game days: no rain, the sun on every pond
    for (let h = 0; h < 24 * 5; h++) {
      sim.water.tick(HOUR / 2);
      sim.power.tick(1);
      sim.water.tick(HOUR / 2);
      for (const t of s.farm) {
        if (!sim.water.isWatered(t)) short++;
        if (sim.water.drawNear(t, perPlotHour) < perPlotHour) short++;
      }
    }
    expect(short).toBe(0);
    // without the grid the same farm goes dry (and nothing is lost: the ground stays restored)
    gridOff(sim);
    for (let h = 0; h < 24; h++) {
      sim.water.tick(HOUR);
      for (const t of s.farm) sim.water.drawNear(t, perPlotHour);
    }
    expect(s.farm.some((t) => sim.water.isWatered(t))).toBe(false);
    for (const t of s.farm) expect(t.ground).toBe('restored');
  });

  it('through days and nights on the real clock: a reservoir on the line, filled by day, carries the farm through the night', () => {
    const sim = city();
    sim.power.skyOverride = undefined; // E23.7.1's real day and night
    const s = shore(sim);
    const m = put(sim, 'desalination', s.x, s.z);
    // a reservoir on the west side of the line, touching it (open land, restored)
    const [rx, rz] = [s.run[3][0] - 2, s.run[3][1]];
    for (const t of sim.grid.footprint(GROUND, rx, rz, 2)) {
      expect(open(sim, t), `reservoir spot ${rx},${rz}`).toBe(true);
      Object.assign(t!, { ground: 'restored', pollution: 0 });
    }
    const tank = put(sim, 'reservoir', rx, rz);
    panels(sim, m, 5, [...s.run, ...s.farm.map((t) => [t.x, t.z] as [number, number]), [rx, rz], [rx + 1, rz], [rx, rz + 1], [rx + 1, rz + 1]]);
    sim.state.salvage!.pack = { copper: 10, clay: 20 };
    for (const [x, z] of s.run) expect(sim.water.pipes.lay(GROUND, x, z)).toBe(true);
    const perPlotHour = 6;
    let short = 0;
    let darkHours = 0;
    // three dry game days, hour by hour, the clock running
    for (let h = 0; h < 24 * 3; h++) {
      for (let q = 0; q < 4; q++) {
        sim.state.time += HOUR / 4;
        sim.power.tick(1);
        sim.water.tick(HOUR / 4);
      }
      if (!sim.power.isPowered(m) || sim.power.sky().solar === 0) darkHours++;
      for (const t of s.farm) if (sim.water.drawNear(t, perPlotHour) < perPlotHour) short++;
    }
    expect(darkHours).toBeGreaterThan(12); // there were nights, and the plant stood dark in them
    expect(short).toBe(0); // the reservoir carried the farm through them
    expect(sim.water.levelOf(`r:${tank.id}`)).toBeGreaterThan(0);
  });
});
