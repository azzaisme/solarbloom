import { PARK } from '../core/Areas';
import type { MaterialId } from '../core/types';
import { REGIONS } from '../data/oldcity';
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
 * E21.8 / E21.12: the objective card. One request is pinned at a time: a Keeper's request
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

/**
 * E21.12 (§16): the first fifteen minutes, as the hint line shows them (one step at a time, never skipped:
 * ProgressionSystem advances the step by one at most per tick). Actions are named through `keyFor` (bloombot's key
 * or pad button); no step speaks of clicks, taps, rates or upgrades. After the last step: the advisor (E23.1.5).
 */
export const FIRST_STEPS = 9;

export function oldCityHint(sim: Sim, step: number, keyFor: (a: 'pulse' | 'interact') => string): { text: string; target?: string } {
  const park = sim.areas.counts(PARK).restored;
  const restored = sim.state.stats.tilesRestored;
  switch (step) {
    case 0:
      return { text: `You've landed! Salvage the pile in front of you: hold ${keyFor('interact')} 🧱` };
    case 1:
      return { text: `Walk up the steps to the park and pulse dead ground with ${keyFor('pulse')} · ${Math.min(4, restored)}/4` };
    case 2:
      return { text: 'The fountain wants 🌱 Seeds: look for the broken pots in the park' };
    case 3:
      return { text: `Restore the park around the fountain · ${Math.min(60, park)}/60`, target: '#obj' };
    case 4: {
      const s = sim.fountain.remaining('scrap');
      const e = sim.fountain.remaining('seeds');
      return { text: `Bring the fountain what it asks for (${keyFor('interact')} at the fountain) · still ${s} Scrap, ${e} Seeds`, target: '#obj' };
    }
    case 5:
      return { text: 'Water returns! Build a ☀️ Solar Panel from 10 Scrap', target: '#buildToggle' };
    case 6:
      return { text: `Three beacons glow through the fog, and the Sea Lock waits down the beach. Pry open a barricade: hold ${keyFor('interact')}` };
    case 7: {
      const r = REGIONS.find((q) => q.ring === 1 && sim.gates.isOpen(q.gate.id) && q.gate.opensRegion !== false);
      const k = r ? sim.keepers.def(r.keeper) : undefined;
      return { text: k ? `A robot sleeps in ${r!.name}: pulse ${k.name}, then hand it 5 of anything` : 'A robot sleeps behind each barricade: wake one' };
    }
    default:
      // E23.1.5: after the first fifteen minutes the hint line carries the advisor's next step in the loop
      return { text: sim.advisor.suggest().text };
  }
}

/** Which first-fifteen-minutes step the game is on: the first not yet done (ProgressionSystem moves one at a time). */
export function oldCityStep(sim: Sim): number {
  const sv = sim.state.salvage;
  if (!sv) return 0;
  const salvaged = Object.keys(sv.piles).length > 0;
  const seeds = (sv.pack.seeds ?? 0) + (sv.store.seeds ?? 0) + (sv.delivered.seeds ?? 0) > 0 || sv.tier >= 1;
  const solar = sim.state.machines.some((m) => m.type === 'solar' && !m.starter);
  const pried = REGIONS.some((r) => r.ring === 1 && r.gate.opensRegion !== false && sv.opened.includes(r.gate.id));
  const keeper = REGIONS.some((r) => sv.opened.includes(r.gate.id) && (sv.keepers[r.keeper]?.step ?? 'asleep') !== 'asleep');
  const done = [salvaged, sim.state.stats.tilesRestored >= 4, seeds, sim.areas.counts(PARK).restored >= 60 || sv.tier >= 1, sv.tier >= 1, solar, pried, keeper];
  const i = done.indexOf(false);
  return i < 0 ? done.length : i;
}
