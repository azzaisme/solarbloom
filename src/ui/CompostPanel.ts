import { FRUIT_IDS } from '../data/fruit';
import type { MachineData } from '../core/types';
import { COMPOST, DIGESTER } from '../data/compost';
import type { Sim } from '../gameplay/Sim';
import { materialIcon, type MaterialIconId } from './MaterialIcons';
import { cardHead } from './OldCityPanel';
import { icon } from './PanelShell';

/**
 * E23.5.3: the compost bin's panel (opened with Interact). What it holds, in words and small counts, and the actions:
 * put Greens or food in, take fertiliser or compost out, put carried compost back to mature.
 *
 * E23.11 (Sunlit Glass): a machine card docked right: how it is doing heads the card, then what is ready to take
 * (counts only for what is gathered by hand), "Put in" and "Take".
 */
export function compostHtml(sim: Sim, m: MachineData): string {
  const st = sim.compost.bin(m);
  const inv = sim.inventory;
  const feed = st.feed ?? 0;
  const compost = Math.floor(st.compost ?? 0);
  const fert = Math.floor(st.fertiliser ?? 0);
  const full = compost + fert >= COMPOST.outputCapacity;
  const state = full
    ? 'Full: take what it has made and it carries on.'
    : feed >= COMPOST.perCompost
      ? 'Rotting down nicely.'
      : compost
        ? 'Slowly turning into Fertiliser.'
        : 'Waiting for Greens and food scraps.';
  const room = sim.compost.room(m);
  const fruitHeld = FRUIT_IDS.filter((f) => inv.count(f) > 0).sort((a, b) => inv.count(b) - inv.count(a))[0];
  const btn = (act: string, arg: string, mat: MaterialIconId, label: string, ok: boolean) => `<button class="pn-btn oc-mat-btn" data-act="${act}"${arg ? ` data-arg="${arg}"` : ''} ${ok ? '' : 'disabled'}>${materialIcon(mat, 24)}${label}</button>`;
  return (
    cardHead({ icon: materialIcon('compost', 30), title: 'Compost Bin', mood: state, tone: full ? 'leaf' : '', badge: 'sun' }) +
    `<div class="oc-content"><div class="oc-tile"><h3 class="pn-label">Ready to take</h3><ul class="pn-chips"><li class="pn-chip">${materialIcon('fertiliser', 20)}${fert} Fertiliser</li><li class="pn-chip">${materialIcon('compost', 20)}${compost} Compost</li></ul></div>` +
    `<h3 class="pn-label">Put in</h3><div class="oc-row oc-col">` +
    btn('fill', 'biomass', 'biomass', 'All my Greens', !!inv.count('biomass') && room >= 1) +
    btn('fill', 'food', 'food', 'All my Food', !!inv.count('food') && room >= COMPOST.foodWorth) +
    // #785: fruit rots down like Food (every kind carried, in one go)
    (fruitHeld ? btn('fill', 'fruit', fruitHeld, 'All my fruit', room >= COMPOST.foodWorth) : '') +
    btn('return', '', 'compost', 'My Compost, to turn into Fertiliser', !!inv.count('compost') && !full) +
    `</div><h3 class="pn-label">Take</h3><div class="oc-row">` +
    btn('take', 'fertiliser', 'fertiliser', 'Fertiliser', fert > 0) +
    btn('take', 'compost', 'compost', 'Compost', compost > 0) +
    `</div></div>`
  );
}

/** E23.5.3: the Bio Digester's panel: how it is doing, in words, and Feed. */
export function digesterHtml(sim: Sim, m: MachineData): string {
  const mood = sim.compost.mood(m);
  const state =
    mood === 'running'
      ? 'Running: it powers the machines joined to it.'
      : mood === 'idle'
        ? 'Fed and waiting: the machines joined to it have all the power they need right now.'
        : 'Empty, so it has stopped. Feed it Greens to start it.';
  const full = sim.compost.fuel(m) >= DIGESTER.capacity - 1e-9;
  const ok = !!sim.inventory.count('biomass') && !full;
  return (
    cardHead({ icon: icon('bolt', 'l'), title: 'Bio Digester', mood: state, tone: mood === 'running' ? 'leaf' : mood === 'idle' ? '' : 'clay', badge: 'sun', choose: 'Feed' }) +
    `<div class="oc-content"><div class="oc-tile"><div class="pn-bar sun" aria-hidden="true"><i style="width:${Math.round(Math.min(1, sim.compost.fuel(m) / DIGESTER.capacity) * 100)}%"></i></div><p class="pn-note">${full ? 'It is full to the top.' : 'It turns Greens into power for the machines joined to it, day and night.'}</p></div>` +
    `<div class="oc-row"><button class="pn-btn primary oc-mat-btn" data-act="feed" ${ok ? '' : 'disabled'}>${materialIcon('biomass', 24)}${full ? 'It is full' : 'Feed it Greens'}</button></div></div>`
  );
}
