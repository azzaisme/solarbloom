// E23.8 (#329): picks the optional glides back toward the park: a perch on a far region's high ground, and a
// landing lower down in a region nearer the fountain.
//   npx vite-node scripts/place-glides.ts
// The perch: open, reachable ground in the far region (every neighbour reached, so it never closes a path), off
// ramps, clear of set pieces, as near the fountain as that region's ground comes. The landing: open, reachable
// ground in the near region, lower than the perch, as near the fountain as a glide of at most MAX cells reaches.
import { createInitialState, GROUND } from '../src/core/GameState';
import { regionOfCell, setPieceAt } from '../src/core/OldCityLayout';
import { tileLevel } from '../src/core/Height';
import { KEEPERS, REGIONS, type RegionId } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';

const GLIDES: [string, RegionId, RegionId][] = [
  ['gl-observatory', 'observatory', 'mastRow'],
  ['gl-spire', 'spireHeights', 'elderGrove'],
  ['gl-glasshouse', 'glasshouse', 'elderGrove'],
];
const MAX = 24;
const FOUNTAIN = [8.5, 8.5];

const sim = new Sim(createInitialState(7));
sim.state.salvage!.abilities = ['pry', 'hover', 'climb', 'glide'];
for (const r of REGIONS) sim.state.areas[r.id] = { fog: 'thinning', revealedAt: 0 };
for (const r of REGIONS)
  for (const [x, z] of r.gate.cells) {
    const t = sim.grid.get(GROUND, x, z)!;
    t.blocked = false;
    t.unblocked = true;
  }
const w = new Walker(sim);

/** Open ground reached on foot from a region's Keeper. */
function openCells(id: RegionId): [number, number][] {
  const k = KEEPERS.find((q) => q.region === id)!;
  const seen = new Set<string>([`${k.x},${k.z}`]);
  const queue: [number, number][] = [[k.x, k.z]];
  while (queue.length) {
    const [x, z] = queue.shift()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      const key = `${nx},${nz}`;
      if (seen.has(key) || Math.max(Math.abs(nx - k.x), Math.abs(nz - k.z)) > 96 || !w.walkable(GROUND, nx, nz) || !w.stepOk(GROUND, x, z, nx, nz)) continue;
      seen.add(key);
      queue.push([nx, nz]);
    }
  }
  const out: [number, number][] = [];
  for (const key of seen) {
    const [x, z] = key.split(',').map(Number);
    const t = sim.grid.get(GROUND, x, z)!;
    if (regionOfCell(x, z)?.id !== id || t.ramp || t.feature === 'road' || t.feature === 'water') continue;
    let open = true;
    // every neighbour reached and free of set pieces (two cells round, so the perch stands clear)
    for (let j = -2; j <= 2 && open; j++) for (let i = -2; i <= 2 && open; i++) if (setPieceAt(x + i, z + j)) open = false;
    for (let j = -1; j <= 1 && open; j++) for (let i = -1; i <= 1 && open; i++) if (!seen.has(`${x + i},${z + j}`)) open = false;
    if (open) out.push([x, z]);
  }
  return out;
}

const fd = (x: number, z: number) => Math.hypot(x + 0.5 - FOUNTAIN[0], z + 0.5 - FOUNTAIN[1]);
for (const [id, from, to] of GLIDES) {
  const perches = openCells(from).sort((a, b) => fd(a[0], a[1]) - fd(b[0], b[1]));
  const lands = openCells(to);
  let best: { p: [number, number]; l: [number, number]; d: number } | undefined;
  for (const p of perches.slice(0, 60)) {
    const pl = tileLevel(p[0], p[1]);
    for (const l of lands) {
      if (tileLevel(l[0], l[1]) >= pl) continue;
      const len = Math.hypot(l[0] - p[0], l[1] - p[1]);
      if (len > MAX || len < 6) continue;
      const d = fd(l[0], l[1]) + len * 0.25;
      if (!best || d < best.d) best = { p, l, d };
    }
  }
  if (!best) console.log(`// ${id}: no glide from ${from} to ${to} within ${MAX}`);
  else console.log(`      { id: '${id}', x: ${best.p[0]}, z: ${best.p[1]}, to: [${best.l[0]}, ${best.l[1]}] }, // ${from} L${tileLevel(best.p[0], best.p[1])} → ${to} L${tileLevel(best.l[0], best.l[1])}, ${Math.hypot(best.l[0] - best.p[0], best.l[1] - best.p[1]).toFixed(1)} cells`);
}
