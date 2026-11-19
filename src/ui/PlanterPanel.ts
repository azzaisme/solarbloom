import type { MachineData } from '../core/types';
import { CROPS, crossName, PLANTER, type CropId, type Like } from '../data/crops';
import { MATERIALS, type MaterialCost } from '../data/salvage';
import type { Sim } from '../gameplay/Sim';
import { escHtml } from './OldCityPanel';
import { keeperById } from '../core/OldCityLayout';

/** A price from data as words ("2 Timber", "1 Fertiliser"). */
const price = (c: MaterialCost) =>
  (Object.entries(c) as [keyof typeof MATERIALS, number][])
    .filter(([, v]) => v)
    .map(([k, v]) => `${v} ${MATERIALS[k].name}`)
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
 * actions, no counters: the bed itself shows how far along it is.
 */
export function planterHtml(sim: Sim, m: MachineData): string {
  const f = sim.farm;
  // E23.5.4.6: a planter by a woken Keeper is its garden: say what it would like grown here
  const keeper = sim.farmExtras.gardenOf(m);
  const req = keeper ? sim.farmExtras.request(keeper) : undefined;
  const garden = keeper && req ? `<p class="oc-say">${escHtml(keeperById(keeper)?.name ?? '')}'s garden: “${escHtml(req.ask)}”</p>` : '';
  const st = f.bed(m);
  const lk = f.look(m);
  const inv = sim.inventory;
  const extras = `<h3>Extras</h3><div class="oc-row">
      <button data-act="extra" data-arg="trellis" ${st.trellis || !inv.canPay(PLANTER.extras.trellis) ? 'disabled' : ''}>${st.trellis ? 'Trellis ✓' : `Add a trellis · ${price(PLANTER.extras.trellis)}`}</button>
      <button data-act="extra" data-arg="flooded" ${st.flooded || !inv.canPay(PLANTER.extras.flooded) ? 'disabled' : ''}>${st.flooded ? 'Flooded ✓' : `Flood the bed · ${price(PLANTER.extras.flooded)}`}</button>
    </div>`;
  if (!lk.crop) {
    const seeds = inv.available('seeds');
    const crops = f.known().map((c) => {
      const d = CROPS[c];
      return `<button data-act="plant" data-arg="${c}" ${seeds < PLANTER.seedCost ? 'disabled' : ''}><b>${d.icon} ${escHtml(d.name)}</b><br><small>${escHtml(d.use)}</small></button>`;
    });
    // E23.6.2: crossbreeds found, each with both parents' likes
    for (const [a, b] of f.crosses())
      crops.push(`<button data-act="plant" data-arg="${a}+${b}" ${seeds < PLANTER.seedCost ? 'disabled' : ''}><b>${CROPS[a].icon} ${escHtml(crossName(a, b))}</b><br><small>A cross: happy with what either likes</small></button>`);
    return `<h2>🟫 An empty planter</h2>${garden}
      <p class="oc-soft">${seeds >= PLANTER.seedCost ? 'Choose what to grow. Each planting takes a Seed.' : 'Bring Seeds to plant something.'}</p>
      <div class="oc-row oc-crops">${crops.join('')}</div>${extras}`;
  }
  const d = CROPS[lk.crop as CropId];
  const other = st.cross ? CROPS[st.cross as CropId] : undefined;
  const needs = other ? d.needs.filter((n) => other.needs.includes(n)) : d.needs;
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
  return `<h2>${d.icon} ${escHtml(other ? crossName(lk.crop as CropId, st.cross as CropId) : d.name)}</h2>${garden}
    <p>${escHtml(mood)}</p>
    <div class="oc-row">
      ${lk.ripe ? '<button data-act="harvest">Harvest</button>' : ''}
      <button data-act="feed" ${st.fed || !inv.canPay({ fertiliser: PLANTER.feedCost }) ? 'disabled' : ''}>${st.fed ? 'Fed ✓' : `Feed · ${price({ fertiliser: PLANTER.feedCost })}`}</button>
    </div>${extras}`;
}
