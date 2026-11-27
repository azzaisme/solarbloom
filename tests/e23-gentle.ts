import { hedgeReady } from './helpers';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { GroundState, MachineData, TileData } from '../src/core/types';
import { PARK } from '../src/core/Areas';
import { TUNING } from '../src/data/tuning';
import type { PowerSky } from '../src/gameplay/PowerEnv';
import { PowerGrid } from '../src/gameplay/PowerGrid';
import { Sim } from '../src/gameplay/Sim';

/**
 * E23.10.1 (#405): the gentle-failure proof. Epic rule 2, "cozy wins every tie": whatever runs out (power, water,
 * bloombot's charge, a Bio Digester's feed) and whatever the weather does, nothing goes back to dead ground,
 * nothing restored drops below restored, no crop dies, no build is lost, bloombot is never stranded, and
 * everything comes back once the shortage ends.
 *
 * Each system has a probe. A probe SKIPS only while its system is absent from the sim. Once the system is there,
 * the probe binds to its real API; if it can't (a hook it needs is missing), the check FAILS and says what is
 * missing, so nothing ever passes by guessing. Landed systems are bound by their real types (power: `PowerGrid`).
 */

/** A game day is 48 minutes of play (epic rule 5). */
export const GAME_DAY = 48 * 60;

type Obj = Record<string, unknown>;
export const handle = (sim: Sim, name: string): Obj | undefined => (sim as unknown as Record<string, Obj | undefined>)[name] ?? undefined;
const isFn = (o: Obj | undefined, name: string) => !!o && typeof o[name] === 'function';
const call = (o: Obj, name: string, ...a: unknown[]) => (o[name] as (...x: unknown[]) => unknown).apply(o, a);
/** The names in `need` the object lacks (as functions), or '' when it has them all. */
const lacks = (o: Obj, need: string[]) => need.filter((n) => !isFn(o, n)).join(', ');

/** A store bound to its system for one sim: how to empty it, fill it, and see what is off. */
export interface Bound {
  /** Empty it everywhere, the way the game would (night, no rain, no food), without removing anything built. */
  drain(): void;
  /** End the shortage (day, rain, food, a top-up). */
  refill(): void;
  /** What this store feeds that is off right now (proves a drain really bit). */
  dark(): string[];
  /** After a refill and some time: what is still off (must be nothing). */
  unrecovered(): string[];
}

export interface Probe {
  name: 'power' | 'water' | 'charge' | 'digester';
  /** Is the system on this sim at all? (Absent: the check skips.) */
  present(sim: Sim): boolean;
  /** Binds to the real system, adding the pieces it needs to the scene; a string says what is missing (a failure). */
  bind(sim: Sim): Bound | string;
}

// --- power (E23.3, landed: #480) ------------------------------------------------------------------------------

export const DAY: PowerSky = { sun: 1, solar: 1, cloudy: false, wind: 0, dark: 0 };
export const NIGHT: PowerSky = { sun: 0, solar: 0, cloudy: false, wind: 0, dark: 1 };

/**
 * A straight row of free, unblocked tiles `n` long in the park or Mast Row, restored, for the power scene to stand
 * on (set up before any GentleWatch starts, so it never hides a regression).
 */
function freeRow(sim: Sim, n: number): TileData[] {
  const tiles = [...sim.areas.tiles(PARK), ...sim.areas.tiles('mastRow')].filter((t) => !t.occupantId && !t.blocked);
  const at = new Map(tiles.map((t) => [`${t.roofId}|${t.x},${t.z}`, t]));
  for (const t of tiles) {
    const row = Array.from({ length: n }, (_, i) => at.get(`${t.roofId}|${t.x + i},${t.z}`));
    if (row.every(Boolean)) {
      for (const r of row as TileData[]) setGround(sim, r, 'restored');
      return row as TileData[];
    }
  }
  throw new Error(`no free row of ${n} tiles in the park or Mast Row for the power scene`);
}

/**
 * The machine type to use for a grid role: the real type once a sub-epic has registered it (battery, lamp, pump,
 * drone hub, charger), otherwise a test type registered here with the starting values from `src/data/power.ts`.
 */
function gridType(p: PowerGrid, real: string, want: 'battery' | 'consumer', fallback: () => void, test: string): string {
  const role = p.roleOf({ type: real } as MachineData);
  if (role?.[want]) return real;
  fallback();
  return test;
}

/**
 * The power scene: four solar panels and a battery, a Bloom Relay (a pole), and one consumer of each shed class
 * (lamp, pump, helper, charger) reached only through that pole, so lightning on it cuts them off.
 */
export function powerScene(sim: Sim): { p: PowerGrid; pole: MachineData; consumers: MachineData[]; batteries: MachineData[] } {
  const p = sim.power;
  p.skyOverride = () => DAY;
  const battery = gridType(p, 'battery', 'battery', () => p.register('gentle-battery', { battery: { capacity: 4000, rate: 20 } }), 'gentle-battery');
  const lamp = gridType(p, 'lamp', 'consumer', () => p.register('gentle-lamp', { consumer: { shed: 'lamp', dims: true } }), 'gentle-lamp');
  const pump = gridType(p, 'pump', 'consumer', () => p.register('gentle-pump', { consumer: { shed: 'pump' } }), 'gentle-pump');
  const helper = gridType(p, 'droneHub', 'consumer', () => p.register('gentle-helper', { consumer: { shed: 'helper' } }), 'gentle-helper');
  const charger = gridType(p, 'charger', 'consumer', () => p.register('gentle-charger', { consumer: { shed: 'charger' } }), 'gentle-charger');
  const row = freeRow(sim, 15);
  const put = (type: string, i: number): MachineData => {
    const t = row[i];
    const m = { id: sim.newId('m'), type, roofId: t.roofId, x: t.x, z: t.z, size: 1, boostUntil: 0, timer: 0, charge: 0 } as unknown as MachineData;
    sim.state.machines.push(m);
    sim.grid.indexMachine(m);
    t.occupantId = m.id;
    return m;
  };
  for (let i = 0; i < 4; i++) put('solar', i);
  const bat = put(battery, 4);
  const pole = put('relay', 7);
  const consumers = [put(lamp, 11), put(pump, 12), put(helper, 13), put(charger, 14)];
  p.invalidate();
  return { p, pole, consumers, batteries: [bat] };
}

export const POWER: Probe = {
  name: 'power',
  present: (sim) => (sim as unknown as { power?: unknown }).power instanceof PowerGrid,
  bind: (sim) => {
    const { p, consumers, batteries } = powerScene(sim);
    const off = () => consumers.filter((m) => !p.isPowered(m)).map((m) => `${m.type} ${m.id} unpowered`);
    return {
      drain: () => {
        p.skyOverride = () => NIGHT;
        for (const b of batteries) b.charge = 0;
      },
      refill: () => {
        p.skyOverride = () => DAY;
      },
      dark: off,
      unrecovered: off,
    };
  },
};

// --- systems still being built: strict, by the hooks listed here ----------------------------------------------
// When each lands, its probe is rewritten against its real API (like POWER above). Until then a system that is
// present but lacks these hooks FAILS its checks with this message, rather than passing by guessing.

const TEST_HOOKS = ['drainForTest', 'refillForTest'];

function strict(name: Probe['name'], path: string, need: string[], what: (o: Obj, sim: Sim) => { dark: () => string[]; unrecovered: () => string[] }): Probe {
  const find = (sim: Sim) => path.split('.').reduce<Obj | undefined>((o, k) => (o?.[k] as Obj | undefined) ?? undefined, sim as unknown as Obj);
  return {
    name,
    present: (sim) => !!find(sim),
    bind: (sim) => {
      const o = find(sim)!;
      const missing = lacks(o, [...TEST_HOOKS, ...need]);
      if (missing) return `sim.${path} is here but lacks ${missing}: bind the ${name} probe to its real API in tests/e23-gentle.ts`;
      const w = what(o, sim);
      return { drain: () => call(o, 'drainForTest'), refill: () => call(o, 'refillForTest'), ...w };
    },
  };
}

/**
 * E23.4 (#358, landed: E23.4.1 #491): water. Land near empty water goes dry (on E23.4.4, it fades to plain restored
 * ground) and is watered again on refill. The water's piece of the scene: the park's pond restored (a silted bed
 * holds no water until it is). The drain empties every body and holds a dry spell (E23.7.2's weather, sunny: no rain
 * to refill it, as the power drain holds the night); the refill fills them and lets the weather go again.
 */
export const WATER: Probe = {
  name: 'water',
  present: (sim) => !!(sim as unknown as { water?: unknown }).water,
  bind: (sim) => {
    for (const t of sim.areas.tiles(PARK)) if (t.feature === 'water' && !t.blocked) setGround(sim, t, 'restored');
    const w = sim.water;
    const dry = () => sim.areas.tiles(PARK).filter((t) => t.ground === 'restored' && w.isDry(t)).slice(0, 5).map((t) => `tile ${t.x},${t.z} dry`);
    return {
      drain: () => {
        sim.weather.forceForTest('sunny', Infinity);
        w.drainForTest();
      },
      refill: () => {
        sim.weather.forceForTest('sunny', 0); // the weather runs free again
        w.refillForTest();
      },
      dark: dry,
      unrecovered: dry,
    };
  },
};

/** E23.2.1 (#371): bloombot's charge. At zero: a low-power walk, never stranded, nothing lost. */
export const CHARGE = strict('charge', 'charge', ['value', 'canWalk'], (o) => ({
  dark: () => ((call(o, 'value') as number) <= 0 ? ['charge at zero'] : []),
  unrecovered: () => ((call(o, 'value') as number) <= 0 ? ['charge still at zero after a refill'] : []),
}));

/** E23.5.3 (#388): the Bio Digester. An empty one just stops; the grid sheds load gently. */
export const DIGESTER = strict('digester', 'farm.digester', ['isFed'], (o, sim) => {
  const starved = () => sim.state.machines.filter((m) => (m.type as string) === 'bioDigester' && call(o, 'isFed', m) === false).map((m) => `digester ${m.id} unfed`);
  return { dark: starved, unrecovered: starved };
});

export const PROBES: Probe[] = [POWER, WATER, CHARGE, DIGESTER];

/** Binds a probe or throws its missing-hook message (so the test fails, never passes). */
export function bindOrFail(p: Probe, sim: Sim): Bound {
  const b = p.bind(sim);
  if (typeof b === 'string') throw new Error(b);
  return b;
}

// --- weather (E23.7.2) ----------------------------------------------------------------------------------------

export const weatherPresent = (sim: Sim) => !!handle(sim, 'weather');
/** Forces a storm through E23.7's weather; throws (fails) when the weather lacks the hook. */
export function forceStorm(sim: Sim, seconds: number) {
  const w = handle(sim, 'weather')!;
  const missing = lacks(w, ['forceForTest']);
  if (missing) throw new Error(`sim.weather is here but lacks ${missing}: bind the storm check to its real API in tests/e23-gentle.ts`);
  call(w, 'forceForTest', 'storm', seconds);
}

/** E23.2.1: can bloombot still walk? True while charge is absent; fails loudly if charge lacks `canWalk`. */
export function canWalk(sim: Sim): boolean {
  const c = handle(sim, 'charge');
  if (!c) return true;
  if (!isFn(c, 'canWalk')) throw new Error('sim.charge is here but lacks canWalk(): bind it in tests/e23-gentle.ts');
  return call(c, 'canWalk') !== false;
}

/** Planted crops: machines (planter boxes) carrying a `crop` object. Checked by GentleWatch once any exist. */
export function crops(sim: Sim): { id: string; crop: Obj }[] {
  return (sim.state.machines as unknown as Obj[]).filter((m) => m.crop && typeof m.crop === 'object').map((m) => ({ id: String(m.id), crop: m.crop as Obj }));
}

// --- the home scene -------------------------------------------------------------------------------------------

/**
 * A home a few game hours in: the park restored, Mast Row open and part-restored (some tiles prepared and growing),
 * a few machines standing. Each probe's `bind` adds its own system's pieces (the power scene, ponds, planters).
 */
export function homeScene(seed: number): Sim {
  const sim = new Sim(createInitialState(seed));
  const salvage = sim.state.salvage!;
  salvage.tier = 2;
  salvage.abilities.push('prune', 'hover');
  sim.areas.clear(PARK, true);
  hedgeReady(sim); // #hedge-line: its lock wants a third of the park alive too
  sim.gates.open('g-mastRow');
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
