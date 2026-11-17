import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { decorKey, decorOccupant } from '../src/core/Decor';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { TileData } from '../src/core/types';
import { DECOR_OPTION, DECOR_OPTIONS, PLOT_OPTIONS } from '../src/data/cozy';
import { TUNING } from '../src/data/tuning';
import { DECOR_IN_WAY } from '../src/gameplay/BuildSystem';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';
import { DECOR_ART, drawDecor } from '../src/rendering/DecorArt';
import { runBot } from './bots';
import { fill, makeSim, PAD, rich } from './helpers';

/** The test pad, fully restored and in full bloom, with a Drone Hub: only tiles left at bloom 1 can be nurtured. */
function padScene() {
  const sim = makeSim();
  rich(sim);
  fill(sim, 0, 0, 7, 7, 'restored');
  for (const t of sim.grid.tilesOf(PAD)) if (t.ground === 'restored') t.bloom = TUNING.restore.maxBloom;
  sim.production.markDirty();
  const cozy = new Cozy(sim);
  cozy.groundOnly = false; // the pad is a raised layer
  return { sim, cozy };
}

/** A city whose park is cleared, with a row of restored ground beside the park's starting panel. */
function parkScene(seed = 77) {
  const sim = new Sim(createInitialState(seed));
  sim.areas.clear(PARK, true);
  const cozy = new Cozy(sim);
  const cells: TileData[] = [];
  for (const t of sim.areas.tiles(PARK)) {
    if (cells.length >= 6) break;
    if (t.blocked || t.occupantId || t.feature === 'water' || cozy.spotAt(GROUND, t.x, t.z)) continue;
    t.ground = 'restored';
    t.pollution = 0;
    t.bloom = Math.max(1, t.bloom);
    sim.grid.touch(t);
    cells.push(t);
  }
  return { sim, cozy, cells };
}

describe('E19.2.1 decorations occupy their tile like a machine', () => {
  it('drones, pulses and building treat a decorated tile exactly as a machine’s tile', () => {
    // Three runs of the same pad: a machine on M and a decoration on D, the same spots left free, and both
    // spots taken again (so drones have nothing else to do). Only the free run may touch M or D.
    const M = { x: 6, z: 3 };
    const D = { x: 3, z: 6 };
    const run = (take: boolean) => {
      const { sim, cozy } = padScene();
      for (const c of [M, D]) sim.grid.get(PAD, c.x, c.z)!.bloom = 1;
      const hub = sim.build.place('droneHub', PAD, 4, 4)!;
      expect(hub).toBeDefined();
      if (take) {
        expect(sim.build.place('solar', PAD, M.x, M.z)).toBeDefined();
        expect(cozy.placeDecor('bench', 1, PAD, D.x, D.z)).toBeUndefined();
      }
      const touched = new Set<string>();
      sim.bus.on('drone.jobStarted', (e) => touched.add(e.tileId));
      sim.bus.on('tile.nurtured', (e) => touched.add(e.tile.id));
      // Pulses around them every few seconds. Like the game, a pulse aimed at an occupied tile acts on what stands
      // there instead (a machine is selected; a decoration is picked up), so pulses land on free tiles only.
      for (let s = 0; s < 60; s++) {
        sim.advance(1);
        if (s % 3 === 0) for (const t of sim.grid.tilesOf(PAD)) if (!t.occupantId && t.ground === 'restored' && t.bloom < TUNING.restore.maxBloom) sim.restoration.pulse(t.id);
      }
      const m = sim.grid.get(PAD, M.x, M.z)!;
      const d = sim.grid.get(PAD, D.x, D.z)!;
      return { sim, cozy, m, d, touched };
    };
    const free = run(false);
    // the control: left free, both spots are worked on
    expect(free.m.bloom).toBeGreaterThan(1);
    expect(free.d.bloom).toBeGreaterThan(1);
    const taken = run(true);
    for (const t of [taken.m, taken.d]) {
      expect(t.ground).toBe('restored'); // the tile stays restored (and counts for milestones)
      expect(t.bloom, t.id).toBe(1); // never nurtured
      expect(taken.touched.has(t.id), t.id).toBe(false); // never a drone's or a pulse's target
    }
    // a pulse sent straight at either tile (the sim's own call) is judged the same way
    expect(JSON.stringify(taken.sim.restoration.checkPulse(taken.d))).toBe(JSON.stringify(taken.sim.restoration.checkPulse(taken.m)));
    expect(taken.m.occupantId).toBe(taken.sim.state.machines.find((x) => x.type === 'solar' && x.x === M.x)!.id);
    expect(taken.d.occupantId).toBe(decorOccupant(decorKey(PAD, D.x, D.z)));
    // Building over either is refused; over the decoration the reason says to remove it first.
    expect(taken.sim.build.check('condenser', PAD, M.x, M.z).reason).toMatch(/already here/);
    expect(taken.sim.build.check('condenser', PAD, D.x, D.z).reason).toBe(DECOR_IN_WAY);
    // A second decoration can't go on either tile either.
    expect(taken.cozy.canDecorate('lantern', PAD, M.x, M.z)).toMatch(/already here/);
    expect(taken.cozy.canDecorate('lantern', PAD, D.x, D.z)).toBe(DECOR_IN_WAY);
    // Removing is free and instant: the tile is free at once.
    const before = JSON.stringify(taken.sim.state.resources);
    expect(taken.cozy.removeDecor(PAD, D.x, D.z)?.kind).toBe('bench');
    expect(taken.d.occupantId).toBeUndefined();
    expect(JSON.stringify(taken.sim.state.resources)).toBe(before);
    expect(taken.sim.build.check('condenser', PAD, D.x, D.z).ok).toBe(true);
    expect(taken.sim.state.cozy?.decor).toBeUndefined(); // sparse: nothing left behind
  });

  it('a decoration is refused where a machine would be (fog, unrestored ground, growing, occupied)', () => {
    const { sim, cozy } = padScene();
    const t = sim.grid.get(PAD, 5, 5)!;
    t.ground = 'polluted';
    expect(cozy.canDecorate('bench', PAD, 5, 5)).toMatch(/Restore/);
    expect(cozy.canDecorate('nope', PAD, 4, 2)).toBeDefined();
    expect(cozy.canDecorate('lamppost', PAD, 4, 2)).toMatch(/Unlocks/); // not earned yet
    expect(cozy.canDecorate('bench', PAD, 7, 0)).toBeDefined(); // a vent
    const city = new Cozy(sim);
    expect(city.canDecorate('bench', PAD, 4, 2)).toMatch(/ground/); // rooftops come later
  });

  it('solid decorations block bloombot; flat ones can be walked over', () => {
    const { sim, cozy } = padScene();
    const w = new Walker(sim);
    expect(w.walkable(PAD, 5, 5)).toBe(true);
    expect(cozy.placeDecor('flowerbed', 0, PAD, 5, 5)).toBeUndefined();
    expect(DECOR_OPTION.flowerbed.solid).toBe(false);
    expect(w.walkable(PAD, 5, 5)).toBe(true);
    cozy.removeDecor(PAD, 5, 5);
    expect(cozy.placeDecor('bench', 0, PAD, 5, 5)).toBeUndefined();
    expect(w.walkable(PAD, 5, 5)).toBe(false);
    expect(cozy.decorSolid(PAD, 5, 5)).toBe(true);
  });
});

describe('E19.2.1 decorations are saved', () => {
  it('save → load → save is byte-identical, occupancy comes back, and an old save loads unchanged', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const { sim, cozy, cells } = parkScene();
    expect(cells.length).toBe(6);
    const kinds = ['bench', 'lantern', 'pot', 'flowerbed'];
    // placed out of order, turned every way
    for (const [i, t] of [...cells].reverse().slice(0, 4).entries()) expect(cozy.placeDecor(kinds[i], i, GROUND, t.x, t.z), t.id).toBeUndefined();
    expect(Object.keys(sim.state.cozy!.decor!)).toEqual(Object.keys(sim.state.cozy!.decor!).sort());
    const a = saver.serialize(sim.state);
    const copy = new Sim(saver.deserialize(a)!);
    const b = saver.serialize(copy.state);
    expect(b).toBe(a);
    const c2 = new Cozy(copy);
    expect(c2.decorCount()).toBe(4);
    for (const d of c2.decorations()) {
      expect(copy.grid.get(GROUND, d.x, d.z)!.occupantId).toBe(decorOccupant(d.key)); // stamped as its chunk loads
      expect(cozy.decorAt(GROUND, d.x, d.z)).toEqual(d); // kind and turn kept
    }
    expect(c2.decorations().map((d) => d.rot).sort()).toEqual([0, 1, 2, 3]);
    // A save from before E19.2 has no decorations: it loads and saves exactly as it did.
    const old = JSON.parse(a);
    delete old.cozy;
    const oldJson = JSON.stringify(old);
    const oldSim = new Sim(saver.deserialize(oldJson)!);
    expect(new Cozy(oldSim).decorCount()).toBe(0);
    expect(oldSim.state.cozy).toBeUndefined();
    expect(saver.serialize(oldSim.state)).toBe(saver.serialize(new Sim(saver.deserialize(oldJson)!).state));
  });
});

describe('E19.2.2 decoration set and unlocks', () => {
  it('about a dozen decorations, ids unique, each with art inside a small budget, keepsakes from cats', () => {
    expect(DECOR_OPTIONS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(DECOR_OPTIONS.map((o) => o.id)).size).toBe(DECOR_OPTIONS.length);
    expect(DECOR_OPTIONS.some((o) => 'keepsake' in o.unlock)).toBe(true);
    expect(DECOR_OPTIONS.some((o) => o.solid) && DECOR_OPTIONS.some((o) => !o.solid)).toBe(true);
    for (const o of DECOR_OPTIONS) {
      expect(DECOR_ART, o.id).toContain(o.id);
      for (const rot of [0, 1, 2, 3])
        for (const far of [false, true]) {
          let tris = 0;
          let models = 0;
          drawDecor({ add: () => (tris += 80), foliage: (g) => (tris += g.tris), model: () => (models++, false), lod: far ? 0 : 1 }, o.id, 4.5, 0.1, 7.5, rot, far);
          expect(tris, `${o.id} ${far ? 'far' : 'near'}`).toBeGreaterThan(0);
          expect(tris, o.id).toBeLessThan(far ? 400 : 2500);
        }
    }
    // never sharing an id with a plot option (their unlock lists are kept apart anyway)
    for (const o of DECOR_OPTIONS) expect(PLOT_OPTIONS.some((p) => p.id === o.id), o.id).toBe(false);
  });

  it('an unlock happens once, survives a reload, and a keepsake waits for a cat', () => {
    const saver = new SaveService(undefined);
    const sim = new Sim(createInitialState(5));
    const cozy = new Cozy(sim);
    expect(cozy.checkDecorUnlocks()).toEqual([]);
    expect(sim.state.cozy).toBeUndefined(); // nothing earned, nothing written
    sim.areas.clearedCount = () => 2;
    const got = cozy.checkDecorUnlocks().map((o) => o.id);
    expect(got).toEqual(['bunting', 'cratestack', 'barrel']);
    expect(cozy.checkDecorUnlocks()).toEqual([]); // once each
    expect(cozy.isDecorUnlocked(DECOR_OPTION.catstatue)).toBe(false);
    sim.state.stats.catsFound = 1;
    expect(cozy.checkDecorUnlocks().map((o) => o.id)).toEqual(['catstatue']);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    copy.areas.clearedCount = () => 2;
    const c2 = new Cozy(copy);
    expect(c2.checkDecorUnlocks()).toEqual([]);
    expect(c2.isDecorUnlocked(DECOR_OPTION.barrel)).toBe(true);
    expect(c2.isDecorUnlocked(DECOR_OPTION.catstatue)).toBe(true);
    expect(c2.decorChoices().find((c) => c.option.id === 'topiary')?.hint).toMatch(/4 areas/);
  });
});

describe('E19.2 stays cosmetic for the pacing bots', () => {
  it('a bot that checks every unlock each second (and never decorates) ends exactly as one that does not', { timeout: 240_000 }, () => {
    const saver = new SaveService(undefined);
    saver.now = () => 0;
    const strip = (s: string) => {
      const o = JSON.parse(s);
      delete o.cozy;
      return JSON.stringify(o);
    };
    let plain: Sim | undefined;
    runBot({ seed: 21, minutes: 12, onSecond: (sim) => (plain = sim) });
    let checked: Sim | undefined;
    let earned = 0;
    runBot({
      seed: 21,
      minutes: 12,
      onSecond: (sim) => {
        checked = sim;
        const cozy = ((sim as unknown as { __cozy?: Cozy }).__cozy ??= new Cozy(sim));
        earned += cozy.checkUnlocks().length + cozy.checkDecorUnlocks().length;
        // the build-mode check runs every frame in the game: it must not change anything either
        for (const t of sim.grid.tilesOf(GROUND).slice(0, 40)) cozy.canDecorate('bench', GROUND, t.x, t.z);
      },
    });
    expect(earned).toBeGreaterThan(0); // unlocks really happened
    expect(checked!.state.cozy?.decor).toBeUndefined();
    expect(strip(saver.serialize(checked!.state))).toBe(strip(saver.serialize(plain!.state)));
    expect(JSON.stringify(checked!.ecosystem.score())).toBe(JSON.stringify(plain!.ecosystem.score()));
  });

  it('E20.5: keepsakes come only from Lucky Cat finds: five finds, a Golden Cat, a Rainbow Cat', () => {
    const sim = new Sim(createInitialState(6));
    const cozy = new Cozy(sim);
    sim.state.stats.catsFound = 1;
    expect(cozy.checkDecorUnlocks().map((o) => o.id)).toEqual(['catstatue']);
    sim.state.cat.log = [{ anchorId: 'park-bench', reward: 'luckyHarvest', at: 10, variant: 'golden' }];
    expect(cozy.checkDecorUnlocks().map((o) => o.id)).toEqual(['goldlantern']);
    sim.state.stats.catsFound = 5;
    sim.state.cat.log.push({ anchorId: 'hedge-gap', reward: 'jackpot', at: 20, variant: 'rainbow' });
    expect(cozy.checkDecorUnlocks().map((o) => o.id).sort()).toEqual(['pawstones', 'rainbowbunting']);
    expect(cozy.checkDecorUnlocks()).toEqual([]);
    const fresh = new Cozy(new Sim(createInitialState(6)));
    expect(fresh.decorChoices().find((c) => c.option.id === 'rainbowbunting')?.hint ?? '').toMatch(/Rainbow Cat/);
  });
});
