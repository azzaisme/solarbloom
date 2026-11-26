import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { TileData } from '../src/core/types';
import { PARK_SET, REGIONS } from '../src/data/oldcity';
import { CHARGE as CHARGE_DATA } from '../src/data/charge';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { BOT, spawnPose, Walker, type BotPose } from '../src/gameplay/Walker';
import { SALVAGE } from '../src/data/salvage';
import { oldCityHint } from '../src/ui/OldCityGuide';
import { canWalk, CHARGE, handle } from './e23-gentle';

/**
 * E21.12 / E21.23: the Old City's walking bot. It plays a new old-city game the way a player would, on foot:
 * walks (real paths, sprinting on long ones) to the nearest pile and salvages it, pulses dead park ground, brings
 * Scrap and Seeds to the fountain, eats or rests when charge runs low, pries a barricade and wakes the Keeper
 * behind it. In the full opening run it builds a Solar Panel and Charger from park Scrap before the fountain wakes.
 * Time passes for walking, for each action and for waiting; the report
 * gives the sim time of each milestone, the tutorial hints in the order they showed, and the longest stretch
 * with nothing reachable to do.
 */
export interface OldCityBotReport {
  seed: number;
  /** sim seconds of each first: salvage, pulse, seeds, tier1, gate, keeper, solar, charger */
  firsts: Record<string, number>;
  hints: string[];
  steps: number[];
  /** the longest wait with nothing to do (seconds) */
  longestIdle: number;
  /** E23.2.1: times bloombot ran out of charge with nothing to eat and walked home to rest */
  restedAtHome: number;
  walked: number;
  time: number;
  /**
   * E23.3 (#480): the grid, once on the sim: the Solar Panel bloombot built is on a network, and that network's
   * supply in daylight (watts). Undefined without a grid or before the panel is built.
   */
  grid?: { onNetwork: boolean; supply: number };
  /**
   * E23.10.1 (#405): bloombot's charge, once E23.2.1 lands (undefined until then): the lowest it fell, seconds
   * spent at zero, and seconds stranded (at zero and unable to walk: must stay 0).
   */
  charge?: { min: number; atZero: number; stranded: number };
  /** the game as the bot left it */
  sim: Sim;
}

export interface OldCityBotOptions {
  /** called once on the new game before the bot plays (e.g. to switch a sim mode on) */
  setup?: (sim: Sim) => void;
  /** called once per simulated second, after that second's ticks (measurements, or what the HUD does each second) */
  onSecond?: (sim: Sim) => void;
}

const ACT = { salvage: SALVAGE.holdSeconds + 0.5, pulse: 0.7, interact: 0.6, build: 1.2, pry: SALVAGE.pryHoldSeconds + 0.4, think: 0.4 };

/**
 * `until`: stop at fountain tier 1, at the first Keeper awake, or (the default) run the opening with early power.
 */
export function runOldCityBot(seed: number, maxMinutes = 20, until: 'tier1' | 'keeper' | 'intro' = 'intro', opts: OldCityBotOptions = {}): OldCityBotReport {
  const sim = new Sim(createInitialState(seed));
  opts.setup?.(sim);
  const w = new Walker(sim);
  const pose: BotPose = spawnPose(sim, w);
  const firsts: Record<string, number> = {};
  const hints: string[] = [];
  const steps: number[] = [];
  let walked = 0;
  let lastSecond = 0;
  let idle = 0;
  let longestIdle = 0;
  /** E23.2.1: times bloombot ran out of charge and walked home to rest */
  let restedAtHome = 0;
  const first = (k: string) => (firsts[k] ??= sim.time);
  sim.bus.on('pile.salvaged', (e) => (first('salvage'), e.material === 'seeds' && first('seeds')));
  sim.bus.on('pulse.fired', () => first('pulse'));
  sim.bus.on('fountain.tier', (e) => e.tier === 1 && first('tier1'));
  sim.bus.on('gate.opened', () => first('gate'));
  sim.bus.on('keeper.step', (e) => e.step === 'request1' && first('keeper'));
  // E23.2.1's charge, once it is on the sim: read through its real `value()` (fails loudly if it lacks it)
  const chargeSys = CHARGE.present(sim) ? handle(sim, 'charge')! : undefined;
  if (chargeSys && typeof chargeSys.value !== 'function') throw new Error('sim.charge is here but lacks value(): update tests/oldcity-bot.ts');
  const charge = chargeSys ? { min: Infinity, atZero: 0, stranded: 0 } : undefined;
  const chargeNow = () => (chargeSys!.value as () => number).call(chargeSys);
  const pass = (secs: number) => {
    const n = Math.round(secs / TUNING.simStep);
    for (let i = 0; i < n; i++) {
      sim.tick();
      record();
      if (opts.onSecond && Math.floor(sim.time) > lastSecond) {
        lastSecond = Math.floor(sim.time);
        opts.onSecond(sim);
      }
      if (charge) {
        const c = chargeNow() ?? 0;
        charge.min = Math.min(charge.min, c);
        if (c <= 0) {
          charge.atZero += TUNING.simStep;
          if (!canWalk(sim)) charge.stranded += TUNING.simStep;
        }
      }
    }
  };
  const record = () => {
    sim.bot = { roofId: GROUND, x: pose.x, z: pose.z };
    const step = sim.state.progression.tutorialStep;
    if (steps[steps.length - 1] !== step) {
      steps.push(step);
      hints.push(oldCityHint(sim, step, () => 'Interact').text);
    }
  };
  /** Walks to stand beside a footprint (or on a cell). False when there is no way. */
  const walkTo = (x: number, z: number, size = 1, onto = false): boolean => {
    const inside = (cx: number, cz: number) => cx >= x && cx < x + size && cz >= z && cz < z + size;
    const path = w.path(GROUND, pose.x, pose.z, (cx, cz) => (onto ? inside(cx, cz) : !inside(cx, cz) && cx >= x - 1 && cx <= x + size && cz >= z - 1 && cz <= z + size && (cx === x - 1 || cx === x + size || cz === z - 1 || cz === z + size)), { x, z });
    if (!path) return false;
    let len = 0;
    let px = pose.x;
    let pz = pose.z;
    for (const p of path) {
      len += Math.hypot(p.x - px, p.z - pz);
      px = p.x;
      pz = p.z;
    }
    // E23.2.1: a long walk is sprinted while there is charge for it; at zero, the low-power walk
    const sprint = len > 8 && sim.charge.use('sprint', len / BOT.sprint);
    const secs = len / (sprint ? BOT.sprint : BOT.walk * (sim.charge.empty ? CHARGE_DATA.lowPowerWalk : 1));
    walked += secs;
    pass(secs);
    pose.x = px;
    pose.z = pz;
    sim.bot = { roofId: GROUND, x: pose.x, z: pose.z };
    return true;
  };
  const dist = (x: number, z: number) => Math.hypot(x + 0.5 - pose.x, z + 0.5 - pose.z);
  const fountain = sim.areas.landmark(PARK)!;
  const allPiles = [...PARK_SET.piles, ...REGIONS.flatMap((r) => r.piles)];
  const end = maxMinutes * 60;
  record();
  while (sim.time < end) {
    if (until === 'tier1' && firsts.tier1 !== undefined) break;
    if (until === 'keeper' && firsts.keeper !== undefined) break;
    if (until === 'intro' && firsts.keeper !== undefined) break;
    let did = false;
    const tier = sim.fountain.tier;
    // 0. E23.2.1: running low: eat something carried; out of charge with nothing to eat: walk home and rest there
    //    (stand still by the fountain until the charge has come back far enough to be worth going out again)
    if (sim.charge.low) {
      const meal = sim.charge.eat();
      if (typeof meal === 'object') {
        pass(meal.seconds);
        continue;
      }
      if (sim.charge.empty) {
        walkTo(fountain.x, fountain.z, 2);
        restedAtHome++;
        while (sim.charge.share < 0.6) pass(1);
        continue;
      }
    }
    if (until === 'intro' && tier === 0 && firsts.charger === undefined && sim.state.stats.tilesRestored >= 4) {
      if (buildEarlyPower()) {
        pass(ACT.think);
        continue;
      }
    }
    // 1. Hand in what the fountain wants (once carrying enough to be worth the trip)
    const wantScrap = sim.fountain.remaining('scrap');
    const wantSeeds = sim.fountain.remaining('seeds');
    const canGive = Math.min(wantScrap, sim.inventory.count('scrap')) + Math.min(wantSeeds, sim.inventory.count('seeds'));
    if (tier === 0 && canGive > 0 && (canGive >= wantScrap + wantSeeds || canGive >= 10)) {
      if (walkTo(fountain.x, fountain.z, 2)) {
        pass(ACT.interact);
        sim.fountain.giveAll();
        did = true;
      }
    }
    // 2. After tier 1: the nearest barricade, then its Keeper
    if (!did && tier >= 1) {
      if (firsts.gate === undefined) {
        const gates = REGIONS.filter((r) => r.ring === 1 && r.gate.kind === 'barricade' && r.gate.opensRegion !== false).sort((a, b) => dist(a.gate.cells[0][0], a.gate.cells[0][1]) - dist(b.gate.cells[0][0], b.gate.cells[0][1]));
        for (const r of gates) if ((did = pry(r))) break;
      } else if (firsts.keeper === undefined) {
        did = wake(REGIONS.find((q) => sim.gates.isOpen(q.gate.id) && q.gate.opensRegion !== false)!);
      }
    }
    // 3. Salvage the nearest pile that still has something and fits in the pack
    if (!did) {
      const pile = allPiles
        .filter((p) => sim.salvage.left(p.id) > 0 && !sim.salvage.problem(p.id) && (tier >= 1 || sim.fountain.remaining(p.material) > sim.inventory.count(p.material)))
        .sort((a, b) => dist(a.x, a.z) - dist(b.x, b.z))[0];
      // pulse first when the park still needs tiles and a pulse is affordable right here; salvage otherwise
      if (pile && (tier >= 1 || sim.areas.counts(PARK).restored >= 60 || !affordableNear())) {
        if (walkTo(pile.x, pile.z)) {
          while (sim.salvage.left(pile.id) > 0 && !sim.salvage.problem(pile.id)) {
            pass(ACT.salvage);
            sim.salvage.salvage(pile.id);
          }
          did = true;
        }
      }
    }
    // 4. Pulse dead park ground until 60 tiles are restored
    if (!did && tier === 0 && sim.areas.counts(PARK).restored < 60) {
      const t = nearestPulse();
      if (t && walkTo(t.x, t.z)) {
        pass(ACT.pulse);
        if (sim.restoration.pulse(t.id)) did = true;
      }
    }
    if (!did) {
      // nothing to do right now: out of charge, eat something carried (E23.1.4: charge is all a pulse costs), else wait
      const ate = sim.charge.empty ? sim.charge.eat() : 'none';
      if (ate !== 'none' && ate !== 'full' && ate !== 'busy') {
        pass(ACT.think);
      } else {
        pass(1);
        idle += 1;
        longestIdle = Math.max(longestIdle, idle);
        continue;
      }
    }
    idle = 0;
    pass(ACT.think);
  }
  record();
  const solar = sim.state.machines.find((m) => m.type === 'solar' && !m.starter);
  const grid = sim.power ? { onNetwork: !!solar && !!sim.power.networkOf(solar), supply: (solar && sim.power.networkOf(solar)?.supply) || 0 } : undefined;
  return { seed, firsts, hints, steps, longestIdle, walked, time: sim.time, charge, grid, restedAtHome, sim };

  /** Walks to a region's barricade and pries it open. */
  function pry(r: (typeof REGIONS)[number]): boolean {
    const [gx, gz] = r.gate.cells[0];
    if (!walkTo(gx, gz)) return false;
    pass(ACT.pry);
    return sim.gates.open(r.gate.id);
  }
  /** Walks to a region's Keeper, pulses it awake and hands it a gift (false: nothing to give yet, salvage on). */
  function wake(r: (typeof REGIONS)[number]): boolean {
    const k = sim.keepers.def(r.keeper);
    if (!walkTo(k.x, k.z)) return false;
    pass(ACT.pulse);
    sim.keepers.pulse(k.id);
    if (!sim.keepers.giftMaterial()) return false;
    pass(ACT.interact);
    sim.keepers.interact(k.id);
    return true;
  }
  function buildEarlyPower(): boolean {
    const solar = sim.machinesOfType('solar').find((m) => !m.starter);
    const type = solar ? 'charger' : 'solar';
    const neighbors = (x: number, z: number) => [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]];
    const spots = solar ? neighbors(solar.x, solar.z).map(([x, z]) => sim.grid.get(GROUND, x, z))
      : sim.areas.tiles(PARK).filter(({ x, z }) => neighbors(x, z).some(([nx, nz]) => sim.build.check('charger', GROUND, nx, nz).ok));
    const spot = spots.filter((t): t is TileData => !!t && sim.build.check(type, GROUND, t.x, t.z).ok)
      .sort((a, b) => dist(a.x, a.z) - dist(b.x, b.z))[0];
    if (!spot || !walkTo(spot.x, spot.z)) return false;
    pass(ACT.build);
    if (!sim.build.place(type, GROUND, spot.x, spot.z)) return false;
    first(type);
    return true;
  }
  function affordableNear(): boolean {
    return !!nearestPulse();
  }
  function nearestPulse(): TileData | undefined {
    let best: TileData | undefined;
    let bd = Infinity;
    for (const t of sim.areas.tiles(PARK)) {
      if (t.ground === 'restored' || t.ground === 'growing') continue;
      if (!sim.restoration.checkPulse(t).ok) continue;
      // prefer tiles whose pulse footprint restores the most, then the nearest
      const d = dist(t.x, t.z) - (t.ground === 'prepared' ? 3 : 0);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }
}

export const mmss = (s: number | undefined) => (s === undefined ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
