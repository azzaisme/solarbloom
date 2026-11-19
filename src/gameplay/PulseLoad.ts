import { GROUND } from '../core/GameState';
import type { MaterialId, TileData } from '../core/types';
import { PARK_SET, REGIONS } from '../data/oldcity';
import { MATERIALS } from '../data/salvage';
import { PULSE_LOAD, PULSE_LOADS, RIPPLE, type PulseLoadDef, type PulseLoadId } from '../data/pulse';
import type { Sim } from './Sim';

/** Something the reveal ripple lights up for a few seconds. */
export interface RippleTarget {
  kind: 'salvage' | 'cache' | 'page' | 'buried';
  id: string;
  x: number;
  z: number;
}

/**
 * E23.2.2 (#372): what the pulse carries. A quick wheel picks the load (nothing, seeds, a rare seed,
 * fertiliser); each pulse uses one unit of it, and when it runs out the pulse fires empty, so you're never stuck.
 * Old-city rules only: under classic rules every pulse is empty and nothing is used.
 *
 * The reveal ripple (E23.2.2.3) lists nearby salvage, unopened caches, unfound journal pages and buried seeds and salvage. It reads only
 * the salvage data (piles, caches, pages) and never the Lucky Cat system: no cat is ever a target, and nothing
 * about the ripple changes where cats are (tests/pulse-load.test.ts proves both).
 */
export class PulseLoad {
  constructor(private sim: Sim) {}

  get on(): boolean {
    return this.sim.oldCity;
  }

  /** The load chosen on the wheel. */
  get choice(): PulseLoadId {
    return (this.on && this.sim.state.pulseLoad) || 'none';
  }

  get def(): PulseLoadDef {
    return PULSE_LOAD[this.choice];
  }

  choose(id: PulseLoadId) {
    if (!this.on || !PULSE_LOAD[id]) return;
    if (id === 'none') delete this.sim.state.pulseLoad;
    else this.sim.state.pulseLoad = id;
    this.sim.bus.emit('pulse.load', { load: id });
  }

  /** Turns the wheel one step (+1 / -1), skipping nothing: an empty load is still a choice (it fires empty). */
  step(dir: 1 | -1) {
    const i = PULSE_LOADS.findIndex((l) => l.id === this.choice);
    this.choose(PULSE_LOADS[(i + dir + PULSE_LOADS.length) % PULSE_LOADS.length].id);
  }

  /** Units of a load's item carried (the backpack; E23.5/E23.8 items read the same way once they exist). */
  carried(def: PulseLoadDef): number {
    if (!def.item) return Infinity;
    const pack = this.sim.state.salvage?.pack as Record<string, number | undefined> | undefined;
    return pack?.[def.item] ?? 0;
  }

  /**
   * The load wheel is a new idea, so it is introduced once: the first time bloombot carries anything it can load.
   * True while that introduction is still owed (`introduced()` marks it given).
   */
  introDue(): boolean {
    return this.on && this.sim.state.stats.firsts.loadWheel === undefined && PULSE_LOADS.some((l) => l.item && this.carried(l) > 0);
  }
  introduced() {
    this.sim.state.stats.firsts.loadWheel = Math.round(this.sim.time);
  }

  /** What the next pulse will carry: the chosen load if one is carried, else nothing. */
  next(): PulseLoadDef {
    const d = this.def;
    return this.carried(d) > 0 ? d : PULSE_LOAD.none;
  }

  /** A pulse fired: uses one unit of its load and returns what it carried (nothing when the load ran out). */
  take(): PulseLoadDef {
    const d = this.next();
    if (!d.item) return d;
    if (d.item in MATERIALS) this.sim.inventory.take(d.item as MaterialId, 1);
    else {
      const pack = this.sim.state.salvage!.pack as Record<string, number | undefined>;
      pack[d.item] = (pack[d.item] ?? 0) - 1;
      if (!pack[d.item]) delete pack[d.item];
      this.sim.bus.emit('pack.changed', {});
    }
    if (this.carried(d) <= 0) this.sim.bus.emit('pulse.loadEmpty', { load: d.id });
    return d;
  }

  /** Every target the reveal ripple from tile `t` lights up, nearest first (pure). */
  ripple(t: Pick<TileData, 'roofId' | 'x' | 'z'>): RippleTarget[] {
    const sv = this.sim.state.salvage;
    if (!this.on || !sv || t.roofId !== GROUND) return [];
    const r2 = RIPPLE.radius * RIPPLE.radius;
    const near = (x: number, z: number) => (x - t.x) ** 2 + (z - t.z) ** 2 <= r2;
    const out: RippleTarget[] = [];
    for (const p of [...PARK_SET.piles, ...REGIONS.flatMap((r) => r.piles)]) if (near(p.x, p.z) && this.sim.salvage.left(p.id) > 0) out.push({ kind: 'salvage', id: p.id, x: p.x, z: p.z });
    for (const c of REGIONS.flatMap((r) => r.caches)) if (near(c.x, c.z) && !sv.caches.includes(c.id)) out.push({ kind: 'cache', id: c.id, x: c.x, z: c.z });
    for (const p of [...PARK_SET.pages, ...REGIONS.flatMap((r) => r.pages)]) if (near(p.x, p.z) && !sv.pages.includes(p.id)) out.push({ kind: 'page', id: p.id, x: p.x, z: p.z });
    for (const b of this.sim.buried.near(t.x, t.z, RIPPLE.radius)) out.push({ kind: 'buried', id: b.id, x: b.x, z: b.z });
    return out.sort((a, b) => (a.x - t.x) ** 2 + (a.z - t.z) ** 2 - ((b.x - t.x) ** 2 + (b.z - t.z) ** 2) || a.id.localeCompare(b.id));
  }
}
