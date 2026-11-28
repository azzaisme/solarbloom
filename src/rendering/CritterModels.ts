import * as pc from 'playcanvas';
import { clipsFor, loops, type VisitorPhase } from './VisitorClips';

/**
 * The animals that live about the world rather than visit (Fauna.ts: koi, lawn songbirds, rabbits, pigeons, ducks,
 * frogs, squirrels and sleeping cats; Butterflies.ts; the flocks in Birds.ts; the farm's creatures in CropVisuals.ts)
 * drawn with the same Tripo models as the
 * visitors (assets/raw/models/visitors/), plus four of their own (assets/raw/models/fauna/). Written out: a glob
 * can't be built from data, and only these go in the build (not the LOD or texture files beside them).
 */
const URLS = import.meta.glob(
  [
    '../../assets/raw/models/visitors/{bumblebee,butterfly,frog,golden-carp,hedgehog,koi,rainbow-minnow,songbird,squirrel,swallowtail}.glb',
    '../../assets/raw/models/fauna/{duck,pigeon,rabbit,sleeping-cat}.glb',
  ],
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

export const CRITTER_KINDS = ['bumblebee', 'butterfly', 'duck', 'frog', 'golden-carp', 'hedgehog', 'koi', 'pigeon', 'rabbit', 'rainbow-minnow', 'sleeping-cat', 'songbird', 'squirrel', 'swallowtail'] as const;
export type CritterKind = (typeof CRITTER_KINDS)[number];

export const critterUrl = (kind: CritterKind): string | undefined =>
  URLS[`../../assets/raw/models/visitors/${kind}.glb`] ?? URLS[`../../assets/raw/models/fauna/${kind}.glb`];

/**
 * How long each is in the world (its longest side, metres), as the visitors are sized (VISITOR_LOOK): the shared
 * ones match their visitor, so a songbird on the lawn is the size of one on Bloombot's shoulder.
 */
export const CRITTER_LENGTH: Record<CritterKind, number> = {
  bumblebee: 0.1,
  hedgehog: 0.26,
  butterfly: 0.12,
  swallowtail: 0.14,
  songbird: 0.24,
  frog: 0.13,
  squirrel: 0.31,
  koi: 0.17,
  'golden-carp': 0.16,
  'rainbow-minnow': 0.1,
  rabbit: 0.3,
  pigeon: 0.27,
  duck: 0.34,
  'sleeping-cat': 0.36,
};

/** One animal's model: `holder` goes under the animal's root (feet at its origin, facing +z). */
export interface Critter {
  holder: pc.Entity;
  entity: pc.Entity;
  clips: Record<VisitorPhase, string | undefined>;
  /** every clip it has, by name (a `fly` beside the visitors' four, for the flocks) */
  names: string[];
  /** the clip playing */
  clip?: string;
}

/** Plays a clip (by name or phase), blending over `blend` seconds; nothing if it is playing already or missing. */
export function playClip(c: Critter, want: VisitorPhase | string, blend = 0.2) {
  const name = (c.clips as Record<string, string | undefined>)[want] ?? (c.names.includes(want) ? want : undefined);
  const anim = c.entity.anim;
  if (!anim || !name || c.clip === name) return;
  c.clip = name;
  anim.baseLayer?.transition(name, blend);
}

/**
 * Loads each kind's model once and makes copies of it, fitted the way the visitors are: measured at the origin,
 * scaled so its longest side is its length, centred over its feet, with its clips ready to play. A copy that can't
 * load comes back undefined (the caller keeps its placeholder).
 */
export class CritterModels {
  private loads = new Map<CritterKind, Promise<pc.ContainerResource | undefined>>();

  constructor(private app: pc.AppBase) {}

  private container(kind: CritterKind): Promise<pc.ContainerResource | undefined> {
    let p = this.loads.get(kind);
    if (!p) {
      const url = critterUrl(kind);
      p = new Promise((done) => {
        if (!url) return done(undefined);
        this.app.assets.loadFromUrl(url, 'container', (err, asset) => done(err || !asset ? undefined : (asset.resource as pc.ContainerResource)));
      });
      this.loads.set(kind, p);
    }
    return p;
  }

  async make(kind: CritterKind, opts: { length?: number; shadows?: boolean; start?: VisitorPhase | string } = {}): Promise<Critter | undefined> {
    const res = await this.container(kind);
    if (!res) return undefined;
    const shadows = opts.shadows ?? true;
    const entity = res.instantiateRenderEntity({ castShadows: shadows, receiveShadows: shadows });
    const holder = new pc.Entity(`${kind}-model`);
    const fit = new pc.Entity('model-fit');
    fit.addChild(entity);
    holder.addChild(fit);
    const box = bounds(entity, fit);
    if (!box) {
      holder.destroy();
      return undefined;
    }
    const h = box.halfExtents;
    const s = (opts.length ?? CRITTER_LENGTH[kind]) / (2 * Math.max(h.x, h.y, h.z) || 1);
    fit.setLocalScale(s, s, s);
    fit.setLocalPosition(-box.center.x * s, -(box.center.y - h.y) * s, -box.center.z * s);
    const tracks = (res.animations ?? []).map((a) => a.resource as pc.AnimTrack);
    const names = tracks.map((t) => t.name);
    const clips = clipsFor(names);
    if (tracks.length) {
      entity.addComponent('anim', { activate: true });
      for (const t of tracks) entity.anim!.assignAnimation(t.name, t, undefined, 1, loops(t.name, clips));
    }
    const c: Critter = { holder, entity, clips, names };
    if (opts.start) playClip(c, opts.start, 0);
    return c;
  }
}

/** The model's bounds in `space` (its meshes' boxes, all together). */
function bounds(e: pc.Entity, space: pc.Entity): pc.BoundingBox | undefined {
  space.syncHierarchy();
  let box: pc.BoundingBox | undefined;
  for (const r of e.findComponents('render') as pc.RenderComponent[])
    for (const mi of r.meshInstances) {
      const b = mi.aabb;
      if (!box) box = new pc.BoundingBox(b.center.clone(), b.halfExtents.clone());
      else box.add(b);
    }
  return box;
}
