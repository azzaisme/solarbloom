import { GROUND } from '../core/GameState';
import { allPiles, pileById, regionById, regionOfCell, setPieceAt } from '../core/OldCityLayout';
import type { MachineData, MaterialId, TileData } from '../core/types';
import { PARK_SET, type PileDef, type RegionDef } from '../data/oldcity';
import { MATERIALS, SALVAGE } from '../data/salvage';
import type { Sim } from './Sim';

/**
 * E21.2 (§3): salvage piles and seams. A pile is a real thing in the simulation, placed from data/oldcity: it
 * blocks its tile (generation stamps it) and only what is `left` is saved. Salvaging takes up to 3 units into the
 * backpack; an empty pile is gone for good and its tile is ordinary dead ground, ready to restore. Piles never
 * come back. Reclaimers on a woken region's seam send its material to the store, 6 a minute.
 */
export class SalvageSystem {
  constructor(private sim: Sim) {}

  get on(): boolean {
    return !!this.sim.state.salvage;
  }

  /** Units a pile starts with. */
  size(p: PileDef): number {
    return SALVAGE.units[p.size];
  }

  /** Units left in a pile. */
  left(id: string): number {
    const p = pileById(id);
    if (!p || !this.on) return 0;
    return this.sim.state.salvage!.piles[id] ?? this.size(p);
  }

  /** The pile standing on a ground cell (with something left), if any. */
  pileAt(x: number, z: number): PileDef | undefined {
    if (!this.on) return undefined;
    const sp = setPieceAt(x, z);
    return sp?.kind === 'pile' && this.left(sp.pile.id) > 0 ? sp.pile : undefined;
  }

  /** Why a pile can't be salvaged now (undefined: it can). */
  problem(id: string): string | undefined {
    const p = pileById(id);
    if (!p || !this.on) return 'Nothing to salvage here';
    if (this.left(id) <= 0) return 'Nothing left here';
    const area = this.sim.areas.map.areaOfCell(p.x, p.z);
    if (this.sim.areas.fog(area) === 'hidden') return 'Lost in the cloud — open the way here first';
    if (this.sim.inventory.room(p.material) <= 0) return `Your ${MATERIALS[p.material].name} stack is full — put some in storage first`;
    return undefined;
  }

  /** Units one salvage of this pile gives (Elder Grove's reward doubles Seeds). */
  private yieldOf(p: PileDef, take: number): number {
    return p.material === 'seeds' && this.rewardOn('seedsDouble') ? take * SALVAGE.seedsBonus : take;
  }

  private rewardOn(id: string): boolean {
    return !!this.sim.state.salvage?.rewards?.includes(id);
  }

  /**
   * Salvages a pile once: up to 3 units into the backpack. A full stack refuses with a reason and leaves the pile
   * untouched. At 0 the pile is removed and its tile becomes ordinary dead ground. Returns the units taken.
   */
  salvage(id: string): number {
    const s = this.sim;
    const why = this.problem(id);
    if (why) {
      s.bus.emit('action.failed', { reason: why });
      return 0;
    }
    const p = pileById(id)!;
    const left = this.left(id);
    const take = Math.min(SALVAGE.perTake, left);
    const give = this.yieldOf(p, take);
    const room = s.inventory.room(p.material);
    // take only what fits (a nearly full stack takes less from the pile)
    const fit = Math.min(give, room);
    const used = give === take ? fit : Math.ceil(fit / SALVAGE.seedsBonus);
    s.inventory.add(p.material, fit);
    const now = left - used;
    s.state.salvage!.piles[id] = now;
    if (now <= 0) this.clearTile(p);
    s.bus.emit('pile.salvaged', { pileId: id, material: p.material, got: fit, left: now, x: p.x, z: p.z });
    return fit;
  }

  /** An emptied pile's tile: open, dead ground (saved as an entry fix, so it never comes back). */
  private clearTile(p: PileDef) {
    const t = this.sim.grid.get(GROUND, p.x, p.z);
    if (!t) return;
    t.blocked = false;
    t.unblocked = true;
    this.sim.transitions.unblock(t);
    this.sim.grid.touch(t);
    this.sim.production.markNear(GROUND, t.x, t.z, 1);
  }

  /** Loose units still lying in piles of a material, optionally only in one region ('park' for the park). */
  looseLeft(material: MaterialId, where?: string): number {
    let n = 0;
    for (const p of allPilesOf(where)) if (p.material === material) n += this.left(p.id);
    return n;
  }

  // ───────────── seams and Reclaimers ─────────────

  /** The region whose seam this 2×2 footprint is exactly on, if any. */
  seamAt(x: number, z: number): RegionDef | undefined {
    const r = regionOfCell(x, z);
    return r && r.seam.x === x && r.seam.z === z ? r : undefined;
  }

  /** Is a region's landmark awake (its area cleared)? */
  woken(r: RegionDef): boolean {
    return this.sim.areas.fog(r.id) === 'cleared';
  }

  /** Units a minute one Reclaimer sends (Mk 2 with its blueprint). */
  perMinute(): number {
    return this.sim.state.salvage?.blueprints.includes('reclaimerMk2') ? SALVAGE.reclaimerMk2PerMinute : SALVAGE.reclaimerPerMinute;
  }

  private material(m: MachineData): MaterialId | undefined {
    return regionOfCell(m.x, m.z)?.material;
  }

  /** Per sim step: every Reclaimer fills its fraction and sends whole units to the store. */
  tick(dt: number) {
    if (!this.on) return;
    const list = this.sim.machinesOfType('reclaimer');
    if (!list.length) return;
    const sv = this.sim.state.salvage!;
    const rate = this.perMinute() / 60;
    for (const m of list) {
      const mat = this.material(m);
      if (!mat) continue;
      const acc = (sv.reclaim?.[m.id] ?? 0) + rate * dt;
      const whole = Math.floor(acc + 1e-9);
      (sv.reclaim ??= {})[m.id] = Math.round((acc - whole) * 1e6) / 1e6;
      if (whole > 0) {
        this.sim.inventory.addToStore(mat, whole);
        this.sim.bus.emit('reclaimer.delivered', { machineId: m.id, material: mat, n: whole });
      }
    }
  }

  /** Away: Reclaimers earn half their rate for up to 4 hours. Returns units per material. */
  offline(awaySeconds: number): Partial<Record<MaterialId, number>> {
    const out: Partial<Record<MaterialId, number>> = {};
    if (!this.on) return out;
    const secs = Math.min(awaySeconds, SALVAGE.offlineHours * 3600);
    const per = Math.floor((this.perMinute() / 60) * secs * SALVAGE.offlineShare);
    if (per <= 0) return out;
    for (const m of this.sim.machinesOfType('reclaimer')) {
      const mat = this.material(m);
      if (!mat) continue;
      this.sim.inventory.addToStore(mat, per);
      out[mat] = (out[mat] ?? 0) + per;
    }
    return out;
  }

  /** E21.24: records something seen once (a lookout's view, a beacon spotted). Returns true the first time. */
  see(key: string): boolean {
    const sv = this.sim.state.salvage;
    if (!sv || sv.seen?.includes(key)) return false;
    (sv.seen ??= []).push(key);
    return true;
  }

  /** The material a tile's region gives (Lucky Cat rewards, prompts). */
  regionMaterial(t: Pick<TileData, 'x' | 'z'>): MaterialId {
    return regionOfCell(t.x, t.z)?.material ?? 'scrap';
  }

  regionById = regionById;

  /**
   * E21: what an Old City set piece on a tile is, for tooltips and refused pulses (undefined: not a set piece).
   * Names actions, never keys (E22 owns prompts).
   */
  describe(t: TileData): { title: string; detail: string } | undefined {
    if (!this.on || t.roofId !== GROUND) return undefined;
    const sp = setPieceAt(t.x, t.z);
    if (t.blocked && t.feature === 'water' && !sp) return { title: 'The sea', detail: 'Open water: nothing crosses it.' };
    if (!sp) return undefined;
    if (sp.kind === 'pile' && this.left(sp.pile.id) > 0) {
      const m = MATERIALS[sp.pile.material];
      return { title: `${m.icon} ${m.name} pile`, detail: `${this.left(sp.pile.id)} ${m.name} left. Hold Interact to salvage it, 3 at a time.` };
    }
    if (sp.kind === 'gate' && !this.sim.gates.isOpen(sp.gate.id)) return { title: 'In the way', detail: sp.gate.blocked };
    if (sp.kind === 'keeper') return { title: `🤖 ${sp.keeper.name}`, detail: this.sim.keepers.hint(sp.keeper.id) };
    if (sp.kind === 'shed') return { title: 'A ruined shed', detail: 'Bloombot\'s house, one day.' };
    if (sp.kind === 'lookout') return { title: 'A lookout', detail: 'A bench and an old telescope. Interact to look out over the city.' };
    return undefined;
  }
}

function allPilesOf(where?: string): PileDef[] {
  if (!where) return allPiles();
  if (where === 'park') return PARK_SET.piles;
  return regionById(where)?.piles ?? [];
}
