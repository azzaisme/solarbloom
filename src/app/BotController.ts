import type { CameraController } from '../rendering/CameraController';
import type { BloombotVisuals } from '../rendering/BloombotVisuals';
import { SLAB_TOP } from '../core/Picking';
import type { Sim } from '../gameplay/Sim';
import { BOT, type BotPose, spawnPose, Walker } from '../gameplay/Walker';
import { heightAt, levelY } from '../core/Height';
import { TurnBack } from '../gameplay/TurnBack';
import { MAINLAND_CLOSED } from '../data/mainland';
import { GROUND } from '../core/GameState';
import type { Action, Bindings } from './Bindings';
import { RESEARCH } from '../data/research';
import { CHARGE } from '../data/charge';
import { TURN } from '../data/botMotion';
import { Stride, Turner } from '../gameplay/Turner';
import { REST, seatFeet } from '../data/rest';

/**
 * Bloombot (#234): input, movement and the camera follow (G.2, G.3, G.11, G.12). The game owns what an action
 * does; this owns where bloombot is and when it gets there. Docs: docs/BLOOMBOT_EPIC.md.
 *
 * Moving: WASD / arrows or the left stick, relative to where the camera is looking; once the Hover upgrade is
 * bought, Shift or the right trigger hovers (bloombot's sprint: faster, a little off the ground). The game can
 * still set a walk target (`goTo`: a wake button, the map's travel): bloombot paths there and runs `arrive`.
 * The camera follows bloombot unless something else moved it (a drag, a fly-to, Home, the overview's travel);
 * it picks bloombot up again as soon as bloombot moves.
 */
const DEAD = 0.18;
/** Right stick fully over turns the view this many degrees a second. */
const TURN_SPEED = 150;
const MOVES: readonly [Action, number, number][] = [
  ['up', 0, 1],
  ['down', 0, -1],
  ['left', -1, 0],
  ['right', 1, 0],
];

interface Walk {
  path: { x: number; z: number }[];
  /** the cell bloombot should face on arrival */
  face?: { x: number; z: number };
  /** #670: arrived, turning to face it: how long so far (it acts once it faces it, or after TURN.faceFirst.wait) */
  facingFor?: number;
  arrive?: () => void;
  stuckFor: number;
}

/** Where bloombot sits (its feet; E23.2.3), facing out along `facing`; `step`: see BotController.seat. */
export interface Seat {
  x: number;
  y: number;
  z: number;
  facing: number;
  step?: number;
}

export class BotController {
  readonly walker: Walker;
  readonly pose: BotPose;
  /** #670: the one thing that turns bloombot (every facing goes through it: no snaps) */
  readonly turner: Turner;
  /** #670: its speed, eased up and down, and the stop to pivot before a big change of direction */
  readonly stride = new Stride();
  /** the way it last moved (braking carries on along it) */
  private lastDir = { x: 0, z: 1 };
  /** #671: its speed last frame (how fast it speeds up or brakes), the ground's height then, how long it has stood */
  private lastPace = 0;
  private lastGround?: number;
  private stillFor = 0;
  private held = new Set<string>();
  private padPrev: boolean[] = [];
  private walk?: Walk;
  /** G.13: riding a rooftop lift: rising (or sinking) in place, then stepping off on the other layer */
  private lift?: { roofId: string; x: number; z: number; fromY: number; toY: number; t: number; dur: number };
  /** E25 (#626): a hover, climb or glide across to another cell (MoveSpots), over water or up a wall */
  private trip?: { fx: number; fz: number; fy: number; tx: number; tz: number; ty: number; t: number; dur: number; arc: number; style: 'hover' | 'climb' | 'glide'; done?: () => void };
  /** world speed this frame */
  speed = 0;
  sprinting = false;
  /** the camera goal this controller set last frame; anything else moving it pauses the follow */
  private tracked?: { x: number; z: number };
  following = true;
  /** last input device used, for button prompts (G.7) */
  lastInput: 'keys' | 'pad' = 'keys';
  /** gamepad right stick zoom, per second */
  onZoom?: (factor: number) => void;
  /** gamepad right stick turn, in degrees for this frame */
  onTurn?: (degrees: number) => void;
  /**
   * Build mode: the right stick as it is (x right, y up, each -1…1, dead zone taken off) for this frame. True when
   * the game used it (it moves the build cursor); the stick then neither turns nor zooms the view.
   */
  onAim?: (x: number, y: number, dt: number) => boolean;
  /** a gamepad button was pressed (the game resolves it to an action for the context in effect) */
  onPad?: (button: number) => void;
  /** Island release: bloombot headed into the closed causeway and turns back; the game shows the card (once per approach). */
  onMainlandClosed?: () => void;
  /** A key press something on screen takes instead of walking (the load wheel's arrows), checked on a fresh press. */
  claims?: (code: string) => boolean;
  /** Island release: the turn back at the closed causeway (gameplay/TurnBack). */
  readonly turnBack = new TurnBack();
  /** E22.1: sprint switched on by the toggle (left stick click); it ends when bloombot stops */
  sprintLatched = false;
  /** a menu that wants pad buttons first (G.7 focus navigation); true when it used the press */
  padCapture?: (button: number) => boolean;
  /** any gamepad button press, by index (the rebinding screen listens here) */
  onButton?: (button: number) => void;
  /**
   * E23.2.3: sitting (a bench, a charger): drawn here instead of at its pose, and input doesn't move it. `step`: on a
   * bench, how far in front of the seat it stands before it sits back onto it (REST.onto; set by sitOn).
   */
  seat?: Seat;
  /** getting onto a seat: the feet as drawn, stepping up to just in front of it; `down` sits once there */
  private seatWalk?: { x: number; z: number; down: () => void };
  /** standing up off a seat: drawn coming forward off it as the stand-up clip rises */
  private rising?: Seat;
  /** after getting up (or stopping on the way to a seat): how far from its pose it is drawn, walked back to nothing */
  private drawnOff?: { x: number; z: number };
  /**
   * Sits on `seat`. With a `step` (a bench) it first steps from where it stands to `step` in front of the seat,
   * facing it, then `down()` starts the sitting pose, whose clip turns it round and lowers it back onto the seat
   * (BloombotVisuals.seatShare). Without one (a charger) it is there at once.
   */
  sitOn(seat: Seat, down: () => void) {
    this.walk = undefined;
    const from = this.drawnAt();
    this.rising = undefined;
    this.drawnOff = undefined;
    this.seat = seat;
    const to = seatFeet(seat, seat.step ?? 0, 0);
    if (!seat.step || Math.hypot(to.x - from.x, to.z - from.z) < 0.02) down();
    else this.seatWalk = { x: from.x, z: from.z, down };
  }

  /**
   * Stands up from the seat: off a bench it comes forward off the seat and down to the ground as the stand-up clip
   * rises, then walks back to its pose; stopped on the way to the seat, it just walks back.
   */
  leaveSeat() {
    const st = this.seat;
    const walking = this.seatWalk;
    this.seat = undefined;
    this.seatWalk = undefined;
    if (walking) this.walkBackFrom(walking.x, walking.z);
    else if (st?.step) this.rising = st;
  }

  /** Bloombot's feet as drawn now (on the ground: its pose unless it is getting onto or off a seat). */
  private drawnAt(): { x: number; z: number } {
    const p = this.pose;
    if (this.seatWalk) return { x: this.seatWalk.x, z: this.seatWalk.z };
    if (this.rising) return seatFeet(this.rising, this.rising.step ?? 0, this.visuals.seatShare);
    return { x: p.x + (this.drawnOff?.x ?? 0), z: p.z + (this.drawnOff?.z ?? 0) };
  }

  private walkBackFrom(x: number, z: number) {
    const off = { x: x - this.pose.x, z: z - this.pose.z };
    this.drawnOff = Math.hypot(off.x, off.z) > 0.01 ? off : undefined;
  }

  /** E23.2.3: moving while seated stands bloombot up */
  onSeatMove?: () => void;
  /** true while input must not move bloombot (cinematics, open modal, paused) */
  frozen = () => false;

  constructor(
    private sim: Sim,
    private camera: CameraController,
    readonly visuals: BloombotVisuals,
    private bindings: Bindings,
  ) {
    this.walker = new Walker(sim);
    const saved = sim.state.bot;
    this.pose = saved && sim.grid.layer(saved.roofId) ? { ...saved } : spawnPose(sim, this.walker);
    if (!this.walker.settle(this.pose)) Object.assign(this.pose, spawnPose(sim, this.walker));
    this.turner = new Turner(this.pose);
    this.save();
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat && this.claims?.(e.code)) return; // the press belongs to something on screen (the load wheel)
      const a = this.bindings.actionForCode(e.code, ['world']);
      if (a === 'up' || a === 'down' || a === 'left' || a === 'right' || a === 'sprint') {
        this.held.add(e.code);
        this.lastInput = 'keys';
        if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  /** Bloombot's world position (feet). */
  world(): [number, number, number] {
    const l = this.sim.grid.layer(this.pose.roofId)!;
    const sink = this.walker.wading(this.pose) ? 0.07 : 0;
    // E21.24: on the Old City's terraces bloombot stands at the ground's height (sloping on ramps)
    const lift = this.sim.grid.terraced(this.pose.roofId) ? levelY(heightAt(this.pose.x, this.pose.z)) : 0;
    let y = l.origin[1] + l.height + SLAB_TOP - sink + lift;
    if (this.trip) {
      const tr = this.trip;
      const k = Math.min(1, tr.t / tr.dur);
      // a climb rises first and then steps over; a hover or glide moves along a shallow arch
      const ky = tr.style === 'climb' ? Math.min(1, k / 0.6) : k;
      y = tr.fy + (tr.ty - tr.fy) * (ky * ky * (3 - 2 * ky)) + tr.arc * Math.sin(Math.PI * k);
    }
    if (this.lift) {
      const k = Math.min(1, this.lift.t / this.lift.dur);
      y = this.lift.fromY + (this.lift.toY - this.lift.fromY) * (k * k * (3 - 2 * k));
    }
    return [l.origin[0] + this.pose.x, y, l.origin[2] + this.pose.z];
  }

  /** The standing height of a layer (world y of its surface). */
  private surface(roofId: string): number {
    const l = this.sim.grid.layer(roofId)!;
    return l.origin[1] + l.height + SLAB_TOP;
  }

  /**
   * G.13: ride a lift to another layer: rise or sink in place for about a second, then step off at (x, z), in
   * that layer's cells (moved to the nearest free cell if it's taken).
   */
  ride(roofId: string, x: number, z: number) {
    if (this.lift || !this.sim.grid.layer(roofId)) return;
    this.walk = undefined;
    const fromY = this.world()[1];
    const toY = this.surface(roofId);
    this.lift = { roofId, x, z, fromY, toY, t: 0, dur: this.visuals.reducedMotion ? 0.4 : Math.min(2.2, 0.8 + Math.abs(toY - fromY) * 0.18) };
    this.following = true;
  }

  /** #671: some play input (a button, the camera): no idle moment now, and the wait for one starts again. */
  wake() {
    this.stillFor = 0;
  }

  /** #671: nothing moving it this frame (a trip, a lift, a seat): the movement drawn calms down. */
  private moveQuiet() {
    this.lastPace = 0;
    this.lastGround = undefined;
    this.stillFor = 0;
    this.visuals.setMove({ pace: 0, accel: 0, walk: BOT.walk, run: BOT.sprint, climb: 0, wading: false, still: 0 });
  }

  get riding(): boolean {
    return !!this.lift || !!this.trip;
  }

  /**
   * E25 (#626): a level II move's trip to the cell (x, z) on the ground: across the water, up or down a wall, over
   * a gap. Bloombot travels there over `dur` seconds (rising `arc` tiles over the line between), then stands on
   * the cell; `done` runs when it lands.
   */
  travel(x: number, z: number, style: 'hover' | 'climb' | 'glide', dur: number, arc: number, done?: () => void) {
    if (this.lift || this.trip) return;
    this.walk = undefined;
    const p = this.pose;
    const fy = this.world()[1];
    const l = this.sim.grid.layer(p.roofId)!;
    const ty = l.origin[1] + l.height + SLAB_TOP + (this.sim.grid.terraced(p.roofId) ? levelY(heightAt(x + 0.5, z + 0.5)) : 0);
    this.turner.faceTo(p.x, p.z, x + 0.5, z + 0.5);
    this.stride.stop();
    this.trip = { fx: p.x, fz: p.z, fy, tx: x + 0.5, tz: z + 0.5, ty, t: 0, dur: this.visuals.reducedMotion ? Math.min(dur, 0.5) : dur, arc, style, done };
    this.following = true;
  }

  /** The cell in front, which every tool acts on. */
  front() {
    return this.walker.front(this.pose);
  }

  /** #670: turn to face an angle (radians, 0 = +z), smoothly. Nothing sets the pose's facing directly. */
  turnTo(angle: number) {
    this.turner.face(angle);
  }

  /** #670: turn to face the point (x, z) on bloombot's layer, smoothly. */
  faceToward(x: number, z: number) {
    this.turner.faceTo(this.pose.x, this.pose.z, x, z);
  }

  /** Writes the pose into the state (saved with the game; the sim never reads it). */
  save() {
    this.sim.state.bot = { roofId: this.pose.roofId, x: +this.pose.x.toFixed(3), z: +this.pose.z.toFixed(3), facing: +this.pose.facing.toFixed(3) };
  }

  /**
   * Walk to act on a footprint (`size` x `size` cells from cx, cz): to a walkable cell touching it (or onto it
   * when `onto`), then face its middle and run `arrive`. Already beside it: just turn and act. False when there
   * is no way there.
   */
  goTo(roofId: string, cx: number, cz: number, size = 1, arrive?: () => void, onto = false): boolean {
    if (roofId !== this.pose.roofId) return false; // other layers: the rooftop lift (G.13)
    const inside = (x: number, z: number) => x >= cx && x < cx + size && z >= cz && z < cz + size;
    const touching = (x: number, z: number) => !inside(x, z) && x >= cx - 1 && x <= cx + size && z >= cz - 1 && z <= cz + size;
    const goal = onto ? inside : touching;
    const path = this.walker.path(roofId, this.pose.x, this.pose.z, goal, { x: cx + (size - 1) / 2, z: cz + (size - 1) / 2 });
    if (!path) return false;
    this.walk = { path, face: onto ? undefined : { x: cx + size / 2 - 0.5, z: cz + size / 2 - 0.5 }, arrive, stuckFor: 0 };
    this.following = true;
    return true;
  }

  /**
   * Walk to the cell (cx, cz), then face the cell `face` and run `arrive` (getting to the front of a bench to sit on
   * it). False when there is no way there.
   */
  goToCell(roofId: string, cx: number, cz: number, face: { x: number; z: number }, arrive: () => void): boolean {
    if (roofId !== this.pose.roofId) return false;
    const path = this.walker.path(roofId, this.pose.x, this.pose.z, (x, z) => x === cx && z === cz, { x: cx, z: cz });
    if (!path) return false;
    this.walk = { path, face, arrive, stuckFor: 0 };
    this.following = true;
    return true;
  }

  get walking(): boolean {
    return !!this.walk;
  }

  cancelWalk() {
    this.walk = undefined;
  }

  private readPad(): { x: number; y: number; sprint: boolean; zoom: number; turn: number; rx: number; ry: number } | undefined {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) return undefined;
    const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
    const x = dz(gp.axes[0] ?? 0);
    const y = -dz(gp.axes[1] ?? 0);
    // Right stick: sideways turns the view, up and down zooms. Only the stronger axis counts, so a turn
    // doesn't also creep the zoom.
    const rx = dz(gp.axes[2] ?? 0);
    const ry = -dz(gp.axes[3] ?? 0);
    const zoom = Math.abs(ry) >= Math.abs(rx) ? ry : 0;
    const turn = Math.abs(rx) > Math.abs(ry) ? rx : 0;
    gp.buttons.forEach((b, i) => {
      const down = b.pressed;
      if (down && !this.padPrev[i]) {
        this.lastInput = 'pad';
        this.onButton?.(i);
        if (!this.padCapture?.(i)) this.onPad?.(i);
      }
      this.padPrev[i] = down;
    });
    if (x || y || rx || ry) this.lastInput = 'pad'; // either stick means the pad is in hand
    const sb = this.bindings.pad.sprint;
    return { x, y, sprint: sb !== undefined && (gp.buttons[sb]?.value ?? 0) > 0.4, zoom, turn, rx, ry };
  }

  update(dt: number) {
    const pad = this.readPad();
    const aimed = !!pad && !!this.onAim?.(pad.rx, pad.ry, dt); // build mode: the right stick is the build cursor
    if (pad?.zoom && !aimed) this.onZoom?.(Math.pow(1.8, pad.zoom * dt));
    if (pad?.turn && !aimed) this.onTurn?.(-pad.turn * TURN_SPEED * dt);
    let ix = 0;
    let iy = 0;
    for (const [a, mx, my] of MOVES)
      if (this.bindings.isDown(a, this.held)) {
        ix += mx;
        iy += my;
      }
    if (pad) {
      ix += pad.x;
      iy += pad.y;
    }
    const mag = Math.min(1, Math.hypot(ix, iy));
    if (this.trip) {
      const tr = this.trip;
      tr.t += dt;
      const k = Math.min(1, tr.t / tr.dur);
      // a climb goes up before it goes over; the others move evenly
      const kx = tr.style === 'climb' ? Math.max(0, (k - 0.4) / 0.6) : k * k * (3 - 2 * k);
      const p = this.pose;
      const was = [p.x, p.z];
      p.x = tr.fx + (tr.tx - tr.fx) * kx;
      p.z = tr.fz + (tr.tz - tr.fz) * kx;
      this.turner.update(dt);
      const [x, y, z] = this.world();
      this.moveQuiet();
      this.visuals.place(x, y, z, p.facing);
      // hovering and gliding show the hover pose; a climb stands still while it pulls itself up
      this.visuals.setMotion(tr.style === 'climb' ? 0 : Math.hypot(p.x - was[0], p.z - was[1]) / Math.max(dt, 1e-3), tr.style !== 'climb');
      this.visuals.update(dt);
      this.follow(x, y, z);
      if (k >= 1) {
        this.trip = undefined;
        this.teleport(p.roofId, tr.tx, tr.tz);
        this.visuals.land(1); // #671: a crouch and a little hop as it lands
        tr.done?.();
      }
      return;
    }
    if (this.lift) {
      this.lift.t += dt;
      if (this.lift.t >= this.lift.dur) {
        const l = this.lift;
        this.lift = undefined;
        this.teleport(l.roofId, l.x, l.z);
        this.visuals.land(0.4); // #671: stepping off a lift, a smaller settle
      } else {
        this.turner.update(dt);
        const [x, y, z] = this.world();
        this.moveQuiet();
        this.visuals.place(x, y, z, this.pose.facing);
        this.visuals.setMotion(0, false);
        this.visuals.update(dt);
        this.follow(x, y, z);
        return;
      }
    }
    if (this.seat && mag > 0.3 && !this.frozen()) this.onSeatMove?.();
    const st = this.seat ?? this.rising;
    if (st) {
      this.walk = undefined;
      this.speed = 0;
      this.sprinting = false;
      this.stride.stop();
      this.moveQuiet();
      let at: { x: number; z: number };
      let pace = 0;
      const w = this.seatWalk;
      if (w) {
        // stepping up to just in front of the seat, facing it
        const to = seatFeet(st, st.step ?? 0, 0);
        const dx = to.x - w.x;
        const dz = to.z - w.z;
        const d = Math.hypot(dx, dz);
        const step = Math.min(d, REST.onto.walk * dt);
        if (d > 0.1) this.turner.faceTo(w.x, w.z, to.x, to.z);
        if (step > 0) {
          w.x += (dx / d) * step;
          w.z += (dz / d) * step;
          pace = dt > 0 ? step / dt : 0;
        }
        at = { x: w.x, z: w.z };
        if (d - step < 0.005) {
          this.seatWalk = undefined;
          w.down();
        }
      } else {
        // #670: it turns round onto the seat rather than snapping to face out; it comes back onto the seat (and
        // forward off it) only with the clip's hips (seatShare)
        this.turner.face(st.facing);
        const share = this.visuals.seatShare;
        at = seatFeet(st, st.step ?? 0, share);
        if (this.rising && share <= 0) {
          // up: it walks back to where it stood
          this.rising = undefined;
          this.walkBackFrom(at.x, at.z);
        }
      }
      this.turner.update(dt);
      this.visuals.setTurn(this.turner.left, this.turner.vel, pace);
      this.visuals.place(at.x, st.y, at.z, this.pose.facing);
      this.visuals.setMotion(pace, false);
      this.visuals.update(dt);
      this.follow(at.x, st.y, at.z);
      return;
    }
    const frozen = this.frozen();
    if (mag < 0.01 && !this.walk) this.sprintLatched = false; // a toggled sprint ends when bloombot stops
    // Sprinting is the Hover upgrade: until it is bought the sprint inputs do nothing.
    const canHover = (this.sim.state.upgrades.hover ?? 0) > 0 || !!this.sim.state.salvage?.abilities.includes('hover'); // E23.1.5: the fountain's tier-2 ability
    // E23.2.1: sprinting costs charge; at zero, a low-power walk (slower, never stranded)
    const flat = this.sim.charge.empty;
    this.sprinting = !frozen && canHover && !flat && (this.bindings.isDown('sprint', this.held) || !!pad?.sprint || this.sprintLatched);
    const p = this.pose;
    const w = this.walker;
    const wade = w.wading(p) ? BOT.wade : 1;
    // E23.6.2: "Longer stride" research makes sprinting a little faster
    const stride = 1 + RESEARCH.sprintSpeedPerLevel * (this.sim.research?.level('sprint') ?? 0);
    const top = (this.sprinting ? BOT.sprint * stride : BOT.walk * (flat ? CHARGE.lowPowerWalk : 1)) * wade;
    let dirX = 0;
    let dirZ = 0;
    let want = 0;
    // island release: turning back from the closed causeway wins over steering for its short moment
    const back = !frozen && p.roofId === GROUND ? this.turnBack.tick(dt) : undefined;
    if (back) {
      this.walk = undefined;
      dirX = back.x;
      dirZ = back.z;
      want = BOT.walk * MAINLAND_CLOSED.turnSpeed;
    } else if (!frozen && mag > 0.01) {
      this.walk = undefined; // steering takes over from a click-walk
      // Camera-relative: up on the stick/W goes away from the camera.
      const yr = (this.camera.yaw * Math.PI) / 180;
      const fx = -Math.sin(yr);
      const fz = -Math.cos(yr);
      const rx = Math.cos(yr);
      const rz = -Math.sin(yr);
      const l = Math.hypot(ix, iy);
      dirX = (rx * ix + fx * iy) / l;
      dirZ = (rz * ix + fz * iy) / l;
      want = top * mag;
    } else if (!frozen && this.walk) {
      const next = this.walk.path[0];
      if (!next) {
        // #670: arrived: turn to face what it came for, then act (it doesn't act with its back to it)
        const done = this.walk;
        this.stride.stop();
        if (done.face && done.facingFor === undefined) {
          this.turner.faceTo(p.x, p.z, done.face.x + 0.5, done.face.z + 0.5);
          done.facingFor = 0;
        }
        if (done.facingFor !== undefined) done.facingFor += dt;
        if (!done.face || Math.abs(this.turner.left) <= TURN.faceFirst.within || (done.facingFor ?? 0) >= TURN.faceFirst.wait) {
          this.walk = undefined;
          done.arrive?.();
        }
      } else {
        const dx = next.x - p.x;
        const dz = next.z - p.z;
        const d = Math.hypot(dx, dz);
        // the last point is reached closely (it stops there); points on the way are passed through
        if (d < (this.walk.path.length === 1 ? 0.03 : 0.12)) this.walk.path.shift();
        else {
          dirX = dx / d;
          dirZ = dz / d;
          // slowing in time to stop at the end of the path
          let rest = d;
          for (let i = 1; i < this.walk.path.length; i++) rest += Math.hypot(this.walk.path[i].x - this.walk.path[i - 1].x, this.walk.path[i].z - this.walk.path[i - 1].z);
          want = Math.min(top, Math.sqrt(2 * TURN.brake * rest));
        }
      }
    }
    let moved = 0;
    // #670: it wants to face the way it wants to go
    const t = this.turner;
    if (want > 0) t.face(Math.atan2(dirX, dirZ));
    t.update(dt);
    // how far it faces off the way it wants to go: a big change stops it to pivot first
    const off = want > 0 ? t.left : 0;
    const pace = this.stride.step(dt, want, off);
    if (pace > 0) {
      let mx = this.lastDir.x;
      let mz = this.lastDir.z;
      let dist = pace * dt;
      if (this.stride.pivoting) {
        // braking to pivot: it carries on along the way it was going, never sliding toward the new way
      } else if (want > 0 && this.walk) {
        // along a path: straight at the next point, never past it
        mx = dirX;
        mz = dirZ;
        const next = this.walk.path[0];
        if (next) dist = Math.min(dist, Math.hypot(next.x - p.x, next.z - p.z));
      } else if (want > 0) {
        // steering: it turns into the new way, moving at most TURN.slide off the way it faces (no crabbing sideways)
        const h = p.facing + Math.max(-TURN.slide, Math.min(TURN.slide, off));
        mx = Math.sin(h);
        mz = Math.cos(h);
      }
      moved = w.move(p, mx * dist, mz * dist);
      this.lastDir = { x: mx, z: mz };
      if (this.walk) {
        // stuck: moving slowly although it isn't pivoting or slowing on purpose
        this.walk.stuckFor = !this.stride.pivoting && pace > 0.5 && moved < pace * dt * 0.1 ? this.walk.stuckFor + dt : 0;
        if (this.walk.stuckFor > 0.6) this.walk = undefined; // something moved into the way
      }
      if (moved > 0.001) this.following = true;
      if (moved < dist * 0.1 && want <= 0) this.stride.stop(); // braking into a wall: stopped
      // #671: steering head-on into a wall: a small recoil (once while it holds into it), then it stands there facing
      // the wall rather than running in place
      if (want > 0 && !this.walk && !this.stride.pivoting && moved < dist * 0.15) {
        if (pace > 0.8) this.visuals.bump();
        this.stride.stop();
      }
    }
    if (want > 0 && !back && p.roofId === GROUND && this.turnBack.bump(p.x, p.z, dirX, dirZ)) this.onMainlandClosed?.(); // island release: heading into the closed causeway turns bloombot back
    this.speed = dt > 0 ? moved / dt : 0;
    if (this.sprinting && moved > 0.001) {
      // E23.6.7: sprinting along a footpath or road bloombot laid costs less (gameplay/LaidPaths)
      const k = this.sim.paths.onPath(this.pose.x, this.pose.z) ? CHARGE.pathSprintShare : 1;
      this.sim.charge.use('sprint', dt * k);
    }
    // A machine built or a plot turned solid under bloombot: step aside.
    if (!w.fits(p.roofId, p.x, p.z)) w.settle(p);
    const [x, y, z] = this.world();
    // #671: how it moves, for the movement drawn: speeding up or braking, the slope under it, wading, standing idle
    const wading = w.wading(p);
    const ground = y + (wading ? 0.07 : 0);
    const climb = this.lastGround !== undefined && moved > 0.002 ? (ground - this.lastGround) / moved : 0;
    this.lastGround = ground;
    const accel = dt > 0 ? (this.stride.pace - this.lastPace) / dt : 0;
    this.lastPace = this.stride.pace;
    this.stillFor = mag > 0.01 || this.walk || this.speed > 0.05 || back ? 0 : this.stillFor + dt;
    // after getting up off a seat: it walks back to its pose from where it stood up (input moves it as usual)
    let shown = this.speed;
    const drawn = this.drawnOff;
    if (drawn) {
      const d = Math.hypot(drawn.x, drawn.z);
      const step = Math.min(d, REST.onto.walk * dt);
      const idle = mag < 0.01 && !this.walk;
      if (idle && d > 0.1) t.faceTo(p.x + drawn.x, p.z + drawn.z, p.x, p.z);
      drawn.x -= (drawn.x / d) * step;
      drawn.z -= (drawn.z / d) * step;
      if (idle) shown = dt > 0 ? step / dt : 0;
      if (d - step < 0.005) this.drawnOff = undefined;
    }
    const ox = this.drawnOff?.x ?? 0;
    const oz = this.drawnOff?.z ?? 0;
    this.visuals.setMove({ pace: shown, accel, walk: BOT.walk * wade, run: BOT.sprint * stride * wade, climb, wading, still: this.stillFor });
    this.visuals.setTurn(t.left, t.vel, shown);
    this.visuals.place(x + ox, y, z + oz, p.facing);
    this.visuals.setTired(flat);
    // #671: running blends the run clip in by speed (the visuals), so the loop here is just the walk
    this.visuals.setMotion(shown, false);
    this.visuals.update(dt);
    this.follow(x + ox, y, z + oz);
  }

  private follow(x: number, y: number, z: number) {
    const g = this.camera.goalPoint;
    if (this.tracked && (Math.abs(g.x - this.tracked.x) > 0.02 || Math.abs(g.z - this.tracked.z) > 0.02)) this.following = false;
    if (this.following) {
      this.camera.track(x, y - SLAB_TOP, z);
      this.tracked = { x: this.camera.goalPoint.x, z: this.camera.goalPoint.z };
    } else this.tracked = undefined;
  }

  /** Teleports (landmark travel, G.12): onto the nearest free cell to (x, z) on a layer. */
  teleport(roofId: string, x: number, z: number) {
    Object.assign(this.pose, { roofId, x, z });
    this.walker.settle(this.pose);
    this.walk = undefined;
    this.rising = undefined;
    this.drawnOff = undefined;
    this.stride.stop();
    this.following = true;
  }
}
