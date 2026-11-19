import { LOAD_WHEEL, PULSE_LOADS } from '../data/pulse';
import { $, HudPart, esc } from './HudPart';
import { iconize } from './Icons';

/**
 * E23.2.2.1 (#411): the pulse load wheel. Turning it (V / Z, or the bumpers) shows the four loads in a ring above
 * the prompt for a moment, the chosen one lit and any not carried dimmed (a pulse with it fires empty). The rest
 * of the time a small chip beside the charge shows the load, unless it is nothing. No counts: the backpack has those.
 */
export class LoadWheel extends HudPart {
  private wheel?: HTMLElement;
  private chip?: HTMLElement;
  private shown = 0;

  wire() {
    this.root.insertAdjacentHTML(
      'beforeend',
      iconize(`<div id="loadWheel" role="radiogroup" aria-label="Pulse load" hidden>${PULSE_LOADS.map(
        (l, i) => `<div class="lw-opt" role="radio" data-load="${l.id}" style="--i:${i}"><span class="lw-ic">${l.icon}</span><span class="lw-nm">${esc(l.name)}</span></div>`,
      ).join('')}</div>`),
    );
    $(this.root, '#res').insertAdjacentHTML('beforeend', `<div id="loadChip" class="panel" role="status" aria-label="Pulse load" hidden><span class="lc-ic"></span><span class="lc-nm"></span></div>`);
    this.wheel = $(this.root, '#loadWheel');
    this.chip = $(this.root, '#loadChip');
  }

  /** The wheel turned: show the ring for a moment (longer for its one-time introduction). */
  show(seconds: number = LOAD_WHEEL.showSeconds) {
    this.shown = Math.max(this.shown, seconds);
  }

  update(dt: number) {
    if (!this.wheel || !this.chip) return;
    const pl = this.sim.pulseLoad;
    const on = pl.on;
    this.shown = Math.max(0, this.shown - dt);
    const open = on && this.shown > 0;
    if (this.wheel.hidden === open) this.wheel.hidden = !open;
    const choice = pl.choice;
    const def = pl.def;
    if (open)
      for (const l of PULSE_LOADS) {
        const el = $(this.wheel, `[data-load="${l.id}"]`);
        this.set(`lw-on-${l.id}`, el, 'cls', l.id === choice ? '1' : '0', 'on');
        this.set(`lw-out-${l.id}`, el, 'cls', pl.carried(l) > 0 ? '0' : '1', 'out');
        if (this.last.get(`lw-aria-${l.id}`) !== String(l.id === choice)) {
          this.last.set(`lw-aria-${l.id}`, String(l.id === choice));
          el.setAttribute('aria-checked', String(l.id === choice));
        }
      }
    const chip = on && choice !== 'none';
    if (this.chip.hidden === chip) this.chip.hidden = !chip;
    if (!chip) return;
    this.set('lc-ic', $(this.chip, '.lc-ic'), 'text', def.icon);
    this.set('lc-nm', $(this.chip, '.lc-nm'), 'text', def.name);
    this.set('lc-out', this.chip, 'cls', pl.carried(def) > 0 ? '0' : '1', 'out');
  }
}
