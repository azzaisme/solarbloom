import type { CameraController } from '../rendering/CameraController';
import type { BloombotVisuals } from '../rendering/BloombotVisuals';
import { SLAB_TOP } from '../core/Picking';
import type { Sim } from '../gameplay/Sim';
import { BOT, type BotPose, spawnPose, Walker } from '../gameplay/Walker';
import { heightAt, levelY } from '../core/Height';
import type { Action, Bindings } from './Bindings';
import { RESEARCH } from '../data/research';
import { CHARGE } from '../data/charge';

/**
 * Bloombot (#234): input, movement and the camera follow (G.2, G.3, G.11, G.12). The game owns what an action
 * does; this owns where bloombot is and when it gets there. Docs: docs/BLOOMBOT_EPIC.md.
 *
 * Moving: WASD / arrows or the left stick, relative to where the camera is looking; once the Hover upgrade is
 * bought, Shift or the right trigger hovers (bloombot's sprint: faster, a little off the ground). A click sets
 * a walk target: bloombot paths there and then runs the click's action (`arrive`).
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
  arrive?: () => void;
  stuckFor: number;
}

export class BotController {
  readonly walker: Walker;
  readonly pose: BotPose;
  private held = new Set<string>();
  private padPrev: boolean[] = [];
  private walk?: Walk;
  /** G.13: riding a rooftop lift: rising (or sinking) in place, then stepping off on the other layer */
  private lift?: { roofId: string; x: number; z: number; fromY: number; toY: number; t: number; dur: number };
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
  /** a gamepad button was pressed (the game resolves it to an action for the context in effect) */
  onPad?: (button: number) => void;
  /** E22.1: sprint switched on by the toggle (left stick click); it ends when bloombot stops */
  sprintLatched = false;
  /** a menu that wants pad buttons first (G.7 focus navigation); true when it used the press */
  padCapture?: (button: number) => boolean;
  /** any gamepad button press, by index (the rebinding screen listens here) */
  onButton?: (button: number) => void;
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
    this.save();
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
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

  get riding(): boolean {
    return !!this.lift;
  }

  /** The cell in front, which every tool acts on. */
  front() {
    return this.walker.front(this.pose);
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

  get walking(): boolean {
    return !!this.walk;
  }

  cancelWalk() {
    this.walk = undefined;
  }

  private readPad(): { x: number; y: number; sprint: boolean; zoom: number; turn: number } | undefined {
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
    return { x, y, sprint: sb !== undefined && (gp.buttons[sb]?.value ?? 0) > 0.4, zoom, turn };
  }

  update(dt: number) {
    const pad = this.readPad();
    if (pad?.zoom) this.onZoom?.(Math.pow(1.8, pad.zoom * dt));
    if (pad?.turn) this.onTurn?.(-pad.turn * TURN_SPEED * dt);
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
    if (this.lift) {
      this.lift.t += dt;
      if (this.lift.t >= this.lift.dur) {
        const l = this.lift;
        this.lift = undefined;
        this.teleport(l.roofId, l.x, l.z);
      } else {
        const [x, y, z] = this.world();
        this.visuals.place(x, y, z, this.pose.facing);
        this.visuals.setMotion(0, false);
        this.visuals.update(dt);
        this.follow(x, y, z);
        return;
      }
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
    if (!frozen && mag > 0.01) {
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
        const done = this.walk;
        this.walk = undefined;
        if (done.face) p.facing = Math.atan2(done.face.x + 0.5 - p.x, done.face.z + 0.5 - p.z);
        done.arrive?.();
      } else {
        const dx = next.x - p.x;
        const dz = next.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.12) this.walk.path.shift();
        else {
          dirX = dx / d;
          dirZ = dz / d;
          want = Math.min(top, d / Math.max(dt, 1e-3));
        }
      }
    }
    let moved = 0;
    if (want > 0) {
      moved = w.move(p, dirX * want * dt, dirZ * want * dt);
      const goal = Math.atan2(dirX, dirZ);
      let diff = goal - p.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      p.facing += diff * Math.min(1, dt * BOT.turn);
      p.facing = Math.atan2(Math.sin(p.facing), Math.cos(p.facing)); // keep it in (-π, π] for the save
      if (this.walk) {
        this.walk.stuckFor = moved < want * dt * 0.1 ? this.walk.stuckFor + dt : 0;
        if (this.walk.stuckFor > 0.6) this.walk = undefined; // something moved into the way
      }
      if (moved > 0.001) this.following = true;
    }
    this.speed = dt > 0 ? moved / dt : 0;
    if (this.sprinting && moved > 0.001) {
      // E23.6.7: sprinting along a laid path costs less (e23-craft's sim.paths, once it lands)
      const paths = (this.sim as unknown as { paths?: { onPath?(x: number, z: number): boolean; sprintChargeShare?: number } }).paths;
      const k = paths?.onPath?.(this.pose.x, this.pose.z) ? (paths.sprintChargeShare ?? CHARGE.pathSprintShare) : 1;
      this.sim.charge.use('sprint', dt * k);
    }
    // A machine built or a plot turned solid under bloombot: step aside.
    if (!w.fits(p.roofId, p.x, p.z)) w.settle(p);
    const [x, y, z] = this.world();
    this.visuals.place(x, y, z, p.facing);
    this.visuals.setTired(flat);
    this.visuals.setMotion(this.speed, this.sprinting);
    this.visuals.update(dt);
    this.follow(x, y, z);
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
    this.following = true;
  }
}
