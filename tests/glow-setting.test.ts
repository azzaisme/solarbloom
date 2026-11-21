// #633: Settings › Display › Glow scales bloom's strength: Off, Soft, Normal (the shipped look) and Strong.
import { describe, expect, it } from 'vitest';
import { GLOW_STEPS, glowIntensity, LOOK } from '../src/data/look';
import { settingsRows } from '../src/ui/SettingsRows';

describe('#633: the Glow setting', () => {
  it('Normal is the look the game shipped with, by day and by deep night', () => {
    const B = LOOK.bloom;
    expect(glowIntensity(true, 0, 1)).toBeCloseTo(B.intensity);
    expect(glowIntensity(true, 1, 1)).toBeCloseTo(B.intensity * B.night);
    expect(glowIntensity(true, 0.5)).toBeCloseTo(glowIntensity(true, 0.5, 1)); // unset is Normal
  });

  it('each step scales it, Off turns it off, and a tier without bloom stays off', () => {
    const values = GLOW_STEPS.map(([v]) => Number(v));
    expect(GLOW_STEPS.map(([, l]) => l)).toEqual(['Off', 'Soft', 'Normal', 'Strong']);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    for (const night of [0, 0.5, 1]) {
      const at = values.map((g) => glowIntensity(true, night, g));
      expect(at[0]).toBe(0);
      for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1]);
      for (const g of values) expect(glowIntensity(false, night, g)).toBe(0);
    }
  });

  it('at Soft, lamps by night still glow at least as much as at Normal by day', () => {
    expect(glowIntensity(true, 1, 0.5)).toBeGreaterThanOrEqual(glowIntensity(true, 0, 1) - 1e-9);
  });

  it('is a stepper on the Display tab, Normal by default, and says when the graphics tier draws no glow', () => {
    const row = (glowOff?: boolean) => settingsRows('display', { inGame: true, debug: false, glowOff }).find((r) => r.kind === 'select' && r.key === 'glow');
    const r = row();
    expect(r).toMatchObject({ kind: 'select', label: 'Glow', fallback: '1', numeric: true });
    expect(r && 'options' in r ? r.options.map(([v]) => v) : []).toEqual(GLOW_STEPS.map(([v]) => v));
    expect(r && 'hint' in r ? r.hint : '').not.toMatch(/set to Low/);
    const off = row(true);
    expect(off && 'hint' in off ? off.hint : '').toMatch(/Graphics is set to Low, so lights don't shine/);
    // "bloom" means flowers here: the row never says it
    expect(JSON.stringify(row(true)) + JSON.stringify(row())).not.toMatch(/bloom/i);
  });
});
