import { describe, expect, it } from 'vitest';
import { Bindings, defaultKeys, defaultPad } from '../src/app/Bindings';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData, MachineType } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';
import { tankId } from '../src/gameplay/WaterPipes';
import { WaterOverlay } from '../src/rendering/WaterOverlay';
import * as pc from 'playcanvas';
import { PipeVisuals } from '../src/rendering/PipeVisuals';
import { PALETTE } from '../src/rendering/Palette';
import { POWER } from '../src/data/power';

function park() {
  const sim = new Sim(createInitialState(7));
  sim.areas.clear(PARK, true);
  sim.state.salvage!.keepers.sluice = { step: 'request1' };
  sim.state.salvage!.pack = { pipe: 60 }; // crafted Pipes (E23.6.1), one a tile
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const t = sim.grid.get(GROUND, x, z)!;
      if (t.feature === 'water' && !t.blocked) {
        t.ground = 'restored';
        sim.grid.touch(t);
      }
    }
  const noon = { ...sim.power.sky(), sun: 1, solar: 1 };
  sim.power.skyOverride = () => noon;
  return sim;
}
function put(sim: Sim, type: MachineType, x: number, z: number, size = type === 'reservoir' ? 2 : 1): MachineData {
  const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  for (const t of sim.grid.footprint(GROUND, x, z, size)) if (t) t.occupantId = m.id;
  sim.grid.indexMachine(m);
  return m;
}

describe('E23.4.5: the Water view', () => {
  it('shows the way water flows: away from a running pump, down a line from a reservoir; nothing on dry pipe', () => {
    const sim = park();
    put(sim, 'pump', 4, 11);
    put(sim, 'solar', 5, 10);
    for (let x = 5; x <= 9; x++) sim.water.pipes.lay(GROUND, x, 11);
    expect(sim.water.pipes.lay(GROUND, 7, 10)).toBe(true); // a branch (north)
    sim.power.tick(1);
    sim.water.tick(1);
    sim.power.tick(1);
    sim.water.tick(1);
    const flow = sim.water.pipes.flow();
    expect(flow.get('5,11')).toEqual([[1, 0]]); // from the pump eastward
    expect(flow.get('7,11')).toEqual(expect.arrayContaining([[1, 0], [0, -1]])); // on along the line and up the branch
    expect(flow.get('9,11')).toBeUndefined(); // the end of the line
    // a dry line (its own, with nothing feeding it) has no arrows
    for (let x = 6; x <= 9; x++) sim.water.pipes.lay(GROUND, x, 4);
    expect([...sim.water.pipes.flow().keys()].some((k) => k.endsWith(',4'))).toBe(false);
    // a reservoir on that line feeds it by gravity: arrows run away from it
    const r = put(sim, 'reservoir', 10, 3);
    sim.water.fill(tankId(r), 200);
    sim.water.tick(1);
    const f2 = sim.water.pipes.flow();
    expect(f2.get('9,4')).toEqual([[-1, 0]]);
    expect(f2.get('6,4')).toBeUndefined();
  });

  it('arrows follow the water: from a pump into the reservoir it fills, never back out of it', () => {
    const sim = park();
    put(sim, 'pump', 4, 11);
    put(sim, 'solar', 5, 10);
    for (let x = 5; x <= 9; x++) sim.water.pipes.lay(GROUND, x, 11);
    const r = put(sim, 'reservoir', 10, 11); // at the end of the line (its west side touches 9,11)
    sim.water.fill(tankId(r), 100); // a quarter full: it holds water, but the pump is filling it
    for (let i = 0; i < 2; i++) {
      sim.power.tick(1);
      sim.water.tick(1);
    }
    const before = sim.water.levelOf(tankId(r));
    sim.power.tick(1);
    sim.water.tick(60);
    expect(sim.water.levelOf(tankId(r))).toBeGreaterThan(before); // the water really goes into the tank
    const flow = sim.water.pipes.flow();
    for (let x = 5; x <= 9; x++) expect(flow.get(`${x},11`), `${x},11`).toEqual([[1, 0]]); // every arrow east, into it
  });

  it('arrows follow the water: from a high tank down into a lower one it fills', () => {
    const sim = park();
    const noPower = { ...sim.power.sky(), sun: 0, solar: 0, wind: 0 };
    sim.power.skyOverride = () => noPower;
    const hi = put(sim, 'reservoir', 14, 4);
    for (const t of sim.grid.footprint(GROUND, 14, 4, 2)) t!.level = 2;
    const lo = put(sim, 'reservoir', 6, 4);
    sim.water.fill(tankId(hi), 400);
    sim.water.fill(tankId(lo), 50); // the low one holds some: still the water runs into it, not out
    for (let x = 8; x <= 13; x++) sim.water.pipes.lay(GROUND, x, 4);
    sim.water.tick(1);
    const before = sim.water.levelOf(tankId(lo));
    sim.water.tick(60);
    expect(sim.water.levelOf(tankId(lo))).toBeGreaterThan(before);
    const flow = sim.water.pipes.flow();
    for (let x = 8; x <= 13; x++) expect(flow.get(`${x},4`), `${x},4`).toEqual([[-1, 0]]); // every arrow west, downhill
  });

  it('arrows follow the water: a pump line into a full tank never points back at the pump', () => {
    const sim = park();
    sim.weather.forceForTest('cloudy', Infinity); // (a sunny day's evaporation would have the pump topping the tank up)
    const pump = put(sim, 'pump', 4, 11);
    put(sim, 'solar', 5, 10);
    for (let x = 5; x <= 9; x++) sim.water.pipes.lay(GROUND, x, 11);
    const r = put(sim, 'reservoir', 10, 11);
    sim.water.fill(tankId(r), 1e9); // full
    for (let i = 0; i < 3; i++) {
      sim.power.tick(1);
      sim.water.tick(1);
    }
    expect(sim.water.levelOf(tankId(r))).toBe(1);
    expect(sim.water.pipes.carries(5, 11)).toBe(true);
    // the pump is idle (its tank is full and feeds the whole line), and the full tank is held, not a source: the
    // line is wet but its water stands still, so no arrows at all (and so none back at the pump)
    expect(sim.water.pipes.pumping.has(pump.id)).toBe(false);
    expect([...sim.water.pipes.flow().keys()].filter((k) => k.endsWith(',11'))).toEqual([]);
    // water is drawn from the line: the tank has room, the pump runs, and every arrow runs east, into the tank
    expect(sim.water.drawNear(sim.grid.get(GROUND, 8, 10)!, 40)).toBe(40);
    sim.power.tick(1);
    sim.water.tick(1);
    expect(sim.water.pipes.pumping.has(pump.id)).toBe(true);
    const f1 = sim.water.pipes.flow();
    for (let x = 5; x <= 9; x++) expect(f1.get(`${x},11`), `${x},11`).toEqual([[1, 0]]);
    // with the tank full again and a step up on the line the pump keeps running for the stretch the tank can't
    // reach: arrows east from the pump to the end of the line, none into the full tank, none back
    sim.water.fill(tankId(r), 1e9);
    sim.grid.get(GROUND, 6, 11)!.level = 2;
    sim.water.tick(1);
    expect(sim.water.pipes.pumping.has(pump.id)).toBe(true);
    const f2 = sim.water.pipes.flow();
    for (let x = 5; x <= 8; x++) expect(f2.get(`${x},11`), `${x},11`).toEqual([[1, 0]]);
    expect(f2.get('9,11')).toBeUndefined(); // the end of the line: the tank beyond is full, nothing goes in
  });

  it('a dark pump drives nothing: a tank on its line feeding it by gravity shows its arrows', () => {
    const sim = park();
    const noPower = { ...sim.power.sky(), sun: 0, solar: 0, wind: 0 };
    sim.power.skyOverride = () => noPower;
    const pump = put(sim, 'pump', 4, 11); // on the pond's bank (which has water), but dark
    for (let x = 5; x <= 9; x++) sim.water.pipes.lay(GROUND, x, 11);
    const r = put(sim, 'reservoir', 10, 11);
    sim.water.fill(tankId(r), 200);
    sim.power.tick(1);
    sim.water.tick(1);
    sim.power.tick(1);
    expect(sim.water.pipes.powered(pump)).toBe(false);
    expect(sim.water.pipes.carries(5, 11)).toBe(true); // the tank feeds the level line by gravity
    const flow = sim.water.pipes.flow();
    for (let x = 6; x <= 9; x++) expect(flow.get(`${x},11`), `${x},11`).toEqual([[-1, 0]]); // west, away from the tank
    expect(flow.get('5,11')).toBeUndefined(); // the last tile, by the dark pump
  });

  it('a full plant standing idle moves no water: no hologram and no arrows; drawn from, both come back', () => {
    const sim = park();
    const plant = put(sim, 'desalination', 12, 12, 2);
    put(sim, 'solar', 14, 12); // touching it: on power
    for (let x = 8; x <= 11; x++) sim.water.pipes.lay(GROUND, x, 12); // its line, west
    sim.water.fill(sim.water.plantTank(plant.id)!.id, 1e9); // full
    for (let i = 0; i < 2; i++) {
      sim.power.tick(1);
      sim.water.tick(1);
    }
    expect(sim.water.pipes.powered(plant)).toBe(true);
    expect(sim.water.desalinating.has(plant.id)).toBe(false); // idle: full, nowhere for its water to go
    expect(sim.water.pipes.carries(11, 12)).toBe(true); // (the line still holds its water)
    expect(WaterOverlay.holoMachines(sim).has(plant.id)).toBe(false);
    expect([...sim.water.pipes.flow().keys()].filter((k) => k.endsWith(',12'))).toEqual([]);
    // water drawn from the line: room in its tank, it works again, and its water runs west along the line
    expect(sim.water.drawNear(sim.grid.get(GROUND, 9, 13)!, 10)).toBe(10);
    sim.power.tick(1);
    sim.water.tick(1);
    expect(sim.water.desalinating.has(plant.id)).toBe(true);
    expect(WaterOverlay.holoMachines(sim).has(plant.id)).toBe(true);
    const flow = sim.water.pipes.flow();
    for (let x = 9; x <= 11; x++) expect(flow.get(`${x},12`), `${x},12`).toEqual([[-1, 0]]);
  });

  it("arrows from a tank respect the height it can feed: never up a step it can't climb", () => {
    const sim = park();
    const noPower = { ...sim.power.sky(), sun: 0, solar: 0, wind: 0 };
    sim.power.skyOverride = () => noPower;
    const lo = put(sim, 'reservoir', 6, 4); // a full tank on low ground, west
    sim.water.fill(tankId(lo), 1e9);
    const hi = put(sim, 'reservoir', 14, 4); // a tank with water on a terrace two levels up, east
    for (const t of sim.grid.footprint(GROUND, 14, 4, 2)) t!.level = 3;
    sim.water.fill(tankId(hi), 200);
    for (let x = 8; x <= 13; x++) sim.water.pipes.lay(GROUND, x, 4);
    for (let x = 10; x <= 13; x++) sim.grid.get(GROUND, x, 4)!.level = 3; // the line climbs to the terrace at x 10
    sim.water.tick(1);
    expect(sim.water.levelOf(tankId(lo))).toBe(1); // full: not being filled, so it is a source too
    const flow = sim.water.pipes.flow();
    // the low tank's water can't climb: from the foot of the step on, no arrow points east, up toward the high tank
    for (let x = 9; x <= 13; x++) expect(flow.get(`${x},4`) ?? [], `${x},4`).not.toContainEqual([1, 0]);
    // on the terrace the high tank's water runs west, down toward the step
    for (let x = 11; x <= 13; x++) expect(flow.get(`${x},4`), `${x},4`).toEqual([[-1, 0]]);
  });

  it('rings a dry planter red: none by the pond or beside a running pipe', () => {
    const sim = park();
    const byPond = put(sim, 'planter', 6, 12); // beside the park's pond
    const far = put(sim, 'planter', 12, 11); // 8 tiles east of the pond: nothing in reach
    expect(WaterOverlay.dryPlanters(sim)).toEqual([far]);
    // a pump on the pond and a line out to the far planter: watered now
    put(sim, 'pump', 4, 11);
    put(sim, 'solar', 5, 10);
    for (let x = 5; x <= 11; x++) expect(sim.water.pipes.lay(GROUND, x, 11), `pipe at ${x},11`).toBe(true);
    for (let i = 0; i < 3; i++) {
      sim.power.tick(1);
      sim.water.tick(1);
    }
    expect(sim.water.pipes.carries(11, 11)).toBe(true);
    expect(WaterOverlay.dryPlanters(sim)).toEqual([]);
    expect(byPond).toBeDefined();
  });

  it('turns water that runs or is held into blue holograms: a running pump, a filled tank, a working plant', () => {
    const sim = park();
    const pump = put(sim, 'pump', 4, 11); // on the pond's bank, but no power yet
    for (let x = 5; x <= 7; x++) sim.water.pipes.lay(GROUND, x, 11); // its line (a pump with no line has nowhere to push)
    const r = put(sim, 'reservoir', 10, 3);
    const plant = put(sim, 'desalination', 12, 12, 2);
    sim.water.tick(1); // the pump and the plant ask the grid for power
    sim.water.draw(tankId(r), 1e9);
    sim.water.draw(sim.water.plantTank(plant.id)!.id, 1e9);
    sim.power.tick(1);
    expect([...WaterOverlay.holoMachines(sim)]).toEqual([]); // an unpowered pump, an empty tank, a plant with nothing
    put(sim, 'solar', 5, 10);
    sim.power.tick(1);
    sim.water.tick(1);
    sim.power.tick(1);
    expect(WaterOverlay.holoMachines(sim).has(pump.id)).toBe(true); // pushing water now
    sim.water.fill(tankId(r), 50);
    sim.water.fill(sim.water.plantTank(plant.id)!.id, 5);
    const on = WaterOverlay.holoMachines(sim);
    expect(on).toEqual(new Set([pump.id, r.id, plant.id]));
    // a powered plant standing idle (full, nowhere for its water to go) shows idle: no hologram
    put(sim, 'solar', 14, 12); // touching the plant: it is on power
    sim.water.fill(sim.water.plantTank(plant.id)!.id, 1e9);
    sim.power.tick(1);
    sim.water.tick(1);
    sim.power.tick(1);
    expect(sim.water.pipes.powered(plant)).toBe(true);
    expect(sim.water.desalinating.has(plant.id)).toBe(false);
    expect(WaterOverlay.holoMachines(sim).has(plant.id)).toBe(false);
    // drawn from, it has room again and works: blue again
    sim.water.draw(sim.water.plantTank(plant.id)!.id, 20);
    sim.water.tick(1);
    expect(WaterOverlay.holoMachines(sim).has(plant.id)).toBe(true);
    // the hologram blue is fully saturated, and the look is the Power view's (the owner's numbers)
    const c = new pc.Color().fromString(PALETTE.signal.water.machineHolo);
    expect(Math.min(c.r, c.g, c.b)).toBe(0);
    expect(Math.max(c.r, c.g, c.b)).toBe(c.b);
    expect(c.b).toBe(1);
    expect(POWER.view.holo).toEqual({ opacity: 0.35, glow: 0.8 });
  });

  it('turns only the pipes that carry water into the hologram, and puts their own look back', () => {
    const sim = park();
    put(sim, 'pump', 4, 11);
    put(sim, 'solar', 5, 10);
    for (let x = 5; x <= 9; x++) sim.water.pipes.lay(GROUND, x, 11); // a running line
    for (let x = 6; x <= 9; x++) sim.water.pipes.lay(GROUND, x, 4); // a dry one
    for (let i = 0; i < 3; i++) {
      sim.power.tick(1);
      sim.water.tick(1);
    }
    const canvas = { width: 1, height: 1, getContext: () => null, addEventListener() {}, removeEventListener() {}, style: {} };
    const device = new pc.NullGraphicsDevice(canvas as unknown as HTMLCanvasElement);
    const app = new pc.AppBase(canvas as unknown as HTMLCanvasElement);
    const opts = new pc.AppOptions();
    opts.graphicsDevice = device;
    opts.componentSystems = [pc.RenderComponentSystem];
    app.init(opts);
    const root = new pc.Entity('root', app);
    app.root.addChild(root);
    const pipes = new PipeVisuals(sim, root, device);
    pipes.update(1);
    const parts = () => root.findComponents('render').flatMap((r) => (r as pc.RenderComponent).meshInstances);
    const body = () => (root.findByName('pipes') as pc.Entity).render!.meshInstances;
    const own = body().map((mi) => mi.material);
    expect(body().length).toBe(4); // carrying tube and trim, dry tube and trim
    const holo = new pc.StandardMaterial();
    pipes.holo(holo);
    const shown = body().map((mi) => mi.material);
    expect(shown.filter((m) => m === holo).length).toBe(2); // the carrying line only
    expect(shown.slice(2)).toEqual(own.slice(2)); // the dry line keeps its look
    expect((root.findByName('pipe-glass') as pc.Entity | null)?.enabled ?? false).toBe(false);
    // a rebuild while the view is on (another pipe laid) keeps the hologram
    sim.water.pipes.lay(GROUND, 10, 11);
    for (let i = 0; i < 2; i++) {
      sim.power.tick(1);
      sim.water.tick(1);
    }
    pipes.update(1);
    expect(body().filter((mi) => mi.material === holo).length).toBe(2);
    pipes.holo(undefined);
    expect(body().some((mi) => mi.material === holo)).toBe(false);
    expect(parts().some((mi) => mi.material === holo)).toBe(false);
    expect((root.findByName('pipe-glass') as pc.Entity).enabled).toBe(true);
  });

  it('is toggled in build mode on keyboard (V); on a pad d-pad up steps the view (E23.11), clashing with nothing', () => {
    expect(defaultKeys().waterOverlay).toEqual(['KeyV']);
    expect(defaultPad().waterOverlay).toBeUndefined();
    expect(defaultPad().viewCycle).toBe(12);
    const b = new Bindings();
    expect(b.conflicts()).toEqual([]);
    expect(b.actionForButton(12, ['build', 'world', 'any'])).toBe('viewCycle');
    expect(b.actionForButton(14, ['build', 'world', 'any'])).toBe('slotPrev');
    expect(b.actionForCode('KeyV', ['build', 'world', 'any'])).toBe('waterOverlay');
    // walking, V is the pulse's own (E23.2.2 loads the next seed): the Water view never takes it there
    expect(b.actionForCode('KeyV', ['world', 'any'])).not.toBe('waterOverlay');
  });
});
