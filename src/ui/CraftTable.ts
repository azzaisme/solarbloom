import type { ComponentId, ItemId } from '../core/types';
import { MACHINES } from '../data/machines';
import { DECOR_OPTION } from '../data/cozy';
import { itemDef } from '../data/items';
import type { ItemCost } from '../data/crafting';
import { BRANCHES, type Find } from '../data/research';
import { findKey } from '../gameplay/Research';
import { gameDays } from '../data/time';
import type { Sim } from '../gameplay/Sim';
import { materialIcon } from './MaterialIcons';
import './craft.css';

/**
 * E23.6.1 (#435): the crafting table, in the house from the start. A full-screen panel with two tabs, Craft and
 * Upgrade, under E22's panel rules: the game pauses while it is open (the table keeps working: the panel runs it),
 * LB / RB or Q / E change tab, arrows or the d-pad move the focus ring, Enter or A press, Esc or B close.
 *
 * - Craft: the components known, each with what it needs and how many are at hand; the one in focus shows its
 *   recipe, "Make 1" and "Make 5", and the queue with the craft in hand. Below, the machines the table knows
 *   (built from the build menu, paid there).
 * - Upgrade: the upgrades research has opened, each with its level (at most 3) and the next level's cost.
 * - Research (E23.6.2, once the first Keeper wakes): the station. New finds to look at, the bench (projects
 *   running, or waiting for power), and the open projects by branch; the one in focus shows what it is about,
 *   what it takes and how long it runs.
 */
export interface CraftHost {
  sim: Sim;
  changed?(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const CRAFT_TABS = [
  { id: 'craft', label: 'Craft' },
  { id: 'upgrade', label: 'Upgrade' },
  { id: 'research', label: 'Research' },
] as const;
export type CraftTabId = (typeof CRAFT_TABS)[number]['id'];

export interface CostPart {
  id: ItemId;
  name: string;
  have: number;
  need: number;
}

/** A cost, part by part, with what is at hand (backpack, plus the store within reach). */
export function costParts(sim: Sim, cost: ItemCost): CostPart[] {
  return sim.inventory.describe(cost).map((p) => ({ id: p.id, name: p.name, have: p.have, need: p.need }));
}

export const costText = (parts: CostPart[]) => parts.map((p) => `${p.need} ${p.name}`).join(', ');

export interface ComponentRow {
  id: ComponentId;
  name: string;
  makes: number;
  /** at hand now (backpack, plus the store within reach) */
  have: number;
  parts: CostPart[];
  /** why it can't be made now */
  problem?: string;
  /** "Wire, makes 2 from 2 Copper, 14 at hand" */
  label: string;
}

/** The Craft tab's components (pure read: tests check the words without a page). */
export function componentRows(sim: Sim): ComponentRow[] {
  return sim.crafting.components().map((r) => {
    const name = itemDef(r.id).name;
    const parts = costParts(sim, r.cost);
    const have = sim.inventory.available(r.id);
    return { id: r.id, name, makes: r.makes, have, parts, problem: sim.crafting.problem(r.id), label: `${name}, makes ${r.makes} from ${costText(parts)}, ${have} at hand` };
  });
}

/** Minutes of play a project takes (a game day is 48 minutes of play). */
export const projectMinutes = (days: number) => Math.max(1, Math.round(gameDays(days) / 60));

/** The Upgrade tab's rows (pure read). */
export function upgradeRows(sim: Sim) {
  return sim.research.upgrades().map((u) => {
    const level = sim.research.level(u.id);
    const next = u.levels[level];
    return { id: u.id, name: u.name, each: u.each, level, max: u.levels.length, parts: next ? costParts(sim, next.cost) : [], problem: sim.research.upgradeProblem(u.id) };
  });
}

/** E23.6.1: the decorations the table knows, made or not (each is made once, then placed free). */
export function decorRows(sim: Sim): { id: string; name: string; icon: string; parts: CostPart[]; made: boolean; problem?: string }[] {
  return sim.crafting.decorations().map((r) => ({
    id: r.id,
    name: DECOR_OPTION[r.id]?.name ?? r.id,
    icon: DECOR_OPTION[r.id]?.icon ?? '',
    parts: costParts(sim, r.cost),
    made: sim.crafting.decorMade(r.id),
    problem: sim.crafting.decorProblem(r.id),
  }));
}

/** The machines the table knows that can be built now (a recipe waiting for its machine stays off the list). */
export function machineRows(sim: Sim): { id: string; name: string; parts: CostPart[]; ready: boolean }[] {
  return sim.crafting
    .machines()
    .filter((r) => r.builds && MACHINES[r.builds])
    .map((r) => {
      const parts = costParts(sim, r.cost);
      return { id: r.id, name: r.name, parts, ready: parts.every((p) => p.have >= p.need) };
    });
}

export class CraftTable {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private tabs: HTMLElement;
  private live: HTMLElement;
  current: CraftTabId = 'craft';
  private sel?: ComponentId;
  private selProject?: string;

  constructor(
    parent: HTMLElement,
    private host: CraftHost,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'craftScreen';
    this.el.className = 'screen';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'crTitle');
    this.el.innerHTML =
      `<div class="panel screen-card bp-card"><header class="screen-head"><h2 id="crTitle">Crafting table</h2><button class="screen-back" data-back>Back</button></header>` +
      `<div class="tabs" role="tablist" aria-label="Crafting table">${CRAFT_TABS.map((t) => `<button role="tab" id="crtab-${t.id}" data-tab="${t.id}" aria-controls="crBody" aria-selected="false" tabindex="-1">${t.label}</button>`).join('')}</div>` +
      `<div class="screen-body bp-body" id="crBody" role="tabpanel"></div><p class="bp-live" role="status" aria-live="polite"></p></div>`;
    parent.appendChild(this.el);
    this.body = this.el.querySelector<HTMLElement>('#crBody')!;
    this.tabs = this.el.querySelector<HTMLElement>('.tabs')!;
    this.live = this.el.querySelector<HTMLElement>('.bp-live')!;
    this.el.hidden = true;
    this.el.querySelector('[data-back]')!.addEventListener('click', () => this.close());
    this.tabs.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (t) this.show(t.dataset.tab as CraftTabId, true);
    });
    this.tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      this.tab(e.key === 'ArrowRight' ? 1 : -1, true);
    });
    this.body.addEventListener('click', (e) => this.click(e.target as HTMLElement));
    this.body.addEventListener('focusin', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-comp]');
      if (t && t.dataset.comp !== this.sel) {
        this.sel = t.dataset.comp as ComponentId;
        this.select();
      }
      const p = (e.target as HTMLElement).closest<HTMLElement>('[data-project]');
      if (p && p.dataset.project !== this.selProject) {
        this.selProject = p.dataset.project;
        this.selectProject();
      }
    });
    for (const ev of ['research.done', 'research.upgraded'] as const)
      host.sim.bus.on(ev, () => {
        if (this.isOpen) this.refresh();
      });
    host.sim.bus.on('craft.done', (e) => {
      if (!this.isOpen) return;
      this.say(`Made ${e.made} ${itemDef(e.id as ItemId).name}`);
      this.refresh();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(tab: CraftTabId = 'craft') {
    this.el.hidden = false;
    this.el.classList.add('open');
    this.say('');
    this.show(tab, false);
    this.body.querySelector<HTMLElement>('[data-comp]')?.focus({ focusVisible: true } as FocusOptions);
  }

  close() {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.el.classList.remove('open');
  }

  /** The tabs shown now (Research once the station is there). */
  private tabsNow() {
    return CRAFT_TABS.filter((t) => t.id !== 'research' || this.host.sim.research.on);
  }

  tab(dir: number, focusTab = false) {
    const tabs = this.tabsNow();
    const i = Math.max(0, tabs.findIndex((t) => t.id === this.current));
    this.show(tabs[(i + dir + tabs.length) % tabs.length].id, focusTab);
  }

  show(tab: CraftTabId, focusTab = false) {
    if (!this.tabsNow().some((t) => t.id === tab)) tab = 'craft';
    this.current = tab;
    this.el.querySelector('#crTitle')!.textContent = this.host.sim.research.on ? 'Workshop' : 'Crafting table';
    for (const b of this.tabs.querySelectorAll<HTMLElement>('[data-tab]')) {
      b.hidden = !this.tabsNow().some((t) => t.id === b.dataset.tab);
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focusTab) b.focus({ focusVisible: true } as FocusOptions);
    }
    this.body.setAttribute('aria-labelledby', `crtab-${tab}`);
    this.body.innerHTML = this[tab]();
  }

  /** Redraws the open tab, keeping the focus on the same control. */
  refresh() {
    if (!this.isOpen) return;
    const id = (document.activeElement as HTMLElement | null)?.id;
    this.body.innerHTML = this[this.current]();
    if (id) this.body.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.focus({ focusVisible: true } as FocusOptions);
  }

  /** Runs the table while the panel holds the game paused, and moves the bar of the craft in hand. */
  update(dt: number, paused: boolean) {
    if (!this.isOpen) return;
    if (paused) this.host.sim.crafting.work(dt);
    const p = this.host.sim.crafting.progress();
    const bar = this.body.querySelector<HTMLElement>('.cr-bar > i');
    if (bar && p !== undefined) bar.style.width = `${Math.round(p * 100)}%`;
    const bench = this.host.sim.research.bench();
    this.body.querySelectorAll<HTMLElement>('.rs-bar > i').forEach((b, i) => {
      if (bench[i]) b.style.width = `${Math.round(bench[i].progress * 100)}%`;
    });
  }

  private say(text: string) {
    this.live.textContent = text;
  }

  // ───────── Craft ─────────

  private craft(): string {
    const sim = this.host.sim;
    const rows = componentRows(sim);
    if (!rows.length) return `<p class="bp-empty">Nothing to make yet.</p>`;
    if (!this.sel || !rows.some((r) => r.id === this.sel)) this.sel = rows[0].id;
    const grid = rows
      .map(
        (r) =>
          `<button class="bp-cell${r.problem ? ' cr-short' : ''}" role="option" id="crc-${r.id}" data-comp="${r.id}" aria-selected="${r.id === this.sel}" aria-label="${esc(r.label)}">` +
          `${materialIcon(r.id, 40)}<span class="bp-name">${esc(r.name)}</span><span class="bp-count">${r.have}</span></button>`,
      )
      .join('');
    const machines = machineRows(sim);
    const mlist = machines.length
      ? `<h3 class="set-h">Machines</h3><ul class="cr-machines">${machines
          .map((m) => `<li tabindex="0" class="${m.ready ? '' : 'cr-short'}" aria-label="${esc(`${m.name}: ${costText(m.parts)}`)}"><b>${esc(m.name)}</b> ${this.partsHtml(m.parts)}</li>`)
          .join('')}</ul>`
      : '';
    const decor = decorRows(sim);
    const dlist = decor.length
      ? `<h3 class="set-h">Decorations</h3><ul class="cr-machines cr-decor">${decor
          .map(
            (d) =>
              `<li class="${d.made ? 'cr-made' : d.problem ? 'cr-short' : ''}"><b>${esc(d.name)}</b> ${d.made ? '<span class="cr-note">Made</span>' : this.partsHtml(d.parts)}` +
              (d.made ? '' : `<button id="cr-decor-${d.id}" data-decor="${d.id}" aria-label="${esc(`Make the ${d.name}, once: ${costText(d.parts)}. Placing it is free after that.`)}" ${d.problem ? 'aria-disabled="true"' : ''}>Make</button>`) +
              `</li>`,
          )
          .join('')}</ul>`
      : '';
    return `<div class="bp-split"><div><h3 class="set-h">Components</h3><div class="bp-grid" role="listbox" aria-label="Components" aria-orientation="horizontal">${grid}</div>${mlist}${dlist}</div><div class="bp-detail" id="crDetail">${this.detail()}</div></div>`;
  }

  private partsHtml(parts: CostPart[]): string {
    return `<span class="cr-parts">${parts
      .map((p) => `<span class="cr-part${p.have >= p.need ? '' : ' cr-miss'}">${materialIcon(p.id, 20)} ${p.need} ${esc(p.name)}${p.have >= p.need ? '' : ` <small>(${p.have})</small>`}</span>`)
      .join('')}</span>`;
  }

  private detail(): string {
    const sim = this.host.sim;
    const r = componentRows(sim).find((x) => x.id === this.sel);
    if (!r) return '';
    const btn = (n: number) => `<button id="cr-make-${n}" data-make="${n}" aria-label="${esc(`Make ${r.name} ${n === 1 ? 'once' : `${n} times`}`)}" ${r.problem ? 'aria-disabled="true"' : ''}>Make ${n === 1 ? '1' : n}</button>`;
    const q = sim.crafting.queue();
    const queue = q.length
      ? `<h4>On the table</h4><ul class="cr-queue">${q
          .map(
            (j, i) =>
              `<li>${materialIcon(j.id as ComponentId, 24)} <span>${esc(itemDef(j.id as ItemId).name)} × ${j.n}</span>${i === 0 ? `<span class="cr-bar" aria-hidden="true"><i style="width:${Math.round((sim.crafting.progress() ?? 0) * 100)}%"></i></span>` : ''}<button id="cr-cancel-${i}" data-cancel="${i}" aria-label="${esc(`Stop making ${itemDef(j.id as ItemId).name}, and take back what it used`)}">Stop</button></li>`,
          )
          .join('')}</ul>`
      : '';
    return (
      `<h3>${materialIcon(r.id, 28)} ${esc(r.name)}</h3>` +
      `<dl><dt>Makes</dt><dd>${r.makes}</dd><dt>At hand</dt><dd>${r.have}</dd></dl>` +
      `<h4>Needs</h4>${this.partsHtml(r.parts)}` +
      `<div class="bp-moves" role="group" aria-label="Make">${btn(1)}${btn(5)}</div>` +
      (r.problem ? `<p class="bp-note">${esc(r.problem)}</p>` : '') +
      queue
    );
  }

  private select() {
    for (const b of this.body.querySelectorAll<HTMLElement>('[data-comp]')) b.setAttribute('aria-selected', String(b.dataset.comp === this.sel));
    const d = this.body.querySelector<HTMLElement>('#crDetail');
    if (d) d.innerHTML = this.detail();
  }

  // ───────── Upgrade ─────────

  private upgrade(): string {
    const rows = upgradeRows(this.host.sim);
    if (!rows.length) return `<p class="bp-empty">Nothing to upgrade yet.</p>`;
    return `<ul class="cr-upgrades">${rows
      .map((u) => {
        const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < u.level ? 'on' : ''}"></i>`).join('');
        const full = u.level >= u.max;
        return (
          `<li><div class="cr-uhead"><b>${esc(u.name)}</b><span class="cr-pips" aria-hidden="true">${pips}</span></div><span class="cr-each">${esc(u.each)}</span>` +
          (full ? '' : this.partsHtml(u.parts)) +
          `<button id="cr-up-${u.id}" data-upgrade="${u.id}" aria-label="${esc(full ? `${u.name}, all ${u.max} levels` : `Upgrade ${u.name} to level ${u.level + 1} of ${u.max}: ${costText(u.parts)}`)}" ${u.problem ? 'aria-disabled="true"' : ''}>${full ? 'Done' : `Level ${u.level + 1}`}</button></li>`
        );
      })
      .join('')}</ul>`;
  }

  // ───────── Research ─────────

  private research(): string {
    const r = this.host.sim.research;
    const finds = r.finds();
    const bench = r.bench();
    const open = r.open();
    if (!this.selProject || !open.some((p) => p.id === this.selProject)) this.selProject = open[0]?.id;
    const findList = finds.length
      ? `<h3 class="set-h">New finds</h3><div class="bp-moves rs-finds">${finds.map((f, i) => `<button id="rs-find-${i}" data-find="${esc(findKey(f))}" aria-label="${esc(`Look closely at ${r.findName(f)}`)}">${esc(r.findName(f))}</button>`).join('')}</div>`
      : '';
    const powered = r.powered();
    const benchList = bench.length
      ? `<h3 class="set-h">On the bench</h3><ul class="cr-queue">${bench
          .map(
            (b) =>
              `<li><span>${esc(b.project.name)}</span><span class="cr-bar rs-bar${powered ? '' : ' rs-off'}" aria-hidden="true"><i style="width:${Math.round(b.progress * 100)}%"></i></span><button id="rs-stop-${b.project.id}" data-stop="${b.project.id}" aria-label="${esc(`Stop ${b.project.name}, and take back what it used`)}">Stop</button></li>`,
          )
          .join('')}</ul>${powered ? '' : '<p class="bp-note">Waiting for power.</p>'}`
      : '';
    const groups = BRANCHES.map((br) => {
      const ps = open.filter((p) => p.branch === br.id);
      if (!ps.length) return '';
      return `<h4>${esc(br.name)}</h4><div class="rs-projects" role="listbox" aria-label="${esc(br.name)} projects">${ps
        .map((p) => `<button class="bp-req" role="option" id="rs-p-${p.id}" data-project="${p.id}" aria-selected="${p.id === this.selProject}"><b>${esc(p.name)}</b></button>`)
        .join('')}</div>`;
    }).join('');
    const empty = !finds.length && !bench.length && !open.length ? `<p class="bp-empty">Nothing to look into yet. New things turn up out in the city.</p>` : '';
    return `<div class="bp-split"><div>${findList}${benchList}${groups ? `<h3 class="set-h">Projects</h3>${groups}` : ''}${empty}</div><div class="bp-detail" id="rsDetail">${this.projectDetail()}</div></div>`;
  }

  private projectDetail(): string {
    const r = this.host.sim.research;
    const p = this.selProject ? r.project(this.selProject) : undefined;
    if (!p || !r.open().includes(p)) return '';
    const problem = r.problem(p.id);
    return (
      `<h3>${esc(p.name)}</h3><p>${esc(p.about)}</p>` +
      `<dl><dt>Takes</dt><dd>About ${projectMinutes(p.days)} minutes</dd></dl>` +
      `<h4>Needs</h4>${this.partsHtml(costParts(this.host.sim, p.cost))}` +
      `<div class="bp-moves"><button id="rs-start" data-start="${p.id}" aria-label="${esc(`Start ${p.name}`)}" ${problem ? 'aria-disabled="true"' : ''}>Start</button></div>` +
      (problem ? `<p class="bp-note">${esc(problem)}</p>` : '')
    );
  }

  private selectProject() {
    for (const b of this.body.querySelectorAll<HTMLElement>('[data-project]')) b.setAttribute('aria-selected', String(b.dataset.project === this.selProject));
    const d = this.body.querySelector<HTMLElement>('#rsDetail');
    if (d) d.innerHTML = this.projectDetail();
  }

  private click(t: HTMLElement) {
    const sim = this.host.sim;
    const mk = t.closest<HTMLElement>('[data-make]');
    if (mk && this.sel) {
      const name = itemDef(this.sel).name;
      if (mk.getAttribute('aria-disabled')) return this.say(sim.crafting.problem(this.sel) ?? '');
      const n = sim.crafting.craft(this.sel, Number(mk.dataset.make));
      this.say(n ? `Making ${name}` : (sim.crafting.problem(this.sel) ?? ''));
      this.host.changed?.();
      return this.refresh();
    }
    const dm = t.closest<HTMLElement>('[data-decor]');
    if (dm) {
      const id = dm.dataset.decor!;
      if (dm.getAttribute('aria-disabled')) return this.say(sim.crafting.decorProblem(id) ?? '');
      if (sim.crafting.makeDecor(id)) this.say(`Made the ${DECOR_OPTION[id]?.name ?? id}: it is in the build menu`);
      this.host.changed?.();
      return this.refresh();
    }
    const cn = t.closest<HTMLElement>('[data-cancel]');
    if (cn) {
      sim.crafting.cancel(Number(cn.dataset.cancel));
      this.say('Stopped, and took back what it used');
      this.host.changed?.();
      return this.refresh();
    }
    const r = sim.research;
    const up = t.closest<HTMLElement>('[data-upgrade]');
    if (up) {
      const id = up.dataset.upgrade!;
      const name = r.upgradeDef(id)?.name ?? '';
      if (up.getAttribute('aria-disabled')) return this.say(r.upgradeProblem(id) ?? '');
      const lvl = r.upgrade(id);
      this.say(lvl ? `${name}: level ${lvl}` : (r.upgradeProblem(id) ?? ''));
      this.host.changed?.();
      return this.refresh();
    }
    const fd = t.closest<HTMLElement>('[data-find]');
    if (fd) {
      const f = r.finds().find((x) => findKey(x) === fd.dataset.find) as Find | undefined;
      if (f && r.analyse(f)) this.say(`Looked closely at ${r.findName(f)}`);
      this.refresh();
      this.body.querySelector<HTMLElement>('[data-find], [data-project]')?.focus({ focusVisible: true } as FocusOptions);
      return;
    }
    const st = t.closest<HTMLElement>('[data-start]');
    if (st) {
      const id = st.dataset.start!;
      if (st.getAttribute('aria-disabled')) return this.say(r.problem(id) ?? '');
      if (r.start(id)) this.say(`Started ${r.project(id)!.name}`);
      this.host.changed?.();
      this.refresh();
      this.body.querySelector<HTMLElement>('[data-project], [data-stop]')?.focus({ focusVisible: true } as FocusOptions);
      return;
    }
    const sp = t.closest<HTMLElement>('[data-stop]');
    if (sp) {
      r.stop(sp.dataset.stop!);
      this.say('Stopped, and took back what it used');
      this.host.changed?.();
      return this.refresh();
    }
    const pj = t.closest<HTMLElement>('[data-project]');
    if (pj) {
      this.selProject = pj.dataset.project;
      this.selectProject();
      this.body.querySelector<HTMLElement>('#rsDetail [data-start]:not([aria-disabled])')?.focus({ focusVisible: true } as FocusOptions);
      return;
    }
    const cell = t.closest<HTMLElement>('[data-comp]');
    if (cell) {
      this.sel = cell.dataset.comp as ComponentId;
      this.select();
      // Enter or A on a component steps into its buttons
      this.body.querySelector<HTMLElement>('#crDetail [data-make]:not([aria-disabled])')?.focus({ focusVisible: true } as FocusOptions);
    }
  }
}
