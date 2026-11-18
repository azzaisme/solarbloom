export type GroundState = 'polluted' | 'prepared' | 'growing' | 'restored';
/** `chest` and `reclaimer` exist only under old-city rules (E21.1, E21.2). */
export type MachineType = 'solar' | 'condenser' | 'pollinator' | 'droneHub' | 'motherTree' | 'reservoirGarden' | 'relay' | 'cultivator' | 'core' | 'chest' | 'reclaimer';
export type BuildableType = Exclude<MachineType, 'core'>;
export type ResourceKind = 'energy' | 'water' | 'biomass';
/** Plain per-resource numbers (tuning tables, small per-second coefficients). */
export type Resources = Record<ResourceKind, number>;
/** Phase 5 E12: resource quantities are big numbers (see core/Big). */
export type Amounts = Record<ResourceKind, import('./Big').Big>;
/** Only energy and water have storage; biomass is uncapped. */
export type CappedKind = Exclude<ResourceKind, 'biomass'>;
export type Caps = Record<CappedKind, import('./Big').Big>;
/** Income per second, per resource (totals are big numbers too). */
export type Rates = Amounts;
export type Cost = Partial<Record<ResourceKind, import('./Big').BigLike>>;
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
  | 'neighbourhood'
  /** Phase 5 E14: a superstructure's ability (Water Nexus wave, Tree of Life evolution) */
  | 'super'
  /** Look 6.8: the Cultivator (a solar tiller) */
  | 'cultivator';

/**
 * Look 6 (#169): what a tile is visibly turning into. `restore` covers moss/concrete → growing → restored (fracture,
 * heave, crumble, sprout, knit); `bloom` one nurture step; `unblock` an obstacle crumbling away.
 */
export type TransitionKind = 'soften' | 'moss' | 'restore' | 'bloom' | 'unblock';

/**
 * Look 6.2: a tile's active transition, keyed to sim time (so a reload continues it). `from` is the look it starts
 * from (pollution for soften/moss/restore, bloom level for bloom). `dir` is the edge facing where the change came
 * from (0 centre, 1 +x, 2 −x, 3 +z, 4 −z). `g`: gameplay time (the Cultivator's work), not just visual catch-up.
 */
export interface TileTransition {
  k: TransitionKind;
  t0: number;
  d: number;
  dir?: number;
  from?: number;
  g?: 1;
}

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
  /** Look 6.16: when the current lush spell began (the wet mask soaks in from then). */
  lushAt?: number;
  /** Look 6.2: the transition playing on this tile, if any (saved). */
  tr?: TileTransition;
  /** City ground: what the tile is made of (generated, not saved). */
  feature?: import('../data/city').TileFeature;
  /** City ground obstacles: which prop stands here (bench, stall, stump…), for the renderer. */
  prop?: string;
  /** A generated obstacle was cleared so a fogged area stays reachable (saved). */
  unblocked?: boolean;
  /** E21.24: the Old City's terrace height at the tile's middle, in levels (generated, not saved; unset = flat) */
  level?: number;
  /** E21.24: the tile is part of a ramp or stair (generated) */
  ramp?: boolean;
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
  /** City 12.1: a generated rooftop uses this template's layout and look ('seed', 'reservoir' or 'canopy'). */
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
  /** Phase 5 E12: this machine's own upgrade levels, by upgrade id (per-machine upgrades only). */
  upg?: Record<string, number>;
  /** Phase 5 E13: merge tier (unset = 1). Three connected tier-1 machines of a type merge into one tier 2. */
  tier?: number;
  /**
   * Phase 5 E14: a superstructure under construction. `stage` = stages paid (1 foundation, 2 assembly,
   * 3 activation = built); `costs` = the three stage prices locked at placement (Decimal strings).
   */
  project?: { stage: number; costs: Partial<Record<ResourceKind, string>>[] };
  /** Phase 5 E14: a superstructure's ability: charge (events), uses, automation switch. */
  ability?: { charge: number; used: number; auto?: boolean };
  /** Look 6.8: a Cultivator's tillers (mobile units working dead ground near the dock), and tiles finished. */
  cult?: { units: CultivatorUnit[]; done: number };
  /** E18: a Drone Hub's role (unset = restorer; slot 1 on a Fleet Hub). */
  role?: DroneRole;
  /** E18: roles this hub has been refitted for (Restorer is always owned, so never listed). */
  roles?: DroneRole[];
  /** E18.8: a Fleet Hub's second role slot (half its drones). */
  role2?: DroneRole;
  /** E18.8: a Drone Megahub's per-drone roles, by drone order (unset entries follow `role`). */
  droneRoles?: (DroneRole | null)[];
}

/**
 * Look 6.8: one Cultivator tiller. `px`/`pz` are its continuous position (tile centre = x + 0.5); `work` lists
 * the tiles it is working side by side (Wide Tines), `knocks`/`knockAt` limit tap knocks per phase.
 */
export interface CultivatorUnit {
  px: number;
  pz: number;
  work: string[];
  /** facing (radians), for the model */
  rot: number;
  parked?: boolean;
  knocks?: number;
  knockAt?: number;
  retryAt?: number;
}

export type DroneMode = 'idle' | 'flying' | 'working' | 'cooldown' | 'returning';
/** E18: what a Drone Hub's drones do (docs/E18_AUDIT.md; design in the E18 epic, #199). Unset = restorer. */
export type DroneRole = 'restorer' | 'gardener' | 'scout' | 'courier' | 'spark' | 'harvester';

export interface DroneData {
  id: string;
  hubId: string;
  mode: DroneMode;
  px: number; // roof-local continuous grid position (tile centre = x + 0.5)
  pz: number;
  targetTileId?: string;
  timer: number;
  expiresAt?: number; // temporary (Drone Party) drones
  /** Phase 4 E01: the old drone that lives by the park's starter solar lamp (its `hubId`). */
  old?: boolean;
  /** Phase 5 E14: one of a Drone Megahub's swarm (temporary; restores extra tiles around each job). */
  swarm?: boolean;
  jobs: number;
  /** Roof the drone is currently over (px/pz are local to it). Defaults to the hub's roof. */
  roofId?: string;
  /** City 11.4: a flight far from the camera, resolved by time instead of per-tick moves (from, departure, arrival). */
  far?: { fx: number; fz: number; t0: number; t1: number };
  /**
   * E18: the role of the job in flight (unset = restorer). Set when a job is paid, so a hub switching roles lets
   * each drone finish what it already paid for.
   */
  role?: DroneRole;
  /** E18.4: a Courier's machine target (instead of a tile). */
  targetMachineId?: string;
}

export type BuffType = 'solarFrenzy' | 'megaflower';
export interface Buff {
  type: BuffType;
  until: number;
}

export type CatRewardType = 'luckyHarvest' | 'solarFrenzy' | 'megaBloom' | 'droneParty' | 'jackpot' | 'goldenRelay' | 'catsGarden' | 'fogWhisker';

/** Phase 5 E15: how rare a cat is (rolled when it appears, saved with it). */
export type CatVariant = 'standard' | 'golden' | 'rainbow';

/** Phase 5 E15: one hiding cat. `id` is stable (claims are recorded by it, so a cat pays exactly once). */
export interface CatSpot {
  id: string;
  anchorId: string;
  spawnedAt: number;
  variant: CatVariant;
  /** E18.3: a Scout flew close by. Unused since E20.1 (#284); kept so older saves load. */
  scouted?: boolean;
}

export interface CatState {
  active?: CatSpot;
  /** Phase 5 E15: extra cats from a Lucky Cat Invasion (independent rewards; they stay until found). */
  invasion?: CatSpot[];
  /** Phase 5 E15: cats ever spawned (cat ids are `c<seq>`). */
  seq?: number;
  /** Phase 5 E15: ids of the most recent claimed cats (a stale or repeated claim pays nothing). */
  claimed?: string[];
  nextSpawnAt: number; // -1 until the first (milestone-based) spawn
  found: number;
  /** Extra rewards a missed cat has saved up (it never blocks later rewards). */
  stash: number;
  firstSpawned: boolean;
  lastReward?: CatRewardType;
  /** Discovery log: every cat found, where, and what it gave. */
  log: { anchorId: string; reward: CatRewardType; at: number; variant?: CatVariant }[];
}

export interface Progression {
  coreActivated: boolean;
  coreActivatedAt: number;
  tutorialStep: number;
  hintsDismissed: boolean;
  introSeen: boolean;
  /** manual pulses since the last Overcharge */
  pulseCharge: number;
  /** Phase 4 E04.3: park milestones already paid (restored-tile thresholds). Missing in older saves. */
  parkMilestones?: number[];
  /** Mega Pulse meter: manual taps since the last Mega Pulse (full at TUNING.mega.charge) */
  megaCharge?: number;
  /** Old saves only (the rooftop campaign's Cores). */
  cores?: Record<string, boolean>;
  /** Reservoir Overflow bursts and Canopy Bursts so far (core milestones). */
  overflows: number;
  canopyBursts: number;
  /** Old saves only (the rooftop campaign's Neighbourhood Bloom). */
  neighbourhoodBloomAt?: number;
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
  /** Phase 5 E13: machines ever built, by type (prices count these, so merging never makes building cheaper). */
  built?: Record<string, number>;
  /** Phase 5 E13: merges made, by machine type (the first of each type is free). */
  merges?: Record<string, number>;
  /** Phase 5 E14: superstructures finished, and abilities fired. */
  supers?: number;
  superAbilities?: number;
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
  /** Phase 5 E12: rewarded progress steps already paid here (count of TUNING.areaSteps.at reached). */
  steps?: number;
  /**
   * Region unlocks (18 Nov 2026): revealed but still sealed in thick fog until the player pays `price`. While sealed
   * the area behaves exactly as hidden fog (nothing can be walked, restored or built). Absent on older saves.
   */
  sealed?: boolean;
  /** E21.9: tiles in this area bloombot restored itself (old-city rules: helpers wait until it has done its share) */
  byBot?: number;
  /** the unlock price, set when the area was revealed (biomass as a big-number string) */
  price?: { biomass: string; energy: number };
  /** sim time the player unlocked it */
  unlockedAt?: number;
}

export interface LinkState {
  built: boolean;
  builtAt: number;
  /** sim time the relay can next carry a chain across */
  readyAt: number;
  crossings: number;
}

/**
 * E21 (#312): which rules a game plays by. 'oldcity' is the Old City (docs/E21_OLD_CITY.md): a fixed map of nine
 * regions, materials salvaged by hand, fountain tiers. 'classic' is the endless idle city every game before E21
 * played. A save without the field is classic (the field is never written for classic, so those saves stay
 * byte-identical).
 */
export type Rules = 'oldcity' | 'classic';

/** E21 §1: the eight materials. */
export type MaterialId = 'scrap' | 'seeds' | 'copper' | 'timber' | 'glass' | 'clay' | 'gears' | 'sunstone';
/** E23.6.1 (#390): components made at the crafting table (data in src/data/crafting.ts). */
export type ComponentId = 'wire' | 'planks' | 'glassPane' | 'pipe' | 'motor' | 'batteryCell' | 'sunCell';
/** E23.6.1: anything the backpack and the store hold (materials and components; see src/data/items.ts). */
export type ItemId = MaterialId | ComponentId;
/** E21 §6: bloombot's abilities, one per fountain tier 1–4. */
export type AbilityId = 'pry' | 'hover' | 'climb' | 'glide';
/** E21 §8: where a Keeper is in its story. Woken (pulsed and handed 5 of anything) goes straight to request1. */
export type KeeperStep = 'asleep' | 'request1' | 'request2' | 'landmark' | 'settled';
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'mist' | 'windy';

export interface KeeperState {
  step: KeeperStep;
  /** asleep only: bloombot has pulsed it (it stirs; 5 of anything wakes it) */
  pulsed?: boolean;
  /** what has been handed over toward the current delivery (request 1 or the landmark) */
  given?: Partial<Record<MaterialId, number>>;
}

/**
 * E21: everything the Old City adds to a save. Present only under old-city rules; each part belongs to its own
 * ticket (E21.1 pack and store, E21.2 piles, E21.5 opened gates, E21.6 tier, E21.8 keepers, …).
 */
export interface SalvageState {
  /** E21.1: what bloombot carries (whole numbers, a stack limit per material) */
  pack: Partial<Record<ItemId, number>>;
  /** E21.1: the city's shared, unlimited store */
  store: Partial<Record<ItemId, number>>;
  /** E21.2: units left in each pile bloombot has touched (pile id → left); untouched piles are full */
  piles: Record<string, number>;
  /** E21.5: gates opened for good (barricades pried, bridges repaired), by gate id */
  opened: string[];
  /** E21.6: fountain tier reached (0 = dry) */
  tier: number;
  /** E21.6: materials handed in toward the next tier */
  delivered: Partial<Record<MaterialId, number>>;
  /** E21.6: abilities granted by the fountain */
  abilities: AbilityId[];
  /** E21.8: Keepers met, by Keeper id (absent = asleep, never pulsed) */
  keepers: Record<string, KeeperState>;
  /** E21.10: caches opened, by id */
  caches: string[];
  /** E21.10: journal pages found, by id */
  pages: string[];
  /** E21.10: blueprints found, by id */
  blueprints: string[];
  /** E21.11: the house's level (0 = the ruined shed) */
  house: number;
  /** E21.13: seconds added to sim time to get the time of day (only the bed changes it) */
  clockOffset: number;
  /** E21.13: the weather now, and when it next changes (sim time) */
  weather?: { kind: WeatherKind; until: number };
  /** E21.9: Reclaimers' undelivered fractions, by machine id (so 6 a minute pays exactly) */
  reclaim?: Record<string, number>;
  /** E21.6 / E21.17: one-off items carried for the Great Bloom (the Heart Seed, the Star Lens) */
  items?: string[];
  /** E21.9: lasting region rewards in effect (data/oldcity RewardId), in the order they were won */
  rewards?: string[];
  /** E21.12: lookouts and vistas already seen, beacons spotted (presentation, but saved so they play once) */
  seen?: string[];
  /** E23.6.1: the crafting table's queue (recipe id, crafts left, seconds left on the one in hand) */
  craft?: { id: string; n: number; left: number }[];
  /** E23.6.2: the research station (finds analysed, projects done and running, upgrade levels bought) */
  research?: ResearchState;
  /** E23.6.6: overgrowth by host key (a machine, a decoration, a ruin, a pipe tile, a power line), and since when */
  overgrowth?: Record<string, { kind: import('../data/overgrowth').OvergrowthKind; t0: number }>;
}

/** E23.6.2: what the research station keeps. */
export interface ResearchState {
  /** finds looked at (keys such as 'material:copper', 'keeper:mastRow', 'tech:c-mastRow-1') */
  analysed: string[];
  /** projects finished, in order */
  done: string[];
  /** projects on the bench: seconds of powered work left */
  running: { id: string; left: number }[];
  /** upgrade levels bought at the crafting table */
  levels: Record<string, number>;
}

export interface GameState {
  version: number;
  /** E21: the rule set (absent = classic). Read it through `rulesOf`. */
  rules?: Rules;
  /** E21: Old City state (old-city rules only). */
  salvage?: SalvageState;
  seed: number;
  rngState: number;
  time: number;
  nextId: number;
  resources: Amounts;
  caps: Caps;
  layers: LayerData[];
  /** Only present in a save being loaded: packed tile deltas per chunk (consumed by Sim). */
  tiles?: Record<string, string>;
  machines: MachineData[];
  /** Phase 5 E14: Superstructure Cores waiting to be placed (from merging three tier-2 machines). */
  cores?: { type: MachineType; upg?: Record<string, number>; role?: DroneRole; roles?: DroneRole[] }[];
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
  /** Phase 4 E01: wall-clock time (ms since 1970) this state was last saved. */
  savedAt?: number;
  /** City 10.7: district blooms claimed, by district id (sim time). Optional: older saves have none. */
  districts?: Record<string, number>;
  /** Phase 5 E16: fauna that has arrived, by kind (sim time). Cosmetic; optional, so no save version change. */
  fauna?: Partial<Record<'butterflies' | 'birds' | 'koi' | 'robots', number>>;
  /**
   * Bloombot (#234, G.2): where the player character stands, in its layer's cell units, and which way it faces
   * (radians, 0 = +z). Written by the game only, never by the sim, so the bots' saves don't change. Optional,
   * so no save version change: a save without it starts bloombot beside the park fountain.
   */
  bot?: { roofId: string; x: number; z: number; facing: number };
  /**
   * E19 (#245): the cozy city. Written by the game only, never by the sim (cosmetic: nothing reads it to decide
   * production, chains, milestones or pacing). Optional and sparse, so no save version change.
   */
  cozy?: CozyState;
}

/** E19: what the player chose for the look of their city. */
export interface CozyState {
  /** E19.1: plot id → plot option id (only plots with a choice) */
  plots?: Record<string, string>;
  /** E19.1.4: options earned so far, in the order they unlocked (options open from the start aren't listed) */
  unlocked?: string[];
  /** E19.1.4: unlocked options the picker hasn't shown yet (its "new" marker) */
  fresh?: string[];
  /**
   * E19.2: decorations placed by hand, `<layer>|<x>|<z>` → `<decoration id>[@<quarter turns>]` (core/Decor.ts).
   * Sorted keys; each occupies its tile as a machine does.
   */
  decor?: Record<string, string>;
  /** E19.2.2: decorations earned so far, in the order they unlocked (ones open from the start aren't listed) */
  decorUnlocked?: string[];
}
