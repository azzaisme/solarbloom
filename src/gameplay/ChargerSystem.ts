import type { MachineData } from '../core/types';
import { POWER } from '../data/power';
import type { Sim } from './Sim';

/** What a charger needs from bloombot's charge (E23.2.1, `sim.charge`); optional until that lands. */
interface ChargeLike {
  recharge?: (amount: number, source: string) => unknown;
  share?: number;
  value?: number;
  max?: number;
}

/**
 * E23.3.3: chargers. A Charger is a pad on the grid. While bloombot stands on a powered one it meditates and
 * refills fast (`sim.charge.recharge`). The pad draws from the grid only while it is charging, and it is the last
 * thing a short grid sheds. E23.2.3's sit-and-meditate pose reads `docked()`.
 */
export class ChargerSystem {
  constructor(private sim: Sim) {
    sim.power.register('charger', { consumer: { shed: 'charger', draw: (m) => (this.charging(m) ? POWER.draw.charger : 0) } });
  }

  private get charge(): ChargeLike | undefined {
    return (this.sim as unknown as { charge?: ChargeLike }).charge;
  }

  /** Bloombot is full (or has no charge meter yet). */
  private full(): boolean {
    const c = this.charge;
    if (!c) return true;
    if (typeof c.share === 'number') return c.share >= 1 - 1e-9;
    return typeof c.value === 'number' && typeof c.max === 'number' ? c.value >= c.max - 1e-9 : true;
  }

  /** The charger bloombot stands on, if any. */
  docked(): MachineData | undefined {
    const b = this.sim.bot;
    if (!b) return undefined;
    const x = Math.floor(b.x);
    const z = Math.floor(b.z);
    return this.sim.machinesOfType('charger').find((m) => m.roofId === b.roofId && x >= m.x && x < m.x + m.size && z >= m.z && z < m.z + m.size);
  }

  /** Is this charger topping bloombot up (docked, and not yet full)? */
  charging(m: MachineData): boolean {
    return this.docked() === m && !this.full();
  }

  tick(dt: number): void {
    const m = this.docked();
    if (!m || this.full() || !this.sim.power.isPowered(m)) return;
    this.charge?.recharge?.(POWER.charger.rate * dt, 'charger');
  }
}
