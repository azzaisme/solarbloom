/**
 * E28.W03 (#696): where the decks, piers and causeways meet the water. Pure helpers (no PlayCanvas): where each deck's
 * posts stand in the water, the footprint a deck shades on the bank under it, and the uneven wet line on a wall that
 * stands in water. ChunkRenderer draws with them; the water's own disturbances round the posts take the same posts.
 *
 * What stands in the water (the census for #696):
 *   - the Landing's jetty (Saltwind Beach): the `jetty` model on six posts, or planks on posts while it's missing;
 *   - the Saltwind canal's plank bridge, once its hedge is pruned through (a post on each of its tiles);
 *   - the Long Causeway's spans and the old pier in the bay: solid walls into the sea (their wet line is `wetLine`);
 *   - the mainland avenues over its canals: road on walls, the same.
 */
import { LOOK } from '../data/look';
import { LANDING } from '../data/oldcity';
import { shoreHash } from './Shore';

/** A post standing in the water: where (world x, z) and its radius. */
export interface Post {
  x: number;
  z: number;
  r: number;
}

/** A deck's footprint on the ground (world x, z). */
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** The jetty model's length along its own +X (metres); it is placed at `LANDING.jetty.d / JETTY_MODEL_LENGTH` scale. */
export const JETTY_MODEL_LENGTH = 8;
/** The jetty model's deck, half its width across (metres, its own Z), measured from jetty.glb. */
export const JETTY_MODEL_HALF_WIDTH = 2.59;
/**
 * The jetty model's posts: where each stands (metres, the model's own x and z) and its radius, measured from the feet
 * of jetty.glb (each post runs straight up from there).
 */
export const JETTY_MODEL_POSTS: readonly (readonly [number, number, number])[] = [
  [-3.84, -2.14, 0.23],
  [-1.23, -2.15, 0.32],
  [-1.91, 2.13, 0.32],
  [2.26, -2.17, 0.32],
  [2.23, 1.89, 0.32],
  [3.7, -1.18, 0.32],
];

/** The jetty model's placement: its scale, centre and turn (as ChunkRenderer adds it to the batch). */
export function jettyPlacement() {
  const J = LANDING.jetty;
  return { sc: J.d / JETTY_MODEL_LENGTH, cx: J.x + J.w / 2, cz: J.z + J.d / 2, yaw: LANDING.jettyYaw };
}

/** A point in the jetty model's own metres, in the world (turned about +y by its yaw, as PlayCanvas turns it). */
function jettyToWorld(mx: number, mz: number): [number, number] {
  const { sc, cx, cz, yaw } = jettyPlacement();
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [cx + (mx * c + mz * s) * sc, cz + (-mx * s + mz * c) * sc];
}

/** The jetty's posts in the world: the model's six, or the planks' posts down its two outer sides while it's missing. */
export function jettyPosts(model: boolean): Post[] {
  if (model) {
    const { sc } = jettyPlacement();
    return JETTY_MODEL_POSTS.map(([mx, mz, r]) => {
      const [x, z] = jettyToWorld(mx, mz);
      return { x, z, r: r * sc };
    });
  }
  const J = LANDING.jetty;
  const out: Post[] = [];
  for (let z = J.z; z < J.z + J.d; z++) {
    out.push({ x: J.x + 0.5 - 0.42, z: z + 0.5, r: 0.045 });
    out.push({ x: J.x + J.w - 0.5 + 0.42, z: z + 0.5, r: 0.045 });
  }
  return out;
}

/** The ground the jetty's deck covers (the model's deck, or its tiles while it's missing). */
export function jettyDeck(model: boolean): Rect {
  const J = LANDING.jetty;
  if (!model) return { x0: J.x, z0: J.z, x1: J.x + J.w, z1: J.z + J.d };
  const pts = [
    jettyToWorld(-JETTY_MODEL_LENGTH / 2, -JETTY_MODEL_HALF_WIDTH),
    jettyToWorld(JETTY_MODEL_LENGTH / 2, JETTY_MODEL_HALF_WIDTH),
  ];
  return { x0: Math.min(pts[0][0], pts[1][0]), z0: Math.min(pts[0][1], pts[1][1]), x1: Math.max(pts[0][0], pts[1][0]), z1: Math.max(pts[0][1], pts[1][1]) };
}

/**
 * The end of the jetty that meets the land: the side of its deck nearest the beach (the model's -X end, its rope rail
 * at +X pointing out to sea), as a line from (x0, z0) to (x1, z1) with the outward normal toward the land.
 */
export function jettyLandEnd(model: boolean): { x0: number; z0: number; x1: number; z1: number; nx: number; nz: number } {
  const d = jettyDeck(model);
  // the model's -X end, turned into the world: which side of the footprint it is
  const [ex, ez] = jettyToWorld(-JETTY_MODEL_LENGTH / 2, 0);
  const { cx, cz } = jettyPlacement();
  const nx = Math.round(Math.sign(ex - cx));
  const nz = Math.round(Math.sign(ez - cz));
  if (nz) {
    const z = nz < 0 ? d.z0 : d.z1;
    return { x0: d.x0, z0: z, x1: d.x1, z1: z, nx: 0, nz };
  }
  const x = nx < 0 ? d.x0 : d.x1;
  return { x0: x, z0: d.z0, x1: x, z1: d.z1, nx, nz: 0 };
}

/** The post under one tile of the canal's plank bridge: on the tile's outer side (by its z), half way across. */
export function plankPost(tx: number, tz: number): Post {
  return { x: tx + 0.5, z: tz % 2 ? tz + 0.92 : tz + 0.08, r: 0.045 };
}

/**
 * The tiles of the plank bridge that tile `t` belongs to: every deck tile joined to it side by side (`deckAt` says
 * whether a cell is one of its tiles, and gives it). Never more than a small bridge's worth.
 */
export function plankBridgeTiles<T extends { x: number; z: number }>(t: T, deckAt: (x: number, z: number) => T | undefined): T[] {
  const seen = new Map<string, T>([[`${t.x},${t.z}`, t]]);
  const todo = [t];
  while (todo.length && seen.size < 64) {
    const c = todo.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${c.x + dx},${c.z + dz}`;
      if (seen.has(k)) continue;
      const n = deckAt(c.x + dx, c.z + dz);
      if (!n) continue;
      seen.set(k, n);
      todo.push(n);
    }
  }
  return [...seen.values()];
}

/** A plank bridge's deck over the water: the box round its tiles (its planks stop just short of each tile's sides). */
export function deckOf(tiles: readonly { x: number; z: number }[]): Rect {
  return {
    x0: Math.min(...tiles.map((t) => t.x)),
    z0: Math.min(...tiles.map((t) => t.z)) + 0.01,
    x1: Math.max(...tiles.map((t) => t.x)) + 1,
    z1: Math.max(...tiles.map((t) => t.z)) + 0.99,
  };
}

/**
 * How much light reaches the ground at (x, z) under the decks: 1 in the open, `1 - LOOK.bridge.shade` under a deck,
 * fading smoothly over `LOOK.bridge.soft` past its edge (a soft contact shadow, the same at any time of day).
 */
export function deckShade(x: number, z: number, decks: readonly Rect[]): number {
  const B = LOOK.bridge;
  let k = 0;
  for (const d of decks) {
    const dx = Math.max(d.x0 - x, 0, x - d.x1);
    const dz = Math.max(d.z0 - z, 0, z - d.z1);
    const out = Math.hypot(dx, dz);
    if (out >= B.soft) continue;
    const s = 1 - out / B.soft;
    k = Math.max(k, s * s * (3 - 2 * s));
  }
  return 1 - B.shade * k;
}

/**
 * The wet line along one tile's edge of a wall standing in water: `LOOK.bridge.wall.pieces` heights above the
 * waterline (between `min` and `max`), by position, so the line wanders along the wall and two walls never match.
 * `x`, `z` is the middle of the edge, (`ax`, `az`) the direction along it.
 */
export function wetLine(x: number, z: number, ax: number, az: number): number[] {
  const W = LOOK.bridge.wall;
  const out: number[] = [];
  for (let i = 0; i < W.pieces; i++) {
    const along = (i + 0.5) / W.pieces - 0.5;
    const px = x + ax * along;
    const pz = z + az * along;
    // a slow swell along the wall and a finer wobble, both from the position (seamless from tile to tile)
    const slow = 0.5 + 0.5 * Math.sin(px * 1.7 + pz * 2.3);
    const fine = shoreHash(Math.round(px * 8) / 8, Math.round(pz * 8) / 8, 696);
    out.push(W.min + (W.max - W.min) * (0.6 * slow + 0.4 * fine));
  }
  return out;
}
