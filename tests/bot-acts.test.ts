// #628: every Interact verb has its act, holds loop, and reduced motion keeps still.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTS, HOLD_ACTS, VERB_ACTS, actForVerb, type ActId } from '../src/data/botActs';
import { NIGHT_FIND_GIVES } from '../src/data/time';
import { PROPS } from '../src/data/botProps';
import { actPose } from '../src/rendering/BotActs';

const read = (f: string) => readFileSync(f, 'utf8');

/** Every verb the game can put on the prompt: the quoted words in each `verb` (a literal or a ternary of literals). */
function verbsIn(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/verb(?:\s*=|:)\s*([^,\n]*?)(?:,\s*name|;\n)/g)) for (const w of m[1].matchAll(/'([A-Z][^']*)'/g)) out.add(w[1]);
  return [...out];
}

describe('Bloombot acts out every Interact verb (#628)', () => {
  const verbs = [...new Set([...verbsIn(read('src/app/Game.ts')), ...verbsIn(read('src/app/Resting.ts')), ...Object.values(NIGHT_FIND_GIVES).map((g) => g.verb)])];

  it('finds the verbs (the scan works)', () => {
    for (const v of ['Salvage', 'Pry', 'Gather', 'Talk to', 'Harvest', 'Wake', 'Sit on', 'Mend', 'Pick up']) expect(verbs).toContain(v);
  });

  it('every verb on the prompt is in the table, with an act or a pose of its own', () => {
    const missing = verbs.filter((v) => !(v in VERB_ACTS));
    expect(missing).toEqual([]);
    const own = ['Sit on', 'Meditate at', 'Sleep', 'Ride up', 'Ride down'];
    for (const v of verbs) if (!own.includes(v)) expect(actForVerb(v), v).toBeDefined();
  });

  it('every hold the Old City runs has a looping act', () => {
    const kinds = [...read('src/app/OldCity.ts').matchAll(/startHold\('(\w+)'/g)].map((m) => m[1]);
    expect(new Set(kinds)).toEqual(new Set(['salvage', 'pry', 'gather']));
    for (const k of kinds) expect(HOLD_ACTS[k]).toBeDefined();
    expect(HOLD_ACTS).toMatchObject({ salvage: 'rummage', pry: 'pry', gather: 'gather' });
  });

  it('each act has a small effect, and the held ones keep making it while they work', () => {
    for (const [id, d] of Object.entries(ACTS)) {
      expect(d.tick || d.finish, id).toBeTruthy();
      expect(d.period, id).toBeGreaterThan(0);
      expect(d.once, id).toBeGreaterThan(0.3);
      expect(d.once, id).toBeLessThan(2);
    }
    for (const id of Object.values(HOLD_ACTS)) expect(ACTS[id].tick, id).toBeDefined();
  });

  it('the acts move while they run, and differ from each other', () => {
    const at = (id: ActId, t: number) => actPose(id, t, 1, false);
    for (const id of Object.keys(ACTS) as ActId[]) {
      const d = ACTS[id];
      const a = at(id, d.period * 0.1);
      const b = at(id, d.period * 0.35);
      const moved = Object.keys(a).some((k) => Math.abs(a[k as keyof typeof a] - b[k as keyof typeof b]) > 1e-3);
      expect(moved, `${id} swings`).toBe(true);
    }
    const sig = (id: ActId) => JSON.stringify(at(id, 0));
    const ids = Object.keys(ACTS) as ActId[];
    expect(new Set(ids.map(sig)).size).toBe(ids.length);
  });

  it('reduced motion holds the pose still, and the weight eases it in and out', () => {
    for (const id of Object.keys(ACTS) as ActId[]) {
      const d = ACTS[id];
      expect(actPose(id, d.period * 0.25, 1, true)).toEqual(actPose(id, d.period * 0.7, 1, true));
      const full = actPose(id, 0.1, 1, false);
      const half = actPose(id, 0.1, 0.5, false);
      for (const k of Object.keys(full) as (keyof typeof full)[]) expect(half[k]).toBeCloseTo(full[k] / 2);
      expect(Object.values(actPose(id, 0.1, 0, false)).every((v) => Math.abs(v) < 1e-9)).toBe(true);
    }
  });

  it('each act but the quick reach holds something that reads from behind, and its effects come from it', () => {
    for (const [id, d] of Object.entries(ACTS)) {
      if (id === 'reach') {
        expect(d.prop).toBeUndefined();
        continue;
      }
      expect(d.prop, id).toBeDefined();
      expect(PROPS[d.prop!.id], id).toBeDefined();
    }
    expect(ACTS.pry.prop?.id).toBe('bar');
    expect(ACTS.dig.prop?.id).toBe('trowel');
    expect(ACTS.plant.prop?.id).toBe('trowel');
    expect(ACTS.tend.prop?.id).toBe('can');
    expect(ACTS.gather.prop?.id).toBe('basket');
    expect(ACTS.harvest.prop?.id).toBe('basket');
    expect(ACTS.repair.prop?.id).toBe('wrench');
    // an effect at the tool needs a tool
    for (const [id, d] of Object.entries(ACTS)) for (const e of [d.tick, d.finish]) if (e?.at === 'tool') expect(d.prop, id).toBeDefined();
    // every prop is used, and each has pieces and a working end
    const used = new Set(Object.values(ACTS).map((d) => d.prop?.id));
    for (const [id, p] of Object.entries(PROPS)) {
      expect(used.has(id as never), id).toBe(true);
      expect(p.pieces.length, id).toBeGreaterThan(0);
      expect(p.tip).toHaveLength(3);
    }
  });

  it('the busy acts throw their dust and soil out to the sides or back, where the follow camera sees it', () => {
    for (const id of ['rummage', 'pry', 'gather', 'dig', 'plant', 'harvest'] as ActId[]) {
      const e = ACTS[id].tick!;
      expect((e.fan ?? 0) + (e.back ?? 0), id).toBeGreaterThan(0.8);
      expect(e.up ?? 0, id).toBeGreaterThan(1.5);
    }
  });

  it('the crouching acts bend the knees well down (the model sinks to keep its feet on the ground)', () => {
    expect(ACTS.dig.channels.knee![0]).toBeGreaterThanOrEqual(50);
    expect(ACTS.plant.channels.knee![0]).toBeGreaterThanOrEqual(60);
    expect(ACTS.pry.channels.lean![0]).toBeLessThan(-10);
    expect(read('src/rendering/BloombotVisuals.ts')).toMatch(/const sink = this\.feetHeight\(\) - before/);
  });

  it('the game starts the acts: the prompt verb after a press, the holds, planting and harvesting', () => {
    const game = read('src/app/Game.ts');
    expect(game).toMatch(/actForVerb\(t\.verb\)/);
    expect(game).toMatch(/visuals\.onBeat = /);
    const oc = read('src/app/OldCity.ts');
    expect(oc).toMatch(/startAct\(act, true\)/);
    expect(oc).toMatch(/endAct\(true\)/);
    expect(oc).toMatch(/endAct\(false\)/);
    expect(oc).toMatch(/startAct\('plant'\)/);
    expect(oc).toMatch(/startAct\('harvest'\)/);
  });
});
