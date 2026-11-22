/**
 * E28 water: things standing in the water that ripples ring round now and then: rocks at the waterline, the jetty's
 * posts, a bridge's supports. Anything can add some, by a source key of its own; the water draws rings round the
 * nearest few to the camera (LOOK.water.disturb).
 *
 * The interface:
 * - `setWaterDisturbers(source, list)` replaces everything that source stood in the water (an empty list clears it).
 *   Each is a point on the water: its centre `x`, `z` (world units: tiles), its footprint radius `r` (the rings start at
 *   its edge) and, optionally, a `strength` (1 is a typical post or rock; 0 … 2).
 * - `clearWaterDisturbers(source)` takes a source's away (a chunk unloading, a bridge removed).
 * Sources in use: `rocks:<chunk key>` (ChunkRenderer, rebuilt with each chunk); `jetty` (the Landing's six posts, as
 * the chunk that draws it measures them: Bridges.jettyPosts) and `bridge:<x>,<z>` (a canal's plank bridge while it's
 * open), both from ChunkRenderer (E28.W03).
 *
 * Covers are the other half: decks built low over the water (the jetty, a bridge). The swell lies flat under each and
 * eases back in over LOOK.water.waves.coverEase tiles round it, so a wave never laps up over the planks.
 * - `setWaterCovers(source, list)` with rectangles `{x0, z0, x1, z1}` (world units: tiles); `clearWaterCovers(source)`.
 * E28.W03: the water under a cover also lies in the deck's shade (LOOK.bridge.under).
 */
export interface WaterDisturber {
  x: number;
  z: number;
  r: number;
  strength?: number;
}

const sources = new Map<string, WaterDisturber[]>();
let version = 0;

export function setWaterDisturbers(source: string, list: readonly WaterDisturber[]) {
  if (!list.length) {
    clearWaterDisturbers(source);
    return;
  }
  sources.set(
    source,
    list.map((d) => ({ x: d.x, z: d.z, r: Math.max(0, d.r), strength: Math.min(2, Math.max(0, d.strength ?? 1)) })),
  );
  version++;
}

export function clearWaterDisturbers(source: string) {
  if (sources.delete(source)) version++;
}

/** How many disturbers are standing in the water now (all sources). */
export function waterDisturberCount(): number {
  let n = 0;
  for (const l of sources.values()) n += l.length;
  return n;
}

/** Changes every time any source's list changes. */
export function waterDisturberVersion(): number {
  return version;
}

/**
 * The `max` disturbers nearest (x, z), packed four floats each (x, z, r, strength) into `out` from the start; returns
 * how many. Ties keep the order they were added in.
 */
export function nearestWaterDisturbers(x: number, z: number, max: number, out: Float32Array): number {
  const all: { d: number; w: WaterDisturber }[] = [];
  for (const l of sources.values()) for (const w of l) all.push({ d: (w.x - x) ** 2 + (w.z - z) ** 2, w });
  all.sort((a, b) => a.d - b.d);
  const n = Math.min(max, all.length, Math.floor(out.length / 4));
  for (let i = 0; i < n; i++) {
    const w = all[i].w;
    out[i * 4] = w.x;
    out[i * 4 + 1] = w.z;
    out[i * 4 + 2] = w.r;
    out[i * 4 + 3] = w.strength ?? 1;
  }
  return n;
}

/** A deck built low over the water: a rectangle from (x0, z0) to (x1, z1), in world units (tiles). */
export interface WaterCover {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const covers = new Map<string, WaterCover[]>();

export function setWaterCovers(source: string, list: readonly WaterCover[]) {
  if (!list.length) {
    clearWaterCovers(source);
    return;
  }
  covers.set(
    source,
    list.map((c) => ({ x0: Math.min(c.x0, c.x1), z0: Math.min(c.z0, c.z1), x1: Math.max(c.x0, c.x1), z1: Math.max(c.z0, c.z1) })),
  );
  version++;
}

export function clearWaterCovers(source: string) {
  if (covers.delete(source)) version++;
}

/** How far (x, z) is from a cover's rectangle (0 on or under it). */
export function coverDistance(c: WaterCover, x: number, z: number): number {
  const dx = Math.max(c.x0 - x, 0, x - c.x1);
  const dz = Math.max(c.z0 - z, 0, z - c.z1);
  return Math.hypot(dx, dz);
}

/** The `max` covers nearest (x, z), packed (x0, z0, x1, z1) into `out` from the start; returns how many. */
export function nearestWaterCovers(x: number, z: number, max: number, out: Float32Array): number {
  const all: { d: number; c: WaterCover }[] = [];
  for (const l of covers.values()) for (const c of l) all.push({ d: coverDistance(c, x, z), c });
  all.sort((a, b) => a.d - b.d);
  const n = Math.min(max, all.length, Math.floor(out.length / 4));
  for (let i = 0; i < n; i++) out.set([all[i].c.x0, all[i].c.z0, all[i].c.x1, all[i].c.z1], i * 4);
  return n;
}

/** Every cover now (all sources). */
export function waterCovers(): WaterCover[] {
  return [...covers.values()].flat();
}

/** Clears every source (tests, and a new game). */
export function resetWaterDisturbers() {
  sources.clear();
  covers.clear();
  version++;
}
