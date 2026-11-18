import type { MachineData } from '../core/types';
import { COMPOST, DIGESTER } from '../data/compost';
import type { Sim } from '../gameplay/Sim';

/**
 * E23.5.3: the compost bin's panel (opened with Interact). What it holds, in words and small counts, and the actions:
 * put biomass or food in, take fertiliser or compost out, put carried compost back to mature.
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
        ? 'Maturing into fertiliser.'
        : 'Waiting for biomass and food scraps.';
  const room = sim.compost.room(m);
  return `<h2>🟫 Compost bin</h2>
    <p>${state}</p>
    <div class="oc-need"><span>Ready to take</span><span>${fert} Fertiliser · ${compost} Compost</span></div>
    <h3>Put in</h3><div class="oc-row">
      <button data-act="fill" data-arg="biomass" ${inv.count('biomass') && room >= 1 ? '' : 'disabled'}>🌿 All my Biomass</button>
      <button data-act="fill" data-arg="food" ${inv.count('food') && room >= COMPOST.foodWorth ? '' : 'disabled'}>🥕 All my Food</button>
      <button data-act="return" ${inv.count('compost') && !full ? '' : 'disabled'}>🟫 My Compost, to mature</button>
    </div>
    <h3>Take</h3><div class="oc-row">
      <button data-act="take" data-arg="fertiliser" ${fert ? '' : 'disabled'}>🧪 Fertiliser</button>
      <button data-act="take" data-arg="compost" ${compost ? '' : 'disabled'}>🟫 Compost</button>
    </div>`;
}

/** E23.5.3: the Bio Digester's panel: how it is doing, in words, and Feed. */
export function digesterHtml(sim: Sim, m: MachineData): string {
  const mood = sim.compost.mood(m);
  const hasGrid = !!(sim as unknown as { power?: unknown }).power;
  const state =
    mood === 'running'
      ? 'Running: it is powering its grid.'
      : mood === 'idle'
        ? hasGrid
          ? 'Fed and waiting: nothing on its grid needs power right now.'
          : 'Fed and waiting for a grid to power.'
        : 'Empty, so it has stopped. Feed it biomass to start it.';
  return `<h2>⚡ Bio Digester</h2>
    <p>${state}</p>
    <div class="oc-row"><button data-act="feed" ${sim.inventory.count('biomass') && sim.compost.fuel(m) < DIGESTER.capacity - 1e-9 ? '' : 'disabled'}>${sim.compost.fuel(m) >= DIGESTER.capacity - 1e-9 ? 'The hopper is full' : '🌿 Feed it Biomass'}</button></div>`;
}
