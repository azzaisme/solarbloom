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

/**
 * What makes a machine type a pump (E23.8.3's mainland Long-range Pump registers its own): how far along its line it
 * feeds (pipe steps from the tiles touching it), how much it pushes (units per game day), its grid draw, its size.
 */
export interface PumpSpec {
  reach: number;
  flow: number;
  power?: number;
  size?: number;
  /**
   * E23.8.3: it has its own filter, so it may also stand on the sea's shore and draw from the sea (which never runs
   * dry). Beside a pond or canal it still draws from that.
   */
  sea?: boolean;
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
   * Pumps that want to run (on a bank with water, on a line, and their water has somewhere to go: `wanted`): they
   * ask the grid for power. Whether they then push water is up to the grid (`powered`), so what they ask for never
   * depends on being powered.
   */
  readonly pumping = new Set<string>();
  /** bumped when pipes are laid or lifted (the renderer rebuilds) */
  version = 0;
  private registered = new Set<string>();
  /** Pump types and their numbers: bloombot's own pump, and any another sub-epic registers. */
  private pumpTypes = new Map<string, PumpSpec>([['pump', { reach: Infinity, flow: WATER_NET.pump.perDay, power: WATER_NET.pump.power, size: 1 }]]);

  constructor(
    private sim: Sim,
    private water: WaterSystem,
  ) {}

  private get save() {
    return (this.sim.state.water ??= { levels: {} });
  }

  /** Makes a machine type a pump (or changes its numbers). Safe to call before or after the grid exists. */
  registerPump(type: string, spec: PumpSpec) {
    this.pumpTypes.set(type, { size: 1, power: WATER_NET.pump.power, ...spec });
    this.registered.delete(type);
    this.stamp = '';
    this.registerPower();
  }

  /** A pump type's numbers (undefined: not a pump). */
  pumpSpec(type: string): PumpSpec | undefined {
    return this.pumpTypes.get(type);
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
    if (!this.sim.inventory.canPay(WATER_NET.pipe.cost)) return `Need a Pipe: ${this.costText()}`;
    return undefined;
  }

  costText(): string {
    return this.sim.inventory
      .describe(WATER_NET.pipe.cost)
      .map((p) => `${p.need} ${p.name}`)
      .join(', ');
  }

  /** Lays one pipe tile (one crafted Pipe from the pack or the store). */
  lay(roofId: string, x: number, z: number): boolean {
    const why = this.layProblem(roofId, x, z);
    if (why) {
      this.sim.bus.emit('action.failed', { reason: why });
      return false;
    }
    const s = this.save;
    if (!this.sim.inventory.pay(WATER_NET.pipe.cost)) return false;
    s.pipes = [...this.keys(), pipeKey(x, z)].sort();
    this.version++;
    return true;
  }

  /** Lifts one pipe tile (its Pipe goes back into the pack). */
  lift(x: number, z: number): boolean {
    if (!this.has(x, z)) return false;
    const k = pipeKey(x, z);
    const s = this.save;
    s.pipes = this.keys().filter((p) => p !== k);
    this.sim.inventory.refund(WATER_NET.pipe.cost);
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
      if (m && (this.pumpTypes.has(m.type) || m.type === 'reservoir' || m.type === 'desalination')) out.push({ m, dx, dz });
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
    const foot = this.sim.grid.footprint(m.roofId, m.x, m.z, m.size);
    for (const t of foot) {
      const b = t && this.water.bodyNear(t, 1);
      if (b) return b;
    }
    if (this.pumpTypes.get(m.type)?.sea && foot.some((t) => t && this.water.onShore(t))) return this.water.body(SEA_ID);
    return undefined;
  }

  /** Is a pump on grid power? (E23.3) */
  powered(m: MachineData): boolean {
    return this.sim.power.isPowered(m);
  }

  /**
   * Would this pump push water now? A pump: it wants to run (as of the last water step) and it is powered. A
   * desalination plant: it holds water it has made, which it lets out with or without power (its tank drains by
   * itself; it needs power only to make more, through sim.water).
   */
  pumpLive(m: MachineData): boolean {
    if (m.type === 'desalination') {
      const b = this.pumpSource(m);
      return !!b && this.water.amountOf(b.id) > 0;
    }
    return this.pumping.has(m.id) && this.powered(m);
  }

  /**
   * E23.4.5: is this pump or plant moving water now (what the Water view draws: its hologram, and arrows out of it)?
   * A pump: live. A plant: holding water it made while that water has somewhere to go (`sim.water.desalinating`);
   * a full plant standing idle holds water but moves none.
   */
  moving(m: MachineData): boolean {
    return this.pumpLive(m) && (m.type !== 'desalination' || this.water.desalinating.has(m.id));
  }

  /** Does this pump drive its line (moving water, or powered with water to push but idle because its tanks are full)? */
  private drives(m: MachineData): boolean {
    if (m.type === 'desalination') return this.moving(m);
    const src = this.pumpSource(m);
    return !!src && this.water.amountOf(src.id) > 0 && this.powered(m);
  }

  /**
   * Has this pump's water somewhere to go? A reservoir in its reach with room, or a stretch of its line that its
   * full reservoirs can't feed by gravity (a line with no reservoir: all of it, since what draws on it takes the
   * pump's water). Like the desalination plant, a pump whose tanks are full and already feed its whole line stands
   * idle and asks the grid for nothing; once water is drawn from them it starts again.
   */
  wanted(p: MachineData, net: PipeNet): boolean {
    const reach = this.reachOf(p, net);
    const tanks = net.tanks.filter((t) => this.touches(t, reach));
    if (tanks.some((t) => this.water.levelOf(tankId(t)) < 1)) return true;
    const byGravity = new Set<string>();
    for (const t of tanks) for (const k of this.gravityTiles(t, net)) byGravity.add(k);
    for (const k of reach) if (!byGravity.has(k)) return true;
    return false;
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
        if (src && w.amountOf(src.id) > 0 && p.type !== 'desalination' && this.wanted(p, net)) this.pumping.add(p.id); // (a plant asks through sim.water)
        if (!this.pumpLive(p)) continue;
        // a desalination plant pushes what it has made at its own rate (its tank limits it)
        const spec = this.pumpTypes.get(p.type) ?? { reach: Infinity, flow: WATER_NET.desal.perDay };
        let budget = spec.flow * days;
        const inReach = this.reachOf(p, net);
        const tanks = net.tanks.filter((t) => w.levelOf(tankId(t)) < 1 && this.touches(t, inReach));
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
        const reach = this.reachOf(p, net);
        for (const k of reach) add(k, { kind: 'pump', body: this.pumpSource(p)!.id, machine: p.id });
        for (const t of net.tanks)
          if (w.amountOf(tankId(t)) > 0 && this.touches(t, reach)) for (const k of reach) add(k, { kind: 'tank', body: tankId(t), machine: t.id });
      }
      // a reservoir with water feeds what lies no higher than it
      for (const t of net.tanks) {
        if (w.amountOf(tankId(t)) <= 0) continue;
        for (const k of this.gravityTiles(t, net)) add(k, { kind: 'tank', body: tankId(t), machine: t.id });
      }
    }
  }

  /**
   * Reservoirs on a line that water is running into now: a running pump's line reaches them and they have room, or
   * a higher reservoir with water runs down into them. Water goes into these, not out of them.
   */
  filling(net: PipeNet): Set<MachineData> {
    const w = this.water;
    const out = new Set<MachineData>();
    const room = (t: MachineData) => w.levelOf(tankId(t)) < 1;
    for (const p of net.pumps) {
      if (!this.pumpLive(p)) continue;
      const reach = this.reachOf(p, net);
      for (const t of net.tanks) if (room(t) && this.touches(t, reach)) out.add(t);
    }
    for (const hi of net.tanks) {
      if (w.amountOf(tankId(hi)) <= 0) continue;
      for (const lo of this.downhill(hi, net)) if (room(lo)) out.add(lo);
    }
    return out;
  }

  /**
   * E23.4.5: which way the water runs on each pipe tile carrying it: the sides (dx, dz) leading downstream. It starts
   * at what pushes water into the line and runs out from there, each source only as far as its water really goes:
   * - a running pump or plant, along its reach;
   * - a reservoir with water, down its gravity tiles only (never up a step it can't climb), and only where nothing
   *   fills it and no pump that has water to push stands on its line (a full tank on a pump's line is held there,
   *   not a source: arrows never run from it back at the pump).
   * A tile's arrows point at neighbours one step further from the nearest source, and a tile beside a reservoir
   * being filled points into it (the pump's water, or a higher tank's, ends up there).
   */
  flow(): Map<string, [number, number][]> {
    const dist = new Map<string, number>();
    /** the distances from one source, through the tiles its water can reach, merged into `dist` (nearest wins) */
    const spread = (m: MachineData, allowed: Set<string>) => {
      const mine = new Map<string, number>();
      const queue: string[] = [];
      for (const t of this.sim.grid.footprint(m.roofId, m.x, m.z, m.size))
        if (t)
          for (const [dx, dz] of SIDES) {
            const k = pipeKey(t.x + dx, t.z + dz);
            if (allowed.has(k) && this.fed.has(k) && !mine.has(k)) mine.set(k, 0), queue.push(k);
          }
      for (let i = 0; i < queue.length; i++) {
        const [x, z] = parse(queue[i]);
        const d = mine.get(queue[i])!;
        for (const [dx, dz] of SIDES) {
          const k = pipeKey(x + dx, z + dz);
          if (!allowed.has(k) || !this.fed.has(k) || mine.has(k)) continue;
          mine.set(k, d + 1);
          queue.push(k);
        }
      }
      for (const [k, d] of mine) if (!(dist.get(k)! <= d)) dist.set(k, d);
    };
    const sinks: MachineData[] = [];
    for (const net of this.networks()) {
      const filling = this.filling(net);
      sinks.push(...filling);
      for (const p of net.pumps) if (this.moving(p)) spread(p, this.reachOf(p, net));
      // pumps that drive their line (moving water, or idle because its tanks are full): the line is theirs, not a
      // tank's. A dark pump drives nothing, so a tank on its line feeding it by gravity is a source as usual.
      const pumped = new Set<string>();
      for (const p of net.pumps) if (this.drives(p)) for (const k of this.reachOf(p, net)) pumped.add(k);
      for (const t of net.tanks) {
        if (filling.has(t) || this.water.amountOf(tankId(t)) <= 0 || this.touches(t, pumped)) continue;
        spread(t, new Set(this.gravityTiles(t, net)));
      }
    }
    const out = new Map<string, [number, number][]>();
    for (const [k, d] of dist) {
      const [x, z] = parse(k);
      const down = SIDES.filter(([dx, dz]) => dist.get(pipeKey(x + dx, z + dz)) === d + 1).map(([dx, dz]) => [dx, dz] as [number, number]);
      if (down.length) out.set(k, down);
    }
    // the last tiles before a reservoir being filled point into it
    for (const m of sinks)
      for (const t of this.sim.grid.footprint(m.roofId, m.x, m.z, m.size)) {
        if (!t) continue;
        for (const [dx, dz] of SIDES) {
          const k = pipeKey(t.x + dx, t.z + dz);
          if (!dist.has(k)) continue;
          const into: [number, number] = [-dx || 0, -dz || 0];
          const list = out.get(k) ?? [];
          if (!list.some(([a, b]) => a === into[0] && b === into[1])) list.push(into);
          out.set(k, list);
        }
      }
    return out;
  }

  /** The pipe tiles a pump feeds: its whole line, or (a pump with a reach) those within that many steps of it. */
  reachOf(p: MachineData, net: PipeNet): Set<string> {
    const reach = this.pumpTypes.get(p.type)?.reach ?? Infinity;
    if (reach === Infinity) return new Set(net.tiles);
    const inNet = new Set(net.tiles);
    const dist = new Map<string, number>();
    const queue: string[] = [];
    for (const t of this.sim.grid.footprint(p.roofId, p.x, p.z, p.size))
      if (t)
        for (const [dx, dz] of SIDES) {
          const k = pipeKey(t.x + dx, t.z + dz);
          if (inNet.has(k) && !dist.has(k)) dist.set(k, 1), queue.push(k);
        }
    for (let i = 0; i < queue.length; i++) {
      const d = dist.get(queue[i])!;
      if (d >= reach) continue;
      const [x, z] = parse(queue[i]);
      for (const [dx, dz] of SIDES) {
        const k = pipeKey(x + dx, z + dz);
        if (inNet.has(k) && !dist.has(k)) dist.set(k, d + 1), queue.push(k);
      }
    }
    return new Set(dist.keys());
  }

  /** Does a machine's footprint touch any of these pipe tiles? */
  private touches(m: MachineData, tiles: Set<string>): boolean {
    for (const t of this.sim.grid.footprint(m.roofId, m.x, m.z, m.size)) if (t && SIDES.some(([dx, dz]) => tiles.has(pipeKey(t.x + dx, t.z + dz)))) return true;
    return false;
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

  /** E23.6.3: how much water the pipes beside a tile could give now (every body feeding them, counted once). */
  availableAt(t: TileData): number {
    const seen = new Set<string>();
    let n = 0;
    for (const k of this.fedNear(t)) {
      const [x, z] = parse(k);
      for (const s of this.sources(x, z))
        if (!seen.has(s.body)) {
          seen.add(s.body);
          n += this.water.amountOf(s.body);
        }
    }
    return n;
  }

  /** Takes up to `units` through the nearest pipe carrying water: from its pumps' water first, then its reservoirs. */
  drawAt(t: TileData, units: number, taken?: [string, number][]): number {
    let got = 0;
    for (const k of this.fedNear(t)) {
      const [x, z] = parse(k);
      const srcs = [...this.sources(x, z)].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'pump' ? -1 : 1));
      for (const s of srcs) {
        if (got >= units) return got;
        const n = this.water.draw(s.body, units - got);
        if (n > 0) taken?.push([s.body, n]); // E23.6.3: what came from where, so a short draw can be put back
        got += n;
      }
      if (got >= units) return got;
    }
    if (got > 0) this.refreshFed(); // a reservoir may have run dry
    return got;
  }

  /** E23.3: pumps are grid consumers (shed after lamps); they draw only while they move water. */
  registerPower() {
    const power = this.sim.power;
    for (const [type, spec] of this.pumpTypes) {
      if (this.registered.has(type)) continue;
      this.registered.add(type);
      power.register(type, { consumer: { shed: 'pump', draw: (m) => (this.pumping.has(m.id) ? (spec.power ?? WATER_NET.pump.power) : 0) } });
    }
    // E23.4.3: the desalination plant, a heavy load, shed with the pumps
    if (!this.registered.has('desalination')) {
      this.registered.add('desalination');
      power.register('desalination', { consumer: { shed: 'pump', draw: (m) => (this.water.desalinating.has(m.id) ? WATER_NET.desal.power : 0) } });
    }
  }
}

/** A reservoir's water body id. */
export const tankId = (m: MachineData) => `r:${m.id}`;
/** A desalination plant's tank id. */
export const plantId = (m: MachineData) => `d:${m.id}`;
/** The sea, as a body a sea pump (PumpSpec.sea) draws from: never runs dry, never saved. */
export const SEA_ID = 'sea';
