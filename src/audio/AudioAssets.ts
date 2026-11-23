/**
 * Phase 8 A08: the production audio registry. Every shipped file lives under assets/audio/ (baked from the raw
 * masters in assets/raw/audio by tools/audio/bake.py) and is listed with its provenance in
 * docs/audio/ASSET_MANIFEST.csv. An asset's id is its path under assets/audio without the extension, e.g.
 * `ambience/barren/wind-dry`; variations end in `-01`, `-02`, …
 *
 * URLs only: nothing is downloaded until a sound asks for it (short effects are fetched at unlock, beds and
 * music when they first play). A missing id is simply silent.
 */
const FILES = import.meta.glob('../../assets/audio/**/*.{ogg,mp3,wav}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const PREFIX = '../../assets/audio/';

const URLS = new Map<string, string>();
for (const [path, url] of Object.entries(FILES)) URLS.set(path.slice(PREFIX.length).replace(/\.(ogg|mp3|wav)$/, ''), url);

/** The URL for an asset id, or undefined when that file is not in the build. */
export function audioUrl(id: string): string | undefined {
  return URLS.get(id);
}

/** All variations of a sound (`base-01`, `base-02`, …, sorted), or `[base]` alone if it has none. */
export function variants(base: string): string[] {
  const out = [...URLS.keys()].filter((k) => k.startsWith(base + '-') && /-\d\d$/.test(k)).sort();
  if (out.length) return out;
  return URLS.has(base) ? [base] : [];
}

/** Every asset id in the build (the debug HUD and tests list them). */
export function audioIds(): string[] {
  return [...URLS.keys()].sort();
}
