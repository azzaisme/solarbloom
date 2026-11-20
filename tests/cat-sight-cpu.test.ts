import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CAT_SIGHT, catSamples, cpuSeenPixels, rayClear, seenEnough, type P3 } from '../src/core/CatSight';
import { SOLIDS, SolidCollector, SolidIndex, geoBounds, type GeoBounds } from '../src/core/Solids';
import { treeGeo } from '../src/rendering/TreeGen';

/**
 * E23.12.3 (#530): the CPU line of sight, used where the GPU sight pick can't run (WebGPU). The world's solids are
 * recorded as the chunks draw them (core/Solids); a cat counts as seen when enough of it has a clear line to the eye
 * (core/CatSight cpuSeenPixels). Here with the real shapes: a tree from the game's own tree generator, and models
 * at their real size (read from the GLB files' own bounds) at the scales the game places them.
 */

/** A GLB's extent about its pivot (metres), from the POSITION bounds the file records for each mesh. */
function glbBounds(name: string): GeoBounds {
  const buf = readFileSync(`assets/raw/models/final/${name}.glb`);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    accessors: { min?: number[]; max?: number[] }[];
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    nodes?: { mesh?: number; translation?: number[]; scale?: number[] }[];
  };
  let r = 0;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const n of json.nodes ?? []) {
    if (n.mesh === undefined) continue;
    const [tx, ty, tz] = n.translation ?? [0, 0, 0];
    const [sx, sy, sz] = n.scale ?? [1, 1, 1];
    for (const p of json.meshes[n.mesh].primitives) {
      const a = json.accessors[p.attributes.POSITION];
      if (!a.min || !a.max) continue;
      for (const x of [a.min[0], a.max[0]]) for (const z of [a.min[2], a.max[2]]) r = Math.max(r, Math.hypot(tx + x * sx, tz + z * sz));
      y0 = Math.min(y0, ty + a.min[1] * sy);
      y1 = Math.max(y1, ty + a.max[1] * sy);
    }
  }
  return { r, y0, y1 };
}

const GROUND = 0.08;
/** a camera as the follow view places it: up and back from the cat along -x */
const eyeFrom = (cat: P3, dist = 7, height = 5): P3 => ({ x: cat.x - dist, y: cat.y + height, z: cat.z });
/** about how tall a cat stands on screen in the close follow view (px) */
const CLOSE_PX = 40;

/** The world: ground below GROUND, and whatever the collector recorded. */
const world = (fill: (c: SolidCollector) => void) => {
  const c = new SolidCollector(GROUND);
  fill(c);
  const index = new SolidIndex();
  index.setChunk('k', c.boxes);
  return (x: number, y: number, z: number) => y < GROUND || index.at(x, y, z);
};

const seen = (cat: P3, solidAt: (x: number, y: number, z: number) => boolean, eye = eyeFrom(cat), px = CLOSE_PX) =>
  cpuSeenPixels(eye, catSamples(cat, CAT_SIGHT.catHeight, { x: 0, z: 1 }), px, solidAt);

describe('the CPU line of sight (where the GPU sight pick cannot run)', () => {
  const cat: P3 = { x: 10.5, y: GROUND, z: 10.5 };

  it('records what can hide a cat and leaves out what cannot', () => {
    const c = new SolidCollector(GROUND);
    c.prim([5, GROUND - 0.08, 5], [1, 0.16, 1]); // a ground slab: no rise
    c.prim([5, GROUND + 0.05, 5], [0.4, 0.1, 0.4]); // a kerb, lower than SOLIDS.minRise
    c.prim([5, GROUND + 0.6, 5], [0.04, 1.2, 0.04]); // a thin pole
    c.geo(geoBounds(treeGeo('oak', 4, 0, 1).pos, 4), 5, GROUND, 5, 1, true); // a full oak
    c.geo({ r: 0.1, y0: 0, y1: 0.2 }, 6, GROUND, 6, 1, true); // a flower: foliage under SOLIDS.minFoliage
    c.prim([7, GROUND + 0.5, 7], [1, 1, 1]); // a crate
    expect(c.boxes.length).toBe(2);
    expect(SOLIDS.minRise).toBeLessThan(CAT_SIGHT.catHeight);
  });

  it('the index answers by point, and a rebuilt or dropped chunk replaces its boxes', () => {
    const i = new SolidIndex();
    i.setChunk('a', [{ x0: 1, y0: 0, z0: 1, x1: 3, y1: 2, z1: 2 }]);
    expect(i.at(2.5, 1, 1.5)).toBe(true);
    expect(i.at(2.5, 2.5, 1.5)).toBe(false);
    expect(i.at(4, 1, 1.5)).toBe(false);
    i.setChunk('a', [{ x0: 5, y0: 0, z0: 5, x1: 6, y1: 1, z1: 6 }]);
    expect(i.at(2.5, 1, 1.5)).toBe(false);
    expect(i.at(5.5, 0.5, 5.5)).toBe(true);
    i.clearChunk('a');
    expect(i.at(5.5, 0.5, 5.5)).toBe(false);
    expect(i.size).toBe(0);
  });

  it('a cat in the open is seen; one a few pixels across is too small to make out', () => {
    const open = world(() => {});
    expect(seenEnough(seen(cat, open))).toBe(true);
    expect(seen(cat, open)).toBeCloseTo(CLOSE_PX * CLOSE_PX * CAT_SIGHT.fill);
    expect(seenEnough(seen(cat, open, eyeFrom(cat), 4))).toBe(false); // the overview draws a cat about 4 px tall
  });

  it('a building between the camera and the cat hides it; one beside or behind it does not', () => {
    const block = (x: number, z: number) => world((c) => c.prim([x, GROUND + 0.63, z], [1.6, 1.26, 1.6])); // three storeys (0.42 each)
    expect(seen(cat, block(cat.x - 1.2, cat.z))).toBe(0);
    expect(seenEnough(seen(cat, block(cat.x, cat.z + 3)))).toBe(true);
    expect(seenEnough(seen(cat, block(cat.x + 2.5, cat.z)))).toBe(true);
    // from the follow camera's height a low house two and a half tiles off is looked over, as on screen
    expect(seenEnough(seen(cat, world((c) => c.prim([cat.x - 2.5, GROUND + 0.42, cat.z], [1.6, 0.84, 1.6]))))).toBe(true);
  });

  it("a tree's crown in the way hides the cat (the game's own oak, full grown, at a big specimen's scale)", () => {
    const oak = geoBounds(treeGeo('oak', 4, 0, 1).pos, 4);
    expect(oak.y1 * 1.7).toBeGreaterThan(1.5); // a big tree stands well over a cat
    const tree = world((c) => c.geo(oak, cat.x - 1.6, GROUND, cat.z, 1.7, true));
    expect(seenEnough(seen(cat, tree))).toBe(false);
    // a sapling (stage 1) doesn't hide a cat standing past it
    const sapling = world((c) => c.geo(geoBounds(treeGeo('oak', 1, 0, 1).pos, 4), cat.x - 1.6, GROUND, cat.z, 1, true));
    expect(seenEnough(seen(cat, sapling))).toBe(true);
  });

  it('a ruin in the way hides the cat: a cracked pillar and a large salvage pile, at their real model sizes', () => {
    const pillar = glbBounds('cracked-pillar'); // placed at 0.55 (ChunkRenderer.PROP_MODELS)
    expect(pillar.y1 * 0.55).toBeGreaterThan(CAT_SIGHT.catHeight);
    const behindPillar = world((c) => c.model(pillar, cat.x - 0.7, GROUND, cat.z, 0.55, 0.55, 0.55));
    expect(seenEnough(seen(cat, behindPillar, eyeFrom(cat, 7, 2.2)))).toBe(false); // a low view past the pillar
    const pile = glbBounds('salvage-clay'); // a large pile at 1.05 (ChunkRenderer.oldCityProp)
    const behindPile = world((c) => c.model(pile, cat.x - 0.75, GROUND, cat.z, 1.05, 1.05, 1.05));
    expect(seenEnough(seen(cat, behindPile, eyeFrom(cat, 7, 2.2)))).toBe(false);
    // the same pillar off to the side hides nothing
    const aside = world((c) => c.model(pillar, cat.x - 0.7, GROUND, cat.z + 2, 0.55, 0.55, 0.55));
    expect(seenEnough(seen(cat, aside, eyeFrom(cat, 7, 2.2)))).toBe(true);
  });

  it("a landmark in the way hides the cat: the park's fountain and a signal mast, at their real model sizes", () => {
    const fountain = glbBounds('dry-fountain'); // 0.56 (MachineVisuals LANDMARK_MODELS)
    const behindFountain = world((c) => c.model(fountain, cat.x - 1.4, GROUND, cat.z, 0.56, 0.56, 0.56));
    expect(seenEnough(seen(cat, behindFountain, eyeFrom(cat, 7, 2.6)))).toBe(false);
    const mast = glbBounds('signal-mast'); // 0.6
    expect(mast.y1 * 0.6).toBeGreaterThan(2);
    const behindMast = world((c) => c.model(mast, cat.x - 1.2, GROUND, cat.z, 0.6, 0.6, 0.6));
    expect(seen(cat, behindMast)).toBeLessThan(seen(cat, world(() => {})));
  });

  it('a canopy overhead (a pergola) can be seen under: what counts is the line, not the tallest thing on the spot', () => {
    // a 1.25 m roof band over the cat's spot, open below
    const pergola = world((c) => c.prim([cat.x, GROUND + 1.25, cat.z], [3, 0.2, 3]));
    expect(seenEnough(seen(cat, pergola, eyeFrom(cat, 8, 1.2)))).toBe(true); // a low view, under the edge
    expect(seen(cat, pergola, { x: cat.x - 1, y: cat.y + 9, z: cat.z })).toBe(0); // from almost overhead: the roof
  });

  it("the cat's own nook (the bench or ledge it tucks into) doesn't count as in the way", () => {
    const nook = world((c) => c.prim([cat.x - 0.1, GROUND + 0.2, cat.z], [0.2, 0.4, 0.6])); // within CAT_SIGHT.skipNear
    expect(rayClear(eyeFrom(cat), { ...cat, y: cat.y + 0.1 }, nook)).toBe(true);
  });
});
