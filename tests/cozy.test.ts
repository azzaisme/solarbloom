import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { areaMapFor, PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { generateTile } from '../src/core/Generation';
import { distToFootprintRaw } from '../src/core/Footprint';
import { CHUNK } from '../src/core/Hash';
import { plotAt, plotSpots } from '../src/core/Plots';
import type { LayerData } from '../src/core/types';
import { PLOT_GEN, PLOT_OPTIONS, plotOptionsFor } from '../src/data/cozy';
import { AREA_TYPES, CITY_GEN, PARK_LAYOUT, type AreaType } from '../src/data/city';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { runOldCityBot } from './oldcity-bot';
import { drawPlot, PLOT_ART } from '../src/rendering/PlotArt';
import { Walker } from '../src/gameplay/Walker';

const ground = (gen: number): LayerData => ({ id: GROUND, name: 'g', kind: 'ground', width: 0, depth: 0, height: 0, origin: [0, 0, 0], unlocked: true, preview: false, gen });

/** The first n areas outward from the park (breadth-first over neighbours), for a seed and generation. */
function areas(seed: number, gen: number, n: number): string[] {
  const map = areaMapFor(seed, gen);
  const out = [PARK];
  const seen = new Set(out);
  for (let i = 0; i < out.length && out.length < n; i++)
    for (const nb of map.info(out[i]).neighbours)
      if (!seen.has(nb) && out.length < n) {
        seen.add(nb);
        out.push(nb);
      }
  return out;
}

/** Restores a plot's tiles (as play would), so it's ready to choose. */
function restorePlot(sim: Sim, p: { x: number; z: number; size: number }) {
  for (let j = 0; j < p.size; j++)
    for (let i = 0; i < p.size; i++) {
      const t = sim.grid.get(GROUND, p.x + i, p.z + j)!;
      t.ground = 'restored';
      t.pollution = 0;
      t.bloom = Math.max(1, t.bloom);
      sim.grid.touch(t);
    }
}

describe('E19.1.1 plot spots', () => {
  it('are deterministic and valid across 1,000 areas', { timeout: 120_000 }, () => {
    const seed = 4242;
    const gen = createInitialState(seed).layers.find((l) => l.id === GROUND)!.gen ?? 1;
    const layer = ground(gen);
    const map = areaMapFor(seed, gen);
    const list = areas(seed, gen, 1000);
    expect(list.length).toBe(1000);
    const byType: Partial<Record<AreaType, number>> = {};
    let short = 0;
    for (const id of list) {
      const spots = plotSpots(seed, id, gen);
      // the same answer again, and a fresh map gives the same too (pure)
      expect(JSON.stringify(plotSpots(seed, id, gen))).toBe(JSON.stringify(spots));
      expect(spots.length).toBeLessThanOrEqual(PLOT_GEN.max);
      if (spots.length < PLOT_GEN.min) short++;
      const info = map.info(id);
      byType[info.type] = (byType[info.type] ?? 0) + spots.length;
      const cells = new Set<string>();
      for (const p of spots) {
        expect(Math.floor(p.x / CHUNK)).toBe(Math.floor((p.x + p.size - 1) / CHUNK)); // one chunk
        expect(Math.floor(p.z / CHUNK)).toBe(Math.floor((p.z + p.size - 1) / CHUNK));
        for (let j = 0; j < p.size; j++)
          for (let i = 0; i < p.size; i++) {
            const x = p.x + i;
            const z = p.z + j;
            const t = generateTile(seed, layer, x, z)!;
            expect(map.areaOfCell(x, z)).toBe(id);
            expect(t.blocked, `${p.id} on an obstacle`).toBe(false);
            expect(['lawn', 'paving', 'clay', 'litter']).toContain(t.feature); // never road, water or building
            expect(map.underRoof(id, x, z)).toBe(false);
            expect(distToFootprintRaw(x, z, info.landmark[0], info.landmark[1], 2), 'clear of the landmark').toBeGreaterThan(CITY_GEN.landmarkClearance + 1);
            if (id === PARK) expect(t.feature).not.toBe('paving');
            cells.add(`${x},${z}`);
            expect(plotAt(seed, x, z, gen)?.id).toBe(p.id);
          }
      }
      expect(cells.size).toBe(spots.length * PLOT_GEN.size ** 2); // no overlaps
    }
    // Nearly every area has room for the minimum; the few that don't are crowded with buildings.
    expect(short / list.length).toBeLessThan(0.03);
    for (const t of Object.keys(AREA_TYPES) as AreaType[]) if (t !== 'rooftops' || byType.rooftops !== undefined) expect(byType[t] ?? 0, t).toBeGreaterThan(0);
  });

  it('the park has its two plots off the paths and the starting tiles', () => {
    const spots = plotSpots(1234, PARK, 4);
    expect(spots.length).toBe(2);
    for (const p of spots) expect(Math.abs(p.x - PARK_LAYOUT.starterSolar[0]) > 1 || Math.abs(p.z - PARK_LAYOUT.starterSolar[1]) > 1).toBe(true);
  });
});

describe('E19.1.3 plot options', () => {
  it('every area type offers at least three options, a shared set plus its own', () => {
    for (const t of Object.keys(AREA_TYPES) as AreaType[]) {
      const opts = plotOptionsFor(t);
      expect(opts.length, t).toBeGreaterThanOrEqual(3 + 2); // four shared, at least one of its own
      expect(opts.some((o) => o.types?.includes(t)), t).toBe(true);
      // at least three that need no water beside the spot
      expect(opts.filter((o) => !o.nearWater).length).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(PLOT_OPTIONS.map((o) => o.id)).size).toBe(PLOT_OPTIONS.length);
  });
});

describe('E19.1.2 choosing a plot', () => {
  it('is refused until restored, free, changeable and clearable', () => {
    const sim = new Sim(createInitialState(1234));
    const cozy = new Cozy(sim);
    const p = cozy.spots(PARK)[0];
    sim.grid.get(GROUND, p.x, p.z);
    expect(cozy.choose(p.id, 'garden')).toMatch(/Restore/);
    restorePlot(sim, p);
    const before = JSON.stringify(sim.state.resources);
    expect(cozy.choose(p.id, 'garden')).toBeUndefined();
    expect(cozy.choice(p.id)?.id).toBe('garden');
    expect(cozy.choose(p.id, 'orchard')).toBeUndefined();
    expect(cozy.choice(p.id)?.id).toBe('orchard');
    expect(cozy.choose(p.id, 'mooring')).toBeDefined(); // a canal option
    expect(cozy.choose(p.id, 'cafe')).toMatch(/Unlocks/); // not earned yet
    expect(JSON.stringify(sim.state.resources)).toBe(before); // never costs anything
    expect(cozy.solidAt(GROUND, p.x, p.z)).toBe(true); // the orchard is solid
    expect(cozy.plotUnder(GROUND, p.x - 1, p.z - 1, 2)?.id).toBe(p.id);
    expect(cozy.choose(p.id, undefined)).toBeUndefined();
    expect(cozy.choice(p.id)).toBeUndefined();
    expect(sim.state.cozy?.plots).toBeUndefined(); // sparse: nothing left behind
  });
});

describe('E19.1.1 / E19.1.4 saves and unlocks', () => {
  it('save → load → save is byte-identical with choices made, and an old save shows its plots empty', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const sim = new Sim(createInitialState(77));
    const cozy = new Cozy(sim);
    for (const p of cozy.spots(PARK)) {
      restorePlot(sim, p);
      expect(cozy.choose(p.id, p === cozy.spots(PARK)[0] ? 'meadow' : 'garden')).toBeUndefined();
    }
    const a = saver.serialize(sim.state);
    const copy = new Sim(saver.deserialize(a)!);
    const b = saver.serialize(copy.state);
    expect(b).toBe(a);
    expect(new Cozy(copy).count()).toBe(2);
    // A save from before E19 has no cozy field at all: it loads with every plot empty.
    const old = JSON.parse(a);
    delete old.cozy;
    const oldSim = new Sim(saver.deserialize(JSON.stringify(old))!);
    expect(new Cozy(oldSim).count()).toBe(0);
    expect(oldSim.state.cozy).toBeUndefined();
  });

  it('an unlock happens once and survives a reload', () => {
    const saver = new SaveService(undefined);
    const sim = new Sim(createInitialState(5));
    const cozy = new Cozy(sim);
    expect(cozy.checkUnlocks()).toEqual([]);
    expect(sim.state.cozy).toBeUndefined(); // nothing earned, nothing written
    // pretend two areas were cleared
    sim.areas.clearedCount = () => 2;
    const got = cozy.checkUnlocks().map((o) => o.id);
    expect(got).toContain('playground');
    expect(got).toContain('crates');
    expect(cozy.checkUnlocks()).toEqual([]); // once each
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    copy.areas.clearedCount = () => 2;
    const c2 = new Cozy(copy);
    expect(c2.checkUnlocks()).toEqual([]);
    expect(c2.isUnlocked(PLOT_OPTIONS.find((o) => o.id === 'playground')!)).toBe(true);
    // the picker's "new" marker clears once shown
    const p = c2.spots(PARK)[0];
    expect(c2.choices(p).find((c) => c.option.id === 'playground')?.fresh).toBe(true);
    c2.seen(['playground']);
    expect(c2.choices(p).find((c) => c.option.id === 'playground')?.fresh).toBe(false);
  });
});

describe('E19.1.5 plots stay cosmetic', () => {
  it('production, chains, milestones and biodiversity are identical whatever is chosen', { timeout: 240_000 }, () => {
    const saver = new SaveService(undefined);
    saver.now = () => 0;
    const strip = (s: string) => {
      const o = JSON.parse(s);
      delete o.cozy;
      return JSON.stringify(o);
    };
    let plainSim: Sim | undefined;
    runOldCityBot(11, 25, 'keeper', { onSecond: (sim) => (plainSim = sim) });
    // The same bot, choosing a look for every plot the moment it's ready, changing them now and then.
    let n = 0;
    let chosenSim: Sim | undefined;
    runOldCityBot(11, 25, 'keeper', {
      onSecond: (sim) => {
        chosenSim = sim;
        const cozy = ((sim as unknown as { __cozy?: Cozy }).__cozy ??= new Cozy(sim));
        cozy.checkUnlocks();
        for (const id of sim.areas.revealed())
          for (const p of cozy.spots(id)) {
            if (!cozy.ready(p)) continue;
            const opts = cozy.choices(p).filter((c) => c.unlocked);
            if (!cozy.choice(p.id) || n % 7 === 0) cozy.choose(p.id, opts[n % opts.length].option.id);
            n++;
          }
      },
    });
    expect(n).toBeGreaterThan(0); // choices were really made
    expect(chosenSim!.state.cozy?.plots).toBeDefined();
    expect(strip(saver.serialize(chosenSim!.state))).toBe(strip(saver.serialize(plainSim!.state)));
    expect(JSON.stringify(chosenSim!.ecosystem.score())).toBe(JSON.stringify(plainSim!.ecosystem.score()));
  });
});

describe('E19.1.3 plot art budget', () => {
  it('every option has art, and each stays small next to the chunk budget (#144)', () => {
    const p = { id: 'p8_12', areaId: 'park', x: 8, z: 12, size: 2, water: false };
    // A primitive is counted at 80 triangles (more than the low-poly sphere's); foliage at its exact count.
    const count = (option: string | undefined, far: boolean) => {
      let tris = 0;
      let models = 0;
      drawPlot({ add: () => (tris += 80), foliage: (g) => (tris += g.tris), model: () => (models++, false), lod: far ? 0 : 1 }, p, option, 0.1, far);
      return { tris, models };
    };
    for (const o of PLOT_OPTIONS) {
      expect(PLOT_ART, o.id).toContain(o.id);
      const near = count(o.id, false);
      const far = count(o.id, true);
      expect(near.tris, o.id).toBeGreaterThan(0);
      // at most 4 plots per area: under 1.5 % of the 450k chunk budget each, so even four in one chunk stay small
      expect(near.tris, o.id).toBeLessThan(6000);
      expect(far.tris, o.id).toBeLessThanOrEqual(160);
    }
    expect(count(undefined, false).tris).toBeLessThan(1000); // the waiting look
  });
});

describe('E19 × bloombot: solid plots block walking', () => {
  it('a solid choice blocks its cells; a flat one does not', () => {
    const sim = new Sim(createInitialState(1234));
    const cozy = new Cozy(sim);
    const walker = new Walker(sim);
    walker.solid = (r, x, z) => cozy.solidAt(r, x, z);
    const p = cozy.spots(PARK)[0];
    restorePlot(sim, p);
    sim.areas.reveal?.(PARK);
    const free = walker.walkable(GROUND, p.x, p.z);
    expect(cozy.choose(p.id, 'meadow')).toBeUndefined(); // flat
    expect(walker.walkable(GROUND, p.x, p.z)).toBe(free);
    expect(cozy.choose(p.id, 'orchard')).toBeUndefined(); // solid
    expect(walker.walkable(GROUND, p.x, p.z)).toBe(false);
    expect(walker.walkable(GROUND, p.x + 1, p.z + 1)).toBe(false);
  });
});
