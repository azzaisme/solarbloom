import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { FRIENDSHIP } from '../src/data/keepers';
import { Sim } from '../src/gameplay/Sim';
import { tradeHtml } from '../src/ui/OldCityPanel';

/** The Old Market open, its hall awake (Tally trades), Tally settled, bloombot beside it. */
function marketAwake() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  const sv = sim.state.salvage!;
  sv.tier = 1;
  sv.abilities.push('pry');
  sim.areas.clear('park', true);
  sim.gates.open('g-oldMarket', true);
  sv.keepers.tally = { step: 'landmark' };
  sim.landmarks.reward('trade');
  sim.keepers.settle('tally');
  sim.bot = { roofId: GROUND, x: 19.5, z: 11.5 };
  return sim;
}

describe('E23.9.2: Tally trades, and takes a gift only when asked', () => {
  it('the trade panel offers a gift row only when bloombot carries something Tally loves, and only once a day', () => {
    const sim = marketAwake();
    expect(sim.landmarks.canTrade()).toBe(true);
    expect(tradeHtml(sim, undefined)).not.toContain('data-act="gift"');
    sim.inventory.add('glass', 5);
    const html = tradeHtml(sim, undefined);
    expect(html).toContain('data-act="gift"');
    expect(html).toContain('Give Tally 1 Glass');
    // the trade itself still spends glass, and nothing is given away by it
    expect(sim.landmarks.trade('glass', 'timber')).toBe(true);
    expect(sim.keepers.hearts('tally')).toBe(0);
    // the gift, asked for
    expect(sim.keepers.interact('tally')).toBe('gave');
    expect(sim.keepers.hearts('tally')).toBe(1);
    expect(tradeHtml(sim, undefined)).not.toContain('data-act="gift"');
    sim.state.time += FRIENDSHIP.giftEverySeconds;
    expect(tradeHtml(sim, undefined)).toContain('data-act="gift"');
  });

  it('chatting (Pulse on a settled Keeper) never hands anything over', () => {
    const sim = marketAwake();
    sim.inventory.add('glass', 5);
    const said: string[][] = [];
    sim.bus.on('keeper.said', (e) => said.push(e.lines));
    expect(sim.keepers.chat('tally')).toBe('talked');
    expect(sim.inventory.count('glass')).toBe(5);
    expect(sim.keepers.hearts('tally')).toBe(0);
    expect(said.length).toBe(1);
  });
});
