import { type Action, type Bindings, SLOTS } from '../app/Bindings';
import { actionGlyph, type GlyphStyle } from './Glyphs';
import { ICONS } from './Icons';
import { $, esc, HudPart } from './HudPart';
import type { Tool } from './Hud';
import { buildItem, HOTBAR_DEFAULT } from './BuildCatalog';
import { BuildMenu } from './BuildMenu';

/**
 * The tool in bloombot's hands and the build menu's door. E23.11 retired the classic hotbar (the Pulse dome, Inspect,
 * Harvest, the Build toggle and its tray): walking has no hotbar, build mode has the build dock (BuildBar), and the
 * build menu (BuildMenu, #344) is a sheet of its own. What the game still asks of "the hotbar" (the current tool,
 * setTool, the menu open or shut) lives here.
 */
export class Hotbar extends HudPart {
  private tool: Tool = 'pulse';
  readonly menu = new BuildMenu(this.hud);

  wire() {
    this.menu.wire();
    this.hud.buildBar.wire();
  }

  get currentTool() {
    return this.tool;
  }

  setTool(t: Tool) {
    this.tool = t;
    this.menu.close();
    this.hud.buildBar.render(t);
  }

  /** The build menu (Q, or Y on the pad), open or shut. */
  toggleTray(open?: boolean) {
    const o = open ?? !this.menu.isOpen;
    if (o) this.menu.open(this.tool);
    else this.menu.close();
  }

  get trayOpen() {
    return this.menu.isOpen;
  }

  /** E22.3: the menu's and the dock's glyphs follow the device in use and the bindings. */
  setKeyMap(style: GlyphStyle | undefined, b?: Bindings) {
    this.menu.setKeys(style, b);
  }

  update() {
    this.hud.buildBar.update();
  }
}

export { HOTBAR_DEFAULT };

/** The view shown in build mode: none, the Power view or the Water view (one at a time). */
export type BuildView = 'off' | 'power' | 'water';

/**
 * E23.11: the build dock, a paper pill at the bottom centre while something is in hand to build (Build.dc.html,
 * BuildPad.dc.html). Left the view control (Water [V] and Power [O] on the keyboard; one "View" button on d-pad up
 * on a pad), then slots 1–9 (the piece in hand raised with a leaf ring, empty ones dashed, locked ones dimmed with a
 * lock; keyboard keys under them, or the d-pad's left and right at the row's ends on a pad), then Remove and All
 * builds. "Stop building" sits above its right end. Every glyph comes from the bindings, so rebinding shows.
 */
export class BuildBar extends HudPart {
  private style: GlyphStyle = 'keys';
  private b?: Bindings;
  /** E23.3.4: the Power view is on (the game sets it). */
  powerOn = false;
  /** E23.4.5: the Water view is on (the game sets it). */
  waterOn = false;
  private tool: Tool = 'pulse';

  static template(): string {
    return (
      `<nav id="buildbar" class="bdock" aria-label="Build hotbar" hidden></nav>` +
      `<div id="buildStop" class="bstop" hidden><span class="bstop-g" aria-hidden="true"></span><span>Stop building</span></div>`
    );
  }

  wire() {
    $(this.root, '#buildbar').addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slot], [data-act]');
      if (!el) return;
      if (el.dataset.slot !== undefined) this.cb.buildAct(SLOTS[Number(el.dataset.slot)]);
      else this.cb.buildAct(el.dataset.act as Action);
    });
  }

  /** What slots 1–9 hold (tool ids; '' is empty). */
  slots(): string[] {
    const h = this.settings.hotbar ?? HOTBAR_DEFAULT;
    return Array.from({ length: 9 }, (_, i) => h[i] ?? '');
  }

  setKeys(style: GlyphStyle | undefined, b?: Bindings) {
    if (!b) return;
    this.style = style ?? 'keys';
    this.b = b;
    this.last.delete('buildbar');
    this.render(this.tool);
  }

  /** The views there is something to show for: the grid once one stands, the water once the pipes are handed over. */
  views(): BuildView[] {
    const v: BuildView[] = ['off'];
    if (this.sim.power.networks().length) v.push('power');
    if (this.sim.water.unlocked('pipe')) v.push('water');
    return v;
  }

  get view(): BuildView {
    return this.powerOn ? 'power' : this.waterOn ? 'water' : 'off';
  }

  /** E23.11: d-pad up: the next view (off, Power, Water, off), skipping one there is nothing to show for. */
  nextView(): BuildView {
    const v = this.views();
    return v[(v.indexOf(this.view) + 1) % v.length] ?? 'off';
  }

  /** A slot that can go in hand: something there, and unlocked. */
  private usable(t: string): boolean {
    const it = buildItem(this.sim, t);
    return !!it && !it.locked;
  }

  /** E23.11: d-pad left / right: the next usable slot from the one in hand (wrapping), or undefined if none. */
  step(dir: 1 | -1, from: Tool = this.tool): Tool | undefined {
    const s = this.slots();
    const at = s.indexOf(from);
    for (let k = 1; k <= 9; k++) {
      const i = (((at < 0 ? (dir > 0 ? -1 : 0) : at) + dir * k) % 9 + 9) % 9;
      if (s[i] && s[i] !== from && this.usable(s[i])) return s[i] as Tool;
    }
    return undefined;
  }

  private glyph(a: Action): string {
    return this.b ? actionGlyph(this.b, a, this.style) : '';
  }

  /** Shows the dock while something is in hand to build (or remove), with that slot lit. */
  render(tool: Tool) {
    this.tool = tool;
    const el = $(this.root, '#buildbar');
    const stop = $(this.root, '#buildStop');
    const building = tool !== 'pulse' && tool !== 'inspect';
    el.hidden = !building;
    stop.hidden = !building;
    document.body.classList.toggle('building', building);
    if (!building) return;
    const pad = this.style !== 'keys';
    this.set('bstop-g', $(stop, '.bstop-g'), 'html', pad ? this.glyph('cancel') : this.b ? actionGlyph(this.b, 'menu', 'keys') : '');
    const mode = (act: Action, icon: string, label: string, on: boolean, cls: string, aria: string) =>
      `<button class="bmode ${cls}${on ? ' on' : ''}" data-act="${act}" aria-pressed="${on}" aria-label="${esc(aria)}"><span class="round" aria-hidden="true">${icon}</span><span class="bl">${esc(label)}</span><span class="bg" aria-hidden="true">${this.glyph(act)}</span></button>`;
    const views = this.views();
    let left = '';
    if (pad) {
      // one button on d-pad up: off, Power, Water
      const v = this.view;
      const name = v === 'power' ? 'Power' : v === 'water' ? 'Water' : 'off';
      const icon = v === 'power' ? ICONS.energy : v === 'water' ? ICONS.water : ICONS.inspect;
      if (views.length > 1) left = mode('viewCycle', icon, `View: ${name}`, v !== 'off', `view ${v}`, `Change the view, now ${v === 'off' ? 'off' : `the ${name} view`}`);
    } else {
      if (views.includes('water')) left += mode('waterOverlay', ICONS.water, 'Water', this.waterOn, 'water', `Water view ${this.waterOn ? 'on' : 'off'}`);
      if (views.includes('power')) left += mode('powerOverlay', ICONS.energy, 'Power', this.powerOn, 'power', `Power view ${this.powerOn ? 'on' : 'off'}`);
    }
    const slots = this.slots()
      .map((t, i) => {
        const it = buildItem(this.sim, t);
        const key = pad ? '' : `<span class="bg" aria-hidden="true">${this.glyph(SLOTS[i])}</span>`;
        if (!it) return `<button class="bslot empty" data-slot="${i}" aria-label="Slot ${i + 1}: empty"><span class="bl">Empty</span>${key}</button>`;
        const on = t === tool;
        const tip = `Slot ${i + 1}: ${it.name}${it.locked ? `, locked: ${it.lockText}` : ''}`;
        return `<button class="bslot${on ? ' on' : ''}${it.locked ? ' locked' : ''}${` t-${it.tab}`}" data-slot="${i}" aria-label="${esc(tip)}" aria-pressed="${on}" title="${esc(tip)}"><span class="si" aria-hidden="true">${it.locked ? ICONS.lock : it.icon}</span><span class="bl">${esc(it.short)}</span>${key}</button>`;
      })
      .join('');
    const edge = (a: Action) => (pad ? `<span class="bedge" aria-hidden="true">${this.glyph(a)}</span>` : '');
    const right = mode('removeMode', ICONS.broom, 'Remove', tool === 'remove', 'remove', `Remove ${tool === 'remove' ? 'on' : 'off'}`) + mode('buildMenu', ICONS.build, 'All', false, 'all', 'The build menu: everything you can build');
    const html = `${left}${left ? '<span class="vsep" aria-hidden="true"></span>' : ''}${edge('slotPrev')}${slots}${edge('slotNext')}<span class="vsep" aria-hidden="true"></span>${right}`;
    el.classList.toggle('pad', pad);
    this.set('buildbar', el, 'html', html);
    this.place();
  }

  /**
   * The dock sits centred on the screen; where that would run it under the minimap (bottom left) it moves to the
   * right of it. #565: where its slots don't fit there, it draws tighter (narrower slots and gaps), and where even
   * that doesn't fit (a big UI scale on a small screen) the minimap steps aside while building and the dock takes the
   * whole width. #599: a layout fits only with every name whole (none cut short with …); only the last resort may cut. In the HUD's own pixels (measured on screen and divided by the HUD's zoom: offset sizes inside a
   * zoomed HUD don't agree between browsers).
   */
  place() {
    const el = $(this.root, '#buildbar');
    if (el.hidden) return;
    const gap = 16;
    const z = Number(getComputedStyle(this.root).zoom) || 1;
    const hud = this.root.getBoundingClientRect();
    const mm = this.root.querySelector<HTMLElement>('#minimap');
    const mr = mm && !mm.hidden ? mm.getBoundingClientRect() : undefined; // (still laid out while stepped aside)
    const vw = hud.width / z;
    const beside = mr && mr.width ? (mr.right - hud.left) / z + gap : gap;
    // the plainest that fits: beside the minimap, then tighter, then the whole width
    const tries: [from: number, tight: boolean, wide: boolean][] = [[beside, false, false], [beside, true, false], [gap, true, true]];
    let pick = tries[tries.length - 1];
    for (const t of tries) {
      this.layout(el, vw, gap, t);
      if (el.scrollWidth <= el.clientWidth + 1 && !namesCut(el)) {
        pick = t;
        break;
      }
    }
    if (pick === tries[tries.length - 1]) this.layout(el, vw, gap, pick);
    const from = pick[0];
    const w = el.getBoundingClientRect().width / z;
    const left = `${Math.round(Math.max(from, Math.min((vw - w) / 2, vw - gap - w)))}px`;
    if (el.style.left !== left) el.style.left = left;
    if (el.style.transform !== 'none') el.style.transform = 'none';
  }

  /** One way of fitting the dock: from `from` to the right edge, drawn tight or not, the minimap aside or not. */
  private layout(el: HTMLElement, vw: number, gap: number, [from, tight, wide]: [number, boolean, boolean]) {
    const room = `${Math.max(200, vw - from - gap)}px`;
    if (el.style.maxWidth !== room) el.style.maxWidth = room;
    el.classList.toggle('tight', tight);
    this.root.classList.toggle('dock-wide', wide);
  }

  /** Locks and unlocks show as they change (cheap: compared before the DOM is touched). */
  private checkedAt = 0;
  update() {
    if (this.tool === 'pulse' || this.tool === 'inspect') return;
    const now = performance.now();
    if (now - this.checkedAt < 400) return;
    this.checkedAt = now;
    this.place(); // the window or the HUD size may have changed
    const key = this.slots().map((t) => `${t}:${buildItem(this.sim, t)?.locked ? 1 : 0}`).join() + this.views().join();
    if (this.last.get('bb-state') === key) return;
    this.last.set('bb-state', key);
    this.render(this.tool);
  }
}

/** #599: a name on the dock cut short (ending in …) */
function namesCut(el: HTMLElement): boolean {
  for (const n of el.querySelectorAll<HTMLElement>('.bl')) if (n.scrollWidth > n.clientWidth + 1) return true;
  return false;
}
