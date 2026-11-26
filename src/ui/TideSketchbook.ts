import type { SavedSketch, SaveService } from '../app/SaveService';
import { cardHead, escHtml, type OldCityPanel } from './OldCityPanel';
import { icon } from './PanelShell';
import './sketchbook.css';

const notes = [
  'I thought it was watching me. It was watching a fly over my shoulder.',
  'It sat so still the leaf did most of the moving.',
  'Two little feet over the edge, as if it owned the whole pond.',
  'I looked down for a fresh pencil. It was still there when I looked up.',
];

export function sketchPage(page: SavedSketch): string {
  return `<figure class="sketch-page"><img src="${escHtml(page.image)}" width="480" height="400" alt="${escHtml(page.title)}"><figcaption>${escHtml(page.note)} <span>— Tide</span></figcaption></figure>`;
}

/** Tide's conversation and the page it opens share the existing keyboard and controller panel. */
export class TideSketchbook {
  private previousSeed?: number;
  private visit = 0;

  constructor(
    private panel: OldCityPanel,
    private saves: SaveService,
    private draw: (seed: number) => Promise<string>,
  ) {}

  open(talk: () => void, talkLabel: string, firstPhoto?: () => void) {
    this.visit++;
    const backToTide = () => this.open(talk, talkLabel, firstPhoto);
    this.panel.open(() => cardHead({ icon: icon('book', 'l'), title: 'Tide' }) +
      `<div class="oc-content oc-row"><button class="pn-btn" data-act="talk">${escHtml(talkLabel)}</button>
       <button class="pn-btn primary" data-act="sketch">Show me your sketches</button>
       ${firstPhoto ? '<button class="pn-btn" data-act="photo">Take our first picture</button>' : ''}</div>`,
    (action) => {
      if (action === 'sketch') this.browse(backToTide);
      if (action === 'photo') {
        this.panel.close();
        firstPhoto?.();
      }
      if (action === 'talk') {
        this.panel.close();
        talk();
      }
    });
  }

  /** A photo is already kept when Tide shows it, so its viewer reads the recorded image. */
  showFirstPhoto(page: SavedSketch) {
    this.visit++;
    this.showPhoto(page, () => this.panel.close());
  }

  private browse(backToTide: () => void) {
    const pages = this.saves.sketches().filter((page) => page.photo);
    const back = () => {
      backToTide();
      this.panel.el.querySelector<HTMLElement>('[data-act="sketch"]')?.focus();
    };
    const next = (i: number) => {
      if (pages[i]) this.showPhoto(pages[i], back, () => next(i + 1));
      else this.page(backToTide);
    };
    next(0);
  }

  private showPhoto(page: SavedSketch, back: () => void, next?: () => void) {
    this.panel.open(() => cardHead({ icon: icon('book', 'l'), title: 'Tide’s sketchbook', mood: page.title, dock: 'sheet' }) +
      `<div class="oc-content">${sketchPage(page)}
       <p role="status">Saved to Backpack → Collection</p>
       <div class="oc-row">${next ? '<button class="pn-btn" data-act="another">Show another</button>' : ''}
       <button class="pn-btn primary" data-act="tide">Back to Tide</button></div></div>`, (action) => {
      if (action === 'tide') back();
      if (action === 'another') next?.();
    }, back);
  }

  private page(backToTide: () => void) {
    const visit = ++this.visit;
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    // Alternate sides of the pond so consecutive pages have an obviously different view.
    const parity = this.previousSeed === undefined ? random & 1 : 1 - (this.previousSeed & 1);
    const seed = ((random & 0xfffffffe) | parity) >>> 0;
    this.previousSeed = seed;
    let page: SavedSketch | undefined;
    let saved = false;
    let error = '';
    let loading = true;
    const back = () => {
      backToTide();
      this.panel.el.querySelector<HTMLElement>('[data-act="sketch"]')?.focus();
    };
    this.panel.open(() => cardHead({ icon: icon('book', 'l'), title: 'Tide’s sketchbook', dock: 'sheet' }) +
      `<div class="oc-content"><div role="status">${loading ? '<p>Turning a page…</p>' : ''}
      ${error ? `<p>${escHtml(error)}</p>` : ''}</div>
      ${page ? sketchPage(page) : ''}
      <div class="oc-row">
        ${page ? `<button class="pn-btn primary" data-act="keep" ${saved ? 'disabled' : ''}>${saved ? 'Saved to Collection' : 'Save to Collection'}</button>` : ''}
        ${!loading ? '<button class="pn-btn" data-act="another">Show another</button>' : ''}
        <button class="pn-btn" data-act="tide">Back to Tide</button>
      </div></div>`, (action) => {
        if (action === 'tide') back();
        if (action === 'another') this.page(backToTide);
        if (action === 'keep' && page) {
          saved = this.saves.keepSketch(page);
          error = saved ? '' : 'There isn’t room to save this page here.';
          this.panel.refresh();
          if (saved) this.panel.el.querySelector<HTMLElement>('[data-act="another"]')?.focus();
        }
      }, back);

    void this.draw(seed).then((image) => {
      page = { seed, title: 'Frog on a lily pad', note: notes[(seed >>> 1) % notes.length], image };
    }).catch(() => {
      error = 'Tide couldn’t open this page. Try another.';
    }).finally(() => {
      if (visit !== this.visit || !this.panel.isOpen) return;
      loading = false;
      const focusWasBack = this.panel.el.querySelector('[data-act="tide"]') === document.activeElement;
      this.panel.refresh();
      if (focusWasBack) this.panel.el.querySelector<HTMLElement>(page ? '[data-act="keep"]' : '[data-act="another"]')?.focus();
    });
  }
}
