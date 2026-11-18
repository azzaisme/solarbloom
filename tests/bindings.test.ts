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
  ['backpack', 12], // d-pad up
  ['map', 8], // View
  ['cancel', 1], // B
  ['menu', 9], // Menu
  ['prevTab', 4],
  ['nextTab', 5],
  ['photo', undefined], // in the pause menu
];

describe('E22.1: the new button map', () => {
  for (const oldCity of [false, true]) {
    const rules = oldCity ? 'old-city rules' : 'classic rules';
    it(`matches every keyboard and mouse default in the epic (${rules})`, () => {
      const b = new Bindings(undefined, { oldCity });
      for (const [a, k] of KEYS) expect(keys(b, a), a).toEqual(k);
      for (let i = 0; i < 9; i++) expect(keys(b, SLOTS[i])).toEqual([`Digit${i + 1}`]);
      // E23.2.1: F harvests sunlight under classic rules and eats a snack (bloombot's charge) under old-city rules
      expect([keys(b, 'harvest'), keys(b, 'eat')]).toEqual(oldCity ? [[], ['KeyF']] : [['KeyF'], []]);
      expect([keys(b, 'loadPrev'), keys(b, 'loadNext')]).toEqual(oldCity ? [['KeyZ'], ['KeyV']] : [[], []]);
    });

  it('a saved pad binding for an action that no longer exists is ignored (E23.1.2: Bloom Frenzy)', () => {
    const b = new Bindings({ pad: { frenzy: 7 } as never });
    expect(b.actionForButton(7, ['build', 'world', 'any'])).toBe('removeMode');
    expect(Object.keys(b.pad)).not.toContain('frenzy');
  });

    it(`matches every gamepad default in the epic (${rules})`, () => {
      const b = new Bindings(undefined, { oldCity });
      for (const [a, p] of PAD) expect(b.pad[a], a).toBe(p);
      for (const s of SLOTS) expect(b.pad[s]).toBeUndefined(); // the pad uses the build menu
      expect(b.pad.pinNext).toBe(oldCity ? 15 : undefined); // d-pad right
      expect([b.pad.harvest, b.pad.eat]).toEqual(oldCity ? [undefined, 14] : [14, undefined]); // d-pad left
      expect([b.pad.loadPrev, b.pad.loadNext]).toEqual(oldCity ? [4, 5] : [undefined, undefined]); // E23.2.2: the bumpers
    });

    it(`gives no two actions that can apply together the same input (${rules})`, () => {
      expect(new Bindings(undefined, { oldCity }).conflicts()).toEqual([]);
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
    expect(b.actionForCode('KeyE', ['panel', 'any'])).toBe('nextTab');
    expect(b.actionForButton(5, ['panel', 'any'])).toBe('nextTab');
  });

  it('next area keeps its key under classic rules and loses it under old-city rules', () => {
    const classic = new Bindings();
    expect(classic.label('nextArea')).toBe('N');
    const old = new Bindings(undefined, { oldCity: true });
    for (const a of ['nextArea', 'home'] as Action[]) {
      expect(old.keys[a], a).toEqual([]);
      expect(old.pad[a], a).toBeUndefined();
    }
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
    b.setKey('harvest', 'KeyH');
    b.setButton('backpack', 15);
    b.unbind('sprintToggle', 'pad');
    const saved = JSON.parse(JSON.stringify(b.save()));
    expect(saved.v).toBe(BINDINGS_VERSION);
    const reloaded = new Bindings(migrateBindings(saved).saved);
    expect(reloaded.actionForCode('KeyH')).toBe('harvest');
    expect(reloaded.actionForButton(15)).toBe('backpack');
    expect(reloaded.pad.sprintToggle).toBeUndefined();
    expect(reloaded.conflicts()).toEqual([]);
  });

  it('the hotbar slots are ordinary actions: the number row can be rebound', () => {
    const b = new Bindings();
    expect(b.bindKey('slot3', 'KeyZ')).toEqual({ ok: true, swapped: undefined });
    expect(b.actionForCode('KeyZ')).toBe('slot3');
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
