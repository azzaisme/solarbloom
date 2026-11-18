import type { Big } from '../core/Big';
import type { ChainEvent } from '../gameplay/BloomChainSystem';
import type { BuffType, CatRewardType, CatVariant, MachineData, ResourceKind, RestoreSource, TileData } from '../core/types';

export interface GameEvents {
  /** E23.7.1: the light clock crossed dawn or dusk (`day`: the game day). */
  'clock.dawn': { day: number };
  'clock.dusk': { day: number };
  /** E23.7.1: bloombot slept in the house (`from` → `day`; in "follow my clock" mode the day doesn't change). */
  'clock.slept': { from: number; day: number; real: boolean };
  /** E23.7.1: "follow my clock" switched on or off. */
  'clock.mode': { real: boolean };
  /** E23.7.2: a new day's weather (or a held one, in tests and photo mode never). */
  'weather.changed': { kind: import('../data/weather').WeatherKind; day: number };
  /** E23.7.2.3: a storm blew in at dawn: fresh salvage (E23.7.4 refills the piles). */
  'weather.storm': { day: number };
  /** E23.7.2.3: lightning struck; `poleId`: the power pole it tripped (reset with one press), if the grid has one. */
  'weather.lightning': { day: number; poleId?: string };
  /** E23.7.2.2: bloombot listened to the forecast on the radio. */
  'weather.forecast': { kind: import('../data/weather').WeatherKind };
  /** E23.7.1.3: a night find was taken. */
  'night.found': { id: string; material: import('../core/types').MaterialId; n: number; x: number; z: number };
  /** E21.1: the backpack or the store changed (`material` unset = several at once). */
  'pack.changed': { material?: import('../core/types').MaterialId; delta?: number };
  'store.changed': { material?: import('../core/types').MaterialId; delta?: number };
  /** E21.1: a stack is full; `left` units stayed where they were. */
  'pack.full': { material: import('../core/types').MaterialId; left: number };
  /** E21.2: bloombot salvaged a pile (`got` units; `left` in the pile; 0 = it is gone). */
  'pile.salvaged': { pileId: string; material: import('../core/types').MaterialId; got: number; left: number; x: number; z: number };
  /** E21.3: a machine was taken down (its recipe refunded). */
  'machine.removed': { machine: MachineData };
  /** E23.7.4: a pile gained units back (slowly over game days, or all at once in a storm); `left` units now. */
  'pile.refilled': { pileId: string; left: number; x: number; z: number; storm: boolean };
  /** E21.5: a gate opened for good (a barricade pried, a bridge repaired, the lock bridge risen). */
  'gate.opened': { gateId: string; region: string };
  /** E21.6: something was handed in at the fountain; the fountain reached a tier. */
  'fountain.delivered': { material: import('../core/types').MaterialId; n: number };
  'fountain.tier': { tier: number };
  /** E21.8: a Keeper speaks (one to three lines) or moves to a new step. */
  'keeper.said': { keeperId: string; lines: string[] };
  'keeper.step': { keeperId: string; step: import('../core/types').KeeperStep };
  /** E21.9: a region's landmark woke (by bloombot's own delivery). */
  'landmark.woken': { region: string };
  'tile.restoring': { tile: TileData; source: RestoreSource };
  'tile.restored': { tile: TileData; source: RestoreSource; chainId: number; biomass: Big };
  'tile.prepared': { tile: TileData };
  'tile.softened': { tile: TileData };
  'tile.nurtured': { tile: TileData; level: number; auto?: boolean };
  /** Look 6.16: a tile became (or stayed) lush; its wet mask soaks in. */
  'tile.lush': { tile: TileData };
  /** Look 6.10: a tap knocked a tile's transition along. */
  'tile.knocked': { tile: TileData };
  /** Look 6: a tile's transition changed without a state change (a delayed wave, a Cultivator phase). */
  'tile.transition': { tile: TileData };
  'resource.gain': { kind: ResourceKind; amount: Big; tileId?: string; reason?: string };
  'resource.full': { kind: ResourceKind };
  'machine.built': { machine: MachineData };
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
  /** E18: a hub took a role (`refit` = it paid for it just now; otherwise a free switch). */
  'drone.roleChanged': { hubId: string; role: import('../core/types').DroneRole; refit: boolean; slot?: number };
  /** E18: a non-Restorer drone finished a job (effects and sound): what it touched. */
  'drone.roleWork': { droneId: string; role: import('../core/types').DroneRole; tileIds: string[]; machineIds: string[] };
  /** Phase 5 E15: `catId` is stable; `invasion` cats come from a Lucky Cat Invasion. */
  'cat.spawned': { anchorId: string; catId?: string; variant?: CatVariant; invasion?: boolean };
  'cat.found': { anchorId: string; reward: CatRewardType; summary: string; extras: number; catId?: string; variant?: CatVariant; rewards?: CatRewardType[] };
  'cat.moved': { from: string; anchorId: string; catId?: string };
  'cat.goldenRelay': Record<string, never>;
  'buff.started': { type: BuffType; seconds: number };
  'harvest': { amount: Big };
  'rooftop.coreReady': Record<string, never>;
  'rooftop.coreRestored': Record<string, never>;
  'tutorial.step': { step: number };
  /** Phase 4 E04.3: a park milestone was reached and paid (once). */
  /** Phase 5 E12: a rewarded step on the way to an area's landmark (25 / 50 / 75% of the tiles it needs). */
  'area.step': { areaId: string; step: number; share: number; credited: Partial<Record<ResourceKind, Big>> };
  'milestone.reached': { at: number; credited: Partial<Record<ResourceKind, Big>>; next?: number };
  'area.revealed': { areaId: string };
  /** region unlocks: the player paid to lift a sealed area's fog */
  'area.unlocked': { areaId: string };
  'area.fogChanged': { areaId: string; fog: string };
  'area.ready': { areaId: string };
  'area.cleared': { areaId: string };
  /** City 09.1: progress on an area's specialty action. */
  'area.specialty': { areaId: string; have: number; need: number; met: boolean };
  'district.ready': { districtId: string };
  /** Phase 5 E16: a fauna kind arrived (once per save; cosmetic). */
  'fauna.unlocked': { id: 'butterflies' | 'birds' | 'koi' | 'robots' };
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
