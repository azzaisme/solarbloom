import { TIERS } from '../data/salvage';
import { PARK } from '../core/Areas';
import { AREA_TYPES } from '../data/city';
import { MACHINES } from '../data/machines';
import { regionProgress, regionProgressHtml } from './RegionProgress';
import type { Sim } from '../gameplay/Sim';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** What each area type is good for, in plain language. */
export const AREA_SPECIALTY: Record<string, string> = {
  park: 'Lawns that flower into Greens to gather. Home.',
  street: 'Long paved runs, where a line of street gardens carries a bloom down the road.',
  plaza: 'Open paving that soaks up the sun, with room to build.',
  canal: 'Water channels, where Reservoir Gardens grow.',
  market: 'Crowded with stalls and their old wares.',
  reservoir: 'Dry clay basins, where Reservoir Gardens grow.',
  grove: 'Leaf litter around an Elder Tree: blooms nearby charge it up.',
  beach: 'Sand and driftwood where the boat comes in. The Sea Lock across the canal wakes it.',
  downtown: 'Glass towers on a raised plateau around the Solar Spire, the tallest light in the city.',
};

export interface AreaPanelData {
  id: string;
  name: string;
  type: string;
  fog: string;
  restored: number;
  need: number;
  ready: boolean;
  machines: Record<string, number>;
}

/** Live facts about one area (pure: used by the panel and its tests). */
export function areaPanelData(sim: Sim, id: string): AreaPanelData {
  const s = sim;
  const a = s.areas.info(id);
  const fog = s.areas.fog(id);
  const progress = regionProgress(s, id);
  const machines: Record<string, number> = {};
  for (const m of s.state.machines) if (m.type !== 'core' && s.areas.areaOf(m) === id) machines[m.type] = (machines[m.type] ?? 0) + 1;
  return {
    id,
    name: progress.name,
    type: a.type,
    fog,
    restored: progress.restored,
    need: progress.target,
    ready: id !== PARK && s.areas.ready(id),
    machines,
  };
}

/** Look 6.10: tiles a Cultivator is working in this area right now. */
function cultivating(s: Sim, id: string): number {
  return s.cultivators.working().filter((t) => t.roofId === 'g' && s.areas.areaOf(t) === id).length;
}

/** The area panel: opened from an area's landmark or its label in the overview. */
export function areaPanelHtml(sim: Sim, id: string, landmarkId?: string): string {
  const s = sim;
  const a = s.areas.info(id);
  const def = AREA_TYPES[a.type];
  const d = areaPanelData(sim, id);
  const fogName: Record<string, string> = { hidden: 'Hidden in fog', frontier: 'Thick fog', thinning: 'Thinning fog', cleared: 'Clear' };
  const title = (name: string) => `<span class="pn-badge">${def.icon}</span><span class="ap-name">${esc(name)}</span>`;
  const cleared = d.fog === 'cleared';
  const parkAwake = id === PARK && s.state.salvage.tier >= 1; // E21.6: the fountain wakes at tier 1
  let checklist: string;
  if (id === PARK) {
    // E21.6: the fountain wakes step by step, from what bloombot brings it
    const step = s.state.salvage.tier;
    checklist = TIERS.map((t) => `<li>${step >= t.tier ? '✅' : '⬜'} Fountain step ${t.tier}: ${esc(t.name)}</li>`).join('');
  } else {
    const steps = [
      { done: d.fog !== 'hidden', label: 'Out of the fog, beside ground you cleared' },
      { done: cleared || d.restored >= d.need, label: `Turn ${d.need} patches of ground green (${Math.min(d.restored, d.need)} of ${d.need})` },
      { done: cleared, label: `Wake the ${esc(a.landmarkName)}` },
    ];
    checklist = steps.map((x) => `<li>${x.done ? '✅' : '⬜'} ${x.label}</li>`).join('');
  }
  const machineText = Object.entries(d.machines)
    .map(([t, n]) => `${MACHINES[t as keyof typeof MACHINES]?.icon ?? '⚙️'} ${n} ${MACHINES[t as keyof typeof MACHINES]?.name ?? t}${n === 1 ? '' : 's'}`)
    .join(' · ');
  const wake = d.ready && landmarkId && !cleared && !parkAwake ? `<button class="buy" data-wake="${landmarkId}">✨ Wake the ${esc(a.landmarkName)}</button>` : '';
  const tag = a.authored ? ' · <b>a rare landmark</b>' : '';
  // Automation switches (revealed areas; no logistics, just what the drones do here).
  const mode = s.areas.mode(id) ?? '';
  const modes: [string, string, string][] = [
    ['', '⚙️ Normal', 'Drones work wherever is best'],
    ['bloom', '🌸 Keep blooming', 'Drones tend the flowers here first'],
    ['frontier', '🌫️ Push into the fog', "This area's drones push into the fog"],
    ['off', '✋ Leave alone', 'Drones skip this area'],
  ];
  const switches = s.state.areas[id]
    ? `<div class="modes" role="group" aria-label="Drones in this area">${modes
        .map(([m, label, tip]) => `<button class="mode${m === mode ? ' on' : ''}" data-area-mode="${esc(id)}|${m}" title="${esc(tip)}" aria-pressed="${m === mode}">${label}</button>`)
        .join('')}</div>`
    : '';
  return (
    `<h4><span>${title(d.name)}</span><button data-close aria-label="Close">×</button></h4>` +
    `<p class="stat" data-area-panel="${esc(id)}">${esc(a.landmarkName)} · ${a.distance} block${a.distance === 1 ? '' : 's'} from the park${tag}</p>` +
    `<p class="blurb">${esc(AREA_SPECIALTY[a.type] ?? '')}</p>` +
    `<p class="stat">🌫️ ${cleared || parkAwake ? 'Clear' : fogName[d.fog]}</p>` +
    (d.fog === 'hidden' ? '' : regionProgressHtml(regionProgress(s, id))) +
    `<ul class="ap-steps">${checklist}</ul>` +
    `<p class="stat">Machines: ${machineText || 'none yet'}</p>` +
    oldCityShare(s, id) +
    (cultivating(s, id) ? `<p class="stat" data-cultivating="${esc(id)}">🚜 A Cultivator is turning ${cultivating(s, id) === 1 ? 'a patch' : `${cultivating(s, id)} patches`} of ground green</p>` : '') +
    switches +
    wake
  );
}

/** E21.9: a region shows bloombot's share until helpers may join in. */
function oldCityShare(s: Sim, id: string): string {
  if (id === PARK || s.areas.info(id).noLandmark || s.areas.fog(id) === 'cleared') return '';
  const have = s.state.areas[id]?.byBot ?? 0;
  const need = s.areas.shareTarget(id);
  return s.areas.shareMet(id) ? `<p class="stat" data-share="${esc(id)}">🛸 Drones can help out here now</p>` : `<p class="stat" data-share="${esc(id)}">🤖 Turn some ground green here yourself and the drones will join in: ${Math.min(have, need)} of ${need}</p>`;
}
