import type { MaterialId } from '../core/types';
import { MATERIALS } from '../data/salvage';
import type { Sim } from '../gameplay/Sim';

export interface Objective {
  title: string;
  /** progress line under the title */
  pct: string;
  /** 0–1 for the bar */
  bar: number;
  list: { label: string; done: boolean }[];
  /** the "Next:" line */
  next: string;
  /** the goal can be completed now */
  done: boolean;
}

/**
 * E21.8 / E21.12: the objective card under old-city rules. One request is pinned at a time: a Keeper's request
 * (the first awake Keeper in map order), else the next fountain tier. The rest are listed in the backpack.
 */
export function oldCityObjective(sim: Sim): Objective {
  const pinned = sim.keepers.pinned();
  if (pinned) {
    const k = sim.keepers.def(pinned.id);
    const st = sim.keepers.step(pinned.id);
    const steps: { label: string; done: boolean }[] = [
      { label: `Wake ${k.name}`, done: true },
      { label: `Bring what ${k.name} asked for`, done: st !== 'request1' },
      { label: `Restore ${sim.keepers.region(pinned.id).patch.name.toLowerCase()}`, done: st === 'landmark' },
      { label: `Wake the ${sim.keepers.region(pinned.id).landmark.name}`, done: false },
    ];
    const p = sim.keepers.patch(pinned.id);
    return {
      title: `🤖 ${k.name}'s request`,
      pct: pinned.text,
      bar: st === 'request2' ? p.restored / Math.max(1, p.total) : steps.filter((q) => q.done).length / steps.length,
      list: steps,
      next: `Next: ${pinned.text}`,
      done: st === 'landmark' && sim.inventory.canPay(sim.keepers.wants(pinned.id) ?? {}),
    };
  }
  const f = sim.fountain;
  const t = f.next();
  if (t) {
    const list = (Object.entries(t.delivery) as [MaterialId | 'biomass', number][])
      .filter(([k]) => k !== 'biomass')
      .map(([k, v]) => ({ label: `${MATERIALS[k as MaterialId].name} ${Math.min(v, f.given(k as MaterialId))}/${v}`, done: f.remaining(k as MaterialId) === 0 }));
    const c = f.condition(t);
    list.push({ label: `${c.label} ${Math.min(c.have, c.need)}/${c.need}`, done: c.done });
    const missing = list.find((q) => !q.done);
    const total = list.length;
    return {
      title: `⛲ Fountain tier ${t.tier}: ${t.name}`,
      pct: `${list.filter((q) => q.done).length}/${total} ready`,
      bar: list.filter((q) => q.done).length / total,
      list,
      next: missing ? `Next: ${missing.label}` : 'Next: the fountain is ready',
      done: f.delivered() && c.done,
    };
  }
  return { title: '🌸 The Great Bloom', pct: 'The whole city is awake', bar: 1, list: [], next: '', done: true };
}

/** The Keepers' requests that are not pinned (the backpack's Requests list). */
export function otherRequests(sim: Sim): string[] {
  return sim.keepers.requests().slice(1).map((r) => r.text);
}
