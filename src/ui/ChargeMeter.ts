import { CHARGE } from '../data/charge';
import { actionGlyph } from './Glyphs';
import { $, HudPart } from './HudPart';

/**
 * E23.2.1 (#371) / E23.11: bloombot's charge, the only meter on screen. A paper card top right
 * (docs/art/ui-sunlit-glass/Walk.dc.html): a sun badge with a battery, "Charge", the percentage and a sun bar. Calm
 * when full (it fades after a few seconds unchanged); low, it gets an amber ring, reads "Low · 18%", the bar turns
 * orange and, when something edible is carried, the Eat button's picture shows under it (WalkPad.dc.html). At zero
 * the badge goes grey.
 */
export class ChargeMeter extends HudPart {
  private el?: HTMLElement;
  private lastV = -1;
  private still = 0;
  private glyphAt = -1;

  static template(): string {
    return `<div class="sg-card charge-row" id="chargeRow" data-res="charge" role="meter" aria-label="Charge" aria-valuemin="0" aria-valuemax="100">
      <div class="ch-head">
        <span class="sg-badge sun sm" aria-hidden="true"><span class="sg-ic s i-cell"></span></span>
        <span class="nm">Charge</span>
        <span class="pct">100%</span>
      </div>
      <span class="sg-bar" aria-hidden="true"><i></i></span>
      <div class="ch-eat"><span class="ch-g"></span><span>Eat</span></div>
    </div>`;
  }

  /** Puts the meter at the top of the charge column (Hud.ts calls this once). */
  wire() {
    const res = $(this.root, '#res');
    res.insertAdjacentHTML('afterbegin', ChargeMeter.template());
    this.el = $(res, '#chargeRow');
  }

  update(dt: number) {
    const el = this.el;
    if (!el) return;
    const c = this.sim.charge;
    const pct = Math.round(c.share * 100);
    const low = c.low && !c.empty;
    this.set('ch-pct', $(el, '.pct'), 'text', low ? `Low · ${pct}%` : `${pct}%`);
    this.set('ch-bar', $(el, '.sg-bar i'), 'width', `${Math.max(0, Math.min(100, c.share * 100)).toFixed(1)}%`);
    this.set('ch-aria', el, 'title', `Charge ${pct}%`);
    if (this.last.get('ch-val') !== `${pct}${low}`) {
      this.last.set('ch-val', `${pct}${low}`);
      el.setAttribute('aria-valuenow', String(pct));
      el.setAttribute('aria-valuetext', low ? `Low, ${pct} percent` : `${pct} percent`);
    }
    this.set('ch-low', el, 'cls', low ? '1' : '0', 'low');
    this.set('ch-empty', el, 'cls', c.empty ? '1' : '0', 'empty');
    this.set('ch-eat', el, 'cls', c.eating ? '1' : '0', 'eating');
    // running low with something to eat: the Eat button's picture, in the set the player is using
    const canEat = (low || c.empty) && !c.eating && CHARGE.edibles.some((e) => c.carried(e.id) > 0);
    this.set('ch-caneat', el, 'cls', canEat ? '1' : '0', 'can-eat');
    if (canEat && this.glyphAt !== this.hud.keyMapVersion && this.hud.bindings) {
      this.glyphAt = this.hud.keyMapVersion;
      $(el, '.ch-g').innerHTML = actionGlyph(this.hud.bindings, 'eat', this.hud.glyphStyle);
    }
    // calm when full: fades after 5 s unchanged, back the moment it changes
    const v = c.value();
    this.still = Math.abs(v - this.lastV) < 1e-6 ? this.still + dt : 0;
    this.lastV = v;
    this.set('ch-faded', el, 'cls', pct >= 100 && this.still > 5 ? '1' : '0', 'calm');
  }
}
