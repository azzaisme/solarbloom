import { GROUND, machinesStamp } from '../core/GameState';
import type { MachineData, TileData } from '../core/types';
import { WATER_NET } from '../data/water';
import type { Sim } from './Sim';
import type { WaterBody, WaterSystem } from './WaterSystem';

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export const pipeKey = (x: number, z: number) => `${x},${z}`;
const parse = (k: string) => k.split(',').map(Number) as [number, number];

/** Where a fed pipe tile's water comes from: a pump's pond or canal, or a reservoir. */
export interface PipeSource {
  kind: 'pump' | 'tank';
  /** the water body drawn from (a pond's id, or a reservoir's `r:<machine id>`) */
  body: string;
  /** the pump or reservoir machine */
  machine: string;
}

/** One connected run of pipe and the pumps and reservoirs it touches. */
export interface PipeNet {
  tiles: string[];
  pumps: MachineData[];
  tanks: MachineData[];
}

/**
 * E23.4.2 (#382): pipes, pumps and gravity feeds. Pipes are laid tile by tile on the ground, apart from the world's
 * canals (they never occupy a tile: bloombot walks over them, and they carry no machine). A run of connected pipe is a
 * network; a pump or reservoir whose footprint touches one of its tiles is on it.
 *
 * - A **pump** (on a pond's or canal's bank, on grid power) pushes that water along its whole network: uphill and
 *   across any distance. It fills the reservoirs on the line, and every pipe tile on it carries water.
 * - A **reservoir** holding water feeds the pipe tiles it can reach **by gravity**: through pipe tiles no higher
 *   than itself (E21.24 terrace height). A higher reservoir also fills lower ones down the line. No power needed.
 * - Anything within `pipeReach` of a pipe tile carrying water is watered and can draw from it (planters, E23.5).
 */
export class WaterPipes {
  private nets: PipeNet[] = [];
  private byTile = new Map<string, PipeNet>();
  private stamp = '';
  /** what each pipe tile carrying water is fed by, refreshed every water step */
  private fed = new Map<string, PipeSource[]>();
  /**
   * Pumps that want to run (on a bank with water, on a line): they ask the grid for power. Whether they then push
   * water is up to the grid (`powered`), so what they ask for never depends on being powered.
   */
  readonly pumping = new Set<string>();
  /** bumped when pipes are laid or lifted (the renderer rebuilds) */
  version = 0;
  private registered = false;

  constructor(
    private sim: Sim,
    private water: WaterSystem,
  ) {}

  private get save() {
    return (this.sim.state.water ??= { levels: {} });
  }

  /** All pipe tiles, `x,z`. */
  keys(): readonly string[] {
    return this.save.pipes ?? [];
  }

  has(x: number, z: number): boolean {
    return this.set().has(pipeKey(x, z));
  }

  private cache?: { list: readonly string[]; set: Set<string> };
  private set(): Set<string> {
    const list = this.keys();
    if (this.cache?.list !== list) this.cache = { list, set: new Set(list) };
    return this.cache.set;
  }

  /** Pipe tiles left over from the last Pipe crafted (a Pipe lays `tilesPerPipe`). */
  get stock(): number {
    return this.save.pipeStock ?? 0;
  }

  /** Why a pipe can't go here (undefined: it can). */
  layProblem(roofId: string, x: number, z: number): string | undefined {
    if (!this.water.unlocked('pipe')) return this.water.lockReason();
    if (roofId !== GROUND) return 'Pipes are laid on the ground';
    const t = this.sim.grid.get(GROUND, x, z);
    if (!t) return 'Nothing here';
    if (this.has(x, z)) return 'A pipe is already here';
    if (t.feature === 'water') return 'Not in the water: a pump on the bank draws from it';
    if (t.blocked || t.feature === 'building') return 'Something is in the way';
    if (this.sim.areas.fog(this.sim.areas.map.areaOfCell(x, z)) === 'hidden') return 'Not under the fog';
    if (t.occupantId) return 'Something stands here';
    if (this.stock <= 0 && !this.sim.inventory.canPay(WATER_NET.pipe.cost)) return `Need a Pipe: ${this.costText()}`;
    return undefined;
  }

  costText(): string {
    return this.sim.inventory
      .describe(WATER_NET.pipe.cost)
      .map((p) => `${p.need} ${p.name}`)
      .join(', ');
  }

  /** Lays one pipe tile (paying a Pipe when the last one is used up). */
  lay(roofId: string, x: number, z: number): boolean {
    const why = this.layProblem(roofId, x, z);
    if (why) {
      this.sim.bus.emit('action.failed', { reason: why });
      return false;
    }
    const s = this.save;
    if (this.stock <= 0) {
      if (!this.sim.inventory.pay(WATER_NET.pipe.cost)) return false;
      s.pipeStock = WATER_NET.pipe.tilesPerPipe;
    }
    s.pipeStock = this.stock - 1;
    s.pipes = [...this.keys(), pipeKey(x, z)].sort();
    this.version++;
    return true;
  }

  /** Lifts one pipe tile (it goes back into the stock). */
  lift(x: number, z: number): boolean {
    if (!this.has(x, z)) return false;
    const k = pipeKey(x, z);
    const s = this.save;
    s.pipes = this.keys().filter((p) => p !== k);
    s.pipeStock = this.stock + 1;
    this.version++;
    return true;
  }

  /** The pipe tiles next to this one (4 sides): what the renderer joins it to. */
  links(x: number, z: number): [number, number][] {
    return SIDES.filter(([dx, dz]) => this.has(x + dx, z + dz)).map(([dx, dz]) => [x + dx, z + dz]);
  }

  /** The machine (pump or reservoir) a pipe tile connects into on each side, if any. */
  machineLinks(x: number, z: number): { m: MachineData; dx: number; dz: number }[] {
    const out: { m: MachineData; dx: number; dz: number }[] = [];
    for (const [dx, dz] of SIDES) {
      const t = this.sim.grid.peek(GROUND, x + dx, z + dz);
      const m = t && this.sim.occupant(t);
      if (m && (m.type === 'pump' || m.type === 'reservoir' || m.type === 'desalination')) out.push({ m, dx, dz });
    }
    return out;
  }

  /** The networks (rebuilt when pipes are laid or lifted, or machines change). */
  networks(): PipeNet[] {
    const st = `${this.version}|${this.keys().length}|${machinesStamp(this.sim.state.machines)}`;
    if (st === this.stamp) return this.nets;
    this.stamp = st;
    this.nets = [];
    this.byTile.clear();
    const all = this.set();
    for (const start of all) {
      if (this.byTile.has(start)) continue;
      const net: PipeNet = { tiles: [], pumps: [], tanks: [] };
      const stack = [start];
      this.byTile.set(start, net);
      const seen = new Set<string>();
      while (stack.length) {
        const k = stack.pop()!;
        net.tiles.push(k);
        const [x, z] = parse(k);
        for (const [dx, dz] of SIDES) {
          const n = pipeKey(x + dx, z + dz);
          if (all.has(n) && !this.byTile.has(n)) {
            this.byTile.set(n, net);
            stack.push(n);
          }
        }
        for (const { m } of this.machineLinks(x, z)) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          (m.type === 'reservoir' ? net.tanks : net.pumps).push(m); // a desalination plant pushes like a pump
        }
      }
      net.tiles.sort();
      const byId = (a: MachineData, b: MachineData) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      net.pumps.sort(byId);
      net.tanks.sort(byId);
      this.nets.push(net);
    }
    return this.nets;
  }

  /** The network a pipe tile is part of. */
  netAt(x: number, z: number): PipeNet | undefined {
    this.networks();
    return this.byTile.get(pipeKey(x, z));
  }

  /** The networks a machine's footprint touches. */
  netsOf(m: MachineData): PipeNet[] {
    return this.networks().filter((n) => n.pumps.includes(m) || n.tanks.includes(m));
  }

  /** The water a pump pushes: the pond or canal it stands on the bank of (a desalination plant: its own tank). */
  pumpSource(m: MachineData): WaterBody | undefined {
    if (m.type === 'desalination') return this.water.plantTank(m.id);
    for (const t of this.sim.grid.footprint(m.roofId, m.x, m.z, m.size)) {
      const b = t && this.water.bodyNear(t, 1);
      if (b) return b;
    }
    return undefined;
  }

  /** Is a pump on grid power? (E23.3; true until the grid lands) */
  powered(m: MachineData): boolean {
    return (this.sim as { power?: { isPowered?: (m: MachineData) => boolean } }).power?.isPowered?.(m) ?? true;
  }

  /** Would this pump push water now (powered, on a bank with water in it)? */
  pumpLive(m: MachineData): boolean {
    const b = this.pumpSource(m);
    if (!b || this.water.amountOf(b.id) <= 0) return false;
    // a desalination plant needs power to make fresh water, not to let out what it has made (its tank drains by itself)
    return m.type === 'desalination' || this.powered(m);
  }

  /** A reservoir's water height in terrace levels (its highest footprint tile; flat ground everywhere else is 1). */
  height(m: MachineData): number {
    let h = -Infinity;
    for (const t of this.sim.grid.footprint(m.roofId, m.x, m.z, m.size)) h = Math.max(h, t?.level ?? 1);
    return h;
  }

  private tileLevel(k: string): number {
    const [x, z] = parse(k);
    return this.sim.grid.get(GROUND, x, z)?.level ?? 1;
  }

  /** Pipe tiles a reservoir feeds by gravity: from the tiles touching it, through tiles no higher than it. */
  gravityTiles(m: MachineData, net: PipeNet): string[] {
    if (!this.water.unlocked('gravityFeed')) return []; // E23.8.2: handed over with the reservoirs in Cistern Basin
    const h = this.height(m);
    const inNet = new Set(net.tiles);
    const start: string[] = [];
    for (const t of this.sim.grid.footprint(m.roofId, m.x, m.z, m.size)) {
      if (!t) continue;
      for (const [dx, dz] of SIDES) {
        const k = pipeKey(t.x + dx, t.z + dz);
        if (inNet.has(k) && this.tileLevel(k) <= h + 1e-6 && !start.includes(k)) start.push(k);
      }
    }
    const seen = new Set(start);
    const queue = [...start];
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = parse(queue[i]);
      for (const [dx, dz] of SIDES) {
        const k = pipeKey(x + dx, z + dz);
        if (!inNet.has(k) || seen.has(k) || this.tileLevel(k) > h + 1e-6) continue;
        seen.add(k);
        queue.push(k);
      }
    }
    return queue;
  }

  /** Reservoirs on a network a reservoir can fill by gravity (strictly lower, reached through pipe no higher). */
  private downhill(m: MachineData, net: PipeNet): MachineData[] {
    const reach = new Set(this.gravityTiles(m, net));
    const h = this.height(m);
    return net.tanks.filter((o) => {
      if (o === m || this.height(o) >= h) return false;
      for (const t of this.sim.grid.footprint(o.roofId, o.x, o.z, o.size))
        if (t && SIDES.some(([dx, dz]) => reach.has(pipeKey(t.x + dx, t.z + dz)))) return true;
      return false;
    });
  }

  /**
   * One water step (`days` of a game day): pumps push into the reservoirs on their line, higher reservoirs run down
   * into lower ones, then which pipe tiles carry water (and from where) is worked out for consumers.
   */
  tick(days: number) {
    this.registerPower();
    this.pumping.clear();
    const w = this.water;
    for (const net of this.networks()) {
      // pumps fill the reservoirs on their line (uphill or not)
      for (const p of net.pumps) {
        const src = this.pumpSource(p);
        if (src && w.amountOf(src.id) > 0 && p.type === 'pump') this.pumping.add(p.id); // (a plant asks through sim.water)
        if (!this.pumpLive(p)) continue;
        let budget = WATER_NET.pump.perDay * days;
        const tanks = net.tanks.filter((t) => w.levelOf(tankId(t)) < 1);
        for (let i = 0; i < tanks.length && budget > 1e-9; i++) {
          const share = budget / (tanks.length - i);
          const id = tankId(tanks[i]);
          const room = (1 - w.levelOf(id)) * WATER_NET.reservoir.capacity;
          const got = w.draw(src!.id, Math.min(share, room));
          w.fill(id, got);
          budget -= got;
        }
      }
      // gravity: a higher reservoir runs down into lower ones
      const byHeight = [...net.tanks].sort((a, b) => this.height(b) - this.height(a));
      for (const hi of byHeight) {
        for (const lo of this.downhill(hi, net)) {
          const room = (1 - w.levelOf(tankId(lo))) * WATER_NET.reservoir.capacity;
          const got = w.draw(tankId(hi), Math.min(WATER_NET.gravityPerDay * days, room));
          w.fill(tankId(lo), got);
        }
      }
    }
    this.refreshFed();
  }

  /** Works out which pipe tiles carry water now, and from where. */
  refreshFed() {
    this.fed.clear();
    const w = this.water;
    for (const net of this.networks()) {
      const pumped = net.pumps.filter((p) => this.pumpLive(p));
      const add = (k: string, s: PipeSource) => {
        let list = this.fed.get(k);
        if (!list) this.fed.set(k, (list = []));
        if (!list.some((o) => o.machine === s.machine)) list.push(s);
      };
      // a running pump carries its water to every tile of its line (and pressure carries the tanks' water too)
      for (const p of pumped) {
        for (const k of net.tiles) add(k, { kind: 'pump', body: this.pumpSource(p)!.id, machine: p.id });
        for (const t of net.tanks)
          if (w.amountOf(tankId(t)) > 0) for (const k of net.tiles) add(k, { kind: 'tank', body: tankId(t), machine: t.id });
      }
      // a reservoir with water feeds what lies no higher than it
      for (const t of net.tanks) {
        if (w.amountOf(tankId(t)) <= 0) continue;
        for (const k of this.gravityTiles(t, net)) add(k, { kind: 'tank', body: tankId(t), machine: t.id });
      }
    }
  }

  /** Does this pipe tile carry water now? */
  carries(x: number, z: number): boolean {
    return this.fed.has(pipeKey(x, z));
  }

  /** What feeds a pipe tile now (empty when it is dry). */
  sources(x: number, z: number): readonly PipeSource[] {
    return this.fed.get(pipeKey(x, z)) ?? [];
  }

  /** Fed pipe tiles within reach of a tile, nearest first. */
  private fedNear(t: TileData): string[] {
    if (t.roofId !== GROUND || !this.fed.size) return [];
    const R = WATER_NET.pipeReach;
    const out: [string, number][] = [];
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const k = pipeKey(t.x + dx, t.z + dz);
        if (this.fed.has(k)) out.push([k, Math.max(Math.abs(dx), Math.abs(dz))]);
      }
    return out.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map((p) => p[0]);
  }

  /** Is a tile beside a pipe carrying water? */
  feeds(t: TileData): boolean {
    return this.fedNear(t).length > 0;
  }

  /** Takes up to `units` through the nearest pipe carrying water: from its pumps' water first, then its reservoirs. */
  drawAt(t: TileData, units: number): number {
    let got = 0;
    for (const k of this.fedNear(t)) {
      const [x, z] = parse(k);
      const srcs = [...this.sources(x, z)].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'pump' ? -1 : 1));
      for (const s of srcs) {
        if (got >= units) return got;
        got += this.water.draw(s.body, units - got);
      }
      if (got >= units) return got;
    }
    if (got > 0) this.refreshFed(); // a reservoir may have run dry
    return got;
  }

  /** E23.3: pumps and desalination plants are grid consumers (shed after lamps); they draw only while they want to run. */
  registerPower() {
    if (this.registered) return;
    const power = (this.sim as { power?: { register?: (type: string, def: unknown) => void } }).power;
    if (!power?.register) return;
    this.registered = true;
    power.register('pump', { consumer: { shed: 'pump', draw: (m: MachineData) => (this.pumping.has(m.id) ? WATER_NET.pump.power : 0) } });
    // E23.4.3: the desalination plant, a heavy load, shed with the pumps
    power.register('desalination', { consumer: { shed: 'pump', draw: (m: MachineData) => (this.water.desalinating.has(m.id) ? WATER_NET.desal.power : 0) } });
  }
}

/** A reservoir's water body id. */
export const tankId = (m: MachineData) => `r:${m.id}`;
/** A desalination plant's tank id. */
export const plantId = (m: MachineData) => `d:${m.id}`;
