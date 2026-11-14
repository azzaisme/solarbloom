import { PARK } from '../core/Areas';
import { formatCost } from '../core/Economy';
import { AREA_TYPES } from '../data/city';
import { MACHINES } from '../data/machines';
import { TUNING } from '../data/tuning';
import type { Sim } from '../gameplay/Sim';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** What each area type is good for, in plain language. */
export const AREA_SPECIALTY: Record<string, string> = {
  park: 'Lawns that grow biomass. Home.',
  street: 'Long paved runs: street gardens here pass chains along green corridors, and it adds steady energy.',
  plaza: 'Open paving that soaks up sun: the best energy bonus, and room for corridors.',
  canal: 'Water channels: adds steady water, and Reservoir Gardens grow here.',
  market: 'Crowded with stalls: a bit of biomass and energy once cleared.',
  reservoir: 'Dry clay basins: the best water bonus, and Reservoir Gardens grow here.',
  grove: 'Leaf litter around an Elder Tree: blooms nearby charge its Canopy Burst, and it adds biomass.',
};

const RES = { energy: '⚡', water: '💧', biomass: '🌿' } as const;

export interface AreaPanelData {
  id: string;
  name: string;
  type: string;
  fog: string;
  restored: number;
  need: number;
  ready: boolean;
  /** this area's share of its type's bonus, per minute */
  bonus: Partial<Record<keyof typeof RES, number>>;
  machines: Record<string, number>;
  /** City 09.1: the landmark's specialty action */
  specialty: { kind: string; label: string; hint: string; met: boolean; have: number; need: number };
}

/** Live facts about one area (pure: used by the panel and its tests). */
export function areaPanelData(sim: Sim, id: string): AreaPanelData {
  const s = sim;
  const a = s.areas.info(id);
  const fog = s.areas.fog(id);
  const c = s.areas.counts(id);
  const need = id === PARK ? TUNING.park.restoredTiles : s.areas.need(id);
  // The bonus this area gives: the type's total with it minus without it (soft-scaled), per minute.
  const C = TUNING.city;
  const n = s.areas.clearedByType()[a.type] ?? 0;
  const counted = fog === 'cleared' && id !== PARK;
  const k = counted ? Math.pow(n, C.bonusExponent) - Math.pow(n - 1, C.bonusExponent) : Math.pow(n + 1, C.bonusExponent) - Math.pow(n, C.bonusExponent);
  const bonus: AreaPanelData['bonus'] = {};
  for (const [r, v] of Object.entries(C.bonuses[a.type] ?? {})) bonus[r as keyof typeof RES] = Math.round(v * k * 60 * 10) / 10;
  const machines: Record<string, number> = {};
  for (const m of s.state.machines) if (m.type !== 'core' && s.areas.areaOf(m) === id) machines[m.type] = (machines[m.type] ?? 0) + 1;
  return {
    id,
    name: id === PARK ? 'The Park' : AREA_TYPES[a.type].name,
    type: a.type,
    fog,
    restored: c.restored,
    need,
    ready: id === PARK ? s.progression.coreReady() : s.areas.ready(id),
    bonus,
    machines,
    specialty: s.milestones.specialty(id),
  };
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
  const parkAwake = id === PARK && s.state.progression.coreActivated;
  let checklist: string;
  if (id === PARK) {
    checklist = s.progression
      .requirements()
      .map((r) => `<li>${r.done || parkAwake ? '✅' : '⬜'} ${r.label}</li>`)
      .concat(`<li>${parkAwake ? '✅' : '⬜'} Wake the ${esc(a.landmarkName)} (${formatCost(TUNING.core.cost)})</li>`)
      .join('');
  } else {
    const steps = [
      { done: d.fog !== 'hidden', label: 'Revealed next to clear ground' },
      { done: cleared || d.restored >= d.need, label: `Restore ${d.need} tiles (${Math.min(d.restored, d.need)}/${d.need})` },
      { done: cleared || d.specialty.met, label: esc(d.specialty.label) + (cleared || d.specialty.met ? '' : `<br><span class="sphint">${esc(d.specialty.hint)}</span>`) },
      { done: cleared, label: `Wake the ${esc(a.landmarkName)}` },
    ];
    checklist = steps.map((x) => `<li>${x.done ? '✅' : '⬜'} ${x.label}</li>`).join('');
  }
  const bonusText = Object.entries(d.bonus)
    .map(([r, v]) => `+${v} ${RES[r as keyof typeof RES]}/min`)
    .join(' ');
  const machineText = Object.entries(d.machines)
    .map(([t, n]) => `${MACHINES[t as keyof typeof MACHINES]?.icon ?? '⚙️'} ${n} ${MACHINES[t as keyof typeof MACHINES]?.name ?? t}${n === 1 ? '' : 's'}`)
    .join(' · ');
  const wake = d.ready && landmarkId && !cleared && !parkAwake ? `<button class="buy" data-wake="${landmarkId}">✨ Wake the ${esc(a.landmarkName)}</button>` : '';
  // City 10.7: the district this area belongs to, and its bloom.
  const ds = id === PARK && !parkAwake ? undefined : s.districts.status(s.districts.districtOf(id));
  const district = !ds
    ? ''
    : `<p class="stat" data-district-line="${esc(ds.id)}">🌸 District: ${esc(ds.name)} · ${ds.claimed ? 'bloomed' : `${Math.min(ds.awake, ds.need)}/${ds.need} neighbouring landmarks awake`}</p>` +
      (ds.available
        ? `<button class="buy" data-district="${esc(ds.id)}">🌸 Set off the district bloom</button>`
        : ds.claimed
          ? `<button class="mode" data-district="${esc(ds.id)}" data-replay="1" title="Plays it again; changes nothing">↻ Replay the district bloom</button>`
          : '');
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
    (id === PARK ? '' : `<p class="stat">${cleared ? 'Bonus' : 'Bonus once clear'}: ${bonusText || '—'}</p>`) +
    `<p class="stat">Machines: ${machineText || 'none yet'}</p>` +
    district +
    switches +
    wake
  );
}
