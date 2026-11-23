import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { canStep, heightAt, levelAt, levelY, rampAt } from '../src/core/Height';
import { pickTerraced } from '../src/core/Picking';
import { KEEPERS, LANDING, OLD_CITY, REGIONS } from '../src/data/oldcity';
import { TERRAIN } from '../src/data/terrain';
import { Sim } from '../src/gameplay/Sim';
import { fallClearing } from '../src/data/terrain';
import { zoneAt } from '../src/rendering/PlantingZones';
import { fallFlow, showcaseFall, wastelandPieces } from '../src/rendering/Terrain';
import { treeSpot, treeWorldOf } from '../src/rendering/TreePlacement';
import type { LifeSpot } from '../src/rendering/WaterLife';
import { spawnPose, Walker } from '../src/gameplay/Walker';

/**
 * P7-E30 (#742, #743, #746, #747): the Falls overlook, the one real height change of the epic. A level-2 bluff in
 * Elder Grove over the head of Saltwind's canal, two levels (2.4 tiles) above the beach, reached by a stair from the
 * grove. Grid X/Z, tile ids and every other cell's level stay as they were.
 */
const O = TERRAIN.overlook;
const oldSim = (seed = 7) => new Sim(createInitialState(seed));
const grove = REGIONS.find((r) => r.id === 'elderGrove')!;

function openGrove(sim: Sim) {
  sim.state.areas.elderGrove = { fog: 'thinning', revealedAt: 0 };
  for (const [x, z] of grove.gate.cells) {
    const t = sim.grid.get(GROUND, x, z)!;
    t.blocked = false;
    t.unblocked = true;
  }
}

describe('P7-E30: the Falls overlook', () => {
  it('is a flat level-2 pad, 2.4 tiles over the beach and the canal, 1.2 over the grove', () => {
    for (let z = O.z; z < O.z + O.d; z++) for (let x = O.x; x < O.x + O.w; x++) expect(levelAt(x, z), `${x},${z}`).toBe(2);
    expect(levelY(levelAt(-2, 15)) - levelY(levelAt(-2, 16))).toBeCloseTo(2 * OLD_CITY.levelHeight, 5); // over the canal
    expect(levelY(levelAt(-4, 15)) - levelY(levelAt(-4, 16))).toBeCloseTo(2.4, 5); // over the beach
    expect(levelAt(-6, 13)).toBe(1); // the grove beside it
    expect(levelAt(0, 13)).toBe(1); // the park beside it
    // nothing else moved: the cells round it keep the levels they had
    for (const [x, z, lv] of [[-6, 15, 1], [-5, 11, 1], [-1, 9, 1], [-3, 16, 0], [8, 20, 0], [-20, -4, 2]] as const) expect(levelAt(x, z), `${x},${z}`).toBe(lv);
  });

  it('only its stair leads up: every other edge is a cliff, both ways', () => {
    expect(rampAt(-2, 10)?.ramp.kind).toBe('stair');
    expect(canStep(-2, 9, -2, 10)).toBe(true);
    expect(canStep(-2, 11, -2, 12)).toBe(true);
    for (let x = O.x; x < O.x + O.w; x++) {
      if (!rampAt(x, O.z - 1)) expect(canStep(x, O.z, x, O.z - 1), `${x} north`).toBe(false);
      expect(canStep(x, O.z + O.d - 1, x, O.z + O.d), `${x} south`).toBe(false);
      expect(canStep(x, O.z + O.d, x, O.z + O.d - 1), `${x} up from the beach`).toBe(false);
    }
    for (let z = O.z; z < O.z + O.d; z++) {
      expect(canStep(O.x, z, O.x - 1, z)).toBe(false);
      expect(canStep(O.x + O.w - 1, z, O.x + O.w, z)).toBe(false);
    }
    expect(heightAt(-1.5, 10.0)).toBeCloseTo(1, 5);
    expect(heightAt(-1.5, 12.0)).toBeCloseTo(2, 5);
  });

  it('bloombot walks from the grove up the stair onto the lip, and back to Moss', () => {
    const sim = oldSim();
    openGrove(sim);
    const w = new Walker(sim);
    const moss = KEEPERS.find((k) => k.id === 'moss')!;
    const from = { x: moss.x + 0.5, z: moss.z - 0.5 };
    expect(w.walkable(GROUND, Math.floor(from.x), Math.floor(from.z))).toBe(true);
    // the lip over the waterfall
    const lip = w.path(GROUND, from.x, from.z, (x, z) => x === -3 && z === O.z + O.d - 1, { x: -3, z: O.z + O.d - 1 });
    expect(lip).toBeDefined();
    // every cell of the pad
    for (let z = O.z; z < O.z + O.d; z++)
      for (let x = O.x; x < O.x + O.w; x++) {
        const t = sim.grid.get(GROUND, x, z)!;
        if (t.blocked) continue;
        expect(w.path(GROUND, from.x, from.z, (cx, cz) => cx === x && cz === z, { x, z }), `${x},${z}`).toBeDefined();
      }
    // and down again to the gate (so it never traps)
    const back = w.path(GROUND, -2.5, 14.5, (x, z) => x === grove.gate.cells[0][0] && z === grove.gate.cells[0][1], { x: -1, z: 7 });
    expect(back).toBeDefined();
  });

  it('walking stops at the lip, and the stair carries bloombot up', () => {
    const sim = oldSim();
    openGrove(sim);
    const w = new Walker(sim);
    const p = { roofId: GROUND, x: -2.5, z: 14.5, facing: 0 };
    for (let i = 0; i < 40; i++) w.move(p, 0, 0.1);
    expect(p.z).toBeLessThan(16);
    expect(heightAt(p.x, p.z)).toBe(2);
    const q = { roofId: GROUND, x: -1.5, z: 9.5, facing: 0 };
    for (let i = 0; i < 40; i++) w.move(q, 0, 0.1);
    expect(q.z).toBeGreaterThan(12);
    expect(heightAt(q.x, q.z)).toBe(2);
    // from the beach below, walking north into the bluff stops at its foot
    const r = { roofId: GROUND, x: -4.5, z: 18.5, facing: 0 };
    for (let i = 0; i < 40; i++) w.move(r, 0, -0.1);
    expect(r.z).toBeGreaterThan(16);
    expect(heightAt(r.x, r.z)).toBe(0);
  });

  it('a reload on the pad or the stair settles bloombot on legal ground', () => {
    const sim = oldSim();
    openGrove(sim);
    const w = new Walker(sim);
    for (const [x, z] of [[-2.5, 13.5], [-1.5, 10.6], [-4.9, 15.9], [-0.1, 12.2]]) {
      const p = { roofId: GROUND, x, z, facing: 0 };
      expect(w.settle(p)).toBe(true);
      expect(w.fits(GROUND, p.x, p.z)).toBe(true);
    }
  });

  it('the beach start still reaches the beach piles, and nothing new is saved', () => {
    const sim = oldSim();
    const w = new Walker(sim);
    const start = spawnPose(sim, w);
    expect([Math.floor(start.x), Math.floor(start.z)]).toEqual([Math.floor(LANDING.spawn[0]), Math.floor(LANDING.spawn[1])]);
    const beach = grove && REGIONS.find((r) => r.id === 'saltwind')!;
    for (const p of beach.piles.filter((q) => q.x > -2)) {
      const path = w.path(GROUND, start.x, start.z, (x, z) => Math.abs(x - p.x) + Math.abs(z - p.z) === 1, { x: p.x, z: p.z });
      expect(path, p.id).toBeDefined();
    }
    // level is generated, never saved: a fresh state has no tile deltas for the pad
    const json = JSON.stringify(createInitialState(7));
    expect(json.includes('"level"')).toBe(false);
  });

  it('picking straight down lands on the pad; a slanted ray from the beach hits the bluff, not the grove behind it', () => {
    const h = (x: number, z: number) => heightAt(x, z);
    const top = pickTerraced({ x: -2.5, y: 20, z: 13.5 }, { x: 0, y: -1, z: 0 }, 0.08, h)!;
    expect([Math.floor(top.fx), Math.floor(top.fz)]).toEqual([-3, 13]);
    // a low ray up the beach: it would reach the grove past the bluff, but meets the bluff's face at its lip
    const slant = pickTerraced({ x: -4.5, y: 1.0, z: 24 }, { x: 0, y: -0.05, z: -1 }, 0.08, h)!;
    expect(Math.floor(slant.fz)).toBe(15);
  });
});

/** A sink that only counts what is drawn. */
const counter = () => {
  let n = 0;
  return { sink: { grey: 0, add: () => void n++ }, count: () => n };
};

describe('P7-E30: the showcase waterfall (#745)', () => {
  it('runs as a trickle while its source is dead, and full once it is restored', () => {
    const sim = oldSim();
    const peek = (x: number, z: number) => sim.grid.peek(GROUND, x, z);
    expect(fallFlow(peek)).toBe(0);
    const dead = showcaseFall(counter().sink, 0, 0);
    const s = TERRAIN.fall.source;
    for (let z = s.z; z < s.z + s.d; z++) for (let x = s.x; x < s.x + s.w; x++) sim.grid.get(GROUND, x, z)!.ground = 'restored';
    expect(fallFlow(peek)).toBe(1);
    const full = showcaseFall(counter().sink, 0, 1);
    const sheets = (l: LifeSpot[]) => l.filter((q) => q.kind === 'sheet');
    // dead: the fall's sheet alone, thin; restored: the rill too, and a sheet about eight times as wide
    expect(sheets(dead.life).length).toBe(1);
    expect(sheets(full.life).length).toBe(2);
    expect(dead.width).toBeLessThan(0.3);
    expect(full.width).toBeGreaterThan(1.4);
    expect(full.life.filter((q) => q.kind === 'spray').length).toBeGreaterThan(0);
    expect(dead.life.filter((q) => q.kind === 'spray').length).toBe(0);
  });

  it('pours from the lip two levels down into the canal, landing on its water, centred on it', () => {
    const f = showcaseFall(counter().sink, 0, 1);
    const sheet = f.life.find((q) => q.kind === 'sheet' && q.range > 1)!;
    expect(f.drop).toBeGreaterThan(2 * OLD_CITY.levelHeight);
    expect(f.drop).toBeLessThan(2 * OLD_CITY.levelHeight + 0.3);
    // its foot is a canal cell, and the foam and mist sit there on the water
    expect(levelAt(Math.floor(f.foot.x), Math.floor(f.foot.z))).toBe(0);
    expect(Math.floor(f.foot.z)).toBe(16);
    for (const q of f.life.filter((q) => q.kind === 'foam' || q.kind === 'spray')) {
      expect(q.y).toBeCloseTo(f.foot.y, 5);
      expect(q.x).toBeGreaterThan(-3);
      expect(q.x).toBeLessThan(-1);
    }
    // the sheet sits inside the canal's two cells
    expect(sheet.x - sheet.size / 2).toBeGreaterThanOrEqual(-3);
    expect(sheet.x + sheet.size / 2).toBeLessThanOrEqual(-1);
  });

  it('keeps its rill and the overlook\'s lip clear: low planting, no trees', () => {
    const sim = oldSim();
    for (let z = 0; z < 24; z++) for (let x = -12; x < 6; x++) sim.grid.get(GROUND, x, z);
    const peek = (x: number, z: number) => sim.grid.peek(GROUND, x, z);
    const w = treeWorldOf(sim);
    for (let z = O.z; z < O.z + O.d; z++)
      for (let x = O.x; x < O.x + O.w; x++) {
        if (!fallClearing(x, z)) continue;
        const info = sim.areas.info(sim.areas.map.areaOfCell(x, z));
        expect(zoneAt(x, z, { peek, areaAt: (a, b) => sim.areas.map.areaOfCell(a, b), areaType: info.type, ignoreOccupants: true }), `${x},${z}`).toBe('landmark_clearance');
        expect(treeSpot(peek(x, z)!, info.type, w), `${x},${z}`).toBeUndefined();
      }
  });
});

describe('P7-E30: the wasteland (#758)', () => {
  it('is a pure function of the cell, with cracks common, path pieces occasional and debris rare', () => {
    expect(wastelandPieces(3, 9, 'earth')).toEqual(wastelandPieces(3, 9, 'earth'));
    const n = { crack: 0, path: 0, panel: 0, pole: 0, litter: 0 };
    const N = 80 * 80;
    for (let z = 0; z < 80; z++) for (let x = 0; x < 80; x++) for (const p of wastelandPieces(x - 40, z - 40, 'earth')) n[p]++;
    const W = TERRAIN.wasteland;
    expect(n.crack / N).toBeGreaterThan(W.cracks * 0.85);
    expect(n.crack / N).toBeLessThan(W.cracks * 1.15);
    expect(n.path / N).toBeGreaterThan(W.pathPieces * 0.6);
    expect(n.path / N).toBeLessThan(W.pathPieces * 1.3);
    expect((n.panel + n.pole) / N).toBeGreaterThan(W.debris * 0.6);
    expect((n.panel + n.pole) / N).toBeLessThan(W.debris * 1.4);
    expect(n.panel).toBeGreaterThan(0);
    expect(n.pole).toBeGreaterThan(0);
    expect(n.litter).toBe(0);
  });

  it('a dead beach gets only litter (no cracks: it stays a beach), dead paving only cracks', () => {
    let litter = 0;
    for (let z = 0; z < 60; z++)
      for (let x = 0; x < 60; x++) {
        const s = wastelandPieces(x, z, 'sand');
        expect(s.every((p) => p === 'litter')).toBe(true);
        litter += s.length;
        expect(wastelandPieces(x, z, 'paving').every((p) => p === 'crack')).toBe(true);
      }
    expect(litter / 3600).toBeGreaterThan(TERRAIN.wasteland.beachLitter * 0.7);
    expect(litter / 3600).toBeLessThan(TERRAIN.wasteland.beachLitter * 1.3);
  });
});
