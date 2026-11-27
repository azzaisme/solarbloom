import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { decorChunkKeys, decorKey, decorOccupant } from '../src/core/Decor';
import { createInitialState, GROUND } from '../src/core/GameState';
import { CHUNK } from '../src/core/Hash';
import { decorAnchor, decorCells, DECOR_OPTION, DECOR_OPTIONS, decorSize, type DecorOption } from '../src/data/cozy';
import { DECOR_RECIPES } from '../src/data/crafting';
import { HOUSE, HOUSE_GROWTH, HOUSE_INSIDE, houseDoorInside, houseFurniture } from '../src/data/oldcity';
import { TUNING } from '../src/data/tuning';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';
import { fill, makeSim, PAD, rich } from './helpers';

/**
 * #849: a decoration may cover more than one square. These tests use two stand-in pieces of their own (a 2×3 flat
 * rug and a 2×1 solid table), so they test the footprint rules whatever the real set holds.
 */
const BIG: DecorOption = { id: 'test-bigrug', name: 'Test rug', icon: '🧺', blurb: 'A big flat test rug.', solid: false, unlock: { start: true }, size: [2, 3] };
const TABLE: DecorOption = { id: 'test-table', name: 'Test table', icon: '🪑', blurb: 'A long solid test table.', solid: true, unlock: { start: true }, size: [2, 1] };

beforeAll(() => {
  for (const o of [BIG, TABLE]) DECOR_OPTION[o.id] = o;
});
afterAll(() => {
  for (const o of [BIG, TABLE]) delete DECOR_OPTION[o.id];
});

function padScene() {
  const sim = makeSim();
  sim.state.salvage!.decorMade = DECOR_RECIPES.map((r) => r.id).sort();
  rich(sim);
  fill(sim, 0, 0, 7, 7, 'restored');
  for (const t of sim.grid.tilesOf(PAD)) if (t.ground === 'restored') t.bloom = TUNING.restore.maxBloom;
  const cozy = new Cozy(sim);
  cozy.groundOnly = false;
  return { sim, cozy };
}

/** The Shed's room (6 × 6), with plenty in the chests. */
function houseScene(seed = 7) {
  const sim = new Sim(createInitialState(seed));
  sim.areas.clear(PARK, true);
  const sv = sim.state.salvage!;
  sv.tier = HOUSE_GROWTH.opensAtStep;
  for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone'] as const) sv.store[m] = 500;
  sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 };
  sim.house.giveAll();
  return { sim, cozy: new Cozy(sim), id: HOUSE_INSIDE.layer };
}

const occupants = (sim: Sim, roofId: string, cells: { x: number; z: number }[]) => cells.map((c) => sim.grid.peek(roofId, c.x, c.z)?.occupantId);

describe('#849: a footprint turns with its piece', () => {
  it('a quarter turn swaps across and deep; one square when no size is set', () => {
    expect(decorSize(BIG.id, 0)).toEqual([2, 3]);
    expect(decorSize(BIG.id, 1)).toEqual([3, 2]);
    expect(decorSize(BIG.id, 2)).toEqual([2, 3]);
    expect(decorSize(BIG.id, 3)).toEqual([3, 2]);
    expect(decorSize('bench', 1)).toEqual([1, 1]);
    // every existing decoration stays one square, so older saves stand exactly where they did
    for (const o of DECOR_OPTIONS.filter((q) => !q.size)) expect(decorCells(o.id, 1, 4, 4)).toEqual([{ x: 4, z: 4 }]);
  });

  it('the aimed square is the middle one (or the one north-west of the middle on an even side)', () => {
    expect(decorAnchor(BIG.id, 0, 5, 5)).toEqual([5, 4]);
    expect(decorAnchor(BIG.id, 1, 5, 5)).toEqual([4, 5]);
    expect(decorAnchor('pot', 3, 5, 5)).toEqual([5, 5]);
    const [ax, az] = decorAnchor(BIG.id, 1, 5, 5);
    expect(decorCells(BIG.id, 1, ax, az)).toContainEqual({ x: 5, z: 5 });
    expect(decorCells(BIG.id, 1, ax, az)).toHaveLength(6);
  });

  it('on an even side the piece runs on away from Bloombot, never back over its square', () => {
    // the long table aimed at the square east of Bloombot runs on east; aimed west of it, it runs on west
    expect(decorCells(TABLE.id, 0, ...decorAnchor(TABLE.id, 0, 5, 5, { x: 4.5, z: 5.5 }))).toEqual([{ x: 5, z: 5 }, { x: 6, z: 5 }]);
    expect(decorCells(TABLE.id, 0, ...decorAnchor(TABLE.id, 0, 5, 5, { x: 6.5, z: 5.5 }))).toEqual([{ x: 4, z: 5 }, { x: 5, z: 5 }]);
    // turned to run north–south, the same
    expect(decorCells(TABLE.id, 1, ...decorAnchor(TABLE.id, 1, 5, 5, { x: 5.5, z: 4.5 }))).toEqual([{ x: 5, z: 5 }, { x: 5, z: 6 }]);
    expect(decorCells(TABLE.id, 1, ...decorAnchor(TABLE.id, 1, 5, 5, { x: 5.5, z: 6.5 }))).toEqual([{ x: 5, z: 4 }, { x: 5, z: 5 }]);
    // an odd side stays centred on the aimed square wherever Bloombot is
    expect(decorAnchor(BIG.id, 0, 5, 5, { x: 5.5, z: 7.5 })).toEqual([5, 4]);
  });
});

describe('#849: placing, turning, picking up and removing a big piece', () => {
  it('is saved once but stamps every square it covers, and any square finds the whole piece', () => {
    const { sim, cozy } = padScene();
    expect(cozy.placeDecor(BIG.id, 0, PAD, 2, 2)).toBeUndefined();
    expect(cozy.decorCount()).toBe(1);
    expect(Object.keys(sim.state.cozy!.decor!)).toEqual([decorKey(PAD, 2, 2)]);
    const cells = decorCells(BIG.id, 0, 2, 2);
    expect(occupants(sim, PAD, cells)).toEqual(cells.map(() => decorOccupant(decorKey(PAD, 2, 2))));
    for (const c of cells) expect(cozy.decorAt(PAD, c.x, c.z)?.key).toBe(decorKey(PAD, 2, 2));
    expect(cozy.decorAt(PAD, 4, 2)).toBeUndefined();
    // picked up from its far corner: the whole piece goes, every square free again
    const d = cozy.removeDecor(PAD, 3, 4)!;
    expect([d.kind, d.x, d.z, d.rot]).toEqual([BIG.id, 2, 2, 0]);
    expect(occupants(sim, PAD, cells).every((o) => o === undefined)).toBe(true);
    expect(sim.state.cozy!.decor).toBeUndefined();
  });

  it('turned a quarter, it lies the other way and covers those squares instead', () => {
    const { sim, cozy } = padScene();
    expect(cozy.placeDecor(BIG.id, 1, PAD, 2, 2)).toBeUndefined();
    const cells = decorCells(BIG.id, 1, 2, 2);
    expect(cells.map((c) => `${c.x},${c.z}`).sort()).toEqual(['2,2', '2,3', '3,2', '3,3', '4,2', '4,3']);
    for (const c of cells) expect(sim.grid.get(PAD, c.x, c.z)!.occupantId).toBe(decorOccupant(decorKey(PAD, 2, 2)));
    expect(sim.grid.get(PAD, 2, 4)!.occupantId).toBeUndefined();
    expect(cozy.decorAt(PAD, 4, 3)?.rot).toBe(1);
  });

  it('every square must be free: another decoration, a machine or the edge refuses it', () => {
    const { sim, cozy } = padScene();
    expect(cozy.placeDecor('pot', 0, PAD, 3, 4)).toBeUndefined();
    expect(cozy.canDecorate(BIG.id, PAD, 2, 2, 0)).toBeDefined(); // the pot sits on its far corner
    expect(cozy.placeDecor(BIG.id, 0, PAD, 2, 2)).toBeDefined();
    expect(cozy.decorCount()).toBe(1);
    // turned, it misses the pot and fits
    expect(cozy.canDecorate(BIG.id, PAD, 2, 2, 1)).toBeUndefined();
    // a machine under any square
    expect(sim.build.place('solar', PAD, 5, 0)).toBeDefined();
    expect(cozy.canDecorate(TABLE.id, PAD, 4, 0, 0)).toBeDefined();
    expect(cozy.canDecorate(TABLE.id, PAD, 4, 0, 1)).toBeUndefined(); // turned, it runs down from (4, 0) instead
    // half of it off the edge of the pad
    const [w] = [sim.grid.layer(PAD)!.width];
    expect(cozy.canDecorate(TABLE.id, PAD, w - 1, 6, 0)).toMatch(/doesn’t fit/);
    // two big pieces can't overlap either
    expect(cozy.placeDecor(BIG.id, 1, PAD, 0, 5)).toBeUndefined();
    expect(cozy.canDecorate(TABLE.id, PAD, 1, 6, 0)).toBeDefined();
  });

  it('a solid piece blocks walking on all its squares; a flat one can be walked over everywhere', () => {
    const { sim, cozy } = padScene();
    const w = new Walker(sim);
    expect(cozy.placeDecor(TABLE.id, 0, PAD, 2, 2)).toBeUndefined();
    expect(w.walkable(PAD, 2, 2)).toBe(false);
    expect(w.walkable(PAD, 3, 2)).toBe(false);
    expect(cozy.decorSolid(PAD, 3, 2)).toBe(true);
    expect(cozy.placeDecor(BIG.id, 0, PAD, 4, 4)).toBeUndefined();
    for (const c of decorCells(BIG.id, 0, 4, 4)) expect(w.walkable(PAD, c.x, c.z), `${c.x},${c.z}`).toBe(true);
    cozy.removeDecor(PAD, 3, 2);
    expect(w.walkable(PAD, 2, 2)).toBe(true);
    expect(w.walkable(PAD, 3, 2)).toBe(true);
  });
});

describe('#849: inside the house', () => {
  it('a big piece keeps off the door square and the furniture, and counts once toward the room’s limit', () => {
    const { sim, cozy, id } = houseScene();
    const [dx, dz] = houseDoorInside(1);
    // aimed so one of its squares lands on the door
    expect(cozy.canDecorate(TABLE.id, id, dx - 1, dz, 0)).toMatch(/door of the house clear/);
    const bed = houseFurniture(1).find((f) => f.id === 'bed')!;
    // every way the table could lie with one end on the bed is refused, and where the rest is floor it says why
    const room = sim.grid.layer(id)!.width;
    const tries: string[] = [];
    for (const rot of [0, 1])
      for (const c of decorCells(TABLE.id, rot, 0, 0)) {
        const ax = bed.x - c.x, az = bed.z - c.z;
        const why = cozy.canDecorate(TABLE.id, id, ax, az, rot);
        expect(why, `${ax},${az} turned ${rot}`).toBeDefined();
        if (decorCells(TABLE.id, rot, ax, az).every((q) => q.x >= 0 && q.z >= 0 && q.x < room && q.z < room)) tries.push(why!);
      }
    expect(tries.some((w) => /The bed stands here/.test(w))).toBe(true);
    // a free spot for the big rug, found the way the game aims
    let placed = false;
    for (const t of sim.grid.tilesOf(id)) {
      const [ax, az] = decorAnchor(BIG.id, 0, t.x, t.z);
      if (!cozy.canDecorate(BIG.id, id, ax, az, 0)) {
        expect(cozy.placeDecor(BIG.id, 0, id, ax, az)).toBeUndefined();
        placed = true;
        break;
      }
    }
    expect(placed).toBe(true);
    expect(cozy.insideCount()).toBe(1);
    // fill to the Shed's limit with single pots: the big piece is still just one of the twelve
    sim.state.salvage!.decorMade = ['pot'];
    for (const t of sim.grid.tilesOf(id)) if (cozy.insideCount() < HOUSE[0].decor) cozy.placeDecor('pot', 0, id, t.x, t.z);
    expect(cozy.insideCount()).toBe(HOUSE[0].decor);
    expect(cozy.decorations().filter((d) => d.roofId === id)).toHaveLength(HOUSE[0].decor);
  });

  it('when the house grows over a big piece, the whole piece moves to free floor', () => {
    const { sim, cozy, id } = houseScene();
    // the Cottage's radio stands where the Shed's floor is free: lay the big rug across it
    const radio2 = houseFurniture(2).find((f) => f.id === 'radio')!;
    let at: { x: number; z: number; rot: number } | undefined;
    for (const rot of [0, 1])
      for (const c of decorCells(BIG.id, rot, 0, 0)) {
        const ax = radio2.x - c.x, az = radio2.z - c.z;
        if (!at && !cozy.canDecorate(BIG.id, id, ax, az, rot)) at = { x: ax, z: az, rot };
      }
    expect(at).toBeDefined();
    expect(cozy.placeDecor(BIG.id, at!.rot, id, at!.x, at!.z)).toBeUndefined();
    sim.house.giveAll();
    cozy.clearCells(sim.house.sync());
    expect(cozy.insideCount()).toBe(1);
    const moved = cozy.decorations().find((d) => d.roofId === id)!;
    expect(moved.kind).toBe(BIG.id);
    const cells = decorCells(moved.kind, moved.rot, moved.x, moved.z);
    expect(cells.some((c) => c.x === radio2.x && c.z === radio2.z)).toBe(false);
    for (const c of cells) expect(sim.grid.get(id, c.x, c.z)!.occupantId).toBe(decorOccupant(moved.key));
  });
});

describe('#849: saved and loaded', () => {
  it('save → load → save is byte-identical and every square is stamped again, across a chunk edge too', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const sim = new Sim(createInitialState(77));
    sim.state.salvage!.decorMade = DECOR_RECIPES.map((r) => r.id).sort();
    sim.areas.clear(PARK, true);
    for (const id of sim.areas.info(PARK).neighbours) sim.areas.clear(id, true);
    const cozy = new Cozy(sim);
    // find a 3 × 3 block of cleared ground that straddles a chunk edge (the park and the places round it)
    const open = new Set<string>();
    for (const id of [PARK, ...sim.areas.info(PARK).neighbours]) for (const t of sim.areas.tiles(id)) open.add(`${t.x},${t.z}`);
    let spot: { x: number; z: number } | undefined;
    for (const k of open) {
      if (spot) break;
      const [x, z] = k.split(',').map(Number);
      if (((x + 1) % CHUNK + CHUNK) % CHUNK !== 0) continue; // the piece's west square is the last of its chunk
      const block = [0, 1, 2].flatMap((j) => [0, 1, 2].map((i) => (open.has(`${x + i},${z + j}`) ? sim.grid.peek(GROUND, x + i, z + j) : undefined)));
      if (block.some((b) => !b || b.blocked || b.occupantId || b.feature === 'water' || cozy.spotAt(GROUND, b.x, b.z))) continue;
      for (const t of block) {
        t!.ground = 'restored';
        t!.pollution = 0;
        t!.bloom = Math.max(1, t!.bloom);
        sim.grid.touch(t!);
      }
      if (!cozy.canDecorate(BIG.id, GROUND, x, z, 1)) spot = { x, z };
    }
    expect(spot).toBeDefined();
    // a 3 × 2 turn of the rug: its west column in one chunk, the rest in the next
    expect(cozy.placeDecor(BIG.id, 1, GROUND, spot!.x, spot!.z)).toBeUndefined();
    const key = decorKey(GROUND, spot!.x, spot!.z);
    expect(decorChunkKeys(key, `${BIG.id}@1`)).toHaveLength(2);
    for (const ck of decorChunkKeys(key, `${BIG.id}@1`)) expect(sim.grid.decorInChunk(ck)).toContain(key);
    const a = saver.serialize(sim.state);
    const copy = new Sim(saver.deserialize(a)!);
    expect(saver.serialize(copy.state)).toBe(a);
    const c2 = new Cozy(copy);
    expect(c2.decorCount()).toBe(1);
    const d = c2.decorations()[0];
    expect([d.kind, d.rot]).toEqual([BIG.id, 1]);
    for (const c of decorCells(d.kind, d.rot, d.x, d.z)) expect(copy.grid.get(GROUND, c.x, c.z)!.occupantId).toBe(decorOccupant(key));
    // removed, it leaves no index behind in either chunk
    c2.removeDecor(GROUND, spot!.x + 2, spot!.z + 1);
    for (const ck of decorChunkKeys(key, `${BIG.id}@1`)) expect(copy.grid.decorInChunk(ck)).not.toContain(key);
  });

  it('an older save of one-square decorations loads and saves unchanged', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const { sim, cozy } = padScene();
    expect(cozy.placeDecor('bench', 1, PAD, 5, 5)).toBeUndefined();
    expect(cozy.placeDecor('flowerbed', 0, PAD, 3, 3)).toBeUndefined();
    const a = saver.serialize(sim.state);
    const copy = new Sim(saver.deserialize(a)!);
    expect(saver.serialize(copy.state)).toBe(a);
    expect(copy.grid.get(PAD, 5, 5)!.occupantId).toBe(decorOccupant(decorKey(PAD, 5, 5)));
    expect(copy.grid.get(PAD, 6, 5)!.occupantId).toBeUndefined();
    expect(copy.grid.get(PAD, 5, 6)!.occupantId).toBeUndefined();
  });
});
