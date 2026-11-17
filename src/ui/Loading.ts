import { TIPS } from './words';

/**
 * E22.12 (#350): the loading screen. A painted still of the city, bloombot walking on the spot (a CSS sprite, no
 * 3D; still with reduced motion), a progress bar fed by real steps, and one plain tip. It covers start-up,
 * loading a slot, a new game and quitting to the title, and fades only when the first view is complete (the
 * ground, models and textures round bloombot), never sooner than 0.5 s after it appeared.
 */
export interface LoadSteps {
  /** the hand-built models (0..1) */
  models: number;
  /** the world generated and the game built */
  world: number;
  /** the first view's chunks and textures (0..1) */
  view: number;
  /** a few frames drawn with everything in place (shaders warmed) */
  shaders: number;
}

const WEIGHTS: LoadSteps = { models: 0.4, world: 0.2, view: 0.3, shaders: 0.1 };
const LINES: [keyof LoadSteps, string][] = [
  ['models', 'Unpacking the city'],
  ['world', 'Laying out the streets'],
  ['view', 'Waking the ground around bloombot'],
  ['shaders', 'Letting the light settle'],
];

/** The bar's fill (0..1) for a set of steps. */
export function loadFraction(s: LoadSteps): number {
  let f = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof LoadSteps)[]) f += WEIGHTS[k] * Math.max(0, Math.min(1, s[k]));
  return f;
}

/** The step under way, in words. */
export function loadLine(s: LoadSteps): string {
  return (LINES.find(([k]) => s[k] < 1) ?? LINES[LINES.length - 1])[1];
}

export class Loading {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private line: HTMLElement;
  private shownAt = 0;

  constructor(reducedMotion = false, tip = TIPS[Math.floor(Math.random() * TIPS.length)]) {
    this.el = document.getElementById('loading') ?? document.createElement('div');
    this.el.id = 'loading';
    this.el.className = `loading${reducedMotion ? ' still' : ''}`;
    this.el.setAttribute('role', 'status');
    this.el.innerHTML =
      `<div class="ld-art" aria-hidden="true"><i class="ld-sun"></i><i class="ld-hills"></i><i class="ld-city"></i><i class="ld-park"></i></div>` +
      `<div class="ld-bot" aria-hidden="true"><i class="ld-body"></i><i class="ld-eye"></i><i class="ld-leaf"></i><i class="ld-leg l"></i><i class="ld-leg r"></i></div>` +
      `<div class="ld-foot"><div class="ld-bar" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>` +
      `<p class="ld-line">Unpacking the city</p><p class="ld-tip">${tip.replace(/[&<>"]/g, '')}</p></div>`;
    if (!this.el.parentElement) document.body.appendChild(this.el);
    this.bar = this.el.querySelector<HTMLElement>('.ld-bar')!;
    this.line = this.el.querySelector<HTMLElement>('.ld-line')!;
  }

  show() {
    this.shownAt = performance.now();
    this.el.hidden = false;
    this.el.classList.remove('gone');
    document.body.classList.add('loading-on');
  }

  progress(s: LoadSteps) {
    const pct = Math.round(loadFraction(s) * 100);
    (this.bar.firstElementChild as HTMLElement).style.width = `${pct}%`;
    this.bar.setAttribute('aria-valuenow', String(pct));
    const l = loadLine(s);
    if (this.line.textContent !== l) this.line.textContent = l;
  }

  /** Fades out (after at least `minMs` on screen), then hides. */
  async done(minMs = 500) {
    const wait = Math.max(0, minMs - (performance.now() - this.shownAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    this.el.classList.add('gone');
    document.body.classList.remove('loading-on');
    await new Promise((r) => setTimeout(r, 450));
    this.el.hidden = true;
  }
}
