import { ACTION, ACTIONS, type Action, type Bindings, type BindResult, GROUPS, keyLabel } from '../app/Bindings';
import { GLYPH_SETTINGS, type GlyphSetting, keyGlyph, padGlyph, padName, type PadStyle } from './Glyphs';

/**
 * E22.4 (#341): Settings › Controls. Two columns, keyboard and mouse, and gamepad, with every action listed in
 * groups (Move and look, Act, Build, Menus). Choose a cell, then press the new key, mouse button, wheel or pad
 * button. If another action has it, the row asks "Swap with Sprint?" (Swap, or Cancel). Esc and the pad's Menu
 * button can't be moved or unbound. Each column has its own "Reset to defaults". It works with the keyboard alone
 * (Tab, arrows, Enter; Esc cancels a wait; Backspace clears a keyboard cell) and the pad alone (the d-pad's focus
 * ring and A; Menu cancels a wait).
 */
export type Kind = 'key' | 'pad';

export interface ControlsHost {
  bindings: Bindings;
  /** the pad family the gamepad column draws (the one in use, or the setting) */
  padStyle(): PadStyle;
  glyphSetting(): GlyphSetting;
  /** waits for the next input of a kind; `undefined` means cancelled; 'clear' means unbind (Backspace) */
  listen(kind: Kind, done: (input: string | number | 'clear' | undefined) => void): void;
  /** the bindings changed: save them and redraw what shows them */
  changed(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** What the rebinding screen says about a refused or clashing bind. */
export function bindMessage(r: BindResult, action: Action): string {
  if (r.ok) return r.swapped ? `${ACTION[action].label} and ${ACTION[r.swapped].label} swapped` : `${ACTION[action].label} changed`;
  if (r.reason === 'locked') return r.other ? `That is kept for ${ACTION[r.other].label}, which can't be changed` : `${ACTION[action].label} can't be changed`;
  if (r.reason === 'clash') return `Swap with ${ACTION[r.other!].label}?`;
  return 'That input can’t do this';
}

export class ControlsTable {
  private pending?: { action: Action; kind: Kind; input: string | number; other: Action };
  private note = '';

  constructor(
    private body: HTMLElement,
    private host: ControlsHost,
  ) {}

  render(focusId?: string) {
    const b = this.host.bindings;
    const style = this.host.padStyle();
    const list = ACTIONS;
    const cell = (a: (typeof ACTIONS)[number], kind: Kind) => {
      const can = kind === 'key' ? a.keys : a.pad;
      const locked = b.locked(a.id, kind);
      const id = `ctl-${a.id}-${kind}`;
      if (!can) return `<span class="ctl-none" aria-hidden="true">${kind === 'pad' ? 'Stick' : '—'}</span>`;
      const inputs = kind === 'key' ? b.keys[a.id] : b.pad[a.id] === undefined ? [] : [b.pad[a.id]!];
      const glyphs = inputs.map((x) => (kind === 'key' ? keyGlyph(x as string) : padGlyph(style, x as number))).join('');
      const names = inputs.map((x) => (kind === 'key' ? keyLabel(x as string) : padName(style, x as number))).join(' or ') || 'not set';
      const label = `${a.label}, ${kind === 'key' ? 'keyboard and mouse' : 'gamepad'}: ${names}${locked ? ', fixed' : ''}`;
      return `<button class="ctl-key" id="${id}" data-act="${a.id}" data-kind="${kind}" ${locked ? 'aria-disabled="true" data-locked="1"' : ''} aria-label="${esc(label)}">${glyphs || '<span class="ctl-unset">Not set</span>'}</button>`;
    };
    const p = this.pending;
    const ask = p
      ? `<div class="ctl-ask" role="alertdialog" aria-labelledby="ctlAskText"><span id="ctlAskText">${esc(`Swap with ${ACTION[p.other].label}?`)}</span><button id="ctlSwap">Swap</button><button id="ctlCancel">Cancel</button></div>`
      : '';
    const gs = this.host.glyphSetting();
    this.body.innerHTML =
      `<label class="set-row" for="set-glyphs"><span>Button pictures</span><select id="set-glyphs" data-key="glyphs">${GLYPH_SETTINGS.map(([v, l]) => `<option value="${v}" ${v === gs ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` +
      `<p class="ctl-help">Choose a key or button, then press the new one. Esc (or Menu on the pad) cancels; Backspace clears a key.</p>` +
      `<p class="ctl-note" role="status" aria-live="polite">${esc(this.note)}</p>${ask}` +
      `<div class="ctl-table" role="table" aria-label="Controls"><div class="ctl-row ctl-headrow" role="row"><span role="columnheader">Action</span><span role="columnheader">Keyboard and mouse</span><span role="columnheader">Gamepad</span></div>` +
      GROUPS.map((g) => {
        const rows = list.filter((a) => a.group === g.id);
        return `<h3 class="set-h" role="row"><span role="rowheader">${g.label}</span></h3>${rows.map((a) => `<div class="ctl-row" role="row"><span role="rowheader">${esc(a.label)}</span><span role="cell">${cell(a, 'key')}</span><span role="cell">${cell(a, 'pad')}</span></div>`).join('')}`;
      }).join('') +
      `</div><div class="ctl-resets"><button id="ctlResetKeys">Reset keyboard and mouse to defaults</button><button id="ctlResetPad">Reset gamepad to defaults</button></div>`;
    this.body.querySelectorAll<HTMLButtonElement>('.ctl-key').forEach((btn) => btn.addEventListener('click', () => this.choose(btn)));
    this.body.querySelector('#ctlResetKeys')!.addEventListener('click', () => this.reset('keys'));
    this.body.querySelector('#ctlResetPad')!.addEventListener('click', () => this.reset('pad'));
    this.body.querySelector('#ctlSwap')?.addEventListener('click', () => this.answer(true));
    this.body.querySelector('#ctlCancel')?.addEventListener('click', () => this.answer(false));
    const f = focusId ? this.body.querySelector<HTMLElement>(`#${focusId}`) : p ? this.body.querySelector<HTMLElement>('#ctlSwap') : undefined;
    f?.focus({ focusVisible: true } as FocusOptions);
  }

  private choose(btn: HTMLButtonElement) {
    const action = btn.dataset.act as Action;
    const kind = btn.dataset.kind as Kind;
    if (btn.dataset.locked) {
      this.note = bindMessage({ ok: false, reason: 'locked' }, action);
      return this.render(btn.id);
    }
    btn.classList.add('listening');
    btn.innerHTML = `<span class="ctl-wait">${kind === 'key' ? 'Press a key or mouse button' : 'Press a button'}</span>`;
    this.host.listen(kind, (input) => {
      if (input === undefined) {
        this.note = '';
        return this.render(btn.id);
      }
      const b = this.host.bindings;
      const r = input === 'clear' ? b.unbind(action, kind) : kind === 'key' ? b.bindKey(action, input as string) : b.bindButton(action, input as number);
      if (!r.ok && r.reason === 'clash') {
        this.pending = { action, kind, input: input as string | number, other: r.other! };
        this.note = '';
        return this.render();
      }
      this.note = input === 'clear' && r.ok ? `${ACTION[action].label} cleared` : bindMessage(r, action);
      if (r.ok) this.host.changed();
      this.render(btn.id);
    });
  }

  /** The answer to "Swap with …?". */
  private answer(swap: boolean) {
    const p = this.pending;
    this.pending = undefined;
    if (!p) return;
    const id = `ctl-${p.action}-${p.kind}`;
    if (!swap) {
      this.note = 'Nothing changed';
      return this.render(id);
    }
    const b = this.host.bindings;
    const r = p.kind === 'key' ? b.bindKey(p.action, p.input as string, true) : b.bindButton(p.action, p.input as number, true);
    this.note = bindMessage(r, p.action);
    if (r.ok) this.host.changed();
    this.render(id);
  }

  private reset(column: 'keys' | 'pad') {
    this.host.bindings.reset(column);
    this.pending = undefined;
    this.note = column === 'keys' ? 'Keyboard and mouse are back to the defaults' : 'The gamepad is back to the defaults';
    this.host.changed();
    this.render(column === 'keys' ? 'ctlResetKeys' : 'ctlResetPad');
  }
}
