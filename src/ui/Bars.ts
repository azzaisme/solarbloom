import { type Big, fmt, toNum } from '../core/Big';
import { KINDS } from '../core/Economy';
import type { ResourceKind } from '../core/types';
import { TUNING } from '../data/tuning';
import { ICONS } from './Icons';
import { $, HudPart } from './HudPart';
import { hudWidth, toHud } from './UiScale';
import { RESOURCE_NAME } from './words';

export const RES_META: Record<ResourceKind, { icon: string; name: string; color: string }> = {
  energy: { icon: ICONS.energy, name: 'Energy', color: 'var(--energy-bar)' },
  water: { icon: ICONS.water, name: 'Water', color: 'var(--water-bar)' },
  biomass: { icon: ICONS.biomass, name: 'Biomass', color: 'var(--biomass-bar)' },
};

/**
 * E22.5 (#342): the energy and water bars (top right). Under classic rules all three resources with their
 * figures and net rates (tap one for where its numbers come from); under old-city rules two small gauges, icon
 * and bar, that fade out when full and unchanged (E22.10). Biomass is not on the walking view there.
 */
export class Bars extends HudPart {
  static template(): string {
    return KINDS.map(
      (k) => `<div class="res-row panel" data-res="${k}" title="${RES_META[k].name}">
        <span class="ic" aria-hidden="true">${ICONS[k]}</span>
        <span class="nm">${RES_META[k].name}</span>
        <span class="val"><span class="n">0</span> <small class="capw">/ <span class="c">0</span></small></span>
        <span class="rate">+0/s</span>
        <span class="bar"><i style="background:${RES_META[k].color}"></i></span>
      </div>`,
    ).join('');
  }

  /** E22.10: when each gauge last changed, and its last value (gauges fade out when full and unchanged) */
  private gaugeAt: Record<string, { v: number; at: number }> = {};

  wire() {
    const r = this.root;
    // Phase 5 E12: tap a resource for where its numbers come from (tap again, or elsewhere, to close).
    $(r, '#res').addEventListener('click', (e) => {
      if (this.hud.oldCity) return; // E22.10: numbers live in panels under old-city rules
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-res]');
      const k = row?.dataset.res as ResourceKind | undefined;
      this.resInfo = k && this.resInfo !== k ? k : undefined;
      const box = $(r, '#resInfo');
      box.hidden = !this.resInfo;
      if (this.resInfo) {
        this.last.delete('resInfo');
        const rect = row!.getBoundingClientRect();
        box.style.top = `${Math.round(toHud(rect.bottom) + 6)}px`;
        box.style.left = `${Math.round(Math.max(8, Math.min(hudWidth() - 248, toHud(rect.left))))}px`;
        box.innerHTML = this.resourceBreakdown(this.resInfo);
      }
    });
    // Any tap outside the resource strip closes it (it never sits over the game).
    document.addEventListener('pointerdown', (e) => {
      if (!this.resInfo || (e.target as HTMLElement).closest?.('#res')) return;
      this.resInfo = undefined;
      $(r, '#resInfo').hidden = true;
    });
  }

  /** Spending totals sampled about once a second of sim time (Phase 4 E01.2). */
  /** Phase 5 E12: the resource whose breakdown popover is open (tap a resource cell). */
  private resInfo?: ResourceKind;

  /** Where a resource's numbers come from right now (popover and tooltip). */
  private resourceBreakdown(k: ResourceKind, plain = false): string {
    const s = this.sim;
    const pm = (x: Big) => `${fmt(x.mul(60), 1)}/min`;
    const c = s.econ.cap(k);
    const lines: [string, string][] = [['Producing', pm(s.production.rates()[k])]];
    lines.push(['Stored', c ? `${fmt(s.econ.get(k))} / ${fmt(c)}` : `${fmt(s.econ.get(k))} (no limit)`]);
    if (plain) return `${RES_META[k].name}: ${lines.map(([a, b]) => `${a} ${b}`).join(' · ')}`;
    return `<b>${RES_META[k].icon} ${RES_META[k].name}</b>${lines.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('')}`;
  }

  resourceRect(kind: ResourceKind): DOMRect {
    return $(this.root, `[data-res="${kind}"] .ic`).getBoundingClientRect();
  }

  private flashedAt = new Map<string, number>();
  private prevRes = new Map<ResourceKind, number>();

  flashResource(kind: ResourceKind, cls: 'flash' | 'short' | 'bump') {
    // Restarting the animation forces a layout: at most a few times a second per counter (big chains call
    // this hundreds of times).
    const now = performance.now();
    const key = `${kind}|${cls}`;
    if (now - (this.flashedAt.get(key) ?? -1e9) < 180) return;
    this.flashedAt.set(key, now);
    const el = $(this.root, `[data-res="${kind}"]`);
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  update() {
    const s = this.sim;
    const rates = s.production.rates();
    const surge = s.production.surgeActive();
    for (const k of KINDS) {
      const row = $(this.root, `[data-res="${k}"]`);
      const v = s.econ.get(k);
      const c = s.econ.cap(k);
      // Look 5.4: a big gain at once (a harvest, a chain payout, a cat reward) bumps the pill.
      const vn = toNum(v);
      const prev = this.prevRes.get(k);
      this.prevRes.set(k, vn);
      if (prev !== undefined && vn - prev > Math.max(1, 0.15 * (c ? toNum(c) : Math.max(prev, 10)))) this.flashResource(k, 'bump');
      this.set(`v-${k}`, $(row, '.n'), 'text', fmt(v));
      this.set(`c-${k}`, $(row, '.c'), 'text', c ? fmt(c) : '');
      this.set(`cw-${k}`, $(row, '.capw'), 'cls', c ? '0' : '1', 'nocap');
      const full = s.econ.isFull(k);
      const net = rates[k].mul(60);
      const boost = k === 'energy' && surge ? ` ☀️×${TUNING.cat.frenzyMult}` : '';
      const sign = net.lt(0) ? '−' : '+';
      const rateTxt = `${sign}${fmt(net.abs(), 1)}/min`; // "· full" comes from the .full class
      this.set(`r-${k}`, $(row, '.rate'), 'html', `${rateTxt}${boost}`);
      this.set(`t-${k}`, row, 'title', this.settings.showNumbers && !this.hud.oldCity ? this.resourceBreakdown(k, true) : this.hud.oldCity ? RESOURCE_NAME[k] : RES_META[k].name);
      this.set(`b-${k}`, $(row, '.bar i'), 'width', c ? `${Math.round(Math.min(1, toNum(v) / Math.max(1e-9, toNum(c))) * 100)}%` : '100%');
      this.set(`f-${k}`, row, 'cls', full ? '1' : '0', 'full');
    }
    if (this.resInfo) this.set('resInfo', $(this.root, '#resInfo'), 'html', this.resourceBreakdown(this.resInfo));
    if (this.hud.oldCity) this.updateGauges();
  }

  /**
   * E22.10: under old-city rules energy and water are two small gauges that fade out when full and unchanged for
   * 5 s and come back when they change or drop under a quarter.
   */
  private updateGauges() {
    const now = performance.now();
    for (const k of ['energy', 'water'] as const) {
      const row = $(this.root, `[data-res="${k}"]`);
      const v = toNum(this.sim.econ.get(k));
      const c = this.sim.econ.cap(k);
      const frac = c ? v / Math.max(1e-9, toNum(c)) : 1;
      const g = (this.gaugeAt[k] ??= { v, at: now });
      if (Math.abs(v - g.v) > 0.05) Object.assign(g, { v, at: now });
      const faded = this.sim.econ.isFull(k) && now - g.at > 5000 && frac >= 0.25;
      this.set(`fade-${k}`, row, 'cls', faded ? '1' : '0', 'faded');
      this.set(`low-${k}`, row, 'cls', frac < 0.25 ? '1' : '0', 'low');
      this.set(`nm-${k}`, $(row, '.nm'), 'text', RESOURCE_NAME[k]);
    }
  }
}
