import { GROUND } from '../core/GameState';
import { canStep } from '../core/Height';
import { TUNING } from '../data/tuning';
import { inRect, keeperById, regionById } from '../core/OldCityLayout';
import type { KeeperState, KeeperStep, MaterialId } from '../core/types';
import { FRIENDSHIP, KEEPER_HELP, KEEPER_STORIES, type ArcBeat, type KeeperStory } from '../data/keepers';
import { KEEPERS, KEEPSAKES, type KeeperDef, type RegionDef, type RegionId } from '../data/oldcity';
import { MATERIAL_IDS, MATERIALS, type MaterialCost } from '../data/salvage';
import type { Sim } from './Sim';
import { Walker } from './Walker';

/** Units of anything a stirring Keeper takes to wake. */
export const WAKE_GIFT = 5;

/**
 * E21.8 (§8): each region's Keeper, a sleeping robot by its entrance, and its story:
 * asleep → (a pulse makes it stir, 5 of anything wakes it) → request1 (bring something from another region) →
 * request2 (restore a named patch, every tile) → landmark (wake the landmark with a delivery, E21.9) → settled.
 * Each step speaks one to three lines from data/oldcity (`keeper.said`). Saved in `salvage.keepers`.
 *
 * E23.9.2: each Keeper is a friend with an arc from taker to tender (data/keepers). It remembers the old way when it
 * wakes, notices the new way when its patch comes back, takes up its job the new way when its landmark wakes, and
 * once settled takes gifts it likes (one a game day). After three it is bloombot's friend and gives its region's
 * keepsake. Friends can sit with bloombot on a bench (`benchFriend`, for E23.2.3).
 */
export class KeeperSystem {
  constructor(private sim: Sim) {}

  get on(): boolean {
    return !!this.sim.state.salvage;
  }

  /** A Keeper's state (a Keeper never met is asleep). */
  state(id: string): KeeperState {
    return this.sim.state.salvage?.keepers[id] ?? { step: 'asleep' };
  }

  step(id: string): KeeperStep {
    return this.state(id).step;
  }

  def(id: string): KeeperDef {
    return keeperById(id)!;
  }

  region(id: string): RegionDef {
    return regionById(this.def(id).region)!;
  }

  /** The Keeper standing on a ground cell, if any. */
  at(x: number, z: number): KeeperDef | undefined {
    return KEEPERS.find((k) => k.x === x && k.z === z);
  }

  /** Can bloombot reach the Keeper (its region is open)? A Keeper is never shown or met in fog. */
  visible(id: string): boolean {
    return this.sim.areas.fog(this.def(id).region) !== 'hidden';
  }

  private set(id: string, st: KeeperState) {
    this.sim.state.salvage!.keepers[id] = st;
  }

  private say(id: string, lines: string[]) {
    this.sim.bus.emit('keeper.said', { keeperId: id, lines: lines.slice(0, 4) });
  }

  /** E23.9.2: a Keeper's story (personality, arc, likes, gifts). */
  story(id: string): KeeperStory | undefined {
    return KEEPER_STORIES[id];
  }

  /** E23.9.2: one beat of its arc (empty when it has none). */
  beat(id: string, b: ArcBeat): string[] {
    return this.story(id)?.arc[b] ?? [];
  }

  private go(id: string, step: KeeperStep) {
    this.set(id, { step });
    this.sim.bus.emit('keeper.step', { keeperId: id, step });
  }

  /** A pulse on a sleeping Keeper: it stirs (and asks for 5 of anything). True when it did something. */
  pulse(id: string): boolean {
    if (!this.on || !this.visible(id)) return false;
    const st = this.state(id);
    if (st.step !== 'asleep') return false;
    if (!st.pulsed) this.set(id, { step: 'asleep', pulsed: true });
    this.say(id, this.def(id).say.stirred);
    return true;
  }

  /** The material a waking gift takes: the one bloombot carries most of (at least 5), else from the store if near. */
  giftMaterial(): MaterialId | undefined {
    const inv = this.sim.inventory;
    const by = (f: (m: MaterialId) => number) => MATERIAL_IDS.filter((m) => f(m) >= WAKE_GIFT).sort((a, b) => f(b) - f(a) || MATERIAL_IDS.indexOf(a) - MATERIAL_IDS.indexOf(b))[0];
    return by((m) => inv.count(m)) ?? by((m) => inv.available(m));
  }

  /** What a Keeper wants now, as a cost (request 1 or the landmark), less what was already given. */
  wants(id: string): MaterialCost | undefined {
    const st = this.state(id);
    const d = this.def(id);
    const cost = st.step === 'request1' ? d.request1 : st.step === 'landmark' ? d.landmark : undefined;
    if (!cost) return undefined;
    const out: MaterialCost = {};
    for (const [k, v] of Object.entries(cost) as [MaterialId | 'biomass', number][]) {
      const left = v - ((st.given as Record<string, number> | undefined)?.[k] ?? 0);
      if (left > 0) out[k] = left;
    }
    return out;
  }

  /**
   * Interact with a Keeper: wake it (if it stirs and bloombot has 5 of anything), hand over what it asks for
   * (a bit at a time is fine), or hear what it is waiting for. Returns what happened.
   */
  interact(id: string): 'stirs' | 'woke' | 'gave' | 'done' | 'talked' | 'none' {
    const s = this.sim;
    if (!this.on || !this.visible(id)) return 'none';
    const st = this.state(id);
    const d = this.def(id);
    if (st.step === 'asleep') {
      if (!st.pulsed) {
        this.say(id, d.say.asleep);
        return 'talked';
      }
      const m = this.giftMaterial();
      if (!m || !s.inventory.pay({ [m]: WAKE_GIFT })) {
        s.bus.emit('action.failed', { reason: `${d.name} stirs: bring ${WAKE_GIFT} of anything to wake it` });
        this.say(id, d.say.stirred);
        return 'stirs';
      }
      this.go(id, 'request1');
      this.say(id, [...d.say.woke, ...this.beat(id, 'taker'), ...d.say.request1]);
      return 'woke';
    }
    if (st.step === 'request1') {
      const before = JSON.stringify(st.given ?? {});
      const given = { ...(st.given ?? {}) };
      for (const [k, v] of Object.entries(this.wants(id) ?? {}) as [MaterialId, number][]) {
        const n = Math.min(v, s.inventory.available(k));
        if (n > 0 && s.inventory.pay({ [k]: n })) given[k] = (given[k] ?? 0) + n;
      }
      if (JSON.stringify(given) === before) {
        this.say(id, d.say.request1);
        return 'talked';
      }
      this.set(id, { step: 'request1', given });
      if (!Object.keys(this.wants(id) ?? {}).length) {
        this.go(id, 'request2');
        this.say(id, d.say.request2);
        this.check(id);
        return 'done';
      }
      return 'gave';
    }
    if (st.step === 'settled') return this.befriend(id);
    this.say(id, st.step === 'request2' ? d.say.request2 : d.say.landmark);
    return 'talked';
  }

  /** The patch tiles of a Keeper's second request, and how many are restored. */
  patch(id: string): { restored: number; total: number } {
    const p = this.region(id).patch;
    let restored = 0;
    let total = 0;
    for (let z = p.z; z < p.z + p.d; z++)
      for (let x = p.x; x < p.x + p.w; x++) {
        const t = this.sim.grid.get(GROUND, x, z);
        if (!t || t.blocked || t.occupantId) continue;
        total++;
        if (t.ground === 'restored') restored++;
      }
    return { restored, total };
  }

  /** Request 2 completes the moment every tile of its patch is restored. */
  private check(id: string) {
    if (this.step(id) !== 'request2') return;
    const p = this.patch(id);
    if (p.total > 0 && p.restored >= p.total) {
      this.go(id, 'landmark');
      this.say(id, [...this.beat(id, 'turning'), ...this.def(id).say.landmark]);
    }
  }

  /** A restored tile inside a waiting patch may finish request 2 (called by the area system). */
  onRestored(x: number, z: number) {
    if (!this.on) return;
    for (const k of KEEPERS) if (this.step(k.id) === 'request2' && inRect(this.region(k.id).patch, x, z)) this.check(k.id);
  }

  /** E21.9: the landmark delivery is in and the landmark woke: the Keeper settles. */
  settle(id: string) {
    if (this.step(id) === 'settled') return;
    this.go(id, 'settled');
    this.say(id, [...this.beat(id, 'tender'), ...this.def(id).say.settled]);
  }

  // ───────────── E23.9.2: friendship ─────────────

  /**
   * Keepers help out: every settled Keeper tends one restored tile near it every KEEPER_HELP.tendEverySeconds (a
   * friend twice as often): the least bloomed tile within its radius, in its own region, one step toward full bloom.
   * Deterministic (fixed times, world order), and it only touches loaded ground.
   */
  tick(dt: number) {
    if (!this.on) return;
    const now = this.sim.time;
    // a Keeper dozes at night (E23.7's clock), and so does its tending
    const night = this.sim.clock.isNight();
    for (const k of KEEPERS) {
      if (this.step(k.id) !== 'settled') continue;
      const st = this.state(k.id);
      // on its way: the tile blooms once it has walked there and tended it
      if (st.tending) {
        if (now >= st.tending.at) this.finishTending(k.id);
        continue;
      }
      if (night) continue;
      const every = KEEPER_HELP.tendEverySeconds / (this.isFriend(k.id) ? KEEPER_HELP.friendMult : 1);
      if (Math.floor(now / every) === Math.floor((now - dt) / every)) continue;
      this.startTending(k.id);
    }
  }

  /**
   * Picks the tile a Keeper will tend next: the least bloomed restored tile it can walk to (nearest first on a tie),
   * and when it will have walked there and tended it. Saved, so a reload carries on where it was.
   */
  startTending(id: string): { x: number; z: number } | undefined {
    let best: { x: number; z: number; steps: number; bloom: number } | undefined;
    for (const c of keeperReach(this.sim, id)) {
      const t = this.sim.grid.peek(GROUND, c.x, c.z)!;
      if (t.bloom >= TUNING.restore.maxBloom) continue;
      if (!best || t.bloom < best.bloom) best = { ...c, bloom: t.bloom };
    }
    if (!best) return undefined;
    const at = this.sim.time + best.steps / KEEPER_HELP.walkSpeed + KEEPER_HELP.tendSeconds;
    this.set(id, { ...this.state(id), tending: { x: best.x, z: best.z, at } });
    this.sim.bus.emit('keeper.tending', { keeperId: id, x: best.x, z: best.z });
    return { x: best.x, z: best.z };
  }

  /** The Keeper has walked to its tile and tended it: one bloom step. */
  finishTending(id: string): { x: number; z: number } | undefined {
    const st = this.state(id);
    const c = st.tending;
    if (!c) return undefined;
    this.set(id, { ...st, tending: undefined });
    const t = this.sim.grid.peek(GROUND, c.x, c.z);
    if (!t || t.ground !== 'restored' || t.bloom >= TUNING.restore.maxBloom || t.occupantId || t.blocked) return undefined;
    this.sim.restoration.grow(t, undefined, 'auto', true);
    this.sim.bus.emit('keeper.tended', { keeperId: id, x: c.x, z: c.z });
    return { x: c.x, z: c.z };
  }

  /**
   * E23.9.2 → E23.2.3: a Keeper's walk from a cell to beside another (a bench seat), over ground bloombot could walk,
   * so a friend walks over to sit rather than appearing. Cell centres, the start left out; [] when already beside it;
   * undefined when there is no way within bloombot's search budget.
   */
  pathTo(id: string, from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] | undefined {
    if (!keeperById(id)) return undefined;
    const tx = Math.floor(to.x);
    const tz = Math.floor(to.z);
    return new Walker(this.sim).path(GROUND, from.x, from.z, (x, z) => Math.abs(x - tx) + Math.abs(z - tz) <= 1 && !(x === tx && z === tz), { x: tx, z: tz });
  }

  /** Where a Keeper is off to tend (undefined: nowhere). */
  tendingAt(id: string): { x: number; z: number } | undefined {
    const t = this.state(id).tending;
    return t && { x: t.x, z: t.z };
  }

  /** Gifts it has liked so far (0 until it settles). */
  hearts(id: string): number {
    return this.state(id).hearts ?? 0;
  }

  isFriend(id: string): boolean {
    return this.hearts(id) >= FRIENDSHIP.giftsToFriend;
  }

  /** Every Keeper that calls bloombot a friend, in map order. */
  friends(): string[] {
    return KEEPERS.filter((k) => this.isFriend(k.id)).map((k) => k.id);
  }

  /**
   * E23.2.3's hook: the friend who comes to sit beside bloombot on a bench in a region (undefined: none). A Keeper sits
   * only in its own region, and only once it is a friend.
   */
  benchFriend(region: RegionId | string | undefined): string | undefined {
    return KEEPERS.find((k) => k.region === region && this.isFriend(k.id))?.id;
  }

  /** Everything it loves, best first (its own likes, then what every Keeper loves). */
  likes(id: string): string[] {
    const own = this.story(id)?.likes ?? [];
    return [...own, ...(own.includes(FRIENDSHIP.everyoneLikes) ? [] : [FRIENDSHIP.everyoneLikes])];
  }

  /** The gift bloombot would hand over now: the best thing it loves that bloombot carries (undefined: none, or not today). */
  giftFor(id: string): MaterialId | undefined {
    const st = this.state(id);
    if (!this.on || st.step !== 'settled' || this.isFriend(id) || !this.story(id)) return undefined;
    if (st.giftedAt !== undefined && this.sim.time - st.giftedAt < FRIENDSHIP.giftEverySeconds) return undefined;
    return this.likes(id).find((m) => this.sim.inventory.count(m as MaterialId) > 0) as MaterialId | undefined;
  }

  /** Talking to a settled Keeper: hand it a gift it loves (once a game day), or just chat. */
  /** A settled Keeper says something, and nothing changes hands (Pulse on it, or a friend with nothing to give). */
  chat(id: string): 'talked' {
    const st = this.state(id);
    const story = this.story(id);
    if (!story || !this.isFriend(id)) {
      this.say(id, this.def(id).say.settled);
      return 'talked';
    }
    const n = st.chats ?? 0;
    this.set(id, { ...st, chats: n + 1 });
    this.say(id, [story.chatter[n % story.chatter.length]]);
    return 'talked';
  }

  /** Hands a settled Keeper the gift it loves most that bloombot carries (once a game day); otherwise it chats. */
  private befriend(id: string): 'gave' | 'talked' {
    const st = this.state(id);
    const story = this.story(id);
    const gift = this.giftFor(id);
    if (!story || !gift || !this.sim.inventory.take(gift, 1)) return this.chat(id);
    const hearts = (st.hearts ?? 0) + 1;
    this.set(id, { ...st, hearts, giftedAt: this.sim.time });
    this.sim.bus.emit('keeper.gift', { keeperId: id, item: gift, hearts });
    if (hearts === 1)
      for (const [m, n] of Object.entries(story.giftBack) as [MaterialId, number][]) {
        const left = this.sim.inventory.add(m, n);
        if (left > 0) this.sim.inventory.addToStore(m, left);
      }
    if (hearts < FRIENDSHIP.giftsToFriend) {
      this.say(id, [story.thanks]);
      return 'gave';
    }
    // the friend beat, and its region's keepsake
    const ks = KEEPSAKES.find((k) => k.region === this.def(id).region);
    const sv = this.sim.state.salvage!;
    if (ks && !sv.items?.includes(ks.id)) (sv.items ??= []).push(ks.id);
    this.sim.bus.emit('keeper.friend', { keeperId: id });
    this.say(id, this.beat(id, 'friend'));
    return 'gave';
  }

  /** What a Keeper is waiting for, in one line (tooltips, the objective card). */
  hint(id: string): string {
    const d = this.def(id);
    const st = this.state(id);
    switch (st.step) {
      case 'asleep':
        return st.pulsed ? `${d.name} stirs. Hand it ${WAKE_GIFT} of anything to wake it.` : `${d.name} is asleep. Pulse it to wake it.`;
      case 'request1':
        return `${d.name} asks for ${costText(this.wants(id) ?? {})}.`;
      case 'request2': {
        const p = this.patch(id);
        return `${d.name} asks you to restore ${this.region(id).patch.name.toLowerCase()}: ${p.restored}/${p.total}.`;
      }
      case 'landmark':
        return `${d.name}: wake the ${this.region(id).landmark.name} with ${costText(this.wants(id) ?? {})}.`;
      default: {
        // E23.9.2: until it is a friend, what it loves (the backpack's names; things not found yet stay unnamed)
        if (this.isFriend(id) || !this.story(id)) return `${d.name} looks after ${this.region(id).name}.`;
        const named = this.likes(id).filter((m) => m in MATERIALS).map((m) => MATERIALS[m as MaterialId].name);
        return `${d.name} looks after ${this.region(id).name}.${named.length ? ` It loves ${named.join(' and ')}.` : ''}`;
      }
    }
  }

  /** Keepers that are awake and still want something, in map order (the first is the pinned request). */
  requests(): { id: string; text: string }[] {
    return KEEPERS.filter((k) => this.step(k.id) !== 'asleep' && this.step(k.id) !== 'settled').map((k) => ({ id: k.id, text: this.hint(k.id) }));
  }

  /** The one request pinned in the objective card. */
  pinned(): { id: string; text: string } | undefined {
    return this.requests()[0];
  }
}

/**
 * E23.9.2: can a Keeper stand on this cell? Restored, open ground of its own region within KEEPER_HELP.radius of
 * where it sleeps (its own sleeping cell counts). Pure: the sim's tending and the visuals' walking agree on it.
 */
export function keeperCanStand(sim: Sim, id: string, x: number, z: number): boolean {
  const d = keeperById(id)!;
  if (x === d.x && z === d.z) return true;
  if (Math.abs(x - d.x) + Math.abs(z - d.z) > KEEPER_HELP.radius) return false;
  const r = regionById(d.region)!;
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  if (cx < r.chunks.x0 || cx > r.chunks.x1 || cz < r.chunks.z0 || cz > r.chunks.z1) return false;
  const t = sim.grid.peek(GROUND, x, z);
  return !!t && !t.blocked && !t.occupantId && t.ground === 'restored' && t.feature !== 'water';
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Every cell a Keeper can walk to from where it sleeps, nearest first, with how many steps away. */
export function keeperReach(sim: Sim, id: string): { x: number; z: number; steps: number }[] {
  const d = keeperById(id)!;
  const seen = new Set([`${d.x},${d.z}`]);
  const out: { x: number; z: number; steps: number }[] = [];
  let edge = [{ x: d.x, z: d.z, steps: 0 }];
  while (edge.length) {
    const next: typeof edge = [];
    for (const c of edge)
      for (const [dx, dz] of N4) {
        const x = c.x + dx;
        const z = c.z + dz;
        const k = `${x},${z}`;
        if (seen.has(k) || !keeperCanStand(sim, id, x, z) || !canStep(c.x, c.z, x, z)) continue;
        seen.add(k);
        const n = { x, z, steps: c.steps + 1 };
        out.push(n);
        next.push(n);
      }
    edge = next;
  }
  return out;
}

/** A Keeper's walk between two cells it can stand on (both included), or undefined when there is none. */
export function keeperPath(sim: Sim, id: string, from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] | undefined {
  const key = (x: number, z: number) => `${x},${z}`;
  const prev = new Map<string, string | null>([[key(from.x, from.z), null]]);
  let edge = [from];
  while (edge.length && !prev.has(key(to.x, to.z))) {
    const next: { x: number; z: number }[] = [];
    for (const c of edge)
      for (const [dx, dz] of N4) {
        const x = c.x + dx;
        const z = c.z + dz;
        if (prev.has(key(x, z)) || !keeperCanStand(sim, id, x, z) || !canStep(c.x, c.z, x, z)) continue;
        prev.set(key(x, z), key(c.x, c.z));
        next.push({ x, z });
      }
    edge = next;
  }
  if (!prev.has(key(to.x, to.z))) return undefined;
  const path: { x: number; z: number }[] = [];
  for (let k: string | null = key(to.x, to.z); k; k = prev.get(k) ?? null) {
    const [x, z] = k.split(',').map(Number);
    path.unshift({ x, z });
  }
  return path;
}

/** "8 Seeds and 20 Biomass" */
export function costText(cost: MaterialCost): string {
  const parts = (Object.entries(cost) as [MaterialId | 'biomass', number][]).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k === 'biomass' ? 'Biomass' : MATERIALS[k].name}`);
  return parts.length <= 1 ? (parts[0] ?? 'nothing') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
