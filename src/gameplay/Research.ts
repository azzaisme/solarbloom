import { GROUND } from '../core/GameState';
import type { ResearchState, SalvageState } from '../core/types';
import { KEEPERS, PARK_SET, REGIONS } from '../data/oldcity';
import { itemDef } from '../data/items';
import { PROJECTS, RESEARCH, RESEARCH_UPGRADES, type Find, type ProjectDef, type ResearchUpgradeDef } from '../data/research';
import type { Sim } from './Sim';

/** E23.3's grid, read optionally until it lands (`isPowered` is true for anything the grid doesn't power). */
interface PowerLike {
  isPowered(m: { id: string; type: string; roofId: string; x: number; z: number; size: number }): boolean;
}

/** The research station stands in the house; to the grid it is a small consumer there. */
export const STATION = { id: 'research-station', type: 'researchStation', roofId: GROUND, x: PARK_SET.shed.x, z: PARK_SET.shed.z, size: PARK_SET.shed.size };

/** A find's key in the save. */
export function findKey(f: Find): string {
  if ('material' in f) return `material:${f.material}`;
  if ('keeper' in f) return `keeper:${f.keeper}`;
  if ('tech' in f) return `tech:${f.tech}`;
  return `project:${f.project}`;
}

/**
 * E23.6.2 (#391): the research station, at home once the first Keeper wakes. Finding something new (a material,
 * a Keeper, old tech in a cache) and analysing it at the station opens projects. A project takes materials when it
 * starts and runs over game time on grid power; with no power it pauses and carries on by itself when power comes
 * back. One at a time; a project gives a second station. Finished projects open crafting-table recipes and
 * upgrades; an upgrade's levels (at most 3) are bought at the table's Upgrade tab, for materials.
 *
 * Other sub-epics read upgrade levels with `sim.research.level(id)` (charge, sprint, pulse, poles, pumps, drones…).
 */
export class Research {
  constructor(private sim: Sim) {}

  private get sv(): SalvageState | undefined {
    return this.sim.state.salvage;
  }

  /** The station's state (made on first use). */
  private get st(): ResearchState {
    const sv = this.sv!;
    return (sv.research ??= { analysed: [], done: [], running: [], levels: {} });
  }

  /** Is the station there? (At home once the first Keeper wakes.) */
  get on(): boolean {
    const sv = this.sv;
    return !!sv && Object.values(sv.keepers).some((k) => k.step !== 'asleep');
  }

  /** Has a project finished? (Crafting reads research unlocks through this.) */
  done(id: string): boolean {
    return !!this.sv?.research?.done.includes(id);
  }

  /** An upgrade's level (0 until bought). */
  level(id: string): number {
    return this.sv?.research?.levels[id] ?? 0;
  }

  /** Stations in the house: one, two once researched. */
  stations(): number {
    return Math.min(RESEARCH.maxStations, RESEARCH.stations + PROJECTS.filter((p) => 'station' in p.gives && this.done(p.id)).length);
  }

  /** Is the house on power? (Always, until E23.3's grid exists.) */
  powered(): boolean {
    return (this.sim as { power?: PowerLike }).power?.isPowered(STATION) ?? true;
  }

  // ───────────── finds ─────────────

  /** Is a find found (not yet analysed)? */
  found(f: Find): boolean {
    const sv = this.sv;
    if (!sv) return false;
    if ('material' in f) {
      const m = f.material;
      return this.sim.inventory.count(m) > 0 || this.sim.inventory.stored(m) > 0 || !!sv.seen?.includes(`mat:${m}`) || m === 'scrap' || m === 'seeds';
    }
    if ('keeper' in f) {
      const k = KEEPERS.find((x) => x.region === f.keeper);
      const st = k && sv.keepers[k.id];
      return !!st && st.step !== 'asleep';
    }
    if ('tech' in f) return sv.caches.includes(f.tech);
    return this.done(f.project);
  }

  /** A find's name, in plain words. */
  findName(f: Find): string {
    if ('material' in f) return itemDef(f.material).name;
    if ('keeper' in f) return KEEPERS.find((x) => x.region === f.keeper)?.name ?? f.keeper;
    if ('tech' in f) {
      const r = REGIONS.find((x) => x.caches.some((c) => c.id === f.tech));
      return `Old tech from ${r?.name ?? 'the city'}`;
    }
    return PROJECTS.find((p) => p.id === f.project)?.name ?? f.project;
  }

  /** Finds waiting to be analysed (each opens at least one project). Projects follow on by themselves. */
  finds(): Find[] {
    if (!this.on) return [];
    const seen = new Set<string>();
    const out: Find[] = [];
    for (const p of PROJECTS) {
      if ('project' in p.opens) continue;
      const k = findKey(p.opens);
      if (seen.has(k)) continue;
      seen.add(k);
      if (this.found(p.opens) && !this.st.analysed.includes(k)) out.push(p.opens);
    }
    return out;
  }

  /** Looks closely at a find: its projects open. */
  analyse(f: Find): boolean {
    if (!this.on || !this.found(f)) return false;
    const k = findKey(f);
    if (this.st.analysed.includes(k)) return false;
    this.st.analysed.push(k);
    this.sim.bus.emit('research.analysed', { find: k });
    return true;
  }

  // ───────────── projects ─────────────

  project(id: string): ProjectDef | undefined {
    return PROJECTS.find((p) => p.id === id);
  }

  /** Is a project open (its find analysed, or the project before it done)? */
  isOpen(p: ProjectDef): boolean {
    if (!this.on) return false;
    if ('project' in p.opens) return this.done(p.opens.project);
    return this.st.analysed.includes(findKey(p.opens));
  }

  /** Projects open now, not started and not done. */
  open(): ProjectDef[] {
    if (!this.on) return [];
    return PROJECTS.filter((p) => this.isOpen(p) && !this.done(p.id) && !this.running(p.id));
  }

  running(id?: string): boolean {
    const r = this.sv?.research?.running ?? [];
    return id ? r.some((j) => j.id === id) : r.length > 0;
  }

  /** The projects on the bench, with their progress (0..1). */
  bench(): { project: ProjectDef; progress: number }[] {
    return (this.sv?.research?.running ?? []).flatMap((j) => {
      const p = this.project(j.id);
      return p ? [{ project: p, progress: 1 - j.left / (p.days * RESEARCH.daySeconds) }] : [];
    });
  }

  /** Why a project can't start now, if it can't. */
  problem(id: string): string | undefined {
    const p = this.project(id);
    if (!p || !this.on) return 'Unknown project';
    if (this.done(id)) return 'Already done';
    if (this.running(id)) return 'Already on the bench';
    if (!this.isOpen(p)) return 'Not open yet';
    if ((this.sv?.research?.running.length ?? 0) >= this.stations()) return 'The bench is busy';
    const short = this.sim.inventory.shortfall(p.cost);
    if (short) return `Needs ${short === 'biomass' ? 'Greens' : itemDef(short).name}`;
    return undefined;
  }

  /** Starts a project, paying its cost now. */
  start(id: string): boolean {
    if (this.problem(id)) return false;
    const p = this.project(id)!;
    if (!this.sim.inventory.pay(p.cost)) return false;
    this.st.running.push({ id, left: p.days * RESEARCH.daySeconds });
    this.sim.bus.emit('research.started', { id });
    return true;
  }

  /** Takes a project off the bench: what it took comes back, and it can be started again later. */
  stop(id: string): boolean {
    const r = this.sv?.research?.running;
    const i = r?.findIndex((j) => j.id === id) ?? -1;
    if (!r || i < 0) return false;
    r.splice(i, 1);
    this.sim.inventory.refund(this.project(id)!.cost);
    return true;
  }

  /** Runs the bench for `dt` seconds of game time, while the house has power. */
  tick(dt: number) {
    const r = this.sv?.research?.running;
    if (!r?.length || !this.powered()) return;
    for (const j of [...r]) {
      j.left -= dt;
      if (j.left > 1e-9) continue;
      r.splice(r.indexOf(j), 1);
      this.st.done.push(j.id);
      this.sim.bus.emit('research.done', { id: j.id });
    }
  }

  // ───────────── upgrades (bought at the crafting table) ─────────────

  /** Upgrades research has opened, in data order. */
  upgrades(): ResearchUpgradeDef[] {
    const open = new Set(PROJECTS.filter((p) => 'upgrade' in p.gives && this.done(p.id)).map((p) => (p.gives as { upgrade: string }).upgrade));
    return RESEARCH_UPGRADES.filter((u) => open.has(u.id));
  }

  upgradeDef(id: string): ResearchUpgradeDef | undefined {
    return RESEARCH_UPGRADES.find((u) => u.id === id);
  }

  /** Why the next level can't be bought now, if it can't. */
  upgradeProblem(id: string): string | undefined {
    const u = this.upgradeDef(id);
    if (!u || !this.upgrades().includes(u)) return 'Not open yet';
    const lvl = this.level(id);
    if (lvl >= u.levels.length) return 'As good as it gets';
    const short = this.sim.inventory.shortfall(u.levels[lvl].cost);
    if (short) return `Needs ${short === 'biomass' ? 'Greens' : itemDef(short).name}`;
    return undefined;
  }

  /** Buys the next level of an upgrade. Returns the new level (0: nothing changed). */
  upgrade(id: string): number {
    if (this.upgradeProblem(id)) return 0;
    const u = this.upgradeDef(id)!;
    const lvl = this.level(id);
    if (!this.sim.inventory.pay(u.levels[lvl].cost)) return 0;
    this.st.levels[id] = lvl + 1;
    this.apply(id, lvl + 1);
    this.sim.bus.emit('research.upgraded', { id, level: lvl + 1 });
    return lvl + 1;
  }

  /** Hands a level to the systems that keep their own numbers (E23.2's charge). Others read `level(id)`. */
  private apply(id: string, level: number) {
    const charge = (this.sim.state as { charge?: { cells?: number; efficiency?: number } }).charge;
    if (!charge) return;
    if (id === 'chargeCells') charge.cells = level;
    if (id === 'chargeEfficiency') charge.efficiency = level;
  }
}
