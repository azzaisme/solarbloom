import { actionGlyph } from './Glyphs';
import { $, esc, HudPart } from './HudPart';

/** The three shortcuts, as the actions their buttons fire. */
export type DockAction = 'backpack' | 'map' | 'menu';

const ITEMS: { a: DockAction; label: string; icon: string }[] = [
  { a: 'backpack', label: 'Backpack', icon: 'i-pack' },
  { a: 'map', label: 'Map', icon: 'i-map' },
  { a: 'menu', label: 'Menu', icon: 'i-menu' },
];

/**
 * E23.11: the shortcut dock, bottom right under the toasts (docs/art/ui-sunlit-glass/Walk.dc.html): three round
 * paper buttons, Backpack, Map and Menu, each with the picture of its button under it in the set the player is
 * using (keys, Xbox, PlayStation, Deck). It is a quiet reminder of the buttons (pad players never need to click it);
 * a click does what the button does. A pink dot on the backpack while a Keeper's request is new (asked since the
 * backpack was last opened).
 */
export class Dock extends HudPart {
  private el?: HTMLElement;
  private dot?: HTMLElement;
  private glyphAt = -1;
  /** the requests (Keeper and step) the player has had a chance to see */
  private seen?: Set<string>;
  private t = 0;
  private fresh = false;

  static template(): string {
    return `<nav id="dock" aria-label="Shortcuts">${ITEMS.map(
      (i) =>
        `<button class="dk" type="button" data-dock="${i.a}" tabindex="-1" aria-label="${esc(i.label)}">` +
        `<span class="round sg-card"><span class="sg-ic l ${i.icon}" aria-hidden="true"></span></span>` +
        `<span class="dk-g" aria-hidden="true"></span>` +
        (i.a === 'backpack' ? `<span class="dot" hidden></span>` : '') +
        `</button>`,
    ).join('')}</nav>`;
  }

  wire() {
    this.root.insertAdjacentHTML('beforeend', Dock.template());
    this.el = $(this.root, '#dock');
    this.dot = $(this.el, '.dot');
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-dock]');
      if (!b) return;
      b.blur(); // the keyboard stays with the game
      this.cb.dock(b.dataset.dock as DockAction);
    });
  }

  update(dt: number) {
    const el = this.el;
    if (!el) return;
    // the button pictures follow the device in use and any rebinding
    if (this.glyphAt !== this.hud.keyMapVersion && this.hud.bindings) {
      this.glyphAt = this.hud.keyMapVersion;
      for (const i of ITEMS) {
        const b = $(el, `[data-dock="${i.a}"]`);
        $(b, '.dk-g').innerHTML = actionGlyph(this.hud.bindings, i.a, this.hud.glyphStyle);
      }
      this.label();
    }
    // a new request: asked since the backpack (where the requests live) was last open
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    const k = this.sim.keepers;
    const asks = k.requests().map((r) => `${r.id}:${k.step(r.id)}`);
    if (!this.seen) this.seen = new Set(asks); // what was asked before this session counts as seen
    if (this.hud.backpack.isOpen) for (const a of asks) this.seen.add(a);
    const fresh = asks.some((a) => !this.seen!.has(a));
    if (fresh !== this.fresh) {
      this.fresh = fresh;
      if (this.dot) this.dot.hidden = !fresh;
      this.label();
    }
  }

  /** Each button's name with its key ("Backpack (Tab)"), and the backpack's new request. */
  private label() {
    if (!this.el) return;
    for (const i of ITEMS)
      $(this.el, `[data-dock="${i.a}"]`).setAttribute('aria-label', `${i.label} (${this.cb.keyFor(i.a)})${i.a === 'backpack' && this.fresh ? ', a new request' : ''}`);
  }
}
