import type { ItemId, MachineData } from '../core/types';
import { AUTOMATION, type RouteItem } from '../data/automation';
import { ITEM_IDS, itemDef } from '../data/items';
import type { Sim } from '../gameplay/Sim';
import './craft.css';
import { materialIcon } from './MaterialIcons';

/**
 * E23.6.4 (#440): a supply crate, opened with Interact. A full-screen panel under E22's rules (the game pauses; arrows
 * or the d-pad move the focus ring; Enter or A press; Esc or B close). On the left, everything in the backpack and the
 * crate; the item in focus shows both counts and moves 1 / 10 / all of it either way. Below, the crate's courier
 * routes: where each goes (or comes from), what it carries (pressing it steps through "everything" and each item in
 * the source crate) and a button to take the route away.
 */
export interface CrateHost {
  sim: Sim;
  changed?(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A crate's name: crates are numbered in the order they were set down ("Crate 2"). */
export function crateName(sim: Sim, id: string): string {
  const n = sim.automation.crates().findIndex((c) => c.id === id) + 1;
  return n ? `Crate ${n}` : 'a crate';
}

/** How far one crate is from another, in steps (tiles). */
function steps(a: MachineData, b: MachineData): number {
  return Math.round(Math.hypot(a.x - b.x, a.z - b.z));
}

export class CratePanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private live: HTMLElement;
  private titleEl: HTMLElement;
  private crate?: MachineData;
  private sel: ItemId = 'scrap';

  constructor(
    parent: HTMLElement,
    private host: CrateHost,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'crateScreen';
    this.el.className = 'screen';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'ctTitle');
    this.el.innerHTML =
      `<div class="panel screen-card bp-card"><header class="screen-head"><h2 id="ctTitle">Supply crate</h2><button class="screen-back" data-back>Back</button></header>` +
      `<div class="screen-body bp-body" id="ctBody"></div><p class="bp-live" role="status" aria-live="polite"></p></div>`;
    parent.appendChild(this.el);
    this.body = this.el.querySelector<HTMLElement>('#ctBody')!;
    this.live = this.el.querySelector<HTMLElement>('.bp-live')!;
    this.titleEl = this.el.querySelector<HTMLElement>('#ctTitle')!;
    this.el.hidden = true;
    this.el.querySelector('[data-back]')!.addEventListener('click', () => this.close());
    this.body.addEventListener('click', (e) => this.click(e.target as HTMLElement));
    this.body.addEventListener('focusin', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-item]');
      if (t && t.dataset.item !== this.sel) {
        this.sel = t.dataset.item as ItemId;
        this.select();
      }
    });
    for (const ev of ['crate.changed', 'route.changed'] as const)
      host.sim.bus.on(ev, () => {
        if (this.isOpen) this.refresh();
      });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(crate: MachineData) {
    this.crate = crate;
    this.titleEl.textContent = crateName(this.host.sim, crate.id);
    this.el.hidden = false;
    this.el.classList.add('open');
    this.live.textContent = '';
    this.body.innerHTML = this.render();
    this.body.querySelector<HTMLElement>('[data-item]')?.focus({ focusVisible: true } as FocusOptions);
  }

  close() {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.el.classList.remove('open');
    this.crate = undefined;
  }

  refresh() {
    if (!this.isOpen) return;
    const id = (document.activeElement as HTMLElement | null)?.id;
    this.body.innerHTML = this.render();
    if (id) this.body.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.focus({ focusVisible: true } as FocusOptions);
  }

  /** The items to show: anything in the backpack or the crate (scrap first, so the grid is never empty). */
  private items(): ItemId[] {
    const sim = this.host.sim;
    const id = this.crate!.id;
    const out = ITEM_IDS.filter((i) => sim.inventory.count(i) > 0 || sim.automation.count(id, i) > 0);
    return out.length ? out : ['scrap'];
  }

  private render(): string {
    const sim = this.host.sim;
    const id = this.crate!.id;
    const items = this.items();
    if (!items.includes(this.sel)) this.sel = items[0];
    const grid = items
      .map((i) => {
        const name = itemDef(i).name;
        const pack = sim.inventory.count(i);
        const box = sim.automation.count(id, i);
        const label = `${name}, ${pack} in backpack, ${box} in the crate`;
        return `<button class="bp-cell" role="option" id="ctitem-${i}" data-item="${i}" aria-selected="${i === this.sel}" aria-label="${esc(label)}">${materialIcon(i, 40)}<span class="bp-name">${esc(name)}</span><span class="bp-count">${pack}</span><span class="bp-stored">Crate ${box}</span></button>`;
      })
      .join('');
    return (
      `<div class="bp-split"><div><p class="bp-help">${sim.automation.load(id)} of ${AUTOMATION.crate.capacity} in the crate.</p><div class="bp-grid" role="listbox" aria-label="Things" aria-orientation="horizontal">${grid}</div>${this.routesHtml()}</div>` +
      `<div class="bp-detail" id="ctDetail">${this.detail()}</div></div>`
    );
  }

  private detail(): string {
    const sim = this.host.sim;
    const id = this.crate!.id;
    const i = this.sel;
    const name = itemDef(i).name;
    const pack = sim.inventory.count(i);
    const box = sim.automation.count(id, i);
    const btn = (act: string, n: string, label: string, ok: boolean, aria: string) => `<button id="ct-${act}-${n}" data-move="${act}" data-n="${n}" aria-label="${esc(aria)}" ${ok ? '' : 'aria-disabled="true"'}>${label}</button>`;
    const canPut = pack > 0 && sim.automation.room(id) > 0;
    const canTake = box > 0 && sim.inventory.room(i) > 0;
    return (
      `<h3>${materialIcon(i, 28)} ${esc(name)}</h3><dl><dt>In your backpack</dt><dd>${pack}</dd><dt>In the crate</dt><dd>${box}</dd></dl>` +
      `<h4 id="ctPutH">Put in the crate</h4><div class="bp-moves" role="group" aria-labelledby="ctPutH">${btn('put', '1', '1', canPut, `Put 1 ${name} in the crate`)}${btn('put', '10', '10', canPut, `Put 10 ${name} in the crate`)}${btn('put', 'all', 'All of it', canPut, `Put all your ${name} in the crate`)}</div>` +
      `<h4 id="ctTakeH">Take from the crate</h4><div class="bp-moves" role="group" aria-labelledby="ctTakeH">${btn('take', '1', '1', canTake, `Take 1 ${name} from the crate`)}${btn('take', '10', '10', canTake, `Take 10 ${name} from the crate`)}${btn('take', 'all', 'All of it', canTake, `Take all the ${name} from the crate`)}</div>`
    );
  }

  private routesHtml(): string {
    const sim = this.host.sim;
    const id = this.crate!.id;
    const out = sim.automation.routes().filter((r) => r.from === id);
    const into = sim.automation.routes().filter((r) => r.to === id);
    // a new route: any other crate this one isn't sending to yet (nearest first)
    const here = this.crate!;
    const others = sim.automation
      .crates()
      .filter((c) => c.id !== id && !out.some((r) => r.to === c.id))
      .sort((a, b) => steps(here, a) - steps(here, b));
    const why = others.length ? sim.automation.routeProblem(id, others[0].id) : undefined;
    const send = !others.length
      ? ''
      : why && !why.startsWith('Pick') && !why.startsWith('These')
        ? `<p class="bp-help">${esc(why)}</p>`
        : `<div class="bp-moves ct-send" role="group" aria-label="Send to another crate">${others
            .map((c) => {
              const name = crateName(sim, c.id);
              const far = steps(here, c);
              return `<button id="ct-send-${c.id}" data-send="${c.id}" aria-label="${esc(`Send to ${name}, ${far} steps away`)}">Send to ${esc(name)} <small>${far} steps</small></button>`;
            })
            .join('')}</div>`;
    if (!out.length && !into.length && !send) return '';
    const what = (item: RouteItem) => (item === 'all' ? 'Everything' : itemDef(item).name);
    const row = (r: (typeof out)[number], dir: 'to' | 'from') => {
      const other = crateName(sim, dir === 'to' ? r.to : r.from);
      const flying = sim.automation.hubsFor(r).length > 0;
      return (
        `<li><b>${dir === 'to' ? 'To' : 'From'} ${esc(other)}</b>` +
        `<button id="ct-item-${r.id}" data-route-item="${r.id}" aria-label="${esc(`Carries ${what(r.item)}: change what it carries`)}">${esc(what(r.item))}</button>` +
        `<button id="ct-drop-${r.id}" data-route-drop="${r.id}" aria-label="${esc(`Stop sending things ${dir} ${other}`)}">Stop</button>` +
        (flying ? '' : `<span class="ct-warn">No Drone Hub with Courier drones is close to both crates</span>`) +
        `</li>`
      );
    };
    const list = out.length || into.length ? `<ul class="cr-machines ct-routes">${out.map((r) => row(r, 'to')).join('')}${into.map((r) => row(r, 'from')).join('')}</ul>` : '';
    return `<h3 class="set-h">Courier drones</h3>${list}${send}`;
  }

  private select() {
    for (const b of this.body.querySelectorAll<HTMLElement>('[data-item]')) b.setAttribute('aria-selected', String(b.dataset.item === this.sel));
    const d = this.body.querySelector<HTMLElement>('#ctDetail');
    if (d) d.innerHTML = this.detail();
  }

  private say(t: string) {
    this.live.textContent = t;
  }

  private click(t: HTMLElement) {
    const sim = this.host.sim;
    const a = sim.automation;
    const id = this.crate?.id;
    if (!id) return;
    const mv = t.closest<HTMLElement>('[data-move]');
    if (mv) {
      if (mv.getAttribute('aria-disabled')) return this.say('Nothing to move');
      const n = mv.dataset.n === 'all' ? undefined : Number(mv.dataset.n);
      const name = itemDef(this.sel).name;
      const done = mv.dataset.move === 'put' ? a.fill(id, this.sel, n) : a.empty(id, this.sel, n);
      this.say(done ? `${mv.dataset.move === 'put' ? 'Put' : 'Took'} ${done} ${name}` : 'Nothing to move');
      this.host.changed?.();
      return this.refresh();
    }
    const ri = t.closest<HTMLElement>('[data-route-item]');
    if (ri) {
      const r = a.routes().find((q) => q.id === ri.dataset.routeItem);
      if (!r) return;
      // step through: everything, then each item in the source crate
      const choices: RouteItem[] = ['all', ...ITEM_IDS.filter((i) => a.count(r.from, i) > 0)];
      if (r.item !== 'all' && !choices.includes(r.item)) choices.push(r.item);
      const next = choices[(choices.indexOf(r.item) + 1) % choices.length];
      a.setRouteItem(r.id, next);
      this.say(`Carries ${next === 'all' ? 'everything' : itemDef(next).name}`);
      return this.refresh();
    }
    const sd = t.closest<HTMLElement>('[data-send]');
    if (sd) {
      const res = a.addRoute(id, sd.dataset.send!);
      this.say(res.id ? `Courier drones will carry everything to ${crateName(sim, sd.dataset.send!)}` : (res.why ?? ''));
      this.refresh();
      // the new route's "what it carries" button, so the next press can change it
      if (res.id) this.body.querySelector<HTMLElement>(`#ct-item-${CSS.escape(res.id)}`)?.focus({ focusVisible: true } as FocusOptions);
      return;
    }
    const rd = t.closest<HTMLElement>('[data-route-drop]');
    if (rd) {
      a.removeRoute(rd.dataset.routeDrop!);
      this.say('Stopped: nothing more goes that way');
      return this.refresh();
    }
    const cell = t.closest<HTMLElement>('[data-item]');
    if (cell) {
      this.sel = cell.dataset.item as ItemId;
      this.select();
      this.body.querySelector<HTMLElement>('#ctDetail [data-move]:not([aria-disabled])')?.focus({ focusVisible: true } as FocusOptions);
    }
  }
}
