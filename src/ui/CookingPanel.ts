import { RECIPES, type MealId } from '../data/cooking';
import type { CookNeed } from '../gameplay/Cooking';
import type { Sim } from '../gameplay/Sim';
import { materialIcon } from './MaterialIcons';
import { cardHead } from './OldCityPanel';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One ingredient: its icon, how many the recipe takes, and how many Bloombot has (tinted short or enough). */
function chip(n: CookNeed): string {
  const ok = n.have >= n.need;
  return `<li class="pn-chip ${ok ? 'ok' : 'need'}" aria-label="${esc(`${n.name}: needs ${n.need}, you have ${n.have}`)}">${n.icon} ${esc(n.name)} ${n.have}/${n.need}</li>`;
}

/** Why the Cook button is greyed, in a few words under it. */
function why(sim: Sim, id: MealId): string {
  const p = sim.cooking.problem(id);
  if (!p) return '';
  if (p.kind === 'full') return `Your backpack has no room for more ${RECIPES[id].name}.`;
  if (p.kind === 'noStove') return 'The stove comes with the House.';
  const n = p.need;
  return n.from === 'basket' ? `Grow more ${n.name.toLowerCase()}: you keep one from each harvest.` : `Bring ${n.need - n.have} more ${n.name === 'Any fruit' ? 'fruit' : n.name}.`;
}

/**
 * #874 (epic #845): the stove's panel (its prompt, "Cook at the stove", opens it). Each recipe: what it takes, with
 * what Bloombot has of each, and Cook. The meal goes into the backpack, to eat or to give to a Keeper.
 */
export function cookingHtml(sim: Sim): string {
  const c = sim.cooking;
  const rows = c.recipes().map((id) => {
    const r = RECIPES[id];
    const can = !c.problem(id);
    const carried = sim.inventory.count(id);
    return (
      `<div class="oc-tile oc-cook"><h3 class="oc-cook-name">${materialIcon(id, 28)}${esc(r.name)}</h3>` +
      `<p class="pn-note">${esc(r.blurb)} ${r.charge} Charge.${carried ? ` You have ${carried} in your backpack.` : ''}</p>` +
      `<ul class="pn-chips oc-need">${c.needs(id).map(chip).join('')}</ul>` +
      `<div class="oc-row"><button class="pn-btn${can ? ' primary' : ''} oc-mat-btn" data-act="cook" data-arg="${id}" ${can ? '' : 'disabled'}>${materialIcon(id, 24)}Cook ${esc(r.name)}</button></div>` +
      (can ? '' : `<p class="pn-note">${esc(why(sim, id))}</p>`) +
      `</div>`
    );
  });
  return (
    cardHead({ icon: materialIcon('soup', 30), title: 'The stove', mood: 'Cook a meal to eat later or to give to a friend.', tone: 'leaf', badge: 'sun', choose: 'Cook' }) +
    `<div class="oc-content">${rows.join('')}</div>`
  );
}
