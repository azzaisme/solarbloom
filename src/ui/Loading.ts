import { lotusSvg } from '../rendering/Emblem';
import { ACTION, type Action, Bindings, keyLabel, migrateBindings } from '../app/Bindings';
import { parseSettings, SETTINGS_KEY } from '../app/Settings';
import { padName } from './Glyphs';
import { fillKeys, TIPS } from './words';

/**
 * Text pass: a tip's "{pulse}" as the player's own key (or pad button, when the button pictures are set to a pad),
 * read from the saved settings: the loading screen comes up before the game and its bindings exist.
 */
function tipKeys(tip: string): string {
  let b = new Bindings();
  let pad: 'xbox' | 'ps' | 'deck' | undefined;
  try {
    const s = parseSettings(localStorage.getItem(SETTINGS_KEY));
    b = new Bindings(migrateBindings(s.keys || s.pad ? { v: s.bindingsV, keys: s.keys, pad: s.pad } : undefined).saved);
    if (s.glyphs === 'xbox' || s.glyphs === 'ps' || s.glyphs === 'deck') pad = s.glyphs;
  } catch {
    /* no storage: the default keys */
  }
  const key = (a: Action) => (pad ? padName(pad, b.pad[a]) : keyLabel(b.keys[a][0] ?? '')) || 'its key';
  return fillKeys(tip, (a) => key(a as Action), (a) => a in ACTION);
}

/**
 * E22.12 (#350): the loading screen. A painted still of the city, bloombot waddling to and fro (frames rendered from
 * the real model; standing still with reduced motion), a progress bar fed by real steps, and one plain tip. E23.11:
 * Sunlit Glass, the step, the leaf bar and the tip on one paper card with bloombot walking along the top of it. It covers start-up,
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

/** Bloombot's frames, rendered from the real model (tools/bot-sprite/make.mjs): one walk cycle, and a turn to face us. */
const WALK_URL = new URL('./loading/bot-walk.webp', import.meta.url).href;
const TURN_URL = new URL('./loading/bot-turn.webp', import.meta.url).href;

/** Decode the frame strips ahead of time and reuse the decoded image elements on the first visible frame. */
let botFrames: Promise<HTMLImageElement[]> | undefined;
export function preloadLoadingBot(): Promise<HTMLImageElement[]> {
  return (botFrames ??= Promise.all([
    loadBotStrip(WALK_URL, 'ld-walk'),
    loadBotStrip(TURN_URL, 'ld-turn'),
  ]).then((frames) => frames.filter((frame): frame is HTMLImageElement => frame !== undefined)));
}

async function loadBotStrip(url: string, className: string): Promise<HTMLImageElement | undefined> {
  const image = new Image();
  image.className = className;
  image.alt = '';
  image.draggable = false;
  image.src = url;
  try {
    await image.decode();
    return image;
  } catch {
    return undefined;
  }
}

const BLOOMBOT = '<div class="ld-walker" aria-hidden="true"><div class="ld-flip"><div class="ld-frame"></div></div></div>';

export class Loading {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private line: HTMLElement;
  private shownAt = 0;

  constructor(reducedMotion = false, tip = TIPS[Math.floor(Math.random() * TIPS.length)]) {
    this.el = document.getElementById('loading') ?? document.createElement('div');
    this.el.id = 'loading';
    this.el.hidden = true;
    this.el.className = `loading${reducedMotion ? ' still' : ''}`;
    this.el.setAttribute('role', 'status');
    this.el.innerHTML =
      `<div class="ld-art" aria-hidden="true"></div>` +
      `<div class="ld-foot">` +
      BLOOMBOT +
      `<div class="ld-head"><div class="t-badge logo" aria-hidden="true">${lotusSvg()}</div><p class="ld-line">Unpacking the city</p></div>` +
      `<div class="ld-bar" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>` +
      `<p class="ld-tip"><b>Tip</b>${tipKeys(tip).replace(/[&<>"]/g, '')}</p></div>`;
    if (!this.el.parentElement) document.body.appendChild(this.el);
    this.bar = this.el.querySelector<HTMLElement>('.ld-bar')!;
    this.line = this.el.querySelector<HTMLElement>('.ld-line')!;
  }

  async show() {
    const frames = await preloadLoadingBot();
    this.el.querySelector('.ld-frame')!.replaceChildren(...frames);
    if (frames.length < 2) this.el.classList.add('still');
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
