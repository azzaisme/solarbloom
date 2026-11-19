import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { batchCredits, E23_MODELS, type Batch } from '../src/data/e23models';

/**
 * E23.10.2 (#406, #464–#468): the E23 model list. Reused models must exist; names are unique; every new model has a
 * budget and a batch; the batch costs match docs/art/e23-models.md; and every new model whose file has landed is
 * within its LOD0 budget (files not generated yet are listed, not failed: Meshy spend waits for the owner).
 */
const DIR = 'assets/raw/models/final';
/** The animals (B4) live where the wildlife visitors load them (#544): assets/raw/models/visitors/<id>.glb. */
const VISITORS = 'assets/raw/models/visitors';
const fileOf = (name: string) => (name.startsWith('animal-') ? `${VISITORS}/${name.slice(7)}.glb` : `${DIR}/${name}.glb`);
const have = new Set(readdirSync(DIR).filter((f) => f.endsWith('.glb') && !f.includes('.lod1')).map((f) => f.slice(0, -4)));

/** Triangles drawn by a GLB: every mesh node's triangle primitives, counted per node instance. */
export function glbTriangles(path: string): number {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const len = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    nodes?: { mesh?: number }[];
    meshes: { primitives: { mode?: number; indices?: number; attributes: { POSITION: number } }[] }[];
    accessors: { count: number }[];
  };
  const perMesh = gltf.meshes.map((m) =>
    m.primitives.filter((p) => (p.mode ?? 4) === 4).reduce((s, p) => s + gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0),
  );
  const nodes = (gltf.nodes ?? []).filter((n) => n.mesh !== undefined);
  return nodes.length ? nodes.reduce((s, n) => s + perMesh[n.mesh!], 0) : perMesh.reduce((a, b) => a + b, 0);
}

describe('E23.10.2: the E23 model list', () => {
  it('names are unique, reuse sources exist, new models have a budget and a batch', () => {
    const names = E23_MODELS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    for (const m of E23_MODELS) {
      if (m.route === 'reuse') expect(have.has(m.from!), `${m.name} reuses ${m.from}`).toBe(true);
      if (m.route === 'text' || m.route === 'image') {
        expect(m.tris, m.name).toBeGreaterThan(0);
        expect(m.batch, m.name).toBeDefined();
      }
    }
  });

  it('every child issue’s objects are on the list', () => {
    const need = [
      'charger', 'battery', 'wind-turbine', 'power-pole', 'large-solar-array', // #464
      'pump', 'pipe-joint', 'reservoir', 'desalination-plant', 'sprinkler', 'feed-tank', // #465
      'planter-box', 'compost-bin', 'bio-digester', 'beehive', 'fish-pond', 'mushroom-log', 'worm-bin', 'bird-box', 'bat-box', 'hedgehog-house', 'crop-seedling', 'crop-pumpkin', // #466
      'crafting-table', 'research-station', 'mulcher', 'assembler', 'chest', 'small-chest', // #467
      'animal-fox', 'animal-hedgehog', 'animal-squirrel', 'animal-otter', 'animal-owl', 'animal-magpie', 'animal-frog', 'animal-bumblebee', // #468
    ];
    const names = new Set(E23_MODELS.map((m) => m.name));
    for (const n of need) expect(names.has(n), n).toBe(true);
    // rule 8: the Lucky Cats stay hidden, so no animal may be a cat
    expect(E23_MODELS.filter((m) => /cat\b|kitten/.test(m.name))).toEqual([]);
  });

  it('batch costs match docs/art/e23-models.md', () => {
    const cost: Record<Batch, number> = { A: 63, B1: 114, B2: 117, B3: 111, B4: 288, B5: 60, B6: 240 };
    for (const [b, c] of Object.entries(cost)) expect(batchCredits(b as Batch), b).toBe(c);
    const doc = readFileSync('docs/art/e23-models.md', 'utf8');
    expect(doc).toContain(`**${Object.values(cost).reduce((a, b) => a + b, 0)}**`);
  });

  it('the triangle counter reads existing models', () => {
    for (const n of ['bench', 'bloom-relay', 'reservoir-basin']) expect(glbTriangles(`${DIR}/${n}.glb`), n).toBeGreaterThan(50);
  });

  it('the bench bloombot sits on is within its obstacle budget (1,200; it was 1,924 before build_props fitted it)', () => {
    const t = glbTriangles(`${DIR}/bench.glb`);
    expect(t).toBeGreaterThan(50);
    expect(t).toBeLessThanOrEqual(1200);
    expect(glbTriangles(`${DIR}/bench.lod1.glb`)).toBeLessThanOrEqual(300);
  });

  it('every new model that has landed is within its LOD0 budget, and its LOD1 within the far budget', () => {
    const fresh = E23_MODELS.filter((m) => m.route === 'text' || m.route === 'image');
    const landed = fresh.filter((m) => existsSync(fileOf(m.name)));
    const missing = fresh.filter((m) => !landed.includes(m)).map((m) => m.name);
    if (missing.length) console.log(`E23 models not generated yet (${missing.length}): ${missing.join(', ')}`);
    for (const m of landed) expect(glbTriangles(fileOf(m.name)), m.name).toBeLessThanOrEqual(m.tris!);
    // the far version: at most 1,000 (the machine class's LOD1 budget) and well under the near one
    for (const m of landed) {
      const far = glbTriangles(fileOf(m.name).replace(/\.glb$/, '.lod1.glb'));
      expect(far, `${m.name}.lod1`).toBeLessThanOrEqual(Math.min(1000, Math.ceil(m.tris! / 2)));
    }
  });

  it('the hand-built fences and trellis (#466) have all landed, within budget, with their moving parts', () => {
    const built = E23_MODELS.filter((m) => m.route === 'built');
    expect(built.length).toBe(16);
    const nodeNames = (path: string) => {
      const buf = readFileSync(path);
      const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as { nodes?: { name?: string }[] };
      return (gltf.nodes ?? []).map((n) => n.name);
    };
    for (const m of built) {
      expect(existsSync(`${DIR}/${m.name}.glb`), m.name).toBe(true);
      expect(glbTriangles(`${DIR}/${m.name}.glb`), m.name).toBeLessThanOrEqual(m.tris!);
      expect(glbTriangles(`${DIR}/${m.name}.lod1.glb`), `${m.name}.lod1`).toBeLessThanOrEqual(200);
      const parts = nodeNames(`${DIR}/${m.name}.glb`);
      if (m.name.endsWith('-gate')) expect(parts, `${m.name} swings its gate`).toContain('gate');
      if (m.name.startsWith('fence-hedge')) expect(parts, `${m.name} sways its leaves`).toContain('leaves');
    }
  });

  it('every B4 animal is rigged with its four clips (#468): idle, follow, sit and climb', () => {
    const animals = E23_MODELS.filter((m) => m.name.startsWith('animal-')).map((m) => m.name.slice(7));
    expect(animals.length).toBe(16);
    for (const a of animals) {
      for (const f of [`${VISITORS}/${a}.glb`, `${VISITORS}/${a}.lod1.glb`]) {
        const buf = readFileSync(f);
        const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as {
          skins?: { joints: number[] }[];
          animations?: { name?: string; channels: unknown[] }[];
        };
        expect(gltf.skins?.[0]?.joints.length ?? 0, `${f} has a skeleton`).toBeGreaterThanOrEqual(4);
        const clips = (gltf.animations ?? []).map((c) => c.name).sort();
        expect(clips, `${f} clips`).toEqual(['climb', 'follow', 'idle', 'sit']);
        for (const c of gltf.animations ?? []) expect(c.channels.length, `${f} ${c.name} moves`).toBeGreaterThan(0);
      }
    }
  });
});
