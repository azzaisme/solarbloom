import { expect, it } from 'vitest';
import { FORM_SPECIES, treeGeo, type Form, type Species, type TreeGeo } from '../src/rendering/TreeGen';
import { SEM_A, SEM_B, SEM_LEAF } from '../src/rendering/transitions/TransitionMaterial';
import { TrMeshBuilder } from '../src/rendering/transitions/TrMeshBuilder';
import { headlessApp } from './helpers';

it('starts with a few open leaves and reserves most blades for later growth', () => {
  const trees: [Form, Species][] = [
    ['standard', 'oak'], ['standard', 'pine'], ['standard', 'willow'],
    ...Object.entries(FORM_SPECIES) as [Form, Species][],
  ];
  const visible = ({ pos, leafStarts }: TreeGeo) =>
    leafStarts!.reduce((count, start) => {
      const root = start * 4;
      const tip = root + 8;
      return count + Number(Math.hypot(pos[tip] - pos[root], pos[tip + 1] - pos[root + 1], pos[tip + 2] - pos[root + 2]) > 1e-5);
    }, 0);
  for (const [form, species] of trees) {
    for (const lod of [0, 1, 2] as const) {
      const [sapling, young, grown] = ([1, 2, 3] as const).map((stage) => visible(treeGeo(species, stage, 1, lod, form)));
      const label = `${form} ${species} LOD ${lod}`;
      expect(sapling, label).toBeGreaterThan(0);
      expect(sapling, label).toBeLessThan(grown * 0.2);
      expect(young, label).toBeGreaterThan(sapling);
      expect(young, label).toBeLessThan(grown * 0.6);
    }
  }
});

it('staggers leaf blades while their attachment points follow the branch', () => {
  const { device, destroy } = headlessApp();
  try {
    const from = treeGeo('oak', 2, 1);
    const grown = treeGeo('oak', 3, 1);
    const builder = new TrMeshBuilder();
    builder.addGeo(from, -1, 0, 0, 0, 1);
    const first = builder.verts;
    builder.addGeo(grown, 1, 0, 0, 0, 1, { from, next: from, ageMix: 0, t0: 0, duration: 4 });
    const end = builder.verts;
    builder.addGeo(from, 3, 0, 0, 0, 1);
    const mesh = builder.build(device)!;
    const openings: number[] = [], deadlines: number[] = [], changes: number[] = [];
    mesh.getVertexStream(SEM_A, openings);
    mesh.getVertexStream(SEM_B, deadlines);
    mesh.getVertexStream(SEM_LEAF, changes);
    const times = new Set<number>();
    for (const start of grown.leafStarts!) {
      const root = first + start;
      expect(changes.slice(root * 3, root * 3 + 3)).toEqual([0, 0, 0]);
      const open = openings[root * 4 + 3];
      expect(open).toBeGreaterThan(0);
      expect(deadlines[root * 4 + 3]).toBeGreaterThan(open);
      expect(deadlines[root * 4 + 3]).toBeLessThan(1);
      times.add(open);
    }
    expect(times.size).toBeGreaterThan(5);
    expect(changes.slice(first * 3, end * 3).some(Boolean)).toBe(true);
    expect(changes.slice(0, first * 3).some(Boolean)).toBe(false);
    expect(changes.slice(end * 3).some(Boolean)).toBe(false);
    mesh.destroy();
  } finally {
    destroy();
  }
});
