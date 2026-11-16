import { big, ceilBig, Decimal } from '../core/Big';
import { KINDS, formatCost } from '../core/Economy';
import { machinesStamp } from '../core/GameState';
import { distToFootprint } from '../core/Grid';
import type { Cost, MachineData, MachineType, ResourceKind, TileData } from '../core/types';
import { TIER3, isBuilt, machineName } from '../data/machines';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

/**
 * Phase 5 E14: superstructures. Three tier-2 machines merge into a Superstructure Core (MergeSystem). A core is
 * placed like a building on any valid footprint (2×2, the Tree of Life 3×3), which pays the foundation; assembly
 * and activation are paid when the player can (no timers). Stage prices come from steady biomass income when the
 * core is placed (plus a share of the energy and water stores for the later stages) and are locked then.
 *
 * A built superstructure keeps its family's job at tier 3 (output index TUNING.super.outputMult) and gains an ability:
 * - Solar Megaflower: Solar Burst, every panel's energy ×3 for 15 s (the strongest solar boost wins, never a product)
 * - Water Nexus: Irrigation Wave, up to 24 connected dry or growing tiles bloom, nearest first
 * - Tree of Life: Evolution, the 12 least-grown tiles in reach grow a stage; stores up to 3 charges
 * - Drone Megahub: Swarm, 6 extra drones for 30 s, each restoring several tiles per job (pulse costs as usual)
 *
 * Abilities charge from restorations within reach (the Megahub from its own drones' finished jobs), never from
 * time alone, and never from the chain of their own release. They're fired by hand, or automatically once used
 * by hand. With nothing to act on, the Megahub says so and keeps its charge; the Nexus and the Tree of Life pay a
 * small biomass bounty instead (pacing pass).
 */

export type SuperKind = 'megaflower' | 'nexus' | 'treeOfLife' | 'megahub';
export const SUPER_KIND: Partial<Record<MachineType, SuperKind>> = { solar: 'megaflower', condenser: 'nexus', pollinator: 'treeOfLife', droneHub: 'megahub' };

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
  /** the three stage prices, locked at placement */
  costs: Cost[];
  size: number;
}

export class SuperSystem {
  constructor(private sim: Sim) {
    const s = sim;
    // Charge: restorations within reach (outside the structure's own ability chains).
    s.bus.on('tile.restored', ({ tile, chainId }) => {
      if (this.abilityChains.has(chainId)) return;
      for (const m of s.grid.machinesNear(tile.roofId, tile.x, tile.z, 6)) {
        const k = this.kind(m);
        if (!k || k === 'megahub' || !isBuilt(m)) continue;
        if (distToFootprint(tile.x, tile.z, m.x, m.z, m.size) > TUNING.super[k].reach) continue;
        this.addCharge(m, 1);
      }
    });
    // The Tree of Life also gathers tiles growing a stage within reach (bloom events, not just restorations).
    s.bus.on('tile.nurtured', ({ tile }) => {
      if (this.growingFromAbility) return;
      for (const m of s.grid.machinesNear(tile.roofId, tile.x, tile.z, 7)) {
        if (this.kind(m) !== 'treeOfLife' || !isBuilt(m)) continue;
        if (distToFootprint(tile.x, tile.z, m.x, m.z, m.size) <= TUNING.super.treeOfLife.reach) this.addCharge(m, 1);
      }
    });
    s.bus.on('chain.ended', ({ chainId }) => this.abilityChains.delete(chainId));
  }

  /** Chains started by abilities (their restorations don't charge anything). */
  private abilityChains = new Set<number>();
  /** While an ability chain is being processed, its growth doesn't charge the Tree of Life either. */
  get growingFromAbility(): boolean {
    return [...this.abilityChains].some((id) => this.sim.chains.isRunning(id));
  }

  kind(m: MachineData | undefined): SuperKind | undefined {
    return m && (m.tier ?? 1) >= 3 ? SUPER_KIND[m.type] : undefined;
  }

  // ───────────── cores and construction ─────────────

  cores(): { type: MachineType; upg?: Record<string, number>; role?: MachineData['role']; roles?: MachineData['roles'] }[] {
    return this.sim.state.cores ?? [];
  }

  coreCount(type: MachineType): number {
    return this.cores().filter((c) => c.type === type).length;
  }

  /** The three stage prices if a core were placed now. */
  stageCosts(): Cost[] {
    const s = this.sim;
    const S = TUNING.super;
    const rate = s.production.rates(true).biomass;
    return S.stageSeconds.map((sec, i) => {
      const c: Cost = { biomass: Decimal.max(S.stageMin[i], ceilBig(rate.mul(sec))) };
      const e = s.econ.cap('energy');
      const w = s.econ.cap('water');
      if (S.stageEnergyShare[i] && e) c.energy = e.mul(S.stageEnergyShare[i]).floor();
      if (S.stageWaterShare[i] && w) c.water = w.mul(S.stageWaterShare[i]).floor();
      return c;
    });
  }

  /** Converts a cursor cell into the footprint anchor (centred on the pointer). */
  anchorFor(type: MachineType, fx: number, fz: number): { x: number; z: number } {
    const size = TIER3[type]?.size ?? 2;
    return { x: Math.floor(fx - size / 2 + 0.5), z: Math.floor(fz - size / 2 + 0.5) };
  }

  check(type: MachineType, roofId: string, x: number, z: number): PlaceCheck {
    const s = this.sim;
    const def = TIER3[type];
    const costs = this.stageCosts();
    const size = def?.size ?? 2;
    const fail = (reason: string): PlaceCheck => ({ ok: false, reason, costs, size });
    if (!def) return fail('Not a superstructure');
    if (!this.coreCount(type)) return fail(`No ${def.name} core yet: merge three tier-2 machines`);
    const roof = s.grid.roof(roofId);
    if (!roof || !roof.unlocked || roof.preview) return fail('This rooftop is not reachable yet');
    const why = s.build.footprintProblem(roofId, x, z, size, ['restored', 'prepared']);
    if (why) return fail(why);
    if (!s.econ.canAfford(costs[0])) return fail(`Foundation needs ${formatCost(costs[0])}`);
    return { ok: true, costs, size };
  }

  /** Places a core: pays the foundation, uses the core. Undefined (nothing changed) if it can't. */
  place(type: MachineType, roofId: string, x: number, z: number): MachineData | undefined {
    const s = this.sim;
    const chk = this.check(type, roofId, x, z);
    if (!chk.ok) {
      s.bus.emit('action.failed', { reason: chk.reason! });
      return undefined;
    }
    if (!s.econ.spend(chk.costs[0])) return undefined;
    const list = this.cores();
    const i = list.findIndex((c) => c.type === type);
    const core = list[i];
    s.state.cores = list.filter((_, j) => j !== i);
    const m: MachineData = {
      id: s.newId('m'),
      type,
      roofId,
      x,
      z,
      size: chk.size,
      tier: 3,
      boostUntil: 0,
      timer: 0,
      charge: 0,
      project: { stage: 1, costs: chk.costs.map((c) => toStrings(c)) },
      ability: { charge: 0, used: 0 },
      ...(core.upg ? { upg: { ...core.upg } } : {}),
      ...(core.role ? { role: core.role } : {}),
      ...(core.roles ? { roles: [...core.roles] } : {}),
    };
    s.state.machines.push(m);
    for (const c of s.grid.footprint(roofId, x, z, chk.size)) if (c) c.occupantId = m.id;
    s.grid.indexMachine(m);
    s.production.markNear(roofId, x, z, chk.size);
    s.cat.relocateIfBlocked();
    s.bus.emit('machine.built', { machine: m });
    s.bus.emit('super.stage', { machine: m, stage: 1 });
    return m;
  }

  /** The next stage's locked price, or undefined once built. */
  nextCost(m: MachineData): Cost | undefined {
    const p = m.project;
    if (!p || p.stage >= 3) return undefined;
    return fromStrings(p.costs[p.stage]);
  }

  /** The cheapest stage still to pay on any superstructure under construction (drones leave its energy and water). */
  pendingStage(): Cost | undefined {
    // Called for every drone job: cached until a machine is added or removed or a stage is paid.
    const ms = this.sim.state.machines;
    const key = `${machinesStamp(ms)}|${this.stageRev}`;
    if (this.pendingCache?.key === key) return this.pendingCache.cost;
    let best: Cost | undefined;
    for (const m of ms) {
      const c = m.project && this.nextCost(m);
      if (c && (!best || big(c.biomass ?? 0).lt(big(best.biomass ?? 0)))) best = c;
    }
    this.pendingCache = { key, cost: best };
    return best;
  }
  private pendingCache?: { key: string; cost: Cost | undefined };
  /** Bumped whenever a stage is paid. */
  private stageRev = 0;

  /** Pays the next stage (assembly, then activation). True if it advanced. */
  advance(id: string): boolean {
    const s = this.sim;
    const m = s.machine(id);
    const cost = m && this.nextCost(m);
    if (!m || !cost) return false;
    if (!s.econ.spend(cost)) {
      s.bus.emit('action.failed', { reason: `Need ${formatCost(cost)}` });
      return false;
    }
    m.project!.stage++;
    this.stageRev++;
    const done = m.project!.stage >= 3;
    if (done) {
      delete m.project; // built: everything that checks isBuilt now sees a normal tier-3 machine
      s.upgrades.version++;
      s.production.markNear(m.roofId, m.x, m.z, m.size);
      s.production.markDirty();
      const st = s.state.stats;
      st.supers = (st.supers ?? 0) + 1;
      if (st.firsts.firstSuper === undefined) st.firsts.firstSuper = s.time;
    }
    s.bus.emit('super.stage', { machine: m, stage: done ? 3 : m.project!.stage });
    return true;
  }

  /**
   * Pacing pass: every built superstructure enriches the whole city's biomass (soft-scaled: n built give
   * 1 + biomassBonus × n^biomassExponent). Megaflower and Nexus make energy and water, whose stores are capped,
   * so without this a superstructure barely moved the resource the player spends.
   */
  biomassMult(): number {
    const ms = this.sim.state.machines;
    const key = machinesStamp(ms);
    if (this.multCache?.key !== key || this.multCache.v !== this.sim.upgrades.version) {
      const n = ms.filter((m) => (m.tier ?? 1) >= 3 && isBuilt(m)).length;
      const S = TUNING.super;
      this.multCache = { key, v: this.sim.upgrades.version, mult: n ? 1 + S.biomassBonus * Math.pow(n, S.biomassExponent) : 1 };
    }
    return this.multCache.mult;
  }
  private multCache?: { key: number; v: number; mult: number };

  // ───────────── abilities ─────────────

  threshold(m: MachineData): number {
    const k = this.kind(m);
    return k ? TUNING.super[k].charge : Infinity;
  }

  /** Charge stored, in whole uses (the Tree of Life can hold up to 3). */
  maxCharge(m: MachineData): number {
    return this.threshold(m) * (this.kind(m) === 'treeOfLife' ? TUNING.super.treeOfLife.store : 1);
  }

  addCharge(m: MachineData, n: number) {
    const a = (m.ability ??= { charge: 0, used: 0 });
    a.charge = Math.min(this.maxCharge(m), a.charge + n);
  }

  /** Called by DroneSystem when a Megahub's own drone finishes a job (swarm drones don't count). */
  onDroneJob(hub: MachineData | undefined) {
    if (hub && this.kind(hub) === 'megahub' && isBuilt(hub)) this.addCharge(hub, 1);
  }

  ready(m: MachineData): boolean {
    return !!this.kind(m) && isBuilt(m) && (m.ability?.charge ?? 0) >= this.threshold(m) && !this.running(m);
  }

  /** The Megaflower's burst or the Megahub's swarm is still going. */
  running(m: MachineData): boolean {
    const s = this.sim;
    const k = this.kind(m);
    if (k === 'megaflower') return s.state.buffs.some((b) => b.type === 'megaflower' && b.until > s.time);
    if (k === 'megahub') return s.state.drones.some((d) => d.hubId === m.id && d.swarm);
    return false;
  }

  /** What the ability would act on now (empty: nothing to do; the Megaflower always has its burst). */
  targets(m: MachineData): TileData[] {
    const s = this.sim;
    const k = this.kind(m);
    const growable = (t: TileData) => t.ground === 'restored' && !t.occupantId && t.bloom < TUNING.restore.maxBloom;
    if (k === 'nexus') {
      // A wave through connected open ground from the Nexus, nearest first.
      const S = TUNING.super.nexus;
      const out: TileData[] = [];
      const seen = new Set<string>();
      let frontier = s.grid.footprint(m.roofId, m.x, m.z, m.size).filter((t): t is TileData => !!t);
      for (const t of frontier) seen.add(t.id);
      for (let ring = 0; ring < S.waveRadius && out.length < S.tiles && frontier.length; ring++) {
        const next: TileData[] = [];
        for (const t of frontier)
          for (const n of s.grid.neighbors(t)) {
            if (seen.has(n.id)) continue;
            seen.add(n.id);
            if (n.blocked || (n.occupantId && n.occupantId !== m.id)) continue;
            next.push(n);
            if (out.length < S.tiles && (s.restoration.isEligible(n, false) || growable(n))) out.push(n);
          }
        frontier = next;
      }
      return out;
    }
    if (k === 'treeOfLife') {
      const S = TUNING.super.treeOfLife;
      return s.grid
        .tilesNear(m, S.reach)
        .filter((t) => growable(t) || s.restoration.isEligible(t, false))
        .sort((a, b) => (a.ground === 'restored' ? a.bloom : -1) - (b.ground === 'restored' ? b.bloom : -1) || distToFootprint(a.x, a.z, m.x, m.z, m.size) - distToFootprint(b.x, b.z, m.x, m.z, m.size) || (a.id < b.id ? -1 : 1))
        .slice(0, S.tiles);
    }
    if (k === 'megahub') return s.grid.tilesNear(m, s.upgrades.droneRadius(m)).filter((t) => s.restoration.isEligible(t) || growable(t)).slice(0, 1);
    return [];
  }

  /** Why the ability can't fire right now (undefined: it can). */
  blocked(m: MachineData): string | undefined {
    const k = this.kind(m);
    if (!k) return 'Not a superstructure';
    if (!isBuilt(m)) return 'Finish building it first';
    if (this.running(m)) return 'Still running';
    if ((m.ability?.charge ?? 0) < this.threshold(m)) return 'Charging';
    // Pacing pass: the Nexus and the Tree of Life fall back to a bounty when nothing in reach can grow.
    if (k === 'megahub' && !this.targets(m).length) return 'Nothing left to restore in reach: charge kept';
    return undefined;
  }

  /** Fires the ability. False (nothing changed) if it can't. */
  activate(id: string, auto = false): boolean {
    const s = this.sim;
    const m = s.machine(id);
    const k = this.kind(m);
    if (!m || !k) return false;
    const why = this.blocked(m);
    if (why) {
      if (!auto) s.bus.emit('action.failed', { reason: why });
      return false;
    }
    let tiles: TileData[] = [];
    let bounty: Decimal | undefined;
    if ((k === 'nexus' || k === 'treeOfLife') && !this.targets(m).length) {
      // Pacing pass (spec: "a defined productive alternative"): with everything in reach fully grown, the release
      // pays a few seconds of steady biomass income instead of waiting. Charge comes from flow at a fixed pace,
      // so this is a bounded share of income, never a loop.
      bounty = ceilBig(s.production.rates(true).biomass.mul(TUNING.super.bountySeconds));
      s.econ.add('biomass', bounty);
    } else if (k === 'megaflower') {
      const S = TUNING.super.megaflower;
      s.state.buffs = [...s.state.buffs.filter((b) => b.type !== 'megaflower'), { type: 'megaflower', until: s.time + S.seconds }];
      s.production.markDirty();
    } else if (k === 'nexus' || k === 'treeOfLife') {
      tiles = this.targets(m);
      const step = k === 'nexus' ? 0.07 : 0.12;
      const id = s.chains.startAbility(tiles, (i) => 0.15 + i * step);
      if (id !== undefined) this.abilityChains.add(id);
    } else if (k === 'megahub') {
      const S = TUNING.super.megahub;
      for (let i = 0; i < S.drones; i++) s.drones.spawn(m, S.seconds).swarm = true;
    }
    const a = m.ability!;
    a.charge -= this.threshold(m);
    a.used++;
    s.state.stats.superAbilities = (s.state.stats.superAbilities ?? 0) + 1;
    s.bus.emit('super.ability', { machine: m, tiles: tiles.map((t) => t.id), ...(bounty ? { bounty } : {}) });
    return true;
  }

  /** Automatic firing (after the first manual use). */
  setAuto(id: string, on: boolean): boolean {
    const m = this.sim.machine(id);
    if (!m?.ability || !m.ability.used) return false;
    m.ability.auto = on;
    return true;
  }

  tick(dt: number) {
    const s = this.sim;
    for (const type of ['solar', 'condenser', 'pollinator', 'droneHub'] as const)
      for (const m of s.machinesOfType(type)) {
        const k = this.kind(m);
        if (!k || !isBuilt(m)) continue;
        // Resource flow: its own production. Into a full store it still flows (E12: overflow charges Bloom
        // Frenzy), but counts for less (pacing pass: at 0 the Megaflower and Nexus stalled once stores filled).
        if (k !== 'megahub') {
          const banked = k === 'megaflower' ? !s.econ.isFull('energy') : k === 'nexus' ? !s.econ.isFull('water') : true;
          const share = banked ? 1 : TUNING.super.fullFlowShare;
          if (share > 0) this.addCharge(m, ((this.threshold(m) / TUNING.super[k].flowSeconds) * share) * dt);
        }
        if (m.ability?.auto && this.ready(m)) this.activate(m.id, true);
      }
  }

  /** Total price of placing and finishing a core now (for previews). */
  totalCost(costs: Cost[]): Cost {
    const out: Cost = {};
    for (const c of costs) for (const k of KINDS) if (c[k] !== undefined) out[k] = big(out[k]).add(c[k]!);
    return out;
  }

  /** Display name of the next stage. */
  static stageName(stage: number): string {
    return ['Foundation', 'Assembly', 'Activation'][stage] ?? 'Built';
  }

  name(m: MachineData) {
    return machineName(m);
  }
}

function toStrings(c: Cost): Partial<Record<ResourceKind, string>> {
  const o: Partial<Record<ResourceKind, string>> = {};
  for (const k of KINDS) if (c[k] !== undefined) o[k] = big(c[k]).toString();
  return o;
}
function fromStrings(c: Partial<Record<ResourceKind, string>>): Cost {
  const o: Cost = {};
  for (const k of KINDS) if (c[k] !== undefined) o[k] = big(c[k]);
  return o;
}
