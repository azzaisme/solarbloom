import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { allPiles } from '../src/core/OldCityLayout';
import { CHARGE } from '../src/data/charge';
import { RIPPLE } from '../src/data/pulse';
import { PROJECTS, RESEARCH, RESEARCH_UPGRADES } from '../src/data/research';
import { SALVAGE } from '../src/data/salvage';
import { ITEM_DEFS } from '../src/data/items';
import { Sim } from '../src/gameplay/Sim';
import { bloombotRows, bloombotUpgradeRows } from '../src/ui/BloombotPage';
import { bannedIn, WORDS } from '../src/ui/words';

/**
 * #624 (E25): five more workshop upgrades for Bloombot, each opened by a research project and each working through a
 * system that was already there: Quick hands (the Interact holds), Keen eye (the pulse's reveal ripple, the glint and
 * the minimap), Sun soak (charge), Lantern (a light of its own at night) and Lucky pulse (the pulse). None does
 * anything before it is bought.
 */
const NEW = ['quickHands', 'keenEye', 'sunSoak', 'lantern', 'luckyPulse'];
const fresh = () => new Sim(createInitialState(7));
/** a game with these research levels already bought */
function at(levels: Record<string, number>) {
  const sim = fresh();
  sim.state.salvage!.research = { analysed: [], done: [], running: [], levels: { ...levels } };
  return sim;
}
/** bare park ground a pulse can wake */
const bare = (sim: Sim) => sim.areas.tiles(PARK).filter((t) => t.ground !== 'restored' && sim.restoration.checkPulse(t).ok);

describe('#624: five new Bloombot upgrades in data', () => {
  it('each is a Bloombot upgrade with its levels, opened by a project a player can reach', () => {
    for (const id of NEW) {
      const u = RESEARCH_UPGRADES.find((q) => q.id === id)!;
      expect(u, id).toBeDefined();
      expect(u.branch).toBe('bloombot');
      expect(u.levels.length, id).toBe(id === 'lantern' ? 2 : 3);
      for (const l of u.levels) for (const k of Object.keys(l.cost)) expect(k in ITEM_DEFS, `${id}: ${k}`).toBe(true);
      const p = PROJECTS.filter((q) => 'upgrade' in q.gives && (q.gives as { upgrade: string }).upgrade === id);
      expect(p.length, id).toBe(1);
    }
  });

  it('the words are plain', () => {
    const sim = fresh();
    for (const r of bloombotUpgradeRows(sim).filter((x) => NEW.includes(x.id))) {
      for (const line of [r.does, r.next ?? '']) expect(bannedIn(line), line).toEqual([]);
      expect(r.does).toMatch(/\.$/);
      expect(r.does.length).toBeLessThan(150);
    }
    expect(WORDS.bloombot.lucky(3, 'Seeds')).toBe('Lucky! The pulse dug up 3 Seeds');
  });

  it('every level can be bought at the crafting table, and each reads in its own system', () => {
    const sim = fresh();
    sim.state.salvage!.tier = 1;
    sim.bot = { roofId: GROUND, x: 8.5, z: 11.5 };
    sim.state.salvage!.keepers.pylon = { step: 'request1' };
    sim.state.salvage!.research = { analysed: [], done: PROJECTS.map((p) => p.id), running: [], levels: {} };
    for (const m of ['scrap', 'seeds', 'copper', 'gears', 'wire', 'glassPane', 'batteryCell', 'motor', 'sunCell', 'sunstone'] as const) sim.inventory.addToStore(m, 200);
    const u = sim.upgrades;
    const read = (id: string) => ({ quickHands: -u.salvageHold, keenEye: u.rippleRadius, sunSoak: u.sunSoak, lantern: u.lanternReach, luckyPulse: u.luckyChance })[id]!;
    for (const id of NEW) {
      const max = RESEARCH_UPGRADES.find((q) => q.id === id)!.levels.length;
      for (let l = 1; l <= max; l++) {
        const before = read(id);
        expect(sim.research.upgrade(id), `${id} ${l}`).toBe(l);
        expect(read(id), `${id} ${l}`).toBeGreaterThan(before);
      }
      expect(sim.research.upgradeProblem(id)).toBe('As good as it gets');
    }
  });
});

describe('#624: what each does', () => {
  it('none does anything before it is bought', () => {
    const u = fresh().upgrades;
    expect(u.salvageHold).toBe(SALVAGE.holdSeconds);
    expect(u.pryHold).toBe(SALVAGE.pryHoldSeconds);
    expect(u.rippleRadius).toBe(RIPPLE.radius);
    expect(u.glintExtra).toBe(0);
    expect(u.findsOnMap).toBe(false);
    expect(u.sunSoak).toBe(0);
    expect(u.lanternReach).toBe(0);
    expect(u.luckyChance).toBe(0);
  });

  it('Quick hands: digging and prying take 10% less a level', () => {
    expect([0, 1, 2, 3].map((l) => +at({ quickHands: l }).upgrades.pryHold.toFixed(3))).toEqual([2, 1.8, 1.6, 1.4]);
    expect([0, 1, 2, 3].map((l) => +at({ quickHands: l }).upgrades.salvageHold.toFixed(3))).toEqual([0.6, 0.54, 0.48, 0.42]);
  });

  it('Quick hands stacks with Nimble hands from the park, in one place, and never below a third of a second', () => {
    const stacked = [0, 1, 2, 3].map((l) => {
      const sim = at({ quickHands: l });
      sim.state.progression.parkGrowth = 3; // Nimble hands: a quarter off digging
      return +sim.upgrades.salvageHold.toFixed(3);
    });
    // 0.6 × 0.75 × (1, 0.9, 0.8, 0.7): 0.45, 0.405, 0.36, then 0.315 held up at the floor
    expect(stacked).toEqual([0.45, 0.405, 0.36, RESEARCH.minHold]);
    expect(RESEARCH.minHold).toBeCloseTo(1 / 3, 1);
    // every level still does something somewhere: each stacked step is quicker than the last
    for (let i = 1; i < stacked.length; i++) expect(stacked[i]).toBeLessThan(stacked[i - 1]);
    // the floor holds whatever the numbers: even with the levels pushed far past what can be bought
    const silly = at({ quickHands: 20 });
    silly.state.progression.parkGrowth = 3;
    expect(silly.upgrades.salvageHold).toBe(RESEARCH.minHold);
    expect(silly.upgrades.pryHold).toBe(RESEARCH.minHold);
  });

  it('the game reads its holds from that one place, and the page shows the combined time', () => {
    const sim = at({ quickHands: 3 });
    sim.state.progression.parkGrowth = 3;
    const rows = bloombotRows(sim);
    const quick = rows.find((r) => r.id === 'quickHands')!;
    const nimble = rows.find((r) => r.id === 'quick')!;
    expect(quick.now).toBe('Right now digging out a pile takes 0.33 seconds, and prying rubble open 1.4 seconds.');
    expect(nimble.now).toBe(quick.now);
    expect(bannedIn(quick.now!)).toEqual([]);
    expect(at({}).upgrades.salvageHold).toBe(SALVAGE.holdSeconds);
    expect(bloombotRows(at({})).find((r) => r.id === 'quickHands')!.now).toBe('Right now digging out a pile takes 0.6 seconds, and prying rubble open 2 seconds.');
  });

  it('Keen eye: the pulse lights up piles from 4 tiles further a level; at level 3 they show on the map', () => {
    expect([0, 1, 2, 3].map((l) => at({ keenEye: l }).upgrades.rippleRadius)).toEqual([7, 11, 15, 19]);
    expect([0, 1, 2, 3].map((l) => at({ keenEye: l }).upgrades.findsOnMap)).toEqual([false, false, false, true]);
    // a pile 9 tiles off: out of a plain pulse's reach, lit by a Keen eye one
    const pile = allPiles()[0];
    const from = { roofId: GROUND, x: pile.x + 9, z: pile.z };
    const lit = (sim: Sim) => sim.pulseLoad.ripple(from).some((g) => g.kind === 'salvage' && g.id === pile.id);
    expect(lit(at({}))).toBe(false);
    expect(lit(at({ keenEye: 1 }))).toBe(true);
  });

  it('Sun soak: standing still in the sun charges Bloombot; not moving, at night, nor before it', () => {
    const run = (levels: Record<string, number>, sun: number, walk = false) => {
      const sim = at(levels);
      sim.clock.solarFactor = () => sun;
      sim.bot = { roofId: GROUND, x: 30.5, z: 30.5 }; // out in the city, nowhere near home
      expect(sim.charge.atHome()).toBe(false);
      sim.state.charge = { value: 10 };
      for (let i = 0; i < 100; i++) {
        if (walk) sim.bot = { roofId: GROUND, x: 30.5 + (i % 2), z: 30.5 };
        sim.charge.tick(0.1);
      }
      return sim.charge.value() - 10;
    };
    expect(run({}, 1)).toBe(0);
    expect(run({ sunSoak: 1 }, 0)).toBe(0);
    expect(run({ sunSoak: 3 }, 1, true)).toBe(0);
    // 10 s, the first 1.5 standing still before it starts: 8.5 s at 0.12 a level
    expect(run({ sunSoak: 1 }, 1)).toBeCloseTo(0.12 * (10 - CHARGE.home.stillSeconds), 1);
    expect(run({ sunSoak: 3 }, 0.5)).toBeCloseTo(0.36 * 0.5 * (10 - CHARGE.home.stillSeconds), 1);
  });

  it('Sun soak never beats resting at home, and at home the rest is what charges', () => {
    expect(at({ sunSoak: 3 }).upgrades.sunSoak).toBeLessThan(CHARGE.home.perSecond);
  });

  it('Lantern: no light of its own before it, then 3 tiles, then 6', () => {
    expect([0, 1, 2].map((l) => at({ lantern: l }).upgrades.lanternReach)).toEqual([0, 3, 6]);
  });

  it('Lucky pulse: never before it (the dice are not even rolled)', () => {
    const sim = at({});
    let rolls = 0;
    const next = sim.rng.next.bind(sim.rng);
    sim.rng.next = () => (rolls++, next());
    let lucky = 0;
    sim.bus.on('pulse.lucky', () => lucky++);
    for (const t of bare(sim).slice(0, 20)) {
      sim.charge.refillForTest();
      sim.restoration.pulse(t.id);
    }
    expect(lucky).toBe(0);
    expect(rolls).toBe(0);
  });

  it('Lucky pulse: a 4% chance a level, 2 or 3 Seeds or Scrap, straight into the backpack', () => {
    const roll = (levels: Record<string, number>, dice: number[]) => {
      const sim = at(levels);
      let i = 0;
      sim.rng.next = () => dice[i++ % dice.length];
      const got: { material: string; n: number }[] = [];
      sim.bus.on('pulse.lucky', (e) => got.push(e));
      const before = sim.inventory.count('seeds') + sim.inventory.count('scrap');
      sim.charge.refillForTest();
      expect(sim.restoration.pulse(bare(sim)[0].id)).toBe(true);
      return { got, gained: sim.inventory.count('seeds') + sim.inventory.count('scrap') - before };
    };
    // a roll of 0.05 misses at level 1 (4%) and lands at level 2 (8%)
    expect(roll({ luckyPulse: 1 }, [0.05, 0, 0]).got).toEqual([]);
    expect(roll({ luckyPulse: 2 }, [0.05, 0, 0]).got).toEqual([{ tileId: expect.any(String), material: 'seeds', n: 2 }]);
    // the second roll picks the find, the third how many
    const r = roll({ luckyPulse: 1 }, [0, 0.9, 0.9]);
    expect(r.got).toEqual([{ tileId: expect.any(String), material: 'scrap', n: 3 }]);
    expect(r.gained).toBe(3);
  });

  it('Lucky pulse: only a pulse that wakes bare ground is lucky (not one on ground already alive)', () => {
    const sim = at({ luckyPulse: 3 });
    sim.rng.next = () => 0;
    let lucky = 0;
    sim.bus.on('pulse.lucky', () => lucky++);
    const t = bare(sim)[0];
    t.ground = 'restored';
    t.bloom = 1;
    sim.grid.touch(t);
    sim.charge.refillForTest();
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(lucky).toBe(0);
  });

  it('balance: at its best Lucky pulse finds about a third of a thing a pulse, and level 1 of each costs early things', () => {
    const L = RESEARCH.lucky;
    const best = RESEARCH_UPGRADES.find((u) => u.id === 'luckyPulse')!;
    expect(best.per * best.levels.length * ((L.min + L.max) / 2)).toBeLessThanOrEqual(0.3);
    const LATE = new Set(['sunCell', 'motor', 'batteryCell']);
    for (const id of NEW) {
      const u = RESEARCH_UPGRADES.find((q) => q.id === id)!;
      expect(Object.keys(u.levels[0].cost).some((k) => LATE.has(k)), id).toBe(false);
    }
  });
});
