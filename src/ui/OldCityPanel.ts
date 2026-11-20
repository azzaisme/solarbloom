import type { MaterialId } from '../core/types';
import { MATERIALS, MATERIAL_IDS, tierGives } from '../data/salvage';
import { giftLabel } from '../gameplay/KeeperSystem';
import type { Sim } from '../gameplay/Sim';
import { iconize } from './Icons';
import './oldcity.css';

export const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * E21: one plain panel the Old City's places open (the store, the fountain's deliveries, a Keeper, a landmark,
 * the region map). It is deliberately plain: E22 restyles it. Every control is a button, so the gamepad's d-pad
 * moves between them (PadFocus lists `#ocPanel.open`), A presses one, and Cancel closes it.
 */
export class OldCityPanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private render?: () => string;
  private act?: (act: string, arg: string) => void;
  /** called whenever the panel closes */
  onClose?: () => void;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'ocPanel';
    this.el.className = 'panel';
    this.el.setAttribute('role', 'dialog');
    this.el.innerHTML = `<button class="oc-x" data-act="close" aria-label="Close">×</button><div class="oc-body"></div>`;
    this.body = this.el.querySelector('.oc-body')!;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b || (b as HTMLButtonElement).disabled) return;
      const act = b.dataset.act!;
      if (act === 'close') return this.close();
      this.act?.(act, b.dataset.arg ?? '');
      this.refresh();
    });
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  open(render: () => string, act: (act: string, arg: string) => void) {
    this.render = render;
    this.act = act;
    this.el.classList.add('open');
    this.refresh();
    // the pad starts on the first control
    this.el.querySelector<HTMLElement>('.oc-body button:not([disabled])')?.focus({ focusVisible: false } as FocusOptions);
  }

  /** Redraws the panel, keeping the focused control (by its action) where it was. */
  refresh() {
    if (!this.render || !this.isOpen) return;
    const f = document.activeElement as HTMLElement | null;
    const key = f && this.el.contains(f) ? `${f.dataset.act}|${f.dataset.arg}` : undefined;
    this.body.innerHTML = iconize(this.render());
    if (key) {
      const [a, g] = key.split('|');
      const same = [...this.body.querySelectorAll<HTMLElement>('[data-act]')].find((e) => e.dataset.act === a && (e.dataset.arg ?? '') === (g === 'undefined' ? '' : g));
      same?.focus();
    }
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.remove('open');
    this.render = undefined;
    this.act = undefined;
    this.onClose?.();
  }
}

/** E21.2: a short "+3 Copper" that rises from a spot on screen and fades. */
export function flyUp(root: HTMLElement, text: string, x: number, y: number) {
  const el = document.createElement('div');
  el.className = 'oc-fly';
  el.innerHTML = iconize(escHtml(text));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  root.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// ───────────── the storage panel (E21.1) ─────────────

/** HTML of the storage panel: one row per material with backpack and store counts, move 1 / 10 / a stack. */
export function storageHtml(sim: Sim, title = 'Storage'): string {
  const inv = sim.inventory;
  const limit = inv.stackLimit();
  const rows = MATERIAL_IDS.filter((m) => inv.count(m) || inv.stored(m) || seen(sim, m))
    .map((m) => {
      const p = inv.count(m);
      const st = inv.stored(m);
      const room = inv.room(m);
      const btn = (act: string, n: number | 'stack', label: string, ok: boolean) => `<button data-act="${act}" data-arg="${m}:${n}" ${ok ? '' : 'disabled'}>${label}</button>`;
      return `<tr><th>${MATERIALS[m].icon} ${MATERIALS[m].name}</th><td class="n">${p}/${limit}</td>
        <td class="mv">${btn('put', 1, '1 →', p >= 1)}${btn('put', 10, '10 →', p >= 1)}${btn('put', 'stack', 'All →', p >= 1)}</td>
        <td class="mv">${btn('takeOut', 1, '← 1', st >= 1 && room >= 1)}${btn('takeOut', 10, '← 10', st >= 1 && room >= 1)}${btn('takeOut', 'stack', '← Stack', st >= 1 && room >= 1)}</td>
        <td class="n">${st}</td></tr>`;
    })
    .join('');
  return `<h2>📦 ${escHtml(title)}</h2>
    <table class="oc-store"><thead><tr><th></th><th>Backpack</th><th></th><th></th><th>Store</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="oc-empty">Nothing found yet. Salvage piles to fill your backpack.</td></tr>'}</tbody></table>
    <div class="oc-row"><button data-act="depositAll" ${MATERIAL_IDS.some((m) => inv.count(m)) ? '' : 'disabled'}>Deposit all</button></div>`;
}

/** Runs a storage panel button. */
export function storageAct(sim: Sim, act: string, arg: string) {
  const inv = sim.inventory;
  if (act === 'depositAll') return void inv.depositAll();
  const [m, nRaw] = arg.split(':') as [MaterialId, string];
  if (!MATERIALS[m]) return;
  const n = nRaw === 'stack' ? undefined : Number(nRaw);
  if (act === 'put') inv.deposit(m, n);
  else if (act === 'takeOut') inv.withdraw(m, n);
}

/** A material shows in the panel once it has been held (or its region seen); empty rows would only be noise. */
function seen(sim: Sim, m: MaterialId): boolean {
  return m === 'scrap' || m === 'seeds' || !!sim.state.salvage?.seen?.includes(`mat:${m}`);
}

// ───────────── the fountain's delivery panel (E21.6) ─────────────

/** HTML of the fountain panel: the next tier's name, each material given / needed, what it unlocks. */
export function fountainHtml(sim: Sim): string {
  const f = sim.fountain;
  const t = f.next();
  if (!t) return `<h2>⛲ The fountain</h2><p>The fountain is in full bloom.</p><div class="oc-row"><button data-act="storage">Storage</button></div>`;
  const rows = (Object.entries(t.delivery) as [MaterialId | 'biomass', number][])
    .filter(([k]) => k !== 'biomass')
    .map(([k, need]) => {
      const m = k as MaterialId;
      const got = f.given(m);
      const have = sim.inventory.available(m);
      const left = f.remaining(m);
      return `<div class="oc-need ${left ? '' : 'done'}"><span>${MATERIALS[m].icon} ${MATERIALS[m].name}</span><span>${got}/${need}${left ? ` · you have ${have}` : ' ✅'}</span></div>`;
    })
    .join('');
  const c = f.condition(t);
  const canGive = (Object.keys(t.delivery) as MaterialId[]).some((m) => f.remaining(m) > 0 && sim.inventory.available(m) > 0);
  return `<h2>⛲ Tier ${t.tier}: ${escHtml(t.name)}</h2>
    <h3>Bring</h3>${rows}
    <div class="oc-need ${c.done ? 'done' : ''}"><span>${escHtml(c.label)}</span><span>${Math.min(c.have, c.need)}/${c.need}${c.done ? ' ✅' : ''}</span></div>
    <h3>It brings</h3><p class="oc-soft">${tierGives(t).map(escHtml).join(' · ')}</p>
    <div class="oc-row"><button data-act="giveAll" ${canGive ? '' : 'disabled'}>Give all I have</button><button data-act="storage">Storage</button></div>`;
}

// ───────────── Keeper speech bubbles (E21.8) ─────────────

/** A speech bubble that follows a point in the world for a few seconds (one to three lines, no voice, no choices). */
export class SpeechBubble {
  readonly el: HTMLElement;
  private until = 0;
  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'oc-bubble';
    this.el.hidden = true;
    root.appendChild(this.el);
  }
  say(name: string, lines: string[], secs = 3 + lines.length * 1.6) {
    this.el.innerHTML = iconize(`<b>${escHtml(name)}</b>${lines.map((l) => `<p>${escHtml(l)}</p>`).join('')}`);
    this.el.hidden = false;
    this.until = performance.now() + secs * 1000;
  }
  /** Per frame: follow the speaker on screen (undefined: off screen or gone). */
  place(at: { x: number; y: number } | undefined) {
    if (this.el.hidden) return;
    if (!at || performance.now() > this.until) {
      this.el.hidden = true;
      return;
    }
    this.el.style.left = `${at.x}px`;
    this.el.style.top = `${at.y}px`;
  }
}

// ───────────── Tally's trade (E21.9) ─────────────

/** HTML of Tally's trade panel: 3 of one material for 1 of another. */
export function tradeHtml(sim: Sim, give: MaterialId | undefined): string {
  const can = sim.landmarks.tradable();
  const gives = MATERIAL_IDS.map((m) => `<button data-act="give" data-arg="${m}" ${can.includes(m) ? '' : 'disabled'} class="${give === m ? 'on' : ''}">${MATERIALS[m].icon} ${MATERIALS[m].name}${give === m ? ' ✓' : ''}</button>`).join('');
  const gets = sim.landmarks.tradeTargets().filter((m) => m !== give).map((m) => `<button data-act="get" data-arg="${m}" ${give ? '' : 'disabled'}>${MATERIALS[m].icon} ${MATERIALS[m].name}</button>`).join('');
  // E23.9.2: when bloombot carries something Tally loves, it can be given as a gift (a choice, never a surprise)
  const gift = sim.keepers.giftFor('tally');
  const label = giftLabel(gift ?? '');
  const giftRow = gift
    ? `<h3>A gift</h3><div class="oc-row"><button data-act="gift" data-arg="${gift}">${label.icon ? `${label.icon} ` : ''}Give Tally 1 ${label.name}</button></div>`
    : '';
  return `<h2>🤖 Tally's trade</h2><p class="oc-soft">Any 3 of one material for 1 of another.</p>
    ${giftRow}<h3>Give 3</h3><div class="oc-row">${gives}</div>
    <h3>Get 1</h3><div class="oc-row">${gets}</div>`;
}
