import { hedgeReady } from './helpers';
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import { regionById } from '../src/core/OldCityLayout';
import type { MaterialId } from '../src/core/types';
import { AREA_TYPES } from '../src/data/city';
import { KEEPERS, MODEL_NAMES, REGIONS } from '../src/data/oldcity';
import { MATERIALS } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';
import { oldCityObjective } from '../src/ui/OldCityGuide';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);
const NEAR_PYLON = { roofId: GROUND, x: 10.5, z: -2.5 };

/** An Old City with Mast Row open (its gate pried), bloombot beside the Pylon. */
function mastRowOpen(seed = 7) {
  const sim = new Sim(createInitialState(seed));
  sim.state.salvage!.tier = 1;
  sim.state.salvage!.abilities.push('prune');
  hedgeReady(sim);
  sim.areas.clear('park', true);
  sim.gates.open('g-mastRow');
  sim.bot = NEAR_PYLON;
  return sim;
}
/** Save, load, save: must be byte-identical; returns the loaded sim. */
function roundTrip(sim: Sim): Sim {
  const json = saver.serialize(sim.state);
  const back = new Sim(saver.deserialize(json)!);
  expect(saver.serialize(back.state)).toBe(json);
  back.bot = sim.bot;
  return back;
}

describe('E21.8: Keepers', () => {
  it('the Pylon: asleep → stirs → request 1 → request 2 → landmark, saving and loading at every step', () => {
    let sim = mastRowOpen();
    const said: string[][] = [];
    const watch = (s: Sim) => s.bus.on('keeper.said', (e) => said.push(e.lines));
    watch(sim);
    expect(sim.keepers.step('pylon')).toBe('asleep');
    expect(sim.keepers.interact('pylon')).toBe('talked'); // asleep: it only snores
    sim = roundTrip(sim);
    watch(sim);
    expect(sim.keepers.pulse('pylon')).toBe(true);
    expect(sim.keepers.state('pylon').pulsed).toBe(true);
    // 5 of anything wakes it; with nothing, it only stirs
    expect(sim.keepers.interact('pylon')).toBe('stirs');
    sim.inventory.add('scrap', 7);
    sim = roundTrip(sim);
    watch(sim);
    expect(sim.keepers.interact('pylon')).toBe('woke');
    expect(sim.inventory.count('scrap')).toBe(2);
    expect(sim.keepers.step('pylon')).toBe('request1');
    sim = roundTrip(sim);
    // request 1: 8 Seeds, a bit at a time
    sim.inventory.add('seeds', 5);
    expect(sim.keepers.interact('pylon')).toBe('gave');
    expect(sim.keepers.wants('pylon')).toEqual({ seeds: 3 });
    sim = roundTrip(sim);
    expect(sim.keepers.wants('pylon')).toEqual({ seeds: 3 });
    sim.inventory.add('seeds', 4);
    expect(sim.keepers.interact('pylon')).toBe('done');
    expect(sim.inventory.count('seeds')).toBe(1);
    expect(sim.keepers.step('pylon')).toBe('request2');
    sim = roundTrip(sim);
    // request 2: restore every tile of the tram stop
    const p = REGIONS[0].patch;
    const tiles = [];
    for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) tiles.push(sim.grid.get(GROUND, x, z)!);
    for (const t of tiles.slice(0, -1)) sim.restoration.complete(t, 'pulse');
    expect(sim.keepers.step('pylon')).toBe('request2');
    expect(sim.keepers.patch('pylon')).toEqual({ restored: tiles.length - 1, total: tiles.length });
    sim = roundTrip(sim);
    sim.restoration.complete(sim.grid.get(GROUND, tiles.at(-1)!.x, tiles.at(-1)!.z)!, 'pulse');
    expect(sim.keepers.step('pylon')).toBe('landmark');
    expect(sim.keepers.wants('pylon')).toEqual({ copper: 20, scrap: 10 });
    sim = roundTrip(sim);
    expect(sim.keepers.step('pylon')).toBe('landmark');
    expect(said.length).toBeGreaterThan(3);
    for (const lines of said) expect(lines.length).toBeGreaterThanOrEqual(1), expect(lines.length).toBeLessThanOrEqual(3);
  });

  it('a Keeper in a closed region can\'t be met', () => {
    const sim = new Sim(createInitialState(7));
    expect(sim.keepers.visible('pylon')).toBe(false);
    expect(sim.keepers.pulse('pylon')).toBe(false);
    expect(sim.keepers.interact('pylon')).toBe('none');
    // the beach is open from the start, so Tide can be met
    expect(sim.keepers.visible('tide')).toBe(true);
  });

  it('one request is pinned in the objective card; the rest wait in the list', () => {
    const sim = mastRowOpen();
    expect(oldCityObjective(sim).title).toMatch(/Fountain step 2/);
    sim.keepers.pulse('pylon');
    sim.inventory.add('scrap', 5);
    sim.keepers.interact('pylon');
    expect(oldCityObjective(sim).title).toBe("🤖 Pylon's request");
    expect(oldCityObjective(sim).pct).toBe('Bring Pylon 8 Seeds.');
    sim.bot = { roofId: GROUND, x: 10.5, z: 20.5 };
    sim.keepers.pulse('tide');
    sim.inventory.add('scrap', 5);
    sim.keepers.interact('tide');
    expect(sim.keepers.requests().map((r) => r.id)).toEqual(['pylon', 'tide']);
  });

  it('every request names materials found in an earlier or the same ring, never only in the Keeper\'s own region', () => {
    for (const k of KEEPERS) {
      const ring = regionById(k.region)!.ring;
      for (const m of Object.keys(k.request1) as MaterialId[]) {
        const homes = MATERIALS[m].home.filter((h) => h === 'park' || (regionById(h) && regionById(h)!.ring <= ring && h !== k.region));
        expect(homes.length, `${k.id} wants ${m}`).toBeGreaterThan(0);
      }
    }
    // the Pylon's 8 Seeds: the park holds enough after tier 1 takes 6
    const sim = new Sim(createInitialState(7));
    expect(sim.salvage.looseLeft('seeds', 'park') - 6).toBeGreaterThanOrEqual(8);
  });

  it('all ten Keepers have their words, a tint, a prop and a model name; none stands in fog or on a blocked tile', () => {
    const sim = new Sim(createInitialState(7));
    const w = new Walker(sim);
    for (const k of KEEPERS) {
      for (const lines of Object.values(k.say)) {
        expect(lines.length, k.id).toBeGreaterThanOrEqual(1);
        expect(lines.length, k.id).toBeLessThanOrEqual(3);
        for (const l of lines) expect(l.length).toBeGreaterThan(8);
      }
      expect(k.tint).toMatch(/^#[0-9a-f]{6}$/);
      expect(k.prop).toBeTruthy();
      expect(MODEL_NAMES[`keeper-${k.id}`]).toBeDefined();
      // its own tile is its stand; around it open ground of its own region
      const t = sim.grid.get(GROUND, k.x, k.z)!;
      expect(t.prop).toBe(`keeper:${k.id}`);
      expect(sim.areas.map.areaOfCell(k.x, k.z)).toBe(k.region);
      sim.state.areas[k.region] = { fog: 'thinning', revealedAt: 0 };
      const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => w.walkable(GROUND, k.x + dx, k.z + dz));
      expect(free, `${k.id} can be reached`).toBe(true);
      expect(AREA_TYPES[sim.areas.info(k.region).type]).toBeDefined();
    }
    expect(KEEPERS).toHaveLength(10);
  });
});
