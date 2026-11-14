export type GroundState = 'polluted' | 'prepared' | 'growing' | 'restored';
export type MachineType = 'solar' | 'condenser' | 'pollinator' | 'droneHub' | 'motherTree' | 'reservoirGarden' | 'relay' | 'core';
export type BuildableType = Exclude<MachineType, 'core'>;
export type ResourceKind = 'energy' | 'water' | 'biomass';
export type Resources = Record<ResourceKind, number>;
export type Cost = Partial<Resources>;
export type RestoreSource =
  | 'pulse'
  | 'broad'
  | 'drone'
  | 'chain'
  | 'condenser'
  | 'mega'
  | 'pollinate'
  | 'motherTree'
  | 'relay'
  | 'overflow'
  | 'canopy'
  | 'cat'
  | 'neighbourhood';

export interface TileData {
  id: string;
  roofId: string;
  x: number;
  z: number;
  ground: GroundState;
  pollution: number; // 0..100
  variant: number; // stable visual seed
  occupantId?: string;
  blocked: boolean;
  growthRemainingSec: number;
  growSource?: RestoreSource;
  bloom: number; // 0 until restored, then 1..3 (grass → flowers → shrubs)
  /** Reservoir Overflow: biomass bonus on this tile until this sim time. */
  lushUntil?: number;
  /** City ground: what the tile is made of (generated, not saved). */
  feature?: import('../data/city').TileFeature;
  /** City ground obstacles: which prop stands here (bench, stall, stump…), for the renderer. */
  prop?: string;
  /** A generated obstacle was cleared so a fogged area stays reachable (saved). */
  unblocked?: boolean;
}

/**
 * A layer is one continuous grid surface. The ground is unbounded (an endless city, generated on demand);
 * a raised layer (a rooftop) is bounded and sits at its own height. Adjacency never crosses layers:
 * only explicit links (bridges, relays) connect them. Tiles are NOT stored here: they live in the
 * world's chunks (see core/Grid) and are saved as deltas from what generation would produce.
 */
export interface LayerData {
  id: string;
  name: string;
  kind: 'ground' | 'raised';
  /** Bounded layers only (raised): size in tiles. 0 for the unbounded ground. */
  width: number;
  depth: number;
  height: number;
  /** World position of local cell (0, 0). */
  origin: [number, number, number];
  unlocked: boolean;
  preview: boolean; // visible but not yet playable
  /** Ground generation version: 2 adds buildings, 3 rooftop clusters. Saves keep the version they began with. */
  gen?: number;
  /** City 12.1: a generated rooftop uses this template's layout and look ('r1' Seed, 'r2' Reservoir, 'r3' Canopy). */
  template?: string;
  /** City 12.1: the city area whose rooftop cluster this is (such roofs are not part of the rooftop campaign). */
  cluster?: string;
}

/** Kept as an alias while the rooftop-era code is ported (City 12 removes it). */
export type RooftopData = LayerData;

export interface MachineData {
  id: string;
  type: MachineType;
  roofId: string;
  x: number;
  z: number;
  size: number;
  starter?: boolean;
  boostUntil: number; // solar bloom boost
  timer: number; // per-machine automation timer
  charge: number; // condenser / Mother Tree / Reservoir Garden / Elder Tree charge meter
  /** Overcharge Pulse: a manual restoration right next to it boosts its next trigger until this time. */
  overchargeUntil?: number;
}

export type DroneMode = 'idle' | 'flying' | 'working' | 'cooldown' | 'returning';

export interface DroneData {
  id: string;
  hubId: string;
  mode: DroneMode;
  px: number; // roof-local continuous grid position (tile centre = x + 0.5)
  pz: number;
  targetTileId?: string;
  timer: number;
  expiresAt?: number; // temporary (Drone Party) drones
  jobs: number;
  /** Roof the drone is currently over (px/pz are local to it). Defaults to the hub's roof. */
  roofId?: string;
  /** Drone Dispatch: crossing a bridge. t goes 0 → 1 from `fromRoof` to the link's other end. */
  cross?: { linkId: string; fromRoof: string; t: number };
  /** City 11.4: a flight far from the camera, resolved by time instead of per-tick moves (from, departure, arrival). */
  far?: { fx: number; fz: number; t0: number; t1: number };
}

export type BuffType = 'solarFrenzy';
export interface Buff {
  type: BuffType;
  until: number;
}

export type CatRewardType = 'luckyHarvest' | 'solarFrenzy' | 'megaBloom' | 'droneParty' | 'jackpot' | 'goldenRelay' | 'catsGarden' | 'fogWhisker';

export interface CatState {
  active?: { anchorId: string; spawnedAt: number };
  nextSpawnAt: number; // -1 until the first (milestone-based) spawn
  found: number;
  /** Extra rewards a missed cat has saved up (it never blocks later rewards). */
  stash: number;
  firstSpawned: boolean;
  lastReward?: CatRewardType;
  /** Discovery log: every cat found, where, and what it gave. */
  log: { anchorId: string; reward: CatRewardType; at: number }[];
}

export interface Progression {
  coreActivated: boolean;
  coreActivatedAt: number;
  tutorialStep: number;
  hintsDismissed: boolean;
  introSeen: boolean;
  /** manual pulses since the last Overcharge */
  pulseCharge: number;
  /** Mega Pulse meter: manual taps since the last Mega Pulse (full at TUNING.mega.charge) */
  megaCharge?: number;
  /** Phase 3: which Rooftop Cores are awake (r1 mirrors coreActivated). */
  cores: Record<string, boolean>;
  /** Reservoir Overflow bursts and Canopy Bursts so far (core milestones). */
  overflows: number;
  canopyBursts: number;
  /** One-time Neighbourhood Bloom reward claimed (sim time, -1 if not). */
  neighbourhoodBloomAt: number;
}

export interface Stats {
  /** chains of at least TUNING.mega.bigChain, by who started them */
  bigChains?: { player: number; auto: number };
  tilesRestored: number;
  maxCombo: number;
  chains: number;
  catsFound: number;
  droneJobs: number;
  /** Playtest metrics: sim-time of first milestones, chain sizes, time with nothing affordable to do. */
  firsts: Record<string, number>;
  /** game time (s) each area was cleared, in order (playtest timings) */
  areaTimes?: number[];
  chainEffects: number;
  stuckSeconds: number;
}

/** Fog over a city area. Areas without an entry are hidden. */
export type FogState = 'hidden' | 'frontier' | 'thinning' | 'cleared';

/** Area automation switch (unset = normal). */
export type AreaMode = 'bloom' | 'frontier' | 'off';

export interface AreaState {
  fog: Exclude<FogState, 'hidden'>;
  revealedAt: number;
  clearedAt?: number;
  /** what drones do here: keep it blooming, push from it into the fog, or leave it alone */
  mode?: AreaMode;
  /** City 09.1: progress on the landmark's specialty action (a count, or the best chain for 'chain') */
  spec?: number;
}

export interface LinkState {
  built: boolean;
  builtAt: number;
  /** sim time the relay can next carry a chain across */
  readyAt: number;
  crossings: number;
}

export interface GameState {
  version: number;
  seed: number;
  rngState: number;
  time: number;
  nextId: number;
  resources: Resources;
  caps: Resources;
  layers: LayerData[];
  /** Only present in a save being loaded: packed tile deltas per chunk (consumed by Sim). */
  tiles?: Record<string, string>;
  machines: MachineData[];
  drones: DroneData[];
  upgrades: Record<string, number>;
  buffs: Buff[];
  harvestReadyAt: number;
  /** City areas that have been revealed (frontier or further). Static area data comes from the seed. */
  areas: Record<string, AreaState>;
  /** Bridges and relays by link id (see data/rooftops LINKS). */
  links: Record<string, LinkState>;
  /** Golden Relay (Lucky Cat): extra remote blooms on the next cross-roof chain. */
  relayBonus: number;
  cat: CatState;
  progression: Progression;
  stats: Stats;
  /** City 10.7: district blooms claimed, by district id (sim time). Optional: older saves have none. */
  districts?: Record<string, number>;
}
