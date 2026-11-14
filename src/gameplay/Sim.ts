import { EventBus } from '../app/EventBus';
import { Economy } from '../core/Economy';
import { Grid } from '../core/Grid';
import { hasGrowth, unpackChunk } from '../core/TilePack';
import { Rng } from '../core/Rng';
import type { GameState, MachineData, TileData } from '../core/types';
import { BloomChainSystem } from './BloomChainSystem';
import { BuildSystem } from './BuildSystem';
import { CanalNetwork } from './CanalNetwork';
import { DistrictSystem } from './DistrictSystem';
import { DroneSystem } from './DroneSystem';
import { Advisor } from './Advisor';
import { LuckyCatSystem } from './LuckyCatSystem';
import { AreaSystem } from './AreaSystem';
import { Metrics } from './Metrics';
import { MilestoneSystem } from './Milestones';
import { NeighbourhoodSystem } from './NeighbourhoodSystem';
import { ProductionSystem } from './ProductionSystem';
import { ProgressionSystem } from './ProgressionSystem';
import { RestorationSystem } from './RestorationSystem';
import { UpgradeSystem } from './UpgradeSystem';
import { TUNING } from '../data/tuning';

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
  readonly cat: LuckyCatSystem;
  readonly advisor: Advisor;
  readonly progression: ProgressionSystem;
  readonly metrics: Metrics;
  readonly hood: NeighbourhoodSystem;
  readonly areas: AreaSystem;
  readonly districts: DistrictSystem;
  readonly canals: CanalNetwork;
  readonly milestones: MilestoneSystem;

  constructor(
    readonly state: GameState,
    readonly bus: EventBus = new EventBus(),
  ) {
    this.grid = new Grid(state.seed, state.layers);
    // Saved tile deltas are applied as each chunk is generated; occupancy is rebuilt from the machines.
    this.grid.pending = { ...(state.tiles ?? {}) };
    delete state.tiles;
    for (const m of state.machines) this.grid.indexMachine(m);
    this.grid.onChunkCreated = (c) => {
      const p = this.grid.pending[c.key];
      delete this.grid.pending[c.key];
      if (p) unpackChunk(c, p);
      c.packed = p ?? '';
      for (const m of this.grid.machinesInChunk(c.key)) for (const t of this.grid.footprint(m.roofId, m.x, m.z, m.size)) if (t) t.occupantId = m.id;
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
    this.rng = new Rng(state.rngState);
    this.upgrades = new UpgradeSystem(this);
    this.production = new ProductionSystem(this);
    this.restoration = new RestorationSystem(this);
    this.canals = new CanalNetwork(this);
    this.chains = new BloomChainSystem(this);
    this.build = new BuildSystem(this);
    this.drones = new DroneSystem(this);
    this.cat = new LuckyCatSystem(this);
    this.advisor = new Advisor(this);
    this.progression = new ProgressionSystem(this);
    this.hood = new NeighbourhoodSystem(this);
    this.areas = new AreaSystem(this);
    this.districts = new DistrictSystem(this);
    this.milestones = new MilestoneSystem(this);
    this.metrics = new Metrics(this);
    this.restoration.adoptGrowing();
    this.upgrades.applyCaps();
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
    if (this.machineCount !== ms.length) {
      this.machineMap.clear();
      for (const m of ms) this.machineMap.set(m.id, m);
      this.machineCount = ms.length;
    }
    return this.machineMap.get(id);
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
    this.production.tick(dt);
    this.restoration.tick(dt);
    this.chains.tick();
    this.drones.tick(dt);
    this.cat.tick();
    this.progression.tick();
    this.milestones.tick();
    this.metrics.tick(dt);
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
    const got = this.econ.add('energy', TUNING.harvest.energy);
    s.harvestReadyAt = s.time + TUNING.harvest.cooldown;
    this.bus.emit('harvest', { amount: got });
    if (got > 0) this.bus.emit('resource.gain', { kind: 'energy', amount: got, reason: 'harvest' });
    return true;
  }
}
