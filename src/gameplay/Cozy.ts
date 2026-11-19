import { decoration, decorKey, decorKeyOf, decorOccupant, decorValue, type Decoration } from '../core/Decor';
import { GROUND } from '../core/GameState';
import { plotAt, plotById, plotSpots, type PlotSpot } from '../core/Plots';
import type { CozyState } from '../core/types';
import { DECOR_GEN, DECOR_OPTION, DECOR_OPTIONS, KEEPSAKE_HINTS, PLOT_OPTION, plotOptionsFor, type CozyUnlock, type DecorOption, type Keepsake, type PlotOption } from '../data/cozy';
import type { Sim } from './Sim';
import type { DecorRecipe } from '../data/crafting';

/** E23.6.1: a decoration's crafting recipe (made once at the table, then free to place). */
export function decorRecipe(sim: Sim, id: string): DecorRecipe | undefined {
  return sim.crafting.decor(id);
}

/** Is a decoration open to place? Old-city decorations with a recipe once made at the table; the rest keep E19.2's. */
export function decorOpen(sim: Sim, o: DecorOption): boolean {
  const r = decorRecipe(sim, o.id);
  if (r) return sim.crafting.decorMade(o.id);
  return 'start' in o.unlock || !!sim.state.cozy?.decorUnlocked?.includes(o.id);
}

export interface DecorChoice {
  option: DecorOption;
  unlocked: boolean;
  /** what it waits for, when locked */
  hint?: string;
}

export interface PlotChoice {
  option: PlotOption;
  unlocked: boolean;
  /** unlocked since the picker last showed it */
  fresh: boolean;
  /** what it waits for, when locked */
  hint?: string;
}

/**
 * E19.1 (#246): the player's plot choices and the options they've earned. Owned by the game, not the sim: nothing
 * in the simulation reads it, so production, chains, milestones, pacing and the biodiversity score are the same
 * whatever is chosen (tests/cozy.test.ts). It writes only `state.cozy`, and only when the player does something,
 * so a game that never chooses saves exactly as before.
 */
export class Cozy {
  constructor(private sim: Sim) {}

  /** E19.2: decorations go on the city's ground only (rooftops draw no decoration art yet); tests on a pad lift it. */
  groundOnly = true;

  private get gen(): number {
    return this.sim.grid.layer(GROUND)?.gen ?? 1;
  }

  private get st(): CozyState | undefined {
    return this.sim.state.cozy;
  }

  private write(): CozyState {
    return (this.sim.state.cozy ??= {});
  }

  /** The plot spots of an area (pure, from the seed). */
  spots(areaId: string): PlotSpot[] {
    return plotSpots(this.sim.grid.seed, areaId, this.gen);
  }

  spot(id: string): PlotSpot | undefined {
    return plotById(this.sim.grid.seed, id, this.gen);
  }

  /** The plot covering a cell (ground only). */
  spotAt(roofId: string, x: number, z: number): PlotSpot | undefined {
    if (roofId !== GROUND) return undefined;
    return plotAt(this.sim.grid.seed, x, z, this.gen);
  }

  /** The option chosen for a plot, if any. */
  choice(id: string): PlotOption | undefined {
    const o = this.st?.plots?.[id];
    return o ? PLOT_OPTION[o] : undefined;
  }

  /**
   * Is the plot open to choose: its area revealed, every tile restored and nothing standing on it? A plot whose
   * tiles a machine took before it was chosen simply waits.
   */
  ready(p: PlotSpot): boolean {
    if (this.sim.areas.fog(p.areaId) === 'hidden') return false;
    for (let j = 0; j < p.size; j++)
      for (let i = 0; i < p.size; i++) {
        const t = this.sim.grid.peek(GROUND, p.x + i, p.z + j); // never loads a chunk: the sim decides that
        if (!t || t.ground !== 'restored' || t.occupantId || t.blocked) return false;
      }
    return true;
  }

  /** Is the plot's art drawn (a choice made and its tiles still free)? */
  shown(p: PlotSpot): PlotOption | undefined {
    const o = this.choice(p.id);
    if (!o) return undefined;
    for (let j = 0; j < p.size; j++)
      for (let i = 0; i < p.size; i++) {
        const t = this.sim.grid.peek(GROUND, p.x + i, p.z + j);
        if (t?.occupantId) return undefined;
      }
    return o;
  }

  /** Bloombot (#235): a chosen solid option blocks walking like a machine; flat ones can be walked over. */
  solidAt(roofId: string, x: number, z: number): boolean {
    if (!this.st?.plots) return false;
    const p = this.spotAt(roofId, x, z);
    return !!p && !!this.shown(p)?.solid;
  }

  /** A chosen plot under a footprint (building there waits until the plot is cleared). */
  plotUnder(roofId: string, x: number, z: number, size: number): PlotSpot | undefined {
    if (!this.st?.plots || roofId !== GROUND) return undefined;
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        const p = this.spotAt(roofId, x + i, z + j);
        if (p && this.choice(p.id)) return p;
      }
    return undefined;
  }

  // ───────────── unlocks (E19.1.4) ─────────────

  /** Has this unlock rule been met (the park's look stage, areas cleared, or a Lucky Cat keepsake)? */
  private met(u: CozyUnlock): boolean {
    if ('start' in u) return true;
    if ('parkStage' in u) return this.sim.progression.parkStage() >= u.parkStage;
    if ('keepsake' in u) return this.keepsakeMet(u.keepsake);
    if ('find' in u) return !!this.sim.state.salvage?.caches.includes(u.find);
    // E23.6.2's research (`sim.research`); until it lands, research-only styles stay locked
    if ('research' in u) return !!(this.sim as unknown as { research?: { done?: (id: string) => boolean } }).research?.done?.(u.research);
    return this.sim.areas.clearedCount() >= u.areas;
  }

  /** E20.5 (#288): Lucky Cat finds that unlock keepsakes. Read from the cat's own record; nothing else unlocks them. */
  private keepsakeMet(k: Keepsake): boolean {
    const cat = this.sim.state.cat;
    switch (k) {
      case 'firstFind':
        return this.sim.state.stats.catsFound >= 1;
      case 'finds5':
        return this.sim.state.stats.catsFound >= 5;
      case 'golden':
      case 'rainbow':
        return (cat.log ?? []).some((e) => e.variant === k);
    }
  }

  isUnlocked(o: PlotOption): boolean {
    return 'start' in o.unlock || !!this.st?.unlocked?.includes(o.id);
  }

  /** Words for what a locked option waits for. */
  hint(u: CozyUnlock): string {
    if ('start' in u) return '';
    if ('keepsake' in u) return KEEPSAKE_HINTS[u.keepsake];
    if ('parkStage' in u) return ['', 'the park’s paths are swept', 'the park’s benches are mended', 'the park’s lamps are lit', 'the fountain wakes'][u.parkStage] ?? 'the park grows';
    if ('find' in u) return 'you find it in an old cache';
    if ('research' in u) return 'Decor research';
    return `${u.areas} area${u.areas === 1 ? '' : 's'} cleared`;
  }

  /**
   * Unlocks every option whose milestone has been met and wasn't unlocked before. Returns the new ones (each
   * exactly once: they're saved, so a reload never repeats a toast).
   */
  checkUnlocks(): PlotOption[] {
    const out: PlotOption[] = [];
    for (const o of Object.values(PLOT_OPTION)) {
      if (this.isUnlocked(o) || !this.met(o.unlock)) continue;
      const s = this.write();
      (s.unlocked ??= []).push(o.id);
      (s.fresh ??= []).push(o.id);
      out.push(o);
    }
    return out;
  }

  /** The picker's list for a plot: every option its area type offers, unlocked first. */
  choices(p: PlotSpot): PlotChoice[] {
    const type = this.sim.areas.info(p.areaId).type;
    const fresh = new Set(this.st?.fresh ?? []);
    return plotOptionsFor(type)
      .filter((o) => !o.nearWater || p.water)
      .map((o) => ({ option: o, unlocked: this.isUnlocked(o), fresh: fresh.has(o.id), hint: this.isUnlocked(o) ? undefined : this.hint(o.unlock) }))
      .sort((a, b) => Number(b.unlocked) - Number(a.unlocked));
  }

  /** The picker showed these: their "new" markers go. */
  seen(ids: string[]) {
    const s = this.st;
    if (!s?.fresh) return;
    s.fresh = s.fresh.filter((id) => !ids.includes(id));
    if (!s.fresh.length) delete s.fresh;
  }

  // ───────────── choosing (E19.1.2) ─────────────

  /**
   * Sets (or, with undefined, clears) a plot's option. Free, any time. Refused for a plot that isn't open yet, an
   * option its area doesn't offer or hasn't unlocked. Returns why it was refused, or undefined.
   */
  choose(id: string, optionId: string | undefined): string | undefined {
    const p = this.spot(id);
    if (!p) return 'There is no plot here';
    if (optionId === undefined) {
      const s = this.st;
      if (s?.plots?.[id]) {
        delete s.plots[id];
        if (!Object.keys(s.plots).length) delete s.plots;
      }
      return undefined;
    }
    const c = this.choices(p).find((q) => q.option.id === optionId);
    if (!c) return 'That doesn’t suit this plot';
    if (!c.unlocked) return `Unlocks when ${c.hint}`;
    if (!this.ready(p) && !this.choice(id)) return 'Restore every tile of the plot first';
    const s = this.write();
    // Sparse and in a stable order (sorted ids), so save → load → save is byte-identical.
    const plots = { ...(s.plots ?? {}), [id]: optionId };
    s.plots = Object.fromEntries(Object.keys(plots).sort().map((k) => [k, plots[k]]));
    return undefined;
  }

  /** How many plots carry a choice. */
  count(): number {
    return Object.keys(this.st?.plots ?? {}).length;
  }

  // ───────────── decorations (E19.2) ─────────────

  /** The decoration on a tile, if any. */
  decorAt(roofId: string, x: number, z: number): Decoration | undefined {
    const d = this.st?.decor;
    if (!d) return undefined;
    const key = decorKey(roofId, x, z);
    const v = d[key];
    return v ? decoration(key, v) : undefined;
  }

  /** A decoration by its key (`<layer>|<x>|<z>`). */
  decorByKey(key: string): Decoration | undefined {
    const v = this.st?.decor?.[key];
    return v ? decoration(key, v) : undefined;
  }

  /** The decoration behind a tile's occupant id (undefined for machines and free tiles). */
  decorOf(occupantId: string | undefined): Decoration | undefined {
    const key = decorKeyOf(occupantId);
    const v = key && this.st?.decor?.[key];
    return v ? decoration(key!, v) : undefined;
  }

  /** Every decoration placed, in key order. */
  decorations(): Decoration[] {
    return Object.entries(this.st?.decor ?? {}).flatMap(([k, v]) => decoration(k, v) ?? []);
  }

  decorCount(): number {
    return Object.keys(this.st?.decor ?? {}).length;
  }

  isDecorUnlocked(o: DecorOption): boolean {
    return decorOpen(this.sim, o);
  }

  /** What a locked decoration waits for. */
  private decorHint(o: DecorOption): string {
    const r = decorRecipe(this.sim, o.id);
    if (r && this.sim.crafting.unlocked(r.unlock)) return 'it is made at the crafting table';
    return r ? this.sim.crafting.unlockLabel(r.unlock).replace('🔒 ', '') : this.hint(o.unlock);
  }

  /** The tray's list: every decoration, unlocked or with what it waits for (keepsakes only once earned). */
  decorChoices(): DecorChoice[] {
    return DECOR_OPTIONS.map((o) => ({ option: o, unlocked: this.isDecorUnlocked(o), hint: this.isDecorUnlocked(o) ? undefined : this.decorHint(o) }));
  }

  /** Unlocks every decoration whose milestone has been met, once each (saved). Returns the new ones. */
  checkDecorUnlocks(): DecorOption[] {
    const out: DecorOption[] = [];
    for (const o of DECOR_OPTIONS) {
      const r = decorRecipe(this.sim, o.id);
      if (r) {
        // E23.6.1: made at the table: announced once (the build menu has it now)
        if (!this.sim.crafting.decorMade(o.id) || this.st?.decorUnlocked?.includes(o.id)) continue;
      } else if (this.isDecorUnlocked(o) || !this.met(o.unlock)) continue;
      (this.write().decorUnlocked ??= []).push(o.id);
      out.push(o);
    }
    return out;
  }

  /**
   * Why a decoration can't go on this tile, or undefined when it can. The tile rules are a machine's (restored,
   * clear of fog, nothing standing there, no drone about to work it, not growing), plus: the city's ground only
   * (rooftops come later), not in water, and not on a plot whose look has been chosen.
   */
  canDecorate(kind: string, roofId: string, x: number, z: number): string | undefined {
    const o = DECOR_OPTION[kind];
    if (!o) return 'There is no such decoration';
    if (!this.isDecorUnlocked(o)) return decorRecipe(this.sim, o.id) ? `Not made yet: ${this.decorHint(o)}` : `Unlocks when ${this.hint(o.unlock)}`;
    if (this.groundOnly && roofId !== GROUND) return 'Decorations go on the city’s ground for now';
    if (this.decorCount() >= DECOR_GEN.max) return `The city holds ${DECOR_GEN.max} decorations at most: remove one first`;
    const t = this.sim.grid.peek(roofId, x, z); // never loads a chunk (the sim decides that)
    if (!t) return 'Nothing to stand it on here';
    if (t.feature === 'water' && !t.blocked) return 'Not in the water';
    const why = this.sim.build.footprintProblem(roofId, x, z, 1, ['restored']);
    if (why) return why === 'Needs restored or mossy ground — pulse it first' ? 'Restore the ground here first' : why;
    if (this.plotUnder(roofId, x, z, 1)) return 'A plot is chosen here: clear it first';
    return undefined;
  }

  /**
   * Places a decoration (free). It occupies its tile as a machine does. Returns why it was refused, or undefined.
   * The only sim-side effects are a machine's: the tile's occupant, production's dirty marks, and a Lucky Cat
   * hiding on the tile hopping to another nook.
   */
  placeDecor(kind: string, rot: number, roofId: string, x: number, z: number): string | undefined {
    const why = this.canDecorate(kind, roofId, x, z);
    if (why) return why;
    const s = this.write();
    const key = decorKey(roofId, x, z);
    const decor = { ...(s.decor ?? {}), [key]: decorValue(kind, rot) };
    s.decor = Object.fromEntries(Object.keys(decor).sort().map((k) => [k, decor[k]])); // sorted: byte-identical saves
    this.sim.grid.indexDecor(key);
    this.sim.grid.peek(roofId, x, z)!.occupantId = decorOccupant(key);
    this.sim.production.markNear(roofId, x, z, 1);
    this.sim.cat.relocateIfBlocked();
    return undefined;
  }

  /** Removes the decoration on a tile (free and instant; the tile stays restored). Returns what was removed. */
  removeDecor(roofId: string, x: number, z: number): Decoration | undefined {
    const d = this.decorAt(roofId, x, z);
    const s = this.st;
    if (!d || !s?.decor) return undefined;
    delete s.decor[d.key];
    if (!Object.keys(s.decor).length) delete s.decor;
    this.sim.grid.unindexDecor(d.key);
    const t = this.sim.grid.peek(roofId, x, z);
    if (t && t.occupantId === decorOccupant(d.key)) t.occupantId = undefined;
    this.sim.production.markNear(roofId, x, z, 1);
    return d;
  }

  /** Bloombot (#235): is a solid decoration on this cell? (The Walker reads occupancy itself; this is for tests.) */
  decorSolid(roofId: string, x: number, z: number): boolean {
    const d = this.decorAt(roofId, x, z);
    return !!d && DECOR_OPTION[d.kind]?.solid !== false;
  }
}
