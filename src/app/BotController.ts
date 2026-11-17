import type { CameraController } from '../rendering/CameraController';
import type { BloombotVisuals } from '../rendering/BloombotVisuals';
import { SLAB_TOP } from '../core/Picking';
import type { Sim } from '../gameplay/Sim';
import { BOT, type BotPose, spawnPose, Walker } from '../gameplay/Walker';

/**
 * Bloombot (#234): input, movement and the camera follow (G.2, G.3, G.11, G.12). The game owns what an action
 * does; this owns where bloombot is and when it gets there. Docs: docs/BLOOMBOT_EPIC.md.
 *
 * Moving: WASD / arrows or the left stick, relative to the camera's fixed angle; Shift or the right trigger
 * sprints. A click sets a walk target: bloombot paths there and then runs the click's action (`arrive`).
 * The camera follows bloombot unless something else moved it (a drag, a fly-to, Home, the overview's travel);
 * it picks bloombot up again as soon as bloombot moves.
 */
export type PadAction = 'pulse' | 'interact' | 'tray' | 'cancel' | 'harvest' | 'upgrades' | 'backpack' | 'prevTool' | 'nextTool' | 'overview' | 'pause';

/** Standard-mapping gamepad buttons (https://w3c.github.io/gamepad/#remapping). */
const PAD_BUTTONS: Partial<Record<number, PadAction>> = {
  0: 'pulse', // A
  1: 'cancel', // B
  2: 'interact', // X
  3: 'tray', // Y
  4: 'prevTool', // LB
  5: 'nextTool', // RB
  8: 'overview', // View
  9: 'pause', // Menu
  12: 'backpack', // d-pad up
  14: 'harvest', // d-pad left
  15: 'upgrades', // d-pad right
};
const DEAD = 0.18;
const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

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
  onPad?: (a: PadAction) => void;
  /** true while input must not move bloombot (cinematics, open modal, paused) */
  frozen = () => false;

  constructor(
    private sim: Sim,
    private camera: CameraController,
    readonly visuals: BloombotVisuals,
  ) {
    this.walker = new Walker(sim);
    const saved = sim.state.bot;
    this.pose = saved && sim.grid.layer(saved.roofId) ? { ...saved } : spawnPose(sim, this.walker);
    if (!this.walker.settle(this.pose)) Object.assign(this.pose, spawnPose(sim, this.walker));
    this.save();
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (MOVE_KEYS[e.code] || e.code.startsWith('Shift')) {
        this.held.add(e.code);
        this.lastInput = 'keys';
        if (e.code.startsWith('Arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  /** Bloombot's world position (feet). */
  world(): [number, number, number] {
    const l = this.sim.grid.layer(this.pose.roofId)!;
    const sink = this.walker.wading(this.pose) ? 0.07 : 0;
    return [l.origin[0] + this.pose.x, l.origin[1] + l.height + SLAB_TOP - sink, l.origin[2] + this.pose.z];
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

  private readPad(): { x: number; y: number; sprint: boolean; zoom: number } | undefined {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) return undefined;
    const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
    const x = dz(gp.axes[0] ?? 0);
    const y = -dz(gp.axes[1] ?? 0);
    const zoom = -dz(gp.axes[3] ?? 0);
    gp.buttons.forEach((b, i) => {
      const down = b.pressed;
      if (down && !this.padPrev[i]) {
        this.lastInput = 'pad';
        const a = PAD_BUTTONS[i];
        if (a) this.onPad?.(a);
      }
      this.padPrev[i] = down;
    });
    if (x || y) this.lastInput = 'pad';
    return { x, y, sprint: (gp.buttons[7]?.value ?? 0) > 0.4, zoom };
  }

  update(dt: number) {
    const pad = this.readPad();
    if (pad?.zoom) this.onZoom?.(Math.pow(1.8, pad.zoom * dt));
    let ix = 0;
    let iy = 0;
    for (const k of this.held) {
      const m = MOVE_KEYS[k];
      if (m) {
        ix += m[0];
        iy += m[1];
      }
    }
    if (pad) {
      ix += pad.x;
      iy += pad.y;
    }
    const mag = Math.min(1, Math.hypot(ix, iy));
    const frozen = this.frozen();
    this.sprinting = !frozen && (this.held.has('ShiftLeft') || this.held.has('ShiftRight') || !!pad?.sprint);
    const p = this.pose;
    const w = this.walker;
    const wade = w.wading(p) ? BOT.wade : 1;
    const top = (this.sprinting ? BOT.sprint : BOT.walk) * wade;
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
      if (this.walk) {
        this.walk.stuckFor = moved < want * dt * 0.1 ? this.walk.stuckFor + dt : 0;
        if (this.walk.stuckFor > 0.6) this.walk = undefined; // something moved into the way
      }
      if (moved > 0.001) this.following = true;
    }
    this.speed = dt > 0 ? moved / dt : 0;
    // A machine built or a plot turned solid under bloombot: step aside.
    if (!w.fits(p.roofId, p.x, p.z)) w.settle(p);
    const [x, y, z] = this.world();
    this.visuals.place(x, y, z, p.facing);
    this.visuals.setMotion(this.speed, this.sprinting);
    this.visuals.update(dt);
    this.follow(x, y, z);
  }

  private follow(x: number, _y: number, z: number) {
    const g = this.camera.goalPoint;
    if (this.tracked && (Math.abs(g.x - this.tracked.x) > 0.02 || Math.abs(g.z - this.tracked.z) > 0.02)) this.following = false;
    if (this.following) {
      this.camera.track(x, 0, z);
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
