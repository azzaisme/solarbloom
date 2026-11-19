import { describe, expect, it } from 'vitest';
import { ACTIONS, Bindings, defaultKeys } from '../src/app/Bindings';
import { actionGlyph, GlyphTracker, keyGlyph, PAD_NAMES, padGlyph, padStyleFromId, type GlyphStyle, type PadStyle } from '../src/ui/Glyphs';

/** E22.3 (#340): glyphs that follow the device. */
const STYLES: GlyphStyle[] = ['keys', 'xbox', 'ps', 'deck'];
const PADS: PadStyle[] = ['xbox', 'ps', 'deck'];
const box = (svg: string) => /viewBox="0 0 (\d+) (\d+)"/.exec(svg)?.slice(1).map(Number);
const label = (svg: string) => /aria-label="([^"]+)"/.exec(svg)?.[1];

describe('E22.3: glyphs', () => {
  it("renders every action's glyph in all four sets, none missing", () => {
    {
      const b = new Bindings();
      for (const style of STYLES)
        for (const a of ACTIONS) {
          const bound = style === 'keys' ? b.keys[a.id].length > 0 : b.pad[a.id] !== undefined;
          if (!bound) continue;
          const g = actionGlyph(b, a.id, style);
          expect(g, `${a.id} in ${style}`).toMatch(/^<svg class="glyph/);
          expect(label(g), `${a.id} in ${style}`).toBeTruthy();
          expect(label(g), `${a.id} in ${style}`).not.toBe('Not bound');
        }
    }
  });

  it('draws every key and mouse input the defaults use, and every pad button in each family', () => {
    for (const codes of Object.values(defaultKeys())) for (const c of codes) expect(label(keyGlyph(c)), c).toBeTruthy();
    expect(label(keyGlyph('Mouse0'))).toBe('Left mouse button');
    expect(label(keyGlyph('Wheel'))).toBe('Mouse wheel');
    for (const s of PADS)
      for (let i = 0; i < 16; i++) {
        const g = padGlyph(s, i);
        expect(label(g), `${s} ${i}`).toBeTruthy();
        expect(label(g), `${s} ${i}`).not.toMatch(/^Button /);
      }
    expect(label(padGlyph('ps', 0))).toBe('Cross button');
    expect(label(padGlyph('xbox', 0))).toBe('A button');
    expect(label(padGlyph('deck', 4))).toBe('L1');
    expect(PAD_NAMES.ps[9]).toBe('Options');
  });

  it('every glyph has the same box, so swapping sets never shifts the prompt', () => {
    const sizes = new Set<string>();
    for (const c of ['KeyE', 'Space', 'ShiftLeft', 'Mouse0', 'Wheel', 'Escape', 'Tab']) sizes.add(String(box(keyGlyph(c))));
    for (const s of PADS) for (let i = 0; i < 16; i++) sizes.add(String(box(padGlyph(s, i))));
    expect([...sizes]).toEqual(['40,30']);
  });

  it('a rebound action shows its new input', () => {
    const b = new Bindings();
    b.setKey('interact', 'KeyF');
    b.setButton('interact', 3);
    expect(label(actionGlyph(b, 'interact', 'keys'))).toBe('F key');
    expect(label(actionGlyph(b, 'interact', 'xbox'))).toBe('Y button');
    expect(label(actionGlyph(b, 'interact', 'ps'))).toBe('Triangle button');
  });

  it('follows the last device and the pad family, or the setting', () => {
    expect(padStyleFromId('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(padStyleFromId('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('ps');
    expect(padStyleFromId('Steam Deck Controller (Vendor: 28de Product: 1205)')).toBe('deck');
    expect(padStyleFromId('virtual pad (STANDARD GAMEPAD)', true)).toBe('deck'); // the Deck build
    const t = new GlyphTracker();
    expect(t.style).toBe('keys');
    t.device = 'pad';
    t.sensePad([{ id: 'Wireless Controller (Vendor: 054c)', connected: true } as Gamepad]);
    expect(t.style).toBe('ps');
    t.setting = 'xbox';
    expect(t.style).toBe('xbox');
    t.device = 'keys';
    expect(t.style).toBe('keys'); // a pad set only shows while the pad is in use
    t.setting = 'keys';
    t.device = 'pad';
    expect(t.style).toBe('keys');
  });
});
