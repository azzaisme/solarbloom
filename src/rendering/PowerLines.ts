import * as pc from 'playcanvas';
import type { PowerNetwork, PowerNode } from '../gameplay/PowerGrid';
import type { Sim } from '../gameplay/Sim';
import { mat, PALETTE } from './Materials';
import { bezier, part, tube } from './MachineParts';
import { group } from './Shapes';

/** How high a cable meets a machine, by type (world units above its base); poles carry theirs at the top. */
const CABLE_Y: Record<string, number> = { relay: 1.0, windTurbine: 0.5, battery: 0.85, solar: 0.3, charger: 0.6 };
/** Where a cable meets this machine, above its base. */
export const cableY = (m: PowerNode): number => CABLE_Y[m.type] ?? 0.5;

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
      for (const [p, m] of n.feeds) this.cable(p, m, line, 0.012, 0.12);
    }
  }

  private cable(a: PowerNode, b: PowerNode, m: pc.Material, r: number, sagPerTile: number) {
    const pa = this.worldOf(a);
    const pb = this.worldOf(b);
    const A: [number, number, number] = [pa[0], pa[1] + cableY(a), pa[2]];
    const B: [number, number, number] = [pb[0], pb[1] + cableY(b), pb[2]];
    const len = Math.hypot(B[0] - A[0], B[2] - A[2]);
    const sag = Math.min(1.2, len * sagPerTile);
    const mid: [number, number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2 - sag * 2, (A[2] + B[2]) / 2];
    const key = `power|${A.map((v) => v.toFixed(2)).join(',')}|${B.map((v) => v.toFixed(2)).join(',')}|${r}`;
    part(this.root, tube(key, bezier(A, mid, B, Math.max(6, Math.ceil(len))), r, { sides: 5 }), m, {});
  }
}
