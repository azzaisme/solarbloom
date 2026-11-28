import type { PhotoDir } from '../app/PhotoMode';
import { ALBUM } from '../app/PhotoAlbum';
import { glyph, fillGlyphs, icon } from './PanelShell';

/**
 * #photo-2: the picture just taken, shown before anything is kept. The player saves it to the album or dismisses
 * it; nothing is stored until they choose. With the album's twelve good pictures full, Save offers a small copy or
 * the place of one of the twelve (picked from their thumbnails; the one replaced stays as a small copy). "Save as
 * a file" downloads the picture at its full size (the only place the double-size picture goes).
 *
 * It is a dialog over photo mode: the arrow keys or the d-pad move between its buttons, Enter, Space or A press
 * the one in focus, and Esc or B dismisses (from the twelve: back to the choice).
 */
export interface PhotoShotHost {
  /** keeps the picture (in place of one of the twelve when `replace` is given). False when it could not be stored. */
  keep(replace?: string): Promise<boolean>;
  /** downloads the picture as a file */
  exportFile(): void;
  /** what the file button says once pressed (the desktop build names the folder the file went to) */
  fileSaved?: string;
  /** the twelve good pictures are full */
  full(): boolean;
  /** the twelve, for the replace picker */
  best(): { id: string; url: string }[];
  /** the dialog closed; `saved` when the picture went into the album */
  closed(saved: boolean): void;
}

export class PhotoShot {
  readonly el: HTMLElement;
  private pic: HTMLElement;
  private body: HTMLElement;
  private picking = false;
  private busy = false;
  private exported = false;
  private error = '';
  open = false;

  constructor(private host: PhotoShotHost) {
    this.el = document.createElement('div');
    this.el.id = 'photoShot';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Your picture');
    this.el.innerHTML = '<div class="ps-card panel"><div class="ps-pic"></div><div class="ps-body"></div></div>';
    document.body.appendChild(this.el);
    this.pic = this.el.querySelector('.ps-pic')!;
    this.body = this.el.querySelector('.ps-body')!;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (b && !b.disabled) this.act(b.dataset.shot ?? '', b.dataset.id);
    });
  }

  /** Shows a picture just taken (the canvas itself is drawn in the card). */
  show(picture: HTMLCanvasElement) {
    this.pic.replaceChildren(picture);
    this.picking = this.busy = this.exported = false;
    this.error = '';
    this.open = true;
    this.el.classList.add('on');
    this.render();
  }

  private close(saved: boolean) {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('on');
    this.pic.replaceChildren(); // the picture's pixels are let go
    this.host.closed(saved);
  }

  private render() {
    const full = this.host.full();
    const msg = this.error || (this.picking ? 'Choose the picture this one replaces. It stays in your album as a small copy.' : full ? `Your ${ALBUM.best} best pictures are full. Keep this one as a small copy, or give it the place of one of them.` : '');
    const file = `<button class="pn-btn" data-shot="file"${this.exported ? ' disabled' : ''}>${this.exported ? (this.host.fileSaved ?? 'File saved') : 'Save as a file'}</button>`;
    const buttons = this.picking
      ? `<div class="ps-grid">${this.host.best().map((p, i) => `<button data-shot="replace" data-id="${p.id}" aria-label="Replace picture ${i + 1}"><img src="${p.url}" alt=""></button>`).join('')}</div>` +
        `<div class="ps-row"><button class="pn-btn" data-shot="back">Back${glyph('cancel')}</button></div>`
      : `<div class="ps-row">` +
        (full
          ? `<button class="pn-btn primary" data-shot="keep">${icon('save', 's')}Save a small copy</button><button class="pn-btn" data-shot="pick">Replace one of your ${ALBUM.best}</button>`
          : `<button class="pn-btn primary" data-shot="keep">${icon('save', 's')}Save</button>`) +
        `${file}<button class="pn-btn" data-shot="dismiss">Dismiss${glyph('cancel')}</button></div>`;
    this.el.firstElementChild!.classList.toggle('picking', this.picking);
    this.body.innerHTML = `<p class="ps-msg" role="status"${msg ? '' : ' hidden'}>${msg}</p>${buttons}`;
    fillGlyphs(this.body);
    for (const b of this.buttons()) b.disabled ||= this.busy;
    (this.body.querySelector<HTMLElement>('.primary:not(:disabled)') ?? this.buttons().find((b) => !b.disabled))?.focus();
  }

  private buttons(): HTMLButtonElement[] {
    return [...this.body.querySelectorAll<HTMLButtonElement>('button')];
  }

  private act(what: string, id?: string) {
    if (this.busy) return;
    if (what === 'dismiss') return this.close(false);
    if (what === 'back') {
      this.picking = false;
      return this.render();
    }
    if (what === 'pick') {
      this.picking = true;
      return this.render();
    }
    if (what === 'file') {
      this.host.exportFile();
      this.exported = true;
      return this.render();
    }
    if (what === 'keep' || what === 'replace') {
      this.busy = true;
      this.error = '';
      this.render();
      void this.host.keep(what === 'replace' ? id : undefined).then((ok) => {
        this.busy = false;
        if (ok) return this.close(true);
        this.error = 'There isn’t room to keep this picture here. You can still save it as a file.';
        this.picking = false;
        this.render();
      });
    }
  }

  /** The arrow keys or the d-pad: to the next button (in the grid of twelve, up and down move a row). */
  nav(dir: PhotoDir) {
    const all = this.buttons().filter((b) => !b.disabled);
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const grid = this.body.querySelector('.ps-grid');
    const cols = grid ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length) : 1;
    const inGrid = at >= 0 && !!all[at].closest('.ps-grid');
    const step = dir === 'left' ? -1 : dir === 'right' ? 1 : (dir === 'up' ? -1 : 1) * (inGrid ? cols : 1);
    all[Math.min(all.length - 1, Math.max(0, at < 0 ? 0 : at + step))].focus();
  }

  /** Enter, Space or A: the button in focus (the first one when none is). */
  press() {
    const f = document.activeElement as HTMLElement | null;
    const b = f && this.body.contains(f) ? (f as HTMLButtonElement) : this.buttons().find((x) => !x.disabled);
    b?.click();
  }

  /** Esc or B: out of the twelve, or dismiss. */
  back() {
    this.act(this.picking ? 'back' : 'dismiss');
  }
}
