// #787 (point 4): building is needed in most regions. Each gated region's landmark waits on its works (data/works):
// power, water or drones reaching a piece beside it. These tests build the real machines the prompt asks for and see
// the works start; walk the unlock order to prove no gate can ever block the game; and check older saves.
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { regionOfCell, setPieceAt } from '../src/core/OldCityLayout';
import type { BuildableType, ItemId, MachineData, MaterialId } from '../src/core/types';
import { COMPONENT_RECIPES, MACHINE_RECIPES } from '../src/data/crafting';
import { KEEPERS, REGIONS, type RegionDef } from '../src/data/oldcity';
import { POWER } from '../src/data/power';
import { WATER_NET } from '../src/data/water';
import { TIERS } from '../src/data/salvage';
import { TUNING } from '../src/data/tuning';
import { WORKS, worksOf, type WorksDef } from '../src/data/works';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';
import { bannedIn } from '../src/ui/words';
import { regionProgress, regionProgressHtml } from '../src/ui/RegionProgress';
import { objectiveSentence } from '../src/ui/ObjectiveCard';
import { IDEAS } from '../src/ui/GuideLines';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);
const region = (id: string) => REGIONS.find((r) => r.id === id)!;
const keeperOf = (id: string) => KEEPERS.find((k) => k.region === id)!;
const def = (id: string) => worksOf(id)!;
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/** Plenty of everything a works build needs, in the backpack (components included). */
const PLENTY: Partial<Record<ItemId, number>> = { scrap: 400, copper: 200, clay: 200, gears: 200, glass: 200, timber: 200, seeds: 200, sunstone: 200, wire: 200, pipe: 200, motor: 20, glassPane: 40, planks: 100, biomass: 400 };

/**
 * An Old City at a fountain step, these regions open (out of the fog, past their gates) and their Keepers awake (so
 * their recipes are known), plenty in the backpack, and the sun at noon all day.
 */
function city(tier: number, regions: string[], sky: 'noon' | 'night' = 'noon') {
  const sim = new Sim(createInitialState(7));
  const sv = sim.state.salvage!;
  sv.tier = tier;
  sv.abilities = TIERS.slice(0, tier).flatMap((t) => (t.ability ? [t.ability] : []));
  sim.areas.clear(PARK, true);
  for (const id of regions) {
    sim.state.areas[id] = { fog: 'thinning', revealedAt: 0 };
    sim.gates.openRegion(id);
    if (!sv.opened.includes(region(id).gate.id)) sv.opened.push(region(id).gate.id);
    sv.keepers[region(id).keeper] = { step: 'request1' };
  }
  sv.pack = { ...PLENTY };
  const base = sim.power.sky();
  const at = sky === 'noon' ? { ...base, sun: 1, solar: 1, wind: 0, dark: 0 } : { ...base, sun: 0, solar: 0, wind: 0, dark: 1 };
  sim.power.skyOverride = () => at;
  return sim;
}

/** Turns a cell green (so something can be built on it). */
function green(sim: Sim, x: number, z: number) {
  const t = sim.grid.get(GROUND, x, z)!;
  t.ground = 'restored';
  t.pollution = 0;
  t.bloom = Math.max(1, t.bloom);
  sim.grid.touch(t);
}

/** Builds a machine the way the player does (build mode's own checks: unlocked, the ground, the cost). */
function build(sim: Sim, type: BuildableType, x: number, z: number): MachineData {
  green(sim, x, z);
  const chk = sim.build.check(type, GROUND, x, z);
  expect(chk.ok, `${type} at ${x},${z}: ${chk.reason}`).toBe(true);
  return sim.build.place(type, GROUND, x, z)!;
}

/** Free open cells round a works piece, nearest first (on its level, in its region, not water, nothing on them). */
function around(sim: Sim, w: WorksDef): [number, number][] {
  const lv = sim.grid.get(GROUND, w.x, w.z)!.level;
  const out: [number, number, number][] = [];
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dz) continue;
      const t = sim.grid.get(GROUND, w.x + dx, w.z + dz)!;
      if (t.blocked || t.occupantId || t.feature === 'water' || t.ramp || t.level !== lv || regionOfCell(t.x, t.z)?.id !== w.region) continue;
      out.push([t.x, t.z, Math.max(Math.abs(dx), Math.abs(dz))]);
    }
  return out.sort((a, b) => a[2] - b[2]).map(([x, z]) => [x, z]);
}

/** Runs the sim long enough for the works to be checked. */
const settle = (sim: Sim) => sim.advance(TUNING.works.checkSeconds * 3);

describe('#787: which regions need building', () => {
  it('most regions are gated; the park and Elder Grove are not, so the start stays gentle', () => {
    expect(WORKS.length).toBeGreaterThanOrEqual(Math.ceil(REGIONS.length / 2));
    expect(worksOf('elderGrove')).toBeUndefined();
    expect(worksOf(PARK)).toBeUndefined();
    // every gated region is a real one, once each, and the kinds vary
    expect(new Set(WORKS.map((w) => w.region)).size).toBe(WORKS.length);
    for (const w of WORKS) expect(region(w.region), w.region).toBeDefined();
    for (const k of ['power', 'water', 'drones'] as const) expect(WORKS.some((w) => w.kind === k), k).toBe(true);
    // every power works has its load in the tuning; the loads ramp up with the map
    const power = WORKS.filter((w) => w.kind === 'power');
    for (const w of power) expect(TUNING.works.power[w.region], w.region).toBeGreaterThan(0);
    const loads = power.map((w) => [region(w.region).ring, TUNING.works.power[w.region]] as const);
    for (const [ring, load] of loads) for (const [r2, l2] of loads) if (r2 > ring) expect(l2).toBeGreaterThan(load);
    // the first one needs a single Solar Panel, on a cloudy day too
    expect(TUNING.works.power.mastRow).toBeLessThanOrEqual(POWER.solar.output * POWER.solar.cloudFactor);
  });

  it('each piece stands on its own cell inside its region, blocked, with open ground round it to build on, and Bloombot can walk up to it', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.abilities = ['pry', 'hover', 'climb', 'glide'];
    for (const r of REGIONS) sim.state.areas[r.id] = { fog: 'thinning', revealedAt: 0 };
    for (const r of REGIONS)
      for (const [x, z] of r.gate.cells) {
        const t = sim.grid.get(GROUND, x, z)!;
        t.blocked = false;
        t.unblocked = true;
      }
    const walker = new Walker(sim);
    for (const w of WORKS) {
      const sp = setPieceAt(w.x, w.z);
      expect(sp?.kind === 'works' && sp.works.region, w.region).toBe(w.region);
      expect(regionOfCell(w.x, w.z)?.id, w.region).toBe(w.region);
      const t = sim.grid.get(GROUND, w.x, w.z)!;
      expect(t.blocked && t.prop, w.region).toBe(`works:${w.region}`);
      expect(t.feature, w.region).not.toBe('water');
      // room for six Solar Panels round it (the most a works asks for), every one beside the piece or another
      expect(around(sim, w).length, w.region).toBeGreaterThanOrEqual(6);
      // Bloombot can reach a cell beside it from its Keeper, on foot (every gate open)
      const k = keeperOf(w.region);
      const costs = walker.costsFrom(GROUND, k.x + 0.5, k.z + 1.5);
      expect(N8.some(([dx, dz]) => costs.has(`${w.x + dx},${w.z + dz}`)), `${w.region}: walk up to the piece`).toBe(true);
    }
  });

  it('every line reads plainly: what is wrong, what to build and where, with no system words', () => {
    for (const w of WORKS) {
      for (const line of [w.dark, w.how, w.goal, w.running, w.then, w.needs, w.done, w.name]) {
        expect(bannedIn(line), `${w.region}: ${line}`).toEqual([]);
        expect(line, line).not.toMatch(/—|\btap\b|\bclick\b|\bwatts?\b|\d+\s*W\b/i);
      }
      // the tip names a machine from the build menu
      expect(w.how, w.region).toMatch(/Solar Panel|Water Condenser|Pump|Drone Hub|Wind turbine|Power pole|Reservoir/);
      for (const s of [w.dark, w.how, w.running, w.then]) expect(s, s).toMatch(/[.!]$/);
    }
  });
});

describe('#787: the landmark waits on its works', () => {
  it("Mast Row: the junction box stays dark until a Solar Panel beside it runs; then the Signal Mast can wake", () => {
    const sim = city(1, ['mastRow']);
    const w = def('mastRow');
    const k = keeperOf('mastRow');
    sim.state.salvage!.keepers[k.id] = { step: 'landmark' };
    for (const t of sim.areas.tiles('mastRow')) if (!t.blocked && !t.occupantId) green(sim, t.x, t.z);
    // everything else is done: only the works stand in the way, and every place says so
    expect(sim.areas.ready('mastRow')).toBe(false);
    expect(sim.landmarks.problem('mastRow')).toBe(`The Signal Mast can't wake yet. ${w.dark} ${w.how}`);
    expect(sim.works.problem('mastRow')).toBe(`${w.dark} ${w.how}`);
    expect(sim.keepers.hint(k.id)).toBe(`${w.dark} ${w.how}`);
    const card = objectiveSentence(sim);
    expect(card.next).toBe(w.goal);
    expect(card.where).toEqual({ kind: 'focus', x: w.x, z: w.z });
    expect(card.place).toEqual({ kind: 'machine', name: w.name });
    expect(regionProgressHtml(regionProgress(sim, 'mastRow'))).toContain('Needs power');
    settle(sim);
    expect(sim.works.running('mastRow')).toBe(false); // nothing built: nothing runs
    // the Solar Panel is known from the start; built right beside the box, its sunshine wakes it
    const events: string[] = [];
    sim.bus.on('works.running', ({ region }) => events.push(region));
    const [x, z] = around(sim, w)[0];
    build(sim, 'solar', x, z);
    settle(sim);
    expect(sim.works.running('mastRow')).toBe(true);
    expect(events).toEqual(['mastRow']);
    expect(sim.state.salvage!.works).toEqual(['mastRow']);
    expect(sim.works.problem('mastRow')).toBeUndefined();
    expect(regionProgressHtml(regionProgress(sim, 'mastRow'))).toContain('Powered');
    expect(sim.areas.ready('mastRow')).toBe(true);
    expect(sim.landmarks.problem('mastRow')).toBeUndefined();
    // for good: the panel taken away, or the night, never undo it
    sim.build.remove(sim.state.machines.find((m) => m.type === 'solar' && !m.starter)!.id);
    const night = { ...sim.power.sky(), sun: 0, solar: 0 };
    sim.power.skyOverride = () => night;
    settle(sim);
    expect(sim.works.running('mastRow')).toBe(true);
    expect(events).toEqual(['mastRow']);
  });

  it('at night a panel gives no power, so the box waits for the morning', () => {
    const sim = city(1, ['mastRow'], 'night');
    const w = def('mastRow');
    build(sim, 'solar', ...around(sim, w)[0]);
    settle(sim);
    expect(sim.works.running('mastRow')).toBe(false);
    const noon = { ...sim.power.sky(), sun: 1, solar: 1 };
    sim.power.skyOverride = () => noon;
    settle(sim);
    expect(sim.works.running('mastRow')).toBe(true);
  });

  it("Saltwind: one panel doesn't turn the lock's winch (the prompt says some power reaches it); two side by side do", () => {
    const sim = city(1, ['saltwind']);
    const w = def('saltwind');
    const cells = around(sim, w);
    build(sim, 'solar', ...cells[0]);
    settle(sim);
    expect(sim.works.running('saltwind')).toBe(false);
    expect(sim.works.problem('saltwind')).toContain('Some power reaches it, but not enough yet.');
    // the second panel touching the first (or the winch) joins them up
    const second = cells.slice(1).find(([x, z]) => Math.max(Math.abs(x - cells[0][0]), Math.abs(z - cells[0][1])) <= 1 || Math.max(Math.abs(x - w.x), Math.abs(z - w.z)) <= 1)!;
    build(sim, 'solar', ...second);
    settle(sim);
    expect(sim.works.running('saltwind')).toBe(true);
  });

  it('Saltwind: a Wind turbine on a windy day turns it too', () => {
    const sim = city(1, ['saltwind']);
    sim.state.salvage!.keepers.tide = { step: 'request1' }; // Tide hands over the Wind turbine
    const windy = { ...sim.power.sky(), sun: 0, solar: 0, wind: 1 };
    sim.power.skyOverride = () => windy;
    build(sim, 'windTurbine', ...around(sim, def('saltwind'))[0]);
    settle(sim);
    expect(sim.works.running('saltwind')).toBe(true);
  });

  for (const [id, tier, regions] of [
    ['cistern', 2, ['mastRow', 'saltwind', 'cistern']],
    ['terraces', 3, ['mastRow', 'saltwind', 'terraces']],
    ['observatory', 4, ['mastRow', 'saltwind', 'clockPlaza', 'observatory']],
  ] as const) {
    it(`${region(id).name}: one panel fewer than it needs is not enough; one more and it runs`, () => {
      const sim = city(tier, [...regions]);
      const w = def(id);
      const panels: MachineData[] = [];
      const cells = around(sim, w);
      // a cluster of panels, each touching the piece or one already built (so all of them are joined)
      const next = () =>
        cells.find(([x, z]) => !sim.grid.get(GROUND, x, z)!.occupantId && [w, ...panels].some((m) => Math.max(Math.abs(x - m.x), Math.abs(z - m.z)) <= 1))!;
      for (;;) {
        panels.push(build(sim, 'solar', ...next()));
        settle(sim);
        if (sim.works.running(id)) break;
        expect(panels.length).toBeLessThan(10);
      }
      const supply = (n: number) => panels.slice(0, n).reduce((a, m) => a + sim.power.output(m), 0);
      expect(supply(panels.length)).toBeGreaterThanOrEqual(TUNING.works.power[id]);
      expect(supply(panels.length - 1)).toBeLessThan(TUNING.works.power[id]);
      expect(panels.length).toBeGreaterThanOrEqual(2);
    });
  }

  it('Old Market: a Water Condenser near the dry drinking fountain fills it; one too far away does not', () => {
    const sim = city(1, ['mastRow', 'oldMarket']);
    const w = def('oldMarket');
    // too far: a condenser a little way past its reach
    const far = sim.areas.tiles('oldMarket').find((t) => {
      const d = Math.abs(t.x - w.x) + Math.abs(t.z - w.z);
      if (d <= TUNING.works.condenserReach || d > TUNING.works.condenserReach + 4 || t.blocked || t.occupantId || t.feature === 'water') return false;
      green(sim, t.x, t.z);
      return sim.build.check('condenser', GROUND, t.x, t.z).ok;
    })!;
    build(sim, 'condenser', far.x, far.z);
    settle(sim);
    expect(sim.works.running('oldMarket')).toBe(false);
    build(sim, 'condenser', ...around(sim, w)[0]);
    settle(sim);
    expect(sim.works.running('oldMarket')).toBe(true);
    expect(regionProgressHtml(regionProgress(sim, 'oldMarket'))).toContain('Water running');
  });

  it("Cistern Basin's own water stays dry until its landmark wakes, so its gate is power, never a pipe from its pond", () => {
    const sim = city(2, ['saltwind', 'mastRow', 'cistern']);
    const pond = region('cistern').ponds![0];
    for (let z = pond.z; z < pond.z + pond.d; z++) for (let x = pond.x; x < pond.x + pond.w; x++) sim.restoration.complete(sim.grid.get(GROUND, x, z)!, 'pulse', undefined, true);
    settle(sim);
    const body = sim.water.bodyAt(sim.grid.get(GROUND, pond.x, pond.z)!)!;
    expect(sim.water.dormant(body)).toBe(true);
    expect(def('cistern').need).toEqual({ power: true });
    for (const w of WORKS) if ('pipe' in w.need) expect(WATER_NET.springs[w.region], w.region).toBeUndefined();
  });

  it('Glasshouse Gardens: Pipe from a Pump on Fern\'s pond waters the dry channel', () => {
    const sim = city(4, ['saltwind', 'mastRow', 'cistern', 'glasshouse']);
    sim.state.salvage!.keepers.sluice = { step: 'request1' };
    const w = def('glasshouse');
    const pond = region('glasshouse').ponds![0];
    for (let z = pond.z; z < pond.z + pond.d; z++) for (let x = pond.x; x < pond.x + pond.w; x++) sim.restoration.complete(sim.grid.get(GROUND, x, z)!, 'pulse', undefined, true);
    settle(sim);
    pipeTo(sim, w, pond);
    settle(sim);
    expect(sim.works.running('glasshouse')).toBe(true);
  });

  it('Clock Plaza: a Drone Hub near the seized clockwork, with power to fly, works it loose; an unpowered hub does not', () => {
    const sim = city(2, ['saltwind', 'clockPlaza']);
    const w = def('clockPlaza');
    const cells = around(sim, w);
    const hub = build(sim, 'droneHub', ...cells.find(([x, z]) => sim.build.check('droneHub', GROUND, x, z).ok || (green(sim, x, z), green(sim, x + 1, z), green(sim, x, z + 1), green(sim, x + 1, z + 1), sim.build.check('droneHub', GROUND, x, z).ok))!);
    expect(sim.state.drones.some((d) => d.hubId === hub.id)).toBe(true);
    const night = { ...sim.power.sky(), sun: 0, solar: 0, wind: 0 };
    sim.power.skyOverride = () => night;
    settle(sim);
    expect(sim.works.running('clockPlaza')).toBe(false); // no power: its drones can't fly
    const noon = { ...night, sun: 1, solar: 1 };
    sim.power.skyOverride = () => noon;
    const panel = beside(sim, hub);
    build(sim, 'solar', ...panel);
    settle(sim);
    expect(sim.works.running('clockPlaza')).toBe(true);
    expect(regionProgressHtml(regionProgress(sim, 'clockPlaza'))).toContain('Ticking');
  });

  it("Spire Heights: the winding gear wants Gardener drones; a hub on another job doesn't free it", () => {
    const sim = city(3, ['saltwind', 'clockPlaza', 'spireHeights']);
    const w = def('spireHeights');
    expect(w.need).toEqual({ drones: true, job: 'gardener' });
    const cells = around(sim, w);
    const at = cells.find(([x, z]) => (green(sim, x, z), green(sim, x + 1, z), green(sim, x, z + 1), green(sim, x + 1, z + 1), sim.build.check('droneHub', GROUND, x, z).ok))!;
    const hub = build(sim, 'droneHub', ...at);
    build(sim, 'solar', ...beside(sim, hub));
    settle(sim);
    expect(sim.works.running('spireHeights')).toBe(false); // Restorers (the hub's first job)
    hub.role = 'gardener';
    settle(sim);
    expect(sim.works.running('spireHeights')).toBe(true);
  });

  it('the guide says it once, after the fountain first wakes, when a Keeper in a gated region is awake; the Advisor leads to the piece', () => {
    const sim = city(0, ['saltwind']);
    const idea = IDEAS.find((i) => i.id === 'works')!;
    expect(idea.comes(sim)).toBe(false); // the opening minutes stay about the park
    sim.state.salvage!.tier = 1;
    expect(idea.comes(sim)).toBe(true);
    expect(idea.known(sim)).toBe(false);
    expect(bannedIn(idea.text(() => 'E', sim))).toEqual([]);
    // Tide asks for the landmark: the Advisor's step is the winch, and Show me where goes there
    sim.state.salvage!.keepers.tide = { step: 'landmark' };
    const w = def('saltwind');
    const step = sim.advisor.keeperStep()!;
    expect(step.text).toBe(`${w.dark} ${w.how}`);
    expect(step.action).toEqual({ kind: 'focus', x: w.x, z: w.z });
    expect(step.place).toEqual({ kind: 'machine', name: w.name });
    sim.works.start('saltwind');
    expect(idea.known(sim)).toBe(true);
    expect(sim.advisor.keeperStep()!.action).toEqual({ kind: 'focus', x: keeperOf('saltwind').x, z: keeperOf('saltwind').z });
  });

  it('a works far off under the fog does nothing, and its power load is on no power lines', () => {
    const sim = city(1, []);
    expect(sim.areas.fog('terraces')).toBe('hidden');
    expect(sim.power.networkOf(sim.works.node('terraces'))).toBeUndefined();
    settle(sim);
    expect(sim.works.running('terraces')).toBe(false);
  });
});

/** A free cell touching a machine's footprint, on its level. */
function beside(sim: Sim, m: MachineData): [number, number] {
  const lv = sim.grid.get(GROUND, m.x, m.z)!.level;
  for (let z = m.z - 1; z <= m.z + m.size; z++)
    for (let x = m.x - 1; x <= m.x + m.size; x++) {
      if (x >= m.x && x < m.x + m.size && z >= m.z && z < m.z + m.size) continue;
      const t = sim.grid.get(GROUND, x, z)!;
      if (t.blocked || t.occupantId || t.feature === 'water' || t.ramp || t.level !== lv) continue;
      green(sim, x, z);
      if (sim.build.check('solar', GROUND, x, z).ok) return [x, z];
    }
  throw new Error('no room beside it');
}

/**
 * Lays the player's way to water a piece: a Pump on the pond's bank with a Solar Panel touching it, then Pipe tile by
 * tile from beside the pump to beside the piece (a shortest run over ground a pipe can go on).
 */
function pipeTo(sim: Sim, w: WorksDef, pond: { x: number; z: number; w: number; d: number }) {
  const inPond = (x: number, z: number) => x >= pond.x && x < pond.x + pond.w && z >= pond.z && z < pond.z + pond.d;
  let pump: MachineData | undefined;
  for (let z = pond.z - 1; z <= pond.z + pond.d && !pump; z++)
    for (let x = pond.x - 1; x <= pond.x + pond.w && !pump; x++) {
      if (inPond(x, z)) continue;
      const t = sim.grid.get(GROUND, x, z)!;
      if (t.blocked || t.occupantId) continue;
      green(sim, x, z);
      if (sim.build.check('pump', GROUND, x, z).ok) pump = sim.build.place('pump', GROUND, x, z);
    }
  expect(pump, 'a pump on the bank').toBeDefined();
  build(sim, 'solar', ...beside(sim, pump!));
  // a run of pipe: breadth first from the cells beside the pump to a cell beside the piece
  const key = (x: number, z: number) => `${x},${z}`;
  const from = new Map<string, string | undefined>();
  const queue: [number, number][] = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = pump!.x + dx, z = pump!.z + dz;
    if (!sim.water.pipes.layProblem(GROUND, x, z)) from.set(key(x, z), undefined), queue.push([x, z]);
  }
  let end: string | undefined;
  while (queue.length && !end) {
    const [x, z] = queue.shift()!;
    if (Math.max(Math.abs(x - w.x), Math.abs(z - w.z)) <= TUNING.works.pipeReach) {
      end = key(x, z);
      break;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      const k = key(nx, nz);
      if (from.has(k) || Math.abs(nx - w.x) + Math.abs(nz - w.z) > 80 || sim.water.pipes.layProblem(GROUND, nx, nz)) continue;
      from.set(k, key(x, z));
      queue.push([nx, nz]);
    }
  }
  expect(end, 'a way to lay pipe to the piece').toBeDefined();
  const run: string[] = [];
  for (let k: string | undefined = end; k; k = from.get(k)) run.push(k);
  for (const k of run.reverse()) {
    const [x, z] = k.split(',').map(Number);
    expect(sim.water.pipes.lay(GROUND, x, z), `pipe at ${k}`).toBe(true);
  }
  return { pump: pump!, run };
}

describe('#787: saves', () => {
  it('running works are saved, byte for byte, and come back running', () => {
    const sim = city(1, ['mastRow']);
    build(sim, 'solar', ...around(sim, def('mastRow'))[0]);
    settle(sim);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(saver.serialize(back.state)).toBe(json);
    expect(back.works.running('mastRow')).toBe(true);
    expect(back.works.running('oldMarket')).toBe(false);
  });

  it('an older save (no works saved) keeps every landmark it already woke: those regions count as running', () => {
    const sim = city(2, ['mastRow', 'oldMarket', 'saltwind']);
    sim.areas.clear('mastRow', true); // woken before the works existed
    sim.areas.clear('saltwind', true);
    const old = JSON.parse(saver.serialize(sim.state));
    delete old.salvage.works;
    const back = new Sim(saver.deserialize(JSON.stringify(old))!);
    expect(back.works.running('mastRow')).toBe(true);
    expect(back.works.running('saltwind')).toBe(true);
    expect(back.works.running('oldMarket')).toBe(false); // not woken yet: it waits on its works like a new game
    expect(back.areas.fog('mastRow')).toBe('cleared');
    // nothing is written for them, and the save loads to the same save
    expect(back.state.salvage!.works).toBeUndefined();
    expect(saver.serialize(new Sim(saver.deserialize(saver.serialize(back.state))!).state)).toBe(saver.serialize(back.state));
  });
});

// ───────────── the unlock order: no gate ever blocks the game ─────────────

/** A machine's whole cost in raw materials (its components made from their recipes). */
function rawCost(type: string): Set<MaterialId> {
  const out = new Set<MaterialId>();
  const add = (id: string) => {
    const comp = COMPONENT_RECIPES.find((c) => c.id === id);
    if (comp) for (const k of Object.keys(comp.cost)) add(k);
    else if (id !== 'biomass' && id !== 'fertiliser' && id !== 'compost') out.add(id as MaterialId);
  };
  for (const k of Object.keys(MACHINE_RECIPES.find((r) => r.id === type || r.builds === type)!.cost)) add(k);
  return out;
}

/** The machines each works asks for, by the words of its tip. */
function machinesFor(w: WorksDef): BuildableType[] {
  const n = w.need;
  if ('never' in n) return machinesFor.never ?? [];
  if ('power' in n) return ['solar'];
  if ('condenser' in n) return ['condenser'];
  if ('pipe' in n) return ['pump', 'solar'];
  return ['droneHub', 'solar'];
}
/** For the negative test: what a made-up need asks for. */
machinesFor.never = undefined as BuildableType[] | undefined;

/**
 * Walks the game's unlock order with the real unlock rules (the build menu's, the water network's): the boat lands on
 * the beach; a region opens once its gate can be (an ability from the fountain, the lock bridge, a repair whose
 * materials can be found); its Keeper wakes; its landmark wakes once its two deliveries can be found and, if it is
 * gated, its works can be built from what is unlocked right then; the fountain steps up once enough landmarks are
 * awake and its delivery can be found. Materials come from the piles of the open regions (and Tally's trade once the
 * Market Hall is awake). Returns what woke, in order.
 */
function walk(works: readonly WorksDef[]) {
  const sim = new Sim(createInitialState(7));
  const sv = sim.state.salvage!;
  const gate = (id: string) => works.find((w) => w.region === id);
  const entered = new Set<string>(['saltwind']); // the boat lands on the beach
  const awake = new Set<string>();
  const order: string[] = [];
  const sources = (): Set<MaterialId> => {
    const have = new Set<MaterialId>(['scrap', 'seeds']); // the park's piles
    for (const id of entered) for (const p of region(id).piles) have.add(p.material);
    // Tally trades 3 of anything for 1 of any other, once the Market Hall is awake
    if (awake.has('oldMarket')) for (const r of REGIONS) for (const p of r.piles) have.add(p.material);
    return have;
  };
  const canGet = (cost: Record<string, number | undefined>) => Object.keys(cost).every((k) => k === 'biomass' || sources().has(k as MaterialId));
  const sync = () => {
    sv.abilities = TIERS.slice(0, sv.tier).flatMap((t) => (t.ability ? [t.ability] : []));
    // a Keeper in an open region can always be woken (5 of anything)
    for (const id of entered) if ((sv.keepers[region(id).keeper]?.step ?? 'asleep') === 'asleep') sv.keepers[region(id).keeper] = { step: 'request1' };
  };
  const enterable = (r: RegionDef) => {
    const n = r.gate.needs;
    if (r.gate.kind === 'lockBridge') return (!!n.landmark && awake.has(n.landmark)) || sv.abilities.includes('hover');
    if (n.repair) return canGet(n.repair);
    return !!n.ability && sv.abilities.includes(n.ability);
  };
  /** Can the works be built now: every machine its tip names unlocked and its materials found, the job open. */
  const worksDoable = (w: WorksDef): boolean => {
    for (const type of machinesFor(w)) {
      if (!MACHINE_RECIPES.some((r) => r.builds === type) || !sim.build.isUnlocked(type)) return false;
      for (const m of rawCost(type)) if (!sources().has(m)) return false;
    }
    if ('pipe' in w.need) {
      if (!sim.water.unlocked('pipe')) return false;
      // a pond in the region whose water runs before the landmark wakes (never spring-fed: those wait on it)
      if (!region(w.region).ponds?.length || WATER_NET.springs[w.region] !== undefined) return false;
    }
    if ('drones' in w.need && w.need.job === 'gardener') {
      // the Gardener job opens with a Water Condenser built (and ground in flower); its drones want water near the hub
      const cond = MACHINE_RECIPES.find((r) => r.id === 'condenser')!;
      if (!sim.crafting.unlocked(cond.unlock) || !region(w.region).ponds?.length) return false;
    }
    return true;
  };
  for (let step = 0; step < 60; step++) {
    sync();
    let moved = false;
    const t = TIERS[sv.tier];
    if (t) {
      const cond = t.needs.parkTiles !== undefined || awake.size >= (t.needs.landmarks ?? 0);
      const items = (t.items ?? []).every((i) => (i === 'heartSeed' ? awake.has('glasshouse') : i === 'starLens' ? awake.has('observatory') : false));
      if (cond && items && canGet(t.delivery)) {
        sv.tier++;
        order.push(`fountain ${sv.tier}`);
        moved = true;
        sync();
      }
    }
    for (const r of REGIONS)
      if (!entered.has(r.id) && enterable(r)) {
        entered.add(r.id);
        order.push(`enter ${r.id}`);
        moved = true;
        sync();
      }
    for (const r of REGIONS) {
      if (!entered.has(r.id) || awake.has(r.id)) continue;
      const k = keeperOf(r.id);
      if (!canGet(k.request1) || !canGet(k.landmark)) continue;
      const w = gate(r.id);
      if (w && !worksDoable(w)) continue;
      awake.add(r.id);
      sim.state.areas[r.id] = { fog: 'cleared', revealedAt: 0 }; // its landmark woke
      order.push(`wake ${r.id}`);
      moved = true;
    }
    if (!moved) break;
  }
  return { awake, order, tier: sv.tier };
}

describe('#787: walking the unlock order', () => {
  it('every gate is achievable from what is unlocked by then: all ten landmarks wake and the fountain reaches its last step', () => {
    const { awake, order, tier } = walk(WORKS);
    const path = order.join(' → ');
    expect([...awake].sort(), path).toEqual(REGIONS.map((r) => r.id).sort());
    expect(tier, path).toBe(TIERS.length);
    // the ring-1 gates need nothing from beyond the fountain's second step (it waits on two ring-1 landmarks), and
    // at least one gated region wakes before it: building pays off early
    const ring1 = order.slice(0, order.indexOf('fountain 2')).filter((o) => o.startsWith('wake ')).map((o) => o.slice(5));
    expect(ring1.length, path).toBeGreaterThanOrEqual(TIERS[1].needs.landmarks!);
    expect(ring1.filter((id) => worksOf(id)).length, path).toBeGreaterThanOrEqual(1);
    // and the gates change nothing about the order the regions open in (they never hold a region shut)
    expect(order.filter((o) => o.startsWith('enter ')), path).toEqual(walk([]).order.filter((o) => o.startsWith('enter ')));
  });

  it('the walk catches a gate that could never run: one asking for the Big Battery (after the Great Bloom) blocks the game', () => {
    const bad = WORKS.map((w) => (w.region === 'mastRow' ? { ...w, need: { drones: true as const } } : w));
    // a drone gate in Mast Row is reachable (Drone Hubs come at step 2), so the game still finishes…
    expect(walk(bad).tier).toBe(TIERS.length);
    // …but one asking for a machine that only comes after the last step can never run: the walk stalls
    const never = WORKS.map((w) => (w.region === 'mastRow' ? { ...w, need: { never: true } as unknown as WorksDef['need'] } : w));
    machinesFor.never = ['gridBattery'];
    const stuck = walk(never);
    machinesFor.never = undefined;
    expect(stuck.awake.has('mastRow')).toBe(false);
    expect(stuck.tier).toBeLessThan(TIERS.length);
  });
});
