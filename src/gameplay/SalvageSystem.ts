import { GROUND } from '../core/GameState';
import { allPiles, pileById, regionById, regionOfCell, setPieceAt } from '../core/OldCityLayout';
import type { MaterialId, TileData } from '../core/types';
import { gameDays } from '../data/time';
import { PARK_SET, type PileDef, type RegionDef } from '../data/oldcity';
import { MATERIALS, SALVAGE } from '../data/salvage';
import type { Sim } from './Sim';

/**
 * E21.2 (§3): salvage piles and seams. A pile is a real thing in the simulation, placed from data/oldcity: it
 * blocks its tile (generation stamps it) and only what is `left` is saved. Salvaging takes up to 3 units into the
 * backpack; an empty pile's tile is open ground, ready to restore.
 *
 * E23.7.4 (#398): piles come back. A pile refills slowly over a few game days of play, and a storm blows every pile
 * full at once, so finished regions stay worth visiting. (E21's Reclaimers and their offline income are gone.)
 */
export class SalvageSystem {
  constructor(private sim: Sim) {
    sim.bus.on('weather.storm', () => this.blowIn());
  }

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
    // E23.7.4: the refill clock starts (or keeps running) from the first take
    const sv = s.state.salvage!;
    if (!sv.since?.[id]) (sv.since ??= {})[id] = s.state.time;
    if (now <= 0) this.clearTile(p);
    s.bus.emit('pile.salvaged', { pileId: id, material: p.material, got: fit, left: now, x: p.x, z: p.z });
    return fit;
  }

  /** An emptied pile's tile: open ground (it takes the pile back when it refills, E23.7.4). */
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

  /** Is a region's landmark awake (its area cleared)? */
  woken(r: RegionDef): boolean {
    return this.sim.areas.fog(r.id) === 'cleared';
  }

  // ───────────── E23.7.4: piles refill ─────────────

  /** Sim seconds for one unit to come back to a pile (a whole pile refills over `SALVAGE.refillDays` game days). */
  perUnit(p: PileDef): number {
    const lore = this.sim.state.salvage?.blueprints.includes('salvageLore') ? SALVAGE.loreRefill : 1; // Terraces' blueprint
    return gameDays(SALVAGE.refillDays) / lore / this.size(p);
  }

  /**
   * Can a pile stand on its tile again? Not under a machine or a decoration, and not on top of bloombot. (Restored
   * ground is fine: the pile sits on it and the ground stays restored.)
   */
  private canStand(p: PileDef): boolean {
    const t = this.sim.grid.get(GROUND, p.x, p.z);
    if (!t || t.occupantId) return false;
    const b = this.sim.bot;
    return !(b && b.roofId === GROUND && Math.floor(b.x) === p.x && Math.floor(b.z) === p.z);
  }

  /** An emptied pile's tile takes the pile back (it blocks its tile again, as a pile always has). */
  private standTile(p: PileDef) {
    const t = this.sim.grid.get(GROUND, p.x, p.z);
    if (!t || t.blocked) return;
    t.blocked = true;
    delete t.unblocked;
    delete t.tr;
    this.sim.grid.touch(t);
    this.sim.production.markNear(GROUND, t.x, t.z, 1);
  }

  /**
   * Per sim step (checked every few seconds): piles bloombot has taken from refill a unit at a time, a whole pile
   * over `SALVAGE.refillDays` game days of play. An emptied pile comes back once its tile is free.
   */
  tick(_dt: number) {
    if (!this.on) return;
    const s = this.sim;
    if (s.state.time < this.checkAt) return;
    this.checkAt = s.state.time + SALVAGE.refillCheckSeconds;
    const sv = s.state.salvage!;
    for (const id of Object.keys(sv.piles)) {
      const p = pileById(id);
      if (!p) continue;
      const since = (sv.since ??= {})[id] ?? (sv.since[id] = s.state.time);
      const per = this.perUnit(p);
      const gained = Math.floor((s.state.time - since) / per + 1e-9);
      if (gained <= 0) continue;
      const left = sv.piles[id];
      if (left <= 0 && !this.canStand(p)) continue; // waits for its tile (keeps its time: it comes back at once)
      const now = Math.min(this.size(p), left + gained);
      if (left <= 0) this.standTile(p);
      this.setLeft(p, now, since + gained * per);
      s.bus.emit('pile.refilled', { pileId: id, left: now, x: p.x, z: p.z, storm: false });
    }
  }

  private checkAt = 0;

  /** Records a pile's units (a full pile drops out of the save: untouched piles are full). */
  private setLeft(p: PileDef, left: number, since: number) {
    const sv = this.sim.state.salvage!;
    if (left >= this.size(p)) {
      delete sv.piles[p.id];
      if (sv.since) delete sv.since[p.id];
      if (sv.since && !Object.keys(sv.since).length) delete sv.since;
    } else {
      sv.piles[p.id] = left;
      (sv.since ??= {})[p.id] = since;
    }
  }

  /** E23.7.2.3 / E23.7.4: a storm blows fresh salvage in: every pile that can stand is full at once. */
  blowIn(): number {
    if (!this.on) return 0;
    const s = this.sim;
    let n = 0;
    for (const id of Object.keys(s.state.salvage!.piles)) {
      const p = pileById(id);
      if (!p) continue;
      if (s.state.salvage!.piles[id] <= 0) {
        if (!this.canStand(p)) continue;
        this.standTile(p);
      }
      this.setLeft(p, this.size(p), s.state.time);
      s.bus.emit('pile.refilled', { pileId: id, left: this.size(p), x: p.x, z: p.z, storm: true });
      n++;
    }
    return n;
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
    if (sp.kind === 'page') return { title: 'A page on a post', detail: this.sim.journal.found(sp.id) ? "A page of the maker's journal. You have read this one." : "A page in the maker's handwriting." };
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
