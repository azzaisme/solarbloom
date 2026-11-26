// P7-E31 (#717): landmark hierarchy, stages and the dressing's footprint.
import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';
import { PARK } from '../src/core/Areas';
import { REGIONS } from '../src/data/oldcity';
import { MOVE_LAND, MOVE_TRIPS } from '../src/data/moveSpots';
import { FOOTPRINT_HALF, LANDMARK_LOOK, landmarkDress, landmarkHierarchy, landmarkStage } from '../src/data/landmarks';

declare global {
  interface ImportMeta {
    glob(pattern: string, opts: { query: string; import: string; eager: true }): Record<string, string>;
  }
}

describe('P7-E31 landmark hierarchy (#748)', () => {
  const all = landmarkHierarchy();

  it('has exactly one major focal landmark per region, and the park fountain for the park', () => {
    for (const r of REGIONS) {
      const major = all.filter((d) => d.region === r.id && d.tier === 'major');
      expect(major.map((d) => d.name)).toEqual([r.landmark.name]);
    }
    expect(all.filter((d) => d.region === PARK && d.tier === 'major').map((d) => d.kind)).toEqual(['fountain']);
  });

  it('gives every region medium destinations (its Keeper and lookout) and small story props', () => {
    for (const r of REGIONS) {
      const mine = all.filter((d) => d.region === r.id);
      expect(mine.filter((d) => d.tier === 'medium').length).toBeGreaterThanOrEqual(2);
      expect(mine.filter((d) => d.tier === 'small').length).toBeGreaterThanOrEqual(2);
    }
    // Saltwind's: the Sea Lock, Tide's home, its lookout and its vault
    const sw = all.filter((d) => d.region === 'saltwind' && d.tier !== 'small').map((d) => d.kind);
    expect(sw).toEqual(['landmark', 'keeper', 'lookout', 'vault']);
  });
});

describe('P7-E31 landmark stages (#751, #753)', () => {
  it('is ruined until a first share of the need is restored, restoring after, thriving only once woken', () => {
    expect(landmarkStage(false, 0, 100)).toEqual({ stage: 'ruined', k: 0 });
    expect(landmarkStage(false, LANDMARK_LOOK.restoringFrom * 100 - 1, 100).stage).toBe('ruined');
    const a = landmarkStage(false, 40, 100);
    const b = landmarkStage(false, 80, 100);
    expect(a.stage).toBe('restoring');
    expect(b.stage).toBe('restoring');
    expect(b.k).toBeGreaterThan(a.k);
    // past the need it is still only restoring: the wake (an existing goal) finishes it
    const full = landmarkStage(false, 500, 100);
    expect(full.stage).toBe('restoring');
    expect(full.k).toBeCloseTo(LANDMARK_LOOK.restoringK[1]);
    expect(full.k).toBeLessThan(1);
    expect(landmarkStage(true, 0, 100)).toEqual({ stage: 'thriving', k: 1 });
    expect(landmarkStage(false, 5, 0)).toEqual({ stage: 'ruined', k: 0 });
  });
});

describe('P7-E31 protects the playable layout (#754)', () => {
  const kinds = [...new Set(REGIONS.map((r) => r.landmark.kind))];

  it('keeps every lantern, pot, ivy patch and apron inside the landmark footprint', () => {
    for (const k of kinds) {
      const d = landmarkDress(k);
      for (const p of [...d.lanterns, ...d.pots, ...d.ivy]) {
        expect(Math.abs(p.x), `${k} x`).toBeLessThanOrEqual(FOOTPRINT_HALF - 0.05);
        expect(Math.abs(p.z), `${k} z`).toBeLessThanOrEqual(FOOTPRINT_HALF - 0.05);
      }
      if (d.apron) expect(Math.max(d.apron.hx, d.apron.hz)).toBeLessThanOrEqual(FOOTPRINT_HALF);
    }
  });

  it('dresses only kinds that exist, and is a pure function of the kind', () => {
    for (const k of Object.keys(LANDMARK_LOOK.kinds)) expect(kinds).toContain(k);
    expect(landmarkDress('sealock')).toEqual(landmarkDress('sealock'));
  });

  it("stands the Sea Lock's beacon on open water that no walk, trip or gate uses", () => {
    const sim = new Sim(createInitialState(1234));
    for (const r of REGIONS) {
      const b = landmarkDress(r.landmark.kind).beacon;
      if (!b) continue;
      const cx = r.landmark.x + 1 + b.dx;
      const cz = r.landmark.z + 1 + b.dz;
      // the beacon's base (its model is 1.41 m round at scale 1) and its rock (drawn 1.6 × rock across x)
      const rad = Math.max(1.41 * b.scale, b.rock * 1.6);
      const cells = new Set<string>();
      for (const [ox, oz] of [[0, 0], [-rad, 0], [rad, 0], [0, -rad], [0, rad]]) cells.add(`${Math.floor(cx + ox)},${Math.floor(cz + oz)}`);
      const inRect = (x: number, z: number, c: { x: number; z: number; w: number; d: number }) => x >= c.x && x < c.x + c.w && z >= c.z && z < c.z + c.d;
      for (const key of cells) {
        const [x, z] = key.split(',').map(Number);
        const t = sim.grid.get(GROUND, x, z)!;
        expect(t.feature, `${r.id} beacon cell ${key}`).toBe('water');
        expect(t.prop?.startsWith('gate:') ?? false, `${key} is a gate`).toBe(false);
        for (const trip of MOVE_TRIPS) for (const c of [trip.from, trip.at]) expect(inRect(x, z, c), `${key} in ${trip.id}`).toBe(false);
        for (const l of MOVE_LAND) expect(inRect(x, z, l), `${key} on ${l.id}`).toBe(false);
      }
    }
  });

  it('never reaches the simulation: the dressing and its data neither import gameplay nor write state', () => {
    const src = import.meta.glob(['../src/rendering/LandmarkDressing.ts', '../src/data/landmarks.ts'], { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(src).length).toBe(2);
    for (const [f, s] of Object.entries(src)) {
      expect(s, f).not.toMatch(/from '\.\.\/gameplay\//);
      expect(s, f).not.toMatch(/\bstate\./);
    }
  });
});
