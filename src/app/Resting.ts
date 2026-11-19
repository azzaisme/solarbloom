import type { CameraController } from '../rendering/CameraController';
import type { KeeperVisuals } from '../rendering/KeeperVisuals';
import type { Sfx } from '../audio/Sfx';
import type { MachineData, TileData } from '../core/types';
import { KEEPERS } from '../data/oldcity';
import { REST } from '../data/rest';
import type { Bench } from '../gameplay/Rest';
import type { Sim } from '../gameplay/Sim';
import type { Hud } from '../ui/Hud';
import type { PromptModel } from '../ui/Prompt';
import type { Action } from './Bindings';
import type { BotController } from './BotController';
import type { Candidate } from './Interact';

export interface RestHost {
  sim: Sim;
  bot: BotController;
  camera: CameraController;
  hud: Hud;
  sfx: Sfx;
  keepers?: KeeperVisuals;
  glyph(a: Action): string;
  showFail(msg: string, at?: TileData): void;
}

/** A rest candidate for Interact (Game adds `run`). */
export type RestCandidate = Candidate & { run: () => void; at?: TileData };

/**
 * E23.2.3 (#373): sitting down, the game side. Interact on a bench in front mends it (an old park bench) or sits
 * on it; Interact on a charger sits cross-legged and meditates. While sitting the camera eases out to a calm
 * view and turns slowly, the HUD fades away (the prompt stays), the music swells, and Pulse lets time run faster.
 * Interact, Back or moving stands bloombot up and the camera returns to where it was. Photo mode works as usual.
 * A Keeper who is a friend comes and sits beside bloombot on a bench.
 */
export class Resting {
  private before?: { zoom: number; yaw: number; maxZoom: number };

  constructor(private h: RestHost) {
    h.bot.onSeatMove = () => this.stand();
    // the sim may stand bloombot up by itself (its bench taken away, its charger gone): put the view back too
    h.sim.bus.on('rest.stood', () => this.settle());
  }

  get active(): boolean {
    return !!this.h.sim.rest.sitting;
  }

  /** What Interact can do with the tile in front: mend or sit on a bench, meditate at a charger. */
  candidates(tile: TileData, distance: number): RestCandidate[] {
    const s = this.h.sim;
    if (!s.oldCity) return [];
    const b = s.rest.benchAt(tile.x, tile.z);
    if (b) {
      if (s.rest.usable(b)) return [{ kind: 'bench', id: b.id, verb: 'Sit on', name: 'the bench', distance, at: tile, run: () => this.sitBench(b) }];
      const short = s.inventory.canPay(REST.mendCost) ? undefined : 'Needs a little Scrap to mend';
      return [{ kind: 'bench', id: b.id, verb: 'Mend', name: 'the old bench', distance, at: tile, refused: short, run: () => this.mend(b, tile) }];
    }
    const m = s.occupant(tile);
    if (m && (m.type as string) === 'charger') return [{ kind: 'bench', id: `meditate:${m.id}`, verb: 'Meditate at', name: 'the charger', distance, at: tile, run: () => this.meditate(m) }];
    return [];
  }

  private mend(b: Bench, tile: TileData) {
    const why = this.h.sim.rest.mend(b);
    if (why) return this.h.showFail(why, tile);
    this.h.bot.visuals.play('interact');
  }

  /** Sits on a bench, facing out from it, at one end of the seat (room for a friend at the other). */
  sitBench(b: Bench) {
    const h = this.h;
    if (!h.sim.rest.sitOnBench(b)) return;
    const [, by] = h.bot.world();
    const cx = b.x + 0.5;
    const cz = b.z + 0.5;
    const facing = b.facing;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    // along the seat (the bench is long across its facing)
    const sx = Math.cos(facing);
    const sz = -Math.sin(facing);
    const friend = h.sim.rest.friends(b.x, b.z).find((id) => h.sim.keepers.visible(id));
    // E23.2.4: an animal coming to curl up beside bloombot (sim.wildlife planned it as bloombot sat) gets the seat's
    // free end, unless a friend Keeper has it
    const visitor = !friend && h.sim.wildlife.visits.some((v) => v.perch === 'beside');
    const { out, raise, friendOut, along, friend: other, visitorOut, visitorAlong } = REST.seat;
    const side = friend || visitor ? along : 0;
    h.bot.seat = { x: cx + fx * out - sx * side, y: by, z: cz + fz * out - sz * side, facing };
    h.bot.visuals.setPose('sit', REST.benchSeat + raise);
    // a Keeper who is a friend sits beside (only one already out and about: never in fog)
    if (friend && h.keepers) h.keepers.beside = { id: friend, x: cx + fx * friendOut + sx * other, y: by, z: cz + fz * friendOut + sz * other, facing, seat: REST.benchSeat };
    this.benchSpot = visitor ? { x: cx + fx * visitorOut + sx * visitorAlong, y: by + REST.benchSeat, z: cz + fz * visitorOut + sz * visitorAlong } : undefined;
    this.calm();
  }

  /** E23.2.4: on a bench, the seat's free end where an animal beside bloombot settles (undefined: no room, or not sitting). */
  benchSpot?: { x: number; y: number; z: number };

  /**
   * E23.3.3: sits cross-legged on the charger in front, centred on the glowing pad and facing out the way bloombot
   * came, and meditates while the pad charges (sim.chargers: it charges while bloombot is docked there and the grid
   * has power). Bloombot's own place stays at the pad's edge (a machine's tile can't be walked onto): docked, and
   * where it stands up again.
   */
  meditate(m: MachineData) {
    const h = this.h;
    if (!h.sim.rest.meditate(m)) return;
    const p = h.bot.pose;
    const [, y] = h.bot.world();
    // the pad's edge on bloombot's side: inside the pad's reach, so it is docked
    const half = m.size / 2;
    const cx = m.x + half;
    const cz = m.z + half;
    const d = Math.hypot(p.x - cx, p.z - cz) || 1;
    const k = (half + REST.padGap) / d;
    p.x = cx + (p.x - cx) * k;
    p.z = cz + (p.z - cz) * k;
    h.sim.bot = { roofId: p.roofId, x: p.x, z: p.z };
    // seated on the pad's top, facing out toward the edge it came from
    const facing = Math.atan2(p.x - cx, p.z - cz);
    p.facing = facing;
    h.bot.seat = { x: cx, y: y + REST.padTop, z: cz, facing };
    h.bot.visuals.setPose('meditate');
    this.calm();
  }

  private calm() {
    const h = this.h;
    this.before = { zoom: h.camera.zoomTarget, yaw: h.camera.heading, maxZoom: h.camera.maxZoom };
    h.camera.maxZoom = Math.max(h.camera.maxZoom, REST.visitZoom);
    h.camera.zoomTo(Math.max(h.camera.minZoom, this.before.zoom * REST.calmZoom));
    document.body.classList.add('resting');
    h.sfx.swell(REST.musicSwell);
  }

  /** Stands bloombot up (the sim's 'rest.stood' then puts the view back). */
  stand() {
    if (this.active) this.h.sim.rest.stand();
    else this.settle();
  }

  /** Back to standing in the world: the pose, the friend, the HUD, the music and the camera. */
  private settle() {
    const h = this.h;
    if (!h.bot.seat && !this.before) return;
    h.bot.seat = undefined;
    this.benchSpot = undefined;
    h.bot.visuals.setPose(undefined);
    if (h.keepers) h.keepers.beside = undefined;
    document.body.classList.remove('resting');
    h.sfx.swell(0);
    if (this.before) {
      h.camera.maxZoom = this.before.maxZoom;
      h.camera.zoomTo(this.before.zoom);
      h.camera.turnTo(this.before.yaw);
      this.before = undefined;
    }
  }

  /** An action while sitting. True when sitting used it (Interact and Back stand; Pulse turns faster time). */
  action(a: Action): boolean {
    if (!this.active) return false;
    if (a === 'interact' || a === 'cancel') {
      this.stand();
      return true;
    }
    if (a === 'pulse' || a === 'place') {
      this.h.sim.rest.fast = !this.h.sim.rest.fast;
      return true;
    }
    return false;
  }

  /** The prompt while sitting: stand up, and let time run faster (or back to normal). */
  prompt(): PromptModel {
    const fast = this.h.sim.rest.fast;
    return { glyph: this.h.glyph('interact'), text: 'Stand up', pulse: { glyph: this.h.glyph('pulse'), text: fast ? 'Back to normal time' : 'Let time run faster' } };
  }

  /** Each frame: the calm view turns slowly while sitting. */
  update(dt: number) {
    if (!this.active || !this.before) return;
    this.h.camera.orbit(dt * REST.orbitDegPerSecond);
  }

  /** The name of the Keeper sitting beside bloombot, if any (tests and the debug overlay). */
  get friend(): string | undefined {
    const id = this.h.keepers?.beside?.id;
    return id ? KEEPERS.find((k) => k.id === id)?.name : undefined;
  }
}
