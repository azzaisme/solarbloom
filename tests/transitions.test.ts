import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { SAVE_VERSION } from '../src/core/GameState';
import { packChunk, unpackChunk } from '../src/core/TilePack';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { trActive, trProgress } from '../src/gameplay/Transitions';
import { fill, ground, makeSim, PAD, rich } from './helpers';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);
const T = TUNING.transitions;

describe('Look 6.2: tile transitions in the sim (#171)', () => {
  it('a pulse plays the restore sequence for longer than the sim takes to restore (visual catch-up)', () => {
    const sim = makeSim(1);
    rich(sim);
    const t = ground(sim, PAD, 4, 4, 'prepared');
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(t.tr).toMatchObject({ k: 'restore', from: 0 });
    expect(t.tr!.d).toBeCloseTo(T.restore.pulse * sim.transitions.featureMult(t), 5);
    sim.advance(TUNING.pulse.growSeconds + 0.2);
    expect(t.ground).toBe('restored'); // the sim restored on time, as before Look 6…
    expect(trProgress(t.tr, sim.time)).toBeLessThan(0.2); // …while the visual is still early in the sequence
    sim.advance(T.restore.pulse + 1.5);
    expect(t.tr).toBeUndefined(); // finished transitions are swept
  });

  it('a restore straight from concrete (a chain step) starts the fast variant from the tile’s pollution', () => {
    const sim = makeSim(2);
    rich(sim);
    const t = ground(sim, PAD, 4, 4, 'polluted');
    t.pollution = 80;
    sim.restoration.complete(t, 'chain');
    expect(t.tr).toMatchObject({ k: 'restore', from: 80 });
    expect(t.tr!.d).toBeCloseTo(T.restore.fast * sim.transitions.featureMult(t), 5);
  });

  it('a seep softens concrete from the restored side, and the step to moss continues from the current look', () => {
    const sim = makeSim(3);
    rich(sim);
    fill(sim, 0, 2, 7, 7, 'polluted');
    const nb = sim.grid.get(PAD, 5, 4)!;
    nb.pollution = 50;
    const t = ground(sim, PAD, 4, 4, 'prepared');
    sim.restoration.complete(t, 'drone');
    expect(nb.tr).toMatchObject({ k: 'soften', from: 50, dir: 2 }); // the −x edge faces the restored tile
    expect(nb.pollution).toBe(50 - TUNING.restore.seep);
    sim.advance(T.soften / 2);
    sim.restoration.complete(sim.grid.get(PAD, 6, 4)!, 'drone'); // a second seep mid-softening: moss
    expect(nb.ground).toBe('prepared');
    expect(nb.tr!.k).toBe('moss');
    expect(nb.tr!.from).toBeGreaterThan(25); // between 50 (start) and 25 (target): never snaps
    expect(nb.tr!.from).toBeLessThan(50);
    expect(nb.tr!.dir).toBe(1);
  });

  it('nurture steps grow in, and a step during a step catches up instead of restarting', () => {
    const sim = makeSim(4);
    rich(sim);
    const t = ground(sim, PAD, 4, 4, 'restored');
    sim.restoration.pulse(t.id);
    expect(t.tr).toMatchObject({ k: 'bloom', from: 1 });
    expect(t.tr!.d).toBeCloseTo(T.bloom[2], 5);
    sim.advance(1);
    sim.restoration.pulse(t.id);
    expect(t.bloom).toBe(3);
    expect(t.tr).toMatchObject({ k: 'bloom', from: 1 });
    sim.advance(T.bloom[3] + 1.5);
    sim.restoration.grow(t); // automatic
    expect(t.tr!.d).toBeCloseTo(T.bloom[4] * T.autoMult, 5);
  });

  it('lush tiles soak from when they became lush, and staying lush keeps the start', () => {
    const sim = makeSim(5);
    rich(sim);
    const t = ground(sim, PAD, 4, 4, 'prepared');
    sim.advance(1);
    sim.restoration.complete(t, 'overflow');
    expect(t.lushAt).toBeCloseTo(sim.time, 5);
    const at = t.lushAt;
    sim.advance(2);
    sim.transitions.lush(t, sim.time + 25);
    expect(t.lushAt).toBe(at);
  });

  it('a tap knock moves a visual transition along, never past its end', () => {
    const sim = makeSim(6);
    rich(sim);
    const t = ground(sim, PAD, 4, 4, 'prepared');
    sim.restoration.pulse(t.id);
    const p0 = trProgress(t.tr, sim.time);
    expect(sim.transitions.knock(t)).toBe(true);
    expect(trProgress(t.tr, sim.time)).toBeCloseTo(p0 + T.knock.visual, 5);
    for (let i = 0; i < 20; i++) sim.transitions.knock(t);
    expect(trProgress(t.tr, sim.time)).toBe(1);
    expect(sim.transitions.knock(t)).toBe(false);
  });

  it('a district bloom rolls out as a wave: tiles further from the landmark start later', () => {
    const sim = makeSim(7);
    const d0 = sim.transitions;
    const near = ground(sim, PAD, 2, 2, 'polluted');
    const far = ground(sim, PAD, 6, 6, 'polluted');
    d0.restore(near, 'neighbourhood', 100, { quiet: true, delay: 0.1 });
    d0.restore(far, 'neighbourhood', 100, { quiet: true, delay: 0.4 });
    expect(trProgress(far.tr, sim.time + 0.2)).toBe(0);
    expect(trActive(far, sim.time)).toBe(true);
    expect(near.tr!.t0).toBeLessThan(far.tr!.t0);
  });
});

describe('Look 6.2: saving and offline (#171)', () => {
  it('save → load mid-transition continues where it was, byte for byte', () => {
    const sim = makeSim(11);
    rich(sim);
    fill(sim, 0, 2, 7, 7, 'polluted');
    const t = ground(sim, PAD, 4, 4, 'prepared');
    sim.restoration.pulse(t.id);
    const g = ground(sim, PAD, 2, 5, 'restored');
    sim.restoration.pulse(g.id); // bloom
    sim.restoration.complete(sim.grid.get(PAD, 6, 6)!, 'overflow'); // lush + restore
    sim.advance(1.3);
    const a = saver.serialize(sim.state);
    expect(JSON.parse(a).version).toBe(SAVE_VERSION);
    const copy = new Sim(saver.deserialize(a)!);
    expect(saver.serialize(copy.state)).toBe(a);
    for (const id of [t.id, g.id, `${PAD}:6:6`, `${PAD}:5:4`]) {
      const u = copy.grid.byTileId(id)!;
      const o = sim.grid.byTileId(id)!;
      expect(u.tr).toEqual(o.tr);
      expect(u.lushAt).toEqual(o.lushAt);
      expect(trProgress(u.tr, copy.time)).toBeCloseTo(trProgress(o.tr, sim.time), 5);
    }
  });

  it('packs and unpacks every transition kind (and a gameplay flag)', () => {
    const sim = makeSim(12);
    const c = sim.grid.loadedChunks().find((k) => k.layer === PAD)!;
    const tiles = c.tiles.filter((t) => t && !t.blocked && !t.occupantId).slice(0, 5);
    const kinds = ['soften', 'moss', 'restore', 'bloom', 'unblock'] as const;
    tiles.forEach((t, i) => sim.transitions.begin(t!, kinds[i], 2 + i, { dir: i, from: i * 10, g: i === 2 }));
    const packed = packChunk(c, sim.grid.seed, sim.grid.layer(PAD)!);
    for (const t of tiles) t!.tr = undefined;
    unpackChunk(c, packed);
    tiles.forEach((t, i) => expect(t!.tr).toMatchObject({ k: kinds[i], d: 2 + i, from: i * 10, ...(i ? { dir: i } : {}), ...(i === 2 ? { g: 1 } : {}) }));
  });

  it('saves from before Look 6 are scrapped (no migration, as agreed)', () => {
    const sim = makeSim(13);
    const json = saver.serialize(sim.state).replace(`"version":${SAVE_VERSION}`, `"version":${SAVE_VERSION - 1}`);
    expect(saver.parse(json)).toBe('scrapped');
  });

  it('offline progress finishes every visual transition, and a later-loaded chunk drops its stale ones', () => {
    const sim = makeSim(14);
    rich(sim);
    const t = ground(sim, PAD, 4, 4, 'prepared');
    sim.restoration.pulse(t.id);
    sim.advance(1);
    const r = sim.offline.apply(3600)!;
    expect(r.settled).toBeGreaterThan(0);
    expect(t.tr).toBeUndefined();
    // a saved chunk that loads after offline progress: its old transitions are finished too
    const u = ground(sim, PAD, 2, 2, 'restored');
    sim.transitions.begin(u, 'bloom', 5, { from: 1 });
    u.tr!.t0 = sim.transitions.finishedBefore - 1;
    sim.transitions.adopt(u);
    expect(u.tr).toBeUndefined();
  });

  it('the deterministic run is unchanged by transitions: two sims with the same inputs end identical', () => {
    const run = () => {
      const sim = makeSim(21);
      rich(sim);
      fill(sim, 0, 2, 7, 7, 'polluted');
      for (let i = 0; i < 600; i++) {
        if (i % 7 === 0) {
          const t = sim.grid.playableTiles().find((x) => sim.restoration.checkPulse(x).ok);
          if (t) sim.restoration.pulse(t.id);
        }
        sim.tick();
      }
      return saver.serialize(sim.state);
    };
    expect(run()).toBe(run());
  });
});
