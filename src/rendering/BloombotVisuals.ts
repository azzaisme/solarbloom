import { BLOOMBOT_EYE_HEIGHT } from '../data/botProps';
import { applyTurnLook, stepPhase, turnLook, type TurnLook } from './BotTurn';
import { MOVES, TURN_LOOK } from '../data/botMotion';
import { BotMoves, type MoveIn } from './BotMoves';
import * as pc from 'playcanvas';
import { color, PALETTE } from './Materials';
import { worldLightLayers } from './WaterSurface';
import { botParts, growthKey, type BotGrowth, type BotMat, type PartId, type PartPiece } from '../data/botParts';
import { BOT_CLIPS, REST, seatLift, seatRamp } from '../data/rest';
import { VISIT_POINTS, type Perch } from '../data/wildlife';
import { foldLegs, hipsAbove, SEAT_HIPS, swingShins, type SeatKind } from './SeatPose';
import { surfaceTriangles, skinnedVertices, vertexOnBones } from './SkinSurface';
import { inBox, type SeatBox } from './SeatBox';
import { ACT_EASE, ACTS, type ActEffect, type ActId } from '../data/botActs';
import { actPose, applyActPose, boneOf, emptyPose, turnBone } from './BotActs';
import { BotProp } from './BotProps';

/**
 * Bloombot (#234, G.10 + G.1): the player character, and the game's first skinned model. The GLB comes from
 * Meshy (generated, rigged, animated) and a Blender pass (assets/raw/bloombot/blender-pass.py); it holds one
 * skinned model in rigid robot pieces, a 24-bone rig and nine clips: idle, walk, hover, sit, meditate (loops), pulse,
 * assemble, interact, cheer (one-shots). Front is +Z, pivot at the feet, about 0.9 m tall.
 *
 * Until the model loads (or if it fails) a small stand-in capsule is drawn, so walking works from frame one.
 * Presentation only: nothing here touches the simulation.
 */
const MODEL_URL = new URL('../../assets/raw/bloombot/bloombot.glb', import.meta.url).href;
/** Visor faces (assets/tools/bloombot_faces.py): one row of frames, in FACES order. */
const FACES_URL = new URL('../../assets/raw/bloombot/bloombot-faces.png', import.meta.url).href;
export const FACES = ['happy', 'surprised', 'wink', 'blink'] as const;
export type BotFace = (typeof FACES)[number];
/** Model metres -> world units (1 tile = 1 m). A touch under a tile tall, like the mock beside a bench. */
const SCALE = 0.95;
/** the bones its shins and feet hang from (not its thighs, the UpLeg bones) */
const HANGING = /^(Left|Right)(Leg|Foot|ToeBase|Toe_End)/;
/**
 * Walk clip speed at which the feet match the ground: world units per second at anim speed 1. The toddler
 * waddle from the Blender pass (0.479 m/s, which it prints, times SCALE). Hover has no feet on the ground, so it
 * always plays at speed 1.
 */
const WALK_STRIDE = 0.455;
const BLEND = 0.18;
/** The visor's middle, from the feet (front is +z), in world units. */
const EYE = new pc.Vec3(0, BLOOMBOT_EYE_HEIGHT, 0.2);
/** Where the echo palms are while pulsing (model space, before SCALE): chest height, pushed forward. */
const PALM = new pc.Vec3(0.06, 0.46, 0.34);

export type { BotGrowth } from '../data/botParts';
interface GrowthPiece {
  e: pc.Entity;
  part: PartId;
  bone: string;
  /** where it sits from the bone, in Bloombot's own frame (x right, y up, z forward; world units) */
  at: pc.Vec3;
  /** its turn in Bloombot's frame */
  turn: pc.Quat;
}
/** Bloombot's own frame -> its bones, measured once from the idle pose (see placeGrowth) */
const GROWTH_BONES = ['head_end', 'Head', 'headfront', 'Spine02', 'neck', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'] as const;

export type BotLoop = 'idle' | 'walk' | 'hover' | 'sit' | 'meditate';
export type BotAction = 'pulse' | 'assemble' | 'interact' | 'cheer';
/** the one-shot clips into and out of sitting (oneShot) */
type SeatClip = typeof BOT_CLIPS.sitDown | typeof BOT_CLIPS.standUp;
const LOOPS: readonly string[] = ['idle', 'walk', 'hover', 'sit', 'meditate', 'doze'];

/** #628: a moment in an act for its effect: as it works ('tick') or as it finishes ('finish'), at `at` (world). */
export interface ActBeat {
  act: ActId;
  beat: 'tick' | 'finish';
  effect: ActEffect;
  at: pc.Vec3;
  /** Bloombot's own sideways and backward directions in the world (to throw an effect out where it shows) */
  side: pc.Vec3;
  back: pc.Vec3;
}

/** #629: how much bigger the turntable draws the ghost of a small piece than the piece itself */
const GHOST_BIGGER: Partial<Record<PartPiece['part'], number>> = { marks: 1.7, knacks: 1.9, lens: 1.4 };

export class BloombotVisuals {
  /** placed at bloombot's feet, turned to its facing */
  readonly root = new pc.Entity('bloombot');
  private model?: pc.Entity;
  private standIn?: pc.Entity;
  private asset?: pc.Asset;
  private clips = new Map<string, number>();
  private loop: BotLoop = 'idle';
  private action?: { name: BotAction | SeatClip; until: number; at?: number };
  private clock = 0;
  private destroyed = false;
  private faceMat?: pc.StandardMaterial;
  private face: BotFace = 'happy';
  private faceUntil = 0;
  private blinkAt = 3;
  reducedMotion = false;
  /** something is sitting in its lap: it keeps its legs still (they settle over a second or so) */
  lapFull = false;
  /**
   * While it sits: what it sits on (the bench's seat, the charger's pad) and what its back keeps out of (the
   * backrest), as boxes in their own frame (SeatBox: about `cx, cz`, turned by `facing` as the bench is). Bloombot settles onto the one and out of the other from its real skinned surface (settle()).
   */
  restingOn?: SeatBox;
  keepOutOf?: SeatBox;
  private settleUp = 0;
  private settleOut = 0;
  private wantUp = 0;
  private wantOut = 0;
  /**
   * How far along settling it is: a first quick look as it sits ('look'), easing there ('ease'), then watching a whole
   * breathing and leg-swing cycle holding still ('watch'), then still ('held').
   */
  private settling: 'look' | 'ease' | 'watch' | 'held' = 'look';
  private settleNext = 0;
  private settleUntil = 0;
  private settlePasses = 0;
  private needUp = -Infinity;
  private needOut = 0;
  private settledAt = 0;
  private posedAt = 0;
  /** when the clip into the pose last finished (its blend into the seated loop follows) */
  private clipDoneAt = -Infinity;
  private hanging?: Uint8Array;
  private measured: number[] = [];
  private legs = 1;
  private legsAt = 0;
  /** how far the left shin is swung now (degrees; the right one the other way), and the most it swings now */
  private swung = 0;
  private swingMost = 0;
  /** true once the real model is drawn */
  loaded = false;
  /** the model's holder (the seated poses move it) */
  private holder?: pc.Entity;
  /**
   * E23.2.3: a seated pose, played as its looping clip (assets/raw/bloombot/add-rest-clips.py): 'sit' on a bench
   * seat, thighs forward and shins down; 'meditate' cross-legged on the ground, hands by the knees, eyes closed.
   * The stand-in (before the model loads) just sits lower.
   */
  private pose?: 'sit' | 'meditate';
  /** E23.2.1: out of charge: bloombot droops a little and its walk slows (the low-power walk) */
  private tired = false;
  /** #620: the growth drawn now, its pieces, and each bone's turn in the idle pose (Bloombot's frame) */
  private growth: BotGrowth = { moves: [], levels: {}, park: 0 };
  private growthStamp = growthKey(this.growth);
  private pieces: GrowthPiece[] = [];
  private boneRest = new Map<string, pc.Quat>();
  /**
   * #628: the act under way: `held` loops until endAct; `ending` is when it began to ease out (it is drawn until
   * ACT_EASE.out after that); `ticks` counts the work effects so far.
   */
  private act?: { id: ActId; t: number; held: boolean; ending?: number; ticks: number };
  private actPoseNow = emptyPose();
  /** #628: what it holds while it acts (made when the act starts, gone when it ends) */
  private prop?: BotProp;
  /** #628: called for each act's effects (Game draws them with Vfx) */
  onBeat?: (b: ActBeat) => void;
  /** #670: the turn this frame (BotController sets it), the steps' phase, the lean as drawn, and the look worked out */
  private turnNow = { left: 0, vel: 0, speed: 0 };
  private stepAt = 0;
  private leanNow = 0;
  private turnLookNow: TurnLook = { headYaw: 0, twist: 0, stepL: 0, stepR: 0, lean: 0 };
  private turnAxes = { right: new pc.Vec3(), up: new pc.Vec3() };
  /** #671: the movement drawn with more life (BotMoves), what the controller tells it each frame, the run clip's layer */
  readonly moves = new BotMoves();
  /** Phase 8 A05: called on each foot plant of the walk (Game plays a footstep for the ground under it) */
  onFootfall?: () => void;
  private swingSign = 0;
  private moveIn: MoveIn = { pace: 0, accel: 0, walk: 2.6, run: 4.6, climb: 0, wading: false, still: 0, reduced: false };
  private runLayer?: pc.AnimComponentLayer;
  /** each foot's place along its front last frame (the clip's), to tell which one swings forward */
  private footWas = { l: 0, r: 0, ok: false };

  constructor(
    private app: pc.AppBase,
    parent: pc.Entity,
  ) {
    parent.addChild(this.root);
    this.buildStandIn();
    app.assets.loadFromUrl(MODEL_URL, 'container', (err, asset) => {
      if (this.destroyed) {
        asset?.unload();
        return;
      }
      if (err || !asset) {
        console.warn('Bloombot model failed to load; keeping the stand-in.', err);
        return;
      }
      this.asset = asset;
      this.attach(asset.resource as pc.ContainerResource);
    });
  }

  private buildStandIn() {
    const e = new pc.Entity('bloombot-standin');
    const m = new pc.StandardMaterial();
    m.diffuse = color(PALETTE.plastic.shell);
    m.update();
    e.addComponent('render', { type: 'capsule', material: m, castShadows: true });
    e.setLocalScale(0.45, 0.8, 0.45);
    e.setLocalPosition(0, 0.4, 0);
    this.root.addChild(e);
    this.standIn = e;
  }

  private attach(res: pc.ContainerResource) {
    // The glTF root is the rig's Armature node, which carries its own 0.01 (centimetre) scale: keep it and
    // scale a holder around it instead.
    const holder = new pc.Entity('bloombot-model');
    holder.setLocalScale(SCALE, SCALE, SCALE);
    this.holder = holder;
    const e = res.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
    holder.addChild(e);
    this.root.addChild(holder);
    this.addFace(holder, e);
    this.greenGlow(e);
    e.addComponent('anim', { activate: true });
    const anim = e.anim!;
    for (const a of res.animations) {
      const track = a.resource as pc.AnimTrack;
      const looped = LOOPS.includes(track.name);
      anim.assignAnimation(track.name, track, undefined, 1, looped);
      this.clips.set(track.name, track.duration);
      // #671: the run is the hover clip on a layer of its own over the walk, its weight set by speed (a blend)
      if (track.name === 'hover') {
        this.runLayer = anim.addLayer('run', 0);
        anim.assignAnimation('hover', track, 'run', 1, true);
        this.runLayer.transition('hover', 0);
      }
    }
    this.model = e;
    this.buildGrowth();
    this.standIn?.destroy();
    this.standIn = undefined;
    this.loaded = true;
    anim.baseLayer?.transition('idle', 0);
  }

  /**
   * #631: Bloombot's glowing trim (material `bloombot_glow`, the chest light, the ear lights, the seams) in its own
   * green rather than the model's cyan. One shared material for every part that glows.
   */
  private greenGlow(rig: pc.Entity) {
    let green: pc.StandardMaterial | undefined;
    for (const r of rig.findComponents('render') as pc.RenderComponent[])
      for (const mi of r.meshInstances) {
        const old = mi.material as pc.StandardMaterial;
        if (old?.name !== 'bloombot_glow') continue;
        if (!green) {
          green = old.clone();
          green.name = 'bloombot_glow_green';
          green.diffuse = color(PALETTE.botGlow);
          green.emissive = color(PALETTE.botGlow);
          green.update();
        }
        mi.material = green;
      }
  }

  /**
   * The visor face: the Blender pass cuts the visor out as its own part (material `bloombot_visor`, skinned to
   * the head) with flat front-on UVs, so the face sheet's frames lie on the real curved visor.
   */
  private addFace(_holder: pc.Entity, rig: pc.Entity) {
    const mi = rig.findComponents('render').flatMap((r) => (r as pc.RenderComponent).meshInstances).find((m) => m.material?.name === 'bloombot_visor');
    if (!mi) return;
    const m = new pc.StandardMaterial();
    m.name = 'bloombot_visor_face';
    m.diffuse.set(0, 0, 0);
    m.emissive.set(1, 1, 1);
    m.emissiveIntensity = 1.6;
    m.gloss = 0.85;
    m.emissiveMapTiling.set(1 / FACES.length, 1);
    m.update();
    mi.material = m;
    this.faceMat = m;
    this.app.assets.loadFromUrl(FACES_URL, 'texture', (err, asset) => {
      if (err || !asset || this.destroyed) return;
      const t = asset.resource as pc.Texture;
      t.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
      t.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
      m.emissiveMap = t;
      this.setFace(this.face);
    });
  }

  /** #620: sets what Bloombot has grown into (cheap to call every frame: it rebuilds only on a change). */
  private lantern?: pc.Entity;
  /**
   * #624 Lantern: Bloombot's own light at night. A real warm point light just above its head (no shadows, like the
   * lamp posts, E23.7.5), so the ground and anything near is lit from Bloombot and the light falls off with distance.
   * `reach` is how far it shines (tiles; 0: no light of its own), `dark` how dark the scene is (0 day … 1 night) and
   * `share` the scene's light share (the Power view dims it with everything else). It fades in with the dusk.
   */
  setLantern(reach: number, dark: number, share = 1, intensity = 0.55) {
    const on = reach > 0 && dark > 0.03;
    if (!on) {
      if (this.lantern) this.lantern.enabled = false;
      return;
    }
    if (!this.lantern) {
      const e = (this.lantern = new pc.Entity('bloombot-lantern'));
      e.addComponent('light', { type: 'omni', castShadows: false, falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED, affectSpecularity: false, color: color(PALETTE.light.lamps.warm), layers: worldLightLayers() });
      e.setLocalPosition(0, 1.05, 0.12);
      this.root.addChild(e);
    }
    this.lantern.enabled = true;
    // #627: it shines from the lamp's bulb on Bloombot's pack (else just above its head)
    const bulb = this.pieces.find((p) => p.e.name === 'grow-lamp-bulb');
    if (bulb) this.lantern.setPosition(bulb.e.getPosition());
    else this.lantern.setLocalPosition(0, 1.05, 0.12);
    const l = this.lantern.light!;
    l.range = reach + 1;
    l.intensity = intensity * Math.min(1, dark) * share;
  }

  /** #624: the Lantern's light now, for tests and the shots (undefined: none on). */
  get lanternLight(): { range: number; intensity: number } | undefined {
    const l = this.lantern;
    return l?.enabled && l.light ? { range: l.light.range, intensity: l.light.intensity } : undefined;
  }

  /** #627: the parts a growth lists (data/botParts), for the shots to check against what is drawn. */
  readonly partsFor = botParts;

  /** #627: what Bloombot has grown into (data/botParts); the parts are rebuilt only when it changes. */
  setGrowth(g: BotGrowth) {
    const k = growthKey(g);
    if (k === this.growthStamp) return;
    this.growthStamp = k;
    this.growth = { moves: [...g.moves], levels: { ...g.levels }, park: g.park, knacks: [...(g.knacks ?? [])] };
    this.buildGrowth();
  }

  /** The growth pieces drawn now, with the part each belongs to (tests and #629's turntable read them). */
  get growthPieces(): readonly { name: string; part: PartId }[] {
    return this.pieces.map((p) => ({ name: p.e.name, part: p.part }));
  }

  private solarMat?: pc.StandardMaterial;
  private tints = new Map<string, pc.Material>();
  /** #629: one of Bloombot's materials in another colour (a knack's bead in its Keeper's tint), made once per colour. */
  private tinted(m: BotMat, hex: string): pc.Material | undefined {
    const key = `${m}:${hex}`;
    let t = this.tints.get(key);
    if (!t) {
      const base = this.botMat(m) as pc.StandardMaterial | undefined;
      if (!base) return undefined;
      const c = base.clone();
      c.diffuse = color(hex);
      c.update();
      this.tints.set(key, (t = c));
    }
    return t;
  }

  /** One of Bloombot's own materials by short name (`bloombot_<name>`), or ours: the solar panel's dark blue glass. */
  private botMat(m: BotMat): pc.Material | undefined {
    if (m === 'solar') {
      if (!this.solarMat) {
        const s = (this.solarMat = new pc.StandardMaterial());
        s.name = 'bloombot_solar';
        s.diffuse = color(PALETTE.botSolar.diffuse);
        s.specular = color(PALETTE.botSolar.specular);
        s.gloss = 0.85;
        s.metalness = 0.3;
        s.useMetalness = true;
        s.emissive = color(PALETTE.botSolar.emissive);
        s.emissiveIntensity = 0.25;
        s.update();
      }
      return this.solarMat;
    }
    return this.material(`bloombot_${m}`);
  }

  private material(name: string): pc.Material | undefined {
    const mi = this.model?.findComponents('render').flatMap((r) => (r as pc.RenderComponent).meshInstances).find((m) => m.material?.name === name);
    return mi?.material ?? undefined;
  }

  // ───────── #629: the page's turntable ─────────
  /** the turntable's layer while it shows Bloombot (every mesh and part is drawn on it too) */
  private ttLayer?: number;
  /** what the turntable has in focus: the part that glows, and its next level as a ghost */
  private hi?: { part?: PartId; name?: string; ghost: PartPiece[]; layer: number };
  private hiMats: { mi: pc.MeshInstance; was: pc.Material }[] = [];
  private ghosts: GrowthPiece[] = [];
  private ghostMat?: pc.StandardMaterial;

  /** Draws Bloombot (its model and every part) on the turntable's layer too, or stops. */
  showOnLayer(layer: number, on: boolean) {
    this.ttLayer = on ? layer : undefined;
    const set = (e: pc.Entity) => {
      for (const r of e.findComponents('render') as pc.RenderComponent[]) {
        const has = r.layers.includes(layer);
        if (on && !has) r.layers = [...r.layers, layer];
        if (!on && has) r.layers = r.layers.filter((l) => l !== layer);
      }
    };
    if (this.model) set(this.model);
    for (const p of this.pieces) set(p.e);
    if (!on) this.highlight(undefined, undefined, [], layer);
  }

  /**
   * The turntable's focus: the pieces of `part` (only the one named `name`, for a move's mark or a knack) glow softly,
   * and `ghost` (what the next level adds) is drawn see-through on the turntable's layer alone.
   */
  highlight(part: PartId | undefined, name: string | undefined, ghost: PartPiece[], layer: number) {
    this.hi = part || ghost.length ? { part, name, ghost, layer } : undefined;
    this.applyHighlight();
  }

  private applyHighlight() {
    for (const h of this.hiMats) h.mi.material = h.was;
    this.hiMats = [];
    for (const g of this.ghosts) g.e.destroy();
    this.ghosts = [];
    const hi = this.hi;
    if (!hi || !this.model) return;
    for (const p of this.pieces) {
      if (p.part !== hi.part || (hi.name && !p.e.name.endsWith(`-${hi.name}`) && (hi.part === 'marks' || hi.part === 'knacks'))) continue;
      const mi = p.e.render?.meshInstances[0];
      if (!mi?.material) continue;
      const m = (mi.material as pc.StandardMaterial).clone();
      m.emissive = color(PALETTE.botGlowFocus);
      m.emissiveIntensity = 1;
      m.update();
      this.hiMats.push({ mi, was: mi.material });
      mi.material = m;
    }
    if (hi.ghost.length) {
      if (!this.ghostMat) {
        const g = (this.ghostMat = new pc.StandardMaterial());
        g.name = 'bloombot_ghost';
        g.diffuse = color(PALETTE.botGhost);
        g.emissive = color(PALETTE.botGhost);
        g.emissiveIntensity = 0.9;
        g.opacity = 0.6;
        g.blendType = pc.BLEND_NORMAL;
        g.depthWrite = false;
        g.update();
      }
      for (const d of hi.ghost) {
        const e = new pc.Entity(`ghost-${d.name}`);
        e.addComponent('render', { type: d.shape, material: this.ghostMat, castShadows: false, layers: [hi.layer] });
        // the smallest pieces (a move's mark, a knack's bead, the lens) show a little bigger as ghosts, to catch the eye
        const k = GHOST_BIGGER[d.part] ?? 1;
        e.setLocalScale(d.scale[0] * k, d.scale[1] * k, d.scale[2] * k);
        this.root.addChild(e);
        this.ghosts.push({ e, part: d.part, bone: d.bone, at: new pc.Vec3(...d.at), turn: new pc.Quat().setFromEulerAngles(d.euler[0], d.euler[1], d.euler[2]) });
      }
    }
    this.placeGrowth();
  }

  /** The turntable's breath, 0 to 1: the glow brightens and the ghost firms up and fades. */
  pulseHighlight(k: number) {
    for (const h of this.hiMats) {
      const m = h.mi.material as pc.StandardMaterial;
      m.emissiveIntensity = 0.7 + 0.9 * k;
      m.update();
    }
    if (this.ghostMat && this.ghosts.length) {
      this.ghostMat.opacity = 0.55 + 0.4 * k;
      this.ghostMat.emissiveIntensity = 0.9 + 0.6 * k;
      this.ghostMat.update();
    }
  }

  /** What the turntable shows in focus now (tests and the shots read it). */
  get focusView(): { glowing: string[]; ghosts: string[] } {
    return { glowing: this.hiMats.map((h) => h.mi.node.name), ghosts: this.ghosts.map((g) => g.e.name) };
  }

  /** #627: every part (data/botParts) as a small piece riding its bone, in Bloombot's own materials. */
  private buildGrowth() {
    for (const p of this.pieces) p.e.destroy();
    this.pieces = [];
    if (!this.model) return;
    for (const d of botParts(this.growth)) {
      const e = new pc.Entity(d.name);
      e.addComponent('render', { type: d.shape, material: d.tint ? this.tinted(d.mat, d.tint) : this.botMat(d.mat), castShadows: d.scale[0] > 0.02 || d.scale[1] > 0.02 });
      e.setLocalScale(d.scale[0], d.scale[1], d.scale[2]);
      this.root.addChild(e);
      if (this.ttLayer !== undefined) e.render!.layers = [...e.render!.layers, this.ttLayer];
      this.pieces.push({ e, part: d.part, bone: d.bone, at: new pc.Vec3(...d.at), turn: new pc.Quat().setFromEulerAngles(d.euler[0], d.euler[1], d.euler[2]) });
    }
    this.hiMats = []; // their pieces are gone
    this.applyHighlight();
    this.placeGrowth();
  }

  private growTmp = new pc.Vec3();
  private growQ = new pc.Quat();
  private growQ2 = new pc.Quat();
  /**
   * Each piece rides its bone: where the bone is, turned as the bone has turned since the idle pose (so the pack's
   * cells sway with the pack and the leaves nod with the head), in Bloombot's frame.
   */
  private placeGrowth() {
    if (!this.model) return;
    const root = this.root.getRotation();
    // the first frame after loading is the idle pose: measure each bone's turn then, pieces or not
    if (!this.boneRest.size)
      for (const b of GROWTH_BONES) {
        const bone = this.model.findByName(b);
        this.bones.set(b, bone);
        if (bone) this.boneRest.set(b, new pc.Quat().copy(root).invert().mul(bone.getRotation()));
      }
    if (!this.pieces.length && !this.ghosts.length) return;
    const leaves = this.moves.look.leaves;
    const trail = leaves > 0.01 ? new pc.Quat().setFromAxisAngle(this.root.right, -leaves) : undefined;
    for (const p of this.ghosts.length ? [...this.pieces, ...this.ghosts] : this.pieces) {
      if (!this.bones.has(p.bone)) this.bones.set(p.bone, this.model.findByName(p.bone));
      const bone = this.bones.get(p.bone);
      // the bone's turn now, against the idle pose it had when first seen (both in Bloombot's frame)
      let rest = this.boneRest.get(p.bone);
      const turn = this.growQ.copy(root).invert();
      if (bone) turn.mul(bone.getRotation());
      if (!rest) {
        rest = turn.clone();
        this.boneRest.set(p.bone, rest);
      }
      const delta = this.growQ2.copy(turn).mul(rest.clone().invert());
      const q = new pc.Quat().copy(root).mul(delta);
      // #671: running, the leaves (and a bud) stream back from where they grow
      if (trail && (p.part === 'leaves' || p.part === 'bud')) q.copy(trail.clone().mul(q));
      q.transformVector(p.at, this.growTmp);
      const base = bone ? bone.getPosition() : this.root.getPosition();
      p.e.setPosition(base.x + this.growTmp.x, base.y + this.growTmp.y, base.z + this.growTmp.z);
      p.e.setRotation(q.mul(p.turn));
    }
  }

  /** Shows a visor face, for `seconds` (then back to happy), or until changed. */
  setFace(face: BotFace, seconds = 0) {
    this.face = face;
    this.faceUntil = seconds ? this.clock + seconds : 0;
    const m = this.faceMat;
    if (!m) return;
    m.emissiveMapOffset.set(FACES.indexOf(face) / FACES.length, 0);
    m.update();
  }

  /** E19: where bloombot's eyes are (world): the build hologram is projected from here. */
  eyeWorld(out: pc.Vec3): pc.Vec3 {
    return this.root.getWorldTransform().transformPoint(EYE, out);
  }

  /** Where bloombot's palms are mid-pulse (world): the pulse rings leave from here. */
  palmWorld(out: pc.Vec3): pc.Vec3 {
    return this.root.getWorldTransform().transformPoint(PALM, out);
  }

  /**
   * #671: how it moves this frame (BotController): its speed and how fast that changes, the walk and run speeds, the
   * slope, wading, and how long it has stood with no play input.
   */
  setMove(m: Omit<MoveIn, 'reduced'>) {
    Object.assign(this.moveIn, m);
  }

  /** #671: landed from a hover, climb or glide (`size` 1), or stepped off a lift (smaller). */
  land(size = 1) {
    this.moves.land(size);
  }

  /** #671: walked into a wall: a small recoil (not again while it holds into it). True when it recoiled. */
  bump(): boolean {
    const did = this.moves.bump();
    if (did && !this.reducedMotion) this.setFace('surprised', 0.45);
    return did;
  }

  /**
   * #670: the turn under way: how far it still has to turn (radians, + toward its left), how fast it turns (radians a
   * second) and how fast it moves (cells a second). Drawn in `update`: the head leading, steps on the spot, a lean.
   */
  setTurn(left: number, vel: number, speed: number) {
    this.turnNow.left = left;
    this.turnNow.vel = vel;
    this.turnNow.speed = speed;
  }

  /** #670: the turn as drawn now (tests). */
  get turnLook(): Readonly<TurnLook> {
    return this.turnLookNow;
  }

  /**
   * #670 / #671: draws the turn and the movement over the clip (after any act, which keeps the bones while it plays;
   * not while seated: the seat poses hold it still). The whole model leans into a curve and rolls with a wade or a
   * shake; the bones take the lean, the arms, the steps and the idle moments; then the model sinks so bent knees keep
   * the feet down, rising for a hop, back for a recoil.
   */
  private drawBody(dt: number) {
    const t = this.turnNow;
    this.stepAt = stepPhase(this.stepAt, t.vel * dt);
    const look = turnLook(t.left, t.vel, t.speed, this.stepAt, this.reducedMotion, this.turnLookNow);
    // the lean settles toward its goal rather than flicking with every change of turn
    this.leanNow += (look.lean - this.leanNow) * Math.min(1, dt * TURN_LOOK.leanEase);
    this.moveIn.reduced = this.reducedMotion;
    // no idle moments over an act, a one-shot clip or a seat
    if (this.act || this.action || this.pose) this.moveIn.still = 0;
    const mv = this.moves.update(dt, this.moveIn);
    if (this.runLayer) this.runLayer.weight = !this.pose && !this.action && this.loop === 'walk' ? mv.run : 0;
    if (this.pose) return;
    // leaning toward its left is a roll about its front (local +z) by a negative angle
    const roll = -this.leanNow - mv.roll;
    this.holder?.setLocalEulerAngles(this.tired ? 9 : 0, 0, roll);
    this.standIn?.setLocalEulerAngles(this.tired ? 9 : 0, 0, roll);
    this.standIn?.setLocalPosition(0, 0.4 + mv.up, -mv.back);
    if (!this.model || this.act) return;
    const holder = this.holder;
    holder?.setLocalPosition(0, 0, 0);
    const before = this.feetHeight();
    // which foot swings forward (as the clip has it), to lift it higher on a slope or wading
    const front = this.frontTmp.copy(this.root.forward).mulScalar(-1);
    const root = this.root.getPosition();
    const lf = boneOf(this.model, 'LeftFoot');
    const rf = boneOf(this.model, 'RightFoot');
    let swingL = 0;
    let swingR = 0;
    if (lf && rf && dt > 0) {
      const zl = this.footTmp.copy(lf.getPosition()).sub(root).dot(front);
      const zr = this.footTmp.copy(rf.getPosition()).sub(root).dot(front);
      if (this.footWas.ok) {
        const d = (zl - this.footWas.l - (zr - this.footWas.r)) / dt;
        swingL = smooth(d / 0.6);
        swingR = smooth(-d / 0.6);
        // Phase 8 A05: a foot plants when the feet stop swinging apart (the swing changes sign), walking only
        const sign = d > 0.25 ? 1 : d < -0.25 ? -1 : 0;
        if (sign && sign !== this.swingSign) {
          if (this.swingSign && this.loop === 'walk' && !this.act && this.moveIn.pace > 0.3) this.onFootfall?.();
          this.swingSign = sign;
        }
      }
      this.footWas = { l: zl, r: zr, ok: true };
    }
    applyActPose(this.model, this.root, mv.body, 1);
    if (mv.armW > 0) applyActPose(this.model, this.root, mv.arms, mv.armW);
    if (mv.swingLift > 0) {
      const right = this.turnAxes.right.copy(this.root.right);
      for (const [side, k] of [
        ['Left', swingL],
        ['Right', swingR],
      ] as const) {
        const lift = mv.swingLift * k;
        if (lift <= 0) continue;
        turnBone(boneOf(this.model, `${side}UpLeg`), right, -lift);
        turnBone(boneOf(this.model, `${side}Leg`), right, lift * 1.6);
        turnBone(boneOf(this.model, `${side}Foot`), right, -lift * 0.6);
      }
    }
    applyTurnLook(this.model, this.root, look, this.turnAxes);
    const sink = mv.body.knee > 0 ? this.feetHeight() - before : 0;
    // standing up off a bench: still on the seat until the stand-up clip's hips rise (seatShare)
    const on = this.rise ? this.seatShare : 0;
    if (this.rise && !on) this.rise = undefined;
    holder?.setLocalPosition(0, -sink + mv.up + (this.rise?.y ?? 0) * on, -mv.back + (this.rise?.z ?? 0) * on);
  }
  private frontTmp = new pc.Vec3();
  private footTmp = new pc.Vec3();

  /** Places bloombot (feet) and turns it to face `facing` (radians, 0 = +z). */
  place(x: number, y: number, z: number, facing: number) {
    this.root.setPosition(x, y, z);
    this.root.setEulerAngles(0, (facing * 180) / Math.PI, 0);
  }

  /** the bench seat's height while sitting on one (world units) */
  private seat = 0;
  /** standing up off a bench: the model's offset on the seat as it rose (it comes down off the seat with its hips) */
  private rise?: { y: number; z: number };

  /**
   * How far onto the seat bloombot is drawn now: 0 standing on the ground in front of it, 1 sitting on it (REST.onto).
   * Sitting down it stays 0 while the sit-down clip turns it round and only comes up to 1 as the clip's hips come
   * down; standing up it goes back to 0 as the stand-up clip's hips rise. Without the clips (the stand-in) it is 1
   * as soon as it sits and 0 as soon as it stands.
   */
  get seatShare(): number {
    const a = this.action;
    const k = REST.onto;
    if (this.pose === 'sit') return a?.name === BOT_CLIPS.sitDown && a.at !== undefined ? seatRamp(this.clock - a.at, k.down) : 1;
    if (this.pose) return 1;
    return this.rise && a?.name === BOT_CLIPS.standUp && a.at !== undefined ? 1 - seatRamp(this.clock - a.at, k.up) : 0;
  }

  /**
   * E23.2.3: sit on a bench (`seat`: its height), meditate at a charger, or stand (undefined). Plays the clip into
   * the pose (sit down, stand up) where the model has it.
   */
  setPose(pose: 'sit' | 'meditate' | undefined, seat = 0) {
    const was = this.pose;
    // #628: no act on a seat
    if (pose) {
      this.act = undefined;
      this.prop?.destroy();
      this.prop = undefined;
    }
    // standing up off a bench: the model comes down off the seat as the stand-up clip rises (seatShare)
    this.rise = !pose && was === 'sit' && this.holder ? { y: this.holder.getLocalPosition().y, z: this.holder.getLocalPosition().z } : undefined;
    this.pose = pose;
    this.seat = seat;
    if (pose !== was) {
      // where it has always settled to on a bench with its sit clip (REST.settle.bench); the looks fine-tune it
      const from = pose === 'sit' && this.clips.has(BOT_CLIPS.sit) ? REST.settle.bench : undefined;
      this.settleUp = this.wantUp = from?.up ?? 0;
      this.settleOut = this.wantOut = from?.out ?? 0;
      this.settling = 'look';
      this.settlePasses = 0;
      this.posedAt = this.clock;
    }
    if (pose === 'meditate') this.setFace('blink', 1e9);
    else if (this.face === 'blink') this.setFace('happy');
    // #576: sitting again before it has finished standing up: straight into the new pose, not the rest of the
    // stand-up (6 s of it, played under the meditating pose, and holding off its settle)
    if (pose && this.action?.name === BOT_CLIPS.standUp) {
      this.action = undefined;
      if (this.clips.has(pose)) {
        this.model?.anim?.baseLayer?.transition(pose, BLEND);
        this.loop = pose;
      }
    }
    if (pose === 'sit' && this.clips.has(BOT_CLIPS.sitDown)) this.oneShot(BOT_CLIPS.sitDown);
    if (!pose && was === 'sit' && this.clips.has(BOT_CLIPS.standUp)) this.oneShot(BOT_CLIPS.standUp);
    if (!pose) {
      this.holder?.setLocalPosition(0, 0, 0);
      this.holder?.setLocalEulerAngles(this.tired ? 9 : 0, 0, 0);
      this.standIn?.setLocalPosition(0, 0.4, 0);
    }
  }

  private bones = new Map<string, pc.GraphNode | null>();
  private pointTmp = new pc.Vec3();

  /**
   * E23.2.4.2: where a visitor settles on or beside bloombot, in world space. Perches on bloombot ride its rig
   * (the head, the shoulders, the hips for the lap, a forearm), so they follow the sitting and meditating poses;
   * the stand-in uses fixed offsets from bloombot's feet. Offsets turn with bloombot's facing.
   */
  visitPoint(p: Perch, out: pc.Vec3): pc.Vec3 {
    const vp = VISIT_POINTS[p];
    let bone: pc.GraphNode | null = null;
    if (vp.bone && this.model) {
      if (!this.bones.has(vp.bone)) this.bones.set(vp.bone, this.model.findByName(vp.bone));
      bone = this.bones.get(vp.bone) ?? null;
    }
    const o = bone ? vp.offset : vp.fallback;
    this.root.getRotation().transformVector(this.pointTmp.set(o[0], o[1], o[2]), this.pointTmp);
    return out.copy(bone ? bone.getPosition() : this.root.getPosition()).add(this.pointTmp);
  }

  private surfaceAt = -1;
  private surfacePts: number[] = [];
  private cornerPts: number[] = [];

  /**
   * E23.2.4: bloombot's surface as drawn right now (SkinSurface: its triangles, skinned on the CPU, 9 numbers each in
   * world space), for visitors to rest on. Read at most once a frame; empty until the model has loaded.
   */
  surface(): readonly number[] {
    if (!this.model) return [];
    if (this.surfaceAt !== this.clock) {
      this.surfaceAt = this.clock;
      this.surfacePts.length = 0;
      this.cornerPts.length = 0;
      surfaceTriangles(this.model, this.surfacePts, this.cornerPts);
    }
    return this.surfacePts;
  }
  /** Its vertices as drawn right now (each once, x, y, z triples), from the same skinning as surface(). */
  corners(): readonly number[] {
    this.surface();
    return this.cornerPts;
  }

  private rig?: readonly pc.GraphNode[];
  /** The bones its skin hangs from (an animal resting on it rides the one nearest where it touches). */
  skinBones(): readonly pc.GraphNode[] {
    if (!this.model) return [];
    if (!this.rig) {
      const all = new Set<pc.GraphNode>();
      for (const r of this.model.findComponents('render') as pc.RenderComponent[]) for (const mi of r.meshInstances) for (const b of mi.skinInstance?.bones ?? []) all.add(b);
      this.rig = [...all];
    }
    return this.rig;
  }


  /** A one-shot clip by name (the sitting transitions), back to the loop afterwards. */
  private oneShot(name: SeatClip) {
    const anim = this.model?.anim;
    const len = this.clips.get(name);
    if (!anim || !len) return;
    anim.speed = 1;
    anim.baseLayer?.transition(name, 0.12);
    this.action = { name, until: this.clock + len * 0.95, at: this.clock };
  }

  private posed() {
    const h = this.holder;
    const clip = (n: string) => this.clips.has(n);
    if (this.pose === 'sit') {
      // with the sit clip the hips come down to the seat's height; without it (the model has no sitting clips yet,
      // #482) the legs are bent by hand: thighs along the seat, shins hanging, the hips resting on the seat
      // bend and swing the legs first: it settles onto the seat as drawn (the clip alone has it standing)
      const y = clip(BOT_CLIPS.sit) ? seatLift(this.seat, SCALE) : this.fold('sit') + this.seat;
      this.swingLegs();
      this.settle();
      // up onto the seat (and back onto it) only as the sit-down clip's hips come down (seatShare)
      const on = this.seatShare;
      h?.setLocalPosition(0, (y + this.settleUp) * on, (-0.12 + this.settleOut) * on);
      h?.setLocalEulerAngles(0, 0, 0);
      this.standIn?.setLocalPosition(0, 0.4 + this.seat, -0.1);
    } else if (this.pose === 'meditate') {
      // the clip sits cross-legged on the ground; without it the legs are crossed by hand, settled low, breathing
      const breathe = this.reducedMotion ? 0 : Math.sin(this.clock * 1.6) * 0.012;
      const y = clip(BOT_CLIPS.meditate) ? 0 : this.fold('meditate') + breathe;
      this.settle();
      h?.setLocalPosition(0, y + this.settleUp, 0);
      h?.setLocalEulerAngles(0, 0, 0);
      this.standIn?.setLocalPosition(0, 0.26, 0);
    }
    const anim = this.model?.anim;
    if (anim && !this.action) anim.speed = this.pose === 'meditate' ? 0.6 : 0.8; // slow, calm breathing
  }

  /**
   * Sitting: settles onto what it sits on from its real skinned surface as drawn (after the legs are bent and swung;
   * REST.settle). A first look as soon as it has bent into the pose brings it roughly there. Then, holding still, it
   * watches a whole breathing and leg-swing cycle and takes the most it needs to come up (and forward) across it,
   * so its underside never dips into the seat or pad between looks and the breathing stays smooth; once that needs
   * no more than a hair, it holds. Not while a clip into the pose plays.
   */
  private settle() {
    const k = REST.settle;
    if (!this.model || !this.restingOn) {
      this.settleUp = this.wantUp = 0;
      this.settleOut = this.wantOut = 0;
      return;
    }
    const dt = Math.min(0.1, Math.max(0, this.clock - this.settledAt));
    this.settledAt = this.clock;
    const ease = Math.min(1, dt * k.ease);
    this.settleUp += (this.wantUp - this.settleUp) * ease;
    this.settleOut += (this.wantOut - this.settleOut) * ease;
    // not while it is still getting into the pose (its legs straight down under it as it bends)
    // nor while it blends from the end of the sit-down clip into the seated loop: the clip ends with its hips 7 cm
    // further back than the loop has them, and a look then would bring it that much too far forward for good
    if (this.action || this.clock - Math.max(this.posedAt, this.clipDoneAt + BLEND) < k.after) return;
    if (this.settling === 'look') {
      const m = this.measure();
      this.aim(m.up, m.out);
    } else if (this.settling === 'ease' && this.clock >= this.settleUntil) {
      // there: hold still while it watches a cycle
      this.settleUp = this.wantUp;
      this.settleOut = this.wantOut;
      this.settling = 'watch';
      this.settleNext = this.clock;
      this.settleUntil = this.clock + k.cycle;
      this.needUp = -Infinity;
      this.needOut = 0;
    } else if (this.settling === 'watch' && this.clock >= this.settleNext) {
      const m = this.measure();
      this.needUp = Math.max(this.needUp, m.up);
      this.needOut = Math.max(this.needOut, m.out);
      this.settleNext = this.clock + k.watchEvery;
      if (this.clock >= this.settleUntil) {
        this.settlePasses++;
        const up = Number.isFinite(this.needUp) ? this.needUp : 0;
        const done = (Math.abs(up) <= k.hair && this.needOut <= k.hair) || this.settlePasses >= k.passes;
        this.aim(up, this.needOut);
        if (done) this.settling = 'held';
      }
    }
  }

  /** Eases toward `up` and `out` more than it is now (within REST.settle.most), and looks again once there. */
  private aim(up: number, out: number) {
    const k = REST.settle;
    const clamp = (v: number) => Math.max(-k.most, Math.min(k.most, v));
    this.wantUp = clamp(this.settleUp + up);
    this.wantOut = clamp(this.settleOut + out);
    this.settling = 'ease';
    this.settleUntil = this.clock + k.easeFor;
  }

  /**
   * One look at itself as drawn now: how far it must come up for its lowest point over the seat (or pad) to rest on
   * the top (down if negative; its shins and feet don't count on a bench, they hang over the front edge), and how far
   * forward for nothing of its back to be in the backrest and no shin in the seat's slab.
   */
  private measure(): { up: number; out: number } {
    // #576: on a bench, at both ends of its liveliest leg swing too (the knees right at the seat's front lip dip into
    // it as the shins swing; a look at the swing as it happens to be could miss that, and it would settle too far back)
    const most = this.pose === 'sit' && this.model && !this.reducedMotion ? this.swingMost : 0;
    if (!most) return this.measureNow();
    const m = this.measureNow();
    for (const to of [most, -most]) {
      const by = to - this.swung;
      swingShins(this.model!, this.root, by, -by);
      const n = this.measureNow();
      swingShins(this.model!, this.root, -by, by); // (back as drawn: the same turn about the same axis, undone)
      m.up = Math.max(m.up, n.up);
      m.out = Math.max(m.out, n.out);
    }
    return m;
  }

  /** One look at itself exactly as drawn now (measure). */
  private measureNow(): { up: number; out: number } {
    const k = REST.settle;
    const pts = this.measured;
    pts.length = 0;
    skinnedVertices(this.model!, pts);
    const hang = this.pose === 'sit' ? (this.hanging ??= vertexOnBones(this.model!, (n) => HANGING.test(n), k.hangShare)) : undefined;
    const s = this.restingOn!;
    const b = this.keepOutOf;
    let low = Infinity;
    let out = 0;
    for (let v = 0, i = 0; i < pts.length; v++, i += 3) {
      const y = pts[i + 1];
      const w = inBox(s, pts[i], pts[i + 2]);
      if (w !== undefined && !hang?.[v]) low = Math.min(low, y);
      else if (w !== undefined && y > s.y[0] && y < s.y[1] - k.gap) out = Math.max(out, s.z[1] - w + k.gap); // a shin in the seat's slab (under it is open)
      if (b && y > b.y[0] && y < b.y[1]) {
        const bw = inBox(b, pts[i], pts[i + 2]);
        if (bw !== undefined) out = Math.max(out, b.z[1] - bw + k.gap);
      }
    }
    return { up: Number.isFinite(low) ? s.y[1] + k.gap - low : 0, out };
  }

  /**
   * On a bench: its little legs swing, one forward as the other goes back, now livelier, now nearly still; and still
   * while something sits in its lap (a frog on its knees).
   */
  private swingLegs() {
    if (!this.model) return;
    const s = REST.legSwing;
    // legs out over the seat's edge (REST.legSwing), raised as it comes onto the seat
    const lift = s.lift * this.seatShare;
    if (this.reducedMotion) {
      swingShins(this.model, this.root, lift, lift);
      this.swung = 0;
      this.swingMost = 0;
      return;
    }
    const dt = Math.min(0.1, Math.max(0, this.clock - this.legsAt));
    this.legsAt = this.clock;
    this.legs += ((this.lapFull ? 0 : 1) - this.legs) * Math.min(1, dt * s.settle);
    const drift = 0.5 - 0.5 * Math.cos((this.clock * Math.PI * 2) / s.driftSeconds);
    const deg = this.legs * s.degrees * (s.calmest + (1 - s.calmest) * drift) * Math.sin(this.clock * Math.PI * 2 * s.perSecond);
    swingShins(this.model, this.root, lift + deg, lift - deg);
    this.swung = deg;
    this.swingMost = this.legs * s.degrees;
  }

  /**
   * E23.2.3: the seated poses without their clips: bends the legs of the idle pose by hand (SeatPose), every frame
   * after the animation has run. Returns how far to move the model so the hips rest on the seat (or the ground).
   */
  private fold(kind: SeatKind): number {
    const rig = this.model;
    const holder = this.holder;
    if (!rig || !holder || !foldLegs(rig, this.root, kind)) return kind === 'sit' ? 0 : -0.14;
    return SEAT_HIPS[kind] - hipsAbove(rig, holder);
  }

  /** E23.2.1: out of charge (or not): a tired droop, head and shoulders forward. */
  setTired(on: boolean) {
    if (on === this.tired) return;
    this.tired = on;
    this.holder?.setLocalEulerAngles(on ? 9 : 0, 0, 0);
    this.standIn?.setLocalEulerAngles(on ? 9 : 0, 0, 0);
  }

  /**
   * The looping clip, from how fast bloombot moves (world units per second) and whether it hovers (a hover or glide
   * across: running blends the run in by speed instead, see setMove).
   */
  setMotion(speed: number, hovering: boolean) {
    const want: BotLoop = this.pose && this.clips.has(this.pose) ? this.pose : speed < 0.05 ? 'idle' : hovering ? 'hover' : 'walk';
    const anim = this.model?.anim;
    if (!anim) return;
    // #628: walking off ends a one-press act (a held one ends when the hold does)
    if (this.act && !this.act.held && this.act.ending === undefined && speed > 0.3) this.act.ending = this.act.t;
    if (!this.action) {
      if (want !== this.loop) anim.baseLayer?.transition(want, BLEND);
      // #671: the walk's step matches its speed (slower and careful wading); running, the run clip's own quicker step
      const look = this.moves.look;
      const walkStep = pc.math.clamp(speed / WALK_STRIDE, 0.5, 1.8) * (1 + (MOVES.wade.clipSpeed - 1) * look.wade);
      anim.speed = want === 'walk' ? walkStep + (MOVES.run.clipSpeed - walkStep) * look.run : 1;
    }
    this.loop = want;
  }

  /** Plays a one-shot clip, then blends back to the current loop. Returns its length in seconds (0 if none). */
  play(name: BotAction): number {
    const anim = this.model?.anim;
    const len = this.clips.get(name);
    if (!anim || !len) return 0;
    if (this.reducedMotion && name === 'cheer') return 0;
    if (this.pose) return 0; // sitting or meditating: no standing gestures (a cheer would pop it up off the seat)
    if (this.act && !this.act.ending) this.act.ending = this.act.t;
    anim.speed = name === 'pulse' ? 1.6 : name === 'assemble' ? 1.2 : 1;
    anim.baseLayer?.transition(name, 0.1);
    const dur = len / anim.speed;
    if (name === 'cheer') this.setFace('wink', dur);
    else if (name === 'interact') this.setFace('surprised', Math.min(dur, 0.9));
    this.action = { name, until: this.clock + dur * 0.92 };
    return dur;
  }

  /** Sitting or meditating, and settled onto what it sits on (REST.settle: its looks are done; tests). */
  get settled(): boolean {
    return !!this.pose && this.settling === 'held';
  }

  get busy(): BotAction | SeatClip | undefined {
    return this.action?.name;
  }

  /**
   * #628: starts an act. `held` loops it until endAct (a hold on Interact); otherwise it plays for its `once` seconds
   * and finishes by itself. A one-press act never cuts into a held one, and nothing acts while seated.
   */
  startAct(id: ActId, held = false) {
    if (this.pose) return;
    if (!held && this.act?.held && this.act.ending === undefined) return;
    // a cheer that the same press set off (a landmark waking, a Keeper's thanks) plays as it is
    if (!held && this.action?.name === 'cheer') return;
    // the act is drawn over the idle clip, not over the old reach-out gesture
    if (this.action && !this.isSeatClip(this.action.name)) {
      this.action = undefined;
      const anim = this.model?.anim;
      if (anim) {
        anim.speed = 1;
        anim.baseLayer?.transition(this.loop, 0.1);
      }
    }
    this.act = { id, t: 0, held, ticks: 0 };
    const want = ACTS[id].prop?.id;
    if (this.prop?.id !== want) {
      this.prop?.destroy();
      this.prop = want && this.model ? new BotProp(want, this.root) : undefined;
      this.prop?.grow(0);
    }
  }

  /** #628: ends a held act: finished (`done`, with its finishing effect) or let go part way. */
  endAct(done: boolean) {
    const a = this.act;
    if (!a || a.ending !== undefined) return;
    if (done) this.beat('finish');
    a.ending = a.t;
  }

  /** #628: the act being drawn now (tests). */
  get acting(): ActId | undefined {
    return this.act?.id;
  }

  /** #628: is the act held (looping until let go)? */
  get actHeld(): boolean {
    return !!this.act?.held && this.act.ending === undefined;
  }

  private isSeatClip(n: string): boolean {
    return n === BOT_CLIPS.sitDown || n === BOT_CLIPS.standUp;
  }

  private readonly beatAt = new pc.Vec3();
  private readonly beatSide = new pc.Vec3();
  private readonly beatBack = new pc.Vec3();

  private beat(kind: 'tick' | 'finish') {
    const a = this.act;
    if (!a || !this.onBeat) return;
    const d = ACTS[a.id];
    const effect = kind === 'tick' ? d.tick : d.finish;
    if (!effect) return;
    const at = this.beatAt;
    const l = this.model?.findByName('LeftHand');
    const r = this.model?.findByName('RightHand');
    if (effect.at === 'tool' && this.prop) this.prop.tip(at);
    else if (effect.at !== 'ground' && l && r) at.copy(l.getPosition()).add(r.getPosition()).mulScalar(0.5);
    else {
      // on the ground half a step ahead (its front is the root's local +z)
      const f = this.root.forward;
      const p = this.root.getPosition();
      at.set(p.x - f.x * 0.42, p.y, p.z - f.z * 0.42);
    }
    this.beatSide.copy(this.root.right);
    this.beatBack.copy(this.root.forward); // its front is the root's local +z, so the root's forward (-z) is behind it
    this.onBeat({ act: a.id, beat: kind, effect, at, side: this.beatSide, back: this.beatBack });
  }

  /** #628: runs the act: eases it in and out, fires its effects, and draws its pose (after the clip has run). */
  private runAct(dt: number) {
    const a = this.act;
    if (!a) return;
    a.t += dt;
    const d = ACTS[a.id];
    if (!a.held && a.ending === undefined && a.t >= d.once) {
      this.beat('finish');
      a.ending = a.t;
    }
    if (a.ending === undefined && d.tick) {
      const n = Math.floor(a.t / d.tick.every);
      if (n > a.ticks) {
        a.ticks = n;
        this.beat('tick');
      }
    }
    const into = Math.min(1, a.t / ACT_EASE.in);
    const out = a.ending === undefined ? 1 : Math.max(0, 1 - (a.t - a.ending) / ACT_EASE.out);
    const w = smooth(Math.min(into, out));
    if (a.ending !== undefined && out <= 0) {
      this.act = undefined;
      this.prop?.destroy();
      this.prop = undefined;
      if (!this.pose) this.holder?.setLocalPosition(0, 0, 0);
      return;
    }
    if (!this.model || this.pose) return;
    // the feet as the clip has them (the model back at its rest height first), then the pose, then sink the model so
    // the lower foot is back where it was: a crouch with its feet on the ground, never lifted off it
    this.holder?.setLocalPosition(0, 0, 0);
    const before = this.feetHeight();
    if (!applyActPose(this.model, this.root, actPose(a.id, a.t, 1, this.reducedMotion, this.actPoseNow), w)) return;
    const sink = this.feetHeight() - before;
    this.holder?.setLocalPosition(0, -sink, 0);
    this.lastSink = sink;
    if (this.prop) {
      const side = ACTS[a.id].prop!.hand === 'left' ? 'Left' : 'Right';
      const fore = this.model.findByName(`${side}ForeArm`);
      const hand = this.model.findByName(`${side}Hand`);
      if (fore && hand) this.prop.place(fore.getPosition(), hand.getPosition(), this.root.up);
      this.prop.grow(w);
    }
  }

  /** #628: how far the act sank the model last frame (bending the knees lifts the feet; this puts them back down). */
  lastSink = 0;

  /** #628: the lower of its two feet (the ankle joints), above its root. */
  feetHeight(): number {
    if (!this.model) return 0;
    // (cached: #671 reads it every frame)
    const l = boneOf(this.model, 'LeftFoot');
    const r = boneOf(this.model, 'RightFoot');
    if (!l || !r) return 0;
    return Math.min(l.getPosition().y, r.getPosition().y) - this.root.getPosition().y;
  }

  update(dt: number) {
    this.clock += dt;
    this.runAct(dt);
    this.drawBody(dt);
    this.placeGrowth();
    if (this.pose) this.posed();
    // Faces: an expression times out back to happy; now and then a blink.
    if (this.faceUntil && this.clock >= this.faceUntil) this.setFace('happy');
    if (this.clock >= this.blinkAt) {
      if (this.face === 'happy' && !this.reducedMotion) this.setFace('blink', 0.13);
      this.blinkAt = this.clock + 2.5 + ((this.clock * 7.31) % 3);
    }
    if (this.action && this.clock >= this.action.until) {
      if (this.isSeatClip(this.action.name)) this.clipDoneAt = this.clock;
      this.action = undefined;
      const anim = this.model?.anim;
      if (anim) {
        anim.speed = 1;
        anim.baseLayer?.transition(this.loop, BLEND);
      }
    }
  }

  destroy() {
    this.destroyed = true;
    this.root.destroy();
    this.asset?.unload();
    if (this.asset) this.app.assets.remove(this.asset);
  }
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
