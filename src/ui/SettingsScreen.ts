import type { Settings } from './Hud';
import type { Bindings } from '../app/Bindings';
import { type BarItem, glyph, icon, setBar, tabEnd, wireBar } from './PanelShell';

/**
 * E22.11 (#349): Settings as one screen with tabs (Game, Controls, Display, Sound, Accessibility), the same from
 * the title screen and from the in-game menu. It knows nothing of the running game: the host applies and saves
 * each change (`set`), and supplies the bindings and a way to wait for the next key or button (Controls).
 *
 * Every control is a real button, checkbox, slider or list, reachable with the keyboard (Tab, arrows) and the
 * pad (the d-pad's focus ring, A to press, LB / RB or Q / E for tabs, B to go back), with a visible focus ring
 * and a label a screen reader reads.
 *
 * E23.11 (Sunlit Glass): a centre sheet: the gear badge and title, the tabs with the bumper pictures at their ends,
 * the body, and the action bar ("Enter Change  Q E Change tab  Esc Back", or the pad's buttons). Settings ›
 * Controls shows a banner above the bar while it waits for a new key (`#ctlListen`).
 */
export type SettingsTab = 'game' | 'controls' | 'display' | 'sound' | 'access';
export const SETTINGS_TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: 'game', label: 'Game' },
  { id: 'controls', label: 'Controls' },
  { id: 'display', label: 'Display' },
  { id: 'sound', label: 'Sound' },
  { id: 'access', label: 'Accessibility' },
];

export type SettingKey = keyof Settings;

/** One row on a tab. `defaultOn` checkboxes treat a missing value as on. */
export type Row =
  | { kind: 'check'; key: SettingKey; label: string; defaultOn?: boolean; hint?: string }
  | { kind: 'range'; key: SettingKey; label: string; min: number; max: number; step: number; fallback: number; unit?: string }
  | { kind: 'select'; key: SettingKey; label: string; options: [string, string][]; fallback: string; numeric?: boolean }
  | { kind: 'button'; id: string; label: string; danger?: boolean }
  | { kind: 'html'; html: string }
  | { kind: 'heading'; label: string };

export interface SettingsHost {
  settings: Settings;
  /** applies and saves one setting */
  set(key: SettingKey, value: boolean | number | string): void;
  /** the rows of a tab (the host decides what applies: the game adds its stats, the title doesn't) */
  rows(tab: SettingsTab): Row[];
  /** a `button` row was pressed */
  button?(id: string): void;
  /** Controls: draws the rebinding table into the tab's body (E22.4) */
  controls?(body: HTMLElement): void;
  /** the screen closed (Back, Esc or B) */
  onClose?(): void;
  bindings?: Bindings;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class SettingsScreen {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private tabs: HTMLElement;
  private foot: HTMLElement;
  current: SettingsTab = 'game';

  constructor(
    parent: HTMLElement,
    private host: SettingsHost,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'settings';
    this.el.className = 'screen';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'settingsTitle');
    this.el.innerHTML =
      `<div class="panel sheet screen-card"><header class="sheet-head"><span class="pn-badge">${icon('gear')}</span><h2 id="settingsTitle">Settings</h2><span class="grow"></span><button class="pn-btn ghost sheet-back" data-back aria-label="Back">${glyph('back')}Back</button></header>` +
      `<div class="sheet-tabs">${tabEnd(-1)}<div role="tablist" aria-label="Settings sections">${SETTINGS_TABS.map((t) => `<button role="tab" id="stab-${t.id}" data-tab="${t.id}" aria-controls="settingsBody" aria-selected="false" tabindex="-1">${t.label}</button>`).join('')}</div>${tabEnd(1)}</div>` +
      `<div class="sheet-body" id="settingsBody" role="tabpanel"></div>` +
      `<div class="ctl-listen" id="ctlListen" role="status" aria-live="assertive" hidden></div>` +
      `<footer class="sheet-foot"><span class="pn-foot-live"></span><span class="pn-acts"></span></footer></div>`;
    parent.appendChild(this.el);
    this.body = this.el.querySelector<HTMLElement>('#settingsBody')!;
    this.tabs = this.el.querySelector<HTMLElement>('[role=tablist]')!;
    this.foot = this.el.querySelector<HTMLElement>('.sheet-foot')!;
    this.el.querySelector('[data-back]')!.addEventListener('click', () => this.close());
    wireBar(this.el, (p) => {
      if (p === 'prev' || p === 'next' || p === 'tabs') {
        this.tab(p === 'prev' ? -1 : 1, true);
        return true;
      }
      if (p === 'back' && this.el.querySelector('#ctlListen')?.hasAttribute('hidden')) {
        this.close();
        return true;
      }
    });
    this.tabs.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (t) this.show(t.dataset.tab as SettingsTab, true);
    });
    // Arrow keys move between tabs while a tab has focus (the WAI-ARIA tabs pattern).
    this.tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      this.tab(e.key === 'ArrowRight' ? 1 : -1, true);
    });
    this.body.addEventListener('change', (e) => this.changed(e.target as HTMLElement));
    this.body.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.type === 'range') this.changed(t);
    });
    this.body.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-btn]');
      if (b && !b.disabled) this.host.button?.(b.dataset.btn!);
    });
    this.el.hidden = true;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(tab: SettingsTab = this.current) {
    this.el.hidden = false;
    this.el.classList.add('open');
    this.show(tab, true);
  }

  close() {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.el.classList.remove('open');
    this.host.onClose?.();
  }

  /** LB / RB, Q / E: the previous or next tab. */
  tab(dir: number, focusTab = false) {
    const i = SETTINGS_TABS.findIndex((t) => t.id === this.current);
    const n = SETTINGS_TABS.length;
    this.show(SETTINGS_TABS[(i + dir + n) % n].id, focusTab);
  }

  /** Draws a tab (again: after a setting changed what a tab holds). */
  show(tab: SettingsTab, focusTab = false) {
    this.current = tab;
    for (const b of this.tabs.querySelectorAll<HTMLElement>('[data-tab]')) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focusTab) b.focus({ focusVisible: true } as FocusOptions);
    }
    this.body.setAttribute('aria-labelledby', `stab-${tab}`);
    const listen = this.el.querySelector<HTMLElement>('#ctlListen');
    if (listen) listen.hidden = true;
    this.body.scrollTop = 0;
    this.bar();
    if (tab === 'controls' && this.host.controls) {
      this.body.innerHTML = '';
      this.host.controls(this.body);
      return;
    }
    this.body.innerHTML = this.host.rows(tab).map((r) => this.row(r)).join('');
  }

  /** The action bar: Enter / A changes the setting in focus, the tab buttons, Back. */
  private bar() {
    const items: BarItem[] = [
      { press: 'choose', label: 'Change' },
      { press: 'tabs', label: 'Change tab' },
      { press: 'back', label: 'Back' },
    ];
    setBar(this.foot, items);
  }

  /** Redraws the open tab, keeping the focus on the same control where it can. */
  refresh() {
    if (!this.isOpen) return;
    const id = (document.activeElement as HTMLElement | null)?.id;
    this.show(this.current);
    if (id) document.getElementById(id)?.focus();
  }

  private row(r: Row): string {
    const s = this.host.settings as unknown as Record<string, unknown>;
    switch (r.kind) {
      case 'heading':
        return `<h3 class="set-h">${esc(r.label)}</h3>`;
      case 'html':
        return r.html;
      case 'button':
        return `<div class="set-row set-actions"><button id="set-btn-${r.id}" data-btn="${r.id}" class="pn-btn${r.danger ? ' danger' : ''}">${esc(r.label)}</button></div>`;
      case 'check': {
        const on = r.defaultOn ? s[r.key] !== false : !!s[r.key];
        return `<label class="set-row" for="set-${r.key}"><span>${esc(r.label)}${r.hint ? `<small>${esc(r.hint)}</small>` : ''}</span><input type="checkbox" id="set-${r.key}" data-key="${r.key}" ${on ? 'checked' : ''}></label>`;
      }
      case 'range': {
        const v = Number(s[r.key] ?? r.fallback);
        return `<label class="set-row" for="set-${r.key}"><span>${esc(r.label)}</span><span class="set-range"><input type="range" id="set-${r.key}" data-key="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" aria-valuetext="${v}${r.unit ?? ''}"><output for="set-${r.key}" aria-hidden="true">${v}${r.unit === ' percent' ? '%' : ''}</output></span></label>`;
      }
      case 'select': {
        const v = String(s[r.key] ?? r.fallback);
        return `<label class="set-row" for="set-${r.key}"><span>${esc(r.label)}</span><select id="set-${r.key}" data-key="${r.key}" ${r.numeric ? 'data-num="1"' : ''}>${r.options.map(([val, l]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
      }
    }
  }

  private changed(t: HTMLElement) {
    const key = t.dataset.key as SettingKey | undefined;
    if (!key) return;
    if (t instanceof HTMLInputElement && t.type === 'checkbox') this.host.set(key, t.checked);
    else if (t instanceof HTMLInputElement && t.type === 'range') {
      this.host.set(key, Number(t.value));
      t.setAttribute('aria-valuetext', t.value);
      const out = t.parentElement?.querySelector('output');
      if (out) out.textContent = `${t.value}${out.textContent?.endsWith('%') ? '%' : ''}`;
    } else if (t instanceof HTMLSelectElement) this.host.set(key, t.dataset.num ? Number(t.value) : t.value);
  }
}
