export type GroundState = 'polluted' | 'prepared' | 'growing' | 'restored';
export type MachineType = 'solar' | 'condenser' | 'pollinator' | 'droneHub' | 'motherTree' | 'reservoirGarden' | 'core';
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
}

export interface RooftopData {
  id: string;
  name: string;
  width: number;
  depth: number;
  height: number;
  origin: [number, number, number];
  unlocked: boolean;
  preview: boolean; // visible but not yet playable
  tiles: TileData[];
}

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
}

export type BuffType = 'solarFrenzy';
export interface Buff {
  type: BuffType;
  until: number;
}

export type CatRewardType = 'luckyHarvest' | 'solarFrenzy' | 'megaBloom' | 'droneParty' | 'jackpot' | 'goldenRelay' | 'catsGarden';

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
  /** Phase 3: which Rooftop Cores are awake (r1 mirrors coreActivated). */
  cores: Record<string, boolean>;
  /** Reservoir Overflow bursts and Canopy Bursts so far (core milestones). */
  overflows: number;
  canopyBursts: number;
  /** One-time Neighbourhood Bloom reward claimed (sim time, -1 if not). */
  neighbourhoodBloomAt: number;
}

export interface Stats {
  tilesRestored: number;
  maxCombo: number;
  chains: number;
  catsFound: number;
  droneJobs: number;
  /** Playtest metrics: sim-time of first milestones, chain sizes, time with nothing affordable to do. */
  firsts: Record<string, number>;
  chainEffects: number;
  stuckSeconds: number;
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
  rooftops: RooftopData[];
  machines: MachineData[];
  drones: DroneData[];
  upgrades: Record<string, number>;
  buffs: Buff[];
  harvestReadyAt: number;
  /** Bridges and relays by link id (see data/rooftops LINKS). */
  links: Record<string, LinkState>;
  /** Golden Relay (Lucky Cat): extra remote blooms on the next cross-roof chain. */
  relayBonus: number;
  cat: CatState;
  progression: Progression;
  stats: Stats;
}
