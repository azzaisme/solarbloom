import { decoration, decorKey, decorKeyOf, decorOccupant, decorValue, type Decoration } from '../core/Decor';
import { GROUND } from '../core/GameState';
import { plotAt, plotById, plotSpots, type PlotSpot } from '../core/Plots';
import type { CozyState } from '../core/types';
import { decorAnchor, decorCells, DECOR_GEN, DECOR_OPTION, DECOR_OPTIONS, FIRST_DECOR, PLOT_OPTION, plotOptionsFor, type CozyUnlock, type DecorOption, type PlotOption } from '../data/cozy';
import { PARK_SET } from '../data/oldcity';
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

  /** Has this unlock rule been met (the park's look stage, areas cleared, a find or research)? */
  private met(u: CozyUnlock): boolean {
    if ('start' in u) return true;
    if ('parkStage' in u) return this.sim.progression.parkStage() >= u.parkStage;
    if ('cat' in u) return false; // E23.12.2: only a Lucky Cat gives these (data/crafting's `{ cat }` recipes)
    if ('find' in u) return !!this.sim.state.salvage?.caches.includes(u.find);
    // E23.6.2's research (`sim.research`); until it lands, research-only styles stay locked
    if ('research' in u) return !!(this.sim as unknown as { research?: { done?: (id: string) => boolean } }).research?.done?.(u.research);
    return this.sim.areas.clearedCount() >= u.areas;
  }

  isUnlocked(o: PlotOption): boolean {
    return 'start' in o.unlock || !!this.st?.unlocked?.includes(o.id);
  }

  /** Words for what a locked option waits for. */
  hint(u: CozyUnlock): string {
    if ('start' in u) return '';
    if ('cat' in u) return 'it turns up somewhere'; // never names what leaves it (epic rule 8)
    if ('parkStage' in u) return ['', 'the park’s paths are swept', 'the park’s benches are mended', 'the park’s lamps are lit', 'the fountain wakes'][u.parkStage] ?? 'the park grows';
    if ('find' in u) return 'you dig it out of a buried box';
    if ('research' in u) return 'you work it out at the workbench beside the house';
    return `the fog lifts from ${u.areas} place${u.areas === 1 ? '' : 's'}`;
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
    if (!this.ready(p) && !this.choice(id)) return 'Turn all the ground of this plot green first';
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

  /** The decoration on a tile, if any (#849: a big piece on any of its squares). */
  decorAt(roofId: string, x: number, z: number): Decoration | undefined {
    const d = this.st?.decor;
    if (!d) return undefined;
    const key = decorKey(roofId, x, z);
    const v = d[key];
    if (v) return decoration(key, v);
    return this.decorOf(this.sim.grid.peek(roofId, x, z)?.occupantId);
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
    if (r && this.sim.crafting.unlocked(r.unlock)) return 'it is made at the workbench';
    return r ? this.sim.crafting.unlockLabel(r.unlock).replace('🔒 ', '') : this.hint(o.unlock);
  }

  /** The tray's list: every decoration, unlocked or with what it waits for. */
  decorChoices(): DecorChoice[] {
    return DECOR_OPTIONS.map((o) => ({ option: o, unlocked: this.isDecorUnlocked(o), hint: this.isDecorUnlocked(o) ? undefined : this.decorHint(o) }));
  }

  /**
   * #782: the first decoration, a gift once the fountain reaches its first step. A save already past that step gets
   * it too, once. It comes made (free to place, as often as you like) and counts as announced, so its own toast is
   * the only one. If bloombot has made every gift already, the step is still remembered and nothing is given.
   * Returns the gift when one was given now.
   */
  giveFirstDecor(): DecorOption | undefined {
    const sv = this.sim.state.salvage;
    if (!sv || sv.decorGift || sv.tier < FIRST_DECOR.step) return undefined;
    const id = FIRST_DECOR.gifts.find((g) => !!decorRecipe(this.sim, g) && !this.sim.crafting.decorMade(g));
    sv.decorGift = id ?? FIRST_DECOR.gifts[0];
    if (!id) return undefined;
    this.sim.crafting.giveDecor(id);
    const s = this.write();
    if (!(s.decorUnlocked ??= []).includes(id)) s.decorUnlocked.push(id);
    return DECOR_OPTION[id];
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
  canDecorate(kind: string, roofId: string, x: number, z: number, rot = 0): string | undefined {
    const o = DECOR_OPTION[kind];
    if (!o) return 'There is no such decoration';
    if (!this.isDecorUnlocked(o)) return decorRecipe(this.sim, o.id) ? `Not made yet: ${this.decorHint(o)}` : `Unlocks when ${this.hint(o.unlock)}`;
    const inside = this.sim.house.isInside(roofId);
    if (this.groundOnly && roofId !== GROUND && !inside) return 'Decorations go on the city’s ground for now';
    if (this.decorCount() >= DECOR_GEN.max) return `The city holds ${DECOR_GEN.max} decorations at most: remove one first`;
    if (inside) {
      // #782: the house holds as many as its level allows
      const h = this.sim.house;
      if (!h.hasInside()) return 'The house has no inside yet';
      if (this.insideCount() >= h.decorMax()) return `The ${h.current()!.name.toLowerCase()} holds ${h.decorMax()} decorations: pick one up first, or grow the house`;
    }
    // #849: every square it covers follows the one-square rules
    const cells = decorCells(kind, rot, x, z);
    const big = cells.length > 1;
    for (const c of cells) {
      const why = this.cellProblem(roofId, c.x, c.z, inside);
      if (why) return big && why === 'Nothing to stand it on here' ? 'It doesn’t fit here' : why;
    }
    return undefined;
  }

  /** Why one square can't take (part of) a decoration, or undefined. */
  private cellProblem(roofId: string, x: number, z: number, inside: boolean): string | undefined {
    if (inside) {
      // #782: the door and the furniture stay clear
      const h = this.sim.house;
      const [dx, dz] = h.doorInside();
      if (x === dx && z === dz) return 'Keep the door of the house clear';
      const f = h.furnitureAt(x, z);
      if (f) return `${f.name[0].toUpperCase()}${f.name.slice(1)} stands here`;
    }
    const t = this.sim.grid.peek(roofId, x, z); // never loads a chunk (the sim decides that)
    if (!t) return 'Nothing to stand it on here';
    if (t.feature === 'water' && !t.blocked) return 'Not in the water';
    const why = this.sim.build.footprintProblem(roofId, x, z, 1, ['restored']);
    if (why) return why === 'Needs green or mossy ground: press {pulse} on it first' ? 'Press {pulse} to turn the ground here green first' : why;
    if (this.plotUnder(roofId, x, z, 1)) return 'A plot is chosen here: clear it first';
    if (this.atHouseDoor(roofId, x, z)) return 'Keep the door of the house clear';
    // #782 × #783: the square in front of the workbench is where Bloombot stands to use it
    const bf = roofId === GROUND ? this.sim.bench?.front() : undefined;
    if (bf && bf.x === x && bf.z === z) return 'Keep the space in front of the workbench clear';
    return undefined;
  }

  /** #782: decorations inside the house. */
  insideCount(): number {
    const id = this.sim.house.layerId;
    return this.decorations().filter((d) => d.roofId === id).length;
  }

  /**
   * #782: the house grew and its furniture took these cells: a decoration standing on one moves to the nearest free
   * floor (nothing placed is lost), or, with no free floor left, back into the build menu (it stays made).
   */
  clearCells(cells: { roofId: string; x: number; z: number }[]) {
    for (const c of cells) {
      const d = this.decorAt(c.roofId, c.x, c.z);
      if (!d) continue;
      this.removeDecor(c.roofId, c.x, c.z);
      const free = this.sim.grid
        .tilesOf(c.roofId)
        .filter((t) => !t.blocked && !t.occupantId)
        .sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
      // #849: a big piece tries each free square as its middle, in both of its turns
      const turns = [d.rot, (d.rot + 1) & 3];
      place: for (const t of free)
        for (const r of turns) {
          const [ax, az] = decorAnchor(d.kind, r, t.x, t.z);
          if (!this.placeDecor(d.kind, r, c.roofId, ax, az)) break place;
        }
    }
  }

  /** #782: the ground at the house's door (where the house stands): decorations go round it, never in the way in. */
  private atHouseDoor(roofId: string, x: number, z: number): boolean {
    const sh = PARK_SET.shed;
    return roofId === GROUND && x === sh.door[0] && z === sh.door[1] && this.sim.grid.peek(GROUND, sh.x, sh.z)?.prop === 'shed';
  }

  /**
   * Places a decoration (free). It occupies its tile as a machine does. Returns why it was refused, or undefined.
   * The only sim-side effects are a machine's: the tile's occupant, production's dirty marks, and a Lucky Cat
   * hiding on the tile hopping to another nook.
   */
  placeDecor(kind: string, rot: number, roofId: string, x: number, z: number): string | undefined {
    const why = this.canDecorate(kind, roofId, x, z, rot);
    if (why) return why;
    const s = this.write();
    const key = decorKey(roofId, x, z);
    const value = decorValue(kind, rot);
    const decor = { ...(s.decor ?? {}), [key]: value };
    s.decor = Object.fromEntries(Object.keys(decor).sort().map((k) => [k, decor[k]])); // sorted: byte-identical saves
    this.sim.grid.indexDecor(key, value);
    for (const c of decorCells(kind, rot, x, z)) this.sim.grid.peek(roofId, c.x, c.z)!.occupantId = decorOccupant(key);
    this.sim.cat.relocateIfBlocked();
    return undefined;
  }

  /**
   * Removes the decoration on a tile (free and instant; the tile stays restored). #849: any square of a big piece
   * takes the whole piece away. Returns what was removed.
   */
  removeDecor(roofId: string, x: number, z: number): Decoration | undefined {
    const d = this.decorAt(roofId, x, z);
    const s = this.st;
    if (!d || !s?.decor) return undefined;
    delete s.decor[d.key];
    if (!Object.keys(s.decor).length) delete s.decor;
    this.sim.grid.unindexDecor(d.key);
    for (const c of decorCells(d.kind, d.rot, d.x, d.z)) {
      const t = this.sim.grid.peek(d.roofId, c.x, c.z);
      if (t && t.occupantId === decorOccupant(d.key)) t.occupantId = undefined;
    }
    return d;
  }

  /** Bloombot (#235): is a solid decoration on this cell? (The Walker reads occupancy itself; this is for tests.) */
  decorSolid(roofId: string, x: number, z: number): boolean {
    const d = this.decorAt(roofId, x, z);
    return !!d && DECOR_OPTION[d.kind]?.solid !== false;
  }
}
