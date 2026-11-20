import { TIPS } from './words';

/**
 * E22.12 (#350): the loading screen. A painted still of the city, bloombot walking on the spot (a CSS sprite, no
 * 3D; still with reduced motion), a progress bar fed by real steps, and one plain tip. E23.11: Sunlit Glass, the
 * step, the leaf bar and the tip on one paper card with bloombot walking on top of it. It covers start-up,
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

/**
 * Bloombot from the side, walking on the spot: drawn once in SVG (ivory shell, gold trim, the dark visor with its
 * cyan eye, the leaf and antenna, the gardening pack). The legs and arms are groups the stylesheet swings; with
 * reduced motion it stands still.
 */
const BLOOMBOT_SVG =
  `<svg viewBox="0 0 120 150" width="120" height="150">` +
  `<ellipse class="lb-shadow" cx="60" cy="143" rx="30" ry="5"/>` +
  `<g class="lb-bob">` +
  `<g class="lb-leg lb-leg-b"><rect x="62" y="104" width="13" height="26" rx="6" class="lb-dark"/><path d="M58 128 h22 a6 6 0 0 1 6 6 v4 h-28 z" class="lb-shell"/><rect x="58" y="135" width="28" height="4" rx="2" class="lb-gold"/></g>` +
  `<g class="lb-arm lb-arm-b"><rect x="60" y="80" width="10" height="24" rx="5" class="lb-dark"/><circle cx="65" cy="106" r="6.5" class="lb-dark"/></g>` +
  `<rect x="22" y="76" width="22" height="30" rx="7" class="lb-pack"/><rect x="20" y="70" width="26" height="10" rx="5" class="lb-roll"/>` +
  `<rect x="38" y="72" width="38" height="38" rx="15" class="lb-shell"/><rect x="38" y="98" width="38" height="6" class="lb-gold"/><circle cx="62" cy="88" r="6" class="lb-gold"/><circle cx="62" cy="88" r="4" class="lb-visor"/>` +
  `<g class="lb-leg lb-leg-f"><rect x="46" y="104" width="13" height="26" rx="6" class="lb-dark"/><path d="M42 128 h22 a6 6 0 0 1 6 6 v4 h-28 z" class="lb-shell"/><rect x="42" y="135" width="28" height="4" rx="2" class="lb-gold"/></g>` +
  `<path d="M52 20 L47 4" class="lb-antenna"/><circle cx="46" cy="4" r="4.5" class="lb-bulb"/>` +
  `<path d="M56 22 C60 2 84 -2 96 6 C92 22 72 28 56 22 Z" class="lb-leaf"/><path d="M58 21 C70 16 82 11 94 7" class="lb-vein"/>` +
  `<ellipse cx="60" cy="48" rx="38" ry="32" class="lb-shell"/><path d="M24 56 a38 32 0 0 0 72 0" class="lb-gold-line"/>` +
  `<rect x="52" y="30" width="46" height="34" rx="16" class="lb-gold"/><rect x="55" y="33" width="40" height="28" rx="13" class="lb-visor"/>` +
  `<path d="M70 50 a6 6 0 0 1 12 0" class="lb-eye"/>` +
  `<circle cx="30" cy="48" r="11" class="lb-gold"/><circle cx="30" cy="48" r="7.5" class="lb-visor"/><circle cx="30" cy="48" r="4" class="lb-ear"/>` +
  `<g class="lb-arm lb-arm-f"><rect x="46" y="80" width="11" height="25" rx="5.5" class="lb-shell"/><circle cx="51.5" cy="107" r="7" class="lb-dark"/><circle cx="51.5" cy="107" r="3" class="lb-ear"/></g>` +
  `</g></svg>`;

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
      `<div class="ld-art" aria-hidden="true"></div>` +
      `<div class="ld-foot">` +
      `<div class="ld-bot" aria-hidden="true">${BLOOMBOT_SVG}</div>` +
      `<div class="ld-head"><div class="t-badge" aria-hidden="true"><span class="t-ic t-ic-leaf"></span></div><p class="ld-line">Unpacking the city</p></div>` +
      `<div class="ld-bar" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>` +
      `<p class="ld-tip"><b>Tip</b>${tip.replace(/[&<>"]/g, '')}</p></div>`;
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
