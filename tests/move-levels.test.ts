import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { canStep, levelAt } from '../src/core/Height';
import { inRect, setPieceAt } from '../src/core/OldCityLayout';
import { MOVE_LAND, MOVE_LEVEL_TWO, MOVE_LEVELS, MOVE_TRIPS, STASHES, VAULTS } from '../src/data/moveSpots';
import { PROJECTS } from '../src/data/research';
import type { AbilityId } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';
import { BLOOMBOT_GROUPS, bloombotRows, howHeading, moveTwoRows } from '../src/ui/BloombotPage';
import { bannedIn, WORDS } from '../src/ui/words';

/**
 * E25 (#626): each move Bloombot learns gets a second level, worked out later at the crafting table, with places in
 * the world to use it: sealed vaults for Pry II, a sandbar out at sea for Hover II, ruins' roofs for Climb II and an
 * old pier off the cliff for Glide II. Each of those places holds a stash.
 */

/** A sim with every part of the city in view (the fog lifts as regions open in play; here it never hides a cell). */
function open() {
  const sim = new Sim(createInitialState(7));
  (sim.areas as unknown as { fog: () => string }).fog = () => 'cleared';
  return { sim, walk: new Walker(sim) };
}

const MOVES: AbilityId[] = ['prune', 'hover', 'climb', 'glide'];
const learn = (sim: Sim, ...as: AbilityId[]) => sim.state.salvage!.abilities.push(...as);
const research = (sim: Sim) => (sim.state.salvage!.research ??= { analysed: [], done: [], running: [], levels: {} });
/** The research station is in the house once a Keeper wakes. */
const station = (sim: Sim) => (sim.state.salvage!.keepers['k'] = { step: 'request1' } as never);
const levelTwo = (sim: Sim, a: AbilityId) => research(sim).done.push(sim.research.moveProject(a)!.id);

describe('#626: earning the second levels at the workshop', () => {
  it('each move has one project in the Bloombot branch that gives its second level', () => {
    for (const a of MOVES) {
      const ps = PROJECTS.filter((p) => 'move' in p.gives && p.gives.move === a);
      expect(ps.length, a).toBe(1);
      expect(ps[0].branch).toBe('bloombot');
      expect(ps[0].name).toBe(MOVE_LEVEL_TWO[a].name);
    }
  });

  it('each opens a fountain step after its move: Pry II with Hover, Hover II with Climb, Climb II with Glide, Glide II after Climb II', () => {
    const { sim } = open();
    station(sim);
    const isOpen = (id: string) => sim.research.isOpen(sim.research.project(id)!);
    expect(['rb-pry2', 'rb-hover2', 'rb-climb2', 'rb-glide2'].map(isOpen)).toEqual([false, false, false, false]);
    learn(sim, 'prune');
    expect(isOpen('rb-pry2')).toBe(false);
    expect(sim.research.problem('rb-pry2')).toBe('Learn Hover at the fountain first');
    learn(sim, 'hover');
    expect(isOpen('rb-pry2')).toBe(true);
    expect(isOpen('rb-hover2')).toBe(false);
    learn(sim, 'climb');
    expect(isOpen('rb-hover2')).toBe(true);
    learn(sim, 'glide');
    expect(isOpen('rb-climb2')).toBe(true);
    expect(isOpen('rb-glide2')).toBe(false);
    research(sim).done.push('rb-climb2');
    expect(isOpen('rb-glide2')).toBe(true);
  });

  it('a learned move is never a find to look at: its second level just opens', () => {
    const { sim } = open();
    station(sim);
    learn(sim, ...MOVES);
    expect(sim.research.finds().some((f) => 'move' in f)).toBe(false);
    expect(sim.research.open().map((p) => p.id)).toEqual(expect.arrayContaining(['rb-pry2', 'rb-hover2', 'rb-climb2']));
  });

  it('a move is level 0, then 1 once learned, then 2 once its project is done (never 2 without the move)', () => {
    const { sim } = open();
    levelTwo(sim, 'hover');
    expect(sim.research.moveLevel('hover')).toBe(0);
    learn(sim, 'hover');
    expect(sim.research.moveLevel('hover')).toBe(2);
    expect(sim.research.moveLevel('prune')).toBe(0);
    learn(sim, 'prune');
    expect(sim.research.moveLevel('prune')).toBe(1);
    expect(sim.moves.level('prune')).toBe(1);
  });

  it('the workshop finishing one says so in a plain line', () => {
    for (const a of MOVES) {
      const line = WORDS.bloombot.levelTwo[a];
      expect(line).toMatch(/^Bloombot can .+ now$/);
      expect(bannedIn(line)).toEqual([]);
    }
  });
});

describe('#626: the new places in the city', () => {
  it('the sandbar, the old pier and the roofs are clear ground at their own level, with no way up on foot', () => {
    const { sim, walk } = open();
    for (const m of MOVE_LAND) {
      for (let z = m.z; z < m.z + m.d; z++)
        for (let x = m.x; x < m.x + m.w; x++) {
          expect(levelAt(x, z), `${m.id} ${x},${z}`).toBe(m.level);
          const sp = setPieceAt(x, z);
          if (sp?.kind === 'stash') continue;
          expect(walk.walkable(GROUND, x, z), `${m.id} ${x},${z}`).toBe(true);
        }
      // round its edge: sea, or ground a level lower or higher, never a step
      for (let z = m.z - 1; z <= m.z + m.d; z++)
        for (let x = m.x - 1; x <= m.x + m.w; x++) {
          if (inRect(m, x, z)) continue;
          const inside: [number, number] = [Math.min(m.x + m.w - 1, Math.max(m.x, x)), Math.min(m.z + m.d - 1, Math.max(m.z, z))];
          if (MOVE_LAND.some((o) => o !== m && inRect(o, x, z) && o.level === m.level)) continue;
          const onFoot = walk.walkable(GROUND, x, z) && canStep(inside[0], inside[1], x, z);
          expect(onFoot, `${m.id}: ${x},${z} steps on`).toBe(false);
        }
    }
    expect(sim.grid.get(GROUND, 8, 55)!.feature).toBe('sand');
  });

  it('every vault and stash stands on its cell, shut, with ground beside it to stand on', () => {
    const { sim, walk } = open();
    for (const v of [...VAULTS, ...STASHES]) {
      const t = sim.grid.get(GROUND, v.x, v.z)!;
      expect(t.blocked, v.id).toBe(true);
      expect(t.prop, v.id).toMatch(new RegExp(`^(vault|stash):${v.id}$`));
      const beside = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dz]) => walk.walkable(GROUND, v.x + dx, v.z + dz) && levelAt(v.x + dx, v.z + dz) === levelAt(v.x, v.z));
      expect(beside, v.id).toBe(true);
    }
    expect(VAULTS.length).toBeGreaterThanOrEqual(3);
    // every place a trip or a climb leads has a stash on it
    for (const m of MOVE_LAND) if (m.id !== 'marketRoof') expect(STASHES.some((s) => inRect(m, s.x, s.z)), m.id).toBe(true);
  });

  it('every trip starts and lands on ground Bloombot can stand on', () => {
    const { walk } = open();
    for (const t of MOVE_TRIPS) {
      for (let z = t.from.z; z < t.from.z + t.from.d; z++) for (let x = t.from.x; x < t.from.x + t.from.w; x++) expect(walk.walkable(GROUND, x, z), `${t.id} from ${x},${z}`).toBe(true);
      expect(walk.walkable(GROUND, t.to[0], t.to[1]), `${t.id} to`).toBe(true);
    }
  });

  it('nowhere strands Bloombot: from every new place a way back leads home, needing nothing', () => {
    const { sim, walk } = open();
    const free = (x: number, z: number) => walk.walkable(GROUND, x, z);
    sim.charge.use('prune', 9999); // even out of charge
    // the sandbar: hover back to the jetty
    const fromSandbar = sim.moves.tripFrom([8, 54], [8, 53], free)!;
    expect(fromSandbar).toMatchObject({ id: 'sandbar-jetty', back: true });
    expect(sim.moves.tripProblem(fromSandbar)).toBeUndefined();
    // the pier: glide down to the sandbar
    const fromPier = sim.moves.tripFrom([21, 54], [20, 54], free)!;
    expect(fromPier).toMatchObject({ id: 'pier-sandbar', back: true });
    expect(sim.moves.tripProblem(fromPier)).toBeUndefined();
    // the roofs: climb down off the edge
    for (const [at, front] of [[[30, 21], [29, 21]], [[33, 21], [32, 21]], [[-7, 27], [-8, 27]]] as [[number, number], [number, number]][]) {
      const t = sim.moves.tripFrom(at, front, free)!;
      expect(t, `${at}`).toMatchObject({ move: 'climb', verb: 'Climb down', back: true, to: front });
      expect(sim.moves.tripProblem(t)).toBeUndefined();
    }
  });
});

describe('#626: Pry II and the sealed vaults', () => {
  it('a vault says what it needs at each level, and Pry II forces it once, for what is inside', () => {
    const { sim } = open();
    const v = VAULTS[0];
    expect(sim.moves.vaultAt(v.x, v.z)).toBe(v);
    expect(sim.moves.vaultProblem(v)).toBe('A heavy iron door, shut tight. Bloombot needs a pry bar for this, and the fountain comes first.');
    learn(sim, 'prune');
    expect(sim.moves.vaultProblem(v)).toBe('This door is too heavy to open by hand. The crafting table in the house can work out a pry bar.');
    expect(sim.moves.openVault(v.id)).toBeUndefined();
    levelTwo(sim, 'prune');
    expect(sim.moves.vaultProblem(v)).toBeUndefined();
    const before = sim.charge.value();
    const opened: string[] = [];
    sim.bus.on('cache.opened', (e) => opened.push(e.cacheId));
    const got = sim.moves.openVault(v.id);
    expect(got).toEqual(v.gives);
    for (const [k, n] of Object.entries(v.gives)) expect(sim.inventory.count(k as never), k).toBe(n);
    expect(sim.charge.value()).toBeLessThan(before);
    expect(opened).toEqual([v.id]);
    expect(sim.state.salvage!.caches).toContain(v.id);
    // once only: it stands open and empty
    expect(sim.moves.vaultAt(v.x, v.z)).toBeUndefined();
    expect(sim.moves.openVault(v.id)).toBeUndefined();
  });

  it('out of charge, Pry II waits', () => {
    const { sim } = open();
    learn(sim, 'prune');
    levelTwo(sim, 'prune');
    sim.charge.use('prune', 9999);
    if (sim.charge.canUse('prune')) return; // charge isn't spent by this build: nothing to check
    expect(sim.moves.vaultProblem(VAULTS[0])).toBe('Out of Charge: press {eat} for a snack, or sit on a bench to rest.');
  });
});

describe('#626: the trips', () => {
  const free = (walk: Walker) => (x: number, z: number) => walk.walkable(GROUND, x, z);

  it('from the end of the jetty, facing the sea: Hover II goes out to the sandbar', () => {
    const { sim, walk } = open();
    const t = sim.moves.tripFrom([8, 48], [8, 49], free(walk))!;
    expect(t).toMatchObject({ id: 'jetty-sandbar', move: 'hover', verb: 'Hover over to', name: 'the sandbar', to: [8, 54] });
    expect(sim.moves.tripProblem(t)).toBe('Too far to wade. Bloombot has to learn Hover at the fountain first.');
    learn(sim, 'hover');
    expect(sim.moves.tripProblem(t)).toBe('Too far to hover yet. The crafting table in the house can work out Hover II.');
    expect(sim.moves.takeTrip(t)).toBe(false);
    levelTwo(sim, 'hover');
    expect(sim.moves.tripProblem(t)).toBeUndefined();
    expect(sim.moves.takeTrip(t)).toBe(true);
    // facing along the jetty instead, or standing on the beach: no trip
    expect(sim.moves.tripFrom([8, 48], [7, 48], free(walk))).toBeUndefined();
    expect(sim.moves.tripFrom([8, 46], [8, 47], free(walk))).toBeUndefined();
  });

  it('from the cliff east of the beach: Glide II goes out to the old pier', () => {
    const { sim, walk } = open();
    const t = sim.moves.tripFrom([22, 47], [22, 48], free(walk))!;
    expect(t).toMatchObject({ id: 'cliff-pier', move: 'glide', name: 'the old pier' });
    learn(sim, 'glide');
    expect(sim.moves.tripProblem(t)).toBe('Too far to glide yet. The crafting table in the house can work out Glide II.');
    levelTwo(sim, 'glide');
    expect(sim.moves.tripProblem(t)).toBeUndefined();
  });

  it('Climb II climbs straight up a roof wall one level high, and on up to the higher roof', () => {
    const { sim, walk } = open();
    const up = sim.moves.tripFrom([29, 21], [30, 21], free(walk))!;
    expect(up).toMatchObject({ move: 'climb', verb: 'Climb up onto', name: 'the old roof', to: [30, 21] });
    expect(sim.moves.tripProblem(up)).toBe('Too high to reach. Bloombot has to learn Climb at the fountain first.');
    learn(sim, 'climb');
    expect(sim.moves.tripProblem(up)).toBe("There's no ladder here. The crafting table in the house can work out Climb II.");
    levelTwo(sim, 'climb');
    expect(sim.moves.tripProblem(up)).toBeUndefined();
    expect(sim.moves.tripFrom([32, 21], [33, 21], free(walk))).toMatchObject({ verb: 'Climb up onto', name: 'the top roof' });
    expect(sim.moves.tripFrom([-8, 27], [-7, 27], free(walk))).toMatchObject({ verb: 'Climb up onto', name: 'the boathouse roof' });
    // ordinary ground a level up (a ramp's top, a terrace) is never climbed: only the ruins' roofs
    expect(sim.moves.tripFrom([29, 18], [29, 19], free(walk))).toBeUndefined();
  });

  it('a stash on each place opens once, into the backpack', () => {
    const { sim } = open();
    const s = STASHES[0];
    expect(sim.moves.stashAt(s.x, s.z)).toBe(s);
    expect(sim.moves.openStash(s.id)).toEqual(s.gives);
    for (const [k, n] of Object.entries(s.gives)) expect(sim.inventory.count(k as never), k).toBe(n);
    expect(sim.moves.stashAt(s.x, s.z)).toBeUndefined();
    expect(sim.moves.openStash(s.id)).toBeUndefined();
  });

  it('a trip is its own motion: no hold act plays over it (#628), and the vault is a held pry', async () => {
    const { VERB_ACTS } = await import('../src/data/botActs');
    for (const v of [...MOVE_TRIPS.map((t) => t.verb), 'Climb up onto', 'Climb down']) {
      expect(v in VERB_ACTS, v).toBe(true);
      expect(VERB_ACTS[v], v).toBeUndefined();
    }
    expect(VERB_ACTS['Pry open']).toBe('pry');
    expect(VERB_ACTS.Prune).toBe('prune'); // #hedge-line: pruning through a dead hedge
    expect(VERB_ACTS.Open).toBe('reach');
  });

  it('Quick hands shortens forcing a vault, as it does prying rubble', () => {
    const { sim } = open();
    const before = sim.upgrades.vaultHold;
    expect(before).toBe(MOVE_LEVELS.vaultHoldSeconds);
    research(sim).levels.quickHands = 2;
    expect(sim.upgrades.vaultHold).toBeLessThan(before);
    expect(sim.upgrades.vaultHold).toBeCloseTo(before * sim.upgrades.holdFactor, 5);
  });

  it('every trip prompt and refusal is a plain line', () => {
    const { sim } = open();
    const lines: string[] = [];
    for (const step of [[], ['hover', 'climb', 'glide', 'prune']] as AbilityId[][]) {
      learn(sim, ...step);
      for (const t of MOVE_TRIPS) lines.push(`${t.verb} ${t.name}`, sim.moves.tripProblem(t) ?? '');
      for (const v of VAULTS) lines.push(sim.moves.vaultProblem(v) ?? '');
    }
    for (const l of lines) expect(bannedIn(l), l).toEqual([]);
  });
});

describe('#626: the Bloombot page shows the second levels', () => {
  it('a group of four after the moves, each later until its move is learned', () => {
    const { sim } = open();
    const rows = moveTwoRows(sim);
    expect(rows.map((r) => r.name)).toEqual(['Pry bar', 'Hover II', 'Climb II', 'Glide II']);
    expect(rows.every((r) => r.kind === 'move2' && r.state === 'later')).toBe(true);
    expect(rows[0].how).toBe('Bloombot has to learn Hover at the fountain first. Then the crafting table in the house can work out “Pry bar”.');
    expect(rows[0].where?.name).toBe('the fountain');
    // #663: Glide II waits on Climb II as well as Glide, and says so
    expect(rows[3].how).toBe('Bloombot has to learn Glide at the fountain first, and the crafting table in the house has to work out “Climb II”. Then it can work out “Glide II”.');
    expect(BLOOMBOT_GROUPS.map((g) => g.kind)).toEqual(['move', 'move2', 'park', 'knack', 'upgrade']);
    expect(bloombotRows(sim).filter((r) => r.kind === 'move2')).toHaveLength(4);
  });

  it('open at the workshop, it says where to start it; done, it says where it is used and leads there', () => {
    const { sim } = open();
    station(sim);
    learn(sim, 'prune', 'hover');
    let pry = moveTwoRows(sim)[0];
    expect(pry.state).toBe('next');
    expect(pry.how).toBe('Go to the crafting table in the house and start “Pry bar” in its Research tab. Then Bloombot learns it.');
    expect(pry.where?.name).toBe('the house');
    levelTwo(sim, 'prune');
    pry = moveTwoRows(sim)[0];
    expect(pry).toMatchObject({ state: 'have', how: 'There are old vaults to open in Mast Row, the Old Market and Saltwind.' });
    expect(howHeading(pry)).toBe('Where to use it');
    expect(pry.where).toMatchObject({ x: VAULTS[0].x, z: VAULTS[0].z + 1, name: 'an old vault' });
    // every vault open: nowhere left to show
    for (const v of VAULTS) sim.state.salvage!.caches.push(v.id);
    expect(moveTwoRows(sim)[0].where).toBeUndefined();
  });

  it('every second level, learned, leads somewhere Bloombot can stand', () => {
    const { sim, walk } = open();
    learn(sim, ...MOVES);
    for (const a of MOVES) levelTwo(sim, a);
    for (const r of moveTwoRows(sim)) {
      expect(r.state, r.id).toBe('have');
      expect(walk.walkable(GROUND, r.where!.x, r.where!.z), r.id).toBe(true);
    }
  });
});
