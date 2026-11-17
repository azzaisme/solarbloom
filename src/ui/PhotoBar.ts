import type { Action } from '../app/Bindings';
import type { PhotoState } from '../app/PhotoMode';

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
      if (b) this.act(b.dataset.photo as Action);
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
    const zoom = pad ? 'right stick' : `${this.keyFor('zoomIn')} ${this.keyFor('zoomOut')} or the wheel`;
    const html =
      `<span class="pb-title">Photo mode</span>` +
      `<button data-photo="pulse">Save picture${k('pulse')}</button>` +
      tog('interact', 'Hide bloombot', s.hideBot) +
      tog('tray', 'Freeze the garden', s.freeze) +
      tog('frenzy', 'Depth of field', s.dof) +
      `<button data-photo="backpack">Hide this bar${k('backpack')}</button>` +
      `<button data-photo="cancel">Leave${k('cancel')}</button>` +
      `<span class="pb-help">Move ${move} · zoom ${zoom} · tilt ${this.keyFor('prevTool')} ${this.keyFor('nextTool')} · turn with a right-button drag or the right stick</span>`;
    if (html !== this.shown) {
      this.el.innerHTML = html;
      this.shown = html;
    }
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
export function saveCanvasPng(src: HTMLCanvasElement, background: string) {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const g = out.getContext('2d');
  if (!g) return;
  g.fillStyle = background;
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(src, 0, 0);
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
