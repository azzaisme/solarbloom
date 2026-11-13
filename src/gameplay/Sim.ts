import { EventBus } from '../app/EventBus';
import { Economy } from '../core/Economy';
import { Grid } from '../core/Grid';
import { Rng } from '../core/Rng';
import type { GameState, MachineData, TileData } from '../core/types';
import { BloomChainSystem } from './BloomChainSystem';
import { BuildSystem } from './BuildSystem';
import { DroneSystem } from './DroneSystem';
import { LuckyCatSystem } from './LuckyCatSystem';
import { Metrics } from './Metrics';
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
  readonly progression: ProgressionSystem;
  readonly metrics: Metrics;

  constructor(
    readonly state: GameState,
    readonly bus: EventBus = new EventBus(),
  ) {
    this.grid = new Grid(state.rooftops);
    this.econ = new Economy(state.resources, state.caps);
    this.rng = new Rng(state.rngState);
    this.upgrades = new UpgradeSystem(this);
    this.production = new ProductionSystem(this);
    this.restoration = new RestorationSystem(this);
    this.chains = new BloomChainSystem(this);
    this.build = new BuildSystem(this);
    this.drones = new DroneSystem(this);
    this.cat = new LuckyCatSystem(this);
    this.progression = new ProgressionSystem(this);
    this.metrics = new Metrics(this);
    this.upgrades.applyCaps();
  }

  get time() {
    return this.state.time;
  }

  newId(prefix: string) {
    return `${prefix}${this.state.nextId++}`;
  }

  machine(id: string | undefined): MachineData | undefined {
    return id ? this.state.machines.find((m) => m.id === id) : undefined;
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
