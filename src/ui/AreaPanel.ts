import { TIERS } from '../data/salvage';
import { PARK } from '../core/Areas';
import { AREA_TYPES } from '../data/city';
import { MACHINES } from '../data/machines';
import { TUNING } from '../data/tuning';
import type { Sim } from '../gameplay/Sim';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** What each area type is good for, in plain language. */
export const AREA_SPECIALTY: Record<string, string> = {
  park: 'Lawns that flower into biomass to gather. Home.',
  street: 'Long paved runs: street gardens here pass chains along green corridors.',
  plaza: 'Open paving that soaks up sun, with room for corridors.',
  canal: 'Water channels, where Reservoir Gardens grow.',
  market: 'Crowded with stalls and their old wares.',
  reservoir: 'Dry clay basins, where Reservoir Gardens grow.',
  grove: 'Leaf litter around an Elder Tree: blooms nearby charge its Canopy Burst.',
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
  const c = s.areas.counts(id);
  const need = id === PARK ? TUNING.park.restoredTiles : s.areas.need(id);
  const machines: Record<string, number> = {};
  for (const m of s.state.machines) if (m.type !== 'core' && s.areas.areaOf(m) === id) machines[m.type] = (machines[m.type] ?? 0) + 1;
  return {
    id,
    name: id === PARK ? 'The Park' : AREA_TYPES[a.type].name,
    type: a.type,
    fog,
    restored: c.restored,
    need,
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
  const pct = Math.min(100, Math.round((d.restored / Math.max(1, d.need)) * 100));
  const cleared = d.fog === 'cleared';
  const parkAwake = id === PARK && s.state.salvage.tier >= 1; // E21.6: the fountain wakes at tier 1
  let checklist: string;
  if (id === PARK) {
    // E21.6: the fountain wakes tier by tier, from what bloombot brings it
    const tier = s.state.salvage.tier;
    checklist = TIERS.map((t) => `<li>${tier >= t.tier ? '✅' : '⬜'} Fountain tier ${t.tier}: ${esc(t.name)}</li>`).join('');
  } else {
    const steps = [
      { done: d.fog !== 'hidden', label: 'Revealed next to clear ground' },
      { done: cleared || d.restored >= d.need, label: `Restore ${d.need} tiles (${Math.min(d.restored, d.need)}/${d.need})` },
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
    ['bloom', '🌸 Keep blooming', 'Drones nurture this area first'],
    ['frontier', '🌫️ Focus the frontier', "This area's drones push into the fog"],
    ['off', '✋ Leave alone', 'Drones skip this area'],
  ];
  const switches = s.state.areas[id]
    ? `<div class="modes" role="group" aria-label="Drones in this area">${modes
        .map(([m, label, tip]) => `<button class="mode${m === mode ? ' on' : ''}" data-area-mode="${esc(id)}|${m}" title="${esc(tip)}" aria-pressed="${m === mode}">${label}</button>`)
        .join('')}</div>`
    : '';
  return (
    `<h4><span>${def.icon} ${esc(d.name)}</span><button data-close aria-label="Close">×</button></h4>` +
    `<p class="stat" data-area-panel="${esc(id)}">${esc(a.landmarkName)} · ${a.distance} block${a.distance === 1 ? '' : 's'} from the park${tag}</p>` +
    `<p class="blurb">${esc(AREA_SPECIALTY[a.type] ?? '')}</p>` +
    `<p class="stat">🌫️ ${cleared || parkAwake ? 'Clear' : `${fogName[d.fog]} · ${pct}%`}</p>` +
    (cleared || parkAwake ? '' : `<div class="bar"><i style="width:${pct}%"></i></div>`) +
    `<ul style="margin:6px 0;padding-left:18px;font-size:12.5px;list-style:none">${checklist}</ul>` +
    `<p class="stat">Machines: ${machineText || 'none yet'}</p>` +
    oldCityShare(s, id) +
    (cultivating(s, id) ? `<p class="stat" data-cultivating="${esc(id)}">🚜 ${cultivating(s, id)} tile${cultivating(s, id) === 1 ? '' : 's'} being cultivated</p>` : '') +
    switches +
    wake
  );
}

/** E21.9: under old-city rules a region shows bloombot's share until helpers may join in. */
function oldCityShare(s: Sim, id: string): string {
  if (id === PARK || s.areas.info(id).noLandmark || s.areas.fog(id) === 'cleared') return '';
  const have = s.state.areas[id]?.byBot ?? 0;
  const need = s.areas.shareTarget(id);
  return s.areas.shareMet(id) ? `<p class="stat" data-share="${esc(id)}">🛸 Helpers can work here</p>` : `<p class="stat" data-share="${esc(id)}">🤖 Your share: ${Math.min(have, need)} / ${need}</p>`;
}
