import { describe, expect, it } from 'vitest';
import { ACTIONS, Bindings, DEFAULT_KEYS, DEFAULT_PAD } from '../src/app/Bindings';

describe('bloombot controls map (G.16)', () => {
  it('gives no two actions the same key or button by default', () => {
    expect(new Bindings().conflicts()).toEqual([]);
  });

  it('matches the agreed map (docs/BLOOMBOT_EPIC.md §7)', () => {
    const b = new Bindings();
    expect([b.label('pulse'), b.label('interact'), b.label('tray'), b.label('harvest'), b.label('upgrades'), b.label('backpack')]).toEqual(['E', 'Q', 'B', 'F', 'U', 'Tab']);
    expect([b.label('frenzy'), b.label('nextArea'), b.label('overview'), b.label('sprint')]).toEqual(['R', 'N', 'M', 'Shift']);
    expect([DEFAULT_PAD.pulse, DEFAULT_PAD.interact, DEFAULT_PAD.tray, DEFAULT_PAD.cancel, DEFAULT_PAD.sprint]).toEqual([0, 2, 3, 1, 7]);
    expect([DEFAULT_PAD.backpack, DEFAULT_PAD.harvest, DEFAULT_PAD.upgrades]).toEqual([12, 14, 15]);
    // Turning the view: C or a right stick click recentres it.
    expect([b.label('recentre'), DEFAULT_PAD.recentre]).toEqual(['C', 11]);
  });

  it('lists every action on the rebinding screen', () => {
    expect(ACTIONS.map((a) => a.id).sort()).toEqual(Object.keys(DEFAULT_KEYS).sort());
  });

  it('swaps keys instead of leaving one action unbound', () => {
    const b = new Bindings();
    b.setKey('pulse', 'KeyQ');
    expect(b.actionForCode('KeyQ')).toBe('pulse');
    expect(b.actionForCode('KeyE')).toBe('interact');
    expect(b.conflicts()).toEqual([]);
  });

  it('keeps a rebound key through a reload (the saved settings round trip)', () => {
    const b = new Bindings();
    b.setKey('harvest', 'KeyH');
    b.setButton('frenzy', 13);
    const reloaded = new Bindings(JSON.parse(JSON.stringify(b.save())));
    expect(reloaded.actionForCode('KeyH')).toBe('harvest');
    expect(reloaded.actionForButton(13)).toBe('frenzy');
    expect(reloaded.conflicts()).toEqual([]);
  });

  it('never rebinds the build slots on the number row', () => {
    const b = new Bindings();
    b.setKey('pulse', 'Digit5');
    expect(b.label('pulse')).toBe('E');
  });
});
