import { CHUNK, generateTile } from './Generation';
import type { Chunk } from './Grid';
import type { GroundState, LayerData, RestoreSource, TileData } from './types';

/**
 * Save encoding for one chunk: only what play changed. A chunk identical to generation packs to ''.
 * Otherwise four columns, compact and very compressible:
 *   ground (1 char/tile) · bloom (1 digit/tile) · pollution (2 base-36 chars/tile) · '|' · extras
 * where extras lists tiles with a growth timer, a grow source or a lush timer: `i,growth,src,lush;…`.
 * Occupancy is not saved: it is rebuilt from the machine list. Variant and blocked come from generation.
 */
const G2C: Record<GroundState, string> = { polluted: 'p', prepared: 'm', growing: 'g', restored: 'r' };
const C2G: Record<string, GroundState> = { p: 'polluted', m: 'prepared', g: 'growing', r: 'restored' };
const SOURCES: RestoreSource[] = ['pulse', 'broad', 'drone', 'chain', 'condenser', 'mega', 'pollinate', 'motherTree', 'relay', 'overflow', 'canopy', 'cat', 'neighbourhood'];
const N = CHUNK * CHUNK;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function same(a: TileData, b: TileData) {
  return a.ground === b.ground && a.bloom === b.bloom && Math.round(a.pollution) === b.pollution && !a.growthRemainingSec && !a.growSource && !a.lushUntil;
}

export function packChunk(c: Chunk, seed: number, layer: LayerData): string {
  let changed = false;
  for (let i = 0; i < N && !changed; i++) {
    const t = c.tiles[i];
    if (!t) continue;
    const base = generateTile(seed, layer, t.x, t.z)!;
    if (!same(t, base)) changed = true;
  }
  if (!changed) return '';
  // Built with arrays + join: join yields flat strings, so stringifying a big save stays fast
  // (repeated += makes rope strings that V8 must flatten on first use).
  const g: string[] = new Array(N);
  const b: string[] = new Array(N);
  const p: string[] = new Array(N);
  const extras: string[] = [];
  for (let i = 0; i < N; i++) {
    const t = c.tiles[i];
    if (!t) {
      g[i] = '-';
      b[i] = '0';
      p[i] = '00';
      continue;
    }
    g[i] = G2C[t.ground];
    b[i] = String(Math.max(0, Math.min(9, t.bloom)));
    const pv = Math.max(0, Math.min(1295, Math.round(t.pollution)));
    p[i] = pv < 36 ? '0' + pv.toString(36) : pv.toString(36);
    if (t.growthRemainingSec || t.growSource || t.lushUntil)
      extras.push(`${i},${t.growthRemainingSec ? r3(t.growthRemainingSec) : ''},${t.growSource ? SOURCES.indexOf(t.growSource) : ''},${t.lushUntil ? r3(t.lushUntil) : ''}`);
  }
  return [g.join(''), b.join(''), p.join(''), '|', extras.join(';')].join('');
}

export function hasGrowth(packed: string): boolean {
  const i = packed.indexOf('g');
  return i >= 0 && i < N;
}

/** Applies a packed chunk over freshly generated tiles. Unknown or malformed data leaves tiles as generated. */
export function unpackChunk(c: Chunk, packed: string) {
  if (!packed || packed.length < N * 4) return;
  const bar = packed.indexOf('|', N * 4);
  for (let i = 0; i < N; i++) {
    const t = c.tiles[i];
    if (!t) continue;
    const gc = packed[i];
    if (!C2G[gc]) continue;
    t.ground = C2G[gc];
    t.bloom = Number(packed[N + i]) || 0;
    t.pollution = parseInt(packed.slice(2 * N + 2 * i, 2 * N + 2 * i + 2), 36) || 0;
    t.growthRemainingSec = 0;
    t.growSource = undefined;
    t.lushUntil = undefined;
  }
  if (bar < 0) return;
  for (const e of packed.slice(bar + 1).split(';')) {
    if (!e) continue;
    const [is, gs, ss, ls] = e.split(',');
    const t = c.tiles[Number(is)];
    if (!t) continue;
    if (gs) t.growthRemainingSec = Number(gs);
    if (ss) t.growSource = SOURCES[Number(ss)];
    if (ls) t.lushUntil = Number(ls);
  }
}
