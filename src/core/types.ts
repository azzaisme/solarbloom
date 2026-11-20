export type GroundState = 'polluted' | 'prepared' | 'growing' | 'restored';
/** `chest`: the Old City's caches (E21.1). (E21.2's `reclaimer` was dropped in E23.7.4.) */
/** E23.6.4: `crate` (a supply crate, its own contents) and `assembler` (E23.6.5) are automation's machines. */
export type MachineType = 'solar' | 'condenser' | 'pollinator' | 'droneHub' | 'motherTree' | 'reservoirGarden' | 'relay' | 'cultivator' | 'core' | 'chest' | 'battery' | 'windTurbine' | 'charger'
  // E23.5.2: the farm
  | 'planter'
  // E23.5.3: the end of the farm chain
  | 'compostBin'
  | 'bioDigester'
  // E23.4.2: the water network
  | 'reservoir'
  | 'pump'
  | 'desalination'
  // E23.8.3.2: the mainland's big machines
  | 'gridBattery'
  // E23.6.4 / E23.6.5: automation
  | 'crate'
  | 'assembler';
export type BuildableType = Exclude<MachineType, 'core'>;
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
  /** E23.2.2: what a loaded pulse grew here (unset: plain grass and moss). Saved. */
  plant?: PlantKind;
}

/** E23.2.2: what grows from a pulse's load: a wildflower meadow (seeds), a region's rare plants, a grove (fertiliser). */
export type PlantKind = 'meadow' | 'rare' | 'grove';

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
  /** Ground generation version: 4 the city generator's ground, 5 the Old City (every game since E23.1.1). */
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
  /** E23.12 (#528): a Lucky Cat's Golden Relay: this relay carries power further, for good. */
  golden?: boolean;
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
   * 3 activation = built). E23.1.4: its counter prices went with the counters.
   */
  project?: { stage: number };
  /** Phase 5 E14: a superstructure's ability: charge (events), uses, automation switch. */
  ability?: { charge: number; used: number; auto?: boolean };
  /** E23.3: a power pole tripped by lightning (it carries nothing until bloombot resets it with one press). */
  tripped?: boolean;
  /** Look 6.8: a Cultivator's tillers (mobile units working dead ground near the dock), and tiles finished. */
  cult?: { units: CultivatorUnit[]; done: number };
  /** E23.6.3: a drone hub's (or Cultivator dock's) share of a Biomass item paid ahead (Lighter drones makes a job cost a fraction) */
  fuelCredit?: number;
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
  /** E23.6.4: a Courier on a route: the route, and what it carries to the route's target crate (none: going to fetch) */
  route?: string;
  cargo?: { item: import('./types').ItemId; n: number }[];
  /** E23.6.4: units of room it booked in the route's target before fetching (no two baskets count on the same room) */
  reserve?: number;
}

export type BuffType = 'solarFrenzy' | 'megaflower' | 'droneParty';
export interface Buff {
  type: BuffType;
  until: number;
  /** E23.12 (#528): where it was set off (a Solar Surge lights the panels near the cat; a Drone Party speeds the drones near it) */
  at?: { roofId: string; x: number; z: number };
}

export type CatRewardType = 'luckyHarvest' | 'solarFrenzy' | 'megaBloom' | 'droneParty' | 'jackpot' | 'goldenRelay' | 'catsGarden' | 'fogWhisker' | 'ripeAround';

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
  /**
   * Revealed but still sealed in thick fog until its gate opens (E21.5; E23.1.5: never bought). While sealed
   * the area behaves exactly as hidden fog (nothing can be walked, restored or built). Absent on older saves.
   */
  sealed?: boolean;
  /** E21.9: tiles in this area bloombot restored itself (helpers wait until it has done its share) */
  byBot?: number;
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

/** E21 §1: the eight materials. */
/** E23.5.1: biomass, food, compost and fertiliser are backpack items too (data/farm). */
export type MaterialId = 'scrap' | 'seeds' | 'copper' | 'timber' | 'glass' | 'clay' | 'gears' | 'sunstone' | 'biomass' | 'food' | 'compost' | 'fertiliser'
  // E23.8.3.2: from the mainland's industrial ruins only
  | 'steel';
/** E23.6.1 (#390): components made at the crafting table (data in src/data/crafting.ts). */
export type ComponentId = 'wire' | 'planks' | 'glassPane' | 'pipe' | 'motor' | 'batteryCell' | 'sunCell';
/** E23.6.1: anything the backpack and the store hold (materials and components; see src/data/items.ts). */
export type ItemId = MaterialId | ComponentId;
/** E21 §6: bloombot's abilities, one per fountain tier 1–4. */
export type AbilityId = 'pry' | 'hover' | 'climb' | 'glide';
/** E21 §8: where a Keeper is in its story. Woken (pulsed and handed 5 of anything) goes straight to request1. */
export type KeeperStep = 'asleep' | 'request1' | 'request2' | 'landmark' | 'settled';

export interface KeeperState {
  step: KeeperStep;
  /** asleep only: bloombot has pulsed it (it stirs; 5 of anything wakes it) */
  pulsed?: boolean;
  /** what has been handed over toward the current delivery (request 1 or the landmark) */
  given?: Partial<Record<MaterialId, number>>;
  /** E23.9.2: settled only: gifts it liked so far (FRIENDSHIP.giftsToFriend makes a friend) */
  hearts?: number;
  /** E23.9.2: sim time of the last gift it took (one a game day) */
  giftedAt?: number;
  /** E23.9.2: how many times a friend has chatted (which line comes next) */
  chats?: number;
  /** E23.9.2: the tile it is off to tend; `at` is when it finishes, set once it gets there */
  tending?: { x: number; z: number; at?: number };
}

/**
 * E21: everything the Old City adds to a save. Each part belongs to its own
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
  /** E21.13 (unused since E23.7.1: the clock lives in `GameState.clock`; kept until E23.1 bumps the save) */
  clockOffset: number;
  /** E23.7.4: when each pile that isn't full last gained a unit (sim time), by pile id: it refills from there */
  since?: Record<string, number>;
  /** E21.6 / E21.17: one-off items carried for the Great Bloom (the Heart Seed, the Star Lens) */
  items?: string[];
  /** E21.9: lasting region rewards in effect (data/oldcity RewardId), in the order they were won */
  rewards?: string[];
  /** E21.12: lookouts and vistas already seen, beacons spotted (presentation, but saved so they play once) */
  seen?: string[];
  /** E23.6.1: the crafting table's queue (recipe id, crafts left, seconds left on the one in hand) */
  craft?: { id: string; n: number; left: number }[];
  /** E23.6.1: decorations made at the crafting table (each once; placing copies after that is free) */
  decorMade?: string[];
  /** E23.5.1: restored tiles clipped for biomass, by tile id → sim time they can be gathered again */
  clipped?: Record<string, number>;
  /** E23.6.4: what each supply crate holds, by machine id */
  crates?: Record<string, Partial<Record<ItemId, number>>>;
  /** E23.6.4: courier routes the player set (from one crate to another, an item or everything) */
  routes?: { id: string; from: string; to: string; item: import('../data/automation').RouteItem }[];
  /** E23.6.4: how many times each job has been done by hand (it opens its automation) */
  hand?: Partial<Record<import('../data/automation').HandJob, number>>;
  /**
   * E23.6.5: each Assembler's recipe (an item id), seconds left on the craft in hand and what that craft took (given
   * back if it is stopped), and the crates the player chose as its input and output
   */
  assemblers?: Record<string, { recipe?: string; left?: number; taken?: Partial<Record<ItemId, number>>; input?: string; output?: string }>;
  /** E23.6.2: the research station (finds analysed, projects done and running, upgrade levels bought) */
  research?: ResearchState;
  /** E23.5.2: each planter's bed, by machine id (absent = empty, no extras) */
  planters?: Record<string, PlanterState>;
  /** E23.5.2.3: crops whose seeds have been found (data/crops CropId), in the order found */
  crops?: string[];
  /** E23.6.2: crossbreeds found (data/crops crossKey, e.g. 'radish+lettuce'), in the order found */
  crosses?: string[];
  /** E23.9.2: crops kept for the Keepers, by crop id (one from each harvest, up to FRIENDSHIP.basketMax) */
  basket?: Record<string, number>;
  /** E23.5.2.3: gathers counted toward each region's next seed packet, by region id */
  seedFinds?: Record<string, number>;
  /** E23.5.3: each compost bin's contents, by machine id */
  bins?: Record<string, BinState>;
  /** E23.5.3: biomass in each Bio Digester's hopper, by machine id */
  digesters?: Record<string, number>;
}

/** E23.5.3: what is in a compost bin (feed in feed units; progress in game days). */
export interface BinState {
  feed?: number;
  /** days toward the next compost */
  work?: number;
  compost?: number;
  /** days the oldest compost has matured */
  ripen?: number;
  fertiliser?: number;
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

/** E23.5.2: one planter box. */
export interface PlanterState {
  /** the crop growing (data/crops CropId); absent = empty */
  crop?: string;
  /** E23.6.2: a crossbreed's second parent (it grows like `crop`, with both parents' likes) */
  cross?: string;
  /** growth so far, in game days at full rate (ripe at the crop's `days`) */
  grown?: number;
  /** fed with fertiliser (until the next harvest) */
  fed?: boolean;
  /** extras built onto it */
  trellis?: boolean;
  flooded?: boolean;
}

export interface GameState {
  version: number;
  /** E21: the Old City's own state (E23.1.1: every game has it: one rule set). */
  salvage: SalvageState;
  seed: number;
  rngState: number;
  time: number;
  nextId: number;
  layers: LayerData[];
  /** Only present in a save being loaded: packed tile deltas per chunk (consumed by Sim). */
  tiles?: Record<string, string>;
  machines: MachineData[];
  /** Phase 5 E14: Superstructure Cores waiting to be placed (from merging three tier-2 machines). */
  cores?: { type: MachineType; upg?: Record<string, number>; role?: DroneRole; roles?: DroneRole[] }[];
  drones: DroneData[];
  upgrades: Record<string, number>;
  buffs: Buff[];
  /** City areas that have been revealed (frontier or further). Static area data comes from the seed. */
  areas: Record<string, AreaState>;
  /** Bridges and relays by link id (see data/rooftops LINKS). */
  links: Record<string, LinkState>;
  cat: CatState;
  progression: Progression;
  stats: Stats;
  /** Phase 4 E01: wall-clock time (ms since 1970) this state was last saved. */
  savedAt?: number;
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
  /** E23.4.1: water levels (share of capacity) of bodies that have changed, by body id `x,z`. Optional. */
  water?: {
    levels: Record<string, number>;
    /** E23.4.2.2: pipe tiles on the ground, `x,z`, sorted */
    pipes?: string[];
  };
  /** E23.2.3: old park benches mended, by id (`bench:x:z`). Optional, so no save version change. */
  rest?: { mended: string[] };
  /** E23.2.2.3: buried finds revealed (a mound shows) and dug up, by id (`bur:x:z`). Optional. */
  buried?: { known: string[]; dug: string[] };
  /** E23.2.2: what the pulse is loaded with (absent = nothing). Optional, so no save version change. */
  pulseLoad?: 'none' | 'seeds' | 'rare' | 'fertiliser';
  /** E23.3.5: stored energy of grid nodes that are not machines (solar garden lights), by node id. Optional. */
  power?: {
    cells?: Record<string, number>;
    /** E23.3.5: set once lights placed before night lighting have been carried over (see Lights.carryOver) */
    lights?: number;
  };
  /** E23.2.1: bloombot's charge (absent = full). Optional, so no save version change. */
  charge?: ChargeState;
  /** E23.7.1: the game-day clock (optional: a save without it starts on day 1's morning, in the game's own day) */
  clock?: ClockState;
}

/**
 * E23.7.1 (#395): the clock. Game time is sim time plus `offset` (only sleeping moves it). `real`: "follow my
 * clock", where the sky, the light and solar follow the real clock (timers still count in game days).
 * `nights`: night finds taken, by find id → the game day they were taken on (back the next night).
 */
export interface ClockState {
  offset: number;
  real?: boolean;
  nights?: Record<string, number>;
}

/** E23.2.1 (#371): bloombot's charge. */
export interface ChargeState {
  /** the charge now, 0 to the full charge */
  value: number;
  /** E23.6.2 research: battery cells fitted (each makes a full charge bigger) */
  cells?: number;
  /** E23.6.2 research: efficiency steps (each makes every cost a little smaller) */
  efficiency?: number;
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
  /** E23.3.5: line lights hung on power poles, pole machine id → light id (data/lights) */
  poleLights?: Record<string, string>;
}
