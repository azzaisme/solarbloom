/**
 * E22.1 (#338): the controls map (docs/E22_CONTROLS_UI.md, "The new map") as one table of actions → keys and
 * gamepad buttons, which Settings › Controls can rebind (E22.4). Keys are `KeyboardEvent.code` values (so WASD
 * stays where it is on AZERTY and other layouts), plus mouse inputs (`Mouse0` left, `Mouse1` middle, `Mouse2`
 * right, `Mouse3` / `Mouse4` side buttons, `Wheel`). Pad buttons are standard-mapping indices. Pure: tests use it
 * directly.
 *
 * Every action belongs to a context. Two actions may share an input only when their contexts never apply at the
 * same time: walking (`world`), build mode (`build`, which sits on top of walking and wins while it is open), an
 * open panel or menu (`panel`), or always (`any`). That is how Q is the build menu while walking and "previous
 * tab" in a panel, and how A is Interact while walking and Place in build mode.
 */
export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'sprint'
  | 'sprintToggle'
  | 'look'
  | 'zoomCamera'
  | 'recentre'
  | 'interact'
  | 'pulse'
  | 'place'
  | 'buildMenu'
  | 'rotate'
  | 'rotateBack'
  | 'removeMode'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'slot4'
  | 'slot5'
  | 'slot6'
  | 'slot7'
  | 'slot8'
  | 'slot9'
  | 'backpack'
  | 'map'
  | 'harvest'
  | 'pinNext'
  | 'cancel'
  | 'menu'
  | 'photo'
  | 'prevTab'
  | 'nextTab'
  | 'debug'
  // Classic rules only (decision 7): old-city rules give these no default (E21 hides them).
;

export type Context = 'world' | 'build' | 'panel' | 'any';
/** The rebinding screen's groups (E22.4). */
export type Group = 'move' | 'act' | 'build' | 'menus';
export const GROUPS: readonly { id: Group; label: string }[] = [
  { id: 'move', label: 'Move and look' },
  { id: 'act', label: 'Act' },
  { id: 'build', label: 'Build' },
  { id: 'menus', label: 'Menus' },
];

export interface ActionDef {
  id: Action;
  label: string;
  group: Group;
  context: Context;
  /** can be put on a keyboard key or mouse input */
  keys: boolean;
  /** can be put on a pad button (movement and look are the sticks) */
  pad: boolean;
}

const A = (id: Action, label: string, group: Group, context: Context, keys = true, pad = true): ActionDef => ({ id, label, group, context, keys, pad });

/** Every action, in the order the rebinding screen lists them. */
export const ACTIONS: readonly ActionDef[] = [
  A('up', 'Move forward', 'move', 'world', true, false),
  A('down', 'Move back', 'move', 'world', true, false),
  A('left', 'Move left', 'move', 'world', true, false),
  A('right', 'Move right', 'move', 'world', true, false),
  A('sprint', 'Hover (sprint, hold)', 'move', 'world'),
  A('sprintToggle', 'Hover on or off', 'move', 'world'),
  A('look', 'Look around (hold and drag)', 'move', 'world', true, false),
  A('zoomCamera', 'Zoom the camera', 'move', 'world'),
  A('recentre', 'Recentre the camera', 'move', 'world'),
  A('interact', 'Interact', 'act', 'world'),
  A('pulse', 'Pulse, use the tool, place', 'act', 'world'),
  A('harvest', 'Harvest Sunlight', 'act', 'world'),
  A('pinNext', 'Pin the next request', 'act', 'world'),
  A('buildMenu', 'Build menu', 'build', 'world'),
  A('place', 'Place (in build mode)', 'build', 'build'),
  A('rotate', 'Turn the piece', 'build', 'build'),
  A('rotateBack', 'Turn the piece back', 'build', 'build'),
  A('removeMode', 'Remove mode', 'build', 'build'),
  A('slot1', 'Hotbar slot 1', 'build', 'world'),
  A('slot2', 'Hotbar slot 2', 'build', 'world'),
  A('slot3', 'Hotbar slot 3', 'build', 'world'),
  A('slot4', 'Hotbar slot 4', 'build', 'world'),
  A('slot5', 'Hotbar slot 5', 'build', 'world'),
  A('slot6', 'Hotbar slot 6', 'build', 'world'),
  A('slot7', 'Hotbar slot 7', 'build', 'world'),
  A('slot8', 'Hotbar slot 8', 'build', 'world'),
  A('slot9', 'Hotbar slot 9', 'build', 'world'),
  A('backpack', 'Backpack', 'menus', 'world'),
  A('map', 'Map', 'menus', 'world'),
  A('photo', 'Photo mode', 'menus', 'world'),
  A('cancel', 'Back', 'menus', 'any'),
  A('menu', 'Pause and menu', 'menus', 'any'),
  A('prevTab', 'Previous tab', 'menus', 'panel'),
  A('nextTab', 'Next tab', 'menus', 'panel'),
  A('debug', 'Debug overlay', 'menus', 'any', true, false),
];
export const ACTION: Record<Action, ActionDef> = Object.fromEntries(ACTIONS.map((a) => [a.id, a])) as Record<Action, ActionDef>;

export const SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8', 'slot9'] as const satisfies readonly Action[];

/** Escape is fixed: back, or the menu when nothing is open. It can't be bound to anything else or removed. */
export const FIXED_KEY = 'Escape';
/** The pad's Menu button always opens the menu (it can't be unbound or moved). */
export const FIXED_PAD: Partial<Record<Action, number>> = { menu: 9 };

/** Saved bindings carry this version; older ones are reset once, with a notice (decision 6). */
export const BINDINGS_VERSION = 2;

/** The keyboard defaults from the epic's table. */
export function defaultKeys(): Record<Action, string[]> {
  const k: Record<Action, string[]> = {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'],
    sprintToggle: [],
    look: ['Mouse2'],
    zoomCamera: ['Wheel'],
    recentre: ['KeyC'],
    interact: ['KeyE'],
    pulse: ['Mouse0', 'Space'],
    place: [],
    buildMenu: ['KeyQ'],
    rotate: ['KeyR', 'Wheel'],
    rotateBack: [],
    removeMode: ['KeyX'],
    slot1: ['Digit1'],
    slot2: ['Digit2'],
    slot3: ['Digit3'],
    slot4: ['Digit4'],
    slot5: ['Digit5'],
    slot6: ['Digit6'],
    slot7: ['Digit7'],
    slot8: ['Digit8'],
    slot9: ['Digit9'],
    backpack: ['Tab', 'KeyI'],
    map: ['KeyM'],
    harvest: ['KeyF'],
    pinNext: ['KeyG'],
    cancel: [FIXED_KEY],
    menu: [FIXED_KEY],
    photo: ['KeyP'],
    prevTab: ['KeyQ'],
    nextTab: ['KeyE'],
    debug: ['F3'],
  };
  return k;
}

/**
 * Standard gamepad buttons: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 10 LS, 11 RS,
 * 12–15 d-pad up, down, left, right. Movement, looking and the camera's turn are the sticks.
 */
export function defaultPad(): Partial<Record<Action, number>> {
  const p: Partial<Record<Action, number>> = {
    sprint: 6,
    sprintToggle: 10,
    recentre: 11,
    zoomCamera: 13,
    interact: 0,
    pulse: 2,
    place: 0,
    buildMenu: 3,
    rotate: 5,
    rotateBack: 4,
    removeMode: 7,
    backpack: 12,
    map: 8,
    harvest: 14,
    cancel: 1,
    menu: 9,
    prevTab: 4,
    nextTab: 5,
  };
  p.pinNext = 15;
  return p;
}

export interface SavedBindings {
  /** BINDINGS_VERSION when written; missing means before E22 */
  v?: number;
  keys?: Partial<Record<Action, string[]>>;
  /** null: unbound on purpose */
  pad?: Partial<Record<Action, number | null>>;
}

/**
 * Bindings saved before this map (no version, or an older one) are dropped once. `reset` is true when there was
 * something to drop, so the game can say so ("Controls were updated. Your custom keys were reset.").
 */
export function migrateBindings(saved: SavedBindings | undefined): { saved: SavedBindings; reset: boolean } {
  if (!saved) return { saved: {}, reset: false };
  if (saved.v === BINDINGS_VERSION) return { saved, reset: false };
  const had = Object.keys(saved.keys ?? {}).length > 0 || Object.keys(saved.pad ?? {}).length > 0;
  return { saved: { v: BINDINGS_VERSION }, reset: had };
}

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'Left stick click', 'Right stick click', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'];

/** A key code as a short label ("KeyE" → "E", "ShiftLeft" → "Shift", "Mouse0" → "Left mouse"). */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Shift')) return 'Shift';
  if (code.startsWith('Control')) return 'Ctrl';
  if (code.startsWith('Alt')) return 'Alt';
  const named: Record<string, string> = {
    Escape: 'Esc',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Equal: '=',
    Minus: '-',
    Backquote: '`',
    Space: 'Space',
    Mouse0: 'Left mouse',
    Mouse1: 'Middle mouse',
    Mouse2: 'Right mouse',
    Mouse3: 'Mouse back',
    Mouse4: 'Mouse forward',
    Wheel: 'Mouse wheel',
    PageUp: 'Page Up',
    PageDown: 'Page Down',
  };
  return named[code] ?? code;
}

export function padLabel(button: number | undefined): string {
  return button === undefined ? '—' : (PAD_NAMES[button] ?? `Button ${button}`);
}

/** Can these two contexts apply at the same moment? (Build mode is its own layer: it wins while open.) */
export function contextsMeet(a: Context, b: Context): boolean {
  return a === b || a === 'any' || b === 'any';
}

/** What a rebind did: `ok`, or why not ("locked"), or which action already has that input (a clash). */
export type BindResult = { ok: true; swapped?: Action } | { ok: false; reason: 'locked' | 'clash' | 'not-allowed'; other?: Action };

export class Bindings {
  readonly keys: Record<Action, string[]>;
  readonly pad: Partial<Record<Action, number>>;
  constructor(saved?: SavedBindings) {
    const dk = defaultKeys();
    this.keys = Object.fromEntries(Object.entries(dk).map(([a, k]) => [a, [...(saved?.keys?.[a as Action] ?? k)]])) as Record<Action, string[]>;
    this.pad = { ...defaultPad() };
    for (const [a, b] of Object.entries(saved?.pad ?? {})) {
      if (!ACTIONS.some((x) => x.id === a)) continue; // an action that no longer exists (E23.1.2: Bloom Frenzy)
      if (b === null || b === undefined) delete this.pad[a as Action];
      else this.pad[a as Action] = b;
    }
    // The fixed inputs are always where they belong, whatever a save says.
    this.keys.cancel = [FIXED_KEY];
    this.keys.menu = [FIXED_KEY];
    this.pad.menu = FIXED_PAD.menu;
  }

  /** Back to the default map (both columns, or one: `keys` or `pad`). */
  reset(column?: 'keys' | 'pad') {
    if (column !== 'pad') for (const [a, k] of Object.entries(defaultKeys())) this.keys[a as Action] = [...k];
    if (column !== 'keys') {
      for (const a of Object.keys(this.pad) as Action[]) delete this.pad[a];
      Object.assign(this.pad, defaultPad());
    }
  }

  /** The action a key triggers in the given contexts, earliest context first (e.g. build before world). */
  actionForCode(code: string, contexts: readonly Context[] = ['world', 'any']): Action | undefined {
    for (const c of contexts) for (const a of ACTIONS) if (a.context === c && this.keys[a.id].includes(code)) return a.id;
    return undefined;
  }

  actionForButton(button: number, contexts: readonly Context[] = ['world', 'any']): Action | undefined {
    for (const c of contexts) for (const a of ACTIONS) if (a.context === c && this.pad[a.id] === button) return a.id;
    return undefined;
  }

  isDown(action: Action, held: ReadonlySet<string>): boolean {
    return this.keys[action].some((c) => held.has(c));
  }

  /** The first key's label, for hints ("E"). */
  label(action: Action): string {
    return keyLabel(this.keys[action][0] ?? '');
  }

  /** Is this input the fixed one for this action (it can't be moved)? */
  locked(action: Action, kind: 'key' | 'pad'): boolean {
    if (kind === 'key') return action === 'cancel' || action === 'menu';
    return FIXED_PAD[action] !== undefined;
  }

  /** The other action that already has this key where `action` applies, if any. */
  clashForKey(action: Action, code: string): Action | undefined {
    const ctx = ACTION[action].context;
    for (const a of ACTIONS) if (a.id !== action && contextsMeet(ctx, a.context) && this.keys[a.id].includes(code)) return a.id;
    return undefined;
  }

  clashForButton(action: Action, button: number): Action | undefined {
    const ctx = ACTION[action].context;
    for (const a of ACTIONS) if (a.id !== action && contextsMeet(ctx, a.context) && this.pad[a.id] === button) return a.id;
    return undefined;
  }

  /**
   * E22.4: binds a key (or mouse input) as an action's main key. A clash is refused unless `swap` is set: then
   * the other action takes this one's old main key. Escape and the cancel / menu keys can't be moved.
   */
  bindKey(action: Action, code: string, swap = false): BindResult {
    if (!ACTION[action].keys) return { ok: false, reason: 'not-allowed' };
    if (this.locked(action, 'key') || code === FIXED_KEY) return { ok: false, reason: 'locked' };
    const other = this.clashForKey(action, code);
    if (other && this.locked(other, 'key')) return { ok: false, reason: 'locked', other };
    if (other && !swap) return { ok: false, reason: 'clash', other };
    const old = this.keys[action][0];
    this.keys[action] = [code, ...this.keys[action].filter((c) => c !== code && c !== old)];
    if (other) {
      this.keys[other] = this.keys[other].filter((c) => c !== code);
      if (old && !this.keys[other].includes(old) && !this.clashForKey(other, old)) this.keys[other].unshift(old);
    }
    return { ok: true, swapped: other };
  }

  /** E22.4: binds a pad button. As `bindKey`; the Menu button can't be moved or taken. */
  bindButton(action: Action, button: number, swap = false): BindResult {
    if (!ACTION[action].pad) return { ok: false, reason: 'not-allowed' };
    if (this.locked(action, 'pad')) return { ok: false, reason: 'locked' };
    const other = this.clashForButton(action, button);
    if (other && this.locked(other, 'pad')) return { ok: false, reason: 'locked', other };
    if (other && !swap) return { ok: false, reason: 'clash', other };
    const old = this.pad[action];
    this.pad[action] = button;
    if (other) {
      delete this.pad[other];
      if (old !== undefined && !this.clashForButton(other, old)) this.pad[other] = old;
    }
    return { ok: true, swapped: other };
  }

  /** E22.4: removes an action's keys or button (never the fixed ones). */
  unbind(action: Action, kind: 'key' | 'pad'): BindResult {
    if (this.locked(action, kind)) return { ok: false, reason: 'locked' };
    if (kind === 'key') this.keys[action] = [];
    else delete this.pad[action];
    return { ok: true };
  }

  /** Before E22.4's checks: binds and swaps without asking (the old screen's behaviour; tools use it). */
  setKey(action: Action, code: string) {
    this.bindKey(action, code, true);
  }

  setButton(action: Action, button: number) {
    this.bindButton(action, button, true);
  }

  /** Only what differs from the defaults is saved. */
  save(): SavedBindings {
    const dk = defaultKeys();
    const dp = defaultPad();
    const keys: Partial<Record<Action, string[]>> = {};
    for (const [a, k] of Object.entries(this.keys)) if (k.join() !== dk[a as Action].join()) keys[a as Action] = [...k];
    const pad: Partial<Record<Action, number | null>> = {};
    for (const a of ACTIONS) {
      const b = this.pad[a.id];
      if (b !== dp[a.id]) pad[a.id] = b ?? null;
    }
    return { v: BINDINGS_VERSION, keys, pad };
  }

  /** Every input claimed by two actions that can apply at the same time (empty for a sane map). */
  conflicts(): string[] {
    const out: string[] = [];
    for (let i = 0; i < ACTIONS.length; i++)
      for (let j = i + 1; j < ACTIONS.length; j++) {
        const a = ACTIONS[i];
        const b = ACTIONS[j];
        if (!contextsMeet(a.context, b.context)) continue;
        for (const c of this.keys[a.id]) if (c !== FIXED_KEY && this.keys[b.id].includes(c)) out.push(`${c}: ${a.id} and ${b.id}`);
        const pa = this.pad[a.id];
        if (pa !== undefined && pa === this.pad[b.id]) out.push(`pad ${pa}: ${a.id} and ${b.id}`);
      }
    return out;
  }
}
