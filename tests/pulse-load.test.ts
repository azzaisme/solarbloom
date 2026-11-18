import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { TileData } from '../src/core/types';
import { PARK_SET, REGIONS } from '../src/data/oldcity';
import { PULSE_LOAD, RIPPLE } from '../src/data/pulse';
import { CAT_ANCHORS } from '../src/data/templates';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;
const oldSim = (seed = 7) => {
  const sim = new Sim(createInitialState(seed, 'oldcity'));
  sim.econ.add('energy', 1e6);
  sim.econ.add('water', 1e6);
  return sim;
};
const pack = (sim: Sim) => sim.state.salvage!.pack as Record<string, number | undefined>;
/** Dead park tiles far apart, so one pulse never reaches another's tile. */
const deadTiles = (sim: Sim, n: number): TileData[] => {
  const out: TileData[] = [];
  for (const t of sim.areas.tiles(PARK)) {
    if (out.length >= n) break;
    if (t.ground !== 'polluted' || t.blocked || t.occupantId || !sim.restoration.checkPulse(t).ok) continue;
    if (out.every((o) => Math.hypot(o.x - t.x, o.z - t.z) > 8)) out.push(t);
  }
  return out;
};
const grown = (sim: Sim) => sim.advance(TUNING.pulse.growSeconds + 2);

describe('E23.2.2.1: the load wheel and its cost', () => {
  it('turns through nothing, seeds, rare seed and fertiliser; classic rules have no load', () => {
    const sim = oldSim();
    expect(sim.pulseLoad.choice).toBe('none');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      sim.pulseLoad.step(1);
      seen.push(sim.pulseLoad.choice);
    }
    expect(seen).toEqual(['seeds', 'rare', 'fertiliser', 'none']);
    sim.pulseLoad.step(-1);
    expect(sim.pulseLoad.choice).toBe('fertiliser');
    const classic = new Sim(createInitialState(7));
    classic.pulseLoad.choose('seeds');
    expect(classic.pulseLoad.choice).toBe('none');
  });

  it('a pulse uses a little charge plus one unit of its load; when the load runs out it fires empty', () => {
    const sim = oldSim();
    const [a, b] = deadTiles(sim, 2);
    sim.inventory.add('seeds', 1);
    sim.pulseLoad.choose('seeds');
    const empties: string[] = [];
    sim.bus.on('pulse.loadEmpty', (e) => empties.push(e.load));
    const charge = sim.charge.value;
    expect(sim.restoration.pulse(a.id)).toBe(true);
    expect(sim.inventory.count('seeds')).toBe(0);
    expect(sim.charge.value).toBeCloseTo(charge - 1);
    expect(empties).toEqual(['seeds']);
    expect(a.plant).toBe('meadow');
    // out of seeds: still a pulse, plain grass, nothing used
    expect(sim.pulseLoad.next().id).toBe('none');
    expect(sim.restoration.pulse(b.id)).toBe(true);
    expect(b.plant).toBeUndefined();
    expect(sim.pulseLoad.choice).toBe('seeds'); // the wheel keeps its choice for when seeds come back
  });
});

describe('E23.2.2.2: what grows from each load', () => {
  it('each load grows its own plant, bloom, biomass and reach', () => {
    const sim = oldSim();
    const tiles = deadTiles(sim, 4);
    expect(tiles.length).toBe(4);
    const results: Record<string, { plant?: string; bloom: number; reach: number; biomass: number }> = {};
    sim.inventory.add('seeds', 5);
    pack(sim).rareSeed = 5;
    pack(sim).fertiliser = 5;
    const paid = new Map<string, number>();
    sim.bus.on('tile.restored', (e) => paid.set(e.tile.id, e.biomass.toNumber()));
    (['none', 'seeds', 'rare', 'fertiliser'] as const).forEach((load, i) => {
      const t = tiles[i];
      sim.pulseLoad.choose(load);
      const reach = sim.restoration.footprint(t).length;
      sim.restoration.pulse(t.id);
      grown(sim);
      results[load] = { plant: t.plant, bloom: t.bloom, reach, biomass: paid.get(t.id) ?? 0 };
    });
    expect(results.none.plant).toBeUndefined();
    expect(results.seeds.plant).toBe('meadow');
    expect(results.rare.plant).toBe('rare');
    expect(results.fertiliser.plant).toBe('grove');
    expect(results.none.bloom).toBe(1);
    expect(results.seeds.bloom).toBe(PULSE_LOAD.seeds.bloom); // a meadow flowers at once (pollinators)
    expect(results.fertiliser.bloom).toBe(PULSE_LOAD.fertiliser.bloom); // trees and full bloom
    expect(results.fertiliser.reach).toBeGreaterThan(results.none.reach); // a bigger radius
    expect(results.seeds.biomass).toBeGreaterThan(results.none.biomass);
    expect(results.fertiliser.biomass).toBeGreaterThan(results.seeds.biomass);
    expect([pack(sim).seeds, pack(sim).rareSeed, pack(sim).fertiliser]).toEqual([4, 4, 4]);
  });

  it('the footprint grows what the pulse carried too, and chained tiles grow it', () => {
    const sim = oldSim();
    const [t] = deadTiles(sim, 1);
    sim.inventory.add('seeds', 2);
    sim.pulseLoad.choose('seeds');
    const fp = sim.restoration.footprint(t).map((f) => f.tile);
    sim.restoration.pulse(t.id);
    for (const nb of fp) expect(nb.plant).toBe('meadow');
    // a chain a seeds pulse set off (chain 42): every tile it restores or grows becomes a meadow
    grown(sim);
    (sim.restoration as unknown as { rememberChainPlant(id: number, k: string): void }).rememberChainPlant(42, 'meadow');
    const [dead] = deadTiles(sim, 1);
    sim.restoration.complete(dead, 'chain', 42);
    expect(dead.plant).toBe('meadow');
    const lawn = sim.areas.tiles(PARK).find((x) => x.ground === 'restored' && !x.plant && x.bloom < TUNING.restore.maxBloom)!;
    sim.restoration.grow(lawn, 42);
    expect(lawn.plant).toBe('meadow');
    // another chain (not loaded) grows plain grass
    const [plain] = deadTiles(sim, 1);
    sim.restoration.complete(plain, 'chain', 43);
    expect(plain.plant).toBeUndefined();
  });

  it('what grew is saved', () => {
    const sim = oldSim();
    const [t] = deadTiles(sim, 1);
    pack(sim).fertiliser = 1;
    sim.pulseLoad.choose('fertiliser');
    sim.restoration.pulse(t.id);
    grown(sim);
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    const bt = back.grid.get(GROUND, t.x, t.z)!;
    expect(bt.plant).toBe('grove');
    expect(bt.bloom).toBe(t.bloom);
    expect(back.pulseLoad.choice).toBe('fertiliser');
  });
});

describe('E23.2.2.3: the reveal ripple', () => {
  it('lights up nearby salvage, caches and pages, within its reach', () => {
    const sim = oldSim();
    const p = PARK_SET.piles[0];
    const targets = sim.pulseLoad.ripple({ roofId: GROUND, x: p.x + 1, z: p.z });
    expect(targets.some((g) => g.kind === 'salvage' && g.id === p.id)).toBe(true);
    for (const g of targets) expect(Math.hypot(g.x - p.x - 1, g.z - p.z)).toBeLessThanOrEqual(RIPPLE.radius + 1e-9);
    const page = PARK_SET.pages[0];
    expect(sim.pulseLoad.ripple({ roofId: GROUND, x: page.x, z: page.z }).some((g) => g.kind === 'page' && g.id === page.id)).toBe(true);
    const cache = REGIONS[0].caches[0];
    expect(sim.pulseLoad.ripple({ roofId: GROUND, x: cache.x, z: cache.z }).some((g) => g.kind === 'cache' && g.id === cache.id)).toBe(true);
    // a pulse sends it
    const fired: number[] = [];
    sim.bus.on('pulse.ripple', (e) => fired.push(e.targets.length));
    sim.restoration.pulse(deadTiles(sim, 1)[0].id);
    expect(fired.length).toBe(1);
  });

  it('never reveals a Lucky Cat: no target is a cat, and cats change nothing it shows', () => {
    const sim = oldSim();
    // every place a pulse could be fired from near a cat nook or a salvage target
    const centres = [...CAT_ANCHORS.filter((a) => a.roofId === GROUND).map((a) => ({ x: Math.floor(a.pos[0]), z: Math.floor(a.pos[2]) })), ...PARK_SET.piles, ...PARK_SET.pages];
    const before = centres.map((c) => JSON.stringify(sim.pulseLoad.ripple({ roofId: GROUND, ...c })));
    // hide a cat in every park nook at once
    const cats = CAT_ANCHORS.filter((a) => a.roofId === GROUND).map((a, i) => ({ id: `c${i + 1}`, anchorId: a.id, spawnedAt: 0, variant: 'standard' as const }));
    sim.state.cat.active = cats[0];
    sim.state.cat.invasion = cats.slice(1);
    expect(sim.cat.spots().length).toBe(cats.length);
    const catCells = new Set(CAT_ANCHORS.map((a) => `${Math.floor(a.pos[0])},${Math.floor(a.pos[2])}`));
    const catIds = new Set([...cats.map((c) => c.id), ...cats.map((c) => c.anchorId)]);
    centres.forEach((c, i) => {
      const targets = sim.pulseLoad.ripple({ roofId: GROUND, ...c });
      expect(JSON.stringify(targets)).toBe(before[i]); // the same with or without cats
      for (const g of targets) {
        expect(['salvage', 'cache', 'page']).toContain(g.kind);
        expect(catIds.has(g.id)).toBe(false);
        expect(catCells.has(`${g.x},${g.z}`)).toBe(false);
      }
    });
  });
});
