import { distToFootprint } from '../core/Grid';
import type { ComponentId, DroneData, ItemId, MachineData, SalvageState } from '../core/types';
import { AUTOMATION, HAND_JOBS, type HandJob, type RouteItem } from '../data/automation';
import type { ComponentRecipe } from '../data/crafting';
import { ITEM_IDS, itemDef } from '../data/items';
import type { Sim } from './Sim';

export interface Route {
  id: string;
  from: string;
  to: string;
  item: RouteItem;
}

type Items = Partial<Record<ItemId, number>>;
type AssemblerState = NonNullable<SalvageState['assemblers']>[string];
/** Where something is (a machine, a drone, bloombot): for the nearest crate. */
interface Spot {
  roofId: string;
  x: number;
  z: number;
}

/**
 * E23.6.4 (#393) and E23.6.5 (#394): automation. Jobs bloombot has done by hand a few times are handed to machines
 * and drones; there are no conveyor belts.
 *
 * - Supply crates (#440) are boxes with their own contents, for machines and drones (a Storage Chest stays a way
 *   into the shared store, so nothing E21 gives is lost). Bloombot fills and empties them by hand, and building takes
 *   from crates near bloombot after the backpack (Inventory.pay), so a site couriers keep supplied builds by itself.
 * - Courier routes (#440): the player picks a source crate and a target crate (one item, or everything). A Drone Hub
 *   on the Courier role within reach of both flies them: it books room in the target, fetches a basket from the
 *   source and drops it in the target, on grid power, round after round, with nobody watching.
 * - The Assembler (#394) makes any item recipe the table knows from its input crate into its output crate (the
 *   player chooses both among the crates beside it), on grid power, at the crafting table's speed.
 * - Each opens after its job has been done by hand a few times (`hand`, counted from the game's own events).
 *
 * Nothing is ever lost: a basket with nowhere to go, a craft stopped part way and a machine taken down all give
 * their things back (`stash`: the nearest crate with room, then the backpack, then the store, which has no limit).
 *
 * The farm's automation (#441-#444: the Mulcher, hopper composter, feed tank, sprinklers, harvesters, seed drills and
 * the auto-feeder) will work the same way, from crates; it is not in this class yet.
 */
export class Automation {
  constructor(private sim: Sim) {
    // jobs done by hand, from the game's own events
    sim.bus.on('craft.done', () => this.did('craft'));
    sim.bus.on('store.moved', () => this.did('carry'));
    sim.bus.on('machine.removed', ({ machine }) => this.forget(machine));
    // E23.3: the Assembler is a helper on the grid, drawing only while it crafts
    sim.power.register('assembler', { consumer: { shed: 'helper', draw: (m) => (this.sv?.assemblers?.[m.id]?.left !== undefined ? AUTOMATION.assembler.draw : 0) } });
  }

  private get sv(): SalvageState | undefined {
    return this.sim.state.salvage;
  }

  // ───────────── jobs done by hand ─────────────

  /** One more time a job was done by hand. */
  did(job: HandJob, n = 1) {
    const sv = this.sv;
    if (!sv) return;
    const h = (sv.hand ??= {});
    const before = h[job] ?? 0;
    if (before >= HAND_JOBS[job].times) return; // enough: the count stops (saves stay small)
    h[job] = Math.min(HAND_JOBS[job].times, before + n);
  }

  handCount(job: HandJob): number {
    return this.sv?.hand?.[job] ?? 0;
  }

  /** Has a job been done by hand enough times to hand it over? */
  handDone(job: HandJob): boolean {
    return this.handCount(job) >= HAND_JOBS[job].times;
  }

  /** E23.6.2: courier routes read research's Bigger baskets (`carry()`), so the station offers it once they open. */
  get researchReady(): boolean {
    return !!this.sv && this.handDone('carry');
  }

  // ───────────── supply crates ─────────────

  crates(): MachineData[] {
    return this.sim.machinesOfType('crate');
  }

  /** What a crate holds. */
  contents(id: string): Items {
    return this.sv?.crates?.[id] ?? {};
  }

  count(id: string, item: ItemId): number {
    return this.contents(id)[item] ?? 0;
  }

  /** Units in a crate, every item together. */
  load(id: string): number {
    return Object.values(this.contents(id)).reduce((a, n) => a + (n ?? 0), 0);
  }

  room(id: string): number {
    return Math.max(0, AUTOMATION.crate.capacity - this.load(id));
  }

  private setCount(id: string, item: ItemId, n: number) {
    const sv = this.sv!;
    const all = (sv.crates ??= {});
    const c = (all[id] ??= {});
    if (n > 0) c[item] = n;
    else delete c[item];
    if (!Object.keys(c).length) delete all[id];
    if (!Object.keys(all).length) delete sv.crates;
    this.sim.bus.emit('crate.changed', { id });
  }

  /** Puts units in a crate; returns how many fitted. */
  put(id: string, item: ItemId, n: number): number {
    if (!this.sim.machine(id) || this.sim.machine(id)!.type !== 'crate') return 0;
    const k = Math.max(0, Math.min(Math.floor(n), this.room(id)));
    if (k) this.setCount(id, item, this.count(id, item) + k);
    return k;
  }

  /** Takes up to `n` units out of a crate; returns how many came out. */
  take(id: string, item: ItemId, n: number): number {
    const k = Math.max(0, Math.min(Math.floor(n), this.count(id, item)));
    if (k) this.setCount(id, item, this.count(id, item) - k);
    return k;
  }

  /** Bloombot puts things from the backpack in a crate (as many as fit). Returns how many moved. */
  fill(id: string, item: ItemId, n = this.sim.inventory.count(item)): number {
    // a crate that still stands, checked before anything leaves the backpack (a stale panel button moves nothing)
    if (this.sim.machine(id)?.type !== 'crate') return 0;
    const k = Math.min(n, this.sim.inventory.count(item), this.room(id));
    if (k <= 0 || !this.sim.inventory.take(item, k)) return 0;
    return this.put(id, item, k);
  }

  /** Bloombot takes things out of a crate into the backpack (as many as fit). Returns how many moved. */
  empty(id: string, item: ItemId, n = this.count(id, item)): number {
    const k = Math.min(n, this.count(id, item), this.sim.inventory.room(item));
    if (k <= 0) return 0;
    this.take(id, item, k);
    const left = this.sim.inventory.add(item, k);
    if (left) this.put(id, item, left);
    return k - left;
  }

  /** Supply crates on a spot's layer within `reach` tiles of it, nearest first. */
  cratesNear(at: Spot, reach = AUTOMATION.build.crateReach, except?: string): MachineData[] {
    const x = Math.floor(at.x);
    const z = Math.floor(at.z);
    const d = (c: MachineData) => distToFootprint(x, z, c.x, c.z, c.size);
    return this.crates()
      .filter((c) => c.id !== except && c.roofId === at.roofId && d(c) <= reach)
      .sort((a, b) => d(a) - d(b) || (a.id < b.id ? -1 : 1));
  }

  /**
   * Puts things somewhere they are kept, never lost: the first of `prefer` with room, then the nearest crate to
   * `at` with room (never `except`, a crate going), then bloombot's backpack, then the store (which has no limit).
   */
  stash(item: ItemId, n: number, at?: Spot, prefer: string[] = [], except?: string) {
    let left = Math.floor(n);
    for (const id of prefer) if (left > 0 && id !== except) left -= this.put(id, item, left);
    if (left > 0 && at) for (const c of this.cratesNear(at, Infinity, except)) if (left > 0) left -= this.put(c.id, item, left);
    if (left > 0) left = this.sim.inventory.add(item, left);
    if (left > 0) this.sim.inventory.addToStore(item, left);
  }

  /** A crate or Assembler taken down: what it held comes back (a crate's to bloombot, a craft's to its crates); routes go. */
  private forget(m: MachineData) {
    const sv = this.sv;
    if (!sv) return;
    const c = sv.crates?.[m.id];
    if (c) {
      delete sv.crates![m.id];
      if (!Object.keys(sv.crates!).length) delete sv.crates;
      // to the crate nearest where it stood, then the backpack, then the store
      for (const [item, n] of Object.entries(c) as [ItemId, number][]) this.stash(item, n, m, [], m.id);
    }
    if (sv.routes?.some((r) => r.from === m.id || r.to === m.id)) {
      const gone = new Set(sv.routes.filter((r) => r.from === m.id || r.to === m.id).map((r) => r.id));
      // baskets on the way come back first (their source crate, if it still stands)
      for (const d of this.sim.state.drones) if (d.route && gone.has(d.route)) this.dropCargo(d);
      sv.routes = sv.routes.filter((r) => !gone.has(r.id));
      if (!sv.routes.length) delete sv.routes;
    }
    const st = sv.assemblers?.[m.id];
    if (st) {
      // a craft part way: what it took goes back to its input crate (or the nearest crate, the backpack, the store)
      this.refund(m, st);
      delete sv.assemblers![m.id];
      if (!Object.keys(sv.assemblers!).length) delete sv.assemblers;
    }
  }

  // ───────────── courier routes ─────────────

  routes(): readonly Route[] {
    return this.sv?.routes ?? [];
  }

  /** The courier hubs within reach of both ends of a route (a Drone Hub on the Courier role). */
  hubsFor(r: Pick<Route, 'from' | 'to'>): MachineData[] {
    const a = this.sim.machine(r.from);
    const b = this.sim.machine(r.to);
    if (!a || !b) return [];
    return this.sim.machinesOfType('droneHub').filter((h) => {
      if (this.sim.roles.roleOf(h) !== 'courier' && h.role2 !== 'courier') return false;
      const R = this.sim.drones.radius(h);
      const near = (m: MachineData) => m.roofId === h.roofId && distToFootprint(Math.floor(m.x + m.size / 2), Math.floor(m.z + m.size / 2), h.x, h.z, h.size) <= R;
      return near(a) && near(b);
    });
  }

  /** Why a route can't be set, if it can't. */
  routeProblem(from: string, to: string): string | undefined {
    const a = this.sim.machine(from);
    const b = this.sim.machine(to);
    if (!this.handDone('carry')) return `Couriers open once you have moved things to and from the store ${HAND_JOBS.carry.times} times`;
    if (!a || a.type !== 'crate' || !b || b.type !== 'crate') return 'A route runs from one supply crate to another';
    if (a.id === b.id) return 'Pick another crate to send to';
    if (this.routes().some((r) => r.from === from && r.to === to)) return 'These crates are already linked';
    if (this.routes().filter((r) => r.from === from).length >= AUTOMATION.route.perCrate) return `At most ${AUTOMATION.route.perCrate} routes from one crate`;
    if (this.routes().length >= AUTOMATION.route.max) return `At most ${AUTOMATION.route.max} routes`;
    return undefined;
  }

  /** Sets a route; returns its id or why not. A hub to fly it may come later: the route waits for one. */
  addRoute(from: string, to: string, item: RouteItem = 'all'): { id?: string; why?: string } {
    const why = this.routeProblem(from, to);
    if (why) return { why };
    const id = this.sim.newId('route');
    const sv = this.sv!;
    sv.routes = [...(sv.routes ?? []), { id, from, to, item }];
    this.sim.bus.emit('route.changed', { id });
    return { id };
  }

  /** Changes what a route carries. */
  setRouteItem(id: string, item: RouteItem): boolean {
    const r = this.sv?.routes?.find((q) => q.id === id);
    if (!r) return false;
    r.item = item;
    this.sim.bus.emit('route.changed', { id });
    return true;
  }

  removeRoute(id: string): boolean {
    const sv = this.sv;
    if (!sv?.routes?.some((r) => r.id === id)) return false;
    for (const d of this.sim.state.drones) if (d.route === id) this.dropCargo(d);
    sv.routes = sv.routes.filter((r) => r.id !== id);
    if (!sv.routes.length) delete sv.routes;
    this.sim.bus.emit('route.changed', { id });
    return true;
  }

  /** What one courier trip carries (Bigger baskets research adds to it). */
  carry(): number {
    return AUTOMATION.route.carry + Math.round(this.sim.research?.effect('droneCarry') ?? 0);
  }

  /** Room in a crate already booked by couriers on their way to it (what they carry, or what they set out to fetch). */
  booked(to: string, except?: DroneData): number {
    let n = 0;
    const into = new Set(this.routes().filter((r) => r.to === to).map((r) => r.id));
    for (const d of this.sim.state.drones) {
      if (d === except || !d.route || !into.has(d.route)) continue;
      n += d.cargo ? d.cargo.reduce((a, b) => a + b.n, 0) : (d.reserve ?? 0);
    }
    return n;
  }

  /** What a route would carry now: the items in its source crate it moves, into room in the target nobody has booked. */
  private basketFor(r: Route, d?: DroneData): { item: ItemId; n: number }[] {
    let left = Math.min(this.carry(), this.room(r.to) - this.booked(r.to, d));
    const out: { item: ItemId; n: number }[] = [];
    const items = r.item === 'all' ? ITEM_IDS : [r.item];
    for (const item of items) {
      if (left <= 0) break;
      const n = Math.min(left, this.count(r.from, item));
      if (n > 0) {
        out.push({ item, n });
        left -= n;
      }
    }
    return out;
  }

  /** A route that one of this hub's couriers could fly now (its source has something its target has unbooked room for). */
  routeFor(hub: MachineData, d: DroneData): Route | undefined {
    const busy = new Set(this.sim.state.drones.filter((x) => x !== d && x.route).map((x) => x.route));
    return this.routes().find((r) => !busy.has(r.id) && this.hubsFor(r).includes(hub) && this.basketFor(r, d).length > 0);
  }

  /** E18.4's courier, given a route: book room in the target, then fly to fetch from the source crate. */
  startRoute(d: DroneData, r: Route): void {
    d.role = 'courier';
    d.route = r.id;
    d.cargo = undefined;
    d.reserve = this.basketFor(r, d).reduce((a, b) => a + b.n, 0);
    d.targetMachineId = r.from;
  }

  /**
   * A courier on a route arrived: at the source it takes the basket (up to the room it booked) and turns for the
   * target; at the target it puts the basket in. Returns true while the trip goes on (the drone flies again), false
   * when it is done.
   */
  arrive(d: DroneData): boolean {
    const r = this.routes().find((q) => q.id === d.route);
    if (!r) {
      this.dropCargo(d);
      return false;
    }
    if (!d.cargo) {
      let room = d.reserve ?? 0;
      d.reserve = undefined;
      const basket = this.basketFor(r, d);
      for (const b of basket) {
        b.n = this.take(r.from, b.item, Math.min(b.n, room));
        room -= b.n;
      }
      d.cargo = basket.filter((b) => b.n > 0);
      if (!d.cargo.length) {
        d.cargo = undefined;
        d.route = undefined;
        return false;
      }
      d.targetMachineId = r.to;
      return true;
    }
    const at = this.sim.machine(r.to);
    for (const b of d.cargo) {
      const put = this.put(r.to, b.item, b.n);
      // filled by hand since it set out: what didn't fit goes back to its source, else somewhere it is kept
      if (put < b.n) this.stash(b.item, b.n - put, at, [r.from]);
    }
    this.sim.bus.emit('route.delivered', { id: r.id, items: d.cargo.reduce((a, b) => a + b.n, 0) });
    d.cargo = undefined;
    d.route = undefined;
    return false;
  }

  /**
   * A trip cut short (its route removed, a crate or its hub taken down): the basket goes back to its source crate,
   * else the nearest crate with room, the backpack or the store. Nothing is lost.
   */
  dropCargo(d: DroneData) {
    const r = this.routes().find((q) => q.id === d.route);
    const at = this.sim.machine(d.hubId);
    for (const b of d.cargo ?? []) this.stash(b.item, b.n, at ? { roofId: at.roofId, x: d.px, z: d.pz } : undefined, r ? [r.from] : []);
    d.cargo = undefined;
    d.reserve = undefined;
    d.route = undefined;
  }

  /** A hub taken down: its couriers' baskets come back before the drones go. */
  hubRemoved(hubId: string) {
    for (const d of this.sim.state.drones) if (d.hubId === hubId && (d.cargo || d.route)) this.dropCargo(d);
  }

  // ───────────── the Assembler ─────────────

  assemblers(): MachineData[] {
    return this.sim.machinesOfType('assembler');
  }

  private stateOf(m: MachineData): AssemblerState | undefined {
    return this.sv?.assemblers?.[m.id];
  }

  private ensureState(m: MachineData): AssemblerState {
    const sv = this.sv!;
    return ((sv.assemblers ??= {})[m.id] ??= {});
  }

  /** Drops an Assembler's entry once it holds nothing worth keeping (no recipe, no craft, no chosen crates). */
  private tidy(m: MachineData) {
    const sv = this.sv!;
    const st = sv.assemblers?.[m.id];
    if (st && !st.recipe && st.left === undefined && !st.input && !st.output) delete sv.assemblers![m.id];
    if (sv.assemblers && !Object.keys(sv.assemblers).length) delete sv.assemblers;
  }

  /** The supply crates beside an Assembler, nearest first. */
  cratesBeside(m: MachineData): MachineData[] {
    const R = AUTOMATION.assembler.crateReach;
    return this.crates()
      .filter((c) => c.roofId === m.roofId && distToFootprint(c.x, c.z, m.x, m.z, m.size) <= R)
      .sort((a, b) => distToFootprint(a.x, a.z, m.x, m.z, m.size) - distToFootprint(b.x, b.z, m.x, m.z, m.size) || (a.id < b.id ? -1 : 1));
  }

  /**
   * An Assembler's input and output crates: the ones the player chose (while they stand beside it), else the nearest
   * crate in and the next out (one crate can be both).
   */
  io(m: MachineData): { input?: MachineData; output?: MachineData } {
    const c = this.cratesBeside(m);
    const st = this.stateOf(m);
    const pick = (id: string | undefined) => c.find((x) => x.id === id);
    const input = pick(st?.input) ?? c.find((x) => x.id !== st?.output) ?? c[0];
    const output = pick(st?.output) ?? c.find((x) => x !== input) ?? input;
    return { input, output };
  }

  /** The player chooses which crate beside an Assembler is its input or output (undefined: the nearest again). */
  setCrate(m: MachineData, which: 'input' | 'output', crateId: string | undefined): boolean {
    if (crateId && !this.cratesBeside(m).some((c) => c.id === crateId)) return false;
    const st = this.ensureState(m);
    st[which] = crateId;
    if (!crateId) delete st[which];
    this.tidy(m);
    this.sim.bus.emit('assembler.changed', { id: m.id });
    return true;
  }

  /** The next crate beside it for input or output (the panel's button steps through them). */
  nextCrate(m: MachineData, which: 'input' | 'output'): boolean {
    const c = this.cratesBeside(m);
    if (!c.length) return false;
    const now = this.io(m)[which];
    const i = c.findIndex((x) => x === now);
    return this.setCrate(m, which, c[(i + 1) % c.length].id);
  }

  recipeOf(m: MachineData): ComponentId | undefined {
    return this.stateOf(m)?.recipe as ComponentId | undefined;
  }

  private recipe(id: string | undefined): ComponentRecipe | undefined {
    return id ? this.sim.crafting.itemRecipes().find((r) => r.id === id) : undefined;
  }

  /** A craft part way given back: what it took goes to its input crate, else the nearest crate, the backpack, the store. */
  private refund(m: MachineData, st: AssemblerState) {
    const taken = st.taken;
    st.taken = undefined;
    st.left = undefined;
    if (!taken) return;
    const input = this.io(m).input;
    for (const [item, n] of Object.entries(taken) as [ItemId, number][]) this.stash(item, n, m, input ? [input.id] : []);
  }

  /**
   * Sets what an Assembler makes (any item recipe the table knows). The same recipe again changes nothing; another
   * one gives back what the craft in hand took first.
   */
  setRecipe(m: MachineData, recipe: ComponentId | undefined): boolean {
    if (recipe && !this.recipe(recipe)) return false;
    const st = this.stateOf(m);
    if ((st?.recipe ?? undefined) === recipe) return true;
    if (st) this.refund(m, st);
    const s = this.ensureState(m);
    if (recipe) s.recipe = recipe;
    else delete s.recipe;
    this.tidy(m);
    this.sim.bus.emit('assembler.changed', { id: m.id });
    return true;
  }

  /** Why an Assembler is idle now, if it is (nothing to make, no crates, short of inputs, no room, no power). */
  assemblerProblem(m: MachineData): string | undefined {
    const r = this.recipe(this.recipeOf(m));
    if (!r) return 'Choose what it makes';
    const { input, output } = this.io(m);
    if (!input) return 'Put a supply crate beside it for what it uses';
    if (this.stateOf(m)?.left === undefined) for (const [k, v] of Object.entries(r.cost) as [ItemId, number][]) if (this.count(input.id, k) < v) return `Waiting for ${itemDef(k).name}`;
    if (output && this.room(output.id) < r.makes) return 'Its output crate is full';
    if (!this.sim.power.isPowered(m)) return 'Waiting for power';
    return undefined;
  }

  private tickAssemblers(dt: number) {
    const all = this.sv?.assemblers;
    if (!all) return;
    for (const m of this.assemblers()) {
      const st = all[m.id];
      const r = this.recipe(st?.recipe);
      if (!st || !r) continue;
      const { input, output } = this.io(m);
      if (st.left === undefined) {
        // start a craft: take its inputs from the input crate (kept on the craft until it is done)
        if (this.assemblerProblem(m)) continue;
        st.taken = {};
        for (const [k, v] of Object.entries(r.cost) as [ItemId, number][]) st.taken[k] = this.take(input!.id, k, v);
        st.left = r.seconds / AUTOMATION.assembler.speed;
      }
      if (!this.sim.power.isPowered(m)) continue; // paused without power; carries on by itself
      st.left -= dt;
      if (st.left > 1e-9) continue;
      const out = output ?? input;
      this.stash(r.id, r.makes, m, out ? [out.id] : []);
      st.left = undefined;
      st.taken = undefined;
    }
  }

  /** Is an Assembler crafting right now (for its look)? */
  working(m: MachineData): boolean {
    return this.stateOf(m)?.left !== undefined && this.sim.power.isPowered(m);
  }

  tick(dt: number) {
    this.tickAssemblers(dt);
  }
}
