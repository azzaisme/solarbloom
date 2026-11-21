import { GROUND } from '../core/GameState';
import { canStep } from '../core/Height';
import { TUNING } from '../data/tuning';
import { inRect, keeperById, regionById } from '../core/OldCityLayout';
import type { KeeperState, KeeperStep, MaterialId } from '../core/types';
import { FRIENDSHIP, KEEPER_HELP, KEEPER_STORIES, type ArcBeat, type KeeperStory } from '../data/keepers';
import { KEEPERS, KEEPSAKES, type KeeperDef, type RegionDef, type RegionId } from '../data/oldcity';
import { CROPS, type CropId } from '../data/crops';
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
/** Something a Keeper can be given: a material from the backpack, or a crop from the basket (E23.5). */
export type GiftId = MaterialId | CropId;

/** A gift's name and icon (a material's; crops go by name), for Tally's panel. */
export function giftLabel(g: string): { name: string; icon: string } {
  const m = MATERIALS[g as MaterialId];
  if (m) return { name: m.name, icon: m.icon };
  const c = CROPS[g as CropId];
  return { name: c?.name ?? g, icon: '' };
}

/** Where a woken Keeper is and what it is doing (KeeperSystem.pose). */
export interface KeeperPose {
  x: number;
  z: number;
  facing: number;
  to?: { x: number; z: number };
  path: { x: number; z: number }[];
  /** seconds until it wanders a step */
  wait: number;
  doing: 'still' | 'walk' | 'tend' | 'home';
}

export class KeeperSystem {
  private poses = new Map<string, KeeperPose>();
  /** settled Keepers whose time to tend has come (waiting while bloombot talks to them) */
  private due = new Set<string>();

  constructor(private sim: Sim) {
    // E23.5 crops count as gifts: a harvest keeps one of its crop for a Keeper who loves it
    sim.bus.on('planter.harvested', ({ crop }) => {
      const sv = this.sim.state.salvage;
      if (!sv || !(crop in CROPS)) return;
      const b = (sv.basket ??= {});
      b[crop] = Math.min(FRIENDSHIP.basketMax, (b[crop] ?? 0) + 1);
    });
  }

  /** How many of a gift bloombot carries: a material in the backpack, or a crop in the basket. */
  carrying(gift: string): number {
    if (gift in MATERIALS) return this.sim.inventory.count(gift as MaterialId);
    return this.sim.state.salvage?.basket?.[gift] ?? 0;
  }

  private takeGift(gift: string): boolean {
    if (gift in MATERIALS) return this.sim.inventory.take(gift as MaterialId, 1);
    const b = this.sim.state.salvage?.basket;
    if (!b || !b[gift]) return false;
    if (b[gift] > 1) b[gift] -= 1;
    else delete b[gift];
    return true;
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

  /** The Keeper standing on a ground cell now, if any: where it is (wandering, at home, or off tending a tile), not where it sleeps. */
  at(x: number, z: number): KeeperDef | undefined {
    return KEEPERS.find((k) => {
      const p = this.pose(k.id);
      return Math.floor(p.x) === x && Math.floor(p.z) === z;
    });
  }

  /**
   * Where a Keeper is and what it is doing: the one place its position lives. The sim walks it (tick), the renderer
   * draws it here, and Interact finds it here. Not saved: after a load it starts at home and walks back to whatever it
   * was doing (a tile it was tending is saved).
   */
  pose(id: string): KeeperPose {
    let p = this.poses.get(id);
    if (!p) {
      const d = this.def(id);
      p = { x: d.x + 0.5, z: d.z + 0.5, facing: Math.PI, path: [], wait: 2, doing: 'still' };
      this.poses.set(id, p);
    }
    return p;
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
    if (!this.visible(id)) return false;
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
    for (const [k, v] of Object.entries(cost) as [MaterialId, number][]) {
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
    if (!this.visible(id)) return 'none';
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
    if (!this.sim.state.salvage) return;
    const now = this.sim.time;
    // a Keeper dozes at night (E23.7's clock), and so does its tending
    const night = this.sim.clock.isNight();
    for (const k of KEEPERS) {
      const step = this.step(k.id);
      if (step === 'asleep') continue;
      const p = this.pose(k.id);
      if (step === 'settled' && night) {
        p.doing = 'still';
        continue;
      }
      if (step === 'settled' && !this.state(k.id).tending) {
        const every = KEEPER_HELP.tendEverySeconds / (this.isFriend(k.id) ? KEEPER_HELP.friendMult : 1);
        if (Math.floor(now / every) !== Math.floor((now - dt) / every)) this.due.add(k.id);
        // it never walks off mid-conversation: with bloombot right in front of it, it goes once bloombot steps away
        const bot = this.sim.bot;
        const talking = !!bot && Math.hypot(bot.x - p.x, bot.z - p.z) < KEEPER_HELP.talkTiles;
        if (this.due.has(k.id) && !talking) {
          this.due.delete(k.id);
          this.startTending(k.id);
        }
      }
      this.move(k.id, p, dt);
    }
  }

  /**
   * One step of a woken Keeper's day: off to a tile it is tending, it walks there and works it (the tile blooms when
   * it is done, where it stands); otherwise, with bloombot near, it walks home to be talked to; otherwise it wanders.
   */
  private move(id: string, p: KeeperPose, dt: number) {
    const d = this.def(id);
    const st = this.state(id);
    const tend = st.tending;
    const bot = this.sim.bot;
    const near = !!bot && Math.hypot(bot.x - (d.x + 0.5), bot.z - (d.z + 0.5)) < KEEPER_HELP.comeHomeTiles;
    const goal = tend ?? (near ? { x: d.x, z: d.z } : undefined);
    if (!p.to && goal && (Math.floor(p.x) !== goal.x || Math.floor(p.z) !== goal.z)) this.route(id, p, goal);
    if (p.to) {
      const dx = p.to.x - p.x;
      const dz = p.to.z - p.z;
      const dist = Math.hypot(dx, dz);
      const sp = KEEPER_HELP.walkSpeed * dt;
      if (dist <= Math.max(sp, KEEPER_HELP.arriveTiles)) {
        p.x = p.to.x;
        p.z = p.to.z;
        p.to = p.path.shift();
      } else {
        p.x += (dx / dist) * sp;
        p.z += (dz / dist) * sp;
        p.facing = Math.atan2(dx, dz);
      }
      p.doing = 'walk';
      return;
    }
    if (tend) {
      // there: it works the tile for a little while, then the tile blooms
      p.doing = 'tend';
      const now = this.sim.time;
      if (tend.at === undefined) this.set(id, { ...st, tending: { ...tend, at: now + KEEPER_HELP.tendSeconds } });
      else if (now >= tend.at) this.finishTending(id);
      return;
    }
    if (near) {
      p.facing = Math.atan2(bot!.x - p.x, bot!.z - p.z);
      p.doing = 'home';
      return;
    }
    p.doing = 'still';
    p.wait -= dt;
    if (p.wait <= 0) {
      p.to = this.wanderStep(id, p);
      p.path = [];
      p.wait = 1.5 + (Math.sin(this.sim.time + d.z) * 0.5 + 0.5) * 3;
    }
  }

  /** A wandering Keeper's next step: a cell it can stand on beside it (a slow walk, never off a cliff). */
  private wanderStep(id: string, p: KeeperPose): { x: number; z: number } | undefined {
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    const opts: { x: number; z: number }[] = [];
    for (const [dx, dz] of N4) {
      const x = cx + dx;
      const z = cz + dz;
      if (!keeperCanStand(this.sim, id, x, z) || !canStep(cx, cz, x, z)) continue;
      opts.push({ x: x + 0.5, z: z + 0.5 });
    }
    if (!opts.length) return undefined;
    return opts[Math.floor((Math.sin(this.sim.time * 12.9898 + this.def(id).x * 78.233) * 0.5 + 0.5) * opts.length) % opts.length];
  }

  /** Sets a Keeper walking to a cell along ground it can stand on (straight there if there is no such way). */
  private route(id: string, p: KeeperPose, to: { x: number; z: number }) {
    const from = { x: Math.floor(p.x), z: Math.floor(p.z) };
    const cells = keeperPath(this.sim, id, from, to) ?? [from, to];
    p.path = cells.slice(1).map((c) => ({ x: c.x + 0.5, z: c.z + 0.5 }));
    p.to = p.path.shift();
  }

  /**
   * Picks the tile a Keeper will tend next: the least bloomed restored tile it can walk to (nearest first on a tie).
   * Saved, so a reload carries on where it was. It walks there (tick), and once there it works the tile.
   */
  startTending(id: string): { x: number; z: number } | undefined {
    let best: { x: number; z: number; steps: number; bloom: number } | undefined;
    for (const c of keeperReach(this.sim, id)) {
      const t = this.sim.grid.peek(GROUND, c.x, c.z)!;
      if (t.bloom >= TUNING.restore.maxBloom) continue;
      if (!best || t.bloom < best.bloom) best = { ...c, bloom: t.bloom };
    }
    if (!best) return undefined;
    this.set(id, { ...this.state(id), tending: { x: best.x, z: best.z } });
    this.sim.bus.emit('keeper.tending', { keeperId: id, x: best.x, z: best.z });
    return { x: best.x, z: best.z };
  }

  /** The Keeper has worked its tile, standing on it: one bloom step. */
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

  /** Where a Keeper is off to tend, or tending now (undefined: nowhere). */
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
  giftFor(id: string): GiftId | undefined {
    const st = this.state(id);
    if (!this.sim.state.salvage || st.step !== 'settled' || this.isFriend(id) || !this.story(id)) return undefined;
    if (st.giftedAt !== undefined && this.sim.time - st.giftedAt < FRIENDSHIP.giftEverySeconds) return undefined;
    return this.likes(id).find((m) => this.carrying(m) > 0) as GiftId | undefined;
  }

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
    if (!story || !gift || !this.takeGift(gift)) return this.chat(id);
    this.set(id, { ...st, giftedAt: this.sim.time });
    this.warm(id, gift);
    return 'gave';
  }

  /**
   * E23.5.4.6 → E23.9.2: the farm's hook (FarmExtras) when bloombot grows what a woken Keeper's garden asked for. A grown
   * garden counts as a gift: it raises the Keeper's friendship without using up the day's gift. Before the Keeper has
   * settled it can't become a friend yet (its arc comes first), so the heart waits one short of it.
   */
  tend(id: string): void {
    const st = this.sim.state.salvage?.keepers[id];
    if (!st || st.step === 'asleep' || !this.story(id) || this.isFriend(id)) return;
    if (st.step !== 'settled' && this.hearts(id) >= FRIENDSHIP.giftsToFriend - 1) return;
    this.warm(id, 'garden');
  }

  /** One more heart, from a gift or a grown garden: its gift back the first time, then thanks or the friend beat. */
  private warm(id: string, item: string) {
    const st = this.state(id);
    const story = this.story(id)!;
    const hearts = (st.hearts ?? 0) + 1;
    this.set(id, { ...st, hearts });
    this.sim.bus.emit('keeper.gift', { keeperId: id, item, hearts });
    if (hearts === 1)
      for (const [m, n] of Object.entries(story.giftBack) as [MaterialId, number][]) {
        const left = this.sim.inventory.add(m, n);
        if (left > 0) this.sim.inventory.addToStore(m, left);
      }
    if (hearts < FRIENDSHIP.giftsToFriend) {
      this.say(id, [story.thanks]);
      return;
    }
    // the friend beat, and its region's keepsake
    const ks = KEEPSAKES.find((k) => k.region === this.def(id).region);
    const sv = this.sim.state.salvage!;
    if (ks && !sv.items?.includes(ks.id)) (sv.items ??= []).push(ks.id);
    this.sim.bus.emit('keeper.friend', { keeperId: id });
    this.say(id, this.beat(id, 'friend'));
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
        return `${d.name} asks you to restore ${this.region(id).patch.name.toLowerCase()}: ${p.restored} of ${p.total} tiles.`;
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
  const parts = (Object.entries(cost) as [MaterialId, number][]).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${MATERIALS[k].name}`);
  return parts.length <= 1 ? (parts[0] ?? 'nothing') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
