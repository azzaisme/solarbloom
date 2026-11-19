import type { BinState, MachineData } from '../core/types';
import { COMPOST, DIGESTER } from '../data/compost';
import { DAY_SECONDS } from '../data/time';
import { machineStrengthAt } from '../core/RegionStrengths';
import type { Sim } from './Sim';

export type DigesterMood = 'running' | 'idle' | 'empty';

/**
 * E23.5.3 (#388): the end of the farm chain. A compost bin takes biomass and food scraps and rots them down into
 * compost over game days; compost left in the bin matures into fertiliser. A full bin just waits for bloombot.
 * The Bio Digester is a source on E23.3's grid (`sim.power`): it turns biomass into power, day or night, while fed.
 * It burns only while its grid wants power (a draw, or a battery with room); off any grid it waits, fed, and an empty
 * one just stops (nothing breaks). Old-city rules only. State lives in `salvage.bins` / `salvage.digesters`.
 */
export class CompostSystem {
  private registered = false;

  /** E23.6.2: compost research reads this before it offers 'compostSpeed' (the bins exist, so it is ready). */
  get researchReady(): boolean {
    return true;
  }

  constructor(private sim: Sim) {
    sim.bus.on('machine.removed', ({ machine }) => this.forget(machine));
  }

  get on(): boolean {
    return !!this.sim.state.salvage;
  }

  // ───────────── compost bins ─────────────

  bin(m: MachineData | string): BinState {
    const id = typeof m === 'string' ? m : m.id;
    return this.sim.state.salvage?.bins?.[id] ?? {};
  }

  private writeBin(m: MachineData, st: BinState) {
    const sv = this.sim.state.salvage!;
    const clean = Object.fromEntries(Object.entries(st).filter(([, v]) => v)) as BinState;
    for (const k of Object.keys(clean) as (keyof BinState)[]) clean[k] = Math.round(clean[k]! * 1e6) / 1e6;
    if (Object.keys(clean).length) (sv.bins ??= {})[m.id] = clean;
    else if (sv.bins) delete sv.bins[m.id];
  }

  /** Room left for feed (in feed units). */
  room(m: MachineData): number {
    return Math.max(0, COMPOST.feedCapacity - (this.bin(m).feed ?? 0));
  }

  /** Puts biomass or food from the backpack into a bin, as much as fits (food counts richer). Returns items put in. */
  fill(m: MachineData, item: 'biomass' | 'food'): number {
    const worth = item === 'food' ? COMPOST.foodWorth : 1;
    const n = Math.min(this.sim.inventory.count(item), Math.floor(this.room(m) / worth + 1e-9));
    if (n <= 0) {
      this.sim.bus.emit('action.failed', { reason: this.room(m) < worth ? 'The bin is full' : `No ${item === 'food' ? 'Food' : 'Biomass'} to put in` });
      return 0;
    }
    this.sim.inventory.take(item, n);
    const st = this.bin(m);
    this.writeBin(m, { ...st, feed: (st.feed ?? 0) + n * worth });
    this.sim.bus.emit('farm.machine', { machineId: m.id });
    return n;
  }

  /** Takes what the bin has made (fertiliser, or compost) into the backpack. Returns units taken. */
  take(m: MachineData, item: 'compost' | 'fertiliser'): number {
    const st = this.bin(m);
    const have = Math.floor(st[item] ?? 0);
    const n = have - this.sim.inventory.add(item, have);
    if (n <= 0) return 0;
    this.writeBin(m, { ...st, [item]: (st[item] ?? 0) - n, ripen: item === 'compost' && st.compost === n ? 0 : st.ripen });
    this.sim.bus.emit('farm.machine', { machineId: m.id });
    return n;
  }

  /** Puts compost carried back into a bin to mature (as much as fits). */
  returnCompost(m: MachineData): number {
    const st = this.bin(m);
    const space = COMPOST.outputCapacity - (st.compost ?? 0) - (st.fertiliser ?? 0);
    const n = Math.min(space, this.sim.inventory.count('compost'));
    if (n <= 0) return 0;
    this.sim.inventory.take('compost', n);
    this.writeBin(m, { ...st, compost: (st.compost ?? 0) + n });
    this.sim.bus.emit('farm.machine', { machineId: m.id });
    return n;
  }

  /** E23.5.4.4: worm bins next door speed a bin up (twice as fast). Returns the speed multiplier. */
  speed(m: MachineData): number {
    const sim = this.sim as unknown as { farmExtras?: { compostSpeed?(m: MachineData): number }; research?: { effect(id: string): number } };
    // E23.6.2: compost research ('compostSpeed') speeds every bin
    const research = 1 + (sim.research?.effect('compostSpeed') ?? 0);
    return (sim.farmExtras?.compostSpeed?.(m) ?? 1) * research;
  }

  private tickBin(m: MachineData, days: number) {
    const st = { ...this.bin(m) };
    let changed = false;
    const full = () => (st.compost ?? 0) + (st.fertiliser ?? 0) >= COMPOST.outputCapacity;
    // rotting down: feed → compost
    if ((st.feed ?? 0) >= COMPOST.perCompost - 1e-9 && !full()) {
      st.work = (st.work ?? 0) + days * this.speed(m);
      while ((st.work ?? 0) >= COMPOST.compostDays && (st.feed ?? 0) >= COMPOST.perCompost - 1e-9 && !full()) {
        st.work! -= COMPOST.compostDays;
        st.feed! -= COMPOST.perCompost;
        st.compost = (st.compost ?? 0) + 1;
        changed = true;
      }
      if ((st.feed ?? 0) < COMPOST.perCompost - 1e-9) st.work = 0;
    }
    // maturing: the oldest compost becomes fertiliser
    if ((st.compost ?? 0) >= 1) {
      st.ripen = (st.ripen ?? 0) + days * this.speed(m);
      while ((st.ripen ?? 0) >= COMPOST.matureDays && (st.compost ?? 0) >= 1) {
        st.ripen! -= COMPOST.matureDays;
        st.compost! -= 1;
        st.fertiliser = (st.fertiliser ?? 0) + 1;
        changed = true;
      }
      if ((st.compost ?? 0) < 1) st.ripen = 0;
    }
    this.writeBin(m, st);
    if (changed) this.sim.bus.emit('farm.machine', { machineId: m.id });
  }

  // ───────────── the Bio Digester ─────────────

  fuel(m: MachineData): number {
    return this.sim.state.salvage?.digesters?.[m.id] ?? 0;
  }

  private setFuel(m: MachineData, f: number) {
    const sv = this.sim.state.salvage!;
    if (f > 1e-9) (sv.digesters ??= {})[m.id] = Math.round(f * 1e6) / 1e6;
    else if (sv.digesters) delete sv.digesters[m.id];
  }

  /** Feeds a digester biomass from the backpack, up to its hopper. Returns units put in. */
  feed(m: MachineData): number {
    const n = Math.min(this.sim.inventory.count('biomass'), Math.floor(DIGESTER.capacity - this.fuel(m) + 1e-9));
    if (n <= 0) {
      this.sim.bus.emit('action.failed', { reason: this.fuel(m) >= DIGESTER.capacity - 1e-9 ? 'The hopper is full' : 'No Biomass to feed it' });
      return 0;
    }
    this.sim.inventory.take('biomass', n);
    this.setFuel(m, this.fuel(m) + n);
    this.sim.bus.emit('farm.machine', { machineId: m.id });
    return n;
  }

  /** Does the digester's grid want power right now (something drawing, or a battery with room)? */
  private wanted(m: MachineData): boolean {
    const net = this.sim.power.networkOf(m);
    return !!net && (net.demand > 1e-9 || net.stored < net.capacity - 1e-9);
  }

  /** Running (burning, powering its grid), idle (fed, nothing wants power) or empty (stopped). */
  mood(m: MachineData): DigesterMood {
    if (this.fuel(m) <= 1e-9) return 'empty';
    return this.wanted(m) ? 'running' : 'idle';
  }

  /**
   * What it supplies to the grid this moment (E23.3 watts): its output while fed, nothing when empty. E23.8.1: a
   * digester in a machinery region (Clock Plaza) runs at that region's strength (1.5×).
   */
  output(m: MachineData): number {
    return this.fuel(m) > 1e-9 ? DIGESTER.output * machineStrengthAt('bioDigester', m.x, m.z) : 0;
  }

  private tickDigester(m: MachineData, days: number) {
    const f = this.fuel(m);
    if (f <= 1e-9 || !this.wanted(m)) return;
    const after = Math.max(0, f - DIGESTER.burnPerDay * days);
    this.setFuel(m, after);
    if (after <= 1e-9) this.sim.bus.emit('farm.machine', { machineId: m.id });
  }

  // ───────────── per step ─────────────

  tick(dt: number) {
    if (!this.on) return;
    // registered on the first tick (the grid is built after the farm systems)
    if (!this.registered) {
      this.sim.power.register('bioDigester', { source: (m) => this.output(m as MachineData) });
      this.registered = true;
    }
    const days = dt / DAY_SECONDS;
    for (const m of this.sim.machinesOfType('compostBin')) this.tickBin(m, days);
    for (const m of this.sim.machinesOfType('bioDigester')) this.tickDigester(m, days);
  }

  /** A removed bin or digester hands back what was inside (to the backpack, overflow to the store). */
  private forget(m: MachineData) {
    const sv = this.sim.state.salvage;
    if (!sv) return;
    const inv = this.sim.inventory;
    if (m.type === 'compostBin' && sv.bins?.[m.id]) {
      const st = sv.bins[m.id];
      for (const k of ['compost', 'fertiliser'] as const) if ((st[k] ?? 0) >= 1) inv.addToStore(k, inv.add(k, Math.floor(st[k]!)));
      if ((st.feed ?? 0) >= 1) inv.addToStore('biomass', inv.add('biomass', Math.floor(st.feed!)));
      delete sv.bins[m.id];
    }
    if (m.type === 'bioDigester' && sv.digesters?.[m.id]) {
      const f = Math.floor(sv.digesters[m.id]);
      if (f > 0) inv.addToStore('biomass', inv.add('biomass', f));
      delete sv.digesters[m.id];
    }
  }
}
