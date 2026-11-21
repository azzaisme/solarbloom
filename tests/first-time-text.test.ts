import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/GameState';
import { KEEPERS, REGIONS, gateThing } from '../src/data/oldcity';
import { TIERS, fountainStepNews } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';
import { bannedIn } from '../src/ui/words';

/**
 * #610: the owner's rule for every line: the player can see the screen but has no idea what they're doing. So a line
 * says what to do next and why, in words a first-time player knows, and points at what's visible rather than a name
 * they haven't learned.
 */
describe('#610: lines for a first-time player', () => {
  // a place's name is only learned once the player is there; a line that sends them somewhere can't lean on it
  const places = REGIONS.map((r) => r.name).filter((n) => n.length > 3);

  it('a sleeping Keeper says how to stir it, and a stirred one says exactly what wakes it', () => {
    for (const k of KEEPERS) {
      expect(k.say.asleep.join(' '), k.id).toMatch(/Give it a pulse to stir it\.$/);
      expect(k.say.stirred.join(' '), k.id).toMatch(/Bring me 5 of any one thing, like Scrap or Seeds, and talk to me again\.$/);
      for (const line of [...k.say.asleep, ...k.say.stirred]) expect(line, k.id).not.toContain(k.name); // not met yet
    }
  });

  it("a Keeper's asks point at what can be seen, never a place's name", () => {
    for (const k of KEEPERS)
      for (const line of [...k.say.request1, ...k.say.request2, ...k.say.landmark, ...k.say.settled, ...k.say.stirred]) {
        for (const p of places) expect(line, `${k.id}: ${line}`).not.toContain(p);
        expect(line, k.id).not.toMatch(/\b(Restore|restore|tile|Five of anything)\b/);
        expect(bannedIn(line), line).toEqual([]);
      }
  });

  it('every landmark ask says where to bring things, and that it wakes the landmark', () => {
    for (const k of KEEPERS) expect(k.say.landmark.join(' '), k.id).toMatch(/Bring .+ to (the|its) .+ to wake it\.$/);
  });

  it('the card names a sleeping Keeper as a robot until it has woken, and says what to do', () => {
    const sim = new Sim(createInitialState(7));
    const id = KEEPERS[0].id;
    expect(sim.keepers.hint(id)).toBe('A robot is asleep here. Pulse it to stir it.');
    sim.state.salvage!.keepers[id] = { step: 'asleep', pulsed: true };
    expect(sim.keepers.hint(id)).toBe('A robot is stirring. Bring it 5 of any one thing, like Scrap or Seeds, and talk to it.');
    sim.state.salvage!.keepers[id] = { step: 'request1' };
    expect(sim.keepers.hint(id)).toBe(`Bring ${KEEPERS[0].name} 8 Seeds.`);
  });

  it('a fountain step toast says what is new, in sentences (the move it teaches has its own toast)', () => {
    expect(fountainStepNews(TIERS[1])).toBe('New to build: Pollinator Garden and Drone Hub. Your backpack holds 60 of each thing.');
    expect(fountainStepNews(TIERS[2])).toMatch(/^New to build: .+\. Your backpack holds 80 of each thing\.$/);
    expect(fountainStepNews(TIERS[4])).toMatch(/^The whole city is in flower\./);
    for (const t of TIERS) expect(fountainStepNews(t)).not.toMatch(/ · |Stacks of/);
  });

  it('a way out is named by what blocks it, not by where it leads', () => {
    expect(gateThing(REGIONS.find((r) => r.gate.kind === 'barricade')!.gate)).toBe('the rubble');
    for (const r of REGIONS) expect(gateThing(r.gate), r.id).toMatch(/^the /);
    for (const r of REGIONS) for (const p of places) expect(r.gate.how, r.id).not.toContain(p);
  });
});
