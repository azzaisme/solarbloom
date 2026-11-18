import type { Action } from '../app/Bindings';
import { PHOTO_FILTERS, PHOTO_WEATHER_NAMES, type PhotoState } from '../app/PhotoMode';

/**
 * E19.4.1 (#260): photo mode's controls bar, outside the HUD (which photo mode hides). The saved picture is the
 * canvas alone, so the bar never shows in it. Buttons send the same actions as the keys and pad buttons.
 */
export class PhotoBar {
  readonly el: HTMLElement;
  private flash: HTMLElement;
  private shown?: string;

  constructor(
    private act: (a: Action) => void,
    private keyFor: (a: Action) => string,
    /** E23.7.3: the time slider (clock hours; undefined: back to the real time) */
    private setHour?: (h: number | undefined) => void,
    /** E23.7.3: the real clock hour, for the slider's resting place */
    private clockHour?: () => number,
  ) {
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
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-photo]');
      if (b?.dataset.photo === 'now') return this.setHour?.(undefined);
      if (b) this.act(b.dataset.photo as Action);
    });
    // E23.7.3: dragging the time slider sets photo mode's own time of day
    this.el.addEventListener('input', (e) => {
      const r = e.target as HTMLInputElement;
      if (r.dataset.photoHour !== undefined) this.setHour?.(Number(r.value));
    });
  }

  render(s: PhotoState | undefined) {
    this.el.classList.toggle('on', !!s);
    this.el.classList.toggle('clean', !!s?.clean);
    if (!s) {
      this.shown = undefined;
      return;
    }
    const k = (a: Action) => {
      const l = this.keyFor(a);
      return l && l !== '—' ? ` <kbd>${l}</kbd>` : '';
    };
    const tog = (a: Action, label: string, on: boolean) => `<button data-photo="${a}" aria-pressed="${on}">${label}${k(a)}</button>`;
    const pad = this.keyFor('up') === '—'; // the pad moves and zooms with its sticks
    const move = pad ? 'left stick' : `${this.keyFor('up')}${this.keyFor('left')}${this.keyFor('down')}${this.keyFor('right')}`;
    const zoom = pad ? 'right stick' : 'the mouse wheel';
    const html =
      `<span class="pb-title">Photo mode</span>` +
      `<button data-photo="pulse">Save picture${k('pulse')}</button>` +
      tog('interact', 'Hide bloombot', s.hideBot) +
      tog('buildMenu', 'Freeze the garden', s.freeze) +
      tog('harvest', 'Depth of field', s.dof) +
      this.sceneHtml(s, k) +
      `<button data-photo="backpack">Hide this bar${k('backpack')}</button>` +
      `<button data-photo="cancel">Leave${k('cancel')}</button>` +
      `<span class="pb-help">Move ${move} · zoom ${zoom} · tilt ${this.keyFor('rotateBack')} ${this.keyFor('rotate')} · turn with a right-button drag or the right stick</span>`;
    if (html !== this.shown) {
      const focused = document.activeElement?.closest?.('#photoBar') ? (document.activeElement as HTMLElement).dataset : undefined;
      this.el.innerHTML = html;
      this.shown = html;
      // keep the slider (or button) in hand while it redraws under a drag or a press
      if (focused?.photoHour !== undefined) this.el.querySelector<HTMLElement>('[data-photo-hour]')?.focus();
      else if (focused?.photo) this.el.querySelector<HTMLElement>(`[data-photo="${focused.photo}"]`)?.focus();
    }
  }

  /** E23.7.3: the scene: time of day (a slider, an hour button and Now), the weather and a filter. */
  private sceneHtml(s: PhotoState, k: (a: Action) => string): string {
    const h = s.hour ?? this.clockHour?.() ?? 12;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    return (
      `<span class="pb-scene"><label>Time <input type="range" min="0" max="23.75" step="0.25" value="${h}" data-photo-hour aria-label="Time of day" aria-valuetext="${clock}"></label>` +
      `<button data-photo="pinNext">${clock}${s.hour === undefined ? ' (now)' : ''}${k('pinNext')}</button>` +
      (s.hour !== undefined ? `<button data-photo="now">Now</button>` : '') +
      `<button data-photo="map">${PHOTO_WEATHER_NAMES[s.weather]}${k('map')}</button>` +
      `<button data-photo="removeMode">${PHOTO_FILTERS[s.filter].name}${k('removeMode')}</button></span>`
    );
  }

  /** A soft white flash when a picture is saved. */
  flashNow() {
    this.flash.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flash.classList.remove('on')));
  }
}

/**
 * Saves a canvas as a PNG download. Call it right after a frame is drawn (the WebGL drawing buffer is only
 * readable then). Where the canvas is see-through (no post-processing), `background` fills in behind it.
 */
export function saveCanvasPng(src: HTMLCanvasElement, background: string, filter = '') {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const g = out.getContext('2d');
  if (!g) return;
  g.fillStyle = background;
  g.fillRect(0, 0, out.width, out.height);
  // E23.7.3: the picture gets photo mode's filter, as the view showed it
  if (filter) g.filter = filter;
  g.drawImage(src, 0, 0);
  g.filter = 'none';
  out.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    const d = new Date();
    const two = (n: number) => String(n).padStart(2, '0');
    a.download = `solarbloom-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.png`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}
