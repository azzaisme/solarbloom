import { machinesStamp } from '../core/GameState';
import { decorOccupant, parseDecorKey } from '../core/Decor';
import { EventBus } from '../app/EventBus';
import { Grid } from '../core/Grid';
import { inRect } from '../core/OldCityLayout';
import { REGIONS } from '../data/oldcity';
import { hasGrowth, unpackChunk } from '../core/TilePack';
import { Rng } from '../core/Rng';
import type { GameState, MachineData, TileData } from '../core/types';
import { BloomChainSystem } from './BloomChainSystem';
import { BuildSystem } from './BuildSystem';
import { RelaySystem } from './RelaySystem';
import { PowerGrid } from './PowerGrid';
import { ChargerSystem } from './ChargerSystem';
import { Lights } from './Lights';
import { DroneSystem } from './DroneSystem';
import { DroneRoles } from './DroneRoles';
import { Advisor } from './Advisor';
import { LuckyCatSystem } from './LuckyCatSystem';
import { AreaSystem } from './AreaSystem';
import { DebugLog } from './DebugLog';
import { Metrics } from './Metrics';
import { EcosystemSystem } from './Ecosystem';
import { ProductionSystem } from './ProductionSystem';
import { ProgressionSystem } from './ProgressionSystem';
import { RestorationSystem } from './RestorationSystem';
import { UpgradeSystem } from './UpgradeSystem';
import { TUNING } from '../data/tuning';
import { Transitions } from './Transitions';
import { CultivatorSystem } from './CultivatorSystem';
import { Inventory, type BotAt } from './Inventory';
import { SalvageSystem } from './SalvageSystem';
import { GateSystem } from './GateSystem';
import { MoveSpots } from './MoveSpots';
import { FountainSystem } from './FountainSystem';
import { JournalSystem } from './JournalSystem';
import { KeeperSystem } from './KeeperSystem';
import { MainlandSystem } from './MainlandSystem';
import { LandmarkSystem } from './LandmarkSystem';
import { WaterSystem } from './WaterSystem';
import { Crafting } from './Crafting';
import { Research } from './Research';
import { ParkGrowth } from './ParkGrowth';
import { ChargeSystem } from './Charge';
import { Automation } from './Automation';
import { PulseLoad } from './PulseLoad';
import { RestSystem } from './Rest';
import { WildlifeSystem } from './Wildlife';
import { BuriedSystem } from './Buried';
import { DroneFuel } from './DroneFuel';
import { Clock } from './Clock';
import { NightFinds } from './NightFinds';
import { GatherSystem } from './GatherSystem';
import { FarmSystem } from './FarmSystem';
import { CompostSystem } from './CompostSystem';
import { FarmExtras } from './FarmExtras';
import { Weather } from './Weather';

/**
 * Headless, deterministic game simulation. Owns no rendering.
 * Everything that changes the game goes through here; the renderer only listens to `bus`.
 */
export class Sim {
  readonly grid: Grid;
  readonly rng: Rng;
  readonly upgrades: UpgradeSystem;
  readonly production: ProductionSystem;
  readonly restoration: RestorationSystem;
  readonly chains: BloomChainSystem;
  readonly build: BuildSystem;
  readonly drones: DroneSystem;
  /** E18: drone roles (unlocks, refits, each role's jobs). */
  readonly roles: DroneRoles;
  readonly cat: LuckyCatSystem;
  readonly advisor: Advisor;
  readonly progression: ProgressionSystem;
  readonly metrics: Metrics;
  readonly log: DebugLog;
  readonly areas: AreaSystem;
  readonly relays: RelaySystem;
  /** E23.3: the power grid (networks of poles, sources, batteries and consumers). */
  readonly power: PowerGrid;
  /** E23.3.3: chargers (bloombot recharges on a powered pad). */
  readonly chargers: ChargerSystem;
  /** E23.3.5: night lights (decorations on the grid, solar or glow-pods). */
  readonly lights: Lights;
  /** Phase 5 E16: biodiversity and fauna unlocks (cosmetic). */
  readonly ecosystem: EcosystemSystem;
  /** Look 6: living transitions (what each tile is visibly turning into). */
  readonly transitions: Transitions;
  /** Look 6.8: Cultivators (solar tillers). */
  readonly cultivators: CultivatorSystem;
  /** E21.1: the backpack and the store. */
  readonly inventory: Inventory;
  /** E21.2 / E23.7.4: salvage piles, refilling over game days and in storms. */
  readonly salvage: SalvageSystem;
  /** E21.5: gates. */
  readonly gates: GateSystem;
  /** E25 (#626): the vaults, stashes and trips the level II moves are for. */
  readonly moves: MoveSpots;
  /** E21.6: the fountain's tiers and deliveries. */
  readonly fountain: FountainSystem;
  /** E21.8: the Keepers and their requests. */
  readonly keepers: KeeperSystem;
  /** E23.8.3: the causeway and the endless mainland. */
  readonly mainland: MainlandSystem;
  /** E23.9.1: the maker's journal (pages on posts, his last page at the Great Bloom). */
  readonly journal: JournalSystem;
  /** E21.9: waking landmarks and their lasting rewards. */
  readonly landmarks: LandmarkSystem;
  /** E23.4.1: water levels of ponds, canals and reservoirs (`sim.water`). */
  readonly water: WaterSystem;
  /** E23.6.1: the crafting table (components; machine and decoration recipes). */
  readonly crafting: Crafting;
  /** E23.6.2: the research station (projects, and the upgrades they open). */
  readonly research: Research;
  /** #622: what greening the park has grown Bloombot into */
  readonly parkGrowth: ParkGrowth;
  /** E23.2.1: bloombot's charge, the only meter. */
  readonly charge: ChargeSystem;
  /** E23.6.4 / E23.6.5: supply crates, courier routes and jobs done by hand, the Assembler. */
  readonly automation: Automation;
  /** E23.2.2: what the pulse is loaded with, and its reveal ripple. */
  readonly pulseLoad: PulseLoad;
  /** E23.2.3: benches and meditating at chargers. */
  readonly rest: RestSystem;
  /** E23.2.4: wildlife visits by diversity, and the visitor log */
  readonly wildlife: WildlifeSystem;
  /** E23.2.2.3: seeds and salvage buried in open ground (the ripple reveals them). */
  readonly buried: BuriedSystem;
  /** E23.6.3: what drones run on (power, water, biomass by role). */
  readonly droneFuel: DroneFuel;
  /** E23.7.1: the game-day clock (timers) and the light clock (sky, light, solar). See gameplay/Clock. */
  readonly clock: Clock;
  /** E23.7.1.3: finds that are out only at night. */
  readonly nightFinds: NightFinds;
  /** E23.7.2: the weather: one kind a game day, each with its effects (data/weather). See gameplay/Weather. */
  readonly weather: Weather;
  /** E23.5.1: gathering biomass from restored ground. */
  readonly gather: GatherSystem;
  /** E23.5.2: planters and crops. */
  readonly farm: FarmSystem;
  /** E23.5.3: compost bins and Bio Digesters (old-city rules). */
  readonly compost: CompostSystem;
  /** E23.5.4: hives, ponds, orchards, logs, worm bins, wildlife homes and Keeper gardens (old-city rules). */
  readonly farmExtras: FarmExtras;
  /**
   * E21.1: where bloombot stands right now (the game sets it every frame; bots and tests set it themselves).
   * Never saved. Rules that depend on bloombot's position (paying from the store within reach) read it.
   */
  bot?: BotAt;

  constructor(
    readonly state: GameState,
    readonly bus: EventBus = new EventBus(),
  ) {
    dryOccupiedPonds(state); // before any tile is generated
    this.grid = new Grid(state.seed, state.layers);
    this.transitions = new Transitions(this);
    // Saved tile deltas are applied as each chunk is generated; occupancy is rebuilt from the machines.
    this.grid.pending = { ...(state.tiles ?? {}) };
    delete state.tiles;
    for (const m of state.machines) this.grid.indexMachine(m);
    // E19.2: decorations occupy their tile as machines do (the game writes them; the sim only stamps occupancy).
    for (const k of Object.keys(state.cozy?.decor ?? {})) this.grid.indexDecor(k);
    this.grid.onChunkCreated = (c) => {
      const p = this.grid.pending[c.key];
      delete this.grid.pending[c.key];
      if (p) unpackChunk(c, p);
      c.packed = p ?? '';
      if (p && this.transitions) for (const t of c.tiles) if (t?.tr) this.transitions.adopt(t);
      for (const m of this.grid.machinesInChunk(c.key)) for (const t of this.grid.footprint(m.roofId, m.x, m.z, m.size)) if (t) t.occupantId = m.id;
      for (const k of this.grid.decorInChunk(c.key)) {
        const at = parseDecorKey(k)!;
        const t = this.grid.peek(at.roofId, at.x, at.z);
        if (t && !t.occupantId) t.occupantId = decorOccupant(k);
      }
    };
    // The world travels with the state (for saving) but is never part of its JSON.
    Object.defineProperty(state, 'world', { value: this.grid, enumerable: false, configurable: true, writable: true });
    for (const l of this.grid.rooftops) this.grid.tilesOf(l.id);
    // Saved chunks load lazily when first touched (production estimates them meanwhile), except chunks
    // with growth in progress, which must keep growing.
    for (const [key, p] of Object.entries(this.grid.pending)) {
      if (!hasGrowth(p)) continue;
      const [layer, cx, cz] = key.split('|');
      this.grid.chunkAt(layer, Number(cx), Number(cz));
    }
    this.inventory = new Inventory(this);
    this.charge = new ChargeSystem(this);
    this.pulseLoad = new PulseLoad(this);
    this.rest = new RestSystem(this);
    this.wildlife = new WildlifeSystem(this);
    this.buried = new BuriedSystem(this);
    this.landmarks = new LandmarkSystem(this);
    this.clock = new Clock(this);
    this.nightFinds = new NightFinds(this);
    this.weather = new Weather(this);
    this.salvage = new SalvageSystem(this);
    this.gates = new GateSystem(this);
    this.moves = new MoveSpots(this);
    this.fountain = new FountainSystem(this);
    this.keepers = new KeeperSystem(this);
    this.crafting = new Crafting(this);
    this.research = new Research(this);
    this.parkGrowth = new ParkGrowth(this);
    this.droneFuel = new DroneFuel(this);
    this.mainland = new MainlandSystem(this);
    this.journal = new JournalSystem(this);
    this.gather = new GatherSystem(this);
    this.farm = new FarmSystem(this);
    this.compost = new CompostSystem(this);
    this.farmExtras = new FarmExtras(this);
    this.rng = new Rng(state.rngState);
    this.upgrades = new UpgradeSystem(this);
    this.production = new ProductionSystem(this);
    this.restoration = new RestorationSystem(this);
    this.water = new WaterSystem(this);
    this.relays = new RelaySystem(this);
    this.power = new PowerGrid(this);
    this.automation = new Automation(this); // E23.6.4: after the grid (the Assembler is a consumer)
    this.chargers = new ChargerSystem(this);
    this.lights = new Lights(this);
    this.chains = new BloomChainSystem(this);
    this.build = new BuildSystem(this);
    this.drones = new DroneSystem(this);
    this.roles = new DroneRoles(this);
    this.cultivators = new CultivatorSystem(this);
    this.cat = new LuckyCatSystem(this);
    this.advisor = new Advisor(this);
    this.progression = new ProgressionSystem(this);
    this.areas = new AreaSystem(this);
    this.ecosystem = new EcosystemSystem(this);
    this.metrics = new Metrics(this);
    this.log = new DebugLog(this);
    this.restoration.adoptGrowing();
    for (const c of this.grid.loadedChunks()) for (const t of c.tiles) if (t?.tr) this.transitions.adopt(t);
    this.mainland.wire(); // E23.8.3.2: after every system (the grid and water network) is built
  }

  get time() {
    return this.state.time;
  }

  newId(prefix: string) {
    return `${prefix}${this.state.nextId++}`;
  }

  private machineMap = new Map<string, MachineData>();
  private machineCount = -1;
  /** O(1) machine lookup (the index rebuilds when machines are added). */
  machine(id: string | undefined): MachineData | undefined {
    if (!id) return undefined;
    const ms = this.state.machines;
    if (this.machineCount !== machinesStamp(ms)) {
      this.machineMap.clear();
      for (const m of ms) this.machineMap.set(m.id, m);
      this.machineCount = machinesStamp(ms);
    }
    return this.machineMap.get(id);
  }

  /** Test switch: every per-tick machine lookup scans the whole machine list (the active-region equivalence test). */
  fullScan = false;
  private byType = new Map<string, MachineData[]>();
  private byTypeCount = -1;
  /** Machines of one type, in build order (the index rebuilds whenever machines are added or removed). */
  machinesOfType(type: MachineData['type']): MachineData[] {
    const ms = this.state.machines;
    if (this.fullScan) return ms.filter((m) => m.type === type);
    if (this.byTypeCount !== machinesStamp(ms)) {
      this.byType.clear();
      for (const m of ms) {
        let list = this.byType.get(m.type);
        if (!list) this.byType.set(m.type, (list = []));
        list.push(m);
      }
      this.byTypeCount = machinesStamp(ms);
    }
    return this.byType.get(type) ?? [];
  }

  /**
   * City 06.1: the chunks where anything happens on its own this tick: growing tiles, charging machines
   * (condensers, filling basins), drones and their hubs, and queued chain events. Everything else is at rest:
   * no system visits it per tick (diagnostic; the systems keep these sets themselves).
   */
  activeChunks(): Set<string> {
    const out = new Set<string>();
    const key = (layer: string, x: number, z: number) => `${layer}|${Math.floor(x / 16)}|${Math.floor(z / 16)}`;
    for (const t of this.restoration.growingTiles()) out.add(key(t.roofId, t.x, t.z));
    for (const type of ['condenser', 'reservoirGarden', 'droneHub'] as const) for (const m of this.machinesOfType(type)) out.add(key(m.roofId, m.x, m.z));
    for (const d of this.state.drones) {
      const hub = this.machine(d.hubId);
      if (hub) out.add(key(hub.roofId, d.px ?? hub.x, d.pz ?? hub.z));
    }
    for (const id of this.chains.queuedTargets()) {
      const t = this.grid.byTileId(id) ?? this.machine(id);
      if (t) out.add(key(t.roofId, t.x, t.z));
    }
    return out;
  }

  occupant(t: TileData): MachineData | undefined {
    return this.machine(t.occupantId);
  }

  isCoreTile(t: TileData) {
    return this.occupant(t)?.type === 'core';
  }

  /** One fixed simulation step. */
  tick(dt: number = TUNING.simStep) {
    const s = this.state;
    s.time += dt;
    s.buffs = s.buffs.filter((b) => b.until > s.time);
    this.lights.tick(dt);
    this.power.tick(dt);
    this.chargers.tick(dt);
    this.production.tick(dt);
    this.restoration.tick(dt);
    this.transitions.tick();
    this.chains.tick();
    this.drones.tick(dt);
    this.cultivators.tick(dt);
    this.salvage.tick(dt);
    this.water.tick(dt);
    this.rest.tick(dt);
    this.wildlife.tick();
    this.crafting.tick(dt);
    this.automation.tick(dt);
    this.research.tick(dt);
    this.parkGrowth.tick(dt);
    this.charge.tick(dt);
    this.clock.tick();
    this.weather.tick();
    this.farm.tick(dt);
    this.compost.tick(dt);
    this.farmExtras.tick(dt);
    this.keepers.tick(dt); // E23.9.2: settled Keepers tend their regions
    this.cat.tick();
    this.progression.tick();
    this.fountain.tick();
    this.ecosystem.tick();
    this.metrics.tick(dt);
    s.rngState = this.rng.state;
  }

  /** Runs `seconds` of simulated time in fixed steps (tests, catch-up). */
  advance(seconds: number) {
    const steps = Math.round(seconds / TUNING.simStep);
    for (let i = 0; i < steps; i++) this.tick(TUNING.simStep);
  }
}

/**
 * E23.5.4.6: the Keeper ponds came after some games began. On a save's first load since then (never again), a pond
 * whose spot already holds something the player built (a machine or a decoration) stays dry land in that save (`dryPonds` on the ground layer), and its Keeper's garden is
 * watered by rain or pipes as any other. Nothing the player made ends up under water.
 */
export function dryOccupiedPonds(state: GameState) {
  const ground = state.layers.find((l) => l.kind === 'ground');
  if (!ground || ground.pondsChecked) return; // once per save: later builds can't stand on a pond (BuildSystem)
  ground.pondsChecked = true;
  const cells: { x: number; z: number }[] = [];
  for (const m of state.machines) if (m.roofId === ground.id) for (let dx = 0; dx < m.size; dx++) for (let dz = 0; dz < m.size; dz++) cells.push({ x: m.x + dx, z: m.z + dz });
  for (const k of Object.keys(state.cozy?.decor ?? {})) {
    const at = parseDecorKey(k);
    if (at && at.roofId === ground.id) cells.push(at);
  }
  for (const r of REGIONS) {
    if (ground.dryPonds?.includes(r.id)) continue;
    if (r.ponds?.some((q) => cells.some((c) => inRect(q, c.x, c.z)))) (ground.dryPonds ??= []).push(r.id);
  }
}
