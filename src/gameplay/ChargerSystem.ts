import type { MachineData } from '../core/types';
import { POWER } from '../data/power';
import type { Sim } from './Sim';

/**
 * E23.3.3: chargers. A Charger is a pad on the grid. While bloombot stands on a powered one it meditates and
 * refills fast (E23.2.1's `sim.charge.recharge`, at `CHARGE.meditatePerSecond`). The pad draws from the grid only while it is charging, and it is the last
 * thing a short grid sheds. E23.2.3's sit-and-meditate pose reads `docked()`.
 */
export class ChargerSystem {
  constructor(private sim: Sim) {
    sim.power.register('charger', { consumer: { shed: 'charger', draw: (m) => (this.charging(m as MachineData) ? POWER.draw.charger : 0) } });
  }

  /** Bloombot is full. */
  private full(): boolean {
    const c = this.sim.charge;
    return c.value() >= c.max - 1e-6;
  }

  /**
   * The charger bloombot is sitting at, if any: standing on its tile or right beside it (a machine's tile can't be
   * walked onto, so bloombot sits at the pad's edge). The nearest pad wins.
   */
  docked(): MachineData | undefined {
    const b = this.sim.bot;
    if (!b) return undefined;
    let best: MachineData | undefined;
    let bestD = Infinity;
    for (const m of this.sim.machinesOfType('charger')) {
      if (m.roofId !== b.roofId) continue;
      // distance from bloombot to the pad's footprint (0 inside it)
      const dx = Math.max(m.x - b.x, 0, b.x - (m.x + m.size));
      const dz = Math.max(m.z - b.z, 0, b.z - (m.z + m.size));
      const d = Math.hypot(dx, dz);
      if (d <= POWER.charger.reach + 1e-9 && d < bestD) {
        best = m;
        bestD = d;
      }
    }
    return best;
  }

  /** Is this charger topping bloombot up (docked, and not yet full)? */
  charging(m: MachineData): boolean {
    return this.docked() === m && !this.full();
  }

  tick(dt: number): void {
    const m = this.docked();
    if (!m || this.full() || !this.sim.power.isPowered(m)) return;
    this.sim.charge.recharge(POWER.charger.rate * dt, 'charger');
  }
}
