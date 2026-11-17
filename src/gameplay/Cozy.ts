import { GROUND } from '../core/GameState';
import { plotAt, plotById, plotSpots, type PlotSpot } from '../core/Plots';
import type { CozyState } from '../core/types';
import { PLOT_OPTION, plotOptionsFor, type CozyUnlock, type PlotOption } from '../data/cozy';
import type { Sim } from './Sim';

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

  /** Has this unlock rule been met (the park's look stage, or areas cleared)? */
  private met(u: CozyUnlock): boolean {
    if ('start' in u) return true;
    if ('parkStage' in u) return this.sim.progression.parkStage() >= u.parkStage;
    return this.sim.areas.clearedCount() >= u.areas;
  }

  isUnlocked(o: PlotOption): boolean {
    return 'start' in o.unlock || !!this.st?.unlocked?.includes(o.id);
  }

  /** Words for what a locked option waits for. */
  hint(u: CozyUnlock): string {
    if ('start' in u) return '';
    if ('parkStage' in u) return ['', 'the park’s paths are swept', 'the park’s benches are mended', 'the park’s lamps are lit', 'the fountain wakes'][u.parkStage] ?? 'the park grows';
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
}
