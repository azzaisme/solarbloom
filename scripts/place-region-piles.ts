// E23.8 (#327–#329): lays out each region's salvage piles on its real generated ground, for data/oldcity.ts.
//   npx vite-node scripts/place-region-piles.ts [regionId ...]
// Prints `P(...)` lines to paste into a region's `piles`. Deterministic: the same ground gives the same cells.
// A pile goes only on open, reachable ground: a walkable cell whose eight neighbours are walkable too (so a pile
// never closes a path), off roads, ramps and shallow water, clear of the region's set pieces, at least three cells from any other
// pile, and spread out across the region (farthest-point sampling from the Keeper).
import { createInitialState, GROUND } from '../src/core/GameState';
import { regionOfCell } from '../src/core/OldCityLayout';
import { KEEPERS, REGIONS, type RegionDef } from '../src/data/oldcity';
import { MATERIALS, type PileSize } from '../src/data/salvage';
import type { MaterialId } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';

/**
 * What each region holds in all: piles of its rich material(s) by size, and Scrap. Numbers from #327–#329.
 * Piles already in the region's data count toward these, so the script only lays what is missing.
 */
const PLAN: Partial<Record<string, { mats: [MaterialId, Record<PileSize, number>][]; scrap: Record<PileSize, number>; prefix: string }>> = {
  // ring 1: 120 of its material (2 large, 4 medium, 4 small), about 80 Scrap (1 large, 3 medium, 3 small = 78)
  // E23.1.4's six glass piles (om-g1..om-g6) count toward the 120
  oldMarket: { prefix: 'om', mats: [['glass', { large: 3, medium: 2, small: 4 }]], scrap: { large: 1, medium: 3, small: 3 } },
  // and sunstone pebbles in the tide line (30): sun cells for the lights known from the start, and Fern's 15 by tier 2
  saltwind: { prefix: 'sw', mats: [['timber', { large: 2, medium: 4, small: 4 }], ['sunstone', { large: 0, medium: 1, small: 3 }]], scrap: { large: 1, medium: 3, small: 3 } },
  // and a little clay in the grove's soil, so pots and troughs can be made before Cistern Basin (30)
  elderGrove: { prefix: 'eg', mats: [['seeds', { large: 2, medium: 4, small: 4 }], ['clay', { large: 0, medium: 1, small: 3 }]], scrap: { large: 1, medium: 3, small: 3 } },
  // ring 2: 160 of its material (3 large, 5 medium, 5 small = 162)
  cistern: { prefix: 'cb', mats: [['clay', { large: 3, medium: 5, small: 5 }]], scrap: { large: 1, medium: 3, small: 3 } },
  clockPlaza: { prefix: 'cp', mats: [['gears', { large: 3, medium: 5, small: 5 }]], scrap: { large: 1, medium: 3, small: 3 } },
  terraces: { prefix: 'te', mats: [['sunstone', { large: 3, medium: 5, small: 5 }]], scrap: { large: 1, medium: 3, small: 3 } },
  // ring 3: 200 of each rich material (5 large, 4 medium, 6 small = 204)
  glasshouse: { prefix: 'gh', mats: [['seeds', { large: 5, medium: 4, small: 6 }], ['glass', { large: 5, medium: 4, small: 6 }]], scrap: { large: 1, medium: 3, small: 3 } },
  observatory: { prefix: 'ob', mats: [['copper', { large: 5, medium: 4, small: 6 }], ['sunstone', { large: 5, medium: 4, small: 6 }]], scrap: { large: 1, medium: 3, small: 3 } },
  spireHeights: { prefix: 'sh', mats: [['gears', { large: 5, medium: 4, small: 6 }]], scrap: { large: 1, medium: 3, small: 3 } },
};

const SCRAP_MODELS = ['rubble-pile', 'crate', 'stone-block'];
const SIZES: PileSize[] = ['large', 'medium', 'small'];

const sim = new Sim(createInitialState(7));
sim.state.salvage!.abilities = ['pry', 'hover', 'climb', 'glide'];
for (const r of REGIONS) sim.state.areas[r.id] = { fog: 'thinning', revealedAt: 0 };
// every gate open (barricades pried, the bridge mended): piles go anywhere a player can walk by the end
for (const r of REGIONS)
  for (const [x, z] of r.gate.cells) {
    const t = sim.grid.get(GROUND, x, z)!;
    t.blocked = false;
    t.unblocked = true;
  }
const w = new Walker(sim);

function place(r: RegionDef) {
  const plan = PLAN[r.id];
  if (!plan) return console.log(`// ${r.id}: no plan`);
  const keeper = KEEPERS.find((k) => k.region === r.id)!;
  const x0 = r.chunks.x0 * 16, x1 = (r.chunks.x1 + 1) * 16 - 1, z0 = r.chunks.z0 * 16, z1 = (r.chunks.z1 + 1) * 16 - 1;
  const inRegion = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && regionOfCell(x, z)?.id === r.id;
  // keep-clear cells: the region's set pieces, with a one-cell margin
  const clear = new Set<string>();
  const mark = (x: number, z: number, w = 1, d = 1, m = 1) => {
    for (let j = -m; j < d + m; j++) for (let i = -m; i < w + m; i++) clear.add(`${x + i},${z + j}`);
  };
  mark(keeper.x, keeper.z);
  mark(r.landmark.x, r.landmark.z, 2, 2);
  mark(r.seam.x, r.seam.z, 2, 2);
  mark(r.patch.x, r.patch.z, r.patch.w, r.patch.d);
  for (const s of [...r.caches, ...r.pages, r.lookout]) mark(s.x, s.z);
  for (const [x, z] of r.gate.cells) mark(x, z, 1, 1, 2);
  for (const l of [...r.ladders, ...r.perches]) { mark(l.x, l.z); mark(l.to[0], l.to[1]); }
  for (const rp of r.ramps) mark(rp.x, rp.z, rp.w, rp.d);
  for (const p of r.piles) mark(p.x, p.z, 1, 1, 2);
  // and the region's dressing and glide perches (E23.8)
  for (const d of r.dressing) mark(d.x, d.z);
  for (const g of r.glides) mark(g.x, g.z, 1, 1, 2);
  // reachable ground from beside the Keeper, on foot (round the coast and over opened gates too)
  const seen = new Set<string>();
  const queue: [number, number][] = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = keeper.x + dx, z = keeper.z + dz;
    if (w.walkable(GROUND, x, z)) { seen.add(`${x},${z}`); queue.push([x, z]); }
  }
  while (queue.length) {
    const [x, z] = queue.shift()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      const k = `${nx},${nz}`;
      if (seen.has(k) || Math.max(Math.abs(nx - keeper.x), Math.abs(nz - keeper.z)) > 96 || !w.walkable(GROUND, nx, nz) || !w.stepOk(GROUND, x, z, nx, nz)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  const open = (x: number, z: number) => {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!seen.has(`${x + i},${z + j}`)) return false;
    return true;
  };
  const cands: [number, number][] = [];
  for (const k of seen) {
    const [x, z] = k.split(',').map(Number);
    const t = sim.grid.get(GROUND, x, z)!;
    if (clear.has(k) || !inRegion(x, z) || t.feature === 'road' || t.feature === 'water' || t.ramp || !open(x, z)) continue;
    cands.push([x, z]);
  }
  cands.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const want: [MaterialId, PileSize][] = [];
  const have = (m: MaterialId, s: PileSize) => r.piles.filter((p) => p.material === m && p.size === s).length;
  for (const [m, n] of [...plan.mats, ['scrap', plan.scrap] as [MaterialId, Record<PileSize, number>]])
    for (const s of SIZES) for (let i = have(m, s); i < n[s]; i++) want.push([m, s]);
  // farthest-point sampling: each pile as far as it can be from the Keeper and every pile so far (≥ 3 cells)
  // the region's existing piles count as already chosen: new ones spread out from them too
  const chosen: [number, number][] = r.piles.map((p) => [p.x, p.z]);
  const before = chosen.length;
  const far = (x: number, z: number) => Math.min(Math.hypot(x - keeper.x, z - keeper.z) * 0.6, ...chosen.map(([a, b]) => Math.max(Math.abs(x - a), Math.abs(z - b))));
  for (let i = 0; i < want.length; i++) {
    let best: [number, number] | undefined;
    let bestD = -1;
    for (const c of cands) {
      if (chosen.some(([a, b]) => Math.max(Math.abs(c[0] - a), Math.abs(c[1] - b)) < 3)) continue;
      const d = far(c[0], c[1]);
      if (d > bestD) { bestD = d; best = c; }
    }
    if (!best) { console.log(`// ${r.id}: ran out of room after ${chosen.length - before} of ${want.length} (${cands.length} candidates)`); break; }
    chosen.push(best);
  }
  const counters: Record<string, number> = {};
  const lines = chosen.slice(before).map(([x, z], i) => {
    const [m, s] = want[i];
    const tag = ({ scrap: 's', seeds: 'e', sunstone: 'u' } as Record<string, string>)[m] ?? m[0];
    // numbered on from the region's existing piles of that material (om-g7 after om-g1..om-g6)
    const n = (counters[tag] = (counters[tag] ?? 0) + 1) + r.piles.filter((p) => p.material === m).length;
    const models = m === 'scrap' ? SCRAP_MODELS : MATERIALS[m].models;
    const model = models[(((x * 7 + z * 3) % models.length) + models.length) % models.length];
    return `      P('${plan.prefix}-${tag}${n}', ${x}, ${z}, '${m}', '${s}', '${model}'),`;
  });
  console.log(`// ${r.id}: ${cands.length} candidate cells, ${chosen.length - before} new piles`);
  console.log(lines.join('\n'));
}

const only = process.argv.slice(2);
for (const r of REGIONS) if (!only.length || only.includes(r.id)) if (PLAN[r.id]) place(r);
