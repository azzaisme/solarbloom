import { type AudioDirector, type LoopVoice, type V3 } from './AudioDirector';
import { variants } from './AudioAssets';
import { type AreaSound, bedLevels, type BedLevels, birdRate, creakRate, DEAD_AREA, followArea, pickVariant, type SoundscapeInput, type Stage, stageOf } from './AudioMath';

/** Asset ids of the beds (assets/audio/ambience/…). Missing files are simply silent. */
export const BEDS: Record<keyof BedLevels, string> = {
  wind: 'ambience/barren/wind-dry',
  leaves: 'ambience/restored/leaves',
  meadow: 'ambience/restored/meadow',
  night: 'ambience/restored/night-insects',
};
export const BROOK = 'ambience/water/brook';
export const SEA = 'ambience/water/shore';
export const BIRD_CALLS = 'ambience/wildlife/bird';
export const CREAKS = 'ambience/barren/creak';

/** A tree where birds may sing (world position) and how grown it is (0..1). */
export type Perch = V3 & { amount: number };

/**
 * Phase 8 A04 (the signature epic): the world's own sound, from what is actually around the listener.
 *
 * - Dead ground has only a thin dry wind and, rarely, a far-off creak of ruins. Long pauses.
 * - Restored ground brings leaves moving in the breeze; well restored ground a quiet meadow by day and insects
 *   at night; grown trees bring occasional bird calls from their crowns (one-shots, never a constant loop).
 * - Water is heard only where clean water is (3D, swelling as you approach); the sea from the nearest shore.
 *
 * Every level follows the *local* restoration (sampleArea around the listener), smoothed over several seconds, so
 * walking from a garden into wasteland lets life fade behind you, and the border can be heard from either side.
 */
export class SoundscapeDirector {
  private beds?: Record<keyof BedLevels, LoopVoice | undefined>;
  private brook?: LoopVoice;
  private sea?: LoopVoice;
  area: AreaSound = { ...DEAD_AREA };
  stage: Stage = 'barren';
  levels: BedLevels = { wind: 0, leaves: 0, meadow: 0, night: 0 };
  private perches: Perch[] = [];
  private listener: V3 = { x: 0, y: 0, z: 0 };
  private birdT = 2;
  private creakT = 12;
  private lastBird = -1;
  private lastCreak = -1;
  /** for the debug HUD: the last few wildlife events */
  readonly log: string[] = [];
  brookLevel = 0;
  seaLevel = 0;
  /** the player chose to hear fewer repeated sounds: wildlife is sparser */
  reduced = false;

  constructor(private readonly a: AudioDirector) {}

  /** Starts the (silent) beds once the context exists. */
  start() {
    if (this.beds || !this.a.ready) return;
    const a = this.a;
    this.beds = { wind: a.loop(BEDS.wind, 'ambience'), leaves: a.loop(BEDS.leaves, 'ambience'), meadow: a.loop(BEDS.meadow, 'ambience'), night: a.loop(BEDS.night, 'ambience') };
    // 3D water: refDistance 6 m (louder up close, a quiet presence 30 m away)
    this.brook = a.loop(BROOK, 'ambience', { spatial: 6 });
    this.sea = a.loop(SEA, 'ambience', { spatial: 10 });
    a.preload([...variants(BIRD_CALLS), ...variants(CREAKS)]);
  }

  /** Places the brook at the clean water near the listener (`amount` 0..1; 0 fades it out where it is). */
  setBrook(amount: number, p?: V3) {
    this.brookLevel = 0.5 * Math.max(0, Math.min(1, amount));
    if (p && amount > 0) this.brook?.moveTo(p);
  }

  /** The sea's wash from the nearest open water (`amount` 0..1). */
  setSea(amount: number, p?: V3) {
    this.seaLevel = 0.8 * /* the shore bed is baked at -29 LUFS (its waves are peaky) */ Math.max(0, Math.min(1, amount));
    if (p && amount > 0) this.sea?.moveTo(p);
  }

  /** Grown trees near the listener, where bird calls come from. */
  setPerches(p: Perch[]) {
    this.perches = p;
  }

  /**
   * Called a few times a second with the sampled area (unsmoothed) and the time since the last call. Beds glide to
   * their levels over seconds; wildlife and creaks are scheduled as sparse, irregular events.
   */
  update(dt: number, input: SoundscapeInput, listener: V3) {
    this.listener = listener;
    this.area = followArea(this.area, input.area, dt);
    this.stage = stageOf(this.area.life, this.stage);
    const s = { ...input, area: this.area };
    this.levels = bedLevels(s);
    if (this.beds) for (const k of Object.keys(this.levels) as (keyof BedLevels)[]) this.beds[k]?.setLevel(this.levels[k], 3);
    this.brook?.setLevel(this.brookLevel, 1.5);
    this.sea?.setLevel(this.seaLevel, 2);
    this.schedule(dt, s);
  }

  private schedule(dt: number, s: SoundscapeInput) {
    const k = this.reduced ? 0.5 : 1;
    // birds: a Poisson-ish clock whose rate follows the habitat; nothing at all in dead ground
    const br = birdRate(s) * k;
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = br > 0.001 ? (0.5 + Math.random()) / br : 3;
      if (br > 0.001) this.bird();
    }
    const cr = creakRate(s) * k;
    this.creakT -= dt;
    if (this.creakT <= 0) {
      this.creakT = cr > 0.001 ? (0.6 + Math.random() * 0.8) / cr : 10;
      if (cr > 0.001) this.creak();
    }
  }

  /** One bird call from a grown tree near the listener (or, in restored ground with no tree yet, the hedge). */
  private bird() {
    const ids = variants(BIRD_CALLS);
    if (!ids.length) return;
    const tree = this.perches.length ? this.perches[Math.floor(Math.random() * this.perches.length)] : undefined;
    const l = this.listener;
    const ang = Math.random() * Math.PI * 2;
    const pos = tree ?? { x: l.x + Math.cos(ang) * 9, y: l.y + 2, z: l.z + Math.sin(ang) * 9 };
    this.lastBird = pickVariant(ids.length, this.lastBird);
    const vol = 0.32 * (tree ? 0.6 + 0.4 * tree.amount : 0.55);
    if (this.a.play(ids[this.lastBird], { bus: 'ambience', fam: 'wildlife', vol, rate: 0.94 + Math.random() * 0.12, pos, ref: 7 })) this.note(`bird ${ids[this.lastBird].split('/').pop()}`);
  }

  /** A far-off creak of the ruins: quiet, from somewhere out in the dead land. */
  private creak() {
    const ids = variants(CREAKS);
    if (!ids.length) return;
    const l = this.listener;
    const ang = Math.random() * Math.PI * 2;
    const r = 18 + Math.random() * 14;
    this.lastCreak = pickVariant(ids.length, this.lastCreak);
    if (this.a.play(ids[this.lastCreak], { bus: 'ambience', fam: 'wildlife', vol: 0.28, rate: 0.85 + Math.random() * 0.2, pos: { x: l.x + Math.cos(ang) * r, y: l.y, z: l.z + Math.sin(ang) * r }, ref: 8 })) this.note('creak');
  }

  private note(s: string) {
    this.log.unshift(`${(this.a.now() | 0).toString().padStart(4)}s ${s}`);
    this.log.length = Math.min(this.log.length, 5);
  }
}
