import { PARK } from '../core/Areas';
import { AREA_TYPES } from '../data/city';
import { TUNING } from '../data/tuning';
import type { Sim } from '../gameplay/Sim';

export function regionProgress(sim: Sim, id: string) {
  const area = sim.areas.info(id);
  const name = id === PARK ? 'The Park' : sim.gates.regionById(area.region ?? id)?.name ?? AREA_TYPES[area.type].name;
  const restored = sim.areas.counts(id).restored;
  const target = id === PARK ? TUNING.park.restoredTiles : sim.areas.need(id);
  const green = Math.min(restored, target);
  // #787: a gated region's works (power, water or drones) its landmark waits on, and whether they run yet
  const def = id === PARK ? undefined : sim.works.def(area.region ?? id);
  const works = def && { kind: def.kind, running: sim.works.running(def.region), text: sim.works.running(def.region) ? def.done : def.needs };
  return { name, restored, target, green, complete: restored >= target, works };
}

/** #787: the works' icon by kind (what it needs: power, water or drones). */
// (not ⚡ or 💧: those read as the counters areas no longer have, E23.1.4)
const WORKS_ICON = { power: '🔌', water: '🚰', drones: '🛸' } as const;

export type RegionProgress = ReturnType<typeof regionProgress>;

export function regionProgressHtml({ green, target, complete, works }: RegionProgress) {
  const count = `${green} of ${target} patches green`;
  const need = works
    ? `<span class="region-works${works.running ? ' on' : ''}" data-works="${works.kind}"><span aria-hidden="true">${works.running ? '✓' : WORKS_ICON[works.kind]}</span> ${works.text}</span>`
    : '';
  return `<span class="region-progress">${need}<span class="region-count">${count}${complete ? ' <span class="region-check" aria-label="Goal reached">✓</span>' : ''}</span><span class="sg-bar" role="progressbar" aria-label="Patches green" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${green}" aria-valuetext="${count}"><i style="width:${(green / target) * 100}%"></i></span></span>`;
}
