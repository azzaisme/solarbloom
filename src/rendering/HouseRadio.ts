import * as pc from 'playcanvas';
import { PARK_SET } from '../data/oldcity';
import { mat, PALETTE } from './Materials';

/** E23.7.2.2: the radio stands against the house's front corner, by its door (inside the house's footprint). */
const SHED = PARK_SET.shed;

/**
 * E23.7.2.2 (#449): the forecast's radio: an old valve radio on a crate at the house's front corner, by the door, its dial glowing
 * warm. Interact listens to it (Game); this only draws it.
 */
export function buildRadio(parent: pc.Entity, groundY: (x: number, z: number) => number): pc.Entity {
  const x = SHED.x + SHED.size - 0.25;
  const z = SHED.z + SHED.size - 0.14;
  const root = new pc.Entity('house-radio');
  root.setPosition(x, groundY(x, z), z);
  root.setEulerAngles(0, 200, 0);
  const P = PALETTE.radio;
  const part = (type: 'box' | 'cylinder', material: pc.Material, pos: number[], scale: number[], rot: number[] = [0, 0, 0]) => {
    const e = new pc.Entity();
    e.addComponent('render', { type, material });
    e.setLocalPosition(pos[0], pos[1], pos[2]);
    e.setLocalEulerAngles(rot[0], rot[1], rot[2]);
    e.setLocalScale(scale[0], scale[1], scale[2]);
    root.addChild(e);
  };
  part('box', mat(P.crate), [0, 0.14, 0], [0.34, 0.28, 0.3]);
  part('box', mat(P.body, { gloss: 0.4 }), [0, 0.37, 0], [0.3, 0.18, 0.14]);
  part('cylinder', mat(P.grille), [-0.06, 0.37, 0.071], [0.1, 0.01, 0.1], [90, 0, 0]);
  part('cylinder', mat(P.dial, { emissive: P.dialGlow, emissiveIntensity: 1.6 }), [0.08, 0.39, 0.071], [0.06, 0.01, 0.06], [90, 0, 0]);
  part('cylinder', mat(P.grille, { metal: 0.7, gloss: 0.7 }), [0.09, 0.6, -0.02], [0.012, 0.32, 0.012], [0, 0, -18]);
  parent.addChild(root);
  return root;
}
