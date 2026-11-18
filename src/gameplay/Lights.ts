import { parseDecorKey, decoration } from '../core/Decor';
import { GROUND } from '../core/GameState';
import type { MachineData } from '../core/types';
import { POWER } from '../data/power';
import { LIGHT, LIGHTING, type LightDef } from '../data/lights';
import type { PowerNode } from './PowerGrid';
import type { Sim } from './Sim';

/** A light as the renderer draws it. */
export interface LitLight {
  /** decoration key (`<layer>|<x>|<z>`), or `pole:<machine id>` for line lights */
  key: string;
  def: LightDef;
  roofId: string;
  x: number;
  z: number;
  rot: number;
  /** the pole a line light hangs on */
  pole?: MachineData;
  /** 0..1: how brightly it glows right now (already includes its own brightness) */
  glow: number;
}

/**
 * E23.3.5 (#471): night lighting (`sim.lights`). Lights are decorations (`state.cozy.decor`) or, for line lights,
 * hung on a power pole (`state.cozy.poleLights`). This is the sim side: it puts grid and solar lights on the power
 * grid as nodes (grid lights are `lamp`s, first in the shed order; a solar light is a little network of its own with
 * a panel and a battery) and works out how brightly each glows: on at dusk, off at dawn, fading in and out, and on
 * in fog and storms, whatever the clock mode (it reads the sky through PowerEnv).
 */
export class Lights {
  private nodes = new Map<string, PowerNode>();
  private sig = '';
  /** the darkness lights answer to, eased so they fade in rather than snap */
  private dark = 0;
  private started = false;

  constructor(private sim: Sim) {
    for (const def of Object.values(LIGHT)) {
      if (def.power === 'grid') {
        const draw = def.line ? undefined : (def.draw ?? POWER.draw.lamp);
        sim.power.register(`light:${def.id}`, {
          poleOnly: true,
          consumer: {
            shed: 'lamp',
            dims: true,
            // Grid lights draw only while they are lit; line lights per bulb on their pole's lines.
            draw: (n, _s, sky) => sky.dark * (draw ?? (def.draw ?? 0) * this.bulbsOn(n.id)),
          },
        });
      } else if (def.power === 'solar') {
        const S = LIGHTING.solar;
        sim.power.register(`light:${def.id}`, {
          standalone: true,
          source: (_n, _s, sky) => S.panel * sky.solar,
          battery: { capacity: S.capacity, rate: S.rate },
          consumer: { shed: 'lamp', dims: true, draw: (_n, _s, sky) => S.draw * sky.dark },
        });
      }
    }
    sim.power.addNodes(() => [...this.nodes.values()]);
  }

  /** The definition of a light decoration kind, if it is one. */
  static def(kind: string | undefined): LightDef | undefined {
    return kind ? LIGHT[kind] : undefined;
  }

  // ───────────── line lights on poles ─────────────

  /** The pole a line light aimed at this tile would hang on: the nearest pole within reach, if any. */
  poleNear(roofId: string, x: number, z: number): MachineData | undefined {
    let best: MachineData | undefined;
    let bestD = Infinity;
    for (const m of this.sim.state.machines) {
      if (m.roofId !== roofId || !this.sim.power.roleOf(m)?.pole) continue;
      const d = Math.hypot(m.x + m.size / 2 - (x + 0.5), m.z + m.size / 2 - (z + 0.5));
      if (d <= LIGHTING.poleReach + 1e-9 && d < bestD) {
        best = m;
        bestD = d;
      }
    }
    return best;
  }

  /** Why a line light can't hang here, or undefined when it can. */
  canHang(kind: string, roofId: string, x: number, z: number): string | undefined {
    const def = LIGHT[kind];
    if (!def?.line) return 'That light stands on the ground';
    const pole = this.poleNear(roofId, x, z);
    if (!pole) return 'Hang it on a power pole: aim at one';
    if (!this.sim.power.networkOf(pole)?.links.some(([a, b]) => a === pole || b === pole)) return 'This pole has no lines yet: link it to another pole';
    return undefined;
  }

  /** Hangs a line light on the pole nearest the aimed tile. Returns why not, or undefined. */
  hang(kind: string, roofId: string, x: number, z: number): string | undefined {
    const why = this.canHang(kind, roofId, x, z);
    if (why) return why;
    const pole = this.poleNear(roofId, x, z)!;
    const cozy = (this.sim.state.cozy ??= {});
    cozy.poleLights = { ...(cozy.poleLights ?? {}), [pole.id]: kind };
    this.refresh();
    return undefined;
  }

  /** Takes the lights off a pole. Returns the light id that was there. */
  unhang(pole: MachineData | undefined): string | undefined {
    const pl = this.sim.state.cozy?.poleLights;
    const kind = pole && pl?.[pole.id];
    if (!kind) return undefined;
    delete pl![pole!.id];
    if (!Object.keys(pl!).length) delete this.sim.state.cozy!.poleLights;
    this.refresh();
    return kind;
  }

  /** The line light on a pole, if any. */
  onPole(pole: MachineData | undefined): string | undefined {
    return pole ? this.sim.state.cozy?.poleLights?.[pole.id] : undefined;
  }

  /** How many bulbs hang on a pole's lines (half of each line belongs to each end). */
  private bulbsOn(nodeId: string): number {
    const pole = this.sim.machine(nodeId.slice('pole:'.length));
    const def = LIGHT[this.onPole(pole) ?? ''];
    if (!pole || !def?.spacing) return 0;
    let n = 0;
    for (const o of this.sim.relays.linked(pole)) n += Math.max(1, Math.round(this.sim.relays.distance(pole, o) / def.spacing / 2));
    return n;
  }

  // ───────────── grid nodes ─────────────

  /** Keeps the grid's light nodes in step with the decorations and pole lights (cheap: a key list compare). */
  private refresh(): void {
    const decor = this.sim.state.cozy?.decor ?? {};
    const poles = this.sim.state.cozy?.poleLights ?? {};
    const keys: string[] = [];
    for (const [k, v] of Object.entries(decor)) {
      const d = decoration(k, v);
      const def = d && LIGHT[d.kind];
      if (def && def.power !== 'glow' && !def.line) keys.push(`${k}=${d!.kind}`);
    }
    // A pole lightning tripped carries nothing: the lights on its lines go dark until it is reset.
    for (const [id, kind] of Object.entries(poles)) {
      const pole = this.sim.machine(id);
      if (pole && !pole.tripped && LIGHT[kind]?.power === 'grid') keys.push(`pole:${id}=${kind}`);
    }
    const sig = keys.join(';');
    if (sig === this.sig) return;
    this.sig = sig;
    const next = new Map<string, PowerNode>();
    for (const kv of keys) {
      const [id, kind] = kv.split('=');
      const old = this.nodes.get(id);
      if (old && old.type === `light:${kind}`) {
        next.set(id, old);
        continue;
      }
      let roofId = GROUND;
      let x = 0;
      let z = 0;
      if (id.startsWith('pole:')) {
        const pole = this.sim.machine(id.slice(5))!;
        roofId = pole.roofId;
        x = pole.x;
        z = pole.z;
      } else {
        const at = parseDecorKey(id)!;
        roofId = at.roofId;
        x = at.x;
        z = at.z;
      }
      next.set(id, this.node(id, `light:${kind}`, roofId, x, z));
    }
    // Forget the stored charge of lights that were taken away.
    const cells = this.sim.state.power?.cells;
    if (cells) for (const id of Object.keys(cells)) if (!next.has(id)) delete cells[id];
    this.nodes = next;
    this.sim.power.invalidate();
  }

  /** A grid node whose stored charge lives in `state.power.cells` (so a solar light keeps it through a save). */
  private node(id: string, type: string, roofId: string, x: number, z: number): PowerNode {
    const st = this.sim.state;
    return {
      id,
      type,
      roofId,
      x,
      z,
      size: 1,
      get charge() {
        return st.power?.cells?.[id] ?? 0;
      },
      set charge(v: number) {
        const p = (st.power ??= {});
        (p.cells ??= {})[id] = Math.round(v * 1000) / 1000;
      },
    };
  }

  /** The grid node for a light (decoration key or `pole:<id>`), if it is on the grid. */
  nodeOf(key: string): PowerNode | undefined {
    this.refresh();
    return this.nodes.get(key);
  }

  tick(dt: number): void {
    this.refresh();
    // Clean up line lights whose pole was taken down.
    const pl = this.sim.state.cozy?.poleLights;
    if (pl) for (const id of Object.keys(pl)) if (!this.sim.machine(id)) this.unhang({ id } as MachineData);
    const target = this.sim.power.sky().dark;
    if (!this.started) {
      this.dark = target;
      this.started = true;
    } else {
      const k = Math.min(1, dt / Math.max(1e-6, LIGHTING.fadeSeconds));
      this.dark += (target - this.dark) * k;
      if (Math.abs(target - this.dark) < 1e-4) this.dark = target;
    }
  }

  /** How dark lights think it is (0 day .. 1 night), eased. */
  darkness(): number {
    if (!this.started) this.dark = this.sim.power.sky().dark;
    this.started = true;
    return this.dark;
  }

  /** How brightly one light glows now, 0..1 (its own brightness included). */
  glowOf(key: string, def: LightDef): number {
    this.refresh();
    return this.glowNow(key, def);
  }

  private glowNow(key: string, def: LightDef): number {
    const dark = this.darkness();
    if (dark <= 0) return 0;
    if (def.power === 'glow') return dark * def.brightness;
    const n = this.nodes.get(key);
    if (!n) return 0;
    // The grid's eased level is the share of its draw it got; a grid light that is not lit draws nothing.
    return dark * this.sim.power.level(n) * def.brightness;
  }

  /** Every light in the world and how brightly it glows now (for the renderer and tests). */
  all(): LitLight[] {
    this.refresh();
    const out: LitLight[] = [];
    for (const [k, v] of Object.entries(this.sim.state.cozy?.decor ?? {})) {
      const d = decoration(k, v);
      const def = d && LIGHT[d.kind];
      if (!d || !def || def.line) continue;
      out.push({ key: k, def, roofId: d.roofId, x: d.x, z: d.z, rot: d.rot, glow: this.glowNow(k, def) });
    }
    for (const [id, kind] of Object.entries(this.sim.state.cozy?.poleLights ?? {})) {
      const pole = this.sim.machine(id);
      const def = LIGHT[kind];
      if (!pole || !def) continue;
      out.push({ key: `pole:${id}`, def, roofId: pole.roofId, x: pole.x, z: pole.z, rot: 0, pole, glow: this.glowNow(`pole:${id}`, def) });
    }
    return out;
  }
}
