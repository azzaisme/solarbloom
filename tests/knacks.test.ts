import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { KNACK_TUNING as T, KNACKS } from '../src/data/bloombot';
import { CHARGE } from '../src/data/charge';
import { KEEPERS, PARK_SET } from '../src/data/oldcity';
import { POWER } from '../src/data/power';
import { SALVAGE } from '../src/data/salvage';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { BLOOMBOT_GROUPS, bloombotRows, knackRows, stateWords } from '../src/ui/BloombotPage';
import { bannedIn, WORDS } from '../src/ui/words';

/**
 * #625 (E25): each Keeper, as it wakes, teaches Bloombot a knack tied to its place, in its own voice. One per Keeper,
 * each doing something real in its system, each on the Bloombot page and as a bead on Bloombot.
 */
const fresh = () => new Sim(createInitialState(7));
const wake = (sim: Sim, id: string) => (sim.state.salvage!.keepers[id] = { step: 'request1' });
/** The same measure taken with a Keeper asleep, then woken. */
function beforeAfter(keeper: string, measure: (sim: Sim) => number): [number, number] {
  const a = fresh();
  const b = fresh();
  wake(b, keeper);
  return [measure(a), measure(b)];
}
/** Charge added by one call, by source. */
function charged(sim: Sim, run: () => void): number {
  sim.state.charge = { value: 0 };
  const before = sim.charge.value();
  run();
  return sim.charge.value() - before;
}

describe('#625: each Keeper teaches Bloombot a knack', () => {
  it('ten knacks, one per Keeper, each with a plain name, what it does and a line in the Keeper\'s voice', () => {
    expect(KNACKS.map((k) => k.keeper)).toEqual(KEEPERS.map((k) => k.id));
    expect(new Set(KNACKS.map((k) => k.name)).size).toBe(10);
    for (const k of KNACKS) {
      for (const line of [k.does, k.taught]) {
        expect(bannedIn(line), line).toEqual([]);
        expect(line).toMatch(/[.!?]$/);
      }
      expect(k.does).not.toMatch(/\b(tier|knack|tiles?)\b/i);
    }
  });

  it('waking a Keeper teaches its knack: said in its own words, before its first request, with a moment', () => {
    const sim = fresh();
    sim.state.salvage!.tier = 1;
    sim.state.salvage!.abilities.push('pry');
    sim.areas.clear('park', true);
    sim.gates.open('g-mastRow');
    sim.bot = { roofId: GROUND, x: 10.5, z: -2.5 };
    const said: { lines: string[]; then?: string[] }[] = [];
    const taught: string[] = [];
    sim.bus.on('keeper.said', (e) => said.push(e));
    sim.bus.on('bloombot.knack', (e) => taught.push(e.keeper));
    expect(sim.knacks.has('pylon')).toBe(false);
    sim.keepers.pulse('pylon');
    sim.inventory.add('scrap', 5);
    expect(sim.keepers.interact('pylon')).toBe('woke');
    expect(taught).toEqual(['pylon']);
    expect(sim.knacks.has('pylon')).toBe(true);
    // first what it remembers; then, in a second bubble, the knack in its own words and its first request
    const pylon = KNACKS[0];
    const d = KEEPERS[0];
    expect(said.at(-1)).toMatchObject({ lines: [...d.say.woke, ...sim.keepers.beat('pylon', 'taker')], then: [pylon.taught, ...d.say.request1] });
    // the moment names the Keeper and what it taught
    expect(WORDS.bloombot.knack('Pylon', pylon.name, pylon.does)).toBe('Pylon taught Bloombot a knack: Quick charge<small>Sitting at a charger fills Bloombot a fifth faster.</small>');
    // taught once: talking to it again teaches nothing new
    sim.keepers.interact('pylon');
    expect(taught).toEqual(['pylon']);
  });

  it('each of the two wake bubbles stays at three lines or fewer, for every Keeper', () => {
    for (const d of KEEPERS) {
      const sim = fresh();
      expect([...d.say.woke, ...sim.keepers.beat(d.id, 'taker')].length, d.id).toBeLessThanOrEqual(3);
      expect([KNACKS.find((x) => x.keeper === d.id)!.taught, ...d.say.request1].length, d.id).toBeLessThanOrEqual(3);
    }
  });

  it('nothing new is saved: an old save\'s woken Keepers have taught theirs, quietly', () => {
    const state = createInitialState(7);
    state.salvage!.keepers.tide = { step: 'settled' };
    state.salvage!.keepers.moss = { step: 'asleep', pulsed: true };
    const sim = new Sim(state);
    const taught: string[] = [];
    sim.bus.on('bloombot.knack', (e) => taught.push(e.keeper));
    sim.advance(2);
    expect(sim.knacks.list()).toEqual(['tide']);
    expect(taught).toEqual([]);
  });

  it('Quick charge (Pylon): a charger fills Bloombot a fifth faster', () => {
    const [a, b] = beforeAfter('pylon', (sim) => {
      Object.assign(sim.chargers, { docked: () => ({ id: 'pad' }), full: () => false });
      Object.assign(sim.power, { isPowered: () => true });
      return charged(sim, () => sim.chargers.tick(1));
    });
    expect(a).toBeCloseTo(POWER.charger.rate, 5);
    expect(b).toBeCloseTo(POWER.charger.rate * T.charger, 5);
  });

  it('Eye for value (Tally): every fourth dig at a junk pile turns up one extra piece', () => {
    const pile = PARK_SET.piles.find((p) => fresh().salvage.left(p.id) >= 4 * SALVAGE.perTake)!;
    const digs = (sim: Sim) => {
      const got: number[] = [];
      for (let i = 0; i < 4; i++) got.push(sim.salvage.salvage(pile.id));
      return got;
    };
    const a = fresh();
    const b = fresh();
    wake(b, 'tally');
    const plain = digs(a);
    expect(plain.every((n) => n === SALVAGE.perTake)).toBe(true);
    expect(digs(b)).toEqual([SALVAGE.perTake, SALVAGE.perTake, SALVAGE.perTake, SALVAGE.perTake + 1]);
  });

  it('Beachcomber (Tide): dug piles fill back up a fifth sooner', () => {
    const pile = PARK_SET.piles[0];
    const [a, b] = beforeAfter('tide', (sim) => sim.salvage.perUnit(pile));
    expect(b).toBeCloseTo(a / T.refill, 6);
  });

  it('Green thumb (Moss): Bloombot gathers a quarter more Greens; a Harvester drone does not', () => {
    const gather = (into: 'pack' | 'store') => (sim: Sim) => {
      const t = sim.grid.get(GROUND, 3, 3)!;
      Object.assign(t, { ground: 'restored', bloom: 4, blocked: false, occupantId: undefined });
      return into === 'pack' ? sim.gather.clip(t, 'pack') : (sim.gather.clip(t, 'store'), sim.inventory.stored('biomass'));
    };
    const [a, b] = beforeAfter('moss', gather('pack'));
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(Math.round(a * T.gather));
    const [c, d] = beforeAfter('moss', gather('store'));
    expect(d).toBe(c);
  });

  it('Float along (Sluice): running uses a quarter less charge; pulses do not change', () => {
    const [a, b] = beforeAfter('sluice', (sim) => sim.charge.cost('sprint'));
    expect(b).toBeCloseTo(a * T.run, 6);
    const [p, q] = beforeAfter('sluice', (sim) => sim.charge.cost('pulse'));
    expect(q).toBe(p);
  });

  it('Good timing (Tock): the Mega Pulse is ready a quarter sooner (30 pulses, not 40)', () => {
    const pulses = (sim: Sim) => {
      sim.state.progression.coreActivated = true;
      sim.state.progression.megaCharge = 0;
      let n = 0;
      while ((sim.state.progression.megaCharge ?? 0) < TUNING.mega.charge && n < 100) {
        (sim.restoration as unknown as { chargeMega(): void }).chargeMega();
        n++;
      }
      return n;
    };
    expect(beforeAfter('tock', pulses)).toEqual([TUNING.mega.charge, Math.ceil(TUNING.mega.charge / T.mega)]);
  });

  it('Easy rest (Gable): resting by the fountain or on a bench brings charge back twice as fast', () => {
    const [a, b] = beforeAfter('gable', (sim) => {
      Object.defineProperty(sim.charge, 'resting', { get: () => true });
      return charged(sim, () => sim.charge.tick(1));
    });
    expect(a).toBeCloseTo(CHARGE.home.perSecond, 5);
    expect(b).toBeCloseTo(CHARGE.home.perSecond * T.rest, 5);
    expect(beforeAfter('gable', (sim) => sim.knacks.rest)).toEqual([1, T.rest]);
  });

  it('Warm hands (Fern): crops in planters grow a fifth faster', () => {
    const rate = (sim: Sim) => {
      const m = { id: 'p1', type: 'planter', roofId: GROUND, x: 3, z: 3, size: 1, boostUntil: 0, timer: 0, charge: 0 } as never;
      (sim.state.salvage!.planters ??= {})['p1'] = { crop: 'radish' } as never;
      Object.assign(sim.farm, { isWatered: () => true });
      return sim.farm.look(m).rate;
    };
    const [a, b] = beforeAfter('fern', rate);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeCloseTo(a * T.crops, 6);
  });

  it('Starlight (Vega): at night, pulses and running use a fifth less charge; by day, no change', () => {
    const at = (night: boolean) => (sim: Sim) => {
      Object.assign(sim.clock, { isNight: () => night });
      return sim.charge.cost('pulse');
    };
    const [d1, d2] = beforeAfter('vega', at(false));
    expect(d2).toBe(d1);
    const [n1, n2] = beforeAfter('vega', at(true));
    expect(n2).toBeCloseTo(n1 * T.night, 6);
  });

  it('Strong back (Atlas): Bloombot carries 10 more of each thing', () => {
    const [a, b] = beforeAfter('atlas', (sim) => sim.inventory.stackLimit());
    expect(b).toBe(a + T.carry);
  });

  it('the Bloombot page: its own group, the reachable Keepers next with Show me where, the rest later', () => {
    const sim = fresh();
    expect(BLOOMBOT_GROUPS.map((g) => g.title)).toEqual(['Moves', 'Stronger moves', 'Grown with the park', 'Knacks from the Keepers', 'Upgrades']);
    let rows = knackRows(sim);
    expect(rows.map((r) => r.name)).toEqual(KNACKS.map((k) => k.name));
    expect(rows.every((r) => r.part === 'knacks')).toBe(true);
    // a new island: Tide, on the beach beside the park, can be reached; the rest are behind ways not yet found
    expect(rows.filter((r) => r.state === 'next').map((r) => r.id)).toEqual(['knack-tide']);
    expect(rows.filter((r) => r.state === 'later').every((r) => !r.where)).toBe(true);
    expect(rows[0].how).toBe('Pylon, a robot asleep in Mast Row, teaches this when it wakes. Find the way into Mast Row first.');
    // Mast Row open: Pylon is next, and Show me where goes to it
    sim.areas.clear('park', true);
    sim.state.salvage!.abilities.push('pry');
    sim.gates.open('g-mastRow');
    rows = knackRows(sim);
    expect(rows[0]).toMatchObject({ state: 'next', where: { name: 'Pylon' } });
    expect(stateWords(rows[0])).toBe('Next');
    expect(rows[0].how).toBe('Pylon is a robot asleep in Mast Row. Pulse it to stir it, then bring it 5 of anything to wake it. It teaches this as it wakes.');
    sim.keepers.pulse('pylon');
    expect(knackRows(sim)[0].how).toBe('Pylon is stirring in Mast Row. Bring it 5 of anything and talk to it, and it wakes and teaches this.');
    wake(sim, 'pylon');
    expect(knackRows(sim)[0]).toMatchObject({ state: 'have', how: 'Pylon taught Bloombot this when it woke in Mast Row.', where: undefined });
    expect(stateWords(knackRows(sim)[0])).toBe('Learned');
    for (const r of bloombotRows(sim)) for (const line of [r.does, r.how]) expect(bannedIn(line), line).toEqual([]);
  });

  it('Bloombot wears a bead for each knack learned', () => {
    const sim = fresh();
    wake(sim, 'tide');
    wake(sim, 'pylon');
    expect(sim.knacks.list()).toEqual(['pylon', 'tide']);
  });
});

describe('#625: the second wake bubble is never lost', () => {
  /** A SpeechBubble on a stand-in element (the tests run without a page). */
  async function bubble() {
    const el = { hidden: true, innerHTML: '', className: '', style: {} as Record<string, string>, offsetWidth: 200, offsetHeight: 80, offsetParent: { clientWidth: 1280 } };
    (globalThis as { document?: unknown }).document ??= { createElement: () => el };
    const { SpeechBubble } = await import('../src/ui/OldCityPanel');
    const b = new SpeechBubble({ appendChild: () => {} } as unknown as HTMLElement);
    return { b, el: b.el as unknown as typeof el };
  }
  const ON = { x: 100, y: 100 };

  it('shows after the first, once it has been read', async () => {
    const { b, el } = await bubble();
    b.say('Tide', ['Tide, keeper of Saltwind Beach.'], 2, ['The sea always brings things back.'], 0);
    b.place(ON, 1000);
    expect(el.innerHTML).toContain('keeper of Saltwind');
    b.place(ON, 2500);
    expect(el.hidden).toBe(false);
    expect(el.innerHTML).toContain('The sea always brings things back.');
  });

  it('waits while Tide is off screen, and shows when it is back', async () => {
    const { b, el } = await bubble();
    b.say('Tide', ['Tide, keeper of Saltwind Beach.'], 2, ['The sea always brings things back.'], 0);
    b.place(undefined, 2500); // walked away before the first one ended
    expect(el.hidden).toBe(true);
    b.place(undefined, 60_000);
    expect(el.hidden).toBe(true);
    b.place(ON, 61_000); // back: the knack and the first request are still said
    expect(el.hidden).toBe(false);
    expect(el.innerHTML).toContain('The sea always brings things back.');
    b.place(ON, 70_000);
    expect(el.hidden).toBe(true); // and said once
    b.place(ON, 71_000);
    expect(el.hidden).toBe(true);
  });

  it('something new said in the meantime replaces it', async () => {
    const { b, el } = await bubble();
    b.say('Tide', ['Tide, keeper of Saltwind Beach.'], 2, ['The sea always brings things back.'], 0);
    b.say('Pylon', ['Bzzt.'], 2, undefined, 500);
    b.place(ON, 3000);
    b.place(ON, 4000);
    expect(el.innerHTML).not.toContain('The sea');
  });
});
