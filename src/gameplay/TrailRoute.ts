import { GROUND } from '../core/GameState';
import { mainlandClosedAt } from '../core/Mainland';
import { MAINLAND_CLOSED } from '../data/mainland';
import { REGIONS, type GateDef } from '../data/oldcity';
import { WAYMARK } from '../data/waymark';
import type { GoalSpot } from '../ui/GoalSpot';
import { WORDS } from '../ui/words';
import type { Sim } from './Sim';
import type { BotPose, Walker } from './Walker';

/** A point on the way, in the layer's cell units. */
export interface TrailPoint {
  x: number;
  z: number;
}

/**
 * #632: the way Show me where draws. `points` run from bloombot to the end of the way (cell centres after the first).
 * `reached`: the way gets to the goal. If it doesn't, it ends at the closest place bloombot can get to, and `why`
 * says plainly what is in the way.
 */
export interface TrailRoute {
  roofId: string;
  points: TrailPoint[];
  reached: boolean;
  why?: string;
}

/**
 * The walkable way from bloombot to a goal spot, round water, walls, rubble and anything else in the way (the same
 * rules bloombot walks by). A goal that is itself solid (a salvage pile, the fountain) counts as reached from any
 * cell within `WAYMARK.trail.reach`.
 */
export function trailRoute(sim: Sim, walker: Walker, from: BotPose, goal: GoalSpot): TrailRoute {
  const T = WAYMARK.trail;
  const start = { x: from.x, z: from.z };
  if (goal.roofId !== from.roofId) return { roofId: from.roofId, points: [start], reached: false, why: WORDS.trail.level };
  // beside the goal counts as there: within `reach`, or further out when the goal is wide and solid (a landmark, a
  // hall), as far as its nearest open cell that bloombot can stand on
  const reach = Math.max(T.reach, besideGoal(sim, walker, from.roofId, goal) + 0.01);
  const targets = goal.patchKeeperId ? [...sim.keepers.patchTiles(goal.patchKeeperId)].filter(tile => tile.ground !== 'restored') : undefined;
  const area = goal.roofId === GROUND ? sim.areas.map.areaOfCell(goal.cell.x, goal.cell.z) : undefined;
  const near = (x: number, z: number) => targets?.length
    ? sim.areas.map.areaOfCell(x, z) === area && targets.some(tile => Math.abs(tile.x - x) + Math.abs(tile.z - z) <= 1)
    : Math.hypot(x + 0.5 - goal.x, z + 0.5 - goal.z) <= reach;
  const r = walker.pathOrNearest(from.roofId, from.x, from.z, near, goal.cell, T.budget);
  const points = [start, ...r.path];
  if (r.reached) return { roofId: from.roofId, points, reached: true };
  const end = points[points.length - 1];
  return { roofId: from.roofId, points, reached: false, why: whyStops(sim, walker, from.roofId, end, goal) };
}

/**
 * How far the goal's nearest cell bloombot can stand on lies from it (cells, centre to centre; 0 when there is none).
 * Only cells in the goal's own area count: a Keeper behind shut rubble is not "beside" the park on this side of it.
 */
function besideGoal(sim: Sim, walker: Walker, roofId: string, goal: GoalSpot): number {
  const area = roofId === GROUND ? sim.areas.map.areaOfCell(goal.cell.x, goal.cell.z) : undefined;
  const R = WAYMARK.trail.beside;
  let best = Infinity;
  for (let dz = -R; dz <= R; dz++)
    for (let dx = -R; dx <= R; dx++) {
      const cx = goal.cell.x + dx;
      const cz = goal.cell.z + dz;
      if (!walker.walkable(roofId, cx, cz)) continue;
      if (area !== undefined && sim.areas.map.areaOfCell(cx, cz) !== area) continue;
      best = Math.min(best, Math.hypot(cx + 0.5 - goal.x, cz + 0.5 - goal.z));
    }
  return best === Infinity ? 0 : best;
}

/**
 * What stands between where the way stops and the goal, in plain words. Looks along the straight line from the stop
 * to the goal: a shut way in anywhere on it says what it needs (its own words, as the rubble's prompt does);
 * otherwise the first thing in the way. Every line tells a first-time player what to do next.
 */
export function whyStops(sim: Sim, walker: Walker, roofId: string, end: TrailPoint, goal: GoalSpot): string {
  // the goal lies in a region still shut behind its way in: that is what stops the trail, wherever it ends
  if (roofId === GROUND) {
    const area = sim.areas.map.areaOfCell(goal.cell.x, goal.cell.z);
    const shut = REGIONS.find((r) => r.id === area && r.gate.opensRegion !== false && !sim.gates.isOpen(r.gate.id));
    if (shut) return gateWhy(sim, shut.gate);
  }
  const dx = goal.x - end.x;
  const dz = goal.z - end.z;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) * 4));
  let first: string | undefined;
  const sx = Math.floor(end.x);
  const sz = Math.floor(end.z);
  for (let i = 1; i <= n; i++) {
    const cx = Math.floor(end.x + (dx * i) / n);
    const cz = Math.floor(end.z + (dz * i) / n);
    if (cx === sx && cz === sz) continue;
    if (roofId === GROUND) {
      // a shut way in: what blocks it, and how it opens (its own words, as at the rubble itself)
      const gate = sim.gates.gateAt(cx, cz);
      if (gate) return gateWhy(sim, gate);
    }
    if (first || walker.walkable(roofId, cx, cz)) continue;
    if (roofId === GROUND && mainlandClosedAt(cx, cz)) first = MAINLAND_CLOSED.title;
    else if (roofId === GROUND && sim.areas.fog(sim.areas.map.areaOfCell(cx, cz)) === 'hidden') first = WORDS.trail.hidden;
    else if (sim.grid.get(roofId, cx, cz)?.feature === 'water') first = WORDS.trail.water;
    else first = WORDS.trail.blocked;
  }
  return first ?? WORDS.trail.blocked;
}

/** A shut way in: what blocks it and how it opens, or that bloombot can open it now (its own words, as at the rubble). */
function gateWhy(sim: Sim, gate: GateDef): string {
  const p = sim.gates.problem(gate);
  if (!p) return `${gate.blocked} ${WORDS.trail.openNow}`;
  return p.startsWith(gate.blocked) ? p : `${gate.blocked} ${p}`;
}

/**
 * The dots along a way: the corners softened (two rounds of corner cutting, so the trail curves like a path someone
 * walks rather than stepping cell to cell), then a dot every `spacing` cells. Each dot keeps how far along the way it
 * lies (`s`, cells). The first dot sits one gap out from bloombot, not under it.
 */
export function trailDots(points: readonly TrailPoint[], spacing: number = WAYMARK.trail.spacing, max: number = WAYMARK.trail.max): (TrailPoint & { s: number; heading: number })[] {
  let pts = points.slice();
  for (let round = 0; round < 2 && pts.length > 2; round++) {
    const out: TrailPoint[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (i > 0) out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      if (i < pts.length - 2) out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  const dots: (TrailPoint & { s: number; heading: number })[] = [];
  let along = 0;
  let next = spacing;
  for (let i = 0; i < pts.length - 1 && dots.length < max; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    while (next <= along + len && dots.length < max) {
      const t = len > 0 ? (next - along) / len : 0;
      dots.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s: next, heading: Math.atan2(b.x - a.x, b.z - a.z) });
      next += spacing;
    }
    along += len;
  }
  return dots;
}
