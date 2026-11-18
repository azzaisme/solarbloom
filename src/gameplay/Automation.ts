import { distToFootprint } from '../core/Grid';
import type { ComponentId, DroneData, ItemId, MachineData, SalvageState } from '../core/types';
import { AUTOMATION, HAND_JOBS, type HandJob, type RouteItem } from '../data/automation';
import { COMPONENT_RECIPES } from '../data/crafting';
import { ITEM_IDS, itemDef } from '../data/items';
import type { Sim } from './Sim';

export interface Route {
  id: string;
  from: string;
  to: string;
  item: RouteItem;
}

/** E23.3's grid, as automation needs it. */
interface PowerLike {
  isPowered(m: MachineData): boolean;
  register?(type: string, spec: { consumer: { shed: string; draw: number | ((m: MachineData) => number) } }): void;
}

/**
 * E23.6.4 (#393) and E23.6.5 (#394): automation. Jobs bloombot has done by hand a few times are handed to machines
 * and drones; there are no conveyor belts.
 *
 * - Supply crates (#440) are boxes with their own contents, for machines and drones (a Storage Chest stays a way
 *   into the shared store, so nothing E21 gives is lost). Bloombot fills and empties them by hand.
 * - Courier routes (#440): the player picks a source crate and a target crate (one item, or everything). A Drone Hub
 *   on the Courier role within reach of both flies them: it fetches a basket from the source and drops it in the
 *   target, on grid power, round after round, with nobody watching.
 * - The Assembler (#394) crafts any known component from the crate beside it (its input) into another crate beside
 *   it (its output), on grid power, at the crafting table's speed.
 * - Each opens after its job has been done by hand a few times (`hand`, counted from the game's own events).
 *
 * The farm's automation (the Mulcher, hopper composter, feed tank, sprinklers, harvesters, seed drills and the
 * auto-feeder) works the same way and lands with E23.5's items and E23.4's pipes.
 */
export class Automation {
  private registered = false;

  constructor(private sim: Sim) {
    // jobs done by hand, from the game's own events
    sim.bus.on('craft.done', () => this.did('craft'));
    sim.bus.on('store.moved', () => this.did('carry'));
    sim.bus.on('machine.removed', ({ machine }) => this.forget(machine.id));
  }

  private get sv(): SalvageState | undefined {
    return this.sim.state.salvage;
  }

  private get power(): PowerLike | undefined {
    return (this.sim as { power?: PowerLike }).power;
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
    if (h[job]! >= HAND_JOBS[job].times) this.sim.bus.emit('automation.opened', { job });
  }

  handCount(job: HandJob): number {
    return this.sv?.hand?.[job] ?? 0;
  }

  /** Has a job been done by hand enough times to hand it over? */
  handDone(job: HandJob): boolean {
    return this.handCount(job) >= HAND_JOBS[job].times;
  }

  // ───────────── supply crates ─────────────

  crates(): MachineData[] {
    return this.sim.machinesOfType('crate');
  }

  /** What a crate holds. */
  contents(id: string): Partial<Record<ItemId, number>> {
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

  /** A crate or Assembler taken down: its contents come back to bloombot (over a stack to the store); routes go. */
  private forget(id: string) {
    const sv = this.sv;
    if (!sv) return;
    const c = sv.crates?.[id];
    if (c) {
      for (const [item, n] of Object.entries(c) as [ItemId, number][]) this.sim.inventory.addToStore(item, this.sim.inventory.add(item, n));
      delete sv.crates![id];
      if (!Object.keys(sv.crates!).length) delete sv.crates;
    }
    if (sv.routes?.some((r) => r.from === id || r.to === id)) {
      sv.routes = sv.routes.filter((r) => r.from !== id && r.to !== id);
      if (!sv.routes.length) delete sv.routes;
    }
    if (sv.assemblers?.[id]) {
      delete sv.assemblers[id];
      if (!Object.keys(sv.assemblers).length) delete sv.assemblers;
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
    sv.routes = sv.routes.filter((r) => r.id !== id);
    if (!sv.routes.length) delete sv.routes;
    for (const d of this.sim.state.drones) if (d.route === id) this.dropCargo(d);
    this.sim.bus.emit('route.changed', { id });
    return true;
  }

  /** What one courier trip carries (Bigger baskets research adds to it). */
  carry(): number {
    return AUTOMATION.route.carry + Math.round(this.sim.research?.effect('droneCarry') ?? 0);
  }

  /** What a route would carry now: the items in its source crate it moves, while the target has room. */
  private basketFor(r: Route): { item: ItemId; n: number }[] {
    let left = Math.min(this.carry(), this.room(r.to));
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

  /** A route that one of this hub's couriers could fly now (its source has something its target has room for). */
  routeFor(hub: MachineData, d: DroneData): Route | undefined {
    const busy = new Set(this.sim.state.drones.filter((x) => x !== d && x.route).map((x) => x.route));
    return this.routes().find((r) => !busy.has(r.id) && this.hubsFor(r).includes(hub) && this.basketFor(r).length > 0);
  }

  /** E18.4's courier, given a route: fly to fetch from the source crate. */
  startRoute(d: DroneData, r: Route): void {
    d.role = 'courier';
    d.route = r.id;
    d.cargo = undefined;
    d.targetMachineId = r.from;
  }

  /**
   * A courier on a route arrived: at the source it takes the basket and turns for the target; at the target it puts
   * the basket in. Returns true while the trip goes on (the drone flies again), false when it is done.
   */
  arrive(d: DroneData): boolean {
    const r = this.routes().find((q) => q.id === d.route);
    if (!r) {
      this.dropCargo(d);
      return false;
    }
    if (!d.cargo) {
      const basket = this.basketFor(r);
      for (const b of basket) b.n = this.take(r.from, b.item, b.n);
      d.cargo = basket.filter((b) => b.n > 0);
      if (!d.cargo.length) {
        d.cargo = undefined;
        d.route = undefined;
        return false;
      }
      d.targetMachineId = r.to;
      return true;
    }
    for (const b of d.cargo) {
      const put = this.put(r.to, b.item, b.n);
      // no room after all: what didn't fit goes back where it came from
      if (put < b.n) this.put(r.from, b.item, b.n - put);
    }
    this.sim.bus.emit('route.delivered', { id: r.id, items: d.cargo.reduce((a, b) => a + b.n, 0) });
    d.cargo = undefined;
    d.route = undefined;
    return false;
  }

  /** A trip cut short (its route removed): the basket goes back to its source crate, or to the store. */
  private dropCargo(d: DroneData) {
    const r = this.routes().find((q) => q.id === d.route);
    for (const b of d.cargo ?? []) {
      const back = r ? this.put(r.from, b.item, b.n) : 0;
      if (back < b.n) this.sim.inventory.addToStore(b.item, b.n - back);
    }
    d.cargo = undefined;
    d.route = undefined;
  }

  // ───────────── the Assembler ─────────────

  assemblers(): MachineData[] {
    return this.sim.machinesOfType('assembler');
  }

  /** The supply crates beside an Assembler, nearest first: the first is its input, the second its output. */
  cratesBeside(m: MachineData): MachineData[] {
    const R = AUTOMATION.assembler.crateReach;
    return this.crates()
      .filter((c) => c.roofId === m.roofId && distToFootprint(c.x, c.z, m.x, m.z, m.size) <= R)
      .sort((a, b) => distToFootprint(a.x, a.z, m.x, m.z, m.size) - distToFootprint(b.x, b.z, m.x, m.z, m.size) || (a.id < b.id ? -1 : 1));
  }

  /** An Assembler's input and output crates (one crate can be both). */
  io(m: MachineData): { input?: MachineData; output?: MachineData } {
    const c = this.cratesBeside(m);
    return { input: c[0], output: c[1] ?? c[0] };
  }

  recipeOf(m: MachineData): ComponentId | undefined {
    return this.sv?.assemblers?.[m.id]?.recipe as ComponentId | undefined;
  }

  /** Sets what an Assembler makes (any component the table knows). */
  setRecipe(m: MachineData, recipe: ComponentId | undefined): boolean {
    if (recipe && !this.sim.crafting.components().some((r) => r.id === recipe)) return false;
    const sv = this.sv!;
    const all = (sv.assemblers ??= {});
    if (recipe) all[m.id] = { recipe, left: undefined };
    else delete all[m.id];
    if (!Object.keys(all).length) delete sv.assemblers;
    this.sim.bus.emit('assembler.changed', { id: m.id });
    return true;
  }

  /** Why an Assembler is idle now, if it is (nothing to make, no crates, short of inputs, no room, no power). */
  assemblerProblem(m: MachineData): string | undefined {
    const recipe = this.recipeOf(m);
    if (!recipe) return 'Choose what it makes';
    const { input, output } = this.io(m);
    if (!input) return 'Put a supply crate beside it for what it uses';
    const r = COMPONENT_RECIPES.find((q) => q.id === recipe)!;
    for (const [k, v] of Object.entries(r.cost) as [ItemId, number][]) if (this.count(input.id, k) < v) return `Waiting for ${itemDef(k).name}`;
    if (output && this.room(output.id) < r.makes) return 'Its output crate is full';
    if (this.power && !this.power.isPowered(m)) return 'Waiting for power';
    return undefined;
  }

  private tickAssemblers(dt: number) {
    const all = this.sv?.assemblers;
    if (!all) return;
    for (const m of this.assemblers()) {
      const st = all[m.id];
      if (!st?.recipe) continue;
      const r = COMPONENT_RECIPES.find((q) => q.id === st.recipe);
      if (!r) continue;
      const { input, output } = this.io(m);
      if (st.left === undefined) {
        // start a craft: take its inputs from the input crate
        if (this.assemblerProblem(m)) continue;
        for (const [k, v] of Object.entries(r.cost) as [ItemId, number][]) this.take(input!.id, k, v);
        st.left = r.seconds / AUTOMATION.assembler.speed;
      }
      if (this.power && !this.power.isPowered(m)) continue; // paused without power; carries on by itself
      st.left -= dt;
      if (st.left > 1e-9) continue;
      const out = output ?? input;
      const put = out ? this.put(out.id, r.id, r.makes) : 0;
      if (put < r.makes) this.sim.inventory.addToStore(r.id, r.makes - put);
      st.left = undefined;
      this.sim.bus.emit('assembler.made', { id: m.id, item: r.id, made: r.makes });
    }
  }

  /** Is an Assembler crafting right now (for its grid draw and its look)? */
  working(m: MachineData): boolean {
    const st = this.sv?.assemblers?.[m.id];
    return st?.left !== undefined && (!this.power || this.power.isPowered(m));
  }

  tick(dt: number) {
    if (!this.registered && this.power?.register) {
      this.registered = true;
      this.power.register('assembler', { consumer: { shed: 'helper', draw: (m: MachineData) => (this.sv?.assemblers?.[m.id]?.recipe ? AUTOMATION.assembler.draw : 0) } });
    }
    this.tickAssemblers(dt);
  }
}
