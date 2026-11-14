import type { ChainEvent } from '../gameplay/BloomChainSystem';
import type { BuffType, CatRewardType, MachineData, ResourceKind, RestoreSource, TileData } from '../core/types';

export interface GameEvents {
  'tile.restoring': { tile: TileData; source: RestoreSource };
  'tile.restored': { tile: TileData; source: RestoreSource; chainId: number; biomass: number };
  'tile.prepared': { tile: TileData };
  'tile.softened': { tile: TileData };
  'tile.nurtured': { tile: TileData; level: number };
  'resource.gain': { kind: ResourceKind; amount: number; tileId?: string; reason?: string };
  'resource.full': { kind: ResourceKind };
  'machine.built': { machine: MachineData };
  'chain.started': { chainId: number; originTileId: string };
  'chain.event': { event: ChainEvent; combo: number };
  'chain.fastForward': { chainId: number };
  'chain.ended': { chainId: number; combo: number; bonus: number; total: number; milestonePct: number; energy: number; roofs: string[]; crossings: number; areas: number; starter: 'player' | 'auto' };
  'mega.released': { tileId: string; budget: number };
  'mega.ready': Record<string, never>;
  'area.modeChanged': { areaId: string; mode: 'bloom' | 'frontier' | 'off' | undefined };
  'machine.boosted': { machineId: string };
  'machine.boostUsed': { machineId: string };
  'reservoir.overflow': { machineId: string; tiles: string[] };
  'reservoir.fill': { machineId: string; from: string };
  /** City 10.3: water travels along a canal (tile ids in order) from one machine to another. */
  'canal.flow': { from: string; to: string; path: string[]; kind: 'fill' | 'overflow'; chainId?: number };
  'canopy.burst': { machineId: string; radius: number; gardens: string[] };
  'relay.sent': { linkId: string; fromRoof: string; toRoof: string; chainId: number; travel: number };
  'tree.discharged': { machineId: string };
  'solar.boost': { machineId: string };
  'pulse.fired': { tileId: string; extra: string[]; overcharged: boolean };
  'action.failed': { reason: string; tileId?: string };
  'upgrade.purchased': { id: string; level: number };
  'drone.spawned': { droneId: string };
  'drone.despawned': { droneId: string };
  'drone.jobStarted': { droneId: string; tileId: string };
  'cat.spawned': { anchorId: string };
  'cat.found': { anchorId: string; reward: CatRewardType; summary: string; extras: number };
  'cat.stash': { stash: number };
  'cat.moved': { from: string; anchorId: string };
  'cat.goldenRelay': Record<string, never>;
  'buff.started': { type: BuffType; seconds: number };
  'harvest': { amount: number };
  'rooftop.coreReady': Record<string, never>;
  'rooftop.coreRestored': Record<string, never>;
  'tutorial.step': { step: number };
  'area.revealed': { areaId: string };
  'area.fogChanged': { areaId: string; fog: string };
  'area.ready': { areaId: string };
  'area.cleared': { areaId: string };
  'link.built': { linkId: string; roofId: string };
  'roof.coreAwake': { roofId: string };
  'district.ready': { districtId: string };
  'district.bloom': { districtId: string; restored: string[]; lusher: string[]; reward: Partial<Record<ResourceKind, number>>; replay: boolean };
  'neighbourhood.bloom': { restored: string[]; reward: Partial<Record<ResourceKind, number>> };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }
}
