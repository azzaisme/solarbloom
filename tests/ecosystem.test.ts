import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState } from '../src/core/GameState';
import type { TileData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { biodiversity, type BioCounts, FAUNA, type FaunaId } from '../src/gameplay/Ecosystem';
import { Sim } from '../src/gameplay/Sim';
import { treeSpot } from '../src/rendering/TreePlacement';
import { CAT_ANCHOR_CLEARANCE, catSpots, machineRunning, tilesIn, wanderStop } from '../src/rendering/FaunaPlan';
import { CAT_ANCHORS } from '../src/data/templates';
import faunaSrc from '../src/rendering/Fauna.ts?raw';
import planSrc from '../src/rendering/FaunaPlan.ts?raw';
import butterfliesSrc from '../src/rendering/Butterflies.ts?raw';
import birdsSrc from '../src/rendering/Birds.ts?raw';
import { mmss, runBot } from './bots';
import { GROUND } from './helpers';

/** Phase 5 E16: biodiversity (derived, never spent) and one-time fauna unlocks (cosmetic). */

const F = TUNING.ecosystem.fauna;

function freshSim(seed = 7) {
  return new Sim(createInitialState(seed));
}

/** Park lawn tiles that grow no tree (so blooms there never count as tree tiles). */
function parkTiles(sim: Sim) {
  return sim.areas.tiles(PARK).filter((t) => !t.blocked && !t.occupantId && (t.feature ?? 'lawn') !== 'water');
}

function setBloom(sim: Sim, t: TileData, bloom: number) {
  t.ground = bloom > 0 ? 'restored' : 'polluted';
  t.bloom = bloom;
  t.pollution = bloom > 0 ? 0 : 100;
  sim.grid.touch(t);
}

/** What the economy, the map and the stats look like (everything a cosmetic system must never change). */
function gameplaySnapshot(sim: Sim) {
  const s = sim.state;
  return JSON.stringify({
    resources: s.resources,
    caps: s.caps,
    machines: s.machines,
    drones: s.drones,
    stats: s.stats,
    upgrades: s.upgrades,
    buffs: s.buffs,
    frenzy: s.frenzy,
    areas: s.areas,
    progression: s.progression,
    cat: s.cat,
    rng: s.rngState,
    tiles: sim.grid.loadedChunks().map((c) => c.tiles.map((t) => (t ? `${t.ground}${t.bloom}${Math.round(t.pollution)}` : '-')).join('')),
  });
}

const counts = (o: Partial<BioCounts>): BioCounts => ({ stages: [0, 0, 0, 0, 0], thrivingTrees: 0, species: 0, features: 0, water: 0, landmarks: 0, supers: 0, fountain: false, ...o });

describe('E16 biodiversity score', () => {
  it('is derived from stages, diversity, landmarks, superstructures and fauna, and ranks rise with it', () => {
    const W = TUNING.ecosystem.score;
    expect(biodiversity(counts({}), 0).score).toBe(0);
    expect(biodiversity(counts({}), 0).rank).toBe('Barren');
    // A Radiant tile is worth more than a Thriving one, which is worth more than a Blooming one…
    const one = (stage: number) => biodiversity(counts({ stages: [0, 0, 0, 0, 0].map((_, i) => (i === stage ? 100 : 0)) as BioCounts['stages'] }), 0).score;
    expect(one(1)).toBeLessThan(one(2));
    expect(one(2)).toBeLessThan(one(3));
    expect(one(3)).toBeLessThan(one(4));
    // …and diversity, landmarks, superstructures and fauna each add their own weight.
    const b = biodiversity(counts({ species: 3, features: 2, landmarks: 1, supers: 1 }), 2);
    expect(b.parts).toEqual({ stages: 0, species: 3 * W.species, features: 2 * W.feature, landmarks: W.landmark, supers: W.superstructure, fauna: 2 * W.fauna });
    expect(b.score).toBe(3 * W.species + 2 * W.feature + W.landmark + W.superstructure + 2 * W.fauna);
    expect(b.next).toBeDefined();
    const top = TUNING.ecosystem.ranks[TUNING.ecosystem.ranks.length - 1];
    expect(biodiversity(counts({ stages: [0, 0, 0, 0, top[0]] }), 0)).toMatchObject({ rank: top[1], next: undefined });
  });

  it('follows the world: restoring and growing tiles raises it, and it is the same after a save and load', () => {
    const sim = freshSim();
    sim.ecosystem.refresh(true);
    const before = sim.ecosystem.score().score;
    const tiles = parkTiles(sim).slice(0, 30);
    for (const t of tiles) setBloom(sim, t, 1);
    sim.ecosystem.refresh();
    const restored = sim.ecosystem.score().score;
    expect(restored).toBeGreaterThan(before);
    for (const t of tiles) setBloom(sim, t, 4);
    sim.ecosystem.refresh();
    const radiant = sim.ecosystem.score();
    expect(radiant.score).toBeGreaterThan(restored);
    expect(sim.ecosystem.bio.stages[4]).toBe(30);
    // Round trip: the copy loads its saved chunks lazily; the estimate from packed data gives the same counts.
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    copy.ecosystem.refresh(true);
    expect(copy.ecosystem.bio).toEqual(sim.ecosystem.bio);
    expect(copy.ecosystem.score().score).toBe(radiant.score);
  });
});

describe('E16 fauna unlocks', () => {
  it(`butterflies arrive at ${F.butterflies.bloomingTiles} blooming tiles, not one before`, () => {
    const sim = freshSim();
    const lawn = parkTiles(sim).filter((t) => !treeSpot(t, 'park'));
    let events = 0;
    sim.bus.on('fauna.unlocked', ({ id }) => id === 'butterflies' && events++);
    for (const t of lawn.slice(0, F.butterflies.bloomingTiles - 1)) setBloom(sim, t, 2);
    sim.ecosystem.refresh();
    expect(sim.ecosystem.has('butterflies')).toBe(false);
    setBloom(sim, lawn[F.butterflies.bloomingTiles - 1], 2);
    sim.ecosystem.refresh();
    expect(sim.ecosystem.has('butterflies')).toBe(true);
    expect(events).toBe(1);
  });

  it(`birds arrive at ${F.birds.thrivingTreeTiles} thriving tree tiles, and the park has enough tree tiles`, () => {
    const sim = freshSim();
    const trees = parkTiles(sim).filter((t) => treeSpot(t, 'park'));
    expect(trees.length).toBeGreaterThanOrEqual(F.birds.thrivingTreeTiles); // reachable in the starting park alone
    for (const t of trees.slice(0, F.birds.thrivingTreeTiles - 1)) setBloom(sim, t, 3);
    sim.ecosystem.refresh();
    expect(sim.ecosystem.has('birds')).toBe(false);
    setBloom(sim, trees[F.birds.thrivingTreeTiles - 1], 3);
    sim.ecosystem.refresh();
    expect(sim.ecosystem.has('birds')).toBe(true);
  });

  it('koi arrive when the fountain flows; robots with the first finished superstructure', () => {
    const sim = freshSim();
    sim.ecosystem.refresh();
    expect(sim.ecosystem.has('koi')).toBe(false);
    sim.state.progression.coreActivated = true;
    sim.ecosystem.refresh();
    expect(sim.ecosystem.has('koi')).toBe(true);
    expect(sim.ecosystem.has('robots')).toBe(false);
    // A superstructure still under construction doesn't count…
    const spot = parkTiles(sim)[0];
    const m = { id: 'mX', type: 'solar' as const, roofId: GROUND, x: spot.x, z: spot.z, size: 2, boostUntil: 0, timer: 0, charge: 0, tier: 3, project: { stage: 2, costs: [] } };
    sim.state.machines.push(m);
    sim.ecosystem.refresh();
    expect(sim.ecosystem.has('robots')).toBe(false);
    // …a finished one does.
    delete (m as { project?: unknown }).project;
    sim.ecosystem.refresh();
    expect(sim.ecosystem.has('robots')).toBe(true);
    expect(sim.ecosystem.unlocked()).toEqual(['koi', 'robots']);
  });

  it('each kind unlocks once, stays when its condition lapses, and survives a save and load without a second event', () => {
    const sim = freshSim();
    const lawn = parkTiles(sim).slice(0, F.butterflies.bloomingTiles);
    const seen: FaunaId[] = [];
    sim.bus.on('fauna.unlocked', ({ id }) => seen.push(id));
    for (const t of lawn) setBloom(sim, t, 2);
    sim.advance(2); // through the normal tick
    expect(seen).toEqual(['butterflies']);
    const at = sim.state.fauna!.butterflies!;
    for (const t of lawn) setBloom(sim, t, 0);
    sim.advance(2);
    expect(sim.ecosystem.has('butterflies')).toBe(true);
    expect(sim.state.fauna!.butterflies).toBe(at);
    for (const t of lawn) setBloom(sim, t, 2);
    sim.advance(2);
    expect(seen).toEqual(['butterflies']);
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    const again: FaunaId[] = [];
    copy.bus.on('fauna.unlocked', ({ id }) => again.push(id));
    copy.advance(3);
    copy.ecosystem.refresh(true);
    expect(copy.ecosystem.unlocked()).toEqual(['butterflies']);
    expect(copy.state.fauna!.butterflies).toBe(at);
    expect(again).toEqual([]);
  });

  it('unlocking and counting never change resources, tiles, machines or stats', () => {
    const sim = freshSim();
    for (const t of parkTiles(sim)) setBloom(sim, t, 4);
    sim.state.progression.coreActivated = true;
    const before = gameplaySnapshot(sim);
    sim.ecosystem.refresh(true);
    sim.ecosystem.refresh();
    expect(sim.ecosystem.unlocked().length).toBeGreaterThanOrEqual(3);
    expect(gameplaySnapshot(sim)).toBe(before);
    sim.ecosystem.score(); // reading the score is free too
    expect(gameplaySnapshot(sim)).toBe(before);
  });

  it('a played session reaches butterflies, birds and koi (scripted bot, seed 7, not a person)', () => {
    const times: Partial<Record<FaunaId, number>> = {};
    const r = runBot({
      seed: 7,
      minutes: 30,
      onSecond: (sim) => {
        for (const id of FAUNA) if (sim.state.fauna?.[id] !== undefined && times[id] === undefined) times[id] = sim.state.fauna[id];
      },
    });
    console.log(`E16 fauna (bot seed 7, 30 min): ${FAUNA.map((id) => `${id} ${mmss(times[id])}`).join(' · ')} · fountain ${mmss(r.fountain)}`);
    expect(times.butterflies).toBeDefined();
    expect(times.birds).toBeDefined();
    expect(times.koi).toBeDefined();
    expect(times.butterflies!).toBeLessThan(times.birds!);
  }, 240_000);
});

describe('E16 cosmetic fauna (planning side; the renderer animates what it returns)', () => {
  const VIEW = { x0: -2, x1: 18, z0: -2, z1: 18 };

  it('wander routes are seeded: the same actor and leg always give the same stop, inside the allowed cells', () => {
    const ok = (x: number, z: number) => (x + z) % 2 === 0;
    const a = Array.from({ length: 20 }, (_, leg) => wanderStop(7, 3, leg, { x: 8, z: 8 }, 3, ok));
    const b = Array.from({ length: 20 }, (_, leg) => wanderStop(7, 3, leg, { x: 8, z: 8 }, 3, ok));
    expect(a).toEqual(b);
    expect(new Set(a.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`)).size).toBeGreaterThan(5); // it wanders
    for (const p of a) if (p.x !== 8 || p.z !== 8) expect(ok(Math.floor(p.x), Math.floor(p.z))).toBe(true);
    expect(wanderStop(8, 3, 1, { x: 8, z: 8 }, 3, ok)).not.toEqual(wanderStop(7, 3, 1, { x: 8, z: 8 }, 3, ok));
  });

  it('sleeping cats lie inside a machine footprint, away from every place a Lucky Cat can sit, within the cap', () => {
    const sim = freshSim();
    for (const t of parkTiles(sim)) setBloom(sim, t, 3);
    const s = sim.state;
    for (const k of ['energy', 'water', 'biomass'] as const) s.resources[k] = s.resources[k].add(1e9);
    s.caps.energy = s.caps.energy.add(1e9);
    s.caps.water = s.caps.water.add(1e9);
    let n = 0;
    for (const t of parkTiles(sim)) if (n < 40 && sim.build.place('solar', GROUND, t.x, t.z)) n++;
    expect(n).toBeGreaterThan(20);
    const spots = catSpots(sim, VIEW, 50);
    expect(spots.length).toBeGreaterThan(0);
    expect(catSpots(sim, VIEW, 3).length).toBeLessThanOrEqual(3);
    for (const c of spots) {
      const m = sim.machine(c.machineId)!;
      expect(c.x).toBeGreaterThan(m.x);
      expect(c.x).toBeLessThan(m.x + m.size);
      expect(c.z).toBeGreaterThan(m.z);
      expect(c.z).toBeLessThan(m.z + m.size);
      // the tile under it is occupied, so no Lucky Cat anchor (they need a free tile) can use it
      expect(sim.grid.get(GROUND, Math.floor(c.x), Math.floor(c.z))!.occupantId).toBe(m.id);
      for (const a of CAT_ANCHORS.filter((x) => x.roofId === GROUND)) expect(Math.hypot(a.pos[0] - c.x, a.pos[2] - c.z)).toBeGreaterThanOrEqual(CAT_ANCHOR_CLEARANCE);
    }
    for (const a of sim.cat.candidates()) for (const c of spots) if (a.roofId === GROUND) expect(Math.hypot(a.pos[0] - c.x, a.pos[2] - c.z)).toBeGreaterThanOrEqual(CAT_ANCHOR_CLEARANCE);
    expect(catSpots(sim, VIEW, 50)).toEqual(spots); // seeded: the same cats every time
  });

  it('planning fauna for many frames never changes resources, tiles, machines or stats', () => {
    const sim = freshSim();
    for (const t of parkTiles(sim)) setBloom(sim, t, 4);
    sim.state.progression.coreActivated = true;
    for (const k of ['energy', 'water', 'biomass'] as const) sim.state.resources[k] = sim.state.resources[k].add(1e6);
    for (const t of parkTiles(sim).slice(0, 12)) sim.build.place('condenser', GROUND, t.x, t.z);
    sim.ecosystem.refresh(true);
    const before = gameplaySnapshot(sim);
    for (let i = 0; i < 300; i++) {
      catSpots(sim, VIEW, 6);
      tilesIn(sim, VIEW, (t) => t.ground === 'restored' && t.bloom >= 2, 120);
      for (const m of sim.state.machines) machineRunning(sim, m);
      wanderStop(sim.state.seed, i, i, { x: 8, z: 8 }, 3, (x, z) => sim.grid.peek(GROUND, x, z)?.ground === 'restored');
      sim.ecosystem.score();
    }
    expect(gameplaySnapshot(sim)).toBe(before);
  });

  it('the fauna renderers have no way to grant anything: no economy, no events, no state writes', () => {
    for (const [f, src] of Object.entries({ faunaSrc, planSrc, butterfliesSrc, birdsSrc })) {
      expect(src.length, f).toBeGreaterThan(500);
      expect(src, f).not.toMatch(/\.econ\.(add|spend|pay|set)|resources\[|\.resources\.|bus\.emit|stats\.|state\.fauna\s*=|\.restoration\.|\.build\.place|\.upgrades\.purchase/);
    }
  });

  it('machines show active effects only while they really run', () => {
    const sim = freshSim();
    const solar = sim.state.machines.find((m) => m.type === 'solar')!;
    sim.state.resources.energy = sim.state.caps.energy; // full store: the panel's output is going nowhere
    expect(machineRunning(sim, solar)).toBe(false);
    sim.state.resources.energy = sim.state.caps.energy.mul(0.5);
    expect(machineRunning(sim, solar)).toBe(true);
    // a superstructure under construction never runs
    expect(machineRunning(sim, { ...solar, tier: 3, project: { stage: 1, costs: [] } })).toBe(false);
  });
});

describe('E16 quality tiers', () => {
  it('fauna caps are plain numbers per tier (low ≤ medium ≤ high), for the graphics tier selector to read', () => {
    const C = TUNING.ecosystem.caps;
    expect(Object.keys(C).sort()).toEqual(['high', 'low', 'medium']);
    for (const k of Object.keys(C.high) as (keyof typeof C.high)[]) {
      expect(C.low[k]).toBeLessThanOrEqual(C.medium[k]);
      expect(C.medium[k]).toBeLessThanOrEqual(C.high[k]);
      expect(C.low[k]).toBeGreaterThan(0);
    }
  });
});
