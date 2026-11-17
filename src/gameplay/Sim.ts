import { machinesStamp, rulesOf } from '../core/GameState';
import { decorOccupant, parseDecorKey } from '../core/Decor';
import { EventBus } from '../app/EventBus';
import { Economy } from '../core/Economy';
import { Grid } from '../core/Grid';
import { hasGrowth, unpackChunk } from '../core/TilePack';
import { Rng } from '../core/Rng';
import type { GameState, MachineData, Rules, TileData } from '../core/types';
import { BloomChainSystem } from './BloomChainSystem';
import { BuildSystem } from './BuildSystem';
import { CanalNetwork } from './CanalNetwork';
import { RelaySystem } from './RelaySystem';
import { RooftopClusters } from './RooftopClusters';
import { DistrictSystem } from './DistrictSystem';
import { DroneSystem } from './DroneSystem';
import { DroneRoles } from './DroneRoles';
import { Advisor } from './Advisor';
import { LuckyCatSystem } from './LuckyCatSystem';
import { AreaSystem } from './AreaSystem';
import { DebugLog } from './DebugLog';
import { OfflineSystem } from './OfflineSystem';
import { FrenzySystem } from './FrenzySystem';
import { EconomyLedger } from './EconomyLedger';
import { Modifiers } from './Modifiers';
import { WorldEventSystem } from './WorldEventSystem';
import { Metrics } from './Metrics';
import { MilestoneSystem } from './Milestones';
import { MergeSystem } from './MergeSystem';
import { SuperSystem } from './SuperSystem';
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

/**
 * Headless, deterministic game simulation. Owns no rendering.
 * Everything that changes the game goes through here; the renderer only listens to `bus`.
 */
export class Sim {
  readonly grid: Grid;
  readonly econ: Economy;
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
  readonly offline: OfflineSystem;
  readonly frenzy: FrenzySystem;
  readonly ledger: EconomyLedger;
  readonly mods: Modifiers;
  readonly areas: AreaSystem;
  readonly districts: DistrictSystem;
  readonly canals: CanalNetwork;
  readonly relays: RelaySystem;
  readonly clusters: RooftopClusters;
  readonly milestones: MilestoneSystem;
  readonly merge: MergeSystem;
  readonly supers: SuperSystem;
  /** Phase 5 E15: world events. */
  readonly events: WorldEventSystem;
  /** Phase 5 E16: biodiversity and fauna unlocks (cosmetic). */
  readonly ecosystem: EcosystemSystem;
  /** Look 6: living transitions (what each tile is visibly turning into). */
  readonly transitions: Transitions;
  /** Look 6.8: Cultivators (solar tillers). */
  readonly cultivators: CultivatorSystem;
  /** E21.1: the backpack and the store (old-city rules). */
  readonly inventory: Inventory;
  /** E21.2: salvage piles, seams and Reclaimers (old-city rules). */
  readonly salvage: SalvageSystem;
  /** E21.5: gates (old-city rules). */
  readonly gates: GateSystem;
  /**
   * E21.1: where bloombot stands right now (the game sets it every frame; bots and tests set it themselves).
   * Never saved. Rules that depend on bloombot's position (paying from the store within reach) read it.
   */
  bot?: BotAt;

  constructor(
    readonly state: GameState,
    readonly bus: EventBus = new EventBus(),
  ) {
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
      this.production?.chunkLoaded(c.key);
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
    this.econ = new Economy(state.resources, state.caps);
    this.inventory = new Inventory(this);
    this.salvage = new SalvageSystem(this);
    this.gates = new GateSystem(this);
    this.rng = new Rng(state.rngState);
    this.upgrades = new UpgradeSystem(this);
    this.production = new ProductionSystem(this);
    this.restoration = new RestorationSystem(this);
    this.canals = new CanalNetwork(this);
    this.relays = new RelaySystem(this);
    this.clusters = new RooftopClusters(this);
    this.chains = new BloomChainSystem(this);
    this.build = new BuildSystem(this);
    this.drones = new DroneSystem(this);
    this.roles = new DroneRoles(this);
    this.cultivators = new CultivatorSystem(this);
    this.cat = new LuckyCatSystem(this);
    this.advisor = new Advisor(this);
    this.progression = new ProgressionSystem(this);
    this.areas = new AreaSystem(this);
    this.districts = new DistrictSystem(this);
    this.milestones = new MilestoneSystem(this);
    this.merge = new MergeSystem(this);
    this.supers = new SuperSystem(this);
    this.ecosystem = new EcosystemSystem(this);
    this.metrics = new Metrics(this);
    this.log = new DebugLog(this);
    this.offline = new OfflineSystem(this);
    this.frenzy = new FrenzySystem(this);
    this.ledger = new EconomyLedger(this);
    this.events = new WorldEventSystem(this);
    this.mods = new Modifiers(this);
    this.econ.onOverflow = (k, a, frenzy) => {
      this.log.onOverflow(k, a);
      if (frenzy) this.frenzy.onOverflow(k, a);
    };
    this.restoration.adoptGrowing();
    for (const c of this.grid.loadedChunks()) for (const t of c.tiles) if (t?.tr) this.transitions.adopt(t);
    this.upgrades.applyCaps();
  }

  get time() {
    return this.state.time;
  }

  /** E21: the rule set, from the state (never from the URL). */
  get rules(): Rules {
    return rulesOf(this.state);
  }

  /** E21: playing under old-city rules? */
  get oldCity(): boolean {
    return this.state.rules === 'oldcity';
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
    this.frenzy.tick();
    this.production.tick(dt);
    this.restoration.tick(dt);
    this.transitions.tick();
    this.chains.tick();
    this.drones.tick(dt);
    this.roles.tick(dt);
    this.cultivators.tick(dt);
    this.salvage.tick(dt);
    this.supers.tick(dt);
    this.cat.tick();
    this.events.tick();
    this.progression.tick();
    this.milestones.tick();
    this.ecosystem.tick();
    this.metrics.tick(dt);
    this.ledger.tick();
    s.rngState = this.rng.state;
  }

  /** Runs `seconds` of simulated time in fixed steps (tests, catch-up). */
  advance(seconds: number) {
    const steps = Math.round(seconds / TUNING.simStep);
    for (let i = 0; i < steps; i++) this.tick(TUNING.simStep);
  }

  harvestSun(): boolean {
    const s = this.state;
    if (s.time < s.harvestReadyAt) {
      this.bus.emit('action.failed', { reason: `Sunlight gathers again in ${Math.ceil(s.harvestReadyAt - s.time)} s` });
      return false;
    }
    // Phase 5 E12: Harvest on a full store never charges Bloom Frenzy (no tapping a maxed store for charge).
    const got = this.econ.add('energy', TUNING.harvest.energy, { frenzy: false });
    s.harvestReadyAt = s.time + TUNING.harvest.cooldown;
    this.bus.emit('harvest', { amount: got });
    if (got.gt(0)) this.bus.emit('resource.gain', { kind: 'energy', amount: got, reason: 'harvest' });
    // Phase 5 E12: Harvest Burst also gathers seconds of steady biomass income (no temporary boosts).
    const burst = this.upgrades.harvestBurstSeconds;
    if (burst > 0) {
      const b = this.econ.add('biomass', this.production.rates(true).biomass.mul(burst));
      if (b.gt(0)) this.bus.emit('resource.gain', { kind: 'biomass', amount: b, reason: 'harvest' });
    }
    return true;
  }
}
