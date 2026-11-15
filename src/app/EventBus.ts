import type { Big } from '../core/Big';
import type { ChainEvent } from '../gameplay/BloomChainSystem';
import type { BuffType, CatRewardType, Cost, MachineData, ResourceKind, RestoreSource, TileData } from '../core/types';

export interface GameEvents {
  'tile.restoring': { tile: TileData; source: RestoreSource };
  'tile.restored': { tile: TileData; source: RestoreSource; chainId: number; biomass: Big };
  'tile.prepared': { tile: TileData };
  'tile.softened': { tile: TileData };
  'tile.nurtured': { tile: TileData; level: number; auto?: boolean };
  'resource.gain': { kind: ResourceKind; amount: Big; tileId?: string; reason?: string };
  'resource.full': { kind: ResourceKind };
  'machine.built': { machine: MachineData };
  /** Phase 5 E13: `consumed` are gone (snapshots); `machine` is the anchor, now one tier higher. */
  /** Phase 5 E14: three tier-2 machines became a stored Superstructure Core (all three are gone). */
  'core.created': { type: MachineData['type']; consumed: MachineData[]; fee: Cost; lost: { upgrade: string; name: string; kept: number; lost: number[] }[] };
  /** Phase 5 E14: a superstructure was placed (stage 1) or a stage was paid (2, 3 = built). */
  'super.stage': { machine: MachineData; stage: number };
  /** Phase 5 E14: a superstructure's ability fired. `tiles` = tiles it acts on (wave, evolution), if any. */
  'super.ability': { machine: MachineData; tiles: string[] };
  'machine.merged': { machine: MachineData; consumed: MachineData[]; fee: Cost; lost: { upgrade: string; name: string; kept: number; lost: number[] }[] };
  'chain.started': { chainId: number; originTileId: string };
  'chain.event': { event: ChainEvent; combo: number };
  'chain.fastForward': { chainId: number };
  'chain.ended': { chainId: number; combo: number; bonus: Big; total: Big; milestonePct: number; energy: Big; roofs: string[]; crossings: number; areas: number; areaIds?: string[]; starter: 'player' | 'auto' };
  'mega.released': { tileId: string; budget: number };
  'mega.ready': Record<string, never>;
  'area.modeChanged': { areaId: string; mode: 'bloom' | 'frontier' | 'off' | undefined };
  'machine.boosted': { machineId: string };
  'machine.boostUsed': { machineId: string };
  'reservoir.overflow': { machineId: string; tiles: string[] };
  'reservoir.fill': { machineId: string; from: string };
  /** City 10.3: water travels along a canal (tile ids in order) from one machine to another. */
  /** A street garden passes its chain on along a green corridor. */
  'corridor.sent': { from: string; to: string; chainId: number };
  /** City 10.4: a pulse leaves one Bloom Relay for another. */
  'relay.city': { from: string; to: string; linkId: string; chainId: number; travel: number };
  /** City 12.1: a rooftop cluster's roof was added to the world, or became reachable. */
  'layer.added': { layerId: string };
  'layer.unlocked': { layerId: string };
  'canal.flow': { from: string; to: string; path: string[]; kind: 'fill' | 'overflow'; chainId?: number };
  'canopy.burst': { machineId: string; radius: number; gardens: string[] };
  'tree.discharged': { machineId: string };
  'solar.boost': { machineId: string };
  'pulse.fired': { tileId: string; extra: string[]; overcharged: boolean };
  'action.failed': { reason: string; tileId?: string };
  'upgrade.purchased': { id: string; level: number; machineId?: string; bulk?: boolean };
  /** Phase 5 E12: "Upgrade all" finished: `count` levels bought across machines of one type. */
  'upgrade.bulk': { id: string; count: number };
  'drone.spawned': { droneId: string };
  'drone.despawned': { droneId: string };
  'drone.jobStarted': { droneId: string; tileId: string };
  'cat.spawned': { anchorId: string };
  'cat.found': { anchorId: string; reward: CatRewardType; summary: string; extras: number };
  'cat.stash': { stash: number };
  'cat.moved': { from: string; anchorId: string };
  'cat.goldenRelay': Record<string, never>;
  'buff.started': { type: BuffType; seconds: number };
  'harvest': { amount: Big };
  'rooftop.coreReady': Record<string, never>;
  'rooftop.coreRestored': Record<string, never>;
  'tutorial.step': { step: number };
  'frenzy.ready': Record<string, never>;
  'frenzy.started': { seconds: number };
  'frenzy.ended': Record<string, never>;
  /** Phase 4 E04.3: a park milestone was reached and paid (once). */
  /** Phase 5 E12: a rewarded step on the way to an area's landmark (25 / 50 / 75% of the tiles it needs). */
  'area.step': { areaId: string; step: number; share: number; credited: Partial<Record<ResourceKind, Big>> };
  'milestone.reached': { at: number; credited: Partial<Record<ResourceKind, Big>>; next?: number };
  'area.revealed': { areaId: string };
  'area.fogChanged': { areaId: string; fog: string };
  'area.ready': { areaId: string };
  'area.cleared': { areaId: string };
  /** City 09.1: progress on an area's specialty action. */
  'area.specialty': { areaId: string; have: number; need: number; met: boolean };
  'district.ready': { districtId: string };
  'district.bloom': { districtId: string; restored: string[]; lusher: string[]; reward: Partial<Record<ResourceKind, Big>>; replay: boolean };
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
