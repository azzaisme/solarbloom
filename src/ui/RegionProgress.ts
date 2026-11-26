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
  return { name, restored, target, green, complete: restored >= target };
}

export type RegionProgress = ReturnType<typeof regionProgress>;

export function regionProgressHtml({ green, target, complete }: RegionProgress) {
  const count = `${green} of ${target} patches green`;
  return `<span class="region-progress"><span class="region-count">${count}${complete ? ' <span class="region-check" aria-label="Goal reached">✓</span>' : ''}</span><span class="sg-bar" role="progressbar" aria-label="Patches green" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${green}" aria-valuetext="${count}"><i style="width:${(green / target) * 100}%"></i></span></span>`;
}
