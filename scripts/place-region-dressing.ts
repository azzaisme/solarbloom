// E23.8 (#327–#329): lays out each region's dressing (data/oldcity DRESS) on its real generated ground.
//   npx vite-node scripts/place-region-dressing.ts [regionId ...]
// Prints `D(...)` lines for a region's `dressing`. Deterministic: the same ground gives the same cells.
// Where each kind goes:
// - 'street': beside the region's road (a lamp, a bollard, a cable pole), turned to face it;
// - 'water': on the rim beside water (mooring posts, a boat pulled up, the basin's dry drains), turned to face it;
// - 'road': tram rails, a run of four cells along the road (walked over);
// - 'open': open ground, as a salvage pile would be.
// Never on the jetty (its planks are generated without set pieces).
// A blocking prop stands on a walkable cell whose land neighbours are all reached (so it never closes a path), off
// ramps, clear of the set pieces, and at least two cells from every pile and every other prop (never side by side,
// so no two make a wall). They spread out across the region (farthest-point sampling from the Keeper).
import { REGIONS, KEEPERS, type DressKind, type RegionDef } from '../src/data/oldcity';
import { createInitialState, GROUND } from '../src/core/GameState';
import { onJetty, regionOfCell } from '../src/core/OldCityLayout';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';

type Rule = 'open' | 'street' | 'water' | 'road';
/** Each region's dressing, from #327–#329 (6–10 props each; Mast Row's tram rails besides). */
const PLAN: Record<string, [DressKind, number, Rule][]> = {
  mastRow: [['tram-rails', 4, 'road'], ['cable-pole', 3, 'street'], ['banner-pole', 2, 'street'], ['bollard', 2, 'street'], ['copper-pipe', 1, 'open']],
  oldMarket: [['market-stall', 3, 'open'], ['lantern-string', 3, 'open'], ['barrel', 2, 'open']],
  saltwind: [['mooring-post', 4, 'water'], ['boat', 2, 'water'], ['barrel', 1, 'open'], ['bollard', 1, 'street']],
  elderGrove: [['stump-ring', 3, 'open'], ['fallen-trunk', 3, 'open'], ['planter-bed', 1, 'open'], ['cracked-pillar', 1, 'open']],
  cistern: [['dry-drain', 4, 'water'], ['cracked-pillar', 2, 'open'], ['copper-pipe', 2, 'open']],
  clockPlaza: [['clockwork-heap', 4, 'open'], ['cracked-pillar', 2, 'open'], ['bench', 1, 'street'], ['lamp-post', 1, 'street']],
  terraces: [['ac-unit', 3, 'open'], ['vent', 3, 'open'], ['planter-trough', 2, 'open']],
  glasshouse: [['planter-bed', 3, 'open'], ['planter-trough', 2, 'open'], ['cracked-pillar', 1, 'open'], ['bench', 1, 'street'], ['lamp-post', 1, 'street']],
  observatory: [['cracked-pillar', 3, 'open'], ['bench', 2, 'open'], ['lamp-post', 2, 'street'], ['banner-pole', 1, 'street']],
  spireHeights: [['ac-unit', 2, 'open'], ['vent', 2, 'open'], ['lamp-post', 2, 'street'], ['bollard', 2, 'street']],
};

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
/** quarter turn that faces (dx, dz): 0 +x, 1 +z, 2 −x, 3 −z */
const facing = (dx: number, dz: number) => (dx > 0 ? 0 : dz > 0 ? 1 : dx < 0 ? 2 : 3);

const sim = new Sim(createInitialState(7));
sim.state.salvage!.abilities = ['pry', 'hover', 'climb', 'glide'];
for (const r of REGIONS) sim.state.areas[r.id] = { fog: 'thinning', revealedAt: 0 };
// every gate open: dressing goes anywhere a player walks by the end
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
  const tile = (x: number, z: number) => sim.grid.get(GROUND, x, z);
  const inRegion = (x: number, z: number) => regionOfCell(x, z)?.id === r.id;
  // keep-clear cells: set pieces with a one-cell margin, piles and existing dressing with one more
  const clear = new Set<string>();
  const mark = (x: number, z: number, cw = 1, cd = 1, m = 1) => {
    for (let j = -m; j < cd + m; j++) for (let i = -m; i < cw + m; i++) clear.add(`${x + i},${z + j}`);
  };
  mark(keeper.x, keeper.z);
  mark(r.landmark.x, r.landmark.z, 2, 2);
  mark(r.seam.x, r.seam.z, 2, 2);
  mark(r.patch.x, r.patch.z, r.patch.w, r.patch.d);
  for (const s of [...r.caches, ...r.pages, r.lookout]) mark(s.x, s.z);
  for (const [x, z] of r.gate.cells) mark(x, z, 1, 1, 2);
  for (const l of [...r.ladders, ...r.perches]) { mark(l.x, l.z); mark(l.to[0], l.to[1]); }
  for (const rp of r.ramps) mark(rp.x, rp.z, rp.w, rp.d);
  for (const p of r.piles) mark(p.x, p.z);
  for (const d of r.dressing) mark(d.x, d.z);
  for (const g of r.glides) mark(g.x, g.z, 1, 1, 2);
  // reachable ground from beside the Keeper
  const seen = new Set<string>();
  const queue: [number, number][] = [];
  for (const [dx, dz] of N4) {
    const x = keeper.x + dx, z = keeper.z + dz;
    if (w.walkable(GROUND, x, z)) { seen.add(`${x},${z}`); queue.push([x, z]); }
  }
  while (queue.length) {
    const [x, z] = queue.shift()!;
    for (const [dx, dz] of N4) {
      const nx = x + dx, nz = z + dz;
      const k = `${nx},${nz}`;
      if (seen.has(k) || Math.max(Math.abs(nx - keeper.x), Math.abs(nz - keeper.z)) > 96 || !w.walkable(GROUND, nx, nz) || !w.stepOk(GROUND, x, z, nx, nz)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  const isWater = (x: number, z: number) => tile(x, z)?.feature === 'water';
  const isRoad = (x: number, z: number) => tile(x, z)?.feature === 'road';
  // a blocking prop: every land neighbour (of eight) is reached, so taking this cell never cuts a path
  const landOpen = (x: number, z: number) => {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!seen.has(`${x + i},${z + j}`) && !isWater(x + i, z + j)) return false;
    return true;
  };
  const ok = (x: number, z: number, rule: Rule) => {
    const k = `${x},${z}`;
    const t = tile(x, z);
    // not on the jetty: its planks are generated without set pieces
    if (!t || !seen.has(k) || clear.has(k) || !inRegion(x, z) || t.ramp || t.feature === 'water' || onJetty(x, z)) return false;
    if (rule === 'road') return isRoad(x, z);
    if (isRoad(x, z) || !landOpen(x, z)) return false;
    if (rule === 'street') return N4.some(([dx, dz]) => isRoad(x + dx, z + dz));
    if (rule === 'water') return N4.some(([dx, dz]) => isWater(x + dx, z + dz));
    // open ground: no water beside it either (a pile's rule)
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!seen.has(`${x + i},${z + j}`)) return false;
    return true;
  };
  const turnOf = (x: number, z: number, rule: Rule) => {
    if (rule === 'road') return isRoad(x + 1, z) || isRoad(x - 1, z) ? 0 : 1; // rails along the road
    if (rule === 'street') { const d = N4.find(([dx, dz]) => isRoad(x + dx, z + dz))!; return facing(d[0], d[1]); }
    if (rule === 'water') { const d = N4.find(([dx, dz]) => isWater(x + dx, z + dz))!; return facing(d[0], d[1]); }
    return (((x * 7 + z * 3) % 4) + 4) % 4;
  };
  const cells = [...seen].map((k) => k.split(',').map(Number) as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const chosen: [number, number][] = [...r.piles.map((p) => [p.x, p.z] as [number, number]), ...r.dressing.map((d) => [d.x, d.z] as [number, number])];
  const spread: [number, number][] = r.dressing.map((d) => [d.x, d.z]);
  const lines: string[] = [];
  const near = (x: number, z: number, m: number) => chosen.some(([a, b]) => Math.max(Math.abs(x - a), Math.abs(z - b)) < m);
  for (const [kind, n, rule0] of plan) {
    let rule = rule0;
    let cands = cells.filter(([x, z]) => ok(x, z, rule));
    if (!cands.length && rule !== 'open') {
      console.log(`// ${r.id}: no ${rule} cells for ${kind}, so open ground`);
      rule = 'open';
      cands = cells.filter(([x, z]) => ok(x, z, rule));
    }
    if (rule === 'road') {
      // one run of n road cells along the road, as far from the Keeper as the road goes
      const runs = cands
        .map(([x, z]) => {
          const t = turnOf(x, z, rule);
          const run: [number, number][] = [];
          for (let i = 0; i < n; i++) run.push(t === 0 ? [x + i, z] : [x, z + i]);
          return run;
        })
        .filter((run) => run.every(([x, z]) => ok(x, z, 'road') && !near(x, z, 2)));
      runs.sort((a, b) => Math.hypot(b[0][0] - keeper.x, b[0][1] - keeper.z) - Math.hypot(a[0][0] - keeper.x, a[0][1] - keeper.z));
      const run = runs[Math.floor(runs.length / 3)];
      if (!run) { console.log(`// ${r.id}: no run of ${n} road cells for ${kind}`); continue; }
      for (const [x, z] of run) {
        lines.push(`      D('${kind}', ${x}, ${z}, ${turnOf(x, z, rule)}),`);
        chosen.push([x, z]);
      }
      continue;
    }
    for (let i = 0; i < n; i++) {
      let best: [number, number] | undefined;
      let bestD = -1;
      for (const [x, z] of cands) {
        if (near(x, z, 2)) continue;
        const d = Math.min(Math.hypot(x - keeper.x, z - keeper.z) * 0.5, ...spread.map(([a, b]) => Math.hypot(x - a, z - b)));
        if (d > bestD) { bestD = d; best = [x, z]; }
      }
      if (!best) { console.log(`// ${r.id}: ran out of room for ${kind} (${i} of ${n})`); break; }
      chosen.push(best);
      spread.push(best);
      lines.push(`      D('${kind}', ${best[0]}, ${best[1]}, ${turnOf(best[0], best[1], rule)}),`);
    }
  }
  console.log(`// ${r.id}: ${lines.length} props`);
  console.log(lines.join('\n'));
}

const only = process.argv.slice(2);
for (const r of REGIONS) if (!only.length || only.includes(r.id)) place(r);
