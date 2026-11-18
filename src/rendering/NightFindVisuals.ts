import * as pc from 'playcanvas';
import type { NightFindDef } from '../data/time';
import type { Sim } from '../gameplay/Sim';
import { mat, PALETTE } from './Materials';

/**
 * E23.7.1.3 (#447): the night finds on screen. A glowing plant is a small clump of luminous buds on stems; night
 * salvage is a few scraps catching a glint. Each fades in at dusk and out at dawn (or when taken), and pulses
 * gently. Presentation only: whether a find is out is the sim's (NightFinds).
 */
/** drawn larger than life so they read from the follow camera */
const SIZE = 1.8;

export class NightFindVisuals {
  private items: { def: NightFindDef; root: pc.Entity; a: number; phase: number }[] = [];
  private t = 0;
  reducedMotion = false;

  constructor(
    private sim: Sim,
    parent: pc.Entity,
    groundY: (x: number, z: number) => number,
  ) {
    const P = PALETTE.nightFind;
    const stem = mat(P.stem);
    const bud = mat(P.bud, { emissive: P.budGlow, emissiveIntensity: 3.2 });
    const metal = mat(P.scrap, { metal: 0.6, gloss: 0.7 });
    const glint = mat(P.glint, { emissive: P.glintGlow, emissiveIntensity: 3.5 });
    for (const def of sim.nightFinds.all()) {
      const root = new pc.Entity(`night-${def.id}`);
      const x = def.x + 0.5;
      const z = def.z + 0.5;
      root.setPosition(x, groundY(x, z), z);
      let seed = def.x * 31 + def.z * 17;
      const rnd = () => ((seed = (seed * 16807 + 11) % 2147483647) / 2147483647);
      if (def.kind === 'glowplant') {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + rnd();
          const r = 0.08 + rnd() * 0.16;
          const h = 0.22 + rnd() * 0.22;
          const s = add(root, 'cylinder', stem, [Math.cos(a) * r, h / 2, Math.sin(a) * r], [0.025, h, 0.025]);
          s.setLocalEulerAngles((rnd() - 0.5) * 20, 0, (rnd() - 0.5) * 20);
          const b = 0.07 + rnd() * 0.05;
          add(root, 'sphere', bud, [Math.cos(a) * r, h + b * 0.4, Math.sin(a) * r], [b, b * 1.2, b]);
        }
      } else {
        for (let i = 0; i < 4; i++) {
          const a = rnd() * Math.PI * 2;
          const r = rnd() * 0.22;
          const p = add(root, 'box', metal, [Math.cos(a) * r, 0.03, Math.sin(a) * r], [0.12 + rnd() * 0.1, 0.03, 0.08 + rnd() * 0.08]);
          p.setLocalEulerAngles(0, rnd() * 180, (rnd() - 0.5) * 15);
        }
        add(root, 'sphere', glint, [0.05, 0.09, -0.03], [0.06, 0.06, 0.06]);
      }
      root.setLocalScale(0.001, 0.001, 0.001);
      root.enabled = false;
      parent.addChild(root);
      this.items.push({ def, root, a: 0, phase: rnd() * Math.PI * 2 });
    }
  }

  update(dt: number) {
    this.t += dt;
    for (const it of this.items) {
      const out = this.sim.nightFinds.visible(it.def.id);
      it.a = Math.min(1, Math.max(0, it.a + (out ? dt : -dt) / 1.2));
      it.root.enabled = it.a > 0.001;
      if (!it.root.enabled) continue;
      const pulse = this.reducedMotion ? 1 : 1 + Math.sin(this.t * 1.7 + it.phase) * 0.06;
      const s = Math.max(0.001, it.a * pulse * SIZE);
      it.root.setLocalScale(s, s, s);
    }
  }
}

function add(parent: pc.Entity, type: 'box' | 'sphere' | 'cylinder', material: pc.Material, pos: number[], scale: number[]): pc.Entity {
  const e = new pc.Entity();
  e.addComponent('render', { type, material, castShadows: false });
  e.setLocalPosition(pos[0], pos[1], pos[2]);
  e.setLocalScale(scale[0], scale[1], scale[2]);
  parent.addChild(e);
  return e;
}
