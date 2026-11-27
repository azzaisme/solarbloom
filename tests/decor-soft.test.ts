import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { decorAnchor, decorCells, DECOR_OPTION, DECOR_OPTIONS, decorSet, decorSize } from '../src/data/cozy';
import { DECOR_RECIPES } from '../src/data/crafting';
import { LIGHT, LIGHTS, ROOM_LIGHTS } from '../src/data/lights';
import { HOUSE, HOUSE_GROWTH, HOUSE_INSIDE } from '../src/data/oldcity';
import { POWER } from '../src/data/power';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';
import { drawDecor } from '../src/rendering/DecorArt';
import { buildHouseplant, houseplantGeo } from '../src/rendering/TreeGen';
import { EMOJI_ICONS } from '../src/ui/Icons';
import { bannedIn } from '../src/ui/words';

SaveService.clock = () => 0;

/** #851: the soft furnishings. */
const RUGS = ['roundrug', 'hallrunner', 'bigrug', 'patternrug'];
const LAMPS = ['floorlamp', 'tablelamp'];
const SOFT = [...RUGS, ...LAMPS, 'houseplant', 'pottedtree', 'cushions', 'clock'];
const FURNITURE = ['armchair', 'stool', 'diningtable', 'sidetable', 'bookshelf', 'coatstand'];

function house(level = 4) {
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

/** A free spot for a piece in the room, aimed the way the game aims (its middle square). */
function spot(sim: Sim, cozy: Cozy, id: string, kind: string, rot = 0): [number, number] {
  for (const t of sim.grid.tilesOf(id)) {
    const at = decorAnchor(kind, rot, t.x, t.z);
    if (!cozy.canDecorate(kind, id, at[0], at[1], rot)) return at;
  }
  throw new Error(`no room for ${kind}`);
}

const base = (e: string) => e.replace(/️/g, '');

describe('#851: rugs, lamps, houseplants, cushions and a clock', () => {
  it('ten pieces made for a room, each with a name, its own icon and one plain line', () => {
    for (const id of SOFT) {
      const o = DECOR_OPTION[id];
      expect(o, id).toBeDefined();
      expect(decorSet(o), id).toBe('indoor');
      expect(EMOJI_ICONS[base(o.icon)], `${id} icon`).toBeDefined();
      expect(o.blurb).toMatch(/^[A-Z].*\.$/);
      expect(bannedIn(`${o.name} ${o.blurb}`), id).toEqual([]);
    }
    expect(new Set([...SOFT, ...FURNITURE].map((id) => EMOJI_ICONS[base(DECOR_OPTION[id].icon)])).size).toBe(SOFT.length + FURNITURE.length);
  });

  it('with the furniture, the house offers at least 12 decorations made for a room', () => {
    const indoor = DECOR_OPTIONS.filter((o) => decorSet(o) === 'indoor');
    expect(indoor.length).toBeGreaterThanOrEqual(12);
    expect(indoor.map((o) => o.id)).toEqual(expect.arrayContaining([...FURNITURE, ...SOFT]));
  });

  it('no two decorations share a name (the outdoor table lamp is the Patio lamp now)', () => {
    const names = DECOR_OPTIONS.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
    expect(DECOR_OPTION.tablelight.name).toBe('Patio lamp');
    expect(DECOR_OPTION.tablelamp.name).toBe('Table lamp');
  });

  it('rugs come in a few sizes and colours', () => {
    expect(RUGS.map((id) => decorSize(id, 0))).toEqual([[1, 1], [1, 3], [2, 3], [2, 2]]);
    const colours = new Set<string>();
    for (const id of RUGS)
      drawDecor({ add: (_t, c) => void colours.add(c), foliage: () => {}, model: () => false, lod: 1 }, id, 0, 0, 0, 0, false);
    expect(colours.size).toBeGreaterThanOrEqual(6);
  });

  it('drawn near and far, in every turn, inside a small budget (houseplants included)', () => {
    for (const id of SOFT)
      for (const rot of [0, 1, 2, 3])
        for (const far of [false, true])
          for (const lod of far ? ([0] as const) : ([1, 2] as const)) {
            let tris = 0;
            let prims = 0;
            drawDecor({ add: () => ((tris += 80), prims++), foliage: (g) => (tris += g.tris), model: () => false, lod }, id, 4, 0, 7, rot, far, 37);
            expect(prims, `${id} ${far ? 'far' : 'near'}`).toBeGreaterThan(0);
            expect(tris, `${id} ${far ? 'far' : `near lod ${lod}`}`).toBeLessThan(far ? 400 : 2500);
          }
  });
});

describe('#851: rugs lie under Bloombot’s feet', () => {
  it('every rug is flat: placed in the Home, Bloombot can walk on every square of it and stand in its middle', () => {
    const { sim, cozy, id } = house();
    const w = new Walker(sim);
    for (const kind of RUGS) {
      expect(DECOR_OPTION[kind].solid, kind).toBe(false);
      for (const rot of [0, 1]) {
        const [x, z] = spot(sim, cozy, id, kind, rot);
        expect(cozy.placeDecor(kind, rot, id, x, z)).toBeUndefined();
        const cells = decorCells(kind, rot, x, z);
        for (const c of cells) expect(w.walkable(id, c.x, c.z), `${kind} ${c.x},${c.z}`).toBe(true);
        const [cw, cd] = decorSize(kind, rot);
        expect(w.fits(id, x + cw / 2, z + cd / 2), `${kind}: Bloombot stands on it`).toBe(true);
        cozy.removeDecor(id, cells[cells.length - 1].x, cells[cells.length - 1].z);
      }
    }
    expect(cozy.insideCount()).toBe(0);
  });
});

describe('#851: lamps glow at night', () => {
  it('the two lamps are lights (no power line), kept out of the outdoor list', () => {
    for (const id of LAMPS) {
      expect(LIGHT[id]?.power, id).toBe('glow');
      expect(LIGHTS.some((l) => l.id === id), id).toBe(false);
      expect(ROOM_LIGHTS.some((l) => l.id === id), id).toBe(true);
      expect(DECOR_RECIPES.some((r) => r.id === id && JSON.stringify(r.cost) === '{}'), `${id} has no empty recipe from LIGHTS`).toBe(false);
    }
  });

  it('placed in the house, they are out by day and glow fully once night falls', () => {
    const { sim, cozy, id } = house();
    const st = sim.state;
    const setF = (v: number) => ((st.clock ??= { offset: 0 }).offset = v * POWER.daySeconds - st.time);
    sim.weather.forceForTest('sunny', 1e9);
    const keys: string[] = [];
    for (const kind of LAMPS) {
      const [x, z] = spot(sim, cozy, id, kind);
      expect(cozy.placeDecor(kind, 0, id, x, z)).toBeUndefined();
      keys.push(`${id}|${x}|${z}`);
    }
    const glow = (k: string) => sim.lights.all().find((l) => l.key === k)?.glow ?? -1;
    const run = (n: number, f: number) => {
      for (let i = 0; i < n; i++) {
        st.time += 1;
        setF(f);
        sim.lights.tick(1);
        sim.power.tick(1);
      }
    };
    run(30, 0.4); // afternoon
    for (const k of keys) expect(glow(k), k).toBe(0);
    run(120, 0.85); // the middle of the night
    for (const [i, k] of keys.entries()) expect(glow(k), k).toBeCloseTo(LIGHT[LAMPS[i]].brightness, 2);
    // they stand on the room's floor (the renderer puts each glow there)
    for (const k of keys) expect(sim.lights.all().find((l) => l.key === k)?.roofId).toBe(id);
  });
});

describe('#851: houseplants are grown by the tree and shrub code, and no two look alike', () => {
  const sig = (g: { pos: Float32Array; col: Uint8Array }) => {
    let h = 0;
    for (let i = 0; i < g.pos.length; i += 7) h = (h * 31 + Math.round(g.pos[i] * 1e4)) | 0;
    for (let i = 0; i < g.col.length; i += 13) h = (h * 31 + g.col[i]) | 0;
    return `${g.pos.length}:${h}`;
  };

  it('every square of the Home’s room grows a different houseplant and a different little tree', () => {
    const room = HOUSE[HOUSE.length - 1].room;
    for (const tree of [false, true]) {
      const seen = new Map<string, string>();
      for (let x = 0; x < room; x++)
        for (let z = 0; z < room; z++) {
          const seed = x * 31 + z; // as the renderers seed a placed piece
          const s = sig(houseplantGeo(seed, 2, tree));
          expect(seen.get(s), `${tree ? 'tree' : 'plant'} at ${x},${z} matches ${seen.get(s)}`).toBeUndefined();
          seen.set(s, `${x},${z}`);
        }
    }
  });

  it('a plant keeps its look (same seed, same plant), and it is mostly leaves on a tiny stem', () => {
    expect(sig(buildHouseplant(44, 2))).toBe(sig(buildHouseplant(44, 2)));
    for (const tree of [false, true]) {
      const g = buildHouseplant(9, 2, tree);
      expect(g.tris).toBeGreaterThan(200);
      expect(g.height, tree ? 'a little tree' : 'a plant').toBeLessThan(tree ? 0.8 : 0.5);
    }
  });

  it('in the house each placed houseplant is drawn from its own square', () => {
    const seeds = new Set<number>();
    for (const [x, z] of [[1, 1], [1, 2], [2, 1], [5, 9]]) {
      drawDecor({ add: () => {}, foliage: (g) => void seeds.add(Number(sig(g).split(':')[1])), model: () => false, lod: 2 }, 'houseplant', x + 0.5, 0, z + 0.5, 0, false, x * 31 + z);
    }
    expect(seeds.size).toBe(4);
  });
});

describe('#851: a furnished room saves and loads', () => {
  it('rugs, lamps, plants, cushions and the clock round-trip byte-identical', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const { sim, cozy, id } = house();
    for (const [i, kind] of SOFT.entries()) {
      const rot = i & 3;
      const [x, z] = spot(sim, cozy, id, kind, rot);
      expect(cozy.placeDecor(kind, rot, id, x, z), kind).toBeUndefined();
    }
    const json = saver.serialize(sim.state);
    const copy = new Sim(saver.deserialize(json)!);
    expect(saver.serialize(copy.state)).toBe(json);
    expect(new Cozy(copy).insideCount()).toBe(SOFT.length);
  });
});
