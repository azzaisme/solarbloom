import { AREA_TYPES } from '../data/city';
import { MACHINES } from '../data/machines';
import type { Sim } from '../gameplay/Sim';
import { HOME } from '../gameplay/ProgressionSystem';
import { TUNING } from '../data/tuning';
import { WORDS } from './words';

/**
 * E22.10 (#348) / E22.5 (#342): the objective card (top left). Under old-city rules it is one plain sentence about
 * a thing and a place: the pinned request (E21), or else the next step at the fountain or in the city. A count
 * appears only for things gathered or restored by hand, as "12 of 20".
 */
export interface Objective {
  text: string;
  /** "12 of 20", only for things done by hand */
  count?: string;
}

/** E21's pinned request, if its state exists and one is pinned (read only; E21 owns the shape). */
export function pinnedRequest(state: object): { text: string; have?: number; need?: number } | undefined {
  const reqs = (state as { requests?: unknown }).requests;
  const list = Array.isArray(reqs) ? reqs : reqs && typeof reqs === 'object' ? Object.values(reqs as Record<string, unknown>) : [];
  for (const r of list as { pinned?: boolean; text?: string; have?: number; need?: number }[]) if (r && r.pinned && typeof r.text === 'string') return { text: r.text, have: r.have, need: r.need };
  return undefined;
}

export function oldCityObjective(sim: Sim): Objective {
  const pin = pinnedRequest(sim.state);
  if (pin) return { text: pin.text, count: pin.need ? WORDS.objective.count(Math.min(pin.have ?? 0, pin.need), pin.need) : undefined };
  const p = sim.progression;
  const W = WORDS.objective;
  if (!sim.state.progression.coreActivated) {
    const g = p.homeIsPark ? TUNING.park : TUNING.core; // the same goals ProgressionSystem counts
    const n = p.restoredCount(HOME);
    if (n < g.restoredTiles) return { text: W.restore, count: W.count(n, g.restoredTiles) };
    const full = p.fullBloomCount(HOME);
    if (full < g.fullBloomTiles) return { text: W.flower, count: W.count(full, g.fullBloomTiles) };
    for (const t of ['solar', 'condenser', 'pollinator', 'droneHub'] as const) if (!p.built(t)) return { text: W.build(MACHINES[t].name) };
    if (!p.built('motherTree')) return { text: W.plant(MACHINES.motherTree.name) };
    return { text: W.wakeFountain };
  }
  const id = sim.areas.nextGoal();
  if (!id) return { text: W.explore };
  const a = sim.areas.info(id);
  const region = AREA_TYPES[a.type].name.toLowerCase();
  if (sim.areas.ready(id)) return { text: W.wake(a.landmarkName, region) };
  const c = sim.areas.counts(id);
  const need = sim.areas.need(id);
  return { text: W.clear(region), count: W.count(Math.min(c.restored, need), need) };
}
