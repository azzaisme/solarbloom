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
  'chain.ended': { chainId: number; combo: number; bonus: number; total: number; milestonePct: number; energy: number };
  'tree.discharged': { machineId: string };
  'solar.boost': { machineId: string };
  'pulse.fired': { tileId: string; extra: string[]; overcharged: boolean };
  'action.failed': { reason: string; tileId?: string };
  'upgrade.purchased': { id: string; level: number };
  'drone.spawned': { droneId: string };
  'drone.despawned': { droneId: string };
  'drone.jobStarted': { droneId: string; tileId: string };
  'cat.spawned': { anchorId: string };
  'cat.found': { anchorId: string; reward: CatRewardType; summary: string };
  'buff.started': { type: BuffType; seconds: number };
  'harvest': { amount: number };
  'rooftop.coreReady': Record<string, never>;
  'rooftop.coreRestored': Record<string, never>;
  'tutorial.step': { step: number };
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
