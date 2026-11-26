import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { HOUSE, HOUSE_GROWTH, HOUSE_INSIDE, houseDoorInside, houseFurniture } from '../src/data/oldcity';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { houseHtml } from '../src/ui/OldCityPanel';
import { bannedIn, WORDS } from '../src/ui/words';

/** A garden at the fountain's first step, with plenty of every material in its chests. */
function scene(seed = 7) {
  const sim = new Sim(createInitialState(seed));
  sim.areas.clear(PARK, true);
  const sv = sim.state.salvage!;
  sv.tier = HOUSE_GROWTH.opensAtStep;
  for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone'] as const) sv.store[m] = 500;
  sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 }; // at the house's door, in reach of the store
  return { sim, cozy: new Cozy(sim) };
}

const grow = (sim: Sim) => {
  const before = sim.house.level;
  sim.house.giveAll();
  return sim.house.level > before;
};

describe('#782: the house grows a level at a time', () => {
  it('starts as the ruined shed, with no inside, and can’t be mended before the fountain’s first step', () => {
    const sim = new Sim(createInitialState(7));
    expect(sim.house.level).toBe(0);
    expect(sim.house.hasInside()).toBe(false);
    expect(sim.house.open()).toBe(false);
    expect(sim.house.problem()).toMatch(/fountain flows again/);
    expect(sim.house.deliver('scrap', 5)).toBe(0);
    expect(sim.state.layers.some((l) => l.id === HOUSE_INSIDE.layer)).toBe(false); // an older save is left as it was
  });

  it('takes its delivery a bit at a time (saved), then grows through Shed, Cottage and House to the Home', () => {
    const { sim } = scene();
    const levels: number[] = [];
    sim.bus.on('house.level', ({ level }) => levels.push(level));
    // part of the Shed's delivery: saved, no growth yet
    expect(sim.house.deliver('scrap', 5)).toBe(5);
    expect(sim.house.given('scrap')).toBe(5);
    expect(sim.state.salvage!.houseDelivered).toEqual({ scrap: 5 });
    expect(sim.house.level).toBe(0);
    // never more than is wanted
    expect(sim.house.deliver('scrap', 999)).toBe(HOUSE[0].delivery.scrap! - 5);
    expect(sim.house.wants().find((w) => w.id === 'scrap')).toEqual({ id: 'scrap', given: HOUSE[0].delivery.scrap, need: HOUSE[0].delivery.scrap });
    for (let i = 0; i < 4; i++) expect(grow(sim)).toBe(true);
    expect(levels).toEqual([1, 2, 3, 4]);
    expect(sim.house.current()?.name).toBe('Home');
    expect(sim.house.next()).toBeUndefined();
    expect(sim.house.problem()).toMatch(/home now/);
    expect(sim.state.salvage!.houseDelivered).toBeUndefined();
    // what it cost came out of the chests
    expect(sim.state.salvage!.store.timber).toBe(500 - HOUSE.reduce((a, h) => a + (h.delivery.timber ?? 0), 0));
  });

  it('its inside is a room of its level’s size, furnished, and it survives save → load', () => {
    const { sim } = scene();
    grow(sim);
    const l = sim.grid.layer(HOUSE_INSIDE.layer)!;
    expect(l.interior).toBe(true);
    expect([l.width, l.depth]).toEqual([HOUSE[0].room, HOUSE[0].room]);
    expect(sim.grid.rooftops.some((r) => r.id === l.id)).toBe(false); // not a rooftop: no drones, butterflies or slabs
    const floor = sim.grid.tilesOf(l.id);
    expect(floor.length).toBe(HOUSE[0].room ** 2);
    expect(floor.every((t) => t.ground === 'restored' && t.pollution === 0)).toBe(true);
    const bed = houseFurniture(1).find((f) => f.id === 'bed')!;
    expect(sim.grid.get(l.id, bed.x, bed.z)!.blocked).toBe(true);
    expect(houseFurniture(1).map((f) => f.id).sort()).toEqual(['bed', 'chest', 'radio']);
    // the room grows with the house
    grow(sim);
    expect(sim.grid.layer(l.id)!.width).toBe(HOUSE[1].room);
    expect(sim.grid.tilesOf(l.id).length).toBe(HOUSE[1].room ** 2);
    expect(sim.house.furniture().map((f) => f.id).sort()).toEqual(['bed', 'chest', 'desk', 'radio', 'shelf']);
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const again = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(again.house.level).toBe(2);
    expect(again.grid.layer(l.id)?.width).toBe(HOUSE[1].room);
    const shelf = again.house.furniture().find((f) => f.id === 'shelf')!;
    expect(again.grid.get(l.id, shelf.x, shelf.z)!.blocked).toBe(true);
  });

  it('nothing grows inside and no machine stands there; the chest inside reaches your other chests', () => {
    const { sim } = scene();
    grow(sim);
    const id = HOUSE_INSIDE.layer;
    const t = sim.grid.get(id, 2, 3)!;
    expect(sim.restoration.checkPulse(t).ok).toBe(false);
    expect(sim.build.place('solar', id, 2, 3)).toBeUndefined();
    sim.bot = { roofId: id, x: 2.5, z: 3.5 };
    expect(sim.inventory.nearStore()).toBe(true);
    expect(sim.charge.atHome()).toBe(true); // inside is home: standing still there rests Bloombot, as by the fountain
  });
});

describe('#782: decorating inside the house', () => {
  it('decorations go on the floor, never on the door or the furniture, up to the level’s limit', () => {
    const { sim, cozy } = scene();
    grow(sim);
    sim.state.salvage!.decorMade = ['pot', 'flowerbed'];
    const id = HOUSE_INSIDE.layer;
    const [dx, dz] = houseDoorInside(1);
    expect(cozy.canDecorate('pot', id, dx, dz)).toMatch(/door of the house clear/);
    const bed = houseFurniture(1).find((f) => f.id === 'bed')!;
    expect(cozy.canDecorate('pot', id, bed.x, bed.z)).toMatch(/The bed stands here/);
    expect(cozy.placeDecor('pot', 0, id, 2, 2)).toBeUndefined();
    expect(cozy.insideCount()).toBe(1);
    // fill the Shed to its limit, then one more is refused in plain words
    const free = sim.grid.tilesOf(id).filter((t) => !t.blocked && !t.occupantId && !(t.x === dx && t.z === dz));
    for (const t of free) if (cozy.insideCount() < HOUSE[0].decor) cozy.placeDecor('flowerbed', 0, id, t.x, t.z);
    expect(cozy.insideCount()).toBe(HOUSE[0].decor);
    const left = sim.grid.tilesOf(id).find((t) => !t.blocked && !t.occupantId && !(t.x === dx && t.z === dz))!;
    expect(cozy.canDecorate('pot', id, left.x, left.z)).toMatch(/holds 12 decorations/);
    // outside, decorations are unaffected by the room's limit
    expect(cozy.canDecorate('pot', 'g', 0, 0) ?? '').not.toMatch(/holds/);
  });

  it('when the house grows, a decoration where new furniture stands moves to free floor (nothing is lost)', () => {
    const { sim, cozy } = scene();
    grow(sim);
    sim.state.salvage!.decorMade = ['pot'];
    const id = HOUSE_INSIDE.layer;
    // the Cottage's radio stands at (3, 0): put a pot there while it is still the Shed
    const radio2 = houseFurniture(2).find((f) => f.id === 'radio')!;
    expect(houseFurniture(1).find((f) => f.id === 'radio')!.x).not.toBe(radio2.x);
    expect(cozy.placeDecor('pot', 0, id, radio2.x, radio2.z)).toBeUndefined();
    grow(sim);
    cozy.clearCells(sim.house.sync());
    expect(cozy.decorAt(id, radio2.x, radio2.z)).toBeUndefined();
    expect(cozy.insideCount()).toBe(1);
  });
});

describe('#782: the house’s words', () => {
  it('the panel shows what the next level needs as have-of-need and what it brings', () => {
    const { sim } = scene();
    sim.house.deliver('scrap', 5);
    const html = houseHtml(sim);
    expect(html).toMatch(/5 of 15/);
    expect(html).toMatch(/Timber/);
    expect(html).toMatch(/A bed/);
    expect(html).toMatch(/Room inside for 12 decorations/);
    expect(html).not.toMatch(/Workbench/);
    expect(bannedIn(html)).toEqual([]);
  });

  it('the toasts are plain, name the key, and list what the level brings', () => {
    const t = WORDS.house.grew('Shed', WORDS.house.gives(HOUSE[0].gives), HOUSE[0].decor, true);
    expect(t).toMatch(/\{interact\}/);
    expect(t).toMatch(/a bed, a storage chest, a radio by the window/i);
    for (const h of HOUSE) expect(bannedIn(WORDS.house.grew(h.name, WORDS.house.gives(h.gives), h.decor, h.level === 1))).toEqual([]);
    expect(bannedIn(WORDS.house.home)).toEqual([]);
  });
});
