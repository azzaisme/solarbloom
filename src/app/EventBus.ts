import type { ChainEvent } from '../gameplay/BloomChainSystem';
import type { BuffType, CatRewardType, CatVariant, MachineData, RestoreSource, TileData } from '../core/types';

export interface GameEvents {
  /** E23.2.1: bloombot's charge ran out (the low-power walk); reached full; bloombot began eating one unit. */
  'charge.empty': Record<string, never>;
  'charge.full': { source: import('../gameplay/Charge').ChargeSource };
  'charge.eat': { item: import('../data/charge').EdibleDef['id'] };
  /** E23.2.2: the wheel picked a load; a load just ran out (the next pulse fires empty); a pulse's reveal ripple. */
  'pulse.load': { load: import('../data/pulse').PulseLoadId };
  'pulse.loadEmpty': { load: import('../data/pulse').PulseLoadId };
  /** E23.2.3: an old bench mended; bloombot sat down (on a bench, or to meditate at a charger); stood up. */
  'bench.mended': { benchId: string; x: number; z: number };
  'rest.sat': { kind: 'bench' | 'charger' };
  'rest.stood': Record<string, never>;
  /** E23.2.4: an animal came over while bloombot sits, and the visitor log took it in (first: a new kind) */
  'wildlife.arrived': { id: string; perch: import('../data/wildlife').Perch; area: string };
  'wildlife.logged': { id: string; first: boolean };
  /** E23.2.2.3: a buried find dug up */
  'buried.dug': { id: string; material: import('../core/types').MaterialId; n: number; x: number; z: number };
  'tile.planted': { tile: TileData; plant: import('../core/types').PlantKind };
  'pulse.ripple': { tileId: string; targets: import('../gameplay/PulseLoad').RippleTarget[] };
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
  'pack.changed': { material?: import('../core/types').ItemId; delta?: number };
  'store.changed': { material?: import('../core/types').ItemId; delta?: number };
  /** E21.1: a stack is full; `left` units stayed where they were. */
  'pack.full': { material: import('../core/types').ItemId; left: number };
  /** E21.2: bloombot salvaged a pile (`got` units; `left` in the pile; 0 = it is gone). */
  'pile.salvaged': { pileId: string; material: import('../core/types').MaterialId; got: number; left: number; x: number; z: number };
  /** E23.6.1: crafts queued at the crafting table (negative: cancelled), and one craft made. */
  'craft.queued': { id: string; n: number };
  'craft.done': { id: string; made: number };
  /** E23.6.2: the research station: a find analysed, a project started or finished, an upgrade level bought. */
  'research.analysed': { find: string };
  'research.started': { id: string };
  'research.done': { id: string };
  'research.upgraded': { id: string; level: number };
  /** #622: the park reached a milestone and Bloombot grew from it */
  'bloombot.parkGrew': { step: number; id: string };
  /** E23.5.1: bloombot clipped restored ground for biomass (`got` units into the backpack). */
  'biomass.gathered': { tileId: string; x: number; z: number; got: number; by: 'bot' | 'drone' };
  /** E23.5.2: a planter's bed changed (planted, a new stage, fed, an extra, harvested). */
  'planter.changed': { machineId: string };
  'planter.ripe': { machineId: string; crop: string };
  'planter.harvested': { machineId: string; crop: string; food: number; biomass: number; seeds: number };
  /** E23.5.3: a compost bin or Bio Digester changed (filled, made something, emptied). */
  'farm.machine': { machineId: string };
  /** E23.5.4: something tended gave something (honey, fruit, mushrooms, timber). */
  'farm.harvested': { machineId: string; item: import('../core/types').MaterialId; n: number };
  /** E23.5.4.5: a creature moved into (or gently out of) a wildlife home. */
  'wildlife.moved': { machineId: string; creature: string; in: boolean };
  /** E23.5.4.6: a Keeper's garden request was grown. */
  'garden.fulfilled': { keeperId: string; crop: string; reward: import('../data/farmExtras').GardenReward };
  /**
   * E21.10 caches: one was opened (emitted by whoever opens caches; E23.5.2.3 listens for the seeds inside).
   * Nothing opens caches yet: the E21.10 data lists them but no system emits this so far.
   */
  'cache.opened': { cacheId: string; x: number; z: number };
  /** E23.5.2.3: a crop's seed packet found while exploring. */
  'seeds.found': { crop: string; region: string };
  /** E23.6.2: a crossbreed found at a harvest (data/crops crossKey and its two parents) */
  'cross.found': { key: string; a: string; b: string };
  /** E23.6.4: automation: things carried to or from the store by hand; a crate's contents changed; a route set,
   *  changed or removed, or a basket delivered; an Assembler's recipe changed */
  'store.moved': { material: import('../core/types').ItemId; n: number };
  'crate.changed': { id: string };
  'route.changed': { id: string };
  'route.delivered': { id: string; items: number };
  'assembler.changed': { id: string };
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
  /** E23.9.2: a Keeper took a gift it loves, or bloombot grew its garden */
  'keeper.gift': { keeperId: string; /** a material, or 'garden' for a grown Keeper garden (E23.5.4.6) */ item: string; hearts: number };
  /** E23.9.2: a settled Keeper sets off to tend a tile of its region */
  'keeper.tending': { keeperId: string; x: number; z: number };
  /** E23.9.2: a settled Keeper tended a tile of its region (one bloom step) */
  'keeper.tended': { keeperId: string; x: number; z: number };
  /** E23.9.2: a Keeper calls bloombot a friend */
  'keeper.friend': { keeperId: string };
  /** E23.9.1: a page of the maker's journal was kept */
  'journal.page': { id: string };
  /** E21.9: a region's landmark woke (by bloombot's own delivery). */
  'landmark.woken': { region: string };
  'tile.restoring': { tile: TileData; source: RestoreSource };
  'tile.restored': { tile: TileData; source: RestoreSource; chainId: number };
  'tile.prepared': { tile: TileData };
  'tile.softened': { tile: TileData };
  'tile.nurtured': { tile: TileData; level: number; auto?: boolean };
  /** Look 6.16: a tile became (or stayed) lush; its wet mask soaks in. */
  'tile.lush': { tile: TileData };
  /** Look 6.10: a tap knocked a tile's transition along. */
  'tile.knocked': { tile: TileData };
  /** Look 6: a tile's transition changed without a state change (a delayed wave, a Cultivator phase). */
  'tile.transition': { tile: TileData };
  'machine.built': { machine: MachineData };
  'chain.started': { chainId: number; originTileId: string };
  'chain.event': { event: ChainEvent; combo: number };
  'chain.fastForward': { chainId: number };
  'chain.ended': { chainId: number; combo: number; roofs: string[]; crossings: number; areas: number; areaIds?: string[]; starter: 'player' | 'auto' };
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
  'canopy.burst': { machineId: string; radius: number; gardens: string[] };
  'tree.discharged': { machineId: string };
  'solar.boost': { machineId: string };
  'pulse.fired': { tileId: string; extra: string[]; overcharged: boolean };
  /** #624 Lucky pulse: a pulse on bare ground turned up `n` of a material (already in the backpack) */
  'pulse.lucky': { tileId: string; material: import('../core/types').MaterialId; n: number };
  'action.failed': { reason: string; tileId?: string };
  /** E23.1.5: an upgrade level was granted (research; nothing is bought). */
  'upgrade.granted': { id: string; level: number; machineId?: string };
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
  'cat.goldenRelay': { machineId: string };
  'buff.started': { type: BuffType; seconds: number };
  'tutorial.step': { step: number };
  'area.revealed': { areaId: string };
  /** region unlocks: the player paid to lift a sealed area's fog */
  'area.unlocked': { areaId: string };
  'area.fogChanged': { areaId: string; fog: string };
  'area.ready': { areaId: string };
  'area.cleared': { areaId: string };
  /** City 09.1: progress on an area's specialty action. */
  'area.specialty': { areaId: string; have: number; need: number; met: boolean };
  /** Phase 5 E16: a fauna kind arrived (once per save; cosmetic). */
  'fauna.unlocked': { id: 'butterflies' | 'birds' | 'koi' | 'robots' };
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
