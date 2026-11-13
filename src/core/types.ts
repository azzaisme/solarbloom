export type GroundState = 'polluted' | 'prepared' | 'growing' | 'restored';
export type MachineType = 'solar' | 'condenser' | 'pollinator' | 'droneHub' | 'core';
export type BuildableType = Exclude<MachineType, 'core'>;
export type ResourceKind = 'energy' | 'water' | 'biomass';
export type Resources = Record<ResourceKind, number>;
export type Cost = Partial<Resources>;
export type RestoreSource = 'pulse' | 'broad' | 'drone' | 'chain' | 'condenser' | 'mega';

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
}

export type BuffType = 'solarFrenzy';
export interface Buff {
  type: BuffType;
  until: number;
}

export type CatRewardType = 'luckyHarvest' | 'solarFrenzy' | 'megaBloom' | 'droneParty' | 'jackpot';

export interface CatState {
  active?: { anchorId: string; spawnedAt: number };
  nextSpawnAt: number; // -1 until the first (milestone-based) spawn
  found: number;
  firstSpawned: boolean;
  lastReward?: CatRewardType;
}

export interface Progression {
  coreActivated: boolean;
  coreActivatedAt: number;
  tutorialStep: number;
  hintsDismissed: boolean;
}

export interface Stats {
  tilesRestored: number;
  maxCombo: number;
  chains: number;
  catsFound: number;
  droneJobs: number;
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
  cat: CatState;
  progression: Progression;
  stats: Stats;
}
