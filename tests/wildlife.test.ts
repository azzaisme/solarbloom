import { readFileSync } from 'node:fs';
import { collection } from '../src/ui/BackpackModel';
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState } from '../src/core/GameState';
import type { PlantKind, TileData } from '../src/core/types';
import { DIVERSITY, ON_BOT, PERCH_FROM, TIERS, VISIT, VISIT_POINTS, VISITORS, type DiversityTier, type Perch } from '../src/data/wildlife';
import { Sim } from '../src/gameplay/Sim';
import { planVisits, tierOf } from '../src/gameplay/Wildlife';
import { treeSpot } from '../src/rendering/TreePlacement';

SaveService.clock = () => 0;
const oldSim = () => new Sim(createInitialState(7, 'oldcity'));
const parkBench = (sim: Sim) => sim.rest.benchAt(10, 6)!;

/** Open park ground, dead, with (or without) a tree spot, so a test controls exactly which kinds of plant grow. */
function ground(sim: Sim, n: number, trees = false): TileData[] {
  const type = sim.areas.info(PARK).type;
  return sim.areas
    .tiles(PARK)
    .filter((t) => t.ground === 'polluted' && !t.blocked && !t.occupantId && t.feature !== 'water' && !!treeSpot(t, type) === trees)
    .slice(0, n);
}
/** Grows tiles as a pulse would leave them (restored, at a bloom, with a plant), and lets the area know. */
function grow(sim: Sim, tiles: TileData[], bloom: number, plant?: PlantKind) {
  for (const t of tiles) {
    t.ground = 'restored';
    t.bloom = bloom;
    t.pollution = 0;
    if (plant) t.plant = plant;
    sim.grid.touch(t);
  }
}

/** The park at each tier, built from what grows there (the same steps always give the same park). */
function parkAt(tier: DiversityTier): Sim {
  const sim = oldSim();
  if (tier === 'bare') {
    grow(sim, ground(sim, DIVERSITY.minRestored - 1), 2); // too little restored to count yet
    return sim;
  }
  const g = ground(sim, 40);
  if (tier === 'variety') {
    grow(sim, g.slice(0, 6), 1); // grass
    grow(sim, g.slice(6, 10), 2); // and some wildflowers
    return sim;
  }
  grow(sim, g.slice(0, 5), 2);
  grow(sim, g.slice(5, 10), 3); // grass, wildflowers and shrubs, all in bloom
  if (tier === 'lively') return sim;
  grow(sim, g.slice(10, 14), 2, 'meadow');
  grow(sim, g.slice(14, 16), 3, 'grove');
  sim.state.fauna = { butterflies: 1, birds: 2 };
  if (tier === 'thriving') return sim;
  grow(sim, g.slice(16, 20), 2, 'rare');
  grow(sim, ground(sim, 3, true), 2); // trees of the park's species in bloom
  return sim;
}

describe('E23.2.4.1: the area diversity score', () => {
  it.each(TIERS.map((t) => [t]))('the park reaches %s, and the same park always gives the same tier', (tier) => {
    const a = parkAt(tier).wildlife.diversity(PARK);
    const b = parkAt(tier).wildlife.diversity(PARK);
    expect(a.tier).toBe(tier);
    expect(b).toEqual(a); // deterministic: same world, same score
  });

  it('counts kinds of plant, bloom, fauna, homes and pollinators; rare mix needs a rare plant among many kinds', () => {
    const sim = parkAt('thriving');
    const d = sim.wildlife.diversity(PARK);
    expect(d.kinds).toEqual(expect.arrayContaining(['grass', 'wildflowers', 'shrubs', 'meadow', 'grove']));
    expect(d.fauna).toBe(2);
    expect(d.bloomShare).toBe(1);
    expect(d.pollinators).toBeGreaterThan(0);
    // a wildlife home (E23.5.4.5's machines) adds to it
    const before = d.score;
    sim.state.machines.push({ ...sim.state.machines.find((m) => sim.areas.areaOf(m) === PARK)!, id: 'home-test', type: 'birdBox' } as never);
    expect(sim.wildlife.diversity(PARK).score).toBe(before + DIVERSITY.perHome);
    // a high score alone isn't a rare mix
    expect(tierOf(999, ['grass', 'wildflowers'])).toBe('thriving');
    expect(tierOf(999, ['grass', 'wildflowers', 'shrubs', 'meadow', 'grove', 'oak trees', 'cherry trees'])).toBe('thriving');
    expect(tierOf(999, ['grass', 'wildflowers', 'shrubs', 'meadow', 'grove', 'oak trees', 'rare plant'])).toBe('rare');
  });

  it('is recounted only when one of the area tiles changes', () => {
    const sim = parkAt('variety');
    const d1 = sim.wildlife.diversity(PARK);
    // more grows in the park: the next read sees it
    grow(sim, ground(sim, 20).slice(0, 10), 3);
    const d2 = sim.wildlife.diversity(PARK);
    expect(d2.restored).toBe(d1.restored + 10);
    expect(d2.score).toBeGreaterThan(d1.score);
    // reading again without a change gives the same answer, from the cache
    expect(sim.wildlife.diversity(PARK)).toEqual(d2);
  });
});

describe('E23.2.4.2: visits scale with diversity', () => {
  const tierOfPark = (sim: Sim) => sim.wildlife.diversity(PARK).tier;

  it('more come, and closer, the more diverse the area', () => {
    const counts: number[] = [];
    const onBotAt: boolean[] = [];
    for (const tier of TIERS) {
      // over many sittings, so the bare chance and who comes average out
      let most = 0;
      let climbed = false;
      for (let n = 0; n < 40; n++) {
        const v = planVisits(tier, `7|park|${n}`, 0, false);
        most = Math.max(most, v.length);
        climbed ||= v.some((x) => ON_BOT.includes(x.perch));
        for (const x of v) {
          expect(TIERS.indexOf(PERCH_FROM[x.perch])).toBeLessThanOrEqual(TIERS.indexOf(tier)); // never closer than the tier allows
          const def = VISITORS.find((d) => d.id === x.id)!;
          expect(TIERS.indexOf(def.from)).toBeLessThanOrEqual(TIERS.indexOf(tier));
          if (def.rare) expect(tier).toBe('rare');
        }
      }
      counts.push(most);
      onBotAt.push(climbed);
    }
    expect(counts).toEqual(TIERS.map((t) => VISIT.count[t])); // bare 1 … rare mix 7
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    // bare: only ever a butterfly passing; some variety: one lands on bloombot; thriving: they climb all over it
    expect(onBotAt).toEqual([false, true, true, true, true]);
    const thriving = Array.from({ length: 40 }, (_, n) => planVisits('thriving', `7|park|${n}`, 0, false)).flat();
    expect(thriving.some((v) => v.perch === 'beside')).toBe(true); // a fox (or otter) curls up beside it
    expect(thriving.some((v) => v.perch === 'lap')).toBe(true); // a frog in its lap
    expect(thriving.some((v) => v.perch === 'nest' || v.perch === 'head')).toBe(true); // birds on its head
    const rare = Array.from({ length: 40 }, (_, n) => planVisits('rare', `7|park|${n}`, 0, false)).flat();
    expect(rare.some((v) => VISITORS.find((d) => d.id === v.id)!.rare)).toBe(true); // rare visitors only here
    const bare = Array.from({ length: 40 }, (_, n) => planVisits('bare', `7|park|${n}`, 0, false));
    expect(bare.some((v) => v.length === 0)).toBe(true); // nothing, or a butterfly passes
    expect(bare.flat().every((v) => v.id === 'butterfly' && v.perch === 'passBy')).toBe(true);
  });

  it('the same sitting always brings the same visitors; one perch holds one visitor; owls only come at night', () => {
    expect(planVisits('thriving', 'k', 5, false)).toEqual(planVisits('thriving', 'k', 5, false));
    for (let n = 0; n < 40; n++) {
      const v = planVisits('rare', `7|park|${n}`, 0, n % 2 === 0);
      const single = v.filter((x) => ['head', 'nest', 'shoulderL', 'shoulderR', 'lap', 'landOn', 'beside'].includes(x.perch)).map((x) => x.perch);
      expect(new Set(single).size).toBe(single.length);
      expect(single.includes('head') && single.includes('nest')).toBe(false); // one bird on the head at a time
      if (n % 2 === 1) expect(v.some((x) => x.id === 'owl')).toBe(false);
    }
    const nights = Array.from({ length: 40 }, (_, n) => planVisits('thriving', `7|park|${n}`, 0, true)).flat();
    expect(nights.some((v) => v.id === 'owl')).toBe(true);
  });

  it('sitting on a bench: they come one after another, go in the log, and leave when bloombot stands', () => {
    const sim = parkAt('thriving');
    expect(tierOfPark(sim)).toBe('thriving');
    const b = parkBench(sim);
    sim.inventory.add('scrap', 3);
    sim.rest.mend(b);
    const arrived: string[] = [];
    sim.bus.on('wildlife.arrived', (e) => arrived.push(e.id));
    expect(sim.rest.sitOnBench(b)).toBe(true);
    const plan = sim.wildlife.visits.map((v) => v.id);
    expect(plan.length).toBeGreaterThan(0);
    expect(sim.wildlife.area).toBe(PARK);
    sim.advance(VISIT.first + VISIT.approach - 0.5);
    expect(arrived).toEqual([]); // still on its way
    sim.advance(VISIT.every * plan.length + 1);
    expect(arrived).toEqual(plan);
    const log = sim.state.wildlife!.log;
    for (const id of plan) expect(log[id]).toMatchObject({ count: 1, where: [PARK] });
    sim.rest.stand();
    expect(sim.wildlife.here()).toEqual([]);
    sim.advance(VISIT.leave + 0.5);
    expect(sim.wildlife.visits).toEqual([]);
    // the log saves
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(back.state.wildlife!.log).toEqual(log);
    expect(back.wildlife.logRows().filter((r) => r.seen).map((r) => r.def.id).sort()).toEqual([...new Set(plan)].sort());
    // the visitor log in the backpack (Collection → Visitors): who sat with bloombot, how often and where; the rest
    // keep their names to themselves
    const group = collection(back).find((g) => g.title === 'Visitors')!;
    const met = [...new Set(plan)];
    expect(group.count).toBe(`${met.length} of ${VISITORS.length}`);
    for (const id of met) {
      const d = VISITORS.find((v) => v.id === id)!;
      expect(group.rows.find((r) => r.name.endsWith(d.name))).toMatchObject({ found: true, detail: expect.stringMatching(/^Sat with you once, in the park/) });
    }
    expect(group.rows.filter((r) => !r.found).every((r) => r.name === 'Not met yet')).toBe(true);
    expect(group.rows.filter((r) => !r.found).length).toBe(VISITORS.length - met.length);
  });

  it('a second sitting brings a different mix, from the same tier', () => {
    const sim = parkAt('thriving');
    const b = parkBench(sim);
    sim.inventory.add('scrap', 3);
    sim.rest.mend(b);
    const plans: string[] = [];
    for (let i = 0; i < 6; i++) {
      sim.rest.sitOnBench(b);
      plans.push(sim.wildlife.visits.map((v) => `${v.id}@${v.perch}`).join());
      sim.rest.stand();
      sim.advance(VISIT.leave + 1);
    }
    expect(new Set(plans).size).toBeGreaterThan(1);
    expect(sim.state.wildlife!.sits).toBe(6);
  });

  it("at a charger too: visitors come while bloombot meditates", () => {
    const sim = parkAt('lively');
    const m = sim.state.machines.find((x) => sim.areas.areaOf(x) === PARK)!; // any park machine stands in for a charger
    sim.rest.meditate(m);
    expect(sim.wildlife.area).toBe(PARK);
    expect(sim.wildlife.visits.length).toBeGreaterThan(0);
  });

  it('visitors on bloombot are small enough for their perch: nothing sinks into its body', () => {
    for (const v of VISITORS)
      for (const p of v.perches) {
        if (!ON_BOT.includes(p) && p !== 'beside') continue;
        expect(v.size, `${v.id} at ${p}`).toBeLessThanOrEqual(VISIT_POINTS[p as Perch].clear);
      }
  });

  it('no visitor is a cat, and wildlife never reads the Lucky Cat system', () => {
    expect(VISITORS.some((v) => /cat/i.test(v.id) || /cat/i.test(v.name))).toBe(false);
    for (const f of ['../src/gameplay/Wildlife.ts', '../src/data/wildlife.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src).not.toMatch(/sim\.cat\b|\.cat\.|CAT_ANCHORS|catSpots|state\.cat\b/);
    }
  });

  it('classic rules: no visits', () => {
    const sim = new Sim(createInitialState(7));
    sim.wildlife.begin();
    expect(sim.wildlife.visits).toEqual([]);
  });
});
