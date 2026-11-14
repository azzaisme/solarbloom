import { HOME } from './ProgressionSystem';
import type { CatRewardType, TileData } from '../core/types';
import { CAT_ANCHORS, type CatAnchor } from '../data/rooftops';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

export interface CatReward {
  type: CatRewardType;
  summary: string;
}

export const CAT_REWARD_NAMES: Record<CatRewardType, string> = {
  luckyHarvest: 'Lucky Harvest',
  solarFrenzy: 'Solar Frenzy',
  megaBloom: 'Mega Bloom',
  droneParty: 'Drone Party',
  jackpot: 'JACKPOT',
  goldenRelay: 'Golden Relay',
  catsGarden: "Cat's Garden",
};

/** How an anchor looks from the current camera: on screen, off screen (reachable by panning) or under the HUD. */
export type AnchorView = 'visible' | 'offscreen' | 'covered';

/**
 * Hidden Lucky Cat: spawning, claiming and rewards. Visual hiding/VFX live in the renderer.
 * `anchorView` is injected by the renderer: anchors under the HUD are never used; on-screen ones are preferred,
 * but a cat can hide on any playable rooftop (the player can pan there; it never expires).
 */
export class LuckyCatSystem {
  anchorView: (a: CatAnchor) => AnchorView = () => 'visible';

  constructor(private sim: Sim) {}

  anchor(id: string | undefined): CatAnchor | undefined {
    return CAT_ANCHORS.find((a) => a.id === id);
  }

  candidates(): CatAnchor[] {
    const s = this.sim;
    return CAT_ANCHORS.filter((a) => {
      const roof = s.grid.roof(a.roofId);
      if (!roof || !roof.unlocked || roof.preview) return false;
      if (a.needsFreeTile) {
        const t = s.grid.get(a.roofId, a.needsFreeTile[0], a.needsFreeTile[1]);
        if (!t || t.occupantId) return false;
      }
      return this.anchorView(a) !== 'covered';
    });
  }

  /** Picks a hiding spot: one in view most of the time, otherwise anywhere on a playable rooftop. */
  private pickAnchor(cands: CatAnchor[]): CatAnchor | undefined {
    if (!cands.length) return undefined;
    const rng = this.sim.rng;
    const visible = cands.filter((a) => this.anchorView(a) === 'visible');
    const pool = visible.length && (rng.next() < TUNING.cat.preferVisible || visible.length === cands.length) ? visible : cands;
    return rng.pick(pool);
  }

  /** A machine was built on the cat's nook: it hops to another spot instead of blocking the build. */
  relocateIfBlocked(): void {
    const c = this.sim.state.cat;
    const a = this.anchor(c.active?.anchorId);
    if (!c.active || !a?.needsFreeTile) return;
    const t = this.sim.grid.get(a.roofId, a.needsFreeTile[0], a.needsFreeTile[1]);
    if (!t?.occupantId) return;
    const next = this.pickAnchor(this.candidates().filter((x) => x.id !== a.id));
    if (!next) return; // nowhere else: it stays put (still clickable)
    c.active = { ...c.active, anchorId: next.id }; // same spawn time and reward roll: nothing lost or gained
    this.sim.bus.emit('cat.moved', { from: a.id, anchorId: next.id });
  }

  restoredCount() {
    return this.sim.progression.restoredCount(HOME);
  }

  tick() {
    const c = this.sim.state.cat;
    const t = this.sim.time;
    if (c.active) {
      // A missed cat never blocks rewards: when the next one would have appeared, it saves up an extra.
      if (c.nextSpawnAt >= 0 && t >= c.nextSpawnAt) {
        c.stash = Math.min(TUNING.cat.stashMax, (c.stash ?? 0) + 1);
        c.nextSpawnAt = t + this.sim.rng.range(TUNING.cat.laterMin, TUNING.cat.laterMax);
        this.sim.bus.emit('cat.stash', { stash: c.stash });
      }
      return;
    }
    if (!c.firstSpawned) {
      const ready = (t >= TUNING.cat.firstMinTime && this.restoredCount() >= TUNING.cat.firstMinRestored) || t >= TUNING.cat.firstForceTime;
      if (ready) this.spawn();
    } else if (c.nextSpawnAt >= 0 && t >= c.nextSpawnAt) {
      this.spawn();
    }
  }

  spawn(anchorId?: string): boolean {
    const c = this.sim.state.cat;
    if (c.active) return false;
    const cands = this.candidates();
    const a = anchorId ? cands.find((x) => x.id === anchorId) : this.pickAnchor(cands);
    if (!a) {
      c.nextSpawnAt = this.sim.time + 10;
      return false;
    }
    c.active = { anchorId: a.id, spawnedAt: this.sim.time };
    c.firstSpawned = true;
    c.nextSpawnAt = this.sim.time + this.sim.rng.range(TUNING.cat.laterMin, TUNING.cat.laterMax);
    this.sim.bus.emit('cat.spawned', { anchorId: a.id });
    return true;
  }

  /**
   * Cat's Garden: a small cluster of dead or plain tiles on one playable rooftop (rng-chosen, deterministic),
   * grown outward from a seed tile.
   */
  catsGardenTiles(): TileData[] {
    const s = this.sim;
    const ok = (t: TileData) => !t.occupantId && !t.blocked && !s.isCoreTile(t) && (s.restoration.isEligible(t) || (t.ground === 'restored' && t.bloom < 2));
    const roofs = s.grid.playableLayers().filter((r) => s.grid.tilesOf(r.id).some(ok));
    if (!roofs.length) return [];
    // Prefer a rooftop other than the one the player started on, so the reward shows up somewhere new.
    const away = roofs.filter((r) => r.id !== 'r1');
    const pool = away.length ? away : roofs;
    const roof = pool[Math.floor(this.sim.rng.next() * pool.length)];
    const seeds = s.grid.tilesOf(roof.id).filter(ok);
    const start = seeds[Math.floor(this.sim.rng.next() * seeds.length)];
    const out: TileData[] = [start];
    const seen = new Set([start.id]);
    for (let i = 0; i < out.length && out.length < TUNING.cat.catsGardenTiles; i++) {
      for (const n of s.grid.neighbors(out[i])) {
        if (seen.has(n.id) || !ok(n)) continue;
        seen.add(n.id);
        out.push(n);
        if (out.length >= TUNING.cat.catsGardenTiles) break;
      }
    }
    return out;
  }

  /** Summary for the discovery panel. */
  discoveries() {
    const log = this.sim.state.cat.log ?? [];
    const spots = new Set(log.map((e) => e.anchorId));
    const rewards: Partial<Record<CatRewardType, number>> = {};
    for (const e of log) rewards[e.reward] = (rewards[e.reward] ?? 0) + 1;
    return {
      found: this.sim.state.cat.found,
      anchors: CAT_ANCHORS.filter((a) => this.sim.grid.roof(a.roofId)).map((a) => ({ id: a.id, hint: a.hint, found: spots.has(a.id) })),
      rewards,
    };
  }

  /** Golden Relay needs a built bridge (and no unspent one); Cat's Garden needs a second rooftop. Never useless. */
  goldenRelayAvailable() {
    return this.sim.hood.builtLinks().length > 0 && this.sim.state.relayBonus <= 0;
  }

  catsGardenAvailable() {
    return this.sim.grid.playableLayers().length >= 2 && this.catsGardenTiles().length > 0;
  }

  rollReward(): CatRewardType {
    const hasHub = this.sim.state.machines.some((m) => m.type === 'droneHub');
    const w = TUNING.cat.weights;
    const table: [CatRewardType, number][] = [
      ['luckyHarvest', w.luckyHarvest],
      ['solarFrenzy', w.solarFrenzy],
      ['megaBloom', w.megaBloom],
      ['droneParty', hasHub ? w.droneParty : 0],
      ['jackpot', w.jackpot],
      ['goldenRelay', this.goldenRelayAvailable() ? w.goldenRelay : 0],
      ['catsGarden', this.catsGardenAvailable() ? w.catsGarden : 0],
    ];
    const total = table.reduce((a, [, x]) => a + x, 0);
    let r = this.sim.rng.next() * total;
    for (const [type, x] of table) {
      if ((r -= x) < 0) return type;
    }
    return 'luckyHarvest';
  }

  /** Claims the active cat exactly once. Returns undefined if there is no cat. */
  claim(): CatReward | undefined {
    const s = this.sim;
    const c = s.state.cat;
    const active = c.active;
    if (!active) return undefined;
    c.active = undefined; // clear first: a second click can never pay twice
    const first = c.found === 0;
    c.found++;
    s.state.stats.catsFound++;
    const hidden = Math.min(1, (s.time - active.spawnedAt) / TUNING.cat.hiddenBonusCapSec);
    const mult = 1 + TUNING.cat.hiddenBonusMax * hidden;
    const type: CatRewardType = first ? 'luckyHarvest' : this.rollReward();
    const parts = [this.apply(type, mult, hidden)];
    // Saved-up rewards from while it was hiding: extra Lucky Harvests.
    const extras = c.stash ?? 0;
    for (let i = 0; i < extras; i++) parts.push(this.apply('luckyHarvest', 1, 0));
    c.stash = 0;
    const summary = parts.join(' · ');
    c.lastReward = type;
    c.log = [...(c.log ?? []), { anchorId: active.anchorId, reward: type, at: s.time }];
    c.nextSpawnAt = s.time + s.rng.range(TUNING.cat.laterMin, TUNING.cat.laterMax);
    s.bus.emit('cat.found', { anchorId: active.anchorId, reward: type, summary, extras });
    return { type, summary };
  }

  private apply(type: CatRewardType, mult: number, hidden: number): string {
    const s = this.sim;
    const parts: string[] = [];
    const harvest = () => {
      const rate = s.production.rates().biomass;
      const secs = TUNING.cat.harvestSecondsMin + (TUNING.cat.harvestSecondsMax - TUNING.cat.harvestSecondsMin) * hidden;
      const amt = Math.max(TUNING.cat.harvestMin, rate * secs);
      const got = s.econ.add('biomass', amt);
      const w = s.econ.add('water', 10 * mult);
      const e = s.econ.add('energy', 15 * mult);
      if (got) s.bus.emit('resource.gain', { kind: 'biomass', amount: got, reason: 'cat' });
      if (w) s.bus.emit('resource.gain', { kind: 'water', amount: w, reason: 'cat' });
      if (e) s.bus.emit('resource.gain', { kind: 'energy', amount: e, reason: 'cat' });
      parts.push(`+${Math.floor(got)}🌿 +${Math.floor(w)}💧 +${Math.floor(e)}⚡`);
    };
    const frenzy = () => {
      const secs = TUNING.cat.frenzySeconds * mult;
      const existing = s.state.buffs.find((b) => b.type === 'solarFrenzy');
      if (existing) existing.until = Math.max(existing.until, s.time) + secs;
      else s.state.buffs.push({ type: 'solarFrenzy', until: s.time + secs });
      s.bus.emit('buff.started', { type: 'solarFrenzy', seconds: secs });
      parts.push(`Solar ×${TUNING.cat.frenzyMult} for ${Math.round(secs)} s`);
    };
    const mega = () => {
      const ok = s.chains.startMega(Math.round(TUNING.cat.megaBloomTiles * mult));
      parts.push(ok ? 'A free Mega Bloom!' : 'Everything is already blooming!');
      if (!ok) harvest();
    };
    const party = () => {
      const hub = s.state.machines.find((m) => m.type === 'droneHub');
      if (!hub) return harvest();
      s.drones.spawn(hub, TUNING.cat.dronePartySeconds * mult);
      s.drones.spawn(hub, TUNING.cat.dronePartySeconds * mult);
      parts.push(`2 party drones for ${Math.round(TUNING.cat.dronePartySeconds * mult)} s`);
    };
    const golden = () => {
      if (!this.goldenRelayAvailable()) return harvest(); // degrade gracefully, never useless
      s.state.relayBonus = TUNING.cat.goldenRelayExtra;
      s.bus.emit('cat.goldenRelay', {});
      parts.push(`Your next cross-roof chain sends +${TUNING.cat.goldenRelayExtra} extra remote bloom`);
    };
    const garden = () => {
      const tiles = this.catsGardenTiles();
      if (!tiles.length || !s.chains.startCatGarden(tiles)) return harvest();
      const roof = s.grid.roof(tiles[0].roofId)!;
      parts.push(`A little garden blooms on ${roof.name} (${tiles.length} tiles)`);
    };
    switch (type) {
      case 'luckyHarvest':
        harvest();
        break;
      case 'solarFrenzy':
        frenzy();
        break;
      case 'megaBloom':
        mega();
        break;
      case 'droneParty':
        party();
        break;
      case 'goldenRelay':
        golden();
        break;
      case 'catsGarden':
        garden();
        break;
      case 'jackpot': {
        // Two different compatible rewards together.
        const pool: (() => void)[] = [harvest, frenzy, mega];
        if (s.state.machines.some((m) => m.type === 'droneHub')) pool.push(party);
        if (this.goldenRelayAvailable()) pool.push(golden);
        if (this.catsGardenAvailable()) pool.push(garden);
        const i = Math.floor(s.rng.next() * pool.length);
        let j = Math.floor(s.rng.next() * (pool.length - 1));
        if (j >= i) j++;
        parts.push('JACKPOT!');
        pool[i]();
        pool[j]();
        break;
      }
    }
    return parts.join(' · ');
  }
}
