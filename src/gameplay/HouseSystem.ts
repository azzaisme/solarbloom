import type { LayerData, MaterialId, TileData } from '../core/types';
import { furnitureAt as placed, HOUSE, HOUSE_GROWTH, HOUSE_INSIDE, houseDoorInside, houseFurniture, houseRoomAt, houseRooms, houseWallBetween, houseWalls, type HouseFurniture, type HouseLevel, type HouseRoom, type HouseWall } from '../data/oldcity';
import type { Sim } from './Sim';
import { Walker } from './Walker';

/**
 * #782 (E21 §11): Bloombot's house grows from the ruined shed (level 0) through the Shed, the Cottage and the House to
 * the Home (level 4). Each level is a delivery handed in at the house a bit at a time, like the fountain's steps: part
 * deliveries are saved in `salvage.houseDelivered`, and once all of it is in the house grows (`salvage.house`) and
 * emits `house.level`. It opens at the fountain's first step. A save from before this keeps level 0 and nothing
 * handed in, so it loads exactly as it was.
 */
export class HouseSystem {
  constructor(private sim: Sim) {}

  /** 0 = the ruined shed, 1 Shed … 4 Home. */
  get level(): number {
    return this.sim.state.salvage?.house ?? 0;
  }

  /** The level reached (undefined for the ruined shed). */
  current(): HouseLevel | undefined {
    return HOUSE[this.level - 1];
  }

  /** The next level to grow toward (undefined once it is the Home). */
  next(): HouseLevel | undefined {
    return HOUSE[this.level];
  }

  /** Can the house be mended yet (the fountain's first step reached)? */
  open(): boolean {
    return (this.sim.state.salvage?.tier ?? 0) >= HOUSE_GROWTH.opensAtStep;
  }

  /** Has the house an inside to go into (mended at least once)? */
  hasInside(): boolean {
    return this.level >= 1;
  }

  /** The inside, tiles a side (0 before the house is mended). */
  room(): number {
    return this.current()?.room ?? 0;
  }

  /** How many decorations the inside holds at this level. */
  decorMax(): number {
    return this.current()?.decor ?? 0;
  }

  /** Units of a material handed in toward the next level. */
  given(m: MaterialId): number {
    return this.sim.state.salvage?.houseDelivered?.[m] ?? 0;
  }

  /** Units still wanted toward the next level. */
  remaining(m: MaterialId): number {
    const n = this.next();
    return Math.max(0, ((n?.delivery[m] as number | undefined) ?? 0) - this.given(m));
  }

  /** What the next level wants, as have-handed-in of need, in the data's order. */
  wants(): { id: MaterialId; given: number; need: number }[] {
    const n = this.next();
    if (!n) return [];
    return (Object.entries(n.delivery) as [MaterialId, number][]).map(([id, need]) => ({ id, given: Math.min(need, this.given(id)), need }));
  }

  /** Is everything for the next level in? */
  delivered(): boolean {
    const n = this.next();
    return !!n && this.wants().every((w) => w.given >= w.need);
  }

  /** Why nothing can be handed in now, or undefined. */
  problem(): string | undefined {
    if (!this.next()) return 'The house is a home now: it has grown all it can';
    if (!this.open()) return 'The house can be mended once the fountain flows again';
    if (!this.wants().some((w) => w.given < w.need && this.sim.inventory.available(w.id) > 0)) return 'Bring what the house needs first';
    return undefined;
  }

  /**
   * Hands in up to `n` of a material toward the next level (never more than is still wanted), from the backpack
   * first, then your chests. Returns how many went in. The house grows as soon as the last of it is in.
   */
  deliver(m: MaterialId, n = Infinity): number {
    const s = this.sim;
    const sv = s.state.salvage;
    if (!sv || !this.next() || !this.open()) return 0;
    const k = Math.min(n, this.remaining(m), s.inventory.available(m));
    if (k <= 0) return 0;
    if (!s.inventory.pay({ [m]: k })) return 0;
    const d = (sv.houseDelivered ??= {});
    d[m] = (d[m] ?? 0) + k;
    s.bus.emit('house.delivered', { material: m, n: k });
    this.check();
    return k;
  }

  /** "Give all I have": every material still wanted. Returns the units handed in. */
  giveAll(): number {
    let n = 0;
    for (const w of this.wants()) n += this.deliver(w.id);
    return n;
  }

  /** Grows the house when everything is in. True when it grew. */
  check(): boolean {
    const sv = this.sim.state.salvage;
    if (!sv || !this.open() || !this.delivered()) return false;
    sv.house = this.level + 1;
    delete sv.houseDelivered;
    this.sync();
    this.sim.bus.emit('house.level', { level: sv.house });
    return true;
  }

  // ───────────── the inside ─────────────

  /** The inside's layer id. */
  get layerId(): string {
    return HOUSE_INSIDE.layer;
  }

  /** The inside's layer (undefined before the house is mended). */
  layer(): LayerData | undefined {
    return this.hasInside() ? this.sim.grid.layer(HOUSE_INSIDE.layer) : undefined;
  }

  /** Is this layer the house's inside? */
  isInside(roofId: string | undefined): boolean {
    return roofId === HOUSE_INSIDE.layer;
  }

  /** #875: the furniture now, kept until the level or the layout changes (it is asked for many times a frame) */
  private memo?: { level: number; layout: unknown; version: number; list: HouseFurniture[] };
  private version = 0;

  /**
   * The furniture standing in the room now: each piece where its level puts it, or (#875) where the player moved it
   * (`salvage.houseLayout`).
   */
  furniture(): HouseFurniture[] {
    const lay = this.sim.state.salvage?.houseLayout;
    const m = this.memo;
    if (m && m.level === this.level && m.layout === lay && m.version === this.version) return m.list;
    const list = houseFurniture(this.level).map((f) => {
      const o = lay?.[f.id];
      return o && !f.fixed ? placed(f, o.x, o.z, o.rot) : f;
    });
    this.memo = { level: this.level, layout: lay, version: this.version, list };
    return list;
  }

  /** #875: can this piece be moved (every one but those built into the house: the fireplace)? */
  movable(f: HouseFurniture | undefined): boolean {
    return !!f && !f.fixed;
  }

  /**
   * #875: why a piece can't stand at (`x`, `z`) turned `rot` (its north-west square), or undefined. It stands on free
   * floor inside one room (never across a wall, on another piece or a decoration, or on the door's square), and
   * Bloombot can still walk from the door to every room and every piece, this one too. Its own squares now count as
   * free (it is being moved off them). `keep`: a square that must stay in reach from the door (where Bloombot
   * stands, so it is never shut in).
   */
  placeProblem(id: HouseFurniture['id'], x: number, z: number, rot: number, keep?: { x: number; z: number }): string | undefined {
    const f = this.furniture().find((p) => p.id === id);
    if (!f) return 'That isn’t in the house';
    if (f.fixed) return `${cap(f.name)} is built into the house: it stays where it is`;
    const to = placed(f, x, z, rot);
    const R = this.room();
    const cells: [number, number][] = [];
    for (let cx = to.x; cx < to.x + to.w; cx++) for (let cz = to.z; cz < to.z + to.d; cz++) cells.push([cx, cz]);
    if (cells.some(([cx, cz]) => cx < 0 || cz < 0 || cx >= R || cz >= R)) return 'It doesn’t fit here';
    for (const [ax, az] of cells) for (const [bx, bz] of cells) if (this.wallBetween(ax, az, bx, bz)) return 'A wall is in the way';
    const [dx, dz] = this.doorInside();
    for (const [cx, cz] of cells) {
      if (cx === dx && cz === dz) return 'Keep the door of the house clear';
      const other = this.furnitureAt(cx, cz);
      if (other && other.id !== id) return `${cap(other.name)} stands here`;
      const t = this.sim.grid.peek(this.layerId, cx, cz);
      if (t?.occupantId) return 'A decoration stands here: move it first';
    }
    // every room and every piece still in reach from the door, with it moved
    if (keep && cells.some(([cx, cz]) => cx === Math.floor(keep.x) && cz === Math.floor(keep.z))) return 'Bloombot is standing there';
    const before = this.cutOff();
    const { lost, shut } = this.tryLayout(id, to, () => ({ lost: this.cutOff(), shut: !!keep && !this.reach().has(`${Math.floor(keep.x)},${Math.floor(keep.z)}`) }));
    if (shut) return 'That would shut Bloombot in';
    if (lost && lost.id !== before?.id) return 'rot' in lost ? `That would block the way to ${lost.name}` : `That would block the way into ${lost.name}`;
    return undefined;
  }

  /** #875: moves a piece (see placeProblem). Undefined when it moved, else why not. */
  move(id: HouseFurniture['id'], x: number, z: number, rot: number, keep?: { x: number; z: number }): string | undefined {
    const why = this.placeProblem(id, x, z, rot, keep);
    if (why) return why;
    const sv = this.sim.state.salvage!;
    (sv.houseLayout ??= {})[id] = { x, z, rot: ((rot % 4) + 4) % 4 };
    this.version++;
    this.sync();
    this.sim.bus.emit('house.furnitureMoved', { id });
    return undefined;
  }

  /** #875: runs `look` with a piece standing at `to` for a moment (the grid's squares blocked to match), then puts it back. */
  private tryLayout<T>(id: string, to: HouseFurniture, look: () => T): T {
    const sv = this.sim.state.salvage!;
    const lay = (sv.houseLayout ??= {});
    const had = lay[id];
    lay[id] = { x: to.x, z: to.z, rot: to.rot };
    this.version++;
    this.block();
    try {
      return look();
    } finally {
      if (had) lay[id] = had;
      else delete lay[id];
      if (!Object.keys(lay).length) delete sv.houseLayout;
      this.version++;
      this.block();
    }
  }

  /** #875: blocks the room's squares under the furniture (and frees the rest). Returns the squares furniture is on. */
  private block(): TileData[] {
    const taken: TileData[] = [];
    if (!this.sim.grid.layer(HOUSE_INSIDE.layer)) return taken;
    for (const t of this.sim.grid.tilesOf(HOUSE_INSIDE.layer)) {
      const f = this.furnitureAt(t.x, t.z);
      t.blocked = !!f;
      if (f) taken.push(t);
    }
    return taken;
  }

  /**
   * #875: keeps the moved pieces where the player put them as the house grows or a save loads, as far as each still
   * fits: one that no longer does (a new room's wall across it, a new piece's spot under it, or outside the room)
   * goes back to where its level puts it, or failing that to the nearest square where it does fit, turned as it was.
   * A piece the level no longer has, or one built in, is dropped from the layout. If the moves would leave any room or
   * piece out of reach from the door (decorations aside: they are moved after), the layout goes back to today's.
   */
  private settleLayout() {
    const sv = this.sim.state.salvage;
    const lay = sv?.houseLayout;
    if (!sv || !lay) return;
    const defaults = houseFurniture(this.level);
    const R = this.room();
    const [dx, dz] = this.doorInside();
    const stand: HouseFurniture[] = defaults.filter((f) => f.fixed || !lay[f.id]);
    const fits = (f: HouseFurniture) => {
      for (let cx = f.x; cx < f.x + f.w; cx++)
        for (let cz = f.z; cz < f.z + f.d; cz++) {
          if (cx < 0 || cz < 0 || cx >= R || cz >= R || (cx === dx && cz === dz)) return false;
          if (stand.some((o) => cx >= o.x && cx < o.x + o.w && cz >= o.z && cz < o.z + o.d)) return false;
          if (cx + 1 < f.x + f.w && this.wallBetween(cx, cz, cx + 1, cz)) return false;
          if (cz + 1 < f.z + f.d && this.wallBetween(cx, cz, cx, cz + 1)) return false;
        }
      return true;
    };
    let changed = false;
    for (const id of Object.keys(lay)) {
      const f = defaults.find((p) => p.id === id);
      const o = lay[id];
      if (!f || f.fixed) {
        delete lay[id];
        changed = true;
        continue;
      }
      let at = placed(f, o.x, o.z, o.rot);
      if (!fits(at)) {
        changed = true;
        const near: HouseFurniture[] = [f];
        const sq: [number, number][] = [];
        for (let x = 0; x < R; x++) for (let z = 0; z < R; z++) sq.push([x, z]);
        sq.sort((a, b) => Math.hypot(a[0] - o.x, a[1] - o.z) - Math.hypot(b[0] - o.x, b[1] - o.z));
        for (const [x, z] of sq) near.push(placed(f, x, z, o.rot));
        at = near.find(fits) ?? f;
        if (at === f) delete lay[id];
        else lay[id] = { x: at.x, z: at.z, rot: at.rot };
      }
      stand.push(at);
    }
    if (!Object.keys(lay).length) delete sv.houseLayout;
    if (changed) this.version++;
    if (!sv.houseLayout) return;
    // never at the cost of a room or a piece out of reach (decorations aside: Cozy moves them out of the way after)
    this.block();
    const deco = new Set<string>();
    for (const t of this.sim.grid.tilesOf(HOUSE_INSIDE.layer)) if (t.occupantId) deco.add(`${t.x},${t.z}`);
    if (this.cutOff(undefined, deco)) {
      delete sv.houseLayout;
      this.version++;
    }
  }

  /** The piece of furniture on a cell of the room, if any. */
  furnitureAt(x: number, z: number): HouseFurniture | undefined {
    return this.furniture().find((f) => x >= f.x && x < f.x + f.w && z >= f.z && z < f.z + f.d);
  }

  /** #860: the rooms now, the main room first. */
  rooms(): HouseRoom[] {
    return houseRooms(this.level);
  }

  /** #860: the inner walls now. */
  walls(): HouseWall[] {
    return houseWalls(this.level);
  }

  /** #860: the room a cell is in. */
  roomAt(x: number, z: number): HouseRoom | undefined {
    return houseRoomAt(this.level, x, z);
  }

  /** #860: is an inner wall between two cells side by side (not at its doorway)? */
  wallBetween(ax: number, az: number, bx: number, bz: number): boolean {
    return houseWallBetween(this.level, ax, az, bx, bz);
  }

  /**
   * #860: can Bloombot get from a cell to a touching one without going through a wall? Side by side: no wall between
   * them. Diagonally: round one of the two corners, both of its steps open.
   */
  connected(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    if (!dx && !dz) return true;
    if (Math.abs(dx) > 1 || Math.abs(dz) > 1) return false;
    if (!dx || !dz) return !this.wallBetween(ax, az, bx, bz);
    const open = (px: number, pz: number, qx: number, qz: number) => !this.wallBetween(px, pz, qx, qz);
    return (open(ax, az, bx, az) && open(bx, az, bx, bz)) || (open(ax, az, ax, bz) && open(ax, bz, bx, bz));
  }

  /**
   * #860: every cell Bloombot can walk to from the door inside, keyed `x,z` (steps side by side, never through a
   * wall), over the cells it may stand in (the Walker's rules); `also` blocks more (a decoration about to be placed),
   * and `clear` counts squares as free floor whatever stands on them (but furniture): a decoration that might move.
   */
  reach(also?: Set<string>, clear?: Set<string>): Set<string> {
    const out = new Set<string>();
    if (!this.hasInside()) return out;
    const room = this.room();
    const w = new Walker(this.sim);
    const id = this.layerId;
    const ok = (x: number, z: number) => x >= 0 && z >= 0 && x < room && z < room && !also?.has(`${x},${z}`) && (clear?.has(`${x},${z}`) ? !this.sim.grid.get(id, x, z)?.blocked : w.walkable(id, x, z));
    const [dx, dz] = this.doorInside();
    if (!ok(dx, dz)) return out;
    const todo: [number, number][] = [[dx, dz]];
    out.add(`${dx},${dz}`);
    while (todo.length) {
      const [x, z] = todo.pop()!;
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + sx;
        const nz = z + sz;
        const k = `${nx},${nz}`;
        if (out.has(k) || !ok(nx, nz) || this.wallBetween(x, z, nx, nz)) continue;
        out.add(k);
        todo.push([nx, nz]);
      }
    }
    return out;
  }

  /**
   * #860: what Bloombot couldn't get to from the door if `also` were blocked too: a piece of furniture with no square
   * beside it to stand on (not through a wall), or a room with no square to walk into. Undefined when all is in reach.
   */
  cutOff(also?: Set<string>, clear?: Set<string>): HouseFurniture | HouseRoom | undefined {
    if (!this.hasInside()) return undefined;
    const r = this.reach(also, clear);
    for (const f of this.furniture()) {
      let near = false;
      for (let x = f.x; x < f.x + f.w && !near; x++)
        for (let z = f.z; z < f.z + f.d && !near; z++)
          for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
            if (r.has(`${x + sx},${z + sz}`) && !this.wallBetween(x, z, x + sx, z + sz)) {
              near = true;
              break;
            }
      if (!near) return f;
    }
    for (const room of this.rooms()) {
      let any = false;
      for (const k of r) {
        const [x, z] = k.split(',').map(Number);
        if (this.roomAt(x, z)?.id === room.id) {
          any = true;
          break;
        }
      }
      if (!any) return room;
    }
    return undefined;
  }

  /** The door cell inside (where Bloombot comes in and goes out). */
  doorInside(): [number, number] {
    return houseDoorInside(this.level);
  }

  /**
   * Makes the inside match the level: its layer (added to the save the first time, grown with each level) and its
   * cells, furniture blocking its own. Returns the cells furniture now stands on (a decoration there is moved by the
   * game, Cozy.clearCells). Idempotent; nothing at all for the ruined shed, so an older save is left as it was.
   */
  sync(): TileData[] {
    if (!this.hasInside()) return [];
    const room = this.room();
    const st = this.sim.state;
    let l = st.layers.find((x) => x.id === HOUSE_INSIDE.layer);
    if (!l) {
      l = { id: HOUSE_INSIDE.layer, name: 'The house', kind: 'raised', width: room, depth: room, height: HOUSE_INSIDE.height, origin: [...HOUSE_INSIDE.origin], unlocked: true, preview: false, interior: true };
      st.layers.push(l);
    }
    if (l.width !== room) this.sim.grid.resized(l.id);
    l.width = l.depth = room;
    this.sim.grid.addLayer(l);
    this.settleLayout(); // #875: the moved pieces, as far as each still fits at this level
    return this.block();
  }
}

/** "the bed" to "The bed" */
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
