import { LIGHT_PRESETS, type LightPresetName } from '../data/sky';
import type { Game } from './Game';

/**
 * P7-E27.7 (#725): a small lighting panel for the dev server only (DevTools loads it behind `import.meta.env.DEV`, so
 * it never ships). One slider per knob of the single lighting configuration (`look.cfg` = data/look.ts and
 * `look.sky` / `look.haze` / `look.day` = data/sky.ts), applied live through `look.apply()`, plus the three named
 * presets (#724). Nothing here is saved: reload to get the built values back. `sbDev.light()` toggles it.
 */
interface Knob {
  label: string;
  min: number;
  max: number;
  step: number;
  get: (g: Game) => number;
  set: (g: Game, v: number) => void;
}

const L = (g: Game) => g.look.cfg;
const KNOBS: Knob[] = [
  { label: 'exposure', min: 0.6, max: 1.6, step: 0.01, get: (g) => L(g).exposure, set: (g, v) => (L(g).exposure = v) },
  { label: 'sun intensity', min: 0.5, max: 4, step: 0.05, get: (g) => L(g).sun.intensity, set: (g, v) => (L(g).sun.intensity = v) },
  { label: 'sun noon elevation °', min: 20, max: 70, step: 1, get: (g) => g.look.day.sunHigh, set: (g, v) => (g.look.day.sunHigh = v) },
  { label: 'fill intensity', min: 0, max: 1.5, step: 0.01, get: (g) => L(g).fill.intensity, set: (g, v) => (L(g).fill.intensity = v) },
  { label: 'ambient (env)', min: 0, max: 1.5, step: 0.01, get: (g) => L(g).env.intensity, set: (g, v) => (L(g).env.intensity = v) },
  { label: 'rim', min: 0, max: 3, step: 0.05, get: (g) => L(g).rim.intensity, set: (g, v) => (L(g).rim.intensity = v) },
  { label: 'grade contrast', min: 0.8, max: 1.3, step: 0.01, get: (g) => L(g).grade.warm.contrast, set: (g, v) => (L(g).grade.warm.contrast = v) },
  { label: 'grade saturation', min: 0.6, max: 1.4, step: 0.01, get: (g) => L(g).grade.warm.saturation, set: (g, v) => (L(g).grade.warm.saturation = v) },
  { label: 'grade highlights', min: -0.5, max: 0.3, step: 0.01, get: (g) => L(g).grade.warm.highlights, set: (g, v) => (L(g).grade.warm.highlights = v) },
  { label: 'bloom', min: 0, max: 0.6, step: 0.01, get: (g) => L(g).bloom.intensity, set: (g, v) => (L(g).bloom.intensity = v) },
  { label: 'ssao', min: 0, max: 3, step: 0.05, get: (g) => L(g).ssao.intensity, set: (g, v) => (L(g).ssao.intensity = v) },
  { label: 'haze start (far)', min: 0, max: 40, step: 1, get: (g) => g.look.haze.start[0], set: (g, v) => (g.look.haze.start[0] = v) },
  { label: 'haze end (far)', min: 30, max: 160, step: 1, get: (g) => g.look.haze.end[0], set: (g, v) => (g.look.haze.end[0] = v) },
  { label: 'horizon haze', min: 0, max: 1, step: 0.01, get: (g) => L(g).horizon.strength, set: (g, v) => (L(g).horizon.strength = v) },
  { label: 'hedge height', min: 0.6, max: 1.6, step: 0.05, get: (g) => L(g).hedgeLine.height, set: (g, v) => (L(g).hedgeLine.height = v) },
];

/** Jumps the clock to a preset's moment (the same way the fixed-camera shots do) with the weather held sunny. */
export function goToPreset(game: Game, name: LightPresetName) {
  const s = game.sim;
  const f = LIGHT_PRESETS[name].f;
  s.weather.forceForTest('sunny', 1e9);
  (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
}

export function toggleLightPanel(game: Game): string {
  const old = document.getElementById('sb-light-panel');
  if (old) return void old.remove(), 'lighting panel hidden';
  const p = document.createElement('div');
  p.id = 'sb-light-panel';
  p.style.cssText = 'position:fixed;top:8px;right:8px;z-index:9999;width:280px;max-height:calc(100vh - 16px);overflow:auto;padding:8px 10px;background:rgba(20,24,30,.88);color:#eef;font:12px/1.3 system-ui,sans-serif;border-radius:8px';
  const title = document.createElement('div');
  title.textContent = 'Lighting (dev only, not saved)';
  title.style.cssText = 'font-weight:600;margin-bottom:6px';
  p.appendChild(title);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap';
  for (const [name, preset] of Object.entries(LIGHT_PRESETS) as [LightPresetName, (typeof LIGHT_PRESETS)[LightPresetName]][]) {
    const b = document.createElement('button');
    b.textContent = preset.label;
    b.onclick = () => goToPreset(game, name);
    row.appendChild(b);
  }
  p.appendChild(row);
  for (const k of KNOBS) {
    const label = document.createElement('label');
    label.style.cssText = 'display:block;margin:4px 0';
    const text = document.createElement('span');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(k.min);
    input.max = String(k.max);
    input.step = String(k.step);
    input.value = String(k.get(game));
    input.style.cssText = 'width:100%';
    const show = () => (text.textContent = `${k.label}: ${(+input.value).toFixed(2)}`);
    show();
    input.oninput = () => {
      k.set(game, +input.value);
      show();
      game.look.apply();
      if (k.label.startsWith('hedge')) game.hedgeLine.sync();
    };
    label.append(text, input);
    p.appendChild(label);
  }
  document.body.appendChild(p);
  return 'lighting panel shown (sbDev.light() again to close)';
}
