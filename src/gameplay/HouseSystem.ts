import type { LayerData, MaterialId, TileData } from '../core/types';
import { HOUSE, HOUSE_GROWTH, HOUSE_INSIDE, houseDoorInside, houseFurniture, houseRoomAt, houseRooms, houseWallBetween, houseWalls, type HouseFurniture, type HouseLevel, type HouseRoom, type HouseWall } from '../data/oldcity';
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

  /** The furniture standing in the room now. */
  furniture(): HouseFurniture[] {
    return houseFurniture(this.level);
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
  cutOff(also?: Set<string>): HouseFurniture | HouseRoom | undefined {
    if (!this.hasInside()) return undefined;
    const r = this.reach(also);
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
    const taken: TileData[] = [];
    for (const t of this.sim.grid.tilesOf(l.id)) {
      const f = this.furnitureAt(t.x, t.z);
      t.blocked = !!f;
      if (f) taken.push(t);
    }
    return taken;
  }
}
