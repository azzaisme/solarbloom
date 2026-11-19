// E23.8: moves named piles to the nearest cell that meets place-region-piles.ts's rules, measured on the ground
// with the regions' piles taken away (so a pile that sits on a building or in the shallows can be found a home).
//   npx vite-node scripts/move-piles.ts mr-c4 sw-t1 ...
// Prints `id: (x, z) -> (x, z)` for each. The pile keeps its id, material, size and model.
import { REGIONS, KEEPERS } from '../src/data/oldcity';

const ids = process.argv.slice(2);
const all = REGIONS.flatMap((r) => r.piles.map((p) => ({ r, p })));
const moving = all.filter(({ p }) => ids.includes(p.id));
const staying = all.filter(({ p }) => !ids.includes(p.id)).map(({ p }) => p);
// the bare ground: no region piles (the set-piece index is built the first time it is asked, after this)
for (const r of REGIONS) r.piles = [];
const { createInitialState, GROUND } = await import('../src/core/GameState');
const { regionOfCell } = await import('../src/core/OldCityLayout');
const { Sim } = await import('../src/gameplay/Sim');
const { Walker } = await import('../src/gameplay/Walker');
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
const taken: [number, number][] = staying.map((p) => [p.x, p.z]);

for (const { r, p } of moving) {
  const k = KEEPERS.find((q) => q.region === r.id)!;
  const clear = new Set<string>();
  const mark = (x: number, z: number, cw = 1, cd = 1, m = 1) => {
    for (let j = -m; j < cd + m; j++) for (let i = -m; i < cw + m; i++) clear.add(`${x + i},${z + j}`);
  };
  mark(k.x, k.z);
  mark(r.landmark.x, r.landmark.z, 2, 2);
  mark(r.seam.x, r.seam.z, 2, 2);
  mark(r.patch.x, r.patch.z, r.patch.w, r.patch.d);
  for (const s of [...r.caches, ...r.pages, r.lookout]) mark(s.x, s.z);
  for (const [x, z] of r.gate.cells) mark(x, z, 1, 1, 2);
  for (const l of [...r.ladders, ...r.perches]) { mark(l.x, l.z); mark(l.to[0], l.to[1]); }
  for (const rp of r.ramps) mark(rp.x, rp.z, rp.w, rp.d);
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
  const open = (x: number, z: number) => {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!seen.has(`${x + i},${z + j}`)) return false;
    return true;
  };
  let best: [number, number] | undefined;
  let bestD = Infinity;
  for (const key of seen) {
    const [x, z] = key.split(',').map(Number);
    const t = sim.grid.get(GROUND, x, z)!;
    if (clear.has(key) || regionOfCell(x, z)?.id !== r.id || t.feature === 'road' || t.feature === 'water' || t.ramp || !open(x, z)) continue;
    if (taken.some(([a, b]) => Math.max(Math.abs(x - a), Math.abs(z - b)) < 3)) continue;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < bestD) { bestD = d; best = [x, z]; }
  }
  if (!best) { console.log(`${p.id}: no room`); continue; }
  taken.push(best);
  console.log(`${p.id}: (${p.x}, ${p.z}) -> (${best[0]}, ${best[1]})`);
}
