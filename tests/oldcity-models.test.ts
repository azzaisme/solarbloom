import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GATE_MODELS, KEEPERS, KEEPSAKES, MODEL_NAMES, OLD_LANDMARK_MODELS, PARK_SET, REGIONS } from '../src/data/oldcity';

describe('E21: the Old City model list', () => {
  it('every model the Old City draws is in MODEL_NAMES, and every stand-in is an existing file or procedural', () => {
    const have = new Set(readdirSync('assets/raw/models/final').filter((f) => f.endsWith('.glb') && !f.includes('.lod1')).map((f) => f.slice(0, -4)));
    const piles = [...PARK_SET.piles, ...REGIONS.flatMap((r) => r.piles)].map((p) => p.model);
    const used = [...KEEPERS.map((k) => `keeper-${k.id}`), ...Object.values(GATE_MODELS), ...Object.values(OLD_LANDMARK_MODELS), ...KEEPSAKES.map((k) => k.model), 'storage-chest', 'reclaimer', 'jetty'];
    for (const n of used) expect(MODEL_NAMES[n], n).toBeDefined();
    for (const n of piles) expect(MODEL_NAMES[n] !== undefined || have.has(n), n).toBe(true);
    for (const [n, m] of Object.entries(MODEL_NAMES)) expect(m.standIn === 'procedural' || have.has(m.standIn), `${n} -> ${m.standIn}`).toBe(true);
    // the 58 files of docs/art/old-city-models.md
    expect(Object.keys(MODEL_NAMES)).toHaveLength(58);
  });
});
