import { machinesStamp } from '../core/GameState';
import type { MachineData } from '../core/types';
import { POWER, SHED_ORDER, type ShedClass } from '../data/power';
import { groundLevel, readSky, regionBoost, type PowerSky } from './PowerEnv';
import type { Sim } from './Sim';

/**
 * What a machine type is to the grid. A type can be several things at once: a solar garden light is a source,
 * a battery and a lamp in one machine (a network of its own).
 */
export interface PowerRole {
  /** A pole: links to other poles within range (the larger of the two), and machines attach to it. */
  pole?: { range: (m: MachineData, sim: Sim) => number; attachReach?: number };
  /** Supply right now, in watts (may read the sky). */
  source?: (m: MachineData, sim: Sim, sky: PowerSky) => number;
  /** Storage in watt-seconds. The stored amount is saved in the machine's `charge`. */
  battery?: { capacity: number | ((m: MachineData) => number); rate: number };
  /**
   * A load. `draw` may return 0 when the machine is idle (a charger with no bloombot on it). Consumers in a
   * `dims` class (lamps) take whatever is left and dim; everything else is all or nothing.
   */
  consumer?: { shed: ShedClass; draw?: number | ((m: MachineData, sim: Sim, sky: PowerSky) => number); dims?: boolean };
}

/** One connected network. Read-only outside this file. */
export interface PowerNetwork {
  /** Deterministic id: `net:<lowest member id>`. */
  id: string;
  members: MachineData[];
  poles: MachineData[];
  sources: MachineData[];
  batteries: MachineData[];
  consumers: MachineData[];
  /** Pole-to-pole links, as [a, b] pairs (for the overlay). */
  links: [MachineData, MachineData][];
  /** Each machine fed by a pole, with the nearest pole that reaches it, as [pole, machine] (for drawn cables). */
  feeds: [MachineData, MachineData][];
  /** Last solve: total supply (W), total wanted draw (W), draw served (W), battery flow (+ charging, − draining). */
  supply: number;
  demand: number;
  served: number;
  batteryFlow: number;
  /** Stored and capacity (W·s) over all batteries. */
  stored: number;
  capacity: number;
}

/** E23.3.2.2: a turbine's output: the wind, more on high ground and in windy regions. */
export function windOutput(sim: Sim, m: MachineData, sky: PowerSky): number {
  const w = POWER.wind;
  const height = Math.min(1, w.groundShare + w.perLevel * Math.max(0, groundLevel(sim, m)));
  return w.output * sky.wind * height * regionBoost(sim, m);
}

const idNum = (m: MachineData) => Number(m.id.replace(/^\D+/, '')) || 0;
const byId = (a: MachineData, b: MachineData) => idNum(a) - idNum(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const KEEP_ORDER = [...SHED_ORDER].reverse(); // served first = shed last

/**
 * E23.3.1: the power grid (`sim.power`). Machines join networks through poles in range (flood fill, like
 * `CanalNetwork`), or by touching. Each tick a network sums its supply, serves its consumers from the most
 * important (chargers) to the least (lamps), covers any deficit from its batteries and stores any surplus.
 * When short, consumers go dark one at a time in shed order and come back by themselves. Deterministic and
 * headless; networks are cached until a machine is built or removed (or `invalidate()` is called).
 *
 * Other systems:
 *   sim.power.register('pump', { consumer: { shed: 'pump', draw: 3 } })
 *   if (sim.power.isPowered(m)) …   // true for machines the grid does not know
 *   sim.power.level(m)              // 0..1, eased over POWER.fadeSeconds (for lights and fades)
 *   sim.power.networkOf(m)          // its PowerNetwork, or undefined
 */
export class PowerGrid {
  private roles = new Map<string, PowerRole>();
  private nets: PowerNetwork[] = [];
  private netOf = new Map<string, PowerNetwork>();
  private stamp = -1;
  private dirty = true;
  /** Served fraction per consumer id from the last solve (1 = fully on). */
  private servedFrac = new Map<string, number>();
  /** Eased level per consumer id. */
  private eased = new Map<string, number>();
  private solved = false;
  private rangeSig = 0;
  /** Test hook: replaces the sky reading (time of day and weather). */
  skyOverride?: () => PowerSky;

  constructor(private sim: Sim) {
    this.register('relay', { pole: { range: (m, s) => s.relays.range(m) } });
    this.register('solar', { source: (m, s, sky) => POWER.solar.output * sky.solar * regionBoost(s, m) });
    this.register('battery', { battery: { capacity: POWER.battery.capacity, rate: POWER.battery.rate } });
    this.register('windTurbine', { source: (m, s, sky) => windOutput(s, m, sky) });
  }

  /** Adds (or merges into) a machine type's role. Types need not exist yet (other sub-epics add them). */
  register(type: string, role: PowerRole): void {
    this.roles.set(type, { ...this.roles.get(type), ...role });
    this.invalidate();
  }

  roleOf(m: MachineData): PowerRole | undefined {
    return this.roles.get(m.type);
  }

  /** Forget the cached networks (call after anything that changes ranges without building or removing). */
  invalidate(): void {
    this.dirty = true;
  }

  sky(): PowerSky {
    return this.skyOverride?.() ?? readSky(this.sim);
  }

  /** Every network, in a stable order. */
  networks(): PowerNetwork[] {
    this.fresh();
    return this.nets;
  }

  networkOf(m: MachineData | undefined): PowerNetwork | undefined {
    if (!m) return undefined;
    this.fresh();
    return this.netOf.get(m.id);
  }

  /** Does this machine have the power it needs? Always true for machines the grid does not power. */
  isPowered(m: MachineData | undefined): boolean {
    if (!m || !this.roleOf(m)?.consumer) return true;
    this.fresh();
    return (this.servedFrac.get(m.id) ?? 0) > 0;
  }

  /** 0..1: how lit or running a consumer is, eased so lights fade. 1 for machines the grid does not power. */
  level(m: MachineData): number {
    if (!this.roleOf(m)?.consumer) return 1;
    this.fresh();
    return this.eased.get(m.id) ?? this.servedFrac.get(m.id) ?? 0;
  }

  /** A battery's stored energy and capacity (W·s). */
  stored(m: MachineData): { stored: number; capacity: number } {
    const b = this.roleOf(m)?.battery;
    if (!b) return { stored: 0, capacity: 0 };
    const cap = this.capacityOf(m, b);
    return { stored: Math.min(cap, Math.max(0, m.charge || 0)), capacity: cap };
  }

  /** A source's output right now (W). */
  output(m: MachineData, sky = this.sky()): number {
    return Math.max(0, this.roleOf(m)?.source?.(m, this.sim, sky) ?? 0);
  }

  /** The draw a consumer wants right now (W). */
  draw(m: MachineData, sky = this.sky()): number {
    const c = this.roleOf(m)?.consumer;
    if (!c) return 0;
    const d = typeof c.draw === 'function' ? c.draw(m, this.sim, sky) : (c.draw ?? POWER.draw[c.shed]);
    return Math.max(0, d);
  }

  tick(dt: number): void {
    // Pole ranges change with upgrades (Relay Lens) without a build: re-link when they do.
    let sig = 0;
    for (const n of this.nets) for (const p of n.poles) sig = sig * 31 + this.roles.get(p.type)!.pole!.range(p, this.sim) * 7 + 1;
    if (sig !== this.rangeSig) {
      this.rangeSig = sig;
      this.dirty = true;
    }
    this.fresh(false);
    const sky = this.sky();
    for (const n of this.nets) this.solve(n, dt, sky);
    this.solved = true;
    const k = Math.min(1, dt / Math.max(1e-6, POWER.fadeSeconds));
    for (const [id, f] of this.servedFrac) {
      const e = this.eased.get(id) ?? f;
      this.eased.set(id, Math.abs(f - e) < 1e-4 ? f : e + (f - e) * k);
    }
  }

  // ---- lightning (E23.7.2) ----

  /**
   * A storm's lightning trips one working pole (chosen with the sim's rng, so it is deterministic). A tripped pole
   * carries nothing, so what it linked goes dark, until bloombot resets it with one press. Returns its id, or
   * undefined when there is no pole to trip. Weather never destroys anything: a reset brings it all back.
   */
  trip(rng: { int(min: number, maxInclusive: number): number }): string | undefined {
    const poles = this.sim.state.machines.filter((m) => !m.tripped && this.roles.get(m.type)?.pole && this.sim.grid.isPlayable(m.roofId)).sort(byId);
    if (!poles.length) return undefined;
    const p = poles[rng.int(0, poles.length - 1)];
    p.tripped = true;
    this.invalidate();
    return p.id;
  }

  /** Is this a pole lightning has tripped? */
  isTripped(m: MachineData | undefined): boolean {
    return !!m?.tripped && !!this.roleOf(m)?.pole;
  }

  /** Resets a tripped pole (one press). True if it was tripped. */
  reset(m: MachineData | undefined): boolean {
    if (!m || !this.isTripped(m)) return false;
    delete m.tripped;
    this.invalidate();
    return true;
  }

  // ---- networks ----

  private capacityOf(m: MachineData, b: NonNullable<PowerRole['battery']>): number {
    return typeof b.capacity === 'function' ? b.capacity(m) : b.capacity;
  }

  private centre(m: MachineData): [number, number] {
    const o = this.sim.grid.layer(m.roofId)?.origin ?? [0, 0, 0];
    return [o[0] + m.x + m.size / 2, o[2] + m.z + m.size / 2];
  }

  /** Rebuilds the networks if machines changed; solves them once (no time passing) if nothing has yet. */
  private fresh(solveIfNeeded = true): void {
    const st = machinesStamp(this.sim.state.machines);
    if (this.dirty || st !== this.stamp) {
      this.stamp = st;
      this.dirty = false;
      this.rebuild();
      this.solved = false;
    }
    if (solveIfNeeded && !this.solved) {
      const sky = this.sky();
      for (const n of this.nets) this.solve(n, 0, sky);
      this.solved = true;
    }
  }

  private rebuild(): void {
    const sim = this.sim;
    // A tripped pole carries nothing until it is reset: it is on no network.
    const members = sim.state.machines.filter((m) => this.roles.has(m.type) && sim.grid.isPlayable(m.roofId) && !(m.tripped && this.roles.get(m.type)!.pole)).sort(byId);
    const index = new Map<string, number>();
    members.forEach((m, i) => index.set(m.id, i));
    const parent = members.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    };
    const centres = members.map((m) => this.centre(m));
    const poles = members.filter((m) => this.roles.get(m.type)!.pole);
    const range = new Map(poles.map((p) => [p.id, this.roles.get(p.type)!.pole!.range(p, sim)]));
    const links: [MachineData, MachineData][] = [];
    const feed = new Map<string, { pole: MachineData; d: number }>();

    // Bucket every member by a coarse cell so linking is near-linear.
    const cell = Math.max(8, POWER.pole.attachReach, ...range.values());
    const buckets = new Map<string, number[]>();
    const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    centres.forEach(([x, z], i) => {
      const k = key(x, z);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(i);
    });
    const near = (i: number): number[] => {
      const [x, z] = centres[i];
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      const out: number[] = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const j of buckets.get(`${cx + dx},${cz + dz}`) ?? []) if (j > i) out.push(j);
      return out;
    };

    for (let i = 0; i < members.length; i++) {
      const a = members[i];
      const ra = this.roles.get(a.type)!;
      for (const j of near(i)) {
        const b = members[j];
        const rb = this.roles.get(b.type)!;
        const d = Math.hypot(centres[i][0] - centres[j][0], centres[i][1] - centres[j][1]);
        let joined = false;
        if (ra.pole && rb.pole && d <= Math.max(range.get(a.id)!, range.get(b.id)!) + 1e-9) {
          links.push([a, b]);
          joined = true;
        } else if (ra.pole || rb.pole) {
          const reach = (ra.pole ?? rb.pole)!.attachReach ?? POWER.pole.attachReach;
          joined = d <= reach + 1e-9;
          if (joined) {
            const [pole, m] = ra.pole ? [a, b] : [b, a];
            const was = feed.get(m.id);
            if (!was || d < was.d - 1e-9) feed.set(m.id, { pole, d });
          }
        }
        // Touching footprints (diagonals included) on the same layer share a network.
        if (!joined && a.roofId === b.roofId) {
          const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.size, b.x + b.size);
          const gapZ = Math.max(a.z, b.z) - Math.min(a.z + a.size, b.z + b.size);
          joined = gapX <= 0 && gapZ <= 0;
        }
        if (joined) union(i, j);
      }
    }

    const groups = new Map<number, PowerNetwork>();
    this.nets = [];
    this.netOf.clear();
    members.forEach((m, i) => {
      const r = find(i);
      let n = groups.get(r);
      if (!n) {
        n = { id: `net:${members[r].id}`, members: [], poles: [], sources: [], batteries: [], consumers: [], links: [], feeds: [], supply: 0, demand: 0, served: 0, batteryFlow: 0, stored: 0, capacity: 0 };
        groups.set(r, n);
        this.nets.push(n);
      }
      const role = this.roles.get(m.type)!;
      n.members.push(m);
      if (role.pole) n.poles.push(m);
      if (role.source) n.sources.push(m);
      if (role.battery) n.batteries.push(m);
      if (role.consumer) n.consumers.push(m);
      this.netOf.set(m.id, n);
    });
    for (const l of links) this.netOf.get(l[0].id)!.links.push(l);
    for (const m of members) {
      const f = feed.get(m.id);
      if (f) this.netOf.get(m.id)!.feeds.push([f.pole, m]);
    }
    // Consumers in keep order: chargers first, lamps last; build order within a class.
    const rank = (m: MachineData) => KEEP_ORDER.indexOf(this.roles.get(m.type)!.consumer!.shed);
    for (const n of this.nets) n.consumers.sort((a, b) => rank(a) - rank(b) || byId(a, b));
    for (const id of [...this.servedFrac.keys()]) if (!this.netOf.has(id)) this.servedFrac.delete(id);
    for (const id of [...this.eased.keys()]) if (!this.netOf.has(id)) this.eased.delete(id);
  }

  // ---- the solve ----

  private solve(n: PowerNetwork, dt: number, sky: PowerSky): void {
    let supply = 0;
    for (const s of n.sources) supply += this.output(s, sky);
    // What the batteries can give this step.
    let stored = 0;
    let capacity = 0;
    let canGive = 0;
    let canTake = 0;
    for (const b of n.batteries) {
      const role = this.roles.get(b.type)!.battery!;
      const cap = this.capacityOf(b, role);
      const have = Math.min(cap, Math.max(0, b.charge || 0));
      stored += have;
      capacity += cap;
      canGive += dt > 0 ? Math.min(role.rate, have / dt) : have > 0 ? role.rate : 0;
      canTake += dt > 0 ? Math.min(role.rate, (cap - have) / dt) : 0;
    }
    let left = supply + canGive;
    let demand = 0;
    let served = 0;
    let blocked = false;
    for (const c of n.consumers) {
      const role = this.roles.get(c.type)!.consumer!;
      const want = this.draw(c, sky);
      demand += want;
      let frac = 0;
      // idle (drawing nothing): on only if its network has power to give, so a charger on a dead line reads dark
      if (want <= 0) frac = left > 1e-9 ? 1 : 0;
      else if (!blocked && left + 1e-9 >= want) frac = 1;
      else if (!blocked && role.dims && left > 1e-9) frac = left / want;
      if (want > 0 && frac < 1) blocked = true; // strict shed order: nothing below a dark consumer runs
      const use = want * frac;
      left -= use;
      served += use;
      this.servedFrac.set(c.id, frac);
    }
    // Batteries: cover the deficit, or store the surplus.
    let flow = 0;
    if (served > supply) flow = -Math.min(served - supply, canGive);
    else flow = Math.min(supply - served, canTake);
    if (dt > 0 && flow !== 0) this.spread(n, flow * dt);
    n.supply = supply;
    n.demand = demand;
    n.served = served;
    n.batteryFlow = flow;
    n.stored = dt > 0 ? n.batteries.reduce((a, b) => a + this.stored(b).stored, 0) : stored;
    n.capacity = capacity;
  }

  /** Moves `amount` W·s into (+) or out of (−) the network's batteries, evenly by their room or charge. */
  private spread(n: PowerNetwork, amount: number): void {
    const bs = n.batteries.map((b) => ({ b, ...this.stored(b) }));
    const pool = amount > 0 ? bs.reduce((a, x) => a + (x.capacity - x.stored), 0) : bs.reduce((a, x) => a + x.stored, 0);
    if (pool <= 0) return;
    for (const x of bs) {
      const share = amount > 0 ? (x.capacity - x.stored) / pool : x.stored / pool;
      x.b.charge = Math.min(x.capacity, Math.max(0, x.stored + amount * share));
    }
  }
}
