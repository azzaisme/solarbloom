/**
 * Bloombot (G.16): the controls map (docs/BLOOMBOT_EPIC.md §7) as one table of actions → keys and gamepad
 * buttons, which the settings screen can rebind. Keys are `KeyboardEvent.code` values (so WASD stays where it
 * is on AZERTY and other layouts); pad buttons are standard-mapping indices. Pure: tests use it directly.
 */
export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'sprint'
  | 'pulse'
  | 'interact'
  | 'tray'
  | 'cancel'
  | 'harvest'
  | 'upgrades'
  | 'backpack'
  | 'prevTool'
  | 'nextTool'
  | 'zoomIn'
  | 'zoomOut'
  | 'overview'
  | 'pause'
  | 'frenzy'
  | 'nextArea'
  | 'home'
  | 'recentre'
  | 'debug';

/** Labels for the rebinding screen, in the order shown. */
export const ACTIONS: readonly { id: Action; label: string; pad: boolean }[] = [
  { id: 'up', label: 'Move up', pad: false },
  { id: 'down', label: 'Move down', pad: false },
  { id: 'left', label: 'Move left', pad: false },
  { id: 'right', label: 'Move right', pad: false },
  { id: 'sprint', label: 'Sprint', pad: true },
  { id: 'pulse', label: 'Pulse / confirm', pad: true },
  { id: 'interact', label: 'Interact / inspect', pad: true },
  { id: 'tray', label: 'Build tray', pad: true },
  { id: 'cancel', label: 'Cancel / close', pad: true },
  { id: 'harvest', label: 'Harvest', pad: true },
  { id: 'upgrades', label: 'Upgrades', pad: true },
  { id: 'backpack', label: 'Backpack', pad: true },
  { id: 'prevTool', label: 'Previous tool', pad: true },
  { id: 'nextTool', label: 'Next tool', pad: true },
  { id: 'zoomIn', label: 'Zoom in (while placing)', pad: false },
  { id: 'zoomOut', label: 'Zoom out (while placing)', pad: false },
  { id: 'overview', label: 'Overview', pad: true },
  { id: 'pause', label: 'Settings / pause', pad: true },
  { id: 'frenzy', label: 'Bloom Frenzy', pad: true },
  { id: 'nextArea', label: 'Go to the area that needs you', pad: true },
  { id: 'home', label: 'Back to the park', pad: true },
  { id: 'recentre', label: 'Recentre the camera', pad: true },
  { id: 'debug', label: 'Debug overlay', pad: false },
];

export const DEFAULT_KEYS: Record<Action, string[]> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  pulse: ['KeyE'],
  interact: ['KeyQ'],
  tray: ['KeyB'],
  cancel: ['Escape'],
  harvest: ['KeyF'],
  upgrades: ['KeyU'],
  backpack: ['Tab'],
  prevTool: ['Digit1'],
  nextTool: ['Digit2'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  overview: ['KeyM'],
  pause: ['KeyP'],
  frenzy: ['KeyR'],
  nextArea: ['KeyN'],
  home: ['Home'],
  recentre: ['KeyC'],
  debug: ['F3', 'Backquote'],
};

/**
 * Standard gamepad buttons: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 LS, 11 RS,
 * 12–15 d-pad up, down, left, right. Movement and zoom are the sticks.
 */
export const DEFAULT_PAD: Partial<Record<Action, number>> = {
  sprint: 7,
  pulse: 0,
  cancel: 1,
  interact: 2,
  tray: 3,
  prevTool: 4,
  nextTool: 5,
  frenzy: 6,
  overview: 8,
  pause: 9,
  nextArea: 10,
  recentre: 11, // right stick click, beside the stick that turns the view
  backpack: 12,
  // 13 (d-pad down) is left for menu focus (G.7)
  harvest: 14,
  upgrades: 15,
};

/** Build tool shortcuts stay on the number row (3–9, 0) and can't be rebound. */
export const BUILD_DIGITS = ['Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'] as const;

export interface SavedBindings {
  keys?: Partial<Record<Action, string[]>>;
  pad?: Partial<Record<Action, number>>;
}

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →'];

/** A key code as a short label ("KeyE" → "E", "ShiftLeft" → "Shift"). */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Shift')) return 'Shift';
  if (code.startsWith('Control')) return 'Ctrl';
  if (code.startsWith('Alt')) return 'Alt';
  const named: Record<string, string> = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Equal: '+', Minus: '-', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', Backquote: '`', Space: 'Space' };
  return named[code] ?? code;
}

export function padLabel(button: number | undefined): string {
  return button === undefined ? '—' : (PAD_NAMES[button] ?? `Button ${button}`);
}

export class Bindings {
  readonly keys: Record<Action, string[]>;
  readonly pad: Partial<Record<Action, number>>;

  constructor(saved?: SavedBindings) {
    this.keys = Object.fromEntries(Object.entries(DEFAULT_KEYS).map(([a, k]) => [a, [...(saved?.keys?.[a as Action] ?? k)]])) as Record<Action, string[]>;
    this.pad = { ...DEFAULT_PAD, ...(saved?.pad ?? {}) };
  }

  /** Back to the default map. */
  reset() {
    for (const [a, k] of Object.entries(DEFAULT_KEYS)) this.keys[a as Action] = [...k];
    for (const a of Object.keys(this.pad) as Action[]) delete this.pad[a];
    Object.assign(this.pad, DEFAULT_PAD);
  }

  /** The action a key triggers, if any. */
  actionForCode(code: string): Action | undefined {
    for (const [a, codes] of Object.entries(this.keys)) if (codes.includes(code)) return a as Action;
    return undefined;
  }

  actionForButton(button: number): Action | undefined {
    for (const [a, b] of Object.entries(this.pad)) if (b === button) return a as Action;
    return undefined;
  }

  isDown(action: Action, held: ReadonlySet<string>): boolean {
    return this.keys[action].some((c) => held.has(c));
  }

  /** The first key's label, for hints ("E"). */
  label(action: Action): string {
    return keyLabel(this.keys[action][0] ?? '');
  }

  /**
   * Binds a key to an action as its main key. A key belongs to one action only: if another action had it, the
   * two swap (that action gets this one's old main key), so nothing is ever left unbound by accident.
   */
  setKey(action: Action, code: string) {
    if (BUILD_DIGITS.includes(code as (typeof BUILD_DIGITS)[number])) return;
    const other = this.actionForCode(code);
    const old = this.keys[action][0];
    if (other && other !== action) {
      this.keys[other] = this.keys[other].filter((c) => c !== code);
      if (old && !this.keys[other].length) this.keys[other].push(old);
    }
    this.keys[action] = [code, ...this.keys[action].filter((c) => c !== code && c !== old)];
  }

  setButton(action: Action, button: number) {
    const other = this.actionForButton(button);
    if (other && other !== action) this.pad[other] = this.pad[action];
    this.pad[action] = button;
  }

  /** Only what differs from the defaults is saved. */
  save(): SavedBindings {
    const keys: Partial<Record<Action, string[]>> = {};
    for (const [a, k] of Object.entries(this.keys)) if (k.join() !== DEFAULT_KEYS[a as Action].join()) keys[a as Action] = k;
    const pad: Partial<Record<Action, number>> = {};
    for (const [a, b] of Object.entries(this.pad)) if (b !== DEFAULT_PAD[a as Action]) pad[a as Action] = b;
    return { keys, pad };
  }

  /** Every key or button claimed by more than one action (empty for a sane map). */
  conflicts(): string[] {
    const seen = new Map<string, Action>();
    const out: string[] = [];
    for (const [a, codes] of Object.entries(this.keys))
      for (const c of codes) {
        const was = seen.get(c);
        if (was) out.push(`${c}: ${was} and ${a}`);
        seen.set(c, a as Action);
      }
    for (const c of BUILD_DIGITS) if (seen.has(c)) out.push(`${c}: ${seen.get(c)} and a build slot`);
    const pads = new Map<number, Action>();
    for (const [a, b] of Object.entries(this.pad)) {
      if (b === undefined) continue;
      const was = pads.get(b);
      if (was) out.push(`pad ${b}: ${was} and ${a}`);
      pads.set(b, a as Action);
    }
    return out;
  }
}
