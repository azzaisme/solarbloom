import type { Action, Bindings } from './Bindings';
import type { BotController } from './BotController';
import type { Sim } from '../gameplay/Sim';
import type { Hud } from '../ui/Hud';
import type { MachineData } from '../core/types';
import { OldCityPanel, storageAct, storageHtml } from '../ui/OldCityPanel';

/** What the game lends the Old City controller (kept small, so Game.ts changes little). */
export interface OldCityHost {
  sim: Sim;
  hud: Hud;
  bot: BotController;
  bindings: Bindings;
  /** where a tile is on screen, for prompts anchored to it */
  screenOf(x: number, z: number): { x: number; y: number };
  /** plays a sound by name, if the game has it */
  sound(name: 'click' | 'salvage' | 'pry' | 'deliver' | 'tier' | 'wake'): void;
}

/**
 * E21: the game side of the Old City — opening its panels, holding Interact at piles and barricades, keeping the
 * sim told where bloombot stands. Everything that changes the game goes through the Sim; this only reads input
 * and draws panels.
 */
export class OldCityController {
  readonly panel: OldCityPanel;
  /** a held Interact in progress (salvage, pry): what, how long so far, how long it needs */
  private hold?: { kind: string; t: number; need: number; done: () => void; padHeld: boolean };
  private keysDown = new Set<string>();

  constructor(private host: OldCityHost) {
    this.panel = new OldCityPanel(host.hud.root);
    window.addEventListener('keydown', (e) => this.keysDown.add(e.code));
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code));
    window.addEventListener('blur', () => this.keysDown.clear());
  }

  get sim(): Sim {
    return this.host.sim;
  }

  /** Is the Interact button still down (keyboard or pad)? */
  private interactHeld(): boolean {
    const b = this.host.bindings;
    if (b.isDown('interact' as Action, this.keysDown)) return true;
    const i = b.pad.interact;
    if (i === undefined || typeof navigator === 'undefined' || !navigator.getGamepads) return false;
    return [...navigator.getGamepads()].some((gp) => !!gp?.buttons[i]?.pressed);
  }

  /** True while a panel is open or a hold is running (bloombot stands still). */
  get busy(): boolean {
    return this.panel.isOpen || !!this.hold;
  }

  /**
   * Starts a held Interact: it completes after `need` seconds if Interact stays down (a click-to-walk arrival
   * completes it without holding). Moving away or letting go cancels it.
   */
  startHold(kind: string, need: number, done: () => void, viaClick = false) {
    this.hold = { kind, t: 0, need, done, padHeld: !viaClick };
    this.host.bot.visuals.play('assemble');
  }

  /** Per frame: tells the sim where bloombot is, runs a hold. */
  update(dt: number) {
    const p = this.host.bot.pose;
    this.sim.bot = { roofId: p.roofId, x: p.x, z: p.z };
    const h = this.hold;
    if (!h) return;
    if (h.padHeld && !this.interactHeld() && h.t > 0.12) {
      this.hold = undefined;
      return;
    }
    h.t += dt;
    if (h.t >= h.need) {
      this.hold = undefined;
      h.done();
    }
  }

  /** 0–1 of the hold in progress, for a ring on the HUD (undefined when none). */
  holdProgress(): number | undefined {
    return this.hold ? Math.min(1, this.hold.t / this.hold.need) : undefined;
  }

  /** Closes the panel (Cancel). True when it was open. */
  escape(): boolean {
    if (this.hold) {
      this.hold = undefined;
      return true;
    }
    if (!this.panel.isOpen) return false;
    this.panel.close();
    return true;
  }

  /**
   * Interact with something in front of bloombot. Returns true when the Old City handled it (the game then does
   * nothing else).
   */
  interact(front: { x: number; z: number }, occupant?: MachineData): boolean {
    if (!this.sim.oldCity) return false;
    if (occupant && (occupant.type === 'chest' || this.isStoreLandmark(occupant))) {
      this.openStorage();
      return true;
    }
    void front;
    return false;
  }

  /** A woken landmark (or the fountain) is a way into the store. */
  private isStoreLandmark(m: MachineData): boolean {
    if (m.type !== 'core') return false;
    return this.sim.inventory.accessPoints().some((p) => p.x === m.x && p.z === m.z && p.roofId === m.roofId);
  }

  openStorage(title = 'Storage') {
    this.host.sound('click');
    this.panel.open(
      () => storageHtml(this.sim, title),
      (act, arg) => storageAct(this.sim, act, arg),
    );
  }
}
