import { PARK } from '../core/Areas';
import { arterialsInChunk, type RoadPlan } from '../core/RoadPlan';
import { CHUNK } from '../core/Hash';

/**
 * City 16.8: a debug overview of the road network (dev only, `sbDev.roads()`): road tiles by tier, arterials,
 * area links drawn landmark → gate → landmark (the parent tree to the park bold, extra links thin), gates and
 * landmarks. Draws onto any 2D canvas context, centred on chunk (cx, cz), `radius` chunks each way.
 */
export function drawRoadOverview(ctx: CanvasRenderingContext2D, plan: RoadPlan, cx: number, cz: number, radius: number, px = 2) {
  const N = radius;
  const x0 = (cx - N) * CHUNK;
  const z0 = (cz - N) * CHUNK;
  const T = (2 * N + 1) * CHUNK;
  ctx.canvas.width = T * px;
  ctx.canvas.height = T * px;
  const sx = (x: number) => (x - x0) * px;
  const sz = (z: number) => (z - z0) * px;
  ctx.fillStyle = 'rgb(232,228,218)';
  ctx.fillRect(0, 0, T * px, T * px);
  const map = plan.map;
  const ids = new Set<string>();
  // Areas: a tint by type and a line on their borders.
  const tint: Record<string, string> = { park: 'rgb(196,226,170)', grove: 'rgb(176,204,146)', street: 'rgb(220,215,203)', plaza: 'rgb(234,222,196)', market: 'rgb(234,206,170)', reservoir: 'rgb(210,196,168)', rooftops: 'rgb(204,198,220)' };
  for (let c = -N; c <= N; c++)
    for (let r = -N; r <= N; r++) {
      const id = map.areaOfChunk(cx + r, cz + c);
      ids.add(id);
      ctx.fillStyle = id === PARK ? 'rgb(124,195,106)' : tint[map.info(id).type];
      ctx.fillRect(sx((cx + r) * CHUNK), sz((cz + c) * CHUNK), CHUNK * px, CHUNK * px);
    }
  ctx.strokeStyle = 'rgba(80,70,60,0.5)';
  ctx.lineWidth = 1;
  for (let c = -N; c <= N; c++)
    for (let r = -N; r <= N; r++) {
      const id = map.areaOfChunk(cx + r, cz + c);
      const X = sx((cx + r) * CHUNK);
      const Z = sz((cz + c) * CHUNK);
      ctx.beginPath();
      if (map.areaOfChunk(cx + r + 1, cz + c) !== id) ctx.moveTo(X + CHUNK * px, Z), ctx.lineTo(X + CHUNK * px, Z + CHUNK * px);
      if (map.areaOfChunk(cx + r, cz + c + 1) !== id) ctx.moveTo(X, Z + CHUNK * px), ctx.lineTo(X + CHUNK * px, Z + CHUNK * px);
      ctx.stroke();
    }
  // Road tiles.
  const col = { arterial: 'rgb(60,60,68)', street: 'rgb(105,105,112)', lane: 'rgb(190,160,110)' };
  for (let z = z0; z < z0 + T; z++)
    for (let x = x0; x < x0 + T; x++) {
      const r = plan.roadAt(x, z);
      if (!r) continue;
      ctx.fillStyle = r.bridge ? 'rgb(150,95,60)' : col[r.tier];
      ctx.fillRect(sx(x), sz(z), px, px);
    }
  // Arterial runs outlined, so their extent reads at a glance.
  ctx.strokeStyle = 'rgba(230,150,40,0.9)';
  ctx.lineWidth = 1;
  for (let c = -N; c <= N; c++)
    for (let r = -N; r <= N; r++)
      for (const run of arterialsInChunk(plan.seed, cx + r, cz + c)) {
        const along0 = Math.max(run.from, (run.axis === 'x' ? cx + r : cz + c) * CHUNK);
        const along1 = Math.min(run.to, (run.axis === 'x' ? cx + r : cz + c) * CHUNK + CHUNK - 1);
        const a = run.at * CHUNK + run.lane;
        if (run.axis === 'x') ctx.strokeRect(sx(along0), sz(a), (along1 - along0 + 1) * px, run.width * px);
        else ctx.strokeRect(sx(a), sz(along0), run.width * px, (along1 - along0 + 1) * px);
      }
  // Links: landmark → gate → landmark. Parent links bold dark red (the tree to the park), extras thin blue.
  const centre = (id: string): [number, number] => (id === PARK ? [8, 8] : [map.info(id).landmark[0] + 1, map.info(id).landmark[1] + 1]);
  const drawn = new Set<string>();
  for (const id of ids) {
    if (id === PARK) continue;
    for (const l of plan.roads(id).links) {
      const key = id < l.to ? `${id}|${l.to}` : `${l.to}|${id}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const { cx: ex, cz: ez, dir } = l.gate.edge;
      const g: [number, number] = dir === 'e' ? [(ex + 1) * CHUNK, ez * CHUNK + l.gate.offset + l.gate.width / 2] : [ex * CHUNK + l.gate.offset + l.gate.width / 2, (ez + 1) * CHUNK];
      const a = centre(id);
      const b = centre(l.to);
      const tree = l.kind === 'parent' || l.kind === 'child';
      ctx.strokeStyle = l.tier === 'arterial' ? 'rgba(230,150,40,0.7)' : tree ? 'rgba(170,30,40,0.85)' : 'rgba(40,90,190,0.7)';
      ctx.lineWidth = tree ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(sx(a[0]), sz(a[1]));
      ctx.lineTo(sx(g[0]), sz(g[1]));
      ctx.lineTo(sx(b[0]), sz(b[1]));
      ctx.stroke();
      ctx.fillStyle = 'rgb(20,20,20)';
      ctx.fillRect(sx(g[0]) - 2, sz(g[1]) - 2, 4, 4);
    }
    const [mx, mz] = map.info(id).landmark;
    ctx.fillStyle = 'rgb(45,106,79)';
    ctx.fillRect(sx(mx), sz(mz), 2 * px, 2 * px);
  }
}
