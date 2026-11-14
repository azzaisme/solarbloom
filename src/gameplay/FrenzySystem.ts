import type { ResourceKind } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

/**
 * Phase 4 E06: Bloom Frenzy. A 0–100 meter the player earns by restoring (taps count most), chains and storage
 * overflow. When full it waits, as long as it takes, until the player fires it: TUNING.frenzy.seconds of sim time
 * with a far-reaching pulse, much more biomass and faster drones. No charge while it is ready or running (never
 * a banked second one); offline time never charges it. The sim clock stops when paused, so does the timer.
 */
export class FrenzySystem {
  /** Overflow charge already granted this tick (capped per second). */
  private overflowThisTick = 0;
  /** True while offline progress is being credited: nothing charges the meter. */
  suspended = false;

  constructor(private sim: Sim) {
    const b = sim.bus;
    const F = TUNING.frenzy.charge;
    b.on('pulse.fired', ({ tileId, extra }) => {
      const t = sim.grid.byTileId(tileId);
      // A restore tap (the tile is now growing) counts more than a nurture tap; Wide/Radiant reach adds a little.
      const restore = t && t.ground !== 'restored';
      this.add(restore ? F.restoreTap + Math.min(F.footprintMax, extra.length * F.perFootprintTile) : F.nurtureTap);
    });
    b.on('tile.restored', ({ source }) => {
      if (source !== 'pulse' && source !== 'broad') this.add(F.autoRestore);
    });
    b.on('chain.ended', ({ combo }) => {
      if (combo >= 2) this.add(Math.min(F.chainMax, (combo - 1) * F.perChainStep));
    });
  }

  /** Read-only view (never adds the field to the save just by looking). */
  private get st(): { charge: number; until?: number; count?: number } {
    return this.sim.state.frenzy ?? { charge: 0 };
  }

  /** The saved meter, created on first change. */
  private get mut() {
    return (this.sim.state.frenzy ??= { charge: 0 });
  }

  get charge(): number {
    return this.st.charge;
  }

  active(): boolean {
    const u = this.st.until;
    return u !== undefined && this.sim.time < u;
  }

  ready(): boolean {
    return !this.active() && this.st.charge >= 100 - 1e-9;
  }

  /** Seconds of Frenzy left (0 when not running). */
  remaining(): number {
    return this.active() ? this.st.until! - this.sim.time : 0;
  }

  add(amount: number) {
    if (!(amount > 0) || this.suspended || this.active()) return;
    const st = this.mut;
    if (st.charge >= 100) return;
    st.charge = Math.min(100, st.charge + amount);
    if (st.charge >= 100) this.sim.bus.emit('frenzy.ready', {});
  }

  /** Income lost to a full store feeds the meter, a little, capped per second (E01.5). */
  onOverflow(kind: ResourceKind, amount: number) {
    const O = TUNING.frenzy.overflow;
    const cap = O.maxPerSecond * TUNING.simStep - this.overflowThisTick;
    if (cap <= 0) return;
    const got = Math.min(cap, amount * O.perUnit[kind]);
    this.overflowThisTick += got;
    this.add(got);
  }

  /** Fires the Frenzy. False (and nothing happens) unless the meter is full and none is running. */
  activate(): boolean {
    if (!this.ready()) {
      this.sim.bus.emit('action.failed', { reason: this.active() ? 'Bloom Frenzy is already running' : `Bloom Frenzy is charging (${Math.floor(this.st.charge)}%)` });
      return false;
    }
    const st = this.mut;
    st.charge = 0;
    st.until = this.sim.time + TUNING.frenzy.seconds;
    st.count = (st.count ?? 0) + 1;
    this.sim.production.markDirty();
    this.sim.bus.emit('frenzy.started', { seconds: TUNING.frenzy.seconds });
    return true;
  }

  tick() {
    this.overflowThisTick = 0;
    const st = this.sim.state.frenzy;
    if (st?.until !== undefined && this.sim.time >= st.until) {
      st.until = undefined;
      this.sim.production.markDirty();
      this.sim.bus.emit('frenzy.ended', {});
    }
  }
}
