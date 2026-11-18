import { big, toNum } from '../src/core/Big';
import { distToFootprint } from '../src/core/Grid';
import { createInitialState, GROUND } from '../src/core/GameState';
import { KINDS } from '../src/core/Economy';
import type { BuildableType, DroneRole, GameState, ResourceKind, TileData } from '../src/core/types';
import { HOME } from '../src/gameplay/ProgressionSystem';
import { MACHINES } from '../src/data/machines';
import { Sim } from '../src/gameplay/Sim';
import { BOT, type BotPose, spawnPose, Walker } from '../src/gameplay/Walker';

/**
 * Phase 4 E00.3: scripted baseline players. These are deterministic bots, not people: they measure pacing
 * and economy (when things become affordable, how long storage sits full, how far automation gets alone).
 *
 * - `active`: one action every few seconds; builds machines next to each other, aims pulses at synergy tiles,
 *   claims the cat ~40 s after it appears. After the fountain it
 *   pushes the fog back where the objective panel points.
 * - `handsOff`: plays exactly like `active` until its first Drone Hub stands, then never taps the ground
 *   again (no pulses, no Harvest, no cat). It still makes the decisions an idle player checks in for: buying
 *   machines and waking landmarks. Compared with `active` over the same window it says how idle
 *   the game is.
 *
 * The active bot finds every hiding cat about 40 s after it appears.
 */
export interface BotOptions {
  seed: number;
  minutes: number;
  mode?: 'active' | 'handsOff';
  /** seconds between bot actions */
  actionEvery?: number;
  /** start from this state instead of a fresh one */
  state?: GameState;
  /** never claim a Lucky Cat (checks the main path doesn't depend on luck) */
  noCats?: boolean;
  /** called once per simulated second (for extra measurements) */
  onSecond?: (sim: Sim) => void;
  /** Look 6.8: build Cultivators (one as soon as it unlocks and is affordable, another after the fountain) */
  cultivator?: boolean;
  /**
   * E18: give hubs roles by a fixed rule, as soon as each unlocks and the refit is affordable (keeping the next
   * machine's biomass): the first hub stays a Restorer, the second becomes a Gardener, the third a Courier, and
   * every later one (built at the fog's edge after the fountain) a Scout.
   */
  roles?: boolean;
  /**
   * E20.3 (#286): play through bloombot. The decisions are the same, but every ground action (pulse, build, wake,
   * the cat, the fountain) first walks bloombot next to its target along the real path (`Walker.path`, sprinting
   * on trips over 8 cells); the action happens on arrival, and nothing else on the ground happens meanwhile.
   * Menu actions (upgrades, roles, Frenzy, Harvest) stay instant. Merging and superstructures are not walked.
   */
  walk?: boolean;
}

/** E18: the bots' fixed role rule, by hub order (see BotOptions.roles). */
export const BOT_ROLE_PLAN: DroneRole[] = ['restorer', 'gardener', 'courier', 'scout'];

export interface BotReport {
  seed: number;
  mode: 'active' | 'handsOff';
  minutes: number;
  firsts: Record<string, number>;
  /** sim time the bot stopped acting (handsOff), else undefined */
  handsOffAt?: number;
  fountain: number;
  /** sim time the Drone Hub first became affordable (cost within balance and caps) */
  hubAffordable: number;
  /** sim time the biomass cap first reached the Drone Hub's biomass cost */
  hubFitsCap: number;
  upgrades: { t: number; id: string; level: number }[];
  machines: { t: number; type: string }[];
  /** seconds each store spent full */
  capped: Record<ResourceKind, number>;
  /** income lost to full stores */
  overflow: Record<ResourceKind, number>;
  /** gross income actually banked */
  earned: Record<ResourceKind, number>;
  tilesRestored: number;
  parkRestored: number;
  maxCombo: number;
  chains: number;
  /** longest stretch (s) without a "meaningful improvement": upgrade, machine, cat, chain ×5+, milestone */
  longestGap: number;
  stuck: number;
  pulses: number;
  /** cats found by rarity */
  cats: Record<string, number>;
  /** E18: when each role was first chosen (sim seconds), with `roles` on */
  roleAt: Partial<Record<DroneRole, number>>;
  /** E20.3: with `walk`, seconds spent walking, trips made and actions dropped because no path reached them */
  walk?: { seconds: number; trips: number; unreachable: number; failedOnArrival: number };
  /** E20.3: tiles restored by the player's own pulses vs everything else (drones, chains, machines, events) */
  restoredBy: { player: number; helpers: number };
  /** per-minute snapshot */
  minutesLog: { m: number; parkRestored: number; tiles: number; res: Record<ResourceKind, number>; caps: Record<ResourceKind, number>; rates: Record<ResourceKind, number> }[];
}

const ORDER: BuildableType[] = ['solar', 'condenser', 'pollinator', 'droneHub', 'pollinator', 'motherTree', 'solar', 'pollinator', 'droneHub', 'condenser'];

function* botRun(opts: BotOptions): Generator<void, BotReport> {
  return yield* botRunInner(opts);
}

function* botRunInner(opts: BotOptions): Generator<void, BotReport> {
  const mode = opts.mode ?? 'active';
  const actionEvery = opts.actionEvery ?? 3;
  const sim = new Sim(opts.state ?? createInitialState(opts.seed));
  sim.cat.anchorView = () => 'offscreen';
  const s = sim.state;
  const earned: Record<ResourceKind, number> = { energy: 0, water: 0, biomass: 0 };
  const add = sim.econ.add.bind(sim.econ);
  sim.econ.add = (k, a) => {
    const got = add(k, a);
    earned[k] += toNum(got);
    return got;
  };
  const upgrades: BotReport['upgrades'] = [];
  const machines: BotReport['machines'] = [];
  let lastMeaningful = 0;
  let longestGap = 0;
  const meaningful = () => {
    longestGap = Math.max(longestGap, sim.time - lastMeaningful);
    lastMeaningful = sim.time;
  };
  sim.bus.on('upgrade.granted', ({ id, level }) => {
    upgrades.push({ t: Math.round(sim.time), id, level });
    meaningful();
  });
  sim.bus.on('machine.built', ({ machine }) => {
    machines.push({ t: Math.round(sim.time), type: machine.type });
    meaningful();
  });
  sim.bus.on('cat.found', meaningful);
  sim.bus.on('milestone.reached', meaningful);
  sim.bus.on('area.step', meaningful);
  sim.bus.on('rooftop.coreRestored', meaningful);
  sim.bus.on('area.cleared', meaningful);
  sim.bus.on('chain.ended', ({ combo }) => combo >= 5 && meaningful());
  let pulses = 0;
  sim.bus.on('pulse.fired', () => pulses++);
  const cats: Record<string, number> = {};
  sim.bus.on('cat.found', ({ variant }) => (cats[variant ?? 'standard'] = (cats[variant ?? 'standard'] ?? 0) + 1));
  const restoredBy = { player: 0, helpers: 0 };
  sim.bus.on('tile.restored', ({ source }) => (source === 'pulse' || source === 'broad' ? restoredBy.player++ : restoredBy.helpers++));
  const walk = opts.walk ? walking(sim) : undefined;

  const built: Record<string, number> = {};
  const roleAt: BotReport['roleAt'] = {};
  const hubFor = new Set<string>();
  let next = 0;
  let handsOffAt: number | undefined;
  let hubAffordable = -1;
  let hubFitsCap = -1;
  const capped: Record<ResourceKind, number> = { energy: 0, water: 0, biomass: 0 };
  const minutesLog: BotReport['minutesLog'] = [];
  const park = () => sim.progression.tilesFor(HOME);
  const synergy = (t: TileData) =>
    s.machines.reduce((a, m) => {
      const d = distToFootprint(t.x, t.z, m.x, m.z, m.size);
      if (m.type === 'pollinator' && d === 1) return a + 3;
      if (m.type === 'motherTree' && d >= 1 && d <= sim.upgrades.treeRadius(m)) return a + 2;
      if (m.type === 'solar' && d === 1) return a + 1;
      return a;
    }, 0);

  const act = (taps = true) => {
    // 1. build the next machine if affordable, next to existing ones
    const want = ORDER[next];
    if (want) {
      const have = s.machines.filter((m) => m.type === want && !m.starter).length;
      if (have > (built[want] ?? 0)) {
        built[want] = have;
        next++;
      } else if (sim.build.isUnlocked(want) && sim.econ.canAfford(sim.build.cost(want))) {
        const spots = park()
          .filter((t) => sim.build.check(want, GROUND, t.x, t.z).ok)
          .sort((a, b) => synergy(b) - synergy(a) || a.x + a.z - (b.x + b.z));
        if (spots[0] && sim.build.place(want, GROUND, spots[0].x, spots[0].z)) {
          built[want] = (built[want] ?? 0) + 1;
          next++;
        }
      }
    }
    // 1a. Look 6.8: a Cultivator where the most dead ground is within its reach
    if (opts.cultivator && sim.build.isUnlocked('cultivator')) {
      const have = s.machines.filter((m) => m.type === 'cultivator').length;
      if (have < (s.progression.coreActivated ? 2 : 1) && sim.econ.canAfford(sim.build.cost('cultivator'))) {
        const pool = s.progression.coreActivated ? [...new Set(sim.areas.revealed().flatMap((a) => sim.areas.tiles(a)))] : park();
        const dead = (t: TileData) => sim.grid.tilesWithin(GROUND, t.x, t.z, 5).filter((n) => n.ground === 'polluted' || n.ground === 'prepared').length;
        const spot = pool.filter((t) => sim.build.check('cultivator', GROUND, t.x, t.z).ok).map((t) => ({ t, n: dead(t) })).sort((a, b) => b.n - a.n)[0];
        if (spot && spot.n > 6) sim.build.place('cultivator', GROUND, spot.t.x, spot.t.z);
      }
    }
    // 1b. after the fountain: wake any landmark that's ready, and put a Drone Hub at the edge of the next goal
    if (s.progression.coreActivated) {
      for (const id of sim.areas.revealed()) if (sim.areas.fog(id) !== 'cleared' && sim.areas.ready(id)) sim.areas.clear(id);
      const goal = sim.areas.nextGoal();
      if (goal && !ORDER[next] && !hubFor.has(goal) && sim.econ.canAfford(sim.build.cost('droneHub'))) {
        const entry = sim.areas.entryTiles(goal).slice(0, 12);
        const near = new Map<string, TileData>();
        for (const e of entry) for (const t of sim.grid.tilesNear({ ...e, size: 1 }, 3)) near.set(t.id, t);
        const spot = [...near.values()].filter((t) => t.ground === 'restored' && sim.build.check('droneHub', GROUND, t.x, t.z).ok).sort((a, b) => a.z - b.z || a.x - b.x)[0];
        if (spot && (sim.build.place('droneHub', GROUND, spot.x, spot.z) || walk?.queued('droneHub'))) hubFor.add(goal);
      }
    }
    // 2. pulse the most promising tile (the park first; after the fountain, where the advisor points)
    let target: TileData | undefined;
    const cands = park().filter((t) => sim.restoration.checkPulse(t).ok);
    const rank = (t: TileData) => (t.ground === 'restored' ? 30 : 0) - synergy(t) * 4 + (t.ground === 'prepared' ? 0 : 3);
    cands.sort((a, b) => rank(a) - rank(b) || a.pollution - b.pollution);
    target = cands[0];
    if (s.progression.coreActivated && (!target || target.ground === 'restored')) {
      const sug = sim.advisor.suggest();
      if (sug.action.kind === 'focus' && !sug.action.layer) {
        const t = sim.grid.get(GROUND, sug.action.x, sug.action.z);
        if (t && sim.restoration.checkPulse(t).ok) target = t;
      } else if (sug.action.kind === 'wake') {
        const m = sim.machine(sug.action.machineId);
        const id = m && sim.areas.areaOf(m);
        if (id) sim.areas.clear(id);
      }
      if (!target || target.ground === 'restored') {
        // Otherwise the cheapest restorable tile at the edge of the next goal area.
        const goal = sim.areas.nextGoal();
        const edge = goal ? sim.areas.entryTiles(goal).find((t) => sim.restoration.checkPulse(t).ok) : undefined;
        if (edge) target = edge;
      }
    }
    if (taps) {
      if (target) sim.restoration.pulse(target.id);
      else if (s.resources.energy.lt(3)) sim.harvestSun();
    }
    const nextCost = (ORDER[next] ? big(sim.build.cost(ORDER[next]).biomass ?? 0) : big(0));
    if (sim.progression.coreReady()) sim.progression.activateCore();
    // 3a. E18: roles by the fixed rule (a refit is a purchase, like an upgrade: idle players make it too).
    if (opts.roles) {
      const hubs = s.machines.filter((m) => m.type === 'droneHub').sort((a, b) => (Number(a.id.slice(1)) || 0) - (Number(b.id.slice(1)) || 0));
      hubs.forEach((h, i) => {
        const want = BOT_ROLE_PLAN[Math.min(i, BOT_ROLE_PLAN.length - 1)];
        if (sim.roles.roleOf(h) === want) return;
        const st = sim.roles.check(h.id, want);
        if (!st.ok || s.resources.biomass.sub(big(st.price.biomass ?? 0)).lt(nextCost)) return;
        if (sim.roles.choose(h.id, want)) roleAt[want] ??= Math.round(sim.time);
      });
    }
    // 4. find the cat ~40 s after it appears
    // Phase 5 E15: every hiding cat (invasion cats too), each about 40 s after it appeared.
    if (taps && !opts.noCats) for (const c of sim.cat.spots()) if (sim.time - c.spawnedAt > 40) sim.cat.claim(c.id);
  };

  const stepsPerAction = Math.round(actionEvery / 0.1);
  const steps = Math.round((opts.minutes * 60) / 0.1);
  for (let i = 0; i < steps; i++) {
    if (handsOffAt === undefined && mode === 'handsOff' && s.machines.some((m) => m.type === 'droneHub')) handsOffAt = Math.round(sim.time);
    if (i % stepsPerAction === 0) {
      walk?.arrive();
      act(handsOffAt === undefined);
    }
    sim.tick();
    if (i % 3000 === 2999) yield; // lets runBotAsync hand the thread back now and then
    if (i % 10 === 0) {
      const hub = sim.build.cost('droneHub');
      if (hubFitsCap < 0 && !sim.econ.exceedsStorage(hub)) hubFitsCap = Math.round(sim.time);
      if (hubAffordable < 0 && sim.econ.canAfford(hub)) hubAffordable = Math.round(sim.time);
      for (const k of KINDS) if (sim.econ.isFull(k)) capped[k] += 1;
      opts.onSecond?.(sim);
    }
    if (i % 600 === 599) {
      const r = sim.production.rates();
      minutesLog.push({
        m: Math.round(sim.time / 60),
        parkRestored: sim.progression.restoredCount(HOME),
        tiles: s.stats.tilesRestored,
        res: { energy: Math.round(toNum(s.resources.energy)), water: Math.round(toNum(s.resources.water)), biomass: Math.round(toNum(s.resources.biomass)) },
        caps: { energy: toNum(s.caps.energy), water: toNum(s.caps.water), biomass: Infinity },
        rates: { energy: Math.round(toNum(r.energy) * 60), water: Math.round(toNum(r.water) * 60), biomass: Math.round(toNum(r.biomass) * 60) },
      });
    }
  }
  longestGap = Math.max(longestGap, sim.time - lastMeaningful);
  return {
    seed: opts.seed,
    mode,
    minutes: opts.minutes,
    firsts: { ...s.stats.firsts },
    handsOffAt,
    fountain: s.progression.coreActivated ? Math.round(s.progression.coreActivatedAt) : -1,
    hubAffordable,
    hubFitsCap,
    upgrades,
    machines,
    capped,
    overflow: { ...sim.log.overflow },
    earned,
    tilesRestored: s.stats.tilesRestored,
    parkRestored: sim.progression.restoredCount(HOME),
    maxCombo: s.stats.maxCombo,
    chains: s.stats.chains,
    longestGap: Math.round(longestGap),
    stuck: Math.round(s.stats.stuckSeconds),
    pulses,
    cats,
    roleAt,
    walk: walk?.report(),
    restoredBy,
    minutesLog,
  };
}

export function runBot(opts: BotOptions): BotReport {
  const it = botRun(opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** The same run, yielding every 300 simulated seconds: long runs otherwise starve the Vitest worker's RPC. */
export async function runBotAsync(opts: BotOptions): Promise<BotReport> {
  const it = botRun(opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    await new Promise((res) => setTimeout(res, 0));
  }
}

export const mmss = (t?: number) => (t === undefined || t < 0 ? '—' : `${Math.floor(t / 60)}:${String(Math.round(t) % 60).padStart(2, '0')}`);

/**
 * E20.3 (#286): makes a bot walk. Wraps the Sim's ground actions so each one is queued until bloombot has walked
 * next to its target; while it walks, other ground actions are refused (return falsy), as a player can only be in
 * one place. A queued action reports success at once so the bot's bookkeeping moves on, and runs on arrival
 * (`failedOnArrival` counts the ones that no longer could).
 */
function walking(sim: Sim) {
  const walker = new Walker(sim);
  const pose: BotPose = spawnPose(sim, walker);
  sim.state.bot = { ...pose }; // #287: drones see where bloombot is, as in the game
  let busyUntil = 0;
  let pending: (() => unknown) | undefined;
  let pendingBuild: string | undefined;
  const r = { seconds: 0, trips: 0, unreachable: 0, failedOnArrival: 0 };
  /** Walk next to the cells [x0, x0+w) × [z0, z0+d) on `roofId`. False when busy or unreachable. */
  const go = (roofId: string, x0: number, z0: number, w: number, d: number, run: () => unknown): boolean => {
    if (sim.time < busyUntil || pending) return false;
    const near = (x: number, z: number) => x >= x0 - 1 && x <= x0 + w && z >= z0 - 1 && z <= z0 + d && !(x >= x0 && x < x0 + w && z >= z0 && z < z0 + d);
    let secs: number;
    if (roofId !== pose.roofId) {
      secs = 40; // a lift or a trip across: a flat cost, bloombot stays where it was
    } else {
      const path = walker.path(roofId, pose.x, pose.z, near, { x: x0 + w / 2, z: z0 + d / 2 });
      if (!path) {
        r.unreachable++;
        return false;
      }
      let len = 0;
      let px = pose.x;
      let pz = pose.z;
      for (const c of path) {
        len += Math.hypot(c.x - px, c.z - pz);
        px = c.x;
        pz = c.z;
      }
      secs = len / (path.length > 8 ? BOT.sprint : BOT.walk);
      pose.x = px;
      pose.z = pz;
      sim.state.bot = { ...pose };
    }
    if (secs < 0.05) return !!run();
    r.seconds += secs;
    r.trips++;
    busyUntil = sim.time + secs;
    pending = run;
    return true;
  };
  const tile = (id: string) => sim.grid.byTileId(id);
  const build = sim.build.place.bind(sim.build);
  sim.build.place = ((type, roofId, x, z) => {
    const size = MACHINES[type].size;
    // A build counts only once it stands (falsy now): the bot's own bookkeeping sees it on a later action.
    let made: ReturnType<typeof build>;
    if (go(roofId, x, z, size, size, () => (made = build(type, roofId, x, z))) && !made) pendingBuild = type;
    return made;
  }) as typeof sim.build.place;
  const pulse = sim.restoration.pulse.bind(sim.restoration);
  sim.restoration.pulse = (id) => {
    const t = tile(id);
    return !!t && go(t.roofId, t.x, t.z, 1, 1, () => pulse(id));
  };
  const claim = sim.cat.claim.bind(sim.cat);
  sim.cat.claim = ((catId?: string) => {
    const spot = catId ? sim.cat.find(catId) : sim.state.cat.active;
    const a = spot && sim.cat.anchor(spot.anchorId);
    if (!a) return undefined;
    return (go(a.roofId, Math.floor(a.pos[0]), Math.floor(a.pos[2]), 1, 1, () => claim(catId)) || undefined) as never;
  }) as typeof sim.cat.claim;
  const clear = sim.areas.clear.bind(sim.areas);
  sim.areas.clear = (id, force) => {
    const m = sim.areas.landmark(id);
    if (!m) return clear(id, force);
    return go(m.roofId, m.x, m.z, m.size, m.size, () => clear(id, force));
  };
  const wake = sim.progression.activateCore.bind(sim.progression);
  sim.progression.activateCore = () => {
    const f = sim.state.machines.find((m) => m.type === 'core' && m.roofId === GROUND);
    if (!f) return wake();
    return go(f.roofId, f.x, f.z, f.size, f.size, wake);
  };
  return {
    pose,
    /** Called before each action: an arrived trip does its action now. */
    arrive() {
      if (!pending || sim.time < busyUntil) return;
      const run = pending;
      pending = undefined;
      pendingBuild = undefined;
      if (!run()) r.failedOnArrival++;
    },
    /** A trip to build this type is under way (so the bot doesn't send a second one). */
    queued: (type: string) => pendingBuild === type,
    report: () => ({ ...r, seconds: Math.round(r.seconds) }),
  };
}
