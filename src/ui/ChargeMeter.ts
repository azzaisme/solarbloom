import { $, HudPart } from './HudPart';

/** SVG battery with a bolt (inherits currentColor). */
const BATTERY = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="16" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="19.5" y="10" width="2" height="4" rx="1" fill="currentColor"/><path d="M12 8.6 8.6 12.6h2.8l-1 2.8 3.4-4h-2.8z" fill="currentColor"/></svg>`;

/**
 * E23.2.1 (#371): bloombot's charge, the only meter on screen (old-city rules). A pill at the top of the
 * resource strip: a battery, a bar and the charge as a percentage. Calm when full (it fades after a few seconds
 * unchanged), warm when low, and the bar dims to the low-power walk's grey at zero.
 */
export class ChargeMeter extends HudPart {
  private el?: HTMLElement;
  private lastV = -1;
  private still = 0;

  static template(): string {
    return `<div class="res-row panel charge-row" id="chargeRow" data-res="charge" role="meter" aria-label="Charge" aria-valuemin="0" aria-valuemax="100">
      <span class="ic" aria-hidden="true">${BATTERY}</span>
      <span class="nm">Charge</span>
      <span class="pct">100%</span>
      <span class="bar"><i></i></span>
    </div>`;
  }

  /** Puts the meter at the top of the resource strip (Hud.ts calls this once). */
  wire() {
    const res = $(this.root, '#res');
    res.insertAdjacentHTML('afterbegin', ChargeMeter.template());
    this.el = $(res, '#chargeRow');
  }

  update(dt: number) {
    const el = this.el;
    if (!el) return;
    const c = this.sim.charge;
    this.set('ch-on', el, 'cls', c.on ? '0' : '1', 'off');
    if (!c.on) return;
    const pct = Math.round(c.share * 100);
    this.set('ch-pct', $(el, '.pct'), 'text', `${pct}%`);
    this.set('ch-bar', $(el, '.bar i'), 'width', `${Math.max(0, Math.min(100, c.share * 100)).toFixed(1)}%`);
    this.set('ch-aria', el, 'title', `Charge ${pct}%`);
    if (this.last.get('ch-val') !== String(pct)) {
      this.last.set('ch-val', String(pct));
      el.setAttribute('aria-valuenow', String(pct));
    }
    this.set('ch-low', el, 'cls', c.low && !c.empty ? '1' : '0', 'low');
    this.set('ch-empty', el, 'cls', c.empty ? '1' : '0', 'empty');
    this.set('ch-eat', el, 'cls', c.eating ? '1' : '0', 'eating');
    // calm when full: fades out after 5 s unchanged, back the moment it changes
    const v = c.value();
    this.still = Math.abs(v - this.lastV) < 1e-6 ? this.still + dt : 0;
    this.lastV = v;
    this.set('ch-faded', el, 'cls', pct >= 100 && this.still > 5 ? '1' : '0', 'calm');
  }
}
