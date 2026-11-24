import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { PlotSpot } from '../src/core/Plots';
import { ACTS, HOLD_ACTS, VERB_ACTS } from '../src/data/botActs';
import { PROPS } from '../src/data/botProps';
import { PLOT_OPTIONS, PLOT_WORK, PLOT_WORK_TUNING } from '../src/data/cozy';
import { GATHER } from '../src/data/farm';
import { gameDays } from '../src/data/time';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { drawPlot } from '../src/rendering/PlotArt';
import { MATERIALS } from '../src/data/salvage';
import { itemDef } from '../src/data/items';
import { bannedIn, RESOURCE_NAME } from '../src/ui/words';

/** E27.2 (#680): Bloombot gathers from and prunes the plant plots, and they grow back. */

SaveService.clock = () => 0;

/** A park plot, restored to `bloom`, with `option` chosen on it. */
function plot(option: string | undefined, bloom = 2, seed = 1234): { sim: Sim; p: PlotSpot } {
  const sim = new Sim(createInitialState(seed));
  const cozy = new Cozy(sim);
  const p = cozy.spots(PARK)[0];
  for (let j = 0; j < p.size; j++)
    for (let i = 0; i < p.size; i++) {
      const t = sim.grid.get(GROUND, p.x + i, p.z + j)!;
      Object.assign(t, { ground: 'restored', pollution: 0, bloom, blocked: false, occupantId: undefined });
      sim.grid.touch(t);
    }
  if (option) {
    sim.state.cozy ??= {};
    (sim.state.cozy.plots ??= {})[p.id] = option;
  }
  return { sim, p };
}
const greens = (sim: Sim) => sim.inventory.count('biomass');
const tileOf = (sim: Sim, p: PlotSpot, i = 0) => sim.grid.peek(GROUND, p.x + (i % p.size), p.z + Math.floor(i / p.size))!;

describe('E27.2: which plots Bloombot works', () => {
  it('the plants are worked, gathered or pruned; the places (café, playground, pools) are not', () => {
    expect(Object.entries(PLOT_WORK).filter(([, w]) => w.verb === 'gather').map(([id]) => id)).toEqual(['garden', 'meadow', 'crates', 'reeds', 'greenhouse']);
    expect(Object.entries(PLOT_WORK).filter(([, w]) => w.verb === 'prune').map(([id]) => id)).toEqual(['orchard', 'arbour', 'parklet']);
    for (const id of Object.keys(PLOT_WORK)) expect(PLOT_OPTIONS.map((o) => o.id), id).toContain(id);
    for (const id of ['cafe', 'playground', 'splash', 'bandstand', 'mooring', 'picnic', 'bikes', 'stalls', 'dipping', 'hut']) {
      const { sim, p } = plot(id);
      expect(sim.plotWork.workOf(p), id).toBeUndefined();
      expect(sim.plotWork.spotFor(tileOf(sim, p)), id).toBeUndefined();
    }
  });

  it('an empty plot, or one a machine stands on, has nothing to work', () => {
    const { sim, p } = plot(undefined);
    expect(sim.plotWork.spotFor(tileOf(sim, p))).toBeUndefined();
    const b = plot('garden');
    tileOf(b.sim, b.p, 3).occupantId = 'm1';
    expect(b.sim.plotWork.workOf(b.p)).toBeUndefined();
  });
});

describe('E27.2: the gather, prune and regrow loop', () => {
  it('gathering a garden puts Greens in the backpack, leaves it picked, and it grows back', () => {
    const { sim, p } = plot('garden');
    expect(sim.plotWork.spotFor(tileOf(sim, p, 2))?.id).toBe(p.id);
    expect(sim.plotWork.problem(p)).toBeUndefined();
    expect(sim.plotWork.growth(p)).toBe(1);
    const said: unknown[] = [];
    sim.bus.on('plot.worked', (e) => said.push(e));
    const before = greens(sim);
    const got = sim.plotWork.work(p);
    expect(got).toBe(4 * GATHER.base); // four tiles of flowered ground
    expect(greens(sim) - before).toBe(got);
    expect(said).toEqual([{ plotId: p.id, verb: 'gather', got, x: p.x + 1, z: p.z + 1 }]);
    // picked: nothing more until it grows back, and it says so in plain words
    expect(sim.plotWork.growth(p)).toBe(0);
    expect(sim.plotWork.problem(p)).toBe('Picked not long ago. It grows back in about 12 minutes.');
    expect(sim.plotWork.work(p)).toBe(0);
    sim.advance(gameDays(GATHER.regrowDays) / 2);
    expect(sim.plotWork.growth(p)).toBeCloseTo(0.5, 1);
    expect(sim.plotWork.problem(p)).toMatch(/^Picked not long ago\. It grows back in about \d+ minutes\.$/);
    sim.advance(gameDays(GATHER.regrowDays) / 2 + 1);
    expect(sim.plotWork.growth(p)).toBe(1);
    expect(sim.plotWork.problem(p)).toBeUndefined();
    expect(sim.plotWork.work(p)).toBeGreaterThanOrEqual(got); // a windy day can shake more loose, as with clipping
  }, 60_000);

  it('pruning an orchard works the same way, with its own words', () => {
    const { sim, p } = plot('orchard');
    expect(sim.plotWork.workOf(p)).toEqual({ verb: 'prune', what: 'the fruit trees' });
    const said: { verb: string }[] = [];
    sim.bus.on('plot.worked', (e) => said.push(e));
    expect(sim.plotWork.work(p)).toBe(4 * GATHER.base);
    expect(said[0].verb).toBe('prune');
    expect(sim.plotWork.problem(p)).toBe('Pruned not long ago. It grows back in about 12 minutes.');
  });

  it('a full Greens stack refuses, and a nearly full one takes what fits', () => {
    const { sim, p } = plot('meadow');
    sim.inventory.add('biomass', 1000);
    expect(sim.plotWork.problem(p)).toBe("Bloombot can't carry any more Greens. Leave some at the fountain or in a chest");
    const fails: string[] = [];
    sim.bus.on('action.failed', (e) => fails.push(e.reason));
    expect(sim.plotWork.work(p)).toBe(0);
    expect(fails).toHaveLength(1);
    expect(sim.plotWork.growth(p)).toBe(1); // nothing was taken, so nothing was picked
    expect(sim.inventory.pay({ biomass: 3 })).toBe(true);
    expect(sim.plotWork.work(p)).toBe(3);
  });

  it('Green thumb (Moss) gives more, as it does for clipping', () => {
    const { sim, p } = plot('garden');
    sim.state.salvage!.keepers.moss = { step: 'settled' };
    expect(sim.plotWork.work(p)).toBe(Math.round(4 * GATHER.base * sim.knacks.gather));
  });
});

describe('E27.2: the economy is what it was', () => {
  it('a plot gives what its own tiles gave clipped one by one, on flowered ground', () => {
    for (const bloom of [2, 3]) {
      const { sim, p } = plot(undefined, bloom);
      let tiles = 0;
      for (let i = 0; i < 4; i++) tiles += sim.gather.yieldOf(tileOf(sim, p, i));
      const chosen = plot('garden', bloom);
      expect(chosen.sim.plotWork.yieldOf(chosen.p), `bloom ${bloom}`).toBe(tiles);
    }
  });

  it('a plot counts as flowered ground at least (a new plot always has something), and nothing more', () => {
    const { sim, p } = plot('garden', 1);
    for (let i = 0; i < 4; i++) expect(sim.gather.yieldOf(tileOf(sim, p, i))).toBe(0);
    expect(sim.plotWork.yieldOf(p)).toBe(4 * GATHER.base);
  });

  it('its tiles are no longer clipped one by one, by Bloombot or a Harvester, so it is never worked twice', () => {
    const { sim, p } = plot('garden', 3);
    for (let i = 0; i < 4; i++) {
      expect(sim.gather.canGather(tileOf(sim, p, i))).toBe(false);
      expect(sim.gather.clip(tileOf(sim, p, i), 'store')).toBe(0);
    }
    // the same tiles without a plant on them clip as before
    const bare = plot('cafe', 3);
    expect(bare.sim.gather.canGather(tileOf(bare.sim, bare.p))).toBe(true);
  });

  it('it regrows on the clipping clock and saves nothing new', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const { sim, p } = plot('garden');
    sim.plotWork.work(p);
    const c = sim.state.salvage!.clipped!;
    for (let i = 0; i < 4; i++) expect(c[tileOf(sim, p, i).id]).toBeCloseTo(sim.time + gameDays(GATHER.regrowDays), 6);
    const a = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(a)!);
    expect(saver.serialize(back.state)).toBe(a);
    for (let i = 0; i < 4; i++) back.grid.get(GROUND, p.x + (i % 2), p.z + Math.floor(i / 2));
    expect(back.plotWork.growth(p)).toBe(0);
    expect(Object.keys(JSON.parse(a))).toEqual(Object.keys(JSON.parse(saver.serialize(plot('garden').sim.state)))); // no new field
  });
});

describe('E27.2: Bloombot acts it out, and the plot shows it', () => {
  it('gathering is a held gather (the basket); pruning a held prune with shears that snip', () => {
    expect(HOLD_ACTS.gather).toBe('gather');
    expect(HOLD_ACTS.prune).toBe('prune');
    expect(VERB_ACTS.Prune).toBe('prune');
    expect(ACTS.prune.prop?.id).toBe('shears');
    expect(PROPS.shears.pieces.length).toBeGreaterThan(2);
    expect(ACTS.prune.tick?.hex).toBe(ACTS.gather.tick?.hex); // leaves from each snip
    expect(ACTS.prune.channels.rElbow?.[1]).toBeGreaterThan(10); // the shears open and close
    expect(PLOT_WORK_TUNING.holdSeconds.gather).toBeGreaterThan(GATHER.holdSeconds);
    expect(PLOT_WORK_TUNING.holdSeconds.prune).toBeGreaterThan(PLOT_WORK_TUNING.holdSeconds.gather);
  });

  it('every worked plot looks different just picked or pruned than grown back', () => {
    const { p } = plot(undefined);
    const shape = (option: string, growth: number) => {
      const parts: string[] = [];
      drawPlot({ add: (type, hex, at, s) => parts.push(`${type}${hex}${at.map((n) => n.toFixed(2))}${JSON.stringify(s)}`), foliage: (_g, x, y, z, _r, s) => parts.push(`f${x}${y}${z}${s.toFixed(2)}`), model: () => false, lod: 1 }, p, option, 0.1, false, growth);
      return parts.join('|');
    };
    for (const id of Object.keys(PLOT_WORK)) {
      expect(shape(id, 0), id).not.toBe(shape(id, 1));
      expect(shape(id, 0.5), id).not.toBe(shape(id, 1));
    }
    // a plot nobody works looks the same whatever its growth
    expect(shape('cafe', 0)).toBe(shape('cafe', 1));
  });

  it('the words are plain', () => {
    const lines = [...Object.values(PLOT_WORK).flatMap((w) => [`${w.verb === 'prune' ? 'Prune' : 'Gather'} ${w.what}`])];
    const { sim, p } = plot('arbour');
    sim.plotWork.work(p);
    lines.push(sim.plotWork.problem(p)!, plot('garden').sim.plotWork.problem(plot('cafe').p) ?? '');
    for (const l of lines) expect(bannedIn(l), l).toEqual([]);
    expect(lines.join(' ')).not.toMatch(/biomass|yield|tile|regrow/i);
  });
});

describe('E27.2: what was picked is called what the player knows it as', () => {
  it('the pickup from a plot (the floating label and the toast) says Greens, as the backpack and stores do', () => {
    expect(MATERIALS.biomass.name).toBe(RESOURCE_NAME.biomass);
    expect(itemDef('biomass').name).toBe('Greens');
    for (const m of Object.values(MATERIALS)) expect(bannedIn(m.name), m.id).toEqual([]);
  });
});
