import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import { isMainlandCell, landingArea } from '../src/core/Mainland';
import { LAST_PAGE } from '../src/data/journal';
import { MAINLAND } from '../src/data/mainland';
import { REGIONS } from '../src/data/oldcity';
import { TIERS } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';
import type { MaterialId } from '../src/core/types';

SaveService.clock = () => 0;
const C = MAINLAND.causeway;

/** A game one delivery from the end: every region open and its landmark awake, tier 4. */
function nearTheEnd() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  const sv = sim.state.salvage!;
  sv.tier = TIERS.length - 1;
  sv.abilities.push('pry', 'hover', 'climb', 'glide');
  sim.areas.clear('park', true);
  for (const r of REGIONS) {
    sim.gates.open(r.gate.id, true);
    sim.gates.openRegion(r.id);
    sim.areas.clear(r.id, true);
  }
  sim.bot = { roofId: GROUND, x: 82.5, z: C.z1 + 0.5 };
  return sim;
}

/** What the last delivery does (without the 240 materials and two items it takes). */
function greatBloom(sim: Sim) {
  sim.state.salvage!.tier = TIERS.length;
  sim.bus.emit('fountain.tier', { tier: TIERS.length });
}

/**
 * A walk from Clock Plaza to the mainland, in two legs (bloombot's own route planner searches a bounded area, as its
 * clicks do): from the plaza east to the causeway's island end, and from there across the causeway onto the mainland.
 */
function walkToMainland(sim: Sim) {
  const w = new Walker(sim);
  const z = C.z1 + 0.5;
  const leg1 = w.path(GROUND, 82.5, z, (x, cz) => x === C.x0 - 2 && cz === C.z1, { x: C.x0 - 2, z: C.z1 });
  if (!leg1) return undefined;
  const leg2 = w.path(GROUND, C.x0 - 1.5, z, (x) => isMainlandCell(x) && x > MAINLAND.minChunkX * 16 + MAINLAND.shoreBand, { x: C.x1 + 4, z: C.z1 });
  return leg2 && [...leg1, ...leg2];
}

describe('E23.9.3: the Great Bloom ending', { timeout: 60_000 }, () => {
  it('the real last delivery plays it: 80 Sunstone, Glass and Seeds, the Heart Seed and the Star Lens, ten landmarks awake', () => {
    const sim = nearTheEnd();
    const t = TIERS[TIERS.length - 1];
    // the Heart Seed and the Star Lens come from Fern's and Vega's landmarks (their rewards)
    sim.landmarks.reward('heartSeed');
    sim.landmarks.reward('starLens');
    expect(sim.fountain.condition(t).done, 'every landmark awake').toBe(true);
    // bloombot carries the delivery and hands it in at the fountain
    for (const [m, n] of Object.entries(t.delivery) as [MaterialId, number][]) sim.inventory.add(m, n);
    const events: unknown[] = [];
    sim.bus.on('ending.bloomed', (e) => events.push(e));
    expect(sim.ending.bloomed).toBe(false);
    sim.fountain.giveAll();
    // the fountain reached its last tier by itself: the Great Bloom, his last page, the wildlife, the causeway
    expect(sim.state.salvage!.tier).toBe(TIERS.length);
    expect(sim.ending.bloomed).toBe(true);
    expect(events.length).toBe(1);
    expect(sim.journal.found(LAST_PAGE)).toBe(true);
    expect(Object.keys(sim.state.fauna ?? {}).length).toBe(4);
    expect(sim.mainland.opened).toBe(true);
    expect(walkToMainland(sim), 'a walk from the island onto the mainland').toBeDefined();
  });

  it('before the Great Bloom there is no way to the mainland; after it, bloombot walks there from Clock Plaza', () => {
    const sim = nearTheEnd();
    expect(sim.ending.bloomed).toBe(false);
    expect(walkToMainland(sim)).toBeUndefined();
    greatBloom(sim);
    expect(sim.ending.bloomed).toBe(true);
    const path = walkToMainland(sim);
    expect(path, 'a walk from the island onto the mainland').toBeDefined();
    // it crosses the causeway's broken middle, raised now
    expect(path!.some((p) => Math.floor(p.x) >= MAINLAND.broken.x0 && Math.floor(p.x) <= MAINLAND.broken.x1)).toBe(true);
    // the landing district is out of the cloud, the way there out of the fog
    expect(sim.areas.fog(landingArea())).not.toBe('hidden');
    expect(sim.areas.fog(sim.areas.map.areaOfCell(C.x0 - 1, C.z0))).toBe('cleared');
  });

  it('wildlife floods back, his last page arrives, and the mainland hears about it once', () => {
    const sim = nearTheEnd();
    const events: unknown[] = [];
    sim.bus.on('ending.bloomed', (e) => events.push(e));
    greatBloom(sim);
    expect(Object.keys(sim.state.fauna ?? {}).sort()).toEqual(['birds', 'butterflies', 'koi', 'robots']);
    expect(sim.journal.found(LAST_PAGE)).toBe(true);
    expect(events).toEqual([{ causewayEnd: { x: C.x1, z: C.z0 }, mainlandX: MAINLAND.minChunkX * 16 }]);
    expect(sim.ending.bloom()).toBe(false);
    expect(events.length).toBe(1);
  });

  it('the ending keeps through a save, byte for byte, and the way stays open', () => {
    const sim = nearTheEnd();
    greatBloom(sim);
    const saver = new SaveService(undefined);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(saver.serialize(back.state)).toBe(json);
    expect(back.ending.bloomed).toBe(true);
    back.bot = sim.bot;
    expect(walkToMainland(back)).toBeDefined();
  });
});
