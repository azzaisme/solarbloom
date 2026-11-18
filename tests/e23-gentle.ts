import { SaveService } from '../src/app/SaveService';
import { big } from '../src/core/Big';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { GroundState, MachineData, TileData } from '../src/core/types';
import { PARK } from '../src/core/Areas';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

/**
 * E23.10.1 (#405): the gentle-failure proof. Epic rule 2, "cozy wins every tie": whatever runs out (power, water,
 * bloombot's charge, a Bio Digester's feed) and whatever the weather does, nothing goes back to dead ground,
 * nothing restored drops below restored, no crop dies, no build is lost, bloombot is never stranded, and
 * everything comes back once the shortage ends.
 *
 * The E23 systems are being built in parallel. Each probe below finds its system on the sim by the agreed handle
 * (`sim.power`, `sim.water`, `sim.charge`, the farm, the weather) and reports `undefined` until it lands, so its
 * checks skip cleanly. When a system lands, its probe is pointed at its real API here (one place), and the suite
 * picks it up. The hooks each probe tries, in order, are listed with it; a system can expose any of them.
 */

/** A game day is 48 minutes of play (epic rule 5). */
export const GAME_DAY = 48 * 60;

type Obj = Record<string, unknown>;
const fn = (o: unknown, name: string) => (o && typeof (o as Obj)[name] === 'function' ? ((o as Obj)[name] as (...a: unknown[]) => unknown).bind(o) : undefined);
/** Calls the first of `names` the object has. True when one was found. */
function callFirst(o: unknown, names: string[], ...args: unknown[]): boolean {
  for (const n of names) {
    const f = fn(o, n);
    if (f) {
      f(...args);
      return true;
    }
  }
  return false;
}
export const handle = (sim: Sim, name: string): Obj | undefined => (sim as unknown as Record<string, Obj | undefined>)[name] ?? undefined;

/** One store that can run out. */
export interface Probe {
  name: 'power' | 'water' | 'charge' | 'digester';
  /** The system on this sim, or undefined while it hasn't landed. */
  find(sim: Sim): Obj | undefined;
  /** Empty it everywhere, without removing anything built. */
  drain(sim: Sim): void;
  /** Fill it again (as sun, rain, food or a top-up would). */
  refill(sim: Sim): void;
  /** After a refill and some time: is everything this store feeds working again? Lists what isn't. */
  unrecovered(sim: Sim): string[];
}

const DRAIN = ['drainForTest', 'drainAll', 'drain'];
const REFILL = ['refillForTest', 'refillAll', 'refill', 'fill'];

/** Drains through a hook, or by zeroing the obvious level fields. */
function drainVia(o: Obj | undefined, fields: string[]) {
  if (!o) return;
  if (callFirst(o, DRAIN)) return;
  for (const f of fields) if (typeof o[f] === 'number') o[f] = 0;
}
function refillVia(o: Obj | undefined, fields: string[], max: string[]) {
  if (!o) return;
  if (callFirst(o, REFILL)) return;
  const cap = max.map((m) => o[m]).find((v) => typeof v === 'number') as number | undefined;
  for (const f of fields) if (typeof o[f] === 'number') o[f] = cap ?? 1;
}

/** E23.3 (#357): the power grid. Consumers switch off one at a time when short and come back by themselves. */
export const POWER: Probe = {
  name: 'power',
  find: (sim) => handle(sim, 'power'),
  drain: (sim) => drainVia(handle(sim, 'power'), ['stored', 'battery']),
  refill: (sim) => refillVia(handle(sim, 'power'), ['stored', 'battery'], ['capacity']),
  unrecovered: (sim) => {
    const isPowered = fn(handle(sim, 'power'), 'isPowered');
    if (!isPowered) return [];
    return sim.state.machines.filter((m) => !m.starter && isPowered(m) === false && consumes(sim, m)).map((m) => `${m.type} ${m.id} still unpowered`);
  },
};
/** A machine the grid feeds (the grid may say; otherwise every machine counts). */
function consumes(sim: Sim, m: MachineData): boolean {
  const f = fn(handle(sim, 'power'), 'isConsumer') ?? fn(handle(sim, 'power'), 'consumes');
  return f ? f(m) !== false : true;
}

/** E23.4 (#358): water levels. Land fades to plain restored ground and greens again on refill. */
export const WATER: Probe = {
  name: 'water',
  find: (sim) => handle(sim, 'water'),
  drain: (sim) => drainVia(handle(sim, 'water'), ['level']),
  refill: (sim) => refillVia(handle(sim, 'water'), ['level'], ['capacity']),
  unrecovered: (sim) => {
    const dry = fn(handle(sim, 'water'), 'isDry') ?? fn(handle(sim, 'water'), 'dry');
    if (!dry) return [];
    return sim.areas.tiles(PARK).filter((t) => t.ground === 'restored' && dry(t) === true).slice(0, 5).map((t) => `tile ${t.x},${t.z} still dry`);
  },
};

/** E23.2.1 (#371): bloombot's charge. At zero: a low-power walk, never stranded, nothing lost. */
export const CHARGE: Probe = {
  name: 'charge',
  find: (sim) => handle(sim, 'charge'),
  drain: (sim) => drainVia(handle(sim, 'charge'), ['value', 'current', 'charge']),
  refill: (sim) => refillVia(handle(sim, 'charge'), ['value', 'current', 'charge'], ['max', 'capacity']),
  unrecovered: (sim) => {
    const c = handle(sim, 'charge');
    const v = ['value', 'current', 'charge'].map((f) => c?.[f]).find((x) => typeof x === 'number') as number | undefined;
    return v !== undefined && v <= 0 ? ['charge still at zero after a refill'] : [];
  },
};

/** E23.5.3 (#388): the Bio Digester. An empty one just stops; the grid sheds load gently. */
export const DIGESTER: Probe = {
  name: 'digester',
  find: (sim) => {
    const farm = handle(sim, 'farm');
    const d = handle(sim, 'digester') ?? (farm?.digester as Obj | undefined) ?? (farm?.digesters as Obj | undefined);
    return d;
  },
  drain: (sim) => {
    const d = DIGESTER.find(sim);
    if (d && !callFirst(d, ['drainForTest', 'emptyAll', 'drainAll', 'drain'])) for (const m of sim.state.machines as unknown as Obj[]) if (typeof m.feed === 'number') m.feed = 0;
  },
  refill: (sim) => {
    const d = DIGESTER.find(sim);
    if (d && !callFirst(d, ['refillForTest', 'feedAll', 'refillAll', 'refill'])) for (const m of sim.state.machines as unknown as Obj[]) if (typeof m.feed === 'number') m.feed = 10;
  },
  unrecovered: (sim) => POWER.unrecovered(sim),
};

export const PROBES: Probe[] = [POWER, WATER, CHARGE, DIGESTER];

/** E23.7.2 (#396, #450): weather. Storms are forced through the first hook the weather system has. */
export function weather(sim: Sim): Obj | undefined {
  return handle(sim, 'weather') ?? (handle(sim, 'time')?.weather as Obj | undefined) ?? (handle(sim, 'clock')?.weather as Obj | undefined);
}
export function forceStorm(sim: Sim, seconds: number): boolean {
  return callFirst(weather(sim), ['forceForTest', 'force', 'set', 'setWeather'], 'storm', seconds);
}
/** Lightning can trip a pole: one press resets it (E23.7.2). */
export function resetTrippedPoles(sim: Sim) {
  callFirst(handle(sim, 'power'), ['resetAll', 'resetTripped', 'resetPoles']);
}

/** E23.2.1: can bloombot still walk at zero charge? (A low-power walk; true while charge hasn't landed.) */
export function canWalk(sim: Sim): boolean {
  const f = fn(handle(sim, 'charge'), 'canWalk');
  return f ? f() !== false : true;
}

/** Planted crops, wherever the farm keeps them: machines (planter boxes) carrying a `crop`. */
export function crops(sim: Sim): { id: string; crop: Obj }[] {
  const list = fn(handle(sim, 'farm'), 'planters');
  const ms = (list ? (list() as Obj[]) : (sim.state.machines as unknown as Obj[])) ?? [];
  return ms.filter((m) => m.crop && typeof m.crop === 'object').map((m) => ({ id: String(m.id), crop: m.crop as Obj }));
}

// --- the home scene -------------------------------------------------------------------------------------------

/**
 * A home a few game hours in: the park restored, Mast Row open and part-restored (some tiles prepared and growing),
 * a few machines standing. Systems that have landed add their own pieces through their probes' `seed` hooks
 * (`seedForTest(sim)` on any handle, if present) — a charger, a battery, a planter, a pond.
 */
export function homeScene(seed: number): Sim {
  const sim = new Sim(createInitialState(seed, 'oldcity'));
  const salvage = sim.state.salvage!;
  salvage.tier = 2;
  salvage.abilities.push('pry', 'hover');
  sim.areas.clear(PARK, true);
  sim.gates.open('g-mastRow');
  for (const k of ['energy', 'water'] as const) {
    sim.state.caps[k] = big(1e6);
    sim.state.resources[k] = big(1e6);
  }
  // Mast Row part-way: a strip prepared, a strip growing, a strip restored.
  const mast = sim.areas.tiles('mastRow').filter((t) => !t.blocked && !t.occupantId);
  mast.slice(0, 30).forEach((t) => setGround(sim, t, 'prepared'));
  mast.slice(30, 60).forEach((t) => setGround(sim, t, 'growing'));
  mast.slice(60, 90).forEach((t) => setGround(sim, t, 'restored'));
  // A few things built in the park.
  const free = sim.areas.tiles(PARK).filter((t) => t.ground === 'restored' && !t.occupantId && !t.blocked);
  for (const type of ['solar', 'solar', 'condenser'] as const) {
    const spot = free.find((t) => sim.build.check(type, GROUND, t.x, t.z).ok);
    if (spot) sim.build.place(type, GROUND, spot.x, spot.z);
  }
  for (const h of ['power', 'water', 'charge', 'farm', 'weather', 'digester']) callFirst(handle(sim, h), ['seedForTest'], sim);
  return sim;
}
function setGround(sim: Sim, t: TileData, g: GroundState) {
  t.ground = g;
  if (g !== 'polluted') t.pollution = 0;
  sim.grid.touch(t);
}

// --- the invariants -------------------------------------------------------------------------------------------

const RANK: Record<GroundState, number> = { polluted: 0, prepared: 1, growing: 2, restored: 3 };

/**
 * Watches a sim for any break of the gentle rules: a tile that left dead ground going back to it, a restored tile
 * dropping below restored, a building disappearing, a crop removed or dying, bloombot unable to walk.
 */
export class GentleWatch {
  readonly violations: string[] = [];
  private best = new Map<string, { t: TileData; rank: number }>();
  private machines = new Map<string, string>();
  private planted = new Map<string, Obj>();

  constructor(
    readonly sim: Sim,
    readonly areas: string[] = [PARK, 'mastRow'],
  ) {
    this.snapshot();
  }

  /** Records what stands now (call again after building more). */
  snapshot() {
    for (const m of this.sim.state.machines) this.machines.set(m.id, m.type);
    for (const c of crops(this.sim)) this.planted.set(c.id, c.crop);
    this.check();
  }

  check() {
    const v = this.violations;
    if (v.length > 20) return;
    for (const a of this.areas)
      for (const t of this.sim.areas.tiles(a)) {
        const r = RANK[t.ground];
        const key = `${t.roofId}|${t.x}|${t.z}`;
        const b = this.best.get(key);
        if (!b) {
          this.best.set(key, { t, rank: r });
          continue;
        }
        if (b.rank >= 1 && r === 0) v.push(`${a} ${t.x},${t.z}: back to dead ground at ${this.sim.time.toFixed(1)} s`);
        else if (b.rank === 3 && r < 3) v.push(`${a} ${t.x},${t.z}: restored dropped to ${t.ground} at ${this.sim.time.toFixed(1)} s`);
        if (r > b.rank) b.rank = r;
      }
    const now = new Map(this.sim.state.machines.map((m) => [m.id, m.type] as const));
    for (const [id, type] of this.machines) if (now.get(id) !== type) v.push(`${type} ${id} was lost at ${this.sim.time.toFixed(1)} s`);
    const cs = new Map(crops(this.sim).map((c) => [c.id, c.crop] as const));
    for (const [id] of this.planted) {
      const c = cs.get(id);
      if (!c) v.push(`crop in ${id} was removed at ${this.sim.time.toFixed(1)} s`);
      else if (c.dead === true || c.state === 'dead') v.push(`crop in ${id} died at ${this.sim.time.toFixed(1)} s`);
    }
    if (!canWalk(this.sim)) v.push(`bloombot can't walk at ${this.sim.time.toFixed(1)} s`);
  }

  /** Runs `seconds` of sim time, checking every `every` seconds. */
  run(seconds: number, every = 5) {
    const per = Math.max(1, Math.round(every / TUNING.simStep));
    const n = Math.round(seconds / TUNING.simStep);
    for (let i = 1; i <= n; i++) {
      this.sim.tick();
      if (i % per === 0) this.check();
    }
    this.check();
  }
}

/** A save with a fixed clock (the determinism check compares these byte for byte). */
export function saveText(sim: Sim): string {
  const was = SaveService.clock;
  SaveService.clock = () => 0;
  try {
    return new SaveService(undefined).serialize(sim.state);
  } finally {
    SaveService.clock = was;
  }
}
