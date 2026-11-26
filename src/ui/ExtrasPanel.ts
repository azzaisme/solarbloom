import type { MachineData } from '../core/types';
import { HOMES, MUSHROOM_LOG, WORM_BIN, type Habitat, type HomeKind } from '../data/farmExtras';
import { MACHINES } from '../data/machines';
import { isHome } from '../gameplay/FarmExtras';
import type { Sim } from '../gameplay/Sim';
import { cardHead } from './OldCityPanel';
import { FRUIT_SAY } from './FruitWords';

/** Short words for a habitat a home still lacks. */
const LACKS: Record<Habitat, string> = {
  trees: 'trees or tall shrubs nearby',
  shrubs: 'more shrubs nearby',
  flowers: 'flowers or herbs nearby',
  water: 'water nearby',
  night: 'the night',
  quiet: 'a quieter spot, away from machines',
};

/**
 * E23.5.4: the panel for a beehive, fish pond, fruit tree, mushroom log, worm bin or wildlife home (opened with
 * Interact). How it is doing in words, and its one or two actions. No numbers beyond what is ready to take.
 */
export function extraHtml(sim: Sim, m: MachineData): string {
  const x = sim.farmExtras;
  const st = x.st(m);
  const name = MACHINES[m.type].name;
  const icon = MACHINES[m.type].icon;
  // E23.12 HUD reskin: the shared card head (icon, title, how it is doing), then its actions
  const row = (buttons: string) => `<div class="oc-row">${buttons.replace(/<button /g, '<button class="pn-btn" ')}</div>`;
  const card = (title: string, mood: string, body = '') => cardHead({ icon, title, mood }) + `<div class="oc-content">${body}</div>`;
  switch (m.type) {
    case 'beehive': {
      const settled = x.hiveSettled(m);
      const ready = Math.floor(st.ready ?? 0);
      const say = !settled ? 'Empty: bees will settle once flowers or herbs grow nearby.' : ready ? 'Busy, and heavy with honey.' : 'Busy: the bees are making honey and visiting the crops around it.';
      return card(name, say, row(`<button data-act="honey" ${ready ? '' : 'disabled'}>🍯 Take the honey${ready ? ` · ${ready}` : ''}</button>`));
    }
    case 'fishPond': {
      const say = x.pondFilled(m) ? 'Full and lively. Its water feeds the planters it reaches.' : 'Low: it needs water nearby to stay filled.';
      return card(name, say);
    }
    case 'orchard': {
      // #785: how the fruit is coming along, in what the tree shows (see FruitWords)
      const n = x.fruitYield(m);
      const over = x.overgrown(m);
      const say = `${FRUIT_SAY[x.fruitPhase(m)]}${over ? ' It’s getting shaggy and will fruit less until it’s pruned.' : ''}`;
      return card(name, say, row(`<button data-act="pick" ${n ? '' : 'disabled'}>🍎 Pick the fruit${n ? ` · ${n}` : ''}</button><button data-act="prune" ${over ? '' : 'disabled'}>🪵 Prune it</button>`));
    }
    case 'mushroomLog': {
      const ready = (st.ready ?? 0) >= 1;
      const spent = (st.flushes ?? 0) <= 0 && !ready;
      const say = ready
        ? 'Mushrooms are up.'
        : spent
          ? 'It wants compost: feed it some and mushrooms will grow.'
          : !x.logShaded(m)
            ? 'Too bright here: it needs shade beside it.'
            : x.logGrowing(m)
              ? 'Mushrooms are coming up.'
              : 'Resting: mushrooms grow at night and in fog.';
      return card(name, say, row(`<button data-act="mushrooms" ${ready ? '' : 'disabled'}>🍄 Pick the mushrooms</button><button data-act="inoculate" ${spent && sim.inventory.available('compost') >= MUSHROOM_LOG.compost ? '' : 'disabled'}>🟫 Feed it Compost</button>`));
    }
    case 'wormBin': {
      const fed = (st.fed ?? 0) > 0;
      const say = fed ? 'Wriggling away: the compost bins beside it work twice as fast.' : 'Hungry: feed the worms scraps.';
      const full = (st.fed ?? 0) + WORM_BIN.feedDays > WORM_BIN.maxDays + 1e-9;
      const can = sim.inventory.count('food') >= WORM_BIN.feedCost || sim.inventory.count('biomass') >= WORM_BIN.feedCost;
      return card(name, say, row(`<button data-act="worms" ${!full && can ? '' : 'disabled'}>${full ? 'The worms are full' : '🥕 Feed the worms scraps'}</button>`));
    }
  }
  if (isHome(m.type)) {
    const def = HOMES[m.type as HomeKind];
    const lacks = x.missing(m);
    const say = x.occupied(m)
      ? m.type === 'batBox' && !x.creatureOut(m)
        ? `${def.creature} live here. They sleep by day and fly at night.`
        : `${def.creature} live here.`
      : lacks.length
        ? `Empty: ${def.creature.toLowerCase()} want ${lacks.map((h) => LACKS[h]).join(' and ')}.`
        : `Empty for now: ${def.creature.toLowerCase()} will find it soon.`;
    return card(def.name, say);
  }
  return card(name, '');
}
