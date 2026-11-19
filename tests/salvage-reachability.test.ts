import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { regionOfCell } from '../src/core/OldCityLayout';
import type { MaterialId } from '../src/core/types';
import { COMPONENT_RECIPES, DECOR_RECIPES, MACHINE_RECIPES, type ItemCost, type Unlock } from '../src/data/crafting';
import { KEEPERS, PARK_SET, REGIONS, type RegionDef, type RegionId } from '../src/data/oldcity';
import { PROJECTS, type Find } from '../src/data/research';
import { MATERIALS, SALVAGE, TIERS } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';

/**
 * E23.8 (#327–#329): every region has salvage piles of its own material (and Scrap), on reachable ground, and the
 * whole game can be played from piles alone: no one-off finds, no Lucky Cats, no trading.
 *
 * The progression model (pure data):
 * - the fountain's tiers give abilities (Pry, Hover, Climb, Glide) and need landmarks woken and materials delivered
 * - a region is reachable when bloombot can pass its gate: a barricade with Pry, deep water with Hover, the lock
 *   bridge with Hover (or once the Sea Lock wakes), ladders with Climb, the cliff with Glide, the broken bridge
 *   once its repair materials can be gathered
 * - a Keeper can be woken when its region is reachable and its requests can be gathered from reachable piles
 * Then every crafting-table recipe (machines and decorations, and the components inside them) must be makeable from
 * the piles reachable by the time it unlocks (a recipe research gives: once its project can be paid for and run).
 * Research projects themselves may open before they are affordable (a goal to work toward), but never for good.
 */

const ABILITY_AT = (tier: number) => TIERS.filter((t) => t.tier <= tier && t.ability).map((t) => t.ability!);
const unitsOf = (piles: { material: MaterialId; size: keyof typeof SALVAGE.units }[], m: MaterialId) =>
  piles.filter((p) => p.material === m).reduce((a, p) => a + SALVAGE.units[p.size], 0);

/** Materials with piles in the park and in these regions (Biomass comes from restored ground anywhere). */
function pileable(regions: Iterable<RegionId>): Set<MaterialId> {
  const out = new Set<MaterialId>(['biomass']);
  for (const p of PARK_SET.piles) out.add(p.material);
  const ids = new Set(regions);
  for (const r of REGIONS) if (ids.has(r.id)) for (const p of r.piles) out.add(p.material);
  return out;
}

/** Regions reachable with these abilities and woken landmarks (the broken bridge: once its repair can be gathered). */
function reachable(abilities: string[], woken: Set<RegionId>): Set<RegionId> {
  const out = new Set<RegionId>();
  for (let changed = true; changed; ) {
    changed = false;
    const have = pileable(out);
    for (const r of REGIONS) {
      if (out.has(r.id)) continue;
      const n = r.gate.needs;
      let ok = false;
      if ('repair' in n && n.repair) ok = Object.keys(n.repair).every((m) => have.has(m as MaterialId));
      else if ('landmark' in n && n.landmark) ok = woken.has(n.landmark) || (!!n.ability && abilities.includes(n.ability));
      else if ('ability' in n && n.ability) ok = abilities.includes(n.ability);
      else ok = true;
      if (ok) {
        out.add(r.id);
        changed = true;
      }
    }
  }
  return out;
}

/** The raw materials a cost comes to, components opened up into what they are made of. */
function raw(cost: ItemCost, out = new Set<MaterialId>()): Set<MaterialId> {
  for (const id of Object.keys(cost)) {
    const comp = COMPONENT_RECIPES.find((c) => c.id === id);
    if (comp) raw(comp.cost, out);
    else out.add(id as MaterialId);
  }
  return out;
}

/** What the guaranteed reach is at each tier: the abilities alone (no landmark-dependent shortcuts). */
const G = (tier: number) => reachable(ABILITY_AT(tier), new Set());
const firstTier = (ok: (regions: Set<RegionId>) => boolean): number | undefined => [0, 1, 2, 3, 4, 5].find((t) => ok(G(t)));

/** The tier by which a recipe's unlock has happened (undefined: never). */
function unlockTier(u: Unlock | Find): number | undefined {
  if ('home' in u) return 1; // known from the start: makeable once bloombot is out of the park (the first fountain step)
  if ('tier' in u) return u.tier;
  if ('keeper' in u) return firstTier((g) => g.has(u.keeper));
  if ('find' in u || 'tech' in u) {
    const id = 'find' in u ? u.find : u.tech;
    const r = REGIONS.find((q) => q.caches.some((c) => c.id === id));
    return r ? firstTier((g) => g.has(r.id)) : 0;
  }
  if ('research' in u) return projectTier(u.research);
  if ('project' in u) return projectTier(u.project);
  if ('material' in u) return firstTier((g) => pileable(g).has(u.material));
  // a creature or a crop: comes with the restored world, after the first fountain steps
  return 2;
}

function projectTier(id: string): number | undefined {
  const p = PROJECTS.find((q) => q.id === id);
  if (!p) return undefined;
  const opens = unlockTier(p.opens);
  if (opens === undefined) return undefined;
  // a project can start only once its cost can be gathered: the later of the two
  const affordable = firstTier((g) => [...raw(p.cost)].every((m) => pileable(g).has(m)));
  return affordable === undefined ? undefined : Math.max(opens, affordable);
}

describe('E23.8 (#327–#329): every region has salvage piles of its own', () => {
  const RICH: Partial<Record<RegionId, { mats: MaterialId[]; units: number }>> = {
    mastRow: { mats: ['copper'], units: 120 },
    saltwind: { mats: ['timber'], units: 120 },
    elderGrove: { mats: ['seeds'], units: 120 },
    oldMarket: { mats: ['glass'], units: 120 },
    cistern: { mats: ['clay'], units: 160 },
    clockPlaza: { mats: ['gears'], units: 160 },
    terraces: { mats: ['sunstone'], units: 160 },
    glasshouse: { mats: ['seeds', 'glass'], units: 200 },
    observatory: { mats: ['copper', 'sunstone'], units: 200 },
    spireHeights: { mats: ['gears'], units: 200 },
  };

  it('each region holds its rich material (120 ring 1, 160 ring 2, 200 ring 3, piles round up) and about 80 Scrap', () => {
    for (const r of REGIONS) {
      const want = RICH[r.id]!;
      for (const m of want.mats) {
        expect(unitsOf(r.piles, m), `${r.id} ${m}`).toBeGreaterThanOrEqual(want.units - 6);
        expect(unitsOf(r.piles, m), `${r.id} ${m}`).toBeLessThanOrEqual(want.units + 6);
      }
      expect(unitsOf(r.piles, 'scrap'), `${r.id} scrap`).toBeGreaterThanOrEqual(78);
      // a material's `home` names every region that holds it (the build hints say where to look)
      for (const m of new Set(r.piles.map((p) => p.material))) expect(MATERIALS[m].home, `${m} home`).toContain(r.id);
      // each pile uses one of its material's models
      for (const p of r.piles) expect(MATERIALS[p.material].models, p.id).toContain(p.model);
    }
    const ids = REGIONS.flatMap((r) => r.piles.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every pile stands in its region, on its own cell, clear of the set pieces, and is reached on foot from the Keeper', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.abilities = ['pry', 'hover', 'climb', 'glide'];
    for (const r of REGIONS) sim.state.areas[r.id] = { fog: 'thinning', revealedAt: 0 };
    // every gate opened, as by the time a player has every ability (barricades pried, the bridge mended)
    for (const r of REGIONS)
      for (const [x, z] of r.gate.cells) {
        const t = sim.grid.get(GROUND, x, z)!;
        t.blocked = false;
        t.unblocked = true;
      }
    const w = new Walker(sim);
    const busy = (r: RegionDef) => {
      const k = KEEPERS.find((q) => q.region === r.id)!;
      const s = new Set<string>([`${k.x},${k.z}`, `${r.lookout.x},${r.lookout.z}`]);
      for (const c of [...r.caches, ...r.pages]) s.add(`${c.x},${c.z}`);
      for (const [x, z] of r.gate.cells) s.add(`${x},${z}`);
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) s.add(`${r.landmark.x + i},${r.landmark.z + j}`).add(`${r.seam.x + i},${r.seam.z + j}`);
      for (let j = 0; j < r.patch.d; j++) for (let i = 0; i < r.patch.w; i++) s.add(`${r.patch.x + i},${r.patch.z + j}`);
      return s;
    };
    for (const r of REGIONS) {
      if (!r.piles.length) continue;
      const k = KEEPERS.find((q) => q.region === r.id)!;
      const taken = busy(r);
      // everything walkable from beside the Keeper (round the coast too), with the piles standing (they block)
      const seen = new Set<string>();
      const queue: [number, number][] = [];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        if (w.walkable(GROUND, k.x + dx, k.z + dz)) {
          seen.add(`${k.x + dx},${k.z + dz}`);
          queue.push([k.x + dx, k.z + dz]);
        }
      while (queue.length) {
        const [x, z] = queue.shift()!;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const nz = z + dz;
          const key = `${nx},${nz}`;
          if (seen.has(key) || Math.max(Math.abs(nx - k.x), Math.abs(nz - k.z)) > 96 || !w.walkable(GROUND, nx, nz) || !w.stepOk(GROUND, x, z, nx, nz)) continue;
          seen.add(key);
          queue.push([nx, nz]);
        }
      }
      const beside = (x: number, z: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => seen.has(`${x + dx},${z + dz}`));
      for (const p of r.piles) {
        expect(regionOfCell(p.x, p.z)?.id, p.id).toBe(r.id);
        expect(taken.has(`${p.x},${p.z}`), `${p.id} on a set piece`).toBe(false);
        expect(sim.grid.get(GROUND, p.x, p.z)!.prop, p.id).toBe(`pile:${p.id}`);
        expect(beside(p.x, p.z), `${p.id} can't be reached from ${k.name}`).toBe(true);
      }
      // the piles never cut off the Keeper's region: its caches, pages, lookout and patch are still reached
      for (const c of [...r.caches, ...r.pages, r.lookout]) if (regionOfCell(c.x, c.z)?.id === r.id) expect(beside(c.x, c.z), `${r.id} ${c.id}`).toBe(true);
    }
  });
});

describe('E23.8: the whole game from piles alone (no finds, no Lucky Cats, no trading)', () => {
  it('the fountain reaches the Great Bloom and every Keeper wakes, gathering only from piles', () => {
    let tier = 0;
    const woken = new Set<RegionId>();
    const steps: string[] = [];
    for (let changed = true; changed; ) {
      changed = false;
      const reach = reachable(ABILITY_AT(tier), woken);
      const have = pileable(reach);
      for (const k of KEEPERS) {
        if (woken.has(k.region) || !reach.has(k.region)) continue;
        const needs = [...Object.keys(k.request1), ...Object.keys(k.landmark)] as MaterialId[];
        if (needs.every((m) => have.has(m))) {
          woken.add(k.region);
          steps.push(`wake ${k.region}`);
          changed = true;
        }
      }
      const next = TIERS.find((t) => t.tier === tier + 1);
      if (next) {
        const landmarks = next.needs.landmarks ?? 0;
        const items = next.items ?? [];
        const itemsOk = items.every((i) => (i === 'heartSeed' ? woken.has('glasshouse') : i === 'starLens' ? woken.has('observatory') : true));
        const delivered = (Object.keys(next.delivery) as MaterialId[]).every((m) => have.has(m));
        if (woken.size >= landmarks && delivered && itemsOk) {
          tier++;
          steps.push(`tier ${tier}`);
          changed = true;
        }
      }
    }
    expect(steps.join(' → '), 'progression').toContain('tier 5');
    expect([...woken].sort()).toEqual(REGIONS.map((r) => r.id).sort());
  });

  /** Units lying in piles in the park and these regions (biomass: restored ground, never short). */
  const unitsIn = (regions: Set<RegionId>, m: MaterialId) =>
    m === 'biomass' ? Infinity : unitsOf(PARK_SET.piles, m) + REGIONS.filter((r) => regions.has(r.id)).reduce((a, r) => a + unitsOf(r.piles, m), 0);

  it('every Keeper request (the first ask and the landmark) can be gathered from piles the moment its region opens', () => {
    const short: string[] = [];
    for (const k of KEEPERS) {
      // the earliest fountain tier at which bloombot can surely walk to the Keeper (abilities alone)
      const at = firstTier((g) => g.has(k.region));
      if (at === undefined) {
        short.push(`${k.name}: ${k.region} is never reached`);
        continue;
      }
      const reach = G(at);
      for (const [what, cost] of [['asks', k.request1], ['landmark', k.landmark]] as const)
        for (const [m, n] of Object.entries(cost) as [MaterialId, number][])
          if (unitsIn(reach, m) < n) short.push(`${k.name} ${what} ${n} ${m} at tier ${at}: piles hold ${unitsIn(reach, m)}`);
    }
    expect(short).toEqual([]);
  });

  it('every fountain delivery can be gathered from piles reachable before that step', () => {
    for (const t of TIERS) {
      const reach = G(t.tier - 1);
      for (const [m, n] of Object.entries(t.delivery) as [MaterialId, number][])
        expect(unitsIn(reach, m), `tier ${t.tier} needs ${n} ${m}`).toBeGreaterThanOrEqual(n);
    }
  });

  /** Every recipe whose materials can't be gathered from piles by the time it unlocks: [what, tier, missing]. */
  function late(): [string, number | string, string][] {
    const out: [string, number | string, string][] = [];
    const check = (what: string, cost: ItemCost, at: number | undefined) => {
      if (at === undefined) return out.push([what, 'never', 'its unlock is never reached']);
      const have = pileable(G(at));
      const missing = [...raw(cost)].filter((m) => !have.has(m));
      if (missing.length) out.push([what, at, missing.join(', ')]);
    };
    for (const r of MACHINE_RECIPES) check(`machine ${r.id}`, r.cost, unlockTier(r.unlock));
    for (const r of DECOR_RECIPES) check(`decoration ${r.id}`, r.cost, unlockTier(r.unlock));
    return out;
  }

  it('every crafting-table recipe can be made from piles by the time it unlocks', () => {
    const l = late();
    if (l.length) console.log(l.map((x) => x.join(' | ')).join('\n'));
    expect(l).toEqual([]);
  });

  it('every component and every research project can be paid for from piles (a project may open before it is affordable: it is something to work toward)', () => {
    const all = pileable(REGIONS.map((r) => r.id));
    for (const c of COMPONENT_RECIPES) for (const m of raw(c.cost)) expect(all.has(m), `${c.id} needs ${m}`).toBe(true);
    for (const p of PROJECTS) {
      for (const m of raw(p.cost)) expect(all.has(m), `${p.id} needs ${m}`).toBe(true);
      expect(projectTier(p.id), `${p.id} is never affordable`).toBeDefined();
    }
  });
});
