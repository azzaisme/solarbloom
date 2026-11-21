import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/GameState';
import { RESEARCH_UPGRADES } from '../src/data/research';
import { Sim } from '../src/gameplay/Sim';
import { bloombotRows, moveRows, bloombotUpgradeRows, pips, stateWords } from '../src/ui/BloombotPage';
import { TABS } from '../src/ui/BackpackModel';
import { bannedIn, WORDS } from '../src/ui/words';

/**
 * #620 (E24): Bloombot's upgrade path, shown. Players didn't know Bloombot could grow: its page in the backpack
 * gathers the moves the fountain teaches and the workshop's five upgrades, each with where it stands and how to get
 * the next. Nothing here changes a cost or a number: the page only reads.
 */
const fresh = () => new Sim(createInitialState(7));
const research = (sim: Sim) => (sim.state.salvage!.research ??= { analysed: [], done: [], running: [], levels: {} });

describe('#620: Bloombot\'s page', () => {
  it('is a tab in the backpack, right after Items', () => {
    expect(TABS.map((t) => t.id).slice(0, 2)).toEqual(['items', 'bloombot']);
  });

  it('a new game: four moves, Pry next, every upgrade at level 0', () => {
    const sim = fresh();
    const moves = moveRows(sim);
    expect(moves.map((m) => `${m.name} ${m.state}`)).toEqual(['Pry next', 'Hover later', 'Climb later', 'Glide later']);
    expect(moves[0].how).toBe('Bring the fountain what it asks for and it teaches this. The goal card at the top left lists what that is.');
    expect(moves[1].how).toBe("The fountain teaches this once you've brought it what it asks for twice more.");
    expect(moves[0].where?.name).toBe('the fountain');
    const ups = bloombotUpgradeRows(sim);
    expect(ups.map((u) => u.name)).toEqual(['Bigger charge', 'Gentler on charge', 'Longer stride', 'Wider pulse', 'Roomier backpack']);
    expect(ups[0].does).toBe('Bloombot holds more charge, so it can keep going longer before it rests.');
    expect(ups[4].does).toBe('Bloombot can carry 20 more of each thing.');
    expect(ups.every((u) => u.level === 0 && u.max === 5 && u.state === 'later')).toBe(true);
    // before the first Keeper wakes, the workshop doesn't research yet: it says so
    expect(ups[0].how).toBe('The workshop table in the house can work out how to make this. It starts once you wake another robot out in the city.');
    expect(ups[0].where?.name).toBe('the house');
  });

  it('as Bloombot learns: learned moves say so, and the next is the next', () => {
    const sim = fresh();
    sim.state.salvage!.abilities.push('pry');
    const moves = moveRows(sim);
    expect(moves.map((m) => m.state)).toEqual(['have', 'next', 'later', 'later']);
    expect(moves[0]).toMatchObject({ how: 'Learned.', where: undefined });
    sim.state.salvage!.tier = 1;
    expect(moveRows(sim)[1].how).toBe('Bring the fountain what it asks for and it teaches this. The goal card at the top left lists what that is.');
  });

  it('an opened upgrade says what its next level takes, and where; at the top it says so', () => {
    const sim = fresh();
    research(sim).done.push('rb-cells');
    research(sim).levels.chargeCells = 1;
    // the research station is there once a Keeper wakes
    sim.state.salvage!.keepers['k'] = { step: 'request1' } as never;
    const cells = bloombotUpgradeRows(sim).find((u) => u.id === 'chargeCells')!;
    expect(cells).toMatchObject({ state: 'next', level: 1, max: 5 });
    expect(cells.how).toBe('Go to the workshop table in the house and make level 2 in its Upgrade tab. It takes 3 Battery cell and 4 Gears.');
    research(sim).levels.chargeCells = 5; // #623: five levels
    const top = bloombotUpgradeRows(sim).find((u) => u.id === 'chargeCells')!;
    expect(top).toMatchObject({ state: 'have', how: 'As far as it goes.', where: undefined });
    expect(stateWords(top)).toBe('Top level');
  });

  it('reads only: the page changes no cost or number (#623: the Bloombot upgrades go to five levels)', () => {
    const bloom = RESEARCH_UPGRADES.filter((u) => u.branch === 'bloombot');
    expect(bloom.map((u) => [u.id, u.levels.length, u.per])).toEqual([
      ['chargeCells', 5, 1],
      ['chargeEfficiency', 5, 1],
      ['sprint', 5, 0.1],
      ['pulseRadius', 5, 1],
      ['backpack', 5, 20],
    ]);
  });

  it('pips: one filled per level', () => {
    expect(pips(0, 3)).toBe('○○○');
    expect(pips(2, 3)).toBe('●●○');
    expect(pips(3, 3)).toBe('●●●');
  });

  it('every line is plain: no banned words, full stops, short', () => {
    const sim = fresh();
    research(sim).done.push('rb-cells', 'rb-backpack');
    for (const r of bloombotRows(sim)) {
      for (const line of [r.does, r.how]) {
        expect(bannedIn(line), line).toEqual([]);
        expect(line, line).toMatch(/\.$/);
        expect(line.length, line).toBeLessThan(150);
        expect(line, line).not.toMatch(/—/);
      }
    }
    for (const t of [...Object.values(WORDS.bloombot.learned), WORDS.bloombot.upgraded('Bigger charge', 1, 3)]) expect(bannedIn(t), t).toEqual([]);
    expect(WORDS.bloombot.learned.hover).toBe('Bloombot can hover over deep water now');
    expect(WORDS.bloombot.upgraded('Bigger charge', 1, 3)).toBe('Bloombot got better: Bigger charge, level 1 of 3');
  });

  it('the goal card names the move each fountain step teaches, as the page calls it', async () => {
    const { objectiveSentence } = await import('../src/ui/ObjectiveCard');
    const { TIERS } = await import('../src/data/salvage');
    const sim = fresh();
    const names = moveRows(sim).map((m) => m.name);
    expect(objectiveSentence(sim)?.why).toBe('Bloombot learns to pry open rubble');
    for (const [i, t] of TIERS.filter((x) => x.ability).entries()) expect(WORDS.objective.why[t.ability!]).toContain(`learns to ${names[i].toLowerCase()} `);
  });

  it('each row names the part of Bloombot it changes (E25\'s turntable lights it)', () => {
    const parts = Object.fromEntries(bloombotRows(fresh()).map((r) => [r.id, r.part]));
    expect(parts).toMatchObject({ pry: 'leaves', glide: 'leaves', chargeCells: 'cells', backpack: 'pockets' });
  });
});
