import type { Action, Bindings } from './Bindings';
import type { BotController } from './BotController';
import type { Sim } from '../gameplay/Sim';
import type { Hud } from '../ui/Hud';
import type { MachineData, MaterialId } from '../core/types';
import { GROUND } from '../core/GameState';
import { MATERIALS, SALVAGE } from '../data/salvage';
import { flyUp, fountainHtml, OldCityPanel, storageAct, storageHtml } from '../ui/OldCityPanel';
import { PARK } from '../core/Areas';
import { setPieceAt } from '../core/OldCityLayout';

/** What the game lends the Old City controller (kept small, so Game.ts changes little). */
export interface OldCityHost {
  sim: Sim;
  hud: Hud;
  bot: BotController;
  bindings: Bindings;
  /** where a tile is on screen, for prompts anchored to it */
  screenOf(x: number, z: number): { x: number; y: number };
  /** plays a sound by name, if the game has it */
  sound(name: 'click' | 'salvage' | 'pry' | 'deliver' | 'tier' | 'wake', material?: MaterialId): void;
  /** redraws the ground tile at a cell */
  markTile(x: number, z: number): void;
  /**
   * E21.24 / E21.22: the camera rises over a spot for `secs` and comes back (skippable; a still frame with reduced
   * motion); `done` gets the regions whose landmark was on screen.
   */
  vista(x: number, z: number, secs: number, done: (seen: string[]) => void): void;
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
    host.sim.bus.on('pile.salvaged', (e) => {
      host.markTile(e.x, e.z);
      const sc = host.screenOf(e.x, e.z);
      flyUp(host.hud.root, `+${e.got} ${MATERIALS[e.material].icon} ${MATERIALS[e.material].name}`, sc.x, sc.y);
      host.sound('salvage', e.material);
      this.panel.refresh();
    });
    host.sim.bus.on('fountain.tier', () => this.panel.close());
    host.sim.bus.on('pack.full', (e) => host.hud.toast(`Your ${MATERIALS[e.material].name} stack is full<small>Put some in storage at the fountain or a chest.</small>`, '', 2.6));
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
    const onGround = this.host.bot.pose.roofId === GROUND;
    const pile = onGround ? this.sim.salvage.pileAt(front.x, front.z) : undefined;
    if (pile) {
      this.salvageHold(pile.id, front, false);
      return true;
    }
    // E21.24: a lookout: a short vista over the city; every landmark beacon in view counts as seen
    const sp = onGround ? setPieceAt(front.x, front.z) : undefined;
    if (sp?.kind === 'lookout') {
      this.host.sound('click');
      this.sim.salvage.see(`lookout:${sp.id}`);
      this.host.vista(front.x + 0.5, front.z + 0.5, 3, (seen) => {
        for (const r of seen) this.sim.salvage.see(`beacon:${r}`);
      });
      return true;
    }
    // E21.5: a gate: Pry a barricade (hold 2 s), repair a bridge, or hear what it needs
    const gate = onGround ? this.sim.gates.gateAt(front.x, front.z) : undefined;
    if (gate) {
      const why = this.sim.gates.problem(gate);
      const sc = this.host.screenOf(front.x, front.z);
      if (why) this.host.hud.showFail(why, sc.x, sc.y);
      else if (gate.kind === 'barricade')
        this.startHold('pry', SALVAGE.pryHoldSeconds, () => {
          if (this.sim.gates.open(gate.id)) {
            this.host.sound('pry');
            for (const [x, z] of gate.cells) this.host.markTile(x, z);
          }
        });
      else if (this.sim.gates.open(gate.id)) {
        this.host.sound('deliver');
        for (const [x, z] of gate.cells) this.host.markTile(x, z);
      }
      return true;
    }
    // E21.6: the fountain opens its delivery panel (with a way to the store)
    if (occupant?.type === 'core' && this.sim.areas.areaOf(occupant) === PARK) {
      this.openFountain();
      return true;
    }
    if (occupant && (occupant.type === 'chest' || this.isStoreLandmark(occupant))) {
      this.openStorage();
      return true;
    }
    void front;
    return false;
  }

  /** Salvage a pile: hold Interact 0.6 s (a click-to-walk arrival needs no hold). */
  private salvageHold(id: string, at: { x: number; z: number }, viaClick: boolean) {
    const why = this.sim.salvage.problem(id);
    if (why) {
      const sc = this.host.screenOf(at.x, at.z);
      this.host.hud.showFail(why, sc.x, sc.y);
      return;
    }
    this.startHold('salvage', SALVAGE.holdSeconds, () => this.sim.salvage.salvage(id), viaClick);
  }

  /**
   * A click on a tile under old-city rules: a pile walks bloombot there and salvages it. True when handled.
   */
  click(tile: { roofId: string; x: number; z: number }): boolean {
    if (!this.sim.oldCity || tile.roofId !== GROUND) return false;
    const pile = this.sim.salvage.pileAt(tile.x, tile.z);
    if (!pile) return false;
    const b = this.host.bot;
    const go = b.goTo(GROUND, pile.x, pile.z, 1, () => this.salvageHold(pile.id, pile, true));
    if (!go) {
      const sc = this.host.screenOf(pile.x, pile.z);
      this.host.hud.showFail("Bloombot can't find a way there", sc.x, sc.y);
    }
    return true;
  }

  /** A woken landmark (or the fountain) is a way into the store. */
  private isStoreLandmark(m: MachineData): boolean {
    if (m.type !== 'core') return false;
    return this.sim.inventory.accessPoints().some((p) => p.x === m.x && p.z === m.z && p.roofId === m.roofId);
  }

  openFountain() {
    this.host.sound('click');
    this.panel.open(
      () => fountainHtml(this.sim),
      (act) => {
        if (act === 'storage') return this.openStorage('Storage — at the fountain');
        if (act === 'giveAll' && this.sim.fountain.giveAll() > 0) this.host.sound('deliver');
      },
    );
  }

  openStorage(title = 'Storage') {
    this.host.sound('click');
    this.panel.open(
      () => storageHtml(this.sim, title),
      (act, arg) => storageAct(this.sim, act, arg),
    );
  }
}
