import { GROUND } from '../core/GameState';
import type { AreaMap } from '../core/Areas';
import type { LayerData, MachineData, TileData } from '../core/types';
import { ROOF_TEMPLATES } from '../data/templates';
import type { Sim } from './Sim';

/**
 * City 12.1: rooftop clusters. A rooftop-cluster area carries a raised roof laid out like one of the old
 * campaign's rooftops (the Seed, the Reservoir or the Canopy, with their dead-ground looks), whose Core is the
 * area's landmark. The roof is added to the world when the area is revealed; it can be seen but not played
 * until a Bloom Relay on playable ground comes within range of it ("reached by relays"). Saved with the layers.
 */
export class RooftopClusters {
  constructor(private sim: Sim) {
    sim.bus.on('machine.built', ({ machine }) => {
      if (machine.type === 'relay') this.checkReach();
    });
    sim.bus.on('upgrade.granted', ({ id }) => {
      if (id === 'relayLens') this.checkReach();
    });
  }

  static layerId(areaId: string): string {
    return `roof:${areaId}`;
  }

  /** The roof layer of a cluster area, if it has been revealed. */
  roof(areaId: string): LayerData | undefined {
    return this.sim.grid.layer(RooftopClusters.layerId(areaId));
  }

  /** Adds an area's roof to the world (idempotent). Returns undefined for areas that aren't clusters. */
  ensure(areaId: string, map: AreaMap = this.sim.areas.map): LayerData | undefined {
    const s = this.sim;
    const plan = map.rooftop(areaId);
    if (!plan) return undefined;
    const id = RooftopClusters.layerId(areaId);
    const had = s.grid.layer(id);
    if (had) return had;
    const def = ROOF_TEMPLATES[plan.template];
    const layer: LayerData = {
      id,
      name: def?.name ?? 'Rooftop',
      kind: 'raised',
      width: plan.width,
      depth: plan.depth,
      height: plan.height,
      origin: [plan.x, 0, plan.z],
      unlocked: false,
      preview: true,
      template: plan.template,
      cluster: areaId,
    };
    s.state.layers.push(layer);
    s.grid.addLayer(layer);
    s.grid.tilesOf(id); // a roof is small: generate it now
    s.bus.emit('layer.added', { layerId: id });
    this.checkReach();
    return layer;
  }

  /** Distance from a relay to the nearest point of a roof, in world tiles. */
  private reach(m: MachineData, roof: LayerData): number {
    const [mx, mz] = this.sim.relays.centre(m);
    const dx = Math.max(roof.origin[0] - mx, 0, mx - (roof.origin[0] + roof.width));
    const dz = Math.max(roof.origin[2] - mz, 0, mz - (roof.origin[2] + roof.depth));
    return Math.hypot(dx, dz);
  }

  /** Can a relay reach this roof right now? */
  reachable(roof: LayerData): boolean {
    return this.sim.machinesOfType('relay').some((m) => m.roofId !== roof.id && this.sim.grid.isPlayable(m.roofId) && this.reach(m, roof) <= this.sim.relays.range(m));
  }

  /** Unlocks every roof a relay now reaches (a newly reached roof can reach further roofs in turn). */
  checkReach() {
    const s = this.sim;
    for (let changed = true; changed; ) {
      changed = false;
      for (const roof of s.grid.clusterRoofs) {
        if (roof.unlocked && !roof.preview) continue;
        if (!this.reachable(roof)) continue;
        roof.unlocked = true;
        roof.preview = false;
        changed = true;
        s.bus.emit('layer.unlocked', { layerId: roof.id });
      }
    }
  }

  /** Restored / restorable tiles on an area's roof. */
  counts(areaId: string): { restored: number; restorable: number } {
    const roof = this.roof(areaId);
    if (!roof) return { restored: 0, restorable: 0 };
    let restored = 0;
    let restorable = 0;
    for (const t of this.sim.grid.tilesOf(roof.id)) {
      if (t.blocked || this.sim.isCoreTile(t)) continue;
      restorable++;
      if (t.ground === 'restored') restored++;
    }
    return { restored, restorable };
  }

  /** Ground tiles from which a relay would reach the roof (any area), nearest the roof first, for the advisor. */
  relaySpots(areaId: string): TileData[] {
    const roof = this.roof(areaId);
    if (!roof) return [];
    const R = this.sim.relays.range() - 0.75;
    const cx = Math.floor(roof.origin[0] + roof.width / 2);
    const cz = Math.floor(roof.origin[2] + roof.depth / 2);
    const gap = (t: TileData) => {
      const dx = Math.max(roof.origin[0] - (t.x + 0.5), 0, t.x + 0.5 - (roof.origin[0] + roof.width));
      const dz = Math.max(roof.origin[2] - (t.z + 0.5), 0, t.z + 0.5 - (roof.origin[2] + roof.depth));
      return Math.hypot(dx, dz);
    };
    return this.sim.grid
      .tilesWithin(GROUND, cx, cz, Math.ceil(R + Math.max(roof.width, roof.depth)))
      .filter((t) => !t.blocked && gap(t) <= R)
      .sort((a, b) => gap(a) - gap(b) || a.z - b.z || a.x - b.x);
  }
}
