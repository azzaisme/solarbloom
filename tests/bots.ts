import { big, toNum } from '../src/core/Big';
import { distToFootprint } from '../src/core/Grid';
import { createInitialState, GROUND } from '../src/core/GameState';
import { KINDS } from '../src/core/Economy';
import type { BuildableType, GameState, ResourceKind, TileData } from '../src/core/types';
import { HOME } from '../src/gameplay/ProgressionSystem';
import { Sim } from '../src/gameplay/Sim';

/**
 * Phase 4 E00.3: scripted baseline players. These are deterministic bots, not people: they measure pacing
 * and economy (when things become affordable, how long storage sits full, how far automation gets alone).
 *
 * - `active`: one action every few seconds; builds machines next to each other, aims pulses at synergy tiles,
 *   buys upgrades when nothing better is pending, claims the cat ~40 s after it appears. After the fountain it
 *   pushes the fog back where the objective panel points.
 * - `handsOff`: plays exactly like `active` until its first Drone Hub stands, then never taps the ground
 *   again (no pulses, no Harvest, no cat). It still makes the decisions an idle player checks in for: buying
 *   machines and upgrades, and waking landmarks. Compared with `active` over the same window it says how idle
 *   the game is.
 */
export interface BotOptions {
  seed: number;
  minutes: number;
  mode?: 'active' | 'handsOff';
  /** seconds between bot actions */
  actionEvery?: number;
  /** start from this state instead of a fresh one */
  state?: GameState;
  /** never buy upgrades (checks the main path doesn't depend on them) */
  noUpgrades?: boolean;
  /** buy any affordable upgrade at once instead of saving for the next machine */
  eager?: boolean;
  /** never claim a Lucky Cat (checks the main path doesn't depend on luck) */
  noCats?: boolean;
  /** called once per simulated second (for extra measurements) */
  onSecond?: (sim: Sim) => void;
  /**
   * Phase 5 E13: after the build list, keep buying panels, gardens and condensers beside matching ones and merge
   * every ready group (off by default so earlier pacing measurements stay comparable).
   */
  merges?: boolean | 'buildOnly';
}

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
  /** longest stretch (s) without a "meaningful improvement": upgrade, machine, cat, chain ×5+, milestone or Frenzy */
  longestGap: number;
  stuck: number;
  pulses: number;
  /** Bloom Frenzies fired */
  frenzies: number;
  /** Phase 5 E13: merges made, and when */
  merges: { t: number; type: string }[];
  /** per-minute snapshot */
  minutesLog: { m: number; parkRestored: number; tiles: number; res: Record<ResourceKind, number>; caps: Record<ResourceKind, number>; rates: Record<ResourceKind, number> }[];
}

const ORDER: BuildableType[] = ['solar', 'condenser', 'pollinator', 'droneHub', 'pollinator', 'motherTree', 'solar', 'pollinator', 'droneHub', 'condenser'];

export function runBot(opts: BotOptions): BotReport {
  const mode = opts.mode ?? 'active';
  const actionEvery = opts.actionEvery ?? 3;
  const sim = new Sim(opts.state ?? createInitialState(opts.seed));
  sim.cat.anchorView = () => 'visible';
  const s = sim.state;
  const earned: Record<ResourceKind, number> = { energy: 0, water: 0, biomass: 0 };
  const add = sim.econ.add.bind(sim.econ);
  sim.econ.add = (k, a, o) => {
    const got = add(k, a, o);
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
  sim.bus.on('upgrade.purchased', ({ id, level }) => {
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
  sim.bus.on('frenzy.started', meaningful);
  sim.bus.on('rooftop.coreRestored', meaningful);
  sim.bus.on('area.cleared', meaningful);
  sim.bus.on('chain.ended', ({ combo }) => combo >= 5 && meaningful());
  let pulses = 0;
  sim.bus.on('pulse.fired', () => pulses++);

  const built: Record<string, number> = {};
  const merges: BotReport['merges'] = [];
  sim.bus.on('machine.merged', meaningful);
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
    // 1b. after the fountain: wake any landmark that's ready, and put a Drone Hub at the edge of the next goal
    if (s.progression.coreActivated) {
      for (const id of sim.areas.revealed()) if (sim.areas.fog(id) !== 'cleared' && sim.areas.ready(id)) sim.areas.clear(id);
      const goal = sim.areas.nextGoal();
      if (goal && !ORDER[next] && !hubFor.has(goal) && sim.econ.canAfford(sim.build.cost('droneHub'))) {
        const entry = sim.areas.entryTiles(goal).slice(0, 12);
        const near = new Map<string, TileData>();
        for (const e of entry) for (const t of sim.grid.tilesNear({ ...e, size: 1 }, 3)) near.set(t.id, t);
        const spot = [...near.values()].filter((t) => t.ground === 'restored' && sim.build.check('droneHub', GROUND, t.x, t.z).ok).sort((a, b) => a.z - b.z || a.x - b.x)[0];
        if (spot && sim.build.place('droneHub', GROUND, spot.x, spot.z)) hubFor.add(goal);
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
    // 3. upgrades when the next machine is far off
    // Phase 5 E12: biomass is uncapped, so keep back only the next machine's price. Per-machine upgrades go to
    // the cheapest machine of the type (as "Upgrade all" would), a few levels per action.
    const nextCost = ORDER[next] ? big(sim.build.cost(ORDER[next]).biomass ?? 0) : big(0);
    for (const u of opts.noUpgrades ? [] : sim.upgrades.all()) {
      for (let i = 0; i < 4; i++) {
        const st = sim.upgrades.status(u);
        if (!(st.ok && (opts.eager || s.resources.biomass.sub(st.cost).gte(nextCost)))) break;
        if (!sim.upgrades.purchase(u.id)) break;
      }
    }
    if (sim.progression.coreReady()) sim.progression.activateCore();
    // 3b. Phase 5 E13: grow groups of matching machines and merge them.
    if (opts.merges && !ORDER[next]) {
      for (const type of ['solar', 'pollinator', 'condenser'] as const) {
        const cost = sim.build.cost(type);
        if (!sim.econ.canAfford(cost) || s.resources.biomass.lt(big(cost.biomass ?? 0).mul(2))) continue;
        let best: TileData | undefined;
        let bestN = 1;
        for (const t of park()) {
          if (t.ground !== 'restored' || !sim.build.check(type, GROUND, t.x, t.z).ok) continue;
          const n = sim.merge.groupIfPlaced(type, GROUND, t.x, t.z, 1);
          if (n > bestN) {
            best = t;
            bestN = n;
          }
        }
        // No group to join yet: start one beside the fewest other machines.
        best ??= park().find((t) => t.ground === 'restored' && sim.build.check(type, GROUND, t.x, t.z).ok);
        if (best && sim.build.place(type, GROUND, best.x, best.z)) break;
      }
      for (const c of opts.merges === 'buildOnly' ? [] : sim.merge.ready(4)) {
        const p = sim.merge.plan(c[0].id);
        if (p?.ok && sim.merge.commit(c[0].id, p.partners.map((m) => m.id), p.key, p.fee)) merges.push({ t: Math.round(sim.time), type: c[0].type });
      }
    }
    // 4. find the cat ~40 s after it appears
    const c = s.cat.active;
    if (taps && !opts.noCats && c && sim.time - c.spawnedAt > 40) sim.cat.claim();
    // 5. fire Bloom Frenzy as soon as it's ready (an idle player checking in would too)
    if (sim.frenzy.ready()) sim.frenzy.activate();
  };

  const stepsPerAction = Math.round(actionEvery / 0.1);
  const steps = Math.round((opts.minutes * 60) / 0.1);
  for (let i = 0; i < steps; i++) {
    if (handsOffAt === undefined && mode === 'handsOff' && s.machines.some((m) => m.type === 'droneHub')) handsOffAt = Math.round(sim.time);
    if (i % stepsPerAction === 0) act(handsOffAt === undefined);
    sim.tick();
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
    frenzies: s.frenzy?.count ?? 0,
    merges,
    minutesLog,
  };
}

export const mmss = (t?: number) => (t === undefined || t < 0 ? '—' : `${Math.floor(t / 60)}:${String(Math.round(t) % 60).padStart(2, '0')}`);
