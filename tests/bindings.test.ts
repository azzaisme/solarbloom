import { describe, expect, it } from 'vitest';
import { ACTIONS, type Action, BINDINGS_VERSION, Bindings, defaultKeys, defaultPad, keyLabel, migrateBindings, padLabel, SLOTS } from '../src/app/Bindings';

/**
 * E22.1 (#338): every default from the epic's table (docs/E22_CONTROLS_UI.md, "The new map"), on both devices,
 * under both rule sets, and the one-time reset of bindings saved before it.
 */
const keys = (b: Bindings, a: Action) => b.keys[a];
/** The epic's table, keyboard and mouse column. */
const KEYS: [Action, string[]][] = [
  ['up', ['KeyW', 'ArrowUp']],
  ['down', ['KeyS', 'ArrowDown']],
  ['left', ['KeyA', 'ArrowLeft']],
  ['right', ['KeyD', 'ArrowRight']],
  ['sprint', ['ShiftLeft', 'ShiftRight']],
  ['look', ['Mouse2']],
  ['zoomCamera', ['Wheel']],
  ['recentre', ['KeyC']],
  ['interact', ['KeyE']],
  ['pulse', ['Mouse0', 'Space']],
  ['buildMenu', ['KeyQ']],
  ['rotate', ['KeyR', 'Wheel']],
  ['removeMode', ['KeyX']],
  ['powerOverlay', ['KeyO']], // E23.3.4
  ['backpack', ['Tab', 'KeyI']],
  ['map', ['KeyM']],
  ['pinNext', ['KeyG']],
  ['cancel', ['Escape']],
  ['menu', ['Escape']],
  ['photo', ['KeyP']],
  ['prevTab', ['KeyQ']],
  ['nextTab', ['KeyE']],
  ['debug', ['F3']],
];
/** The gamepad column (standard mapping). */
const PAD: [Action, number | undefined][] = [
  ['sprint', 6], // left trigger, held
  ['sprintToggle', 10], // click the left stick
  ['zoomCamera', 13], // d-pad down cycles
  ['recentre', 11], // click the right stick
  ['interact', 0], // A
  ['pulse', 2], // X
  ['place', 0], // A also places in build mode
  ['buildMenu', 3], // Y
  ['rotateBack', 4], // LB
  ['rotate', 5], // RB
  ['removeMode', 7], // right trigger
  ['powerOverlay', 15], // E23.3.4: d-pad right in build mode
  ['backpack', 12], // d-pad up
  ['map', 8], // View
  ['cancel', 1], // B
  ['menu', 9], // Menu
  ['prevTab', 4],
  ['nextTab', 5],
  ['photo', undefined], // in the pause menu
];

describe('E22.1: the new button map', () => {
  {
    it('matches every keyboard and mouse default in the epic', () => {
      const b = new Bindings();
      for (const [a, k] of KEYS) expect(keys(b, a), a).toEqual(k);
      for (let i = 0; i < 9; i++) expect(keys(b, SLOTS[i])).toEqual([`Digit${i + 1}`]);
      // E23.2.1: F eats a snack (bloombot's charge); E23.1.4: Harvest Sunlight is gone, not just unbound
      expect(keys(b, 'eat')).toEqual(['KeyF']);
      expect(ACTIONS.map((a) => a.id) as string[]).not.toContain('harvest');
      expect(b.actionForCode('KeyF')).toBe('eat');
      expect([keys(b, 'loadPrev'), keys(b, 'loadNext')]).toEqual([['KeyZ'], ['KeyV']]); // E23.2.2: the load wheel
    });

  it('a saved pad binding for an action that no longer exists is ignored (E23.1.2: Bloom Frenzy)', () => {
    const b = new Bindings({ pad: { frenzy: 7 } as never });
    expect(b.actionForButton(7, ['build', 'world', 'any'])).toBe('removeMode');
    expect(Object.keys(b.pad)).not.toContain('frenzy');
  });

  it('a saved Harvest binding is ignored: F and d-pad left eat (E23.1.4)', () => {
    const b = new Bindings({ v: BINDINGS_VERSION, keys: { harvest: ['KeyH'] } as never, pad: { harvest: 14 } as never });
    expect(b.actionForCode('KeyH')).toBeUndefined();
    expect(Object.keys(b.keys)).not.toContain('harvest');
    expect(Object.keys(b.pad)).not.toContain('harvest');
    expect(b.actionForCode('KeyF')).toBe('eat');
    expect(b.actionForButton(14)).toBe('eat');
    expect(b.conflicts()).toEqual([]);
  });

    it('matches every gamepad default in the epic', () => {
      const b = new Bindings();
      for (const [a, p] of PAD) expect(b.pad[a], a).toBe(p);
      for (const s of SLOTS) expect(b.pad[s]).toBeUndefined(); // the pad uses the build menu
      expect(b.pad.pinNext).toBe(15); // d-pad right
      expect(b.pad.eat).toBe(14); // d-pad left eats (E23.2.1)
      expect(b.actionForButton(14)).toBe('eat');
      expect(Object.keys(b.pad)).not.toContain('harvest');
      expect([b.pad.loadPrev, b.pad.loadNext]).toEqual([4, 5]); // E23.2.2: the bumpers turn the load wheel
    });

    it('gives no two actions that can apply together the same input', () => {
      expect(new Bindings().conflicts()).toEqual([]);
    });
  }

  it('Interact is E and A, Pulse is the left mouse button and X', () => {
    const b = new Bindings();
    expect(b.actionForCode('KeyE')).toBe('interact');
    expect(b.actionForCode('Mouse0')).toBe('pulse');
    expect(b.actionForCode('Space')).toBe('pulse');
    expect(b.actionForButton(0)).toBe('interact');
    expect(b.actionForButton(2)).toBe('pulse');
  });

  it('reads the same input by context: build mode first, then walking; panels have their own', () => {
    const b = new Bindings();
    expect(b.actionForCode('Wheel', ['world', 'any'])).toBe('zoomCamera');
    expect(b.actionForCode('Wheel', ['build', 'world', 'any'])).toBe('rotate'); // the wheel turns the piece
    expect(b.actionForButton(0, ['build', 'world', 'any'])).toBe('place');
    expect(b.actionForButton(7, ['build', 'world', 'any'])).toBe('removeMode');
    expect(b.actionForCode('KeyQ', ['panel', 'any'])).toBe('prevTab');
    // E23.3.4: the Power view is O and d-pad right in build mode; walking, d-pad right still pins the next request
    expect(b.actionForCode('KeyO', ['build', 'world', 'any'])).toBe('powerOverlay');
    expect(b.actionForButton(15, ['build', 'world', 'any'])).toBe('powerOverlay');
    expect(b.actionForButton(15, ['world', 'any'])).toBe('pinNext');
    expect(b.actionForCode('KeyE', ['panel', 'any'])).toBe('nextTab');
    expect(b.actionForButton(5, ['panel', 'any'])).toBe('nextTab');
  });

  it('E23.1.1: one map; the classic-only actions (next area, back to the park) are gone', () => {
    const ids = ACTIONS.map((a) => a.id) as string[];
    for (const a of ['nextArea', 'home', 'upgrades']) expect(ids, a).not.toContain(a);
    // a saved binding for one of them is ignored
    const b = new Bindings({ v: BINDINGS_VERSION, keys: { nextArea: ['KeyN'] } as never, pad: { home: 15 } as never });
    expect(b.actionForCode('KeyN')).toBeUndefined();
    expect(b.pad.pinNext).toBe(15);
  });

  it('lists every action on the rebinding screen, and every default is an action', () => {
    expect(ACTIONS.map((a) => a.id).sort()).toEqual(Object.keys(defaultKeys()).sort());
    for (const a of Object.keys(defaultPad())) expect(ACTIONS.some((d) => d.id === a)).toBe(true);
  });

  it('names keys, mouse inputs and pad buttons in plain words', () => {
    expect(['KeyE', 'Mouse0', 'Mouse2', 'Wheel', 'Escape', 'ShiftLeft', 'Space'].map(keyLabel)).toEqual(['E', 'Left mouse', 'Right mouse', 'Mouse wheel', 'Esc', 'Shift', 'Space']);
    expect([0, 3, 7, 8, 9, 11, 12].map(padLabel)).toEqual(['A', 'Y', 'RT', 'View', 'Menu', 'Right stick click', 'D-pad up']);
  });

  it('keeps a rebound key through a reload (the saved settings round trip)', () => {
    const b = new Bindings();
    b.setKey('eat', 'KeyH');
    b.setButton('backpack', 15);
    b.unbind('sprintToggle', 'pad');
    const saved = JSON.parse(JSON.stringify(b.save()));
    expect(saved.v).toBe(BINDINGS_VERSION);
    const reloaded = new Bindings(migrateBindings(saved).saved);
    expect(reloaded.actionForCode('KeyH')).toBe('eat');
    expect(reloaded.actionForButton(15)).toBe('backpack');
    expect(reloaded.pad.sprintToggle).toBeUndefined();
    expect(reloaded.conflicts()).toEqual([]);
  });

  it('the hotbar slots are ordinary actions: the number row can be rebound', () => {
    const b = new Bindings();
    expect(b.actionForCode('KeyJ')).toBeUndefined(); // a free key (Z turns the load wheel since E23.2.2)
    expect(b.bindKey('slot3', 'KeyJ')).toEqual({ ok: true, swapped: undefined });
    expect(b.actionForCode('KeyJ')).toBe('slot3');
    expect(b.actionForCode('Digit3')).toBeUndefined();
  });

  it('resets bindings saved before the new map once, and says so', () => {
    const old = { keys: { pulse: ['KeyQ'] }, pad: { pulse: 2 } }; // no version: saved before E22
    const m = migrateBindings(old as never);
    expect(m.reset).toBe(true);
    const b = new Bindings(m.saved);
    expect(b.keys.pulse).toEqual(['Mouse0', 'Space']);
    // Saved again, it carries the version and is not reset a second time.
    const again = migrateBindings(JSON.parse(JSON.stringify(b.save())));
    expect(again.reset).toBe(false);
    // Nothing customised before: nothing to reset, no notice.
    expect(migrateBindings(undefined).reset).toBe(false);
    expect(migrateBindings({ keys: {}, pad: {} }).reset).toBe(false);
  });
});
