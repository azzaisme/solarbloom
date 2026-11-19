import * as pc from 'playcanvas';
import type { PowerNetwork, PowerNode } from '../gameplay/PowerGrid';
import type { Sim } from '../gameplay/Sim';
import { mat, PALETTE } from './Materials';
import { bezier, part, tube } from './MachineParts';
import { group } from './Shapes';

/** How high a cable meets a machine, by type (world units above its base). Poles carry theirs on the crossarm. */
const CABLE_Y: Record<string, number> = { windTurbine: 0.5, battery: 0.85, solar: 0.3, charger: 0.6 };

type V3 = [number, number, number];

/**
 * E23.3.2.3: a Bloom Relay is a power pole: a crossarm under its crystal with an insulator at each end (along world x).
 * Its height above the base, half its length, and the insulator's height. MachineVisuals draws it; lines meet it.
 */
export const POLE_ARM = { y: 0.8, half: 0.34, insulator: 0.11 };

/** Where a cable meets a machine standing at `base`: a pole's insulator on the side facing `toward`. */
export function anchorOf(m: { type: string }, base: V3, toward?: V3): V3 {
  if (m.type === 'relay') {
    const side = toward && toward[0] < base[0] - 0.05 ? -1 : 1;
    return [base[0] + side * POLE_ARM.half, base[1] + POLE_ARM.y + POLE_ARM.insulator, base[2]];
  }
  return [base[0], base[1] + (CABLE_Y[m.type] ?? 0.5), base[2]];
}

/** Height above its base where a cable meets this machine (a pole: its insulators). */
export const cableY = (m: { type: string }): number => anchorOf(m, [0, 0, 0])[1];

/**
 * E23.3.2.3: the grid's cables, drawn in the world. Linked poles are strung together with a sagging cable, and every
 * machine a pole feeds gets a thin drop cable from that pole, so you can see what a network powers without any
 * overlay. Rebuilt only when the networks change.
 */
export class PowerLines {
  private root: pc.Entity;
  private seen?: PowerNetwork[];

  constructor(
    private sim: Sim,
    parent: pc.Entity,
    private worldOf: (m: PowerNode) => [number, number, number],
  ) {
    this.root = group(parent, 'powerLines');
  }

  update(): void {
    const nets = this.sim.power.networks();
    if (nets === this.seen) return;
    this.seen = nets;
    for (const c of [...this.root.children]) c.destroy();
    const line = mat(PALETTE.grille, { gloss: 0.4 });
    for (const n of nets) {
      for (const [a, b] of n.links) this.cable(a, b, line, 0.022, 0.08);
      // Lights are wired underground (no web of drop cables over a lit path); the Power overlay still shows them.
      for (const [p, m] of n.feeds) if (!m.type.startsWith('light:')) this.cable(p, m, line, 0.012, 0.12);
    }
  }

  private cable(a: PowerNode, b: PowerNode, m: pc.Material, r: number, sagPerTile: number) {
    const pa = this.worldOf(a);
    const pb = this.worldOf(b);
    const A = anchorOf(a, pa, pb);
    const B = anchorOf(b, pb, pa);
    const len = Math.hypot(B[0] - A[0], B[2] - A[2]);
    const sag = Math.min(1.2, len * sagPerTile);
    const mid: [number, number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2 - sag * 2, (A[2] + B[2]) / 2];
    const key = `power|${A.map((v) => v.toFixed(2)).join(',')}|${B.map((v) => v.toFixed(2)).join(',')}|${r}`;
    part(this.root, tube(key, bezier(A, mid, B, Math.max(6, Math.ceil(len))), r, { sides: 5 }), m, {});
  }
}
