import { describe, expect, it } from 'vitest';
import { Bindings, defaultKeys, defaultPad } from '../src/app/Bindings';
import { bindMessage } from '../src/ui/ControlsTable';

/** E22.4 (#341): rebind everything. */
describe('E22.4: rebinding', () => {
  it('binds a key, a mouse button, the wheel and a pad button', () => {
    const b = new Bindings();
    expect(b.bindKey('eat', 'KeyH')).toEqual({ ok: true, swapped: undefined });
    expect(b.bindKey('photo', 'Mouse4').ok).toBe(true);
    expect(b.bindKey('recentre', 'Mouse1').ok).toBe(true);
    expect(b.actionForCode('Mouse4')).toBe('photo');
    expect(b.bindButton('photo', 13).ok).toBe(false); // d-pad down is Zoom camera: a clash, not a silent steal
    // every pad button has a job by default (d-pad right pins the next request): free one, then bind it
    expect(b.bindButton('backpack', 15)).toEqual({ ok: false, reason: 'clash', other: 'pinNext' });
    expect(b.unbind('pinNext', 'pad').ok).toBe(true);
    expect(b.bindButton('backpack', 15).ok).toBe(true);
    expect(b.conflicts()).toEqual([]);
  });

  it('refuses a clash and names the other action, then swaps when asked', () => {
    const b = new Bindings();
    const r = b.bindKey('interact', 'ShiftLeft');
    expect(r).toEqual({ ok: false, reason: 'clash', other: 'sprint' });
    expect(bindMessage(r, 'interact')).toBe('Swap with Hover (sprint, hold)?');
    expect(b.keys.interact).toEqual(['KeyE']); // nothing changed yet
    const s = b.bindKey('interact', 'ShiftLeft', true);
    expect(s).toEqual({ ok: true, swapped: 'sprint' });
    expect(b.actionForCode('ShiftLeft')).toBe('interact');
    expect(b.actionForCode('KeyE')).toBe('sprint'); // the swap: sprint took Interact's old key
    expect(b.conflicts()).toEqual([]);
    // Pad: A for Pulse swaps with Interact.
    expect(b.bindButton('pulse', 0)).toEqual({ ok: false, reason: 'clash', other: 'interact' });
    expect(b.bindButton('pulse', 0, true)).toEqual({ ok: true, swapped: 'interact' });
    expect([b.pad.pulse, b.pad.interact]).toEqual([0, 2]);
    expect(b.conflicts()).toEqual([]);
  });

  it('inputs used in different contexts never clash (Q is the build menu walking and a tab key in panels)', () => {
    const b = new Bindings();
    expect(b.bindKey('prevTab', 'KeyQ').ok).toBe(true);
    expect(b.bindKey('rotate', 'KeyE').ok).toBe(true); // build mode only, beside Interact while walking
  });

  it('refuses to move or unbind Esc and the pause menu', () => {
    const b = new Bindings();
    expect(b.unbind('menu', 'key')).toEqual({ ok: false, reason: 'locked' });
    expect(b.unbind('menu', 'pad')).toEqual({ ok: false, reason: 'locked' });
    expect(b.unbind('cancel', 'key')).toEqual({ ok: false, reason: 'locked' });
    expect(b.bindKey('menu', 'KeyP').ok).toBe(false);
    expect(b.bindKey('interact', 'Escape')).toEqual({ ok: false, reason: 'locked' });
    expect(b.bindButton('interact', 9)).toEqual({ ok: false, reason: 'locked', other: 'menu' });
    expect(b.bindButton('interact', 9, true).ok).toBe(false); // not even by swapping
    expect([b.keys.menu, b.pad.menu]).toEqual([['Escape'], 9]);
    // Everything else can be cleared.
    expect(b.unbind('eat', 'key').ok).toBe(true);
    expect(b.keys.eat).toEqual([]);
  });

  it('resets each column to the defaults on its own', () => {
    const b = new Bindings();
    b.bindKey('eat', 'KeyH', true);
    b.bindButton('eat', 15, true);
    b.reset('keys');
    expect(b.keys).toEqual(defaultKeys());
    expect(b.pad.eat).toBe(15); // the pad column keeps its change
    b.reset('pad');
    expect(b.pad).toEqual(defaultPad());
  });
});

