import type { MachineData } from '../core/types';
import { CROPS, crossName, PLANTER, type CropId, type Like } from '../data/crops';
import { MATERIALS, type MaterialCost } from '../data/salvage';
import type { Sim } from '../gameplay/Sim';
import { cardHead, escHtml } from './OldCityPanel';
import { icon } from './PanelShell';

/** A price from data as words ("2 Timber", "1 Fertiliser"). */
const price = (c: MaterialCost) =>
  (Object.entries(c) as [keyof typeof MATERIALS, number][])
    .filter(([, v]) => v)
    .map(([k, v]) => `${v} ${k === 'biomass' ? 'Greens' : MATERIALS[k].name}`)
    .join(' + ');

/** Short words for what a crop likes (the planter panel; no numbers). */
const LIKE_WORDS: Record<Like, string> = {
  sun: 'sunshine',
  rain: 'rain',
  shade: 'shade',
  wind: 'wind',
  trellis: 'a trellis',
  flooded: 'a flooded bed',
  fertiliser: 'fertiliser',
  runningWater: 'running water',
  night: 'the night',
  saltAir: 'salt air',
};

/**
 * E23.5.2: the planter's panel (opened with Interact). An empty bed lists the crops bloombot has seeds for; a
 * growing one says how it is doing in words (thirsty, resting, happy) and offers fertiliser and the extras. Only
 * actions, no counters: the bed itself shows how far along it is (the card's bar is the same picture, no number).
 *
 * E23.11 (Sunlit Glass, docs/art/ui-sunlit-glass/Planter.dc.html): a machine card docked right. The crop and its
 * mood head the card (clay when it is thirsty), then a tile with the crop's bar, "Tend" (feed, harvest) and the
 * extras; an empty bed shows its crops as cells to plant. A button it can't press says why beside it.
 */
export function planterHtml(sim: Sim, m: MachineData): string {
  const f = sim.farm;
  const st = f.bed(m);
  const lk = f.look(m);
  const inv = sim.inventory;
  const lock = icon('lock', 's');
  const extra = (arg: 'trellis' | 'flooded', done: boolean, doneText: string, label: string) => {
    const cost = PLANTER.extras[arg];
    const can = !done && inv.canPay(cost);
    return `<button class="pn-btn${done ? ' oc-done' : ''}" data-act="extra" data-arg="${arg}" ${can ? '' : 'disabled'}>${done ? `${icon('check', 's')}${doneText}` : `${can ? '' : lock}${label} · ${price(cost)}`}</button>`;
  };
  const extras = `<h3 class="pn-label">Extras</h3><div class="oc-row">${extra('trellis', !!st.trellis, 'Has a trellis', 'Add a trellis')}${extra('flooded', !!st.flooded, 'Flooded', 'Flood the bed')}</div>`;
  if (!lk.crop) {
    const seeds = inv.available('seeds');
    const ok = seeds >= PLANTER.seedCost;
    const cell = (arg: string, ic: string, name: string, use: string) => `<button class="pn-cell oc-crop" data-act="plant" data-arg="${arg}" ${ok ? '' : 'disabled'}><span class="oc-crop-ic">${ic}</span><b>${escHtml(name)}</b><small>${escHtml(use)}</small></button>`;
    const crops = f.known().map((c) => cell(c, CROPS[c].icon, CROPS[c].name, CROPS[c].use));
    // E23.6.2: crossbreeds found, each with both parents' likes
    for (const [a, b] of f.crosses()) crops.push(cell(`${a}+${b}`, CROPS[a].icon, crossName(a, b), 'A cross: happy with what either likes'));
    return (
      cardHead({ icon: icon('sprout', 'l'), title: 'An empty planter', mood: ok ? 'Choose what to grow. Each planting takes a Seed.' : 'Bring Seeds to plant something.', tone: ok ? '' : 'clay', choose: 'Plant' }) +
      `<div class="oc-content"><h3 class="pn-label">Next to plant</h3><div class="oc-crops">${crops.join('')}</div>${extras}</div>`
    );
  }
  const d = CROPS[lk.crop as CropId];
  const other = st.cross ? CROPS[st.cross as CropId] : undefined;
  const needs = other ? d.needs.filter((n) => other.needs.includes(n)) : d.needs;
  const thirsty = !lk.ripe && lk.wilting;
  const mood = lk.ripe
    ? 'Ripe and ready to harvest.'
    : lk.wilting
      ? f.thirst(m) === 'none'
        ? 'Thirsty: no water reaches it here. Beds drink from a canal or pond close by, or from the rain.'
        : 'Thirsty: its water has run low. It is wilting and will perk up once the water fills again.'
      : lk.resting
        ? `Resting: it only grows with ${needs.map((n) => LIKE_WORDS[n]).join(' and ')}.`
        : lk.unmet.length
          ? `Growing slowly: it would love ${lk.unmet.map((n) => LIKE_WORDS[n]).join(' and ')}.`
          : 'Growing happily.';
  const name = other ? crossName(lk.crop as CropId, st.cross as CropId) : d.name;
  const canFeed = !st.fed && inv.canPay({ fertiliser: PLANTER.feedCost });
  const feed = st.fed
    ? `<button class="pn-btn oc-done" data-act="feed" disabled>${icon('check', 's')}Fed</button>`
    : `<button class="pn-btn" data-act="feed" ${canFeed ? '' : 'disabled'}>${canFeed ? '' : lock}Feed · ${price({ fertiliser: PLANTER.feedCost })}</button>`;
  const why = !st.fed && !canFeed ? `<p class="pn-note">You have no Fertiliser. Compost bins turn Greens and food scraps into it.</p>` : '';
  return (
    cardHead({ icon: icon('sprout', 'l'), title: name, mood, tone: thirsty ? 'clay' : lk.ripe ? 'leaf' : '', choose: lk.ripe ? 'Harvest' : 'Choose' }) +
    `<div class="oc-content"><div class="oc-tile"><div class="oc-tile-row"><span class="oc-crop-ic">${d.icon}</span><b>${escHtml(name)}</b><span class="pn-soft">${lk.ripe ? 'Ripe' : lk.resting ? 'Resting' : thirsty ? 'Wilting' : 'Growing'}</span></div>` +
    `<div class="pn-bar${thirsty ? ' sun' : ''}" aria-hidden="true"><i style="width:${Math.round(lk.progress * 100)}%"></i></div><p class="pn-note">${escHtml(d.use)}.</p></div>` +
    `<h3 class="pn-label">Tend</h3><div class="oc-row">${lk.ripe ? `<button class="pn-btn primary" data-act="harvest">${icon('check', 's')}Harvest</button>` : ''}${feed}</div>${why}${extras}</div>`
  );
}
