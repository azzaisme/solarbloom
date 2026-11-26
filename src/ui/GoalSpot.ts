import { GROUND } from '../core/GameState';
import type { GoalKind } from '../gameplay/Advisor';
import type { Sim } from '../gameplay/Sim';
import { objectiveSentence, type Objective } from './ObjectiveCard';

export type { GoalKind } from '../gameplay/Advisor';

/**
 * #605 / #609 / #613 (E24): the current goal spot. The one place everything that points the way reads from: the
 * card's Show me where (the camera glide), the gold arrow, the beam and the minimap pin. It is the objective card's
 * next step: a shortage first (low charge: the nearest resting place), then the pinned Keeper, then the fountain's
 * step (a pile, the park, the fountain, or a way bloombot can open now), then the advisor's step.
 */
export interface GoalSpot {
  /** the layer it stands on (GROUND, or a rooftop) */
  roofId: string;
  /** the middle of its cell (a machine: the middle of its footprint) */
  x: number;
  z: number;
  /** the cell itself */
  cell: { x: number; z: number };
  kind: GoalKind;
  /** short, for a label or a screen reader: "the fountain", "a Scrap pile", "Tally", "the way into Mast Row" */
  name: string;
  patchKeeperId?: string;
}

/**
 * The current goal spot, or undefined when the next step has no place (nothing to point at). Pass the objective the
 * HUD already holds (`hud.objective.current`, refreshed twice a second) to skip working it out again: per frame,
 * always pass it.
 */
export function goalSpot(sim: Sim, o: Objective | undefined = objectiveSentence(sim)): GoalSpot | undefined {
  const w = o?.where;
  if (!w) return undefined;
  if (w.kind === 'focus') {
    return { roofId: w.layer ?? GROUND, x: w.x + 0.5, z: w.z + 0.5, cell: { x: w.x, z: w.z }, kind: o.place?.kind ?? 'spot', name: o.place?.name ?? 'there', patchKeeperId: o.patchKeeperId };
  }
  if (w.kind === 'wake') {
    const m = sim.machine(w.machineId);
    if (!m) return undefined;
    return { roofId: m.roofId, x: m.x + m.size / 2, z: m.z + m.size / 2, cell: { x: m.x, z: m.z }, kind: o.place?.kind ?? 'landmark', name: o.place?.name ?? 'there' };
  }
  return undefined;
}
