import { type Action, Bindings, FIXED_KEY } from '../app/Bindings';
import { keyGlyph, padGlyph, actionGlyph, type GlyphStyle } from './Glyphs';

/**
 * E23.11 (Sunlit Glass): the one panel shell. Centre sheets (backpack, crafting table, settings, storage) pause
 * the game; machine cards dock on the right and keep the world in view. Every panel ends in an action bar that
 * names its buttons with the pictures of the device in hand ("A Choose  B Back" on a pad, "Enter Choose  Esc
 * Back" on the keyboard), and its tab row shows the previous / next tab buttons at its ends.
 *
 * Glyph holders are `<span class="pn-g" data-glyph="back">` (see `Press`); `fillGlyphs(root)` draws them for the
 * device in use and keeps them current: the HUD calls `setPanelGlyphs` whenever the device or the bindings change
 * (Hud.setKeyMap), and every registered root is redrawn in the same frame.
 *
 * A bar item (`.pn-act[data-press]`) is clickable: it does what its button does (Back sends Esc, the tab ends
 * change tab, Choose presses the control in focus). Bars are not in the focus order: the keys and buttons they
 * name already do the job, and the pad's focus ring stays on the panel's own controls.
 */
export type Press = 'choose' | 'back' | 'prev' | 'next' | 'tabs' | 'clear' | Action;

const state: { style: GlyphStyle; bindings?: Bindings } = { style: 'keys' };
const roots = new Set<HTMLElement>();

/** Which glyph set panels draw, and the bindings they read. Redraws every registered panel. */
export function setPanelGlyphs(style: GlyphStyle | undefined, b?: Bindings) {
  state.style = style ?? 'keys';
  if (b) state.bindings = b;
  for (const r of roots) fill(r);
}

/** The glyph set panels draw now. */
export const panelStyle = (): GlyphStyle => state.style;
const binds = () => (state.bindings ??= new Bindings());

/** One button's picture for the device in use (a pair for `tabs`). */
export function glyphHtml(p: Press): string {
  const st = state.style;
  const b = binds();
  const pad = st !== 'keys' ? st : undefined;
  switch (p) {
    case 'choose':
      return pad ? padGlyph(pad, 0) : keyGlyph('Enter');
    case 'back':
      return pad ? padGlyph(pad, b.pad.cancel ?? 1) : keyGlyph(FIXED_KEY);
    case 'prev':
      return actionGlyph(b, 'prevTab', st);
    case 'next':
      return actionGlyph(b, 'nextTab', st);
    case 'tabs':
      return glyphHtml('prev') + glyphHtml('next');
    case 'clear':
      return pad ? '' : keyGlyph('Backspace');
    default:
      return actionGlyph(b, p, st);
  }
}

function fill(root: HTMLElement) {
  for (const e of root.querySelectorAll<HTMLElement>('[data-glyph]')) {
    const html = glyphHtml(e.dataset.glyph as Press);
    if (e.innerHTML !== html) e.innerHTML = html;
    // a press with no button on this device (Backspace on a pad) leaves its bar item out
    const item = e.closest<HTMLElement>('.pn-act');
    item?.classList.toggle('pn-none', !html);
  }
}

/** Draws the glyphs inside a panel and keeps them following the device. Call again after redrawing its markup. */
export function fillGlyphs(root: HTMLElement) {
  roots.add(root);
  fill(root);
}

/** A glyph holder (filled by `fillGlyphs`). */
export const glyph = (p: Press) => `<span class="pn-g" data-glyph="${p}" aria-hidden="true"></span>`;

export interface BarItem {
  press: Press;
  label: string;
  /** shown faded: the button does nothing here right now */
  dim?: boolean;
}

/** An action bar's items: glyph and verb, each clickable. */
export function barHtml(items: BarItem[]): string {
  return items.map((i) => `<span class="pn-act${i.dim ? ' dim' : ''}" data-press="${i.press}">${glyph(i.press)}<span class="pn-verb">${i.label}</span></span>`).join('');
}

/** The previous / next tab glyphs at either end of a tab row (clickable, like the bumpers they show). */
export const tabEnd = (dir: -1 | 1) => `<span class="pn-tab-end pn-act" data-press="${dir < 0 ? 'prev' : 'next'}">${glyph(dir < 0 ? 'prev' : 'next')}</span>`;

/** Sends a key to the game, as if pressed (the game's own handling: Esc closes and unpauses, Q / E change tab). */
export function sendKey(code: string) {
  const key = code === FIXED_KEY ? 'Escape' : code === 'Enter' ? 'Enter' : code === 'Backspace' ? 'Backspace' : code.replace(/^Key/, '').toLowerCase();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }));
  document.body.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true, cancelable: true }));
}

/**
 * Wires a panel's bar items and tab ends (any `[data-press]` inside it) to their buttons. `on` handles a press
 * itself (return true); otherwise Back sends Esc, the tab ends and "Change tab" send the tab keys, and Choose
 * presses the control in focus.
 */
export function wireBar(root: HTMLElement, on?: (p: Press) => boolean | void) {
  // a press on a bar item leaves the focus where it was (Choose presses that control)
  root.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('[data-press]')) e.preventDefault();
  });
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-press]');
    if (!t || !root.contains(t)) return;
    const p = t.dataset.press as Press;
    if (on?.(p)) return;
    const b = binds();
    if (p === 'back') sendKey(FIXED_KEY);
    else if (p === 'prev' || p === 'next') sendKey(b.keys[p === 'prev' ? 'prevTab' : 'nextTab'][0] ?? (p === 'prev' ? 'KeyQ' : 'KeyE'));
    else if (p === 'tabs') sendKey(b.keys.nextTab[0] ?? 'KeyE');
    else if (p === 'clear') sendKey('Backspace');
    else if (p === 'choose') {
      const f = document.activeElement as HTMLElement | null;
      if (f && root.contains(f) && f !== document.body) f.click();
    } else {
      const k = b.keys[p]?.[0];
      if (k) sendKey(k);
    }
  });
  fillGlyphs(root);
}

/**
 * Makes a dialog's panel a shell: a sheet (centre, pauses) or a side card (docked right). Adds the action bar
 * footer if it has none. Returns the footer.
 */
export function shellFooter(panel: HTMLElement, items: BarItem[], live?: HTMLElement): HTMLElement {
  let foot = panel.querySelector<HTMLElement>(':scope > .sheet-foot');
  if (!foot) {
    foot = document.createElement('footer');
    foot.className = 'sheet-foot';
    panel.appendChild(foot);
  }
  foot.innerHTML = `<span class="pn-foot-live"></span><span class="pn-acts">${barHtml(items)}</span>`;
  if (live) foot.querySelector('.pn-foot-live')!.replaceWith(live);
  fillGlyphs(panel);
  return foot;
}

/** Redraws a footer's items (a panel whose buttons change with what is in focus or which tab is open). */
export function setBar(foot: HTMLElement | null | undefined, items: BarItem[]) {
  const acts = foot?.querySelector<HTMLElement>('.pn-acts');
  if (!acts) return;
  const html = barHtml(items);
  if (acts.dataset.items === html) return;
  acts.dataset.items = html;
  acts.innerHTML = html;
  fill(acts);
}

/** Stroke icons (the design's set), coloured by the text colour. Decorative: a name is always beside them. */
export const icon = (name: string, cls = '') => `<span class="pn-ic i-${name}${cls ? ` ${cls}` : ''}" aria-hidden="true"></span>`;
