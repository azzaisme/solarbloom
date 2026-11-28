import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { TileData } from '../src/core/types';
import { PARK_SET, REGIONS } from '../src/data/oldcity';
import { LOAD_WHEEL, PULSE_LOAD, RARE_PLANTS, RIPPLE } from '../src/data/pulse';
import { MACHINE_RECIPES } from '../src/data/crafting';
import { faunaGoal } from '../src/gameplay/Ecosystem';
import { CAT_ANCHORS } from '../src/data/templates';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;
const oldSim = (seed = 7) => {
  return new Sim(createInitialState(seed)); // E23.1.4: a pulse costs only charge
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
/**
 * A dead tile `t` with a Pollinator Garden built beside it and dead ground all round: a pulse on `t` sets off a
 * real chain (the garden spreads the bloom to its neighbours). `avoid`: keep well clear of these tiles.
 */
function gardenSpot(sim: Sim, avoid: TileData[] = []): { t: TileData; garden: TileData } {
  const dead = sim.areas.tiles(PARK).filter((q) => q.ground === 'polluted' && !q.blocked && !q.occupantId && sim.restoration.checkPulse(q).ok);
  const open = (x: number, z: number) => dead.some((o) => o.x === x && o.z === z);
  const t = dead.find((q) => [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [1, 1], [1, -1]].every(([dx, dz]) => open(q.x + dx, q.z + dz)) && avoid.every((a) => Math.hypot(a.x - q.x, a.z - q.z) > 8))!;
  expect(t, 'an open dead spot for a garden').toBeTruthy();
  const garden = sim.grid.get(GROUND, t.x + 1, t.z)!;
  garden.ground = 'prepared';
  garden.pollution = 0;
  sim.grid.touch(garden);
  const recipe = MACHINE_RECIPES.find((r) => r.id === 'pollinator')!;
  sim.state.salvage!.tier = Math.max(sim.state.salvage!.tier ?? 0, ('tier' in recipe.unlock ? recipe.unlock.tier : 0)); // the garden is unlocked
  for (const [k, n] of Object.entries(recipe.cost)) pack(sim)[k] = (pack(sim)[k] ?? 0) + (n as number);
  expect(sim.build.place('pollinator', GROUND, garden.x, garden.z), 'the garden is built').toBeTruthy();
  return { t, garden };
}
/** Everything restored and grown from here on, in order. */
function watch(sim: Sim) {
  const restored: { tile: TileData; source: string; chainId: number }[] = [];
  const grownTiles: TileData[] = [];
  sim.bus.on('tile.restored', (e) => restored.push({ tile: e.tile, source: e.source, chainId: e.chainId }));
  sim.bus.on('tile.nurtured', (e) => grownTiles.push(e.tile));
  return { restored, grown: grownTiles };
}

describe('E23.2.2.1: the load wheel and its cost', () => {
  it('turns through nothing, seeds, rare seed and fertiliser', () => {
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
  });

  it('a pulse uses a little charge plus one unit of its load; when the load runs out it fires empty', () => {
    const sim = oldSim();
    const [a, b] = deadTiles(sim, 2);
    sim.inventory.add('seeds', 1);
    sim.pulseLoad.choose('seeds');
    const empties: string[] = [];
    sim.bus.on('pulse.loadEmpty', (e) => empties.push(e.load));
    const charge = sim.charge.value();
    expect(sim.restoration.pulse(a.id)).toBe(true);
    expect(sim.inventory.count('seeds')).toBe(0);
    expect(sim.charge.value()).toBeCloseTo(charge - 1);
    expect(empties).toEqual(['seeds']);
    expect(a.plant).toBe('meadow');
    // out of seeds: still a pulse, plain grass, nothing used
    expect(sim.pulseLoad.next().id).toBe('none');
    expect(sim.restoration.pulse(b.id)).toBe(true);
    expect(b.plant).toBeUndefined();
    expect(sim.pulseLoad.choice).toBe('seeds'); // the wheel keeps its choice for when seeds come back
  });
  it('the wheel is introduced once: the first time bloombot carries something to load', () => {
    const sim = oldSim();
    for (const k of Object.keys(pack(sim))) delete pack(sim)[k];
    expect(sim.pulseLoad.introDue()).toBe(false); // nothing to load yet: nothing to explain
    sim.inventory.add('seeds', 1);
    expect(sim.pulseLoad.introDue()).toBe(true);
    sim.pulseLoad.introduced();
    expect(sim.pulseLoad.introDue()).toBe(false); // once only
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(back.pulseLoad.introDue()).toBe(false); // and not again after a reload
    expect(LOAD_WHEEL.introSeconds).toBeGreaterThan(LOAD_WHEEL.showSeconds);
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
    (['none', 'seeds', 'rare', 'fertiliser'] as const).forEach((load, i) => {
      const t = tiles[i];
      sim.pulseLoad.choose(load);
      const reach = sim.restoration.footprint(t).length;
      sim.restoration.pulse(t.id);
      grown(sim);
      // biomass is gathered, never earned (E23.5.1): what clipping the grown tile gives
      results[load] = { plant: t.plant, bloom: t.bloom, reach, biomass: sim.gather.yieldOf(t) };
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
    // and at the same bloom, the load's own multiplier: a meadow gives more than plain flowered ground
    const meadow = tiles[1];
    const plainYield = sim.gather.yieldOf({ ...meadow, plant: undefined });
    expect(sim.gather.yieldOf(meadow)).toBe(Math.round(plainYield * PULSE_LOAD.seeds.biomass));
    expect(sim.gather.yieldOf(meadow)).toBeGreaterThan(plainYield);
    expect([pack(sim).seeds, pack(sim).rareSeed, pack(sim).fertiliser]).toEqual([4, 4, 4]);
  });

  it('the footprint grows what the pulse carried too, and the chain a loaded pulse sets off grows it', () => {
    const sim = oldSim();
    const { t } = gardenSpot(sim);
    const seen = watch(sim);
    sim.inventory.add('seeds', 2);
    sim.pulseLoad.choose('seeds');
    const fp = sim.restoration.footprint(t).map((f) => f.tile);
    expect(sim.restoration.pulse(t.id)).toBe(true);
    for (const nb of fp) expect(nb.plant).toBe('meadow');
    sim.advance(TUNING.pulse.growSeconds + 8);
    // the garden beside it spread the bloom: every tile the chain restored is a meadow too
    const chained = seen.restored.filter((e) => e.source === 'pollinate');
    expect(chained.length).toBeGreaterThan(0);
    for (const e of chained) expect(e.tile.plant, `${e.tile.x},${e.tile.z}`).toBe('meadow');
    for (const e of chained) expect(e.tile.bloom).toBe(PULSE_LOAD.seeds.bloom);
    expect(pack(sim).seeds).toBe(1); // one unit, however far the chain ran
    // the chain is let go once it has ended
    expect(sim.restoration.plantedChains).toBe(0);
    // a pulse with nothing loaded grows plain grass, chain and all
    const sim2 = oldSim();
    const spot2 = gardenSpot(sim2);
    const seen2 = watch(sim2);
    sim2.restoration.pulse(spot2.t.id);
    sim2.advance(TUNING.pulse.growSeconds + 8);
    expect(seen2.restored.filter((e) => e.source === 'pollinate').length).toBeGreaterThan(0);
    for (const e of seen2.restored) expect(e.tile.plant).toBeUndefined();
  });

  it('a loaded pulse on living ground grows the load there, reaches further with fertiliser, and its chain carries it', () => {
    const sim = oldSim();
    const { t } = gardenSpot(sim);
    // the tile is already alive (plain grass)
    sim.restoration.complete(t, 'drone', undefined, true);
    expect([t.ground, t.bloom, t.plant]).toEqual(['restored', 1, undefined]);
    const seen = watch(sim);
    pack(sim).fertiliser = 2;
    sim.pulseLoad.choose('fertiliser');
    const reach = sim.restoration.footprint(t, false, PULSE_LOAD.fertiliser).map((f) => f.tile);
    expect(reach.length).toBeGreaterThan(0);
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(t.plant).toBe('grove');
    expect(t.bloom).toBe(PULSE_LOAD.fertiliser.bloom); // full bloom at once, not one level
    for (const nb of reach) expect(nb.plant).toBe('grove'); // the extra reach restores the dead ground round it
    sim.advance(TUNING.pulse.growSeconds + 8);
    for (const nb of reach) {
      expect(nb.ground).toBe('restored');
      expect(nb.bloom).toBeGreaterThanOrEqual(PULSE_LOAD.fertiliser.bloom); // full bloom (the chain may lift it further)
    }
    const chained = [...seen.restored.filter((e) => e.source === 'pollinate').map((e) => e.tile), ...seen.grown.filter((x) => x.id !== t.id)];
    expect(chained.length).toBeGreaterThan(0);
    for (const c of chained) expect(c.plant, `${c.x},${c.z}`).toBe('grove');
    expect(pack(sim).fertiliser).toBe(1);
  });

  it('a Mega Pulse grows its load too: where it lands and everything its wave restores', () => {
    for (const start of ['dead', 'living'] as const) {
      const sim = oldSim();
      const [t] = deadTiles(sim, 1);
      if (start === 'living') sim.restoration.complete(t, 'drone', undefined, true);
      sim.state.progression.coreActivated = true; // the fountain is awake: the Mega Pulse charges
      sim.state.progression.megaCharge = TUNING.mega.charge;
      expect(sim.restoration.megaReady()).toBe(true);
      const seen = watch(sim);
      sim.inventory.add('seeds', 3);
      sim.pulseLoad.choose('seeds');
      const targets = sim.restoration.megaTargets(t);
      expect(sim.restoration.playerPulse(t.id, targets)).toBe(true);
      expect(sim.restoration.megaReady()).toBe(false); // released
      sim.advance(20);
      const wave = seen.restored.filter((e) => e.source === 'mega');
      expect(wave.length, start).toBeGreaterThan(3);
      for (const e of wave) expect(e.tile.plant, `${start} ${e.tile.x},${e.tile.z}`).toBe('meadow');
      expect(t.plant, start).toBe('meadow');
      expect(t.bloom, start).toBeGreaterThanOrEqual(PULSE_LOAD.seeds.bloom);
      expect(pack(sim).seeds, start).toBe(2); // one unit used, and it grew something
    }
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
    // VFX 1: sensing sends it (with a short wait between); a pulse doesn't
    const fired: number[] = [];
    sim.bus.on('pulse.ripple', (e) => fired.push(e.targets.length));
    const [t] = deadTiles(sim, 1);
    sim.restoration.pulse(t.id);
    expect(fired.length).toBe(0);
    expect(sim.pulseLoad.sense(t)).toBe(true);
    expect(fired.length).toBe(1);
    expect(sim.pulseLoad.sense(t)).toBe(false);
    sim.advance(RIPPLE.senseCooldown + 0.1);
    expect(sim.pulseLoad.sense(t)).toBe(true);
    expect(fired.length).toBe(2);
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
        expect(['salvage', 'cache', 'page', 'buried']).toContain(g.kind);
        expect(catIds.has(g.id)).toBe(false);
        expect(catCells.has(`${g.x},${g.z}`)).toBe(false);
      }
    });
  });
});

describe('E23.2.2.3: buried seeds and salvage', () => {
  /** Buried finds within 40 tiles of the park's middle. */
  const finds = (sim: Sim) => sim.buried.near(8, 8, 40);

  it('lie in open ground only, about one tile in BURIED.oneIn, the same every time for a seed', () => {
    const a = finds(oldSim(7));
    const b = finds(oldSim(7));
    expect(a.length).toBeGreaterThan(5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const sim = oldSim(7);
    for (const f of a) {
      const t = sim.grid.get(GROUND, f.x, f.z)!;
      expect(t.blocked).toBe(false);
      expect(sim.grid.neighbors(t).some((n) => n.blocked && n.prop)).toBe(false); // never beside a cat's nook
    }
    expect(new Set(a.map((f) => f.material))).toEqual(new Set(['seeds', 'scrap']));
  });

  it('sensing reveals the ones in reach; a mound shows; Interact digs them up into the backpack (saved)', () => {
    const sim = oldSim(7);
    const f = finds(sim).find((q) => deadTiles(sim, 400).some((t) => Math.hypot(t.x - q.x, t.z - q.z) <= RIPPLE.radius))!;
    expect(f).toBeTruthy();
    expect(sim.buried.known(f.x, f.z)).toBeUndefined();
    expect(sim.buried.dig(f.x, f.z)).toBe(0); // unknown: nothing to dig
    const t = deadTiles(sim, 400).find((q) => Math.hypot(q.x - f.x, q.z - f.z) <= RIPPLE.radius)!;
    let targets: string[] = [];
    sim.bus.on('pulse.ripple', (e) => (targets = e.targets.map((g) => g.id)));
    sim.pulseLoad.sense(t);
    expect(targets).toContain(f.id);
    expect(sim.buried.known(f.x, f.z)?.id).toBe(f.id);
    const before = sim.inventory.count(f.material);
    expect(sim.buried.dig(f.x, f.z)).toBe(f.n);
    expect(sim.inventory.count(f.material)).toBe(before + f.n);
    expect(sim.buried.at(f.x, f.z)).toBeUndefined(); // dug: gone for good
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(back.buried.at(f.x, f.z)).toBeUndefined();
  });
});

describe('E23.2.2.2: each load has its own pollinator effect', () => {
  /** Pollinators an ecosystem recount finds after one pulse with this load, from a fresh game. */
  const after = (load: 'none' | 'seeds' | 'rare' | 'fertiliser') => {
    const sim = oldSim();
    sim.inventory.add('seeds', 1);
    pack(sim).rareSeed = 1;
    pack(sim).fertiliser = 1;
    sim.pulseLoad.choose(load);
    sim.restoration.pulse(deadTiles(sim, 1)[0].id);
    grown(sim);
    sim.ecosystem.refresh(true);
    return { pollinators: sim.ecosystem.bio.pollinators, rare: sim.ecosystem.bio.rarePollinators };
  };

  it('nothing draws none; seeds draw some; a rare seed draws rare ones too; fertiliser draws the most', () => {
    const none = after('none');
    const seeds = after('seeds');
    const rare = after('rare');
    const grove = after('fertiliser');
    expect(none).toEqual({ pollinators: 0, rare: 0 });
    expect(seeds.pollinators).toBeGreaterThan(0);
    expect(seeds.rare).toBe(0);
    expect(rare.rare).toBeGreaterThan(0); // hawk-moths come to rare plants only
    expect(grove.pollinators).toBeGreaterThan(seeds.pollinators);
    expect(grove.rare).toBe(0);
  });

  it('pollinators count toward the butterflies arriving', () => {
    const sim = oldSim();
    sim.ecosystem.refresh(true);
    const goal0 = faunaGoal('butterflies', sim.ecosystem.bio).have;
    sim.inventory.add('seeds', 1);
    sim.pulseLoad.choose('seeds');
    const [t] = deadTiles(sim, 1);
    const fp = sim.restoration.footprint(t).length;
    sim.restoration.pulse(t.id);
    grown(sim);
    sim.ecosystem.refresh(true);
    // every meadow tile blooms (stage 2) and draws PULSE_LOAD.seeds.pollinators more
    expect(faunaGoal('butterflies', sim.ecosystem.bio).have).toBe(goal0 + (fp + 1) * (1 + PULSE_LOAD.seeds.pollinators));
  });
});

describe('E23.2.2.2: rare plants and chains', () => {
  it('every region (and the park and backstreets) has its own rare plant, all different', () => {
    const ids = ['park', 'backstreet', ...REGIONS.map((r) => r.id)];
    for (const id of ids) expect(RARE_PLANTS[id], id).toBeTruthy();
    const names = ids.map((id) => RARE_PLANTS[id].name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every running chain keeps its plant (no cap) until it ends; what it grew survives a reload', () => {
    const sim = oldSim();
    sim.inventory.add('seeds', 40);
    sim.pulseLoad.choose('seeds');
    // several loaded pulses at once, far apart, and one beside a garden: all their chains run together
    const { t } = gardenSpot(sim);
    const seen = watch(sim);
    const fired = deadTiles(sim, 8).filter((q) => Math.hypot(q.x - t.x, q.z - t.z) > 8 && sim.restoration.pulse(q.id));
    expect(fired.length).toBeGreaterThanOrEqual(2);
    sim.restoration.pulse(t.id);
    let most = 0;
    for (let i = 0; i < 80; i++) {
      sim.advance(0.25);
      most = Math.max(most, sim.restoration.plantedChains);
    }
    expect(most).toBeGreaterThan(0); // a running chain is remembered
    const chained = seen.restored.filter((e) => e.source === 'pollinate');
    expect(chained.length).toBeGreaterThan(0);
    for (const e of seen.restored.filter((x) => x.source !== 'drone')) expect(e.tile.plant, `${e.tile.x},${e.tile.z}`).toBe('meadow'); // none dropped
    expect(sim.restoration.plantedChains).toBe(0); // all ended: nothing kept
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    for (const e of chained) expect(back.grid.get(GROUND, e.tile.x, e.tile.z)!.plant).toBe('meadow'); // what grew is on the tile
  });
});
