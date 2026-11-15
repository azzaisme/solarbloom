import { GROUND, machinesStamp } from '../core/GameState';
import type { MachineData, TileData } from '../core/types';
import type { Sim } from './Sim';

/** A canal network: connected clean (restored) water tiles and the condensers and Reservoir Gardens on their banks. */
export interface Canal {
  /** water tile ids in the network */
  tiles: Set<string>;
  gardens: MachineData[];
  condensers: MachineData[];
}

const MAX_TILES = 20000; // safety cap on one network's size

/**
 * City 10.3: the canal water network. Restored water tiles ("clean water") carry flow along the canals; a
 * Water Condenser or Reservoir Garden whose footprint touches one (8 neighbours) is on that network. Networks are
 * found lazily by flood fill from a machine's bank and cached until a water tile changes or a machine is
 * built or removed, so a tick never sweeps the world.
 */
export class CanalNetwork {
  private byTile = new Map<string, Canal>();
  private machineCount = -1;

  constructor(private sim: Sim) {
    sim.grid.touchListeners.push((t) => {
      if (t.feature === 'water' && this.byTile.size) this.byTile.clear();
    });
  }

  private fresh() {
    const n = machinesStamp(this.sim.state.machines);
    if (n !== this.machineCount) {
      this.machineCount = n;
      this.byTile.clear();
    }
  }

  static isChannel(t: TileData | undefined): t is TileData {
    return !!t && t.roofId === GROUND && t.feature === 'water' && t.ground === 'restored';
  }

  /** Clean water tiles touching a machine's footprint (its bank). */
  bank(m: MachineData): TileData[] {
    if (m.roofId !== GROUND) return [];
    const out: TileData[] = [];
    const g = this.sim.grid;
    for (let z = m.z - 1; z <= m.z + m.size; z++)
      for (let x = m.x - 1; x <= m.x + m.size; x++) {
        const t = g.get(GROUND, x, z);
        if (CanalNetwork.isChannel(t)) out.push(t);
      }
    return out;
  }

  /** The network a machine is on, if any. */
  of(m: MachineData): Canal | undefined {
    if (m.roofId !== GROUND || (m.type !== 'condenser' && m.type !== 'reservoirGarden')) return undefined;
    this.fresh();
    const bank = this.bank(m);
    for (const t of bank) {
      const hit = this.byTile.get(t.id);
      if (hit) return hit;
    }
    return bank.length ? this.flood(bank[0]) : undefined;
  }

  private flood(start: TileData): Canal {
    const g = this.sim.grid;
    const tiles = new Set<string>([start.id]);
    const stack = [start];
    while (stack.length && tiles.size < MAX_TILES) {
      const t = stack.pop()!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = g.get(GROUND, t.x + dx, t.z + dz);
        if (!CanalNetwork.isChannel(n) || tiles.has(n.id)) continue;
        tiles.add(n.id);
        stack.push(n);
      }
    }
    const canal: Canal = { tiles, gardens: [], condensers: [] };
    for (const m of this.sim.state.machines) {
      if (m.roofId !== GROUND || (m.type !== 'condenser' && m.type !== 'reservoirGarden')) continue;
      if (!this.bank(m).some((t) => tiles.has(t.id))) continue;
      (m.type === 'condenser' ? canal.condensers : canal.gardens).push(m);
    }
    const byId = (a: MachineData, b: MachineData) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    canal.gardens.sort(byId);
    canal.condensers.sort(byId);
    for (const id of tiles) this.byTile.set(id, canal);
    return canal;
  }

  /** Are two machines on the same network? */
  connected(a: MachineData, b: MachineData): boolean {
    const n = this.of(a);
    return !!n && n === this.of(b);
  }

  /** Water path along the canal from one machine's bank to another's (tile ids, in order), or [] if unconnected. */
  path(from: MachineData, to: MachineData): string[] {
    const net = this.of(from);
    if (!net || net !== this.of(to)) return [];
    const g = this.sim.grid;
    const goal = new Set(this.bank(to).map((t) => t.id));
    const prev = new Map<string, string | null>();
    const queue: TileData[] = [];
    for (const t of this.bank(from)) {
      prev.set(t.id, null);
      queue.push(t);
    }
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i];
      if (goal.has(t.id)) {
        const out: string[] = [];
        for (let id: string | null = t.id; id; id = prev.get(id) ?? null) out.push(id);
        return out.reverse();
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = g.get(GROUND, t.x + dx, t.z + dz);
        if (!n || !net.tiles.has(n.id) || prev.has(n.id)) continue;
        prev.set(n.id, t.id);
        queue.push(n);
      }
    }
    return [];
  }
}
