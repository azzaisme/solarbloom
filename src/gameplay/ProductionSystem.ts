import { distToFootprint } from '../core/Grid';
import type { TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

/**
 * What machines do on their own each tick, now that nothing earns a counter (E23.1.4: passive income stopped; the
 * grid, E23.3, and the water network, E23.4, carry what machines make). Pollinator Gardens mark their zones (chains
 * and the renderer read them), and Water Condensers fill and water the dry soil beside them.
 */
export class ProductionSystem {
  constructor(private sim: Sim) {}

  /** True if the tile lies inside any pollinator's zone. */
  inPollinatorZone(t: TileData): boolean {
    return this.gardenZoneMult(t) > 1;
  }

  /** The strongest garden multiplier over this tile (1 outside every zone; zones don't stack). */
  gardenZoneMult(t: TileData): number {
    // Phase 5 E12: each garden has its own reach (Pollinator Reach is bought per garden); E13: a Bloom Garden ×2.
    const u = this.sim.upgrades;
    let best = 1;
    for (const m of this.sim.grid.machinesNear(t.roofId, t.x, t.z, u.maxPollinatorReach))
      if (m.type === 'pollinator' && distToFootprint(t.x, t.z, m.x, m.z, m.size) <= u.pollinatorReach(m)) best = Math.max(best, u.gardenMult(m));
    return best;
  }

  tick(dt: number) {
    this.tickCondensers(dt);
  }

  /** Water Condensers fill a charge meter; when full they water the dry soil beside them (a chain). */
  private tickCondensers(dt: number) {
    const s = this.sim;
    const R = TUNING.neighbourhood.reservoir;
    const num = (id: string) => Number(id.slice(1)) || 0;
    for (const m of s.machinesOfType('condenser')) {
      if (m.project && m.project.stage < 3) continue; // Phase 5 E14: still being built
      const rate = TUNING.condenser.chargePerSec * (1 + 0.25 * s.upgrades.waterBloom(m)) * s.landmarks.condenserMult(); // Cistern Basin
      const was = m.charge ?? 0;
      m.charge = Math.min(TUNING.condenser.threshold, was + rate * dt);
      if (m.charge < TUNING.condenser.threshold) continue;
      // A full condenser waters the dry soil beside it, and/or tops up Reservoir Gardens in range.
      const near = s.fullScan ? s.state.machines : s.grid.machinesNear(m.roofId, m.x, m.z, R.condenserRange + 1);
      const gardens = near
        .filter((g) => g.type === 'reservoirGarden' && g.roofId === m.roofId && g.charge < R.threshold && distToFootprint(g.x, g.z, m.x, m.z, m.size) <= R.condenserRange)
        .sort((a, b) => num(a.id) - num(b.id)); // build order, whichever way they were found
      for (const g of gardens) {
        g.charge = Math.min(R.threshold, g.charge + R.fillPerCharge);
        s.bus.emit('reservoir.fill', { machineId: g.id, from: m.id });
      }
      if (s.chains.startWater(m) || gardens.length) m.charge = 0;
    }
    // Full Reservoir Gardens spill over when there is dry ground to irrigate.
    for (const g of s.machinesOfType('reservoirGarden')) if (g.charge >= R.threshold && !this.overflowing.has(g.id)) {
      if (s.chains.startOverflow(g)) this.overflowing.add(g.id);
    }
    if (this.overflowing.size) for (const id of [...this.overflowing]) if ((s.machine(id)?.charge ?? 0) < R.threshold) this.overflowing.delete(id);
  }

  /** Gardens whose Overflow chain is queued (so it doesn't start twice before it resolves). */
  private overflowing = new Set<string>();
}
