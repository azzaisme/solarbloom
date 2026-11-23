import type { Sfx } from './Sfx';

/**
 * Phase 8 A02: an opt-in overlay (URL `?audiodebug`, or Shift+F9) with the live mix: buses, voices, the
 * limiter, the local soundscape stage and bed levels, the music's state and the last wildlife events. It is
 * also how the acceptance route is validated by log (window.__audio returns the same snapshot).
 */
export class AudioDebugHUD {
  private el?: HTMLDivElement;
  private t = 0;

  constructor(private readonly sfx: Sfx) {
    (window as unknown as { __audio?: () => unknown }).__audio = () => sfx.debug();
    if (new URLSearchParams(location.search).has('audiodebug')) this.toggle();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F9' && e.shiftKey) this.toggle();
    });
  }

  toggle() {
    if (this.el) {
      this.el.remove();
      this.el = undefined;
      return;
    }
    const el = document.createElement('div');
    el.id = 'audio-debug';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:9999;font:11px/1.35 ui-monospace,monospace;color:#dfffe8;background:rgba(8,20,14,.82);padding:8px 10px;border-radius:8px;pointer-events:none;white-space:pre;max-width:46ch';
    document.body.appendChild(el);
    this.el = el;
  }

  update(dt: number) {
    if (!this.el) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const d = this.sfx.debug();
    const pct = (x: number) => `${Math.round(x * 100)}`.padStart(3) + '%';
    const bar = (x: number) => '▮'.repeat(Math.round(Math.min(1, x / 0.35) * 10)).padEnd(10, '·');
    const lines = [
      `AUDIO  ${d.state}  voices ${d.voices}  out ${d.out.rms.toFixed(0)} dB rms  limiter ${d.reduction.toFixed(1)} dB${d.ducking ? '  DUCK' : ''}`,
      `buses  ${Object.entries(d.buses).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ')}`,
      `stage  ${d.stage}   life ${pct(d.area.life)}  veg ${pct(d.area.vegetation)}  canopy ${pct(d.area.canopy)}  water ${pct(d.area.water)}`,
      ...Object.entries(d.beds).map(([k, v]) => `  ${k.padEnd(7)} ${bar(v)} ${v.toFixed(3)}`),
      `  brook   ${bar(d.brook)} ${d.brook.toFixed(3)}`,
      `  sea     ${bar(d.sea)} ${d.sea.toFixed(3)}`,
      `music  ${d.music}  (open ${d.intensity.toFixed(2)})`,
      ...d.wildlife.map((w) => `  ${w}`),
      ...(d.missing.length ? [`missing ${d.missing.join(', ')}`] : []),
    ];
    this.el.textContent = lines.join('\n');
  }
}
