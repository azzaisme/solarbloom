import type { Action } from '../app/Bindings';
import { PHOTO_TABS, type PhotoRow, type PhotoRowId, type PhotoState, type PhotoTab } from '../app/PhotoMode';
import { PHOTO_FRAMES, type PhotoGrid } from '../data/photo';
import { escHtml } from './OldCityPanel';
import { fillGlyphs, glyph, icon } from './PanelShell';

/**
 * E19.4.1 (#260): photo mode's controls, outside the HUD (which photo mode hides). The saved picture is the canvas
 * alone, so they never show in it. Buttons send the same actions as the keys and pad buttons.
 *
 * #photo-2: a panel in the bottom left corner (the middle of the picture stays clear): five tabs of settings, one
 * row each, drawn from PhotoMode's rows. Sliders drag, choices step with their arrows, toggles and buttons press;
 * the row in hand (arrow keys, d-pad) is ringed. Over the picture, and never in it: the frame's shape as a dark
 * matte, and the guide lines. Tide's first-picture lesson keeps its own small card.
 */
export interface PhotoPanel {
  setTab(tab: PhotoTab): void;
  adjust(id: PhotoRowId, dir: number): void;
  setValue(id: PhotoRowId, v: number): void;
  /** the time slider's Now button */
  setHour(h: number | undefined): void;
}

const GUIDES: Record<PhotoGrid, string> = {
  none: '',
  thirds: 'M33.333 0V100M66.667 0V100M0 33.333H100M0 66.667H100',
  centre: 'M50 0V100M0 50H100',
  diagonals: 'M0 0L100 100M100 0L0 100',
};

export class PhotoBar {
  readonly el: HTMLElement;
  private flash: HTMLElement;
  /** #photo-2: the frame's matte and the guide lines, over the picture */
  private frame: HTMLElement;
  private shown?: string;
  private notice = '';
  private state?: PhotoState;

  constructor(
    private act: (a: Action) => void,
    private keyFor: (a: Action) => string,
    private panel: PhotoPanel,
  ) {
    this.frame = document.createElement('div');
    this.frame.id = 'photoFrame';
    this.frame.setAttribute('aria-hidden', 'true');
    this.frame.innerHTML = '<div class="pf-box"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path class="pf-under"/><path class="pf-over"/></svg></div>';
    document.body.appendChild(this.frame);
    this.el = document.createElement('div');
    this.el.id = 'photoBar';
    this.el.className = 'panel';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Photo mode');
    document.body.appendChild(this.el);
    this.flash = document.createElement('div');
    this.flash.id = 'photoFlash';
    document.body.appendChild(this.flash);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      const d = b.dataset;
      if (d.photo === 'now') this.panel.setHour(undefined);
      else if (d.photo) this.act(d.photo as Action);
      else if (d.tab) this.panel.setTab(d.tab as PhotoTab);
      else if (d.adj) this.panel.adjust(d.adj as PhotoRowId, Number(d.dir ?? 1));
      // a mouse press leaves the keys with the camera (Space would press the button again, and save a picture too)
      if (e.detail > 0) b.blur();
    });
    // dragging a slider sets its row
    this.el.addEventListener('input', (e) => {
      const r = e.target as HTMLInputElement;
      if (r.dataset.set) this.panel.setValue(r.dataset.set as PhotoRowId, Number(r.value));
    });
    // a slider let go by the mouse gives the keys back to the camera (a focused slider would keep W, A, S and D)
    this.el.addEventListener('pointerup', (e) => {
      const r = e.target as HTMLElement;
      if (r instanceof HTMLInputElement && e.pointerType === 'mouse') r.blur();
    });
  }

  sketchNotice(notice: string) {
    this.notice = notice;
    this.render(this.state);
  }

  render(s: PhotoState | undefined) {
    this.state = s;
    this.el.classList.toggle('on', !!s);
    this.el.classList.toggle('clean', !!s?.clean);
    this.el.classList.toggle('lesson', !!s?.tutorial);
    this.renderFrame(s);
    if (!s) {
      this.shown = undefined;
      this.notice = '';
      return;
    }
    // the button's key or pad button, drawn for the device in hand (none when the action has no button)
    const k = (a: Action) => {
      const l = this.keyFor(a);
      // (#photo-2: the d-pad works the panel here, so an action on it has no button to show)
      return l && l !== '—' && !l.startsWith('D-pad') ? glyph(a) : '';
    };
    const pad = this.keyFor('up') === '—'; // the pad moves and zooms with its sticks
    const move = `${this.keyFor('up')}${this.keyFor('left')}${this.keyFor('down')}${this.keyFor('right')}`;
    const title = `<span class="pb-title"><span class="pn-badge sky" aria-hidden="true">${icon('camera')}</span>Photo mode</span>`;
    const shutter = `<button class="pb-shutter" data-photo="pulse">${icon('camera', 's')}<span class="pb-shutter-l">Save picture</span>${k('pulse')}</button>`;
    const leave = `<button class="pb-leave" data-photo="cancel">${icon('door', 's')}Leave${k('cancel')}</button>`;
    let html: string;
    if (s.tutorial) {
      const notice = this.notice ? `<p class="pb-help" role="status">${escHtml(this.notice)}</p>` : '';
      html = `<div class="pb-row">${title}${shutter}${leave}</div><p class="pb-help pb-tide"><b>Tide</b> “Frame us by the water and take a picture. I’ll draw this one.”</p>${notice}`;
    } else {
      // one sentence for the hands in use: what moves the camera, and what works the panel
      const help = pad
        ? `Move with the left stick; turn and zoom with the right stick. The d-pad works this panel, and ${this.keyFor('interact')} presses a row.`
        : `Move with ${move}, zoom with the mouse wheel, and hold the right mouse button to turn. The arrow keys work this panel, and Enter presses a row.`;
      const tabs = PHOTO_TABS.map((t) => `<button role="tab" data-tab="${t.id}" aria-selected="false">${t.name}</button>`).join('');
      html =
        `<div class="pb-head">${title}${leave}</div>` +
        `<div class="pb-tabs" role="tablist" aria-label="Photo settings">${tabs}</div>` +
        `<div class="pb-rows" role="tabpanel">${s.rows.map((r) => this.rowHtml(r, k)).join('')}</div>` +
        `<p class="pb-tip" role="status"></p>${shutter}<p class="pb-help">${help}</p>`;
    }
    if (html !== this.shown) {
      const focused = document.activeElement?.closest?.('#photoBar') ? (document.activeElement as HTMLElement).dataset : undefined;
      this.el.innerHTML = html;
      this.shown = html;
      fillGlyphs(this.el);
      // keep the control in hand while the panel redraws (a new tab, a new device)
      const again = focused?.set ? `[data-set="${focused.set}"]` : focused?.adj ? `[data-adj="${focused.adj}"][data-dir="${focused.dir ?? 1}"]` : focused?.tab ? `[data-tab="${focused.tab}"]` : focused?.photo ? `[data-photo="${focused.photo}"]` : '';
      if (again) this.el.querySelector<HTMLElement>(again)?.focus();
    }
    if (!s.tutorial) this.fill(s);
  }

  /** A row's markup. Its values are filled in by fill(), so a drag never rebuilds the slider under the hand. */
  private rowHtml(r: PhotoRow, k: (a: Action) => string): string {
    const label = `<span class="pb-l">${escHtml(r.label)}${r.action ? k(r.action) : ''}</span>`;
    let c: string;
    if (r.kind === 'slider')
      c = `<input type="range" data-set="${r.id}" min="${r.min}" max="${r.max}" step="${r.step}" aria-label="${escHtml(r.label)}"><span class="pb-v"></span>` + (r.id === 'hour' ? '<button class="pb-now" data-photo="now" hidden>Now</button>' : '');
    else if (r.kind === 'choice')
      c = `<button class="pb-step" data-adj="${r.id}" data-dir="-1" aria-label="${escHtml(r.label)}: the one before">‹</button><span class="pb-v"></span><button class="pb-step" data-adj="${r.id}" data-dir="1" aria-label="${escHtml(r.label)}: the next">›</button>`;
    else c = `<button class="pb-press" data-adj="${r.id}"${r.kind === 'toggle' ? ' aria-pressed="false"' : ''}><span class="pb-v"></span></button>`;
    return `<div class="pb-item ${r.kind}" data-row="${r.id}">${label}<span class="pb-c">${c}</span></div>`;
  }

  /** Fills the panel's values in place: the open tab, each row's value and words, the row in hand, the tip. */
  private fill(s: PhotoState) {
    for (const t of this.el.querySelectorAll<HTMLElement>('[data-tab]')) {
      const open = t.dataset.tab === s.tab;
      t.setAttribute('aria-selected', String(open));
      t.classList.toggle('sel', open && s.row < 0);
    }
    let tip = this.notice;
    s.rows.forEach((r, i) => {
      const el = this.el.querySelector<HTMLElement>(`[data-row="${r.id}"]`);
      if (!el) return;
      const sel = i === s.row;
      el.classList.toggle('sel', sel);
      el.classList.toggle('off', !!r.off);
      if (sel && r.off) tip = `${r.off}.`;
      const v = el.querySelector<HTMLElement>('.pb-v');
      if (v && v.textContent !== r.text) v.textContent = r.text;
      const input = el.querySelector<HTMLInputElement>('input');
      if (input) {
        if (Number(input.value) !== r.value) input.value = String(r.value);
        input.setAttribute('aria-valuetext', r.text);
        input.disabled = !!r.off;
      }
      for (const b of el.querySelectorAll<HTMLButtonElement>('button:not(.pb-now)')) {
        b.disabled = !!r.off;
        if (r.kind === 'toggle' || r.id === 'pick') b.setAttribute('aria-pressed', String(!!r.on));
      }
      const now = el.querySelector<HTMLElement>('.pb-now');
      if (now) now.hidden = r.text.endsWith('(now)');
    });
    if (s.picking) tip = 'Press on the part of the picture that should be sharp.';
    const t = this.el.querySelector<HTMLElement>('.pb-tip');
    if (t) {
      if (t.textContent !== tip) t.textContent = tip;
      t.hidden = !tip;
    }
    const l = this.el.querySelector<HTMLElement>('.pb-shutter-l');
    const label = s.picking ? 'Set the focus' : 'Save picture';
    if (l && l.textContent !== label) l.textContent = label;
  }

  /** #photo-2: the picture's shape (everything outside it darkened) and the guide lines, over the view. */
  private renderFrame(s: PhotoState | undefined) {
    const f = this.frame;
    const ratio = s && !s.tutorial ? PHOTO_FRAMES[s.frame].ratio : 0;
    const guides = s && !s.tutorial ? GUIDES[s.grid] : '';
    f.classList.toggle('on', !!s && (ratio > 0 || !!guides));
    f.classList.toggle('shaped', ratio > 0);
    document.body.classList.toggle('photo-pick', !!s?.picking);
    const box = f.firstElementChild as HTMLElement;
    box.style.setProperty('--r', String(ratio || 0));
    for (const p of f.querySelectorAll('path')) p.setAttribute('d', guides);
  }

  /** A soft white flash when a picture is saved. */
  flashNow() {
    this.flash.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flash.classList.remove('on')));
  }
}

/**
 * The picture a canvas shows, as its own canvas. Call it right after a frame is drawn (the WebGL drawing buffer is
 * only readable then). Where the canvas is see-through (no post-processing), `background` fills in behind it;
 * `filter` is photo mode's filter, as the view showed it; `crop` (canvas pixels) keeps only the frame's shape.
 */
export function pictureCanvas(src: HTMLCanvasElement, background: string, filter = '', crop?: { x: number; y: number; w: number; h: number }): HTMLCanvasElement | undefined {
  const out = document.createElement('canvas');
  const c = crop ?? { x: 0, y: 0, w: src.width, h: src.height };
  out.width = c.w;
  out.height = c.h;
  const g = out.getContext('2d');
  if (!g) return undefined;
  g.fillStyle = background;
  g.fillRect(0, 0, out.width, out.height);
  if (filter) g.filter = filter;
  g.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  g.filter = 'none';
  return out;
}

/** The file name a picture taken at `d` is saved under. */
export function pictureName(d = new Date(), ext = 'png'): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `solarbloom-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.${ext}`;
}

/** Downloads a picture as a file. */
export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(blob);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Downloads a picture's canvas as a PNG. */
export function downloadCanvas(picture: HTMLCanvasElement, name = pictureName()) {
  picture.toBlob((blob) => blob && downloadBlob(blob, name), 'image/png');
}
