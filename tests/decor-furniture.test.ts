import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { decorAnchor, decorCells, DECOR_OPTION, decorSet, decorSize } from '../src/data/cozy';
import { DECOR_RECIPES } from '../src/data/crafting';
import { HOUSE_GROWTH, HOUSE_INSIDE } from '../src/data/oldcity';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';
import { drawDecor } from '../src/rendering/DecorArt';
import { buildItems } from '../src/ui/BuildCatalog';
import { EMOJI_ICONS } from '../src/ui/Icons';
import { bannedIn } from '../src/ui/words';

/** #850: the first furniture made for a room. */
const FURNITURE = ['armchair', 'stool', 'diningtable', 'sidetable', 'bookshelf', 'coatstand'];

function house(level = 2) {
  const sim = new Sim(createInitialState(7));
  sim.areas.clear(PARK, true);
  const sv = sim.state.salvage!;
  sv.tier = HOUSE_GROWTH.opensAtStep;
  for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone'] as const) sv.store[m] = 500;
  sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 };
  for (let i = 0; i < level; i++) sim.house.giveAll();
  sv.decorMade = DECOR_RECIPES.map((r) => r.id).sort();
  return { sim, cozy: new Cozy(sim), id: HOUSE_INSIDE.layer };
}

const base = (e: string) => e.replace(/️/g, '');

describe('#850: seating, tables and shelves', () => {
  it('six pieces, each made for a room, with a name, an icon and one plain line for the tray', () => {
    for (const id of FURNITURE) {
      const o = DECOR_OPTION[id];
      expect(o, id).toBeDefined();
      expect(decorSet(o)).toBe('indoor');
      expect(o.name.length).toBeGreaterThan(2);
      expect(EMOJI_ICONS[base(o.icon)], `${id} icon ${o.icon}`).toBeDefined();
      expect(o.blurb).toMatch(/^[A-Z].*\.$/);
      expect(o.blurb.split(/\. /).length, `${id}: one or two short sentences`).toBeLessThanOrEqual(2);
      expect(bannedIn(`${o.name} ${o.blurb}`), id).toEqual([]);
      expect(o.solid, id).toBe(true);
    }
    // icons are their own: no two of the six share one
    expect(new Set(FURNITURE.map((id) => EMOJI_ICONS[base(DECOR_OPTION[id].icon)])).size).toBe(FURNITURE.length);
    // the dining table takes two squares; the rest one
    expect(DECOR_OPTION.diningtable.size).toEqual([2, 1]);
    for (const id of FURNITURE.filter((x) => x !== 'diningtable')) expect(decorSize(id, 0)).toEqual([1, 1]);
  });

  it('drawn near and far, in every turn, inside a small budget', () => {
    for (const id of FURNITURE)
      for (const rot of [0, 1, 2, 3])
        for (const far of [false, true]) {
          let tris = 0;
          let prims = 0;
          drawDecor({ add: () => ((tris += 80), prims++), foliage: (g) => (tris += g.tris), model: () => false, lod: far ? 0 : 1 }, id, 4, 0, 7, rot, far, 11);
          expect(prims, `${id} ${far ? 'far' : 'near'}`).toBeGreaterThan(0);
          expect(tris, `${id} ${far ? 'far' : 'near'}`).toBeLessThan(far ? 400 : 2500);
          if (far) expect(prims, `${id} far is lighter`).toBeLessThanOrEqual(4);
        }
  });

  it('the dining table’s top stays over its two squares, whichever way it is turned', () => {
    for (const rot of [0, 1, 2, 3]) {
      const [w, d] = decorSize('diningtable', rot);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      drawDecor(
        {
          add: (_t, _c, p, s) => {
            const sz = typeof s === 'number' ? [s, s, s] : s;
            minX = Math.min(minX, p[0] - sz[0] / 2);
            maxX = Math.max(maxX, p[0] + sz[0] / 2);
            minZ = Math.min(minZ, p[2] - sz[2] / 2);
            maxZ = Math.max(maxZ, p[2] + sz[2] / 2);
          },
          foliage: () => {},
          model: () => false,
          lod: 1,
        },
        'diningtable', 0, 0, 0, rot, false,
      );
      expect(maxX - minX, `rot ${rot} across`).toBeGreaterThan(w - 0.3);
      expect(maxX - minX, `rot ${rot} across`).toBeLessThanOrEqual(w);
      expect(maxZ - minZ, `rot ${rot} deep`).toBeLessThanOrEqual(d);
    }
  });

  it('each can be placed in the house, turned every way, picked up and removed', () => {
    const { sim, cozy, id } = house();
    const w = new Walker(sim);
    for (const kind of FURNITURE)
      for (const rot of [0, 1, 2, 3]) {
        const spot = sim.grid.tilesOf(id).find((t) => {
          const [ax, az] = decorAnchor(kind, rot, t.x, t.z);
          return !cozy.canDecorate(kind, id, ax, az, rot);
        })!;
        expect(spot, `${kind} turned ${rot}`).toBeDefined();
        const [ax, az] = decorAnchor(kind, rot, spot.x, spot.z);
        expect(cozy.placeDecor(kind, rot, id, ax, az)).toBeUndefined();
        const cells = decorCells(kind, rot, ax, az);
        for (const c of cells) expect(w.walkable(id, c.x, c.z), `${kind} blocks ${c.x},${c.z}`).toBe(false);
        const last = cells[cells.length - 1];
        const d = cozy.removeDecor(id, last.x, last.z)!;
        expect([d.kind, d.rot]).toEqual([kind, rot]);
        expect(cozy.insideCount()).toBe(0);
      }
  });

  it('a furnished room saves and loads as it was', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const { sim, cozy, id } = house();
    let rot = 0;
    for (const kind of FURNITURE) {
      const spot = sim.grid.tilesOf(id).find((t) => !cozy.canDecorate(kind, id, ...decorAnchor(kind, rot, t.x, t.z), rot))!;
      expect(cozy.placeDecor(kind, rot, id, ...decorAnchor(kind, rot, spot.x, spot.z))).toBeUndefined();
      rot = (rot + 1) & 3;
    }
    const json = saver.serialize(sim.state);
    const copy = new Sim(saver.deserialize(json)!);
    expect(saver.serialize(copy.state)).toBe(json);
    expect(new Cozy(copy).decorations().map((d) => `${d.kind}@${d.rot}`)).toEqual(cozy.decorations().map((d) => `${d.kind}@${d.rot}`));
  });

  it('inside the house the tray leads with them', () => {
    const { sim } = house();
    const dec = buildItems(sim, true).filter((i) => i.tab === 'decorations');
    expect(dec.slice(0, FURNITURE.length).map((i) => i.tool)).toEqual(expect.arrayContaining(FURNITURE.map((id) => `decor:${id}`)));
  });
});
