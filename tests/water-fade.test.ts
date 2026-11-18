import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { TileData } from '../src/core/types';
import { WATER_NET } from '../src/data/water';
import { Sim } from '../src/gameplay/Sim';
import { WaterSystem } from '../src/gameplay/WaterSystem';

const DAY = WATER_NET.daySeconds;

/** The park with its pond restored and full, and lush ground all round it. */
function park() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.areas.clear(PARK, true);
  const pond: TileData[] = [];
  const land: TileData[] = [];
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const t = sim.grid.get(GROUND, x, z)!;
      if (t.feature === 'water' && !t.blocked) pond.push(t);
      else if (!t.blocked && t.feature !== 'water') land.push(t);
      else continue;
      t.ground = 'restored';
      t.pollution = 0;
      t.bloom = 3;
      sim.grid.touch(t);
    }
  const body = sim.water.bodyAt(pond[0])!;
  return { sim, pond, land, body };
}

const near = (sim: Sim, land: TileData[], body: string) => {
  const b = sim.water.body(body)!;
  const [x0, z0, x1, z1] = sim.water.fadeBounds(b);
  const R = WATER_NET.fadeReach;
  // (and out of reach of Saltwind's canal, x ≤ −2, which is full and keeps its own side green)
  return land.filter((t) => t.x > -2 + R && t.x >= x0 + R - 1 && t.x <= x1 - R + 1 && t.z >= z0 + R - 1 && t.z <= z1 - R + 1);
};

describe('E23.4.4: land fades around low water', () => {
  it('fade steps grow as a body empties, from nothing at the threshold', () => {
    expect(WaterSystem.fadeSteps(1)).toBe(0);
    expect(WaterSystem.fadeSteps(WATER_NET.fadeBelow)).toBe(0);
    expect(WaterSystem.fadeSteps(WATER_NET.fadeBelow * 0.75)).toBe(1);
    expect(WaterSystem.fadeSteps(0)).toBe(WATER_NET.fadeSteps);
  });

  it('a full pond fades nothing', () => {
    const { sim, land } = park();
    expect(land.every((t) => sim.water.bloomShown(t) === 3)).toBe(true);
  });

  it('draining a pond fades the ground beside it, never below restored, and loses nothing', () => {
    const { sim, land, body } = park();
    const banks = near(sim, land, body.id);
    expect(banks.length).toBeGreaterThan(4);
    const machines = sim.state.machines.length;
    const decor = JSON.stringify(sim.state.cozy?.decor ?? {});
    sim.state.salvage!.weather = { kind: 'clear', until: Infinity };
    sim.water.draw(body.id, body.capacity);
    // a whole sunny game day of the full sim at the water's step, plus a few minutes of every system
    for (let i = 0; i < 24; i++) sim.water.tick(DAY / 24);
    sim.advance(30);
    expect(sim.water.levelOf(body.id)).toBe(0);
    for (const t of land) {
      expect(t.ground).toBe('restored'); // never back to dead ground
      expect(t.bloom).toBeGreaterThanOrEqual(3); // the tile itself keeps its bloom (it may even grow)
      expect(sim.water.bloomShown(t)).toBeGreaterThanOrEqual(1);
    }
    for (const t of banks) expect(sim.water.bloomShown(t)).toBe(Math.max(1, t.bloom - WATER_NET.fadeSteps));
    expect(sim.state.machines.length).toBe(machines);
    expect(JSON.stringify(sim.state.cozy?.decor ?? {})).toBe(decor);
    // land beyond the water's reach doesn't depend on it
    const far = land.filter((t) => sim.water.fadeAt(t) === 0);
    expect(far.length).toBeGreaterThan(0);
    // refilling greens it all up again
    sim.state.salvage!.weather = { kind: 'rain', until: Infinity };
    for (let i = 0; i < 12; i++) sim.water.tick(DAY / 24);
    expect(sim.water.levelOf(body.id)).toBe(1);
    for (const t of land) expect(sim.water.bloomShown(t)).toBe(t.bloom);
  });

  it('a nearby full body keeps the land green even when another runs dry', () => {
    const { sim, land, body } = park();
    sim.water.draw(body.id, body.capacity);
    const banks = near(sim, land, body.id);
    const t = banks[0];
    expect(sim.water.fadeAt(t)).toBeGreaterThan(0);
    sim.water.fill(body.id, body.capacity);
    expect(sim.water.fadeAt(t)).toBe(0);
  });

  it('reports the areas to repaint only when a body crosses a fade step', () => {
    const { sim, body } = park();
    sim.water.takeFadeChanges(); // what is already showing (the dry Cistern pond)
    sim.water.draw(body.id, 1); // tracked, still full enough
    expect(sim.water.takeFadeChanges()).toEqual([]);
    sim.water.draw(body.id, body.capacity);
    expect(sim.water.takeFadeChanges().length).toBe(1);
    expect(sim.water.takeFadeChanges()).toEqual([]);
    sim.water.fill(body.id, body.capacity);
    expect(sim.water.takeFadeChanges().length).toBe(1);
  });

  it("has the gentle-failure suite's hooks, and reads E23.7's weather names", () => {
    const { sim, pond, land, body } = park();
    const bank = near(sim, land, body.id)[0];
    expect(sim.water.isDry(bank)).toBe(false);
    sim.water.bodyAt(pond[0]);
    sim.water.drainForTest();
    expect(sim.water.levelOf(body.id)).toBe(0);
    expect(sim.water.isDry(bank)).toBe(true);
    expect(land.every((t) => t.ground === 'restored')).toBe(true);
    sim.water.refillForTest();
    expect(sim.water.isDry(bank)).toBe(false);
    (sim as unknown as { weather: { kind: () => string } }).weather = { kind: () => 'sunny' };
    expect(sim.water.weather()).toBe('clear');
    (sim as unknown as { weather: { kind: () => string } }).weather = { kind: () => 'storm' };
    expect(sim.water.weather()).toBe('rain');
  });
});
