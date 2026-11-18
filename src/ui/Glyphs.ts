import { type Action, type Bindings, keyLabel } from '../app/Bindings';

/**
 * E22.3 (#340): button pictures that follow the device in hand. Four sets, drawn as small inline SVGs (no image
 * files to load, crisp at every interface size): keyboard keys and mouse buttons, Xbox, PlayStation and Steam
 * Deck, covering the face buttons, bumpers, triggers, d-pad directions, stick clicks, View and Menu.
 *
 * Every glyph sits in the same 40 × 30 box, so swapping sets (a mouse move, then a pad press) never shifts the
 * prompt. Each carries a screen-reader name ("Cross button", "Left mouse button"). Nothing is told by colour
 * alone: face buttons carry their letter or shape as well as their colour.
 */
export type PadStyle = 'xbox' | 'ps' | 'deck';
export type GlyphStyle = 'keys' | PadStyle;
/** The setting: follow the device (`auto`), or always one set. */
export type GlyphSetting = 'auto' | GlyphStyle;
export const GLYPH_SETTINGS: readonly [GlyphSetting, string][] = [
  ['auto', 'Follow the device in use'],
  ['xbox', 'Xbox'],
  ['ps', 'PlayStation'],
  ['deck', 'Steam Deck'],
  ['keys', 'Keyboard and mouse'],
];

/** The pad family from a Gamepad API id (Valve's id for the Deck, Sony's vendor id for PlayStation). */
export function padStyleFromId(id: string, deckBuild = false): PadStyle {
  const s = id.toLowerCase();
  if (deckBuild || s.includes('steam deck') || /28de.*1205|1205.*28de/.test(s)) return 'deck';
  if (s.includes('xbox') || s.includes('045e') || s.includes('xinput')) return 'xbox';
  if (s.includes('054c') || s.includes('dualsense') || s.includes('dualshock') || s.includes('playstation') || s.includes('wireless controller')) return 'ps';
  return 'xbox';
}

const W = 40;
const H = 30;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const svg = (label: string, body: string, cls = '') => `<svg class="glyph ${cls}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${body}</svg>`;
/** Text that fits the box: smaller for longer labels. */
const text = (t: string, cls = 'g-ink', y = 20) => `<text x="${W / 2}" y="${y}" text-anchor="middle" class="${cls}" font-size="${t.length <= 2 ? 14 : t.length <= 4 ? 11 : t.length <= 6 ? 9 : 7.5}">${esc(t)}</text>`;

/** A keyboard key. */
function keyCap(code: string): string {
  const l = keyLabel(code);
  const short: Record<string, string> = { 'Left mouse': 'L', 'Right mouse': 'R' };
  return svg(`${l} key`, `<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="6" class="g-cap"/><rect x="2" y="${H - 7}" width="${W - 4}" height="5" rx="3" class="g-cap-edge"/>${text(short[l] ?? l, 'g-ink', 19)}`, 'g-key');
}

/** A mouse with one part lit: 0 left, 1 middle (wheel press), 2 right, 'wheel' the wheel, 3 / 4 side buttons. */
function mouse(part: 0 | 1 | 2 | 3 | 4 | 'wheel'): string {
  const names = { 0: 'Left mouse button', 1: 'Middle mouse button', 2: 'Right mouse button', 3: 'Mouse back button', 4: 'Mouse forward button', wheel: 'Mouse wheel' } as const;
  const lit = (on: boolean) => (on ? 'g-lit' : 'g-cap');
  const body =
    `<path d="M20 3 C12 3 11 8 11 13 L11 20 C11 25 15 28 20 28 C25 28 29 25 29 20 L29 13 C29 8 28 3 20 3 Z" class="g-cap"/>` +
    `<path d="M19.4 3.3 C13 3.6 11.4 8 11.2 12.6 L19.4 12.6 Z" class="${lit(part === 0)}"/>` +
    `<path d="M20.6 3.3 C27 3.6 28.6 8 28.8 12.6 L20.6 12.6 Z" class="${lit(part === 2)}"/>` +
    `<rect x="18.4" y="5.5" width="3.2" height="5.5" rx="1.6" class="${part === 1 || part === 'wheel' ? 'g-lit' : 'g-ink-fill'}"/>` +
    (part === 'wheel' ? `<path d="M20 0.5 L22.5 3 L17.5 3 Z M20 15.5 L22.5 13 L17.5 13 Z" class="g-ink-fill"/>` : '') +
    (part === 3 || part === 4 ? `<rect x="9" y="${part === 3 ? 16 : 11}" width="3" height="4" rx="1" class="g-lit"/>` : '');
  return svg(names[part], body, 'g-mouse');
}

/** Any key or mouse input as its glyph. */
export function keyGlyph(code: string): string {
  if (code === 'Wheel') return mouse('wheel');
  const m = /^Mouse([0-4])$/.exec(code);
  if (m) return mouse(Number(m[1]) as 0 | 1 | 2 | 3 | 4);
  return keyCap(code);
}

/** Face buttons by standard index (0 bottom, 1 right, 2 left, 3 top). */
const FACE = {
  xbox: [
    { name: 'A', cls: 'g-pad-a' },
    { name: 'B', cls: 'g-pad-b' },
    { name: 'X', cls: 'g-pad-x' },
    { name: 'Y', cls: 'g-pad-y' },
  ],
  ps: [
    { name: 'Cross', cls: 'g-ps-cross' },
    { name: 'Circle', cls: 'g-ps-circle' },
    { name: 'Square', cls: 'g-ps-square' },
    { name: 'Triangle', cls: 'g-ps-triangle' },
  ],
  deck: [
    { name: 'A', cls: 'g-deck' },
    { name: 'B', cls: 'g-deck' },
    { name: 'X', cls: 'g-deck' },
    { name: 'Y', cls: 'g-deck' },
  ],
} as const;

/** The names a style gives each standard button, for labels and the small hotbar badges. */
export const PAD_NAMES: Record<PadStyle, readonly string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'Left stick', 'Right stick', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'],
  ps: ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'],
  deck: ['A', 'B', 'X', 'Y', 'L1', 'R1', 'L2', 'R2', 'View', 'Menu', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'],
};

function faceGlyph(style: PadStyle, i: 0 | 1 | 2 | 3): string {
  const f = FACE[style][i];
  const disc = `<circle cx="20" cy="15" r="13" class="${f.cls}"/>`;
  if (style !== 'ps') return svg(`${f.name} button`, disc + text(f.name, 'g-face-ink', 20));
  // PlayStation: the shape itself (drawn, so it reads without colour).
  const shape = [
    `<path d="M14 9 L26 21 M26 9 L14 21" class="g-shape"/>`,
    `<circle cx="20" cy="15" r="6.5" class="g-shape"/>`,
    `<rect x="13.5" y="8.5" width="13" height="13" class="g-shape"/>`,
    `<path d="M20 7.5 L27.5 20.5 L12.5 20.5 Z" class="g-shape"/>`,
  ][i];
  return svg(`${f.name} button`, `<circle cx="20" cy="15" r="13" class="g-ps-disc"/>${shape}`, f.cls);
}

function dpad(dir: 0 | 1 | 2 | 3): string {
  const names = ['up', 'down', 'left', 'right'];
  const arms = [
    'M16 2 H24 V11 L20 15 L16 11 Z',
    'M16 28 H24 V19 L20 15 L16 19 Z',
    'M5 11 V19 H14 L18 15 L14 11 Z',
    'M35 11 V19 H26 L22 15 L26 11 Z',
  ];
  return svg(`D-pad ${names[dir]}`, arms.map((d, i) => `<path d="${d}" class="${i === dir ? 'g-lit' : 'g-cap'}"/>`).join(''));
}

/** A pad button by standard index, in a style. */
export function padGlyph(style: PadStyle, button: number): string {
  const n = PAD_NAMES[style];
  if (button >= 0 && button <= 3) return faceGlyph(style, button as 0 | 1 | 2 | 3);
  if (button === 4 || button === 5) return svg(n[button], `<rect x="3" y="7" width="34" height="16" rx="8" class="g-cap"/>${text(n[button], 'g-ink', 19)}`);
  if (button === 6 || button === 7) return svg(n[button], `<path d="M8 27 V12 C8 5 14 3 20 3 C26 3 32 5 32 12 V27 Z" class="g-cap"/>${text(n[button], 'g-ink', 21)}`);
  if (button === 8)
    return svg(style === 'ps' ? 'Create button' : 'View button', `<circle cx="20" cy="15" r="13" class="g-cap"/>` + (style === 'ps' ? `<path d="M15 9 V21 M20 9 V21 M25 9 V21" class="g-stroke"/>` : `<rect x="12" y="9" width="11" height="8" rx="1.5" class="g-stroke"/><rect x="17" y="13" width="11" height="8" rx="1.5" class="g-stroke"/>`));
  if (button === 9) return svg(style === 'ps' ? 'Options button' : 'Menu button', `<circle cx="20" cy="15" r="13" class="g-cap"/><path d="M13 10 H27 M13 15 H27 M13 20 H27" class="g-stroke"/>`);
  if (button === 10 || button === 11) {
    const l = style === 'xbox' ? (button === 10 ? 'L' : 'R') : n[button];
    return svg(`${n[button]} click`, `<circle cx="20" cy="15" r="13" class="g-cap"/><circle cx="20" cy="15" r="9" class="g-stroke"/>${text(l, 'g-ink', 20)}`);
  }
  if (button >= 12 && button <= 15) return dpad((button - 12) as 0 | 1 | 2 | 3);
  return svg(`Button ${button}`, `<circle cx="20" cy="15" r="13" class="g-cap"/>${text(String(button), 'g-ink', 20)}`);
}

/** The glyph for an action's first input in a style; a dash when that input isn't bound. */
export function actionGlyph(b: Bindings, a: Action, style: GlyphStyle): string {
  if (style === 'keys') {
    const k = b.keys[a][0];
    return k ? keyGlyph(k) : svg('Not bound', text('—'));
  }
  const btn = b.pad[a];
  return btn === undefined ? svg('Not bound', text('—')) : padGlyph(style, btn);
}

/** A short text name for a pad button in a style (the hotbar's small badges, hints in sentences). */
export function padName(style: PadStyle, button: number | undefined): string {
  return button === undefined ? '' : (PAD_NAMES[style][button] ?? `Button ${button}`);
}

/**
 * Which set is on screen: the setting, or (on Auto) the last device used and, for a pad, its family. Switching
 * device changes it at once; everything reads `style` each frame, so every glyph on screen swaps together.
 */
export class GlyphTracker {
  setting: GlyphSetting = 'auto';
  device: 'keys' | 'pad' = 'keys';
  padType: PadStyle = 'xbox';
  /** the desktop (Deck) build: its built-in pad is a Deck */
  deckBuild = false;

  /** Reads the first connected pad's family (cheap; call when the pad was used). */
  sensePad(pads: ArrayLike<Gamepad | null> | undefined) {
    const gp = pads ? Array.from(pads).find((p) => p?.connected) : undefined;
    if (gp) this.padType = padStyleFromId(gp.id, this.deckBuild);
  }

  get style(): GlyphStyle {
    if (this.setting === 'keys') return 'keys';
    if (this.device === 'keys') return 'keys';
    return this.setting === 'auto' ? this.padType : this.setting;
  }
}
