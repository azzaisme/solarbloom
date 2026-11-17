import type { MaterialId } from '../core/types';
import { MATERIALS, MATERIAL_IDS } from '../data/salvage';
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
