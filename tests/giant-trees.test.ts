// Giant trees and trees that grow over time (owner, 26 Nov 2026):
//  - every tree grows over game days from a sapling (never at once), capped by its tile's bloom, and the game counts
//    it as it grows (wildlife, thriving trees);
//  - giant trees stand in the woodland (Elder Grove) only, never at the fountain or on the beach: bare and dusty
//    until their ground is restored, then leafing out; their trunks are solid; the player can plant them there too;
//  - the follow camera pulls in short of a trunk and stays under a canopy.
import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { regionOfCell } from '../src/core/OldCityLayout';
import { packChunk, treeAtsOf, unpackChunk } from '../src/core/TilePack';
import { DAY_SECONDS } from '../src/data/time';
import { REGIONS } from '../src/data/oldcity';
import { gameSecondsOf } from '../src/gameplay/Clock';
import { Sim } from '../src/gameplay/Sim';
import { isGiantOccupant } from '../src/gameplay/TreeGrowth';
import { Walker } from '../src/gameplay/Walker';
import { boomClear, ceilingFor, EXPLORE } from '../src/rendering/CameraController';
import { buildGiant, giantBounds } from '../src/rendering/GiantTreeGen';
import { PLANTED_SCALE, plantedGrowth } from '../src/rendering/GiantTrees';
import { PALETTE } from '../src/rendering/Palette';
import { GIANT, TREE_GROWTH, ageStage, giantCells, giantGrowth, giantNear, giantsWithin, nextTreeStep, treeSpot, treeStage, treeWorldOf } from '../src/rendering/TreePlacement';
import type { TileData } from '../src/core/types';

const DAY = DAY_SECONDS;
const region = (id: string) => REGIONS.find((r) => r.id === id)!;
const cellsOf = (id: string) => {
  const c = region(id).chunks;
  const out: [number, number][] = [];
  for (let z = c.z0 * 16; z < (c.z1 + 1) * 16; z++) for (let x = c.x0 * 16; x < (c.x1 + 1) * 16; x++) out.push([x, z]);
  return out;
};

/** Every world giant in the Old City (a sweep over the island's chunks). */
function allGiants(sim: Sim) {
  const w = treeWorldOf(sim);
  const seen = new Map<string, ReturnType<typeof giantsWithin>[number]>();
  for (const r of REGIONS) {
    const c = r.chunks;
    const cx = ((c.x0 + c.x1 + 1) / 2) * 16, cz = ((c.z0 + c.z1 + 1) / 2) * 16;
    for (const g of giantsWithin(w, cx, cz, 48)) seen.set(`${g.gx},${g.gz}`, g);
  }
  for (const g of giantsWithin(w, 8, 8, 48)) seen.set(`${g.gx},${g.gz}`, g);
  return [...seen.values()];
}

describe('trees grow over game days', () => {
  it('a tree reaches each stage only when old enough, as far as its bloom allows', () => {
    expect(ageStage(0)).toBe(1);
    expect(ageStage(TREE_GROWTH.days[1] * DAY - 1)).toBe(1);
    expect(ageStage(TREE_GROWTH.days[1] * DAY)).toBe(2);
    expect(ageStage(TREE_GROWTH.days[2] * DAY)).toBe(3);
    expect(ageStage(TREE_GROWTH.days[3] * DAY)).toBe(4);
    // several game days to grow (owner), and a giant takes longer
    expect(TREE_GROWTH.days[2]).toBeGreaterThanOrEqual(2);
    expect(TREE_GROWTH.giantDays[2]).toBeGreaterThan(TREE_GROWTH.days[2]);
    const t = { ground: 'restored' as const, bloom: 3, treeAt: 1000 };
    expect(treeStage(t, 3, 1000)).toBe(1); // planted: a sapling, whatever the bloom
    expect(treeStage(t, 3, 1000 + 1.5 * DAY)).toBe(2);
    expect(treeStage(t, 3, 1000 + 10 * DAY)).toBe(3); // capped by its bloom
    expect(treeStage({ ...t, bloom: 1 }, 1, 1000 + 10 * DAY)).toBe(1);
    expect(nextTreeStep(t, 1000)).toBe(1000 + TREE_GROWTH.days[1] * DAY);
    expect(nextTreeStep(t, 1000 + 10 * DAY)).toBeUndefined();
    // a tree with no planting time (grown, or from an older save) shows its bloom
    expect(treeStage({ ground: 'restored', bloom: 3 }, 3, 5)).toBe(3);
  });

  it('a restored tree tile starts as a sapling and grows a stage at a time, and the counts follow it', () => {
    const sim = new Sim(createInitialState(7));
    const w = treeWorldOf(sim);
    // a tree tile in the park
    let tile: TileData | undefined;
    for (let z = 0; z < 16 && !tile; z++)
      for (let x = 0; x < 16 && !tile; x++) {
        const t = sim.grid.get(GROUND, x, z)!;
        if (t.ground !== 'restored' && !t.blocked && !t.occupantId && treeSpot(t, 'park', w) && sim.restoration.isEligible(t)) tile = t;
      }
    expect(tile).toBeDefined();
    const t = tile!;
    const grew: [number, number][] = [];
    sim.bus.on('tree.grew', ({ tile: g, from, to }) => g === t && grew.push([from, to]));
    sim.restoration.complete(t, 'pulse');
    t.bloom = 3;
    expect(t.treeAt).toBe(gameSecondsOf(sim.state));
    expect(sim.trees.stage(t)).toBe(1);
    sim.ecosystem.refresh(true);
    const thriving0 = sim.ecosystem.bio.thrivingTrees;
    // a day and a half later it is a young tree; three days on, grown
    const offset = gameSecondsOf(sim.state) - sim.state.time;
    const planted = t.treeAt!;
    sim.trees.tick(); // the first look
    for (const days of [1.5, 3.2]) {
      sim.state.time = planted - offset + days * DAY;
      sim.trees.tick();
    }
    expect(grew).toEqual([[1, 2], [2, 3]]);
    expect(sim.trees.stage(t)).toBe(3);
    sim.ecosystem.refresh();
    expect(sim.ecosystem.bio.thrivingTrees).toBe(thriving0 + 1);
  });

  it('a planting time survives a save, and an unloaded chunk counts its trees by age', () => {
    const sim = new Sim(createInitialState(7));
    const t = sim.grid.get(GROUND, 3, 3)!;
    t.ground = 'restored';
    t.bloom = 3;
    t.treeAt = 12345.5;
    const c = sim.grid.chunkAt(GROUND, 0, 0)!;
    const packed = packChunk(c, sim.state.seed, sim.grid.layer(GROUND)!);
    expect(treeAtsOf(packed).get(3 * 16 + 3)).toBe(12345.5);
    t.treeAt = undefined;
    unpackChunk(c, packed);
    expect(sim.grid.get(GROUND, 3, 3)!.treeAt).toBe(12345.5);
  });
});

describe('giant trees in the world', () => {
  const sim = new Sim(createInitialState(7));
  const giants = allGiants(sim);

  it('grow in the woodland only: a few in Elder Grove, none at the fountain or on the beach', () => {
    const grove = giants.filter((g) => regionOfCell(g.gx, g.gz)?.id === 'elderGrove');
    expect(grove.length).toBeGreaterThanOrEqual(2);
    expect(grove.length).toBeLessThanOrEqual(8);
    expect(giants.length).toBe(grove.length);
    // and the whole park and beach have none
    const w = treeWorldOf(sim);
    for (const [x, z] of [...cellsOf('saltwind')]) expect(giantNear(w, x, z, 2)).toBeUndefined();
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) expect(giantNear(w, x, z, 2)).toBeUndefined();
  });

  it('stand on open natural ground at one height, off the paths, with no small tree against the trunk', () => {
    const w = treeWorldOf(sim);
    for (const g of giants) {
      const lv = w.peek(g.gx, g.gz)!.level;
      let rubble = 0;
      for (let dz = -GIANT.ring; dz < 2 + GIANT.ring; dz++)
        for (let dx = -GIANT.ring; dx < 2 + GIANT.ring; dx++) {
          const t = w.peek(g.gx + dx, g.gz + dz)!;
          const trunk = dx >= 0 && dx < 2 && dz >= 0 && dz < 2;
          if (trunk) {
            // the trunk on open natural ground; a little rubble may lie among its roots
            expect(t.blocked, `${g.gx + dx},${g.gz + dz}`).toBe(false);
            expect(['lawn', 'litter', 'clay', undefined]).toContain(t.feature);
          } else if (t.blocked || t.prop) rubble++;
          expect(['building', 'road', 'paving', 'water']).not.toContain(t.feature);
          expect(t.level).toBe(lv);
          const tile = sim.grid.get(GROUND, g.gx + dx, g.gz + dz)!;
          expect(treeSpot(tile, 'grove', w), 'no small tree in the trunk ring').toBeUndefined();
        }
      expect(rubble).toBeLessThanOrEqual(GIANT.rubble);
    }
    // trunks stand apart, so canopies touch rather than pile up
    for (const a of giants) for (const b of giants) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(GIANT.spacing);
  });

  it('have solid trunks: their four cells are stamped and Bloombot cannot stand in them', () => {
    const walker = new Walker(sim);
    expect(giants.length).toBeGreaterThan(0);
    for (const g of giants) {
      for (const [x, z] of giantCells(g)) {
        const t = sim.grid.get(GROUND, x, z)!;
        expect(isGiantOccupant(t.occupantId)).toBe(true);
        sim.state.areas[sim.areas.map.areaOfCell(x, z)] = { fog: 'cleared' } as never;
        expect(walker.walkable(GROUND, x, z), `${x},${z}`).toBe(false);
        // the ring round it stays open ground
        expect(walker.walkable(GROUND, g.gx - 1, g.gz)).toBe(true);
      }
    }
  });

  it('stand bare until their ground is restored, then leaf out over game days', () => {
    const g = giants[0];
    expect(sim.trees.giant(g).stage).toBe(0);
    const cell = sim.grid.get(GROUND, g.gx, g.gz)!;
    sim.state.areas[sim.areas.map.areaOfCell(g.gx, g.gz)] = { fog: 'revealed' } as never;
    sim.restoration.complete(cell, 'pulse');
    cell.bloom = 4;
    expect(cell.treeAt).toBeDefined();
    const now = gameSecondsOf(sim.state);
    expect(giantGrowth([cell], now).stage).toBe(1);
    expect(giantGrowth([cell], now + TREE_GROWTH.giantDays[2] * DAY).stage).toBe(3);
    expect(giantGrowth([cell], now + 30 * DAY).stage).toBe(4);
  });
});

describe('the shape of a giant tree', () => {
  it('has a canopy well above the follow camera, a big reach and a budget', () => {
    for (let v = 0; v < 6; v++) {
      const b = giantBounds(v);
      // the chase camera sits about 2.2 up (pivot 1.05): the leaves start clear of it but not towering
      expect(b.underside, `variant ${v}`).toBeGreaterThan(3);
      expect(b.top).toBeLessThan(11);
      expect(b.reach).toBeGreaterThan(4.5);
      expect(b.reach).toBeLessThan(7.5);
      expect(buildGiant(3, v, 1).tris).toBeLessThan(12_000);
      expect(buildGiant(3, v, 0).tris).toBeLessThan(2_500);
    }
  });

  it('is bare at stage 0 and leafs out with the same leaves, young green to grown green', () => {
    const bare = buildGiant(0, 2, 1), young = buildGiant(1, 2, 1), grown = buildGiant(3, 2, 1);
    expect(bare.leafStarts!.length).toBe(0);
    expect(young.leafStarts!.length).toBeGreaterThan(0);
    expect(grown.leafStarts!.length).toBeGreaterThan(young.leafStarts!.length * 2);
    // the trunk is full size at every stage
    expect(bare.tris).toBeGreaterThan(1000);
    const lin = (h: string) => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));
    const avg = (g: typeof young) => {
      const s = [0, 0, 0];
      for (const st of g.leafStarts!) for (let k = 0; k < 3; k++) s[k] += g.col[st * 4 + k] / 255;
      return s.map((v) => v / g.leafStarts!.length);
    };
    const hue = ([r, g, b]: number[]) => (g - r) / (g + r + b);
    // Frog Green is yellower (more red against green) than Leaf Green
    expect(hue(lin(PALETTE.leaf.young))).toBeLessThan(hue(lin(PALETTE.leaf.grown)));
    expect(hue(avg(young))).toBeLessThan(hue(avg(grown)));
  });
});

describe('the follow camera round giant trees', () => {
  it('pulls the boom in short of a trunk between bloombot and the camera, and not otherwise', () => {
    const trunk = [{ x: 0, z: 3, trunkR: 0.6 }];
    expect(boomClear({ x: 0, z: 0 }, { x: 0, z: 6 }, trunk)).toBeCloseTo((3 - 0.6 - EXPLORE.trunkGap) / 6, 5);
    expect(boomClear({ x: 0, z: 0 }, { x: 0, z: 1.5 }, trunk)).toBe(1); // the camera stops short of it anyway
    expect(boomClear({ x: 0, z: 0 }, { x: 3, z: 0 }, trunk)).toBe(1); // off to the side
  });

  it('keeps the camera under the canopy, along the whole line to bloombot', () => {
    const under = 6;
    const ceiling = (x: number, z: number) => under + Math.max(0, Math.hypot(x, z) - 5) * 1.2;
    // bloombot under the canopy: the camera stays under the leaves (with the gap)
    const top = ceilingFor({ x: 0, y: 1, z: 0 }, { x: 0, z: 4 }, ceiling);
    expect(top).toBeCloseTo(under - EXPLORE.canopyGap, 5);
    // bloombot out past the leaves, the camera under them: the line clears them too
    const top2 = ceilingFor({ x: 0, y: 1, z: 9 }, { x: 0, z: 3 }, ceiling);
    expect(top2).toBeLessThanOrEqual(under - EXPLORE.canopyGap + 1e-6);
    // open sky: no limit
    expect(ceilingFor({ x: 30, y: 1, z: 30 }, { x: 34, z: 30 }, () => Infinity)).toBe(Infinity);
  });
});

describe('planting giant trees', () => {
  function grove(): Sim {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.tier = 3;
    sim.state.salvage!.keepers.moss = { step: 'request1' };
    for (const id of Object.keys(sim.state.areas)) sim.state.areas[id].fog = 'cleared';
    sim.state.areas.elderGrove = { ...(sim.state.areas.park ?? {}), fog: 'cleared' } as never;
    return sim;
  }
  const open = (sim: Sim, x: number, z: number) => {
    for (const [cx, cz] of giantCells({ gx: x, gz: z })) {
      const t = sim.grid.get(GROUND, cx, cz)!;
      t.blocked = false;
      t.feature = undefined;
      t.prop = undefined;
      t.occupantId = undefined;
      t.ground = 'restored';
      t.bloom = 1;
      t.pollution = 0;
    }
  };

  it('is learnt in the woodland, and grows only there', () => {
    const sim = grove();
    expect(sim.build.isUnlocked('giantTree')).toBe(true);
    for (const [k, v] of Object.entries(sim.build.recipe('giantTree')!)) sim.inventory.addToStore(k as 'scrap', v!);
    sim.bot = { roofId: GROUND, x: 8.5, z: 8.5 };
    open(sim, 4, 4);
    expect(sim.build.check('giantTree', GROUND, 4, 4).reason).toMatch(/only grows in Elder Grove/);
    // a free spot in the grove, away from its own giants
    const w = treeWorldOf(sim);
    const spot = cellsOf('elderGrove').find(([x, z]) => !giantsWithin(w, x + 1, z + 1, 8).length && regionOfCell(x + 1, z + 1)?.id === 'elderGrove' && !sim.grid.get(GROUND, x, z)!.blocked && !sim.grid.get(GROUND, x, z)!.prop)!;
    open(sim, spot[0], spot[1]);
    sim.bot = { roofId: GROUND, x: 8.5, z: 11.5 }; // by the store at home
    const m = sim.build.place('giantTree', GROUND, spot[0], spot[1]);
    expect(m, sim.build.check('giantTree', GROUND, spot[0], spot[1]).reason).toBeDefined();
    expect(m!.plantedAt).toBe(gameSecondsOf(sim.state));
    // paid exactly: the recipe, and nothing more
    for (const k of Object.keys(sim.build.recipe('giantTree')!)) expect(sim.inventory.stored(k as 'scrap'), k).toBe(0);
    // a solid 2×2 trunk
    for (const [x, z] of giantCells({ gx: spot[0], gz: spot[1] })) expect(sim.grid.get(GROUND, x, z)!.occupantId).toBe(m!.id);
  });

  it('grows from a young tree to full size over game days', () => {
    const m = { plantedAt: 100 };
    expect(plantedGrowth(m, 100, 1)).toMatchObject({ stage: 1, scale: PLANTED_SCALE[0], leaves: 1 });
    const g = TREE_GROWTH.giantDays;
    expect(plantedGrowth(m, 100 + g[1] * DAY, 1).scale).toBe(PLANTED_SCALE[1]);
    expect(plantedGrowth(m, 100 + g[2] * DAY, 1)).toMatchObject({ stage: 3, leaves: 3 });
    expect(plantedGrowth(m, 100 + g[3] * DAY, 1)).toMatchObject({ stage: 4, scale: 1, leaves: 3 });
    expect(plantedGrowth(m, 100 + g[3] * DAY, 4).leaves).toBe(4); // Radiant where its ground is in full bloom
    expect(plantedGrowth(m, 100, 1).next).toBe(100 + g[1] * DAY);
  });
});
