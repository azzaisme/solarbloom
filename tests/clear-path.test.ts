import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState } from '../src/core/GameState';
import { KEEPERS, PARK_SET, REGIONS } from '../src/data/oldcity';
import { GROUND } from '../src/core/GameState';
import { Walker } from '../src/gameplay/Walker';
import { Resting } from '../src/app/Resting';
import { goalSpot } from '../src/ui/GoalSpot';
import { TIERS } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';
import { dueIdea, IDEAS, markKnown, markShown, startIdeas } from '../src/ui/GuideLines';
import { objectiveSentence } from '../src/ui/ObjectiveCard';
import { bannedIn } from '../src/ui/words';

/**
 * E24 "A clear path" (#612). Two players greened the park happily but couldn't tell what they were working toward,
 * and one never found out how to get Pry. These pin down what the game now says: the goal and every part of it from
 * the start (#605), the guide's lines once each (#607), and greening counted toward the fountain (#608).
 */
const key = (a: string) => ({ interact: 'E', pulse: 'Space', buildMenu: 'Q' })[a] ?? '?';
const restorePark = (sim: Sim, n: number) => {
  let done = 0;
  for (const t of sim.areas.tiles(PARK)) {
    if (done >= n) break;
    if (t.ground === 'restored' || !sim.restoration.checkPulse(t).ok) continue;
    t.ground = 'restored';
    t.pollution = 0;
    t.bloom = 1;
    sim.grid.touch(t);
    done++;
  }
  return done;
};

describe('#605: the goal card says why and where', () => {
  it('a new game shows the goal, what it brings, and every part of it from the start (materials and park together)', () => {
    const sim = new Sim(createInitialState(7));
    const o = objectiveSentence(sim);
    expect(o.text).toBe('Wake the fountain');
    expect(o.why).toBe('Bloombot learns to pry open rubble');
    expect(o.parts?.map((p) => `${p.label} ${p.have} of ${p.need}`)).toEqual(['Scrap 0 of 20', 'Seeds 0 of 6', 'Park 0 of 60']);
    expect(o.progress).toBe(0);
    // the next step under it points somewhere (Show me where)
    expect(o.next).toBeTruthy();
    expect(o.where?.kind).toBe('focus');
  });

  it('later steps go by the fountain panel\'s own names and say what they bring', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.tier = 1;
    const o = objectiveSentence(sim);
    expect(o.text).toBe(`Fountain step 2: ${TIERS[1].name}`);
    expect(o.why).toBe('Bloombot learns to hover over deep water');
    expect(o.parts?.map((p) => p.label)).toEqual(['Copper', 'Timber', 'Glass', 'Landmarks awake']);
    sim.state.salvage!.tier = 4;
    expect(objectiveSentence(sim).why).toBe('The whole city comes back into flower');
  });

  it('a Keeper request sits under the fountain goal instead of replacing it', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.tier = 1;
    const k = KEEPERS.find((q) => q.region === 'mastRow')!;
    sim.state.salvage!.opened.push(REGIONS.find((r) => r.id === 'mastRow')!.gate.id);
    sim.state.salvage!.keepers[k.id] = { step: 'request1' };
    const pinned = sim.keepers.pinned();
    expect(pinned).toBeTruthy();
    const o = objectiveSentence(sim);
    expect(o.text).toMatch(/^Fountain step 2/);
    expect(o.next).toContain(pinned!.text);
    expect(o.topic).toBe('keeper');
  });

  it('running low shows under the goal; the farm hint never takes the main line', () => {
    const sim = new Sim(createInitialState(4));
    (sim as unknown as Record<string, unknown>).charge = { low: true, share: 0.1 };
    let o = objectiveSentence(sim);
    expect(o.text).toBe('Wake the fountain');
    expect(o.next).toMatch(/running low/);
    expect(o.topic).toBe('charge');
    (sim as unknown as Record<string, unknown>).charge = { low: false, share: 0.9 };
    const farm = { topic: 'farm' as const, text: 'Your farm wants living ground around it. Pulse the soil beside it.', label: '🌱 Show me where', action: { kind: 'focus' as const, x: 1, z: 1 } };
    o = objectiveSentence(sim, farm);
    expect(o.text).toBe('Wake the fountain');
    expect(o.next).not.toBe(farm.text); // the fountain's own step comes before the farm's
  });

  it('says when the fountain is ready, and hands the line to the advisor once every step is done', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.delivered = { scrap: 20, seeds: 6 };
    restorePark(sim, 60);
    if (sim.fountain.canAdvance()) expect(objectiveSentence(sim).text).toBe('The fountain is ready. Go and wake it.');
    sim.state.salvage!.tier = TIERS.length;
    const g = sim.advisor.suggest();
    expect(objectiveSentence(sim).text).toBe(g.text);
  });
});

describe('#607: the guide\'s lines, once each', () => {
  it('a new game starts with salvaging, then each idea as it comes up, never twice', () => {
    const sim = new Sim(createInitialState(7));
    startIdeas(sim);
    expect(sim.state.progression.ideas).toEqual([]);
    const first = dueIdea(sim)!;
    expect(first.id).toBe('salvage');
    expect(first.text(key as never, sim)).toBe('Old things lie everywhere. Hold E by a pile to salvage it.');
    markShown(sim, 'salvage');
    expect(dueIdea(sim)).toBeUndefined(); // pulsing comes up once something is salvaged
    sim.state.salvage!.piles['p-test'] = 1;
    expect(dueIdea(sim)?.id).toBe('pulse');
    markShown(sim, 'pulse');
    expect(sim.state.progression.ideas).toEqual(['salvage', 'pulse']);
  });

  it('an idea the player has already done is marked known without a word', () => {
    const sim = new Sim(createInitialState(7));
    startIdeas(sim);
    sim.state.salvage!.piles['p-test'] = 1; // salvaged before the line could show
    sim.state.stats.tilesRestored = 3; // and pulsed
    markKnown(sim);
    expect(sim.state.progression.ideas).toEqual(expect.arrayContaining(['salvage', 'pulse']));
    expect(dueIdea(sim)?.id).toBe('park');
  });

  it('a save from before E24 never hears about what it has already been doing', () => {
    const sim = new Sim(createInitialState(7));
    const p = sim.state.progression;
    p.tutorialStep = 6;
    sim.state.salvage!.tier = 1;
    sim.state.salvage!.abilities.push('pry');
    sim.state.salvage!.piles['p-test'] = 1;
    sim.state.stats.tilesRestored = 80;
    sim.state.salvage!.opened.push(REGIONS.find((r) => r.id === 'mastRow')!.gate.id);
    delete p.ideas;
    startIdeas(sim);
    expect(dueIdea(sim)).toBeUndefined();
  });

  it('every line is short, plain and names the player\'s own key where it asks for one', () => {
    const sim = new Sim(createInitialState(7));
    for (const i of IDEAS) {
      const line = i.text(key as never, sim);
      expect(bannedIn(line), line).toEqual([]);
      expect(line.length, line).toBeLessThan(140);
      expect(line, line).not.toMatch(/—|\btap\b|\bclick\b/i);
      expect(line, line).toMatch(/\.$/);
    }
  });

  it('the first arrow points at the guide\'s first step: the pile in front of bloombot, not a park tile', () => {
    const sim = new Sim(createInitialState(7));
    const pile = sim.advisor.nearestPile(['scrap', 'seeds'])!;
    expect(pile).toBeTruthy();
    expect(['scrap', 'seeds']).toContain(pile.material);
    expect(sim.salvage.problem(pile.id)).toBeUndefined();
  });
});

describe('#608: greening moves you forward', () => {
  it('the park counts toward the fountain on the card from the first tile', () => {
    const sim = new Sim(createInitialState(7));
    const n = restorePark(sim, 12);
    const park = objectiveSentence(sim).parts!.find((p) => p.label === 'Park')!;
    expect(park.have).toBe(Math.min(60, sim.areas.counts(PARK).restored));
    expect(park.have).toBeGreaterThanOrEqual(n);
  });

  it('when the park part is done but materials are short, the line says so and points at the piles', () => {
    const sim = new Sim(createInitialState(7));
    startIdeas(sim);
    for (const id of ['salvage', 'pulse', 'park', 'fountain'] as const) markShown(sim, id);
    restorePark(sim, 200);
    expect(sim.fountain.condition().done).toBe(true);
    const idea = dueIdea(sim)!;
    expect(idea.id).toBe('parkDone');
    expect(idea.text(key as never, sim)).toBe("That's the park alive around the fountain. It still needs Scrap and Seeds: look for the piles that glint.");
    // the card's next step names a pile to salvage, with a place to show
    const o = objectiveSentence(sim);
    expect(o.next).toMatch(/salvage it here/);
    expect(o.where?.kind).toBe('focus');
  });

  it('with everything handed in, the park-done line says to go and wake the fountain', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.delivered = { scrap: 20, seeds: 6 };
    restorePark(sim, 200);
    const idea = IDEAS.find((i) => i.id === 'parkDone')!;
    expect(idea.comes(sim)).toBe(true);
    expect(idea.text(key as never, sim)).toBe("That's the park alive around the fountain. Walk up to it and press E.");
  });
});

describe('#609 / #613: one goal spot for Show me where, the arrow, the beam and the minimap', () => {
  it('a new game points at the first pile, named, at its cell centre on the ground', () => {
    const sim = new Sim(createInitialState(7));
    const pile = sim.advisor.nearestPile(['scrap', 'seeds'])!;
    const s = goalSpot(sim)!;
    expect(s).toMatchObject({ roofId: GROUND, kind: 'pile', cell: { x: pile.x, z: pile.z }, x: pile.x + 0.5, z: pile.z + 0.5 });
    expect(s.name).toMatch(/^a (Scrap|Seeds) pile$/);
  });

  it('a pinned Keeper request points at the Keeper, by name', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.tier = 1;
    const k = KEEPERS.find((q) => q.region === 'mastRow')!;
    sim.state.salvage!.opened.push(REGIONS.find((r) => r.id === 'mastRow')!.gate.id);
    sim.state.salvage!.keepers[k.id] = { step: 'request1' };
    expect(goalSpot(sim)).toMatchObject({ kind: 'keeper', name: k.name });
  });

  it('the park part points at the park, and handing in points at the fountain', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.delivered = { scrap: 20, seeds: 6 };
    expect(goalSpot(sim)).toMatchObject({ kind: 'park', name: 'the park' });
    restorePark(sim, 200);
    sim.state.salvage!.delivered = { scrap: 10, seeds: 6 };
    sim.inventory.add('scrap', 10);
    expect(goalSpot(sim)).toMatchObject({ kind: 'fountain', name: 'the fountain' });
  });

  it('nothing to point at gives no spot', () => {
    const sim = new Sim(createInitialState(7));
    expect(goalSpot(sim, { text: 'x' })).toBeUndefined();
    expect(goalSpot(sim, { text: 'x', where: { kind: 'wait', seconds: 5 } })).toBeUndefined();
  });

  it('#613: running low names the nearest resting place, and the spot leads there: a place where standing still charges', () => {
    const sim = new Sim(createInitialState(7));
    const home = sim.charge;
    (sim as unknown as Record<string, unknown>).charge = { low: true, share: 0.1 };
    const c = sim.advisor.chargeStep()!;
    expect(c.text).toMatch(/^Bloombot is running low\. Stand still by the (fountain|house) for a while to charge up\.$/);
    expect(bannedIn(c.text)).toEqual([]);
    const o = objectiveSentence(sim);
    expect(o.text).toBe('Wake the fountain'); // the goal stays; the shortage sits under it
    const s = goalSpot(sim, o)!;
    expect(s.kind).toBe('rest');
    expect(c.text).toContain(s.name);
    // the spot is somewhere to stand, inside home's resting reach
    expect(new Walker(sim).walkable(GROUND, s.cell.x, s.cell.z)).toBe(true);
    expect(home.atHome({ roofId: GROUND, x: s.x, z: s.z } as never)).toBe(true);
  });

  it('#613: by the house, the house is the nearer home', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.bot = { roofId: GROUND, x: PARK_SET.shed.door[0] + 0.5, z: PARK_SET.shed.door[1] + 1.5, facing: 0 } as never;
    expect(sim.advisor.restSpot().name).toBe('the house');
  });

  it('sitting on a bench leaves Show me where to the game (it only takes Interact, Back and Pulse)', () => {
    const r = new Resting({ sim: { rest: { sitting: { kind: 'bench' } }, bus: { on() {} } }, bot: {} } as never);
    expect(r.active).toBe(true);
    expect(r.action('showWhere')).toBe(false);
  });
});
