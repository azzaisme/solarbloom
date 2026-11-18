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
    const dewStem = mat(P.dewStem);
    const dewCap = mat(P.dewCap, { gloss: 0.6 });
    const dewDrop = mat(P.dewDrop, { emissive: P.dewDrop, emissiveIntensity: 0.6, gloss: 0.9 });
    const glass = mat(P.glass, { opacity: 0.75, gloss: 0.95 });
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
      } else if (def.kind === 'dewcap') {
        // a ring of pale mushrooms beaded with dew
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + rnd() * 0.4;
          const r = 0.12 + rnd() * 0.12;
          const h = 0.08 + rnd() * 0.1;
          add(root, 'cylinder', dewStem, [Math.cos(a) * r, h / 2, Math.sin(a) * r], [0.03, h, 0.03]);
          const c = 0.08 + rnd() * 0.05;
          add(root, 'sphere', dewCap, [Math.cos(a) * r, h, Math.sin(a) * r], [c * 1.6, c * 0.7, c * 1.6]);
          add(root, 'sphere', dewDrop, [Math.cos(a) * r + 0.02, h + c * 0.35, Math.sin(a) * r], [0.025, 0.025, 0.025]);
        }
      } else if (def.kind === 'driftglass') {
        // shards of old glass lying in the mist
        for (let i = 0; i < 4; i++) {
          const a = rnd() * Math.PI * 2;
          const r = rnd() * 0.2;
          const p = add(root, 'box', glass, [Math.cos(a) * r, 0.03, Math.sin(a) * r], [0.14 + rnd() * 0.08, 0.015, 0.1 + rnd() * 0.06]);
          p.setLocalEulerAngles((rnd() - 0.5) * 30, rnd() * 180, (rnd() - 0.5) * 30);
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
