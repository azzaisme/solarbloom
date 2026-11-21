import { describe, expect, it } from 'vitest';
import { type Candidate, holdFor, HOLD_SECONDS, pickTarget, PRIORITY, promptText, SAME_DEPTH } from '../src/app/Interact';
import { promptHtml } from '../src/ui/Prompt';

/** E22.2 (#339): one prompt, one obvious action. */
const c = (kind: Candidate['kind'], distance: number, extra: Partial<Candidate> = {}): Candidate => ({ kind, id: `${kind}@${distance}`, verb: 'Use', name: kind, distance, ...extra });

describe('E22.2: what Interact acts on', () => {
  it('follows the epic priority for every pair at the same depth, even when the lower one is a little nearer', () => {
    for (let i = 0; i < PRIORITY.length; i++)
      for (let j = i + 1; j < PRIORITY.length; j++) {
        const hi = c(PRIORITY[i], 0.9);
        const lo = c(PRIORITY[j], 0.9 - SAME_DEPTH + 0.05); // nearer, but within the same depth
        expect(pickTarget([lo, hi])?.kind, `${PRIORITY[i]} over ${PRIORITY[j]}`).toBe(PRIORITY[i]);
        expect(pickTarget([hi, lo])?.kind, `${PRIORITY[i]} over ${PRIORITY[j]} (other order)`).toBe(PRIORITY[i]);
      }
  });

  it('is depth first: the nearest thing wins over a higher-priority one further off', () => {
    for (let i = 0; i < PRIORITY.length; i++)
      for (let j = i + 1; j < PRIORITY.length; j++) {
        const far = c(PRIORITY[i], 1.4);
        const near = c(PRIORITY[j], 0.6); // lower in the list, but right in front
        expect(pickTarget([far, near])?.kind, `${PRIORITY[j]} in front over ${PRIORITY[i]} behind it`).toBe(PRIORITY[j]);
        expect(pickTarget([near, far])?.kind, `${PRIORITY[j]} in front over ${PRIORITY[i]} (other order)`).toBe(PRIORITY[j]);
      }
    // a cat a step further on doesn't take the prompt from the machine bloombot is standing at
    expect(pickTarget([c('cat', 1.5), c('machine', 0.7)])?.kind).toBe('machine');
  });

  it('chooses three or more at once by the same order', () => {
    const all = [...PRIORITY].reverse().map((k, i) => c(k, 0.2 + i * 0.01));
    expect(pickTarget(all)?.kind).toBe('cat');
    expect(pickTarget(all.filter((x) => x.kind !== 'cat' && x.kind !== 'keeper'))?.kind).toBe('salvage');
  });

  it('is nearest first within a kind', () => {
    expect(pickTarget([c('machine', 1.4), c('machine', 0.9), c('machine', 1.1)])?.distance).toBe(0.9);
  });

  it('ignores what is out of reach, and acts on nothing when nothing is near', () => {
    expect(pickTarget([c('cat', 3), c('plot', 1)], 1.6)?.kind).toBe('plot');
    expect(pickTarget([c('cat', 3)], 1.6)).toBeUndefined();
    expect(pickTarget([])).toBeUndefined();
  });

  it('the priority matches the epic, top to bottom', () => {
    expect([...PRIORITY]).toEqual(['cat', 'keeper', 'salvage', 'cache', 'gate', 'door', 'storage', 'bench', 'landmark', 'machine', 'decoration', 'plot']);
  });

  it('holds can be switched to a single press', () => {
    expect(HOLD_SECONDS).toEqual({ salvage: 0.6, pry: 2 });
    expect(holdFor({ hold: 2 }, true)).toBe(2);
    expect(holdFor({ hold: 2 }, false)).toBe(0);
    expect(holdFor({}, true)).toBe(0);
  });
});

describe('E22.2: the prompt', () => {
  it('reads as a key and a verb ("E Talk to Pylon", "Hold E Pry")', () => {
    expect(promptText({ verb: 'Talk to', name: 'Pylon' })).toBe('Talk to Pylon');
    expect(promptText({ verb: 'Salvage', name: '' })).toBe('Salvage');
    const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    expect(plain(promptHtml({ glyph: '<kbd>E</kbd>', text: 'Talk to Pylon' }))).toBe('E Talk to Pylon');
    expect(plain(promptHtml({ glyph: '<kbd>E</kbd>', text: 'Pry', hold: true }))).toBe('E Hold Pry');
    expect(promptHtml({ glyph: '<kbd>E</kbd>', text: 'Pry', hold: true })).toContain('pr-ring');
  });

  it('says why when refused, and adds a smaller Pulse line when Pulse also applies', () => {
    const h = promptHtml({ glyph: '<kbd>E</kbd>', text: 'Salvage', refused: 'Backpack full', pulse: { glyph: '<kbd>X</kbd>', text: 'Pulse' } });
    expect(h).toContain('Backpack full');
    expect(h).toContain('pr-sub');
    expect(h).toContain('Pulse');
  });

  it('#590: refused, the words sit on their own line with the reason under them (not squeezed beside it)', () => {
    const why = 'Elder Grove is behind the clouds. Wake the fountain and Bloombot will learn to pry it open.';
    const h = promptHtml({ glyph: '<kbd>E</kbd>', text: 'Look at the clouds', refused: why });
    const body = h.match(/<span class="pr-body">(.*?)<\/span><\/div>/)?.[1] ?? '';
    expect(body).toMatch(/^<span class="pr-text">Look at the clouds<\/span><span class="pr-why">Elder Grove/);
    // a prompt that isn't refused keeps its plain one-line form
    expect(promptHtml({ glyph: '<kbd>E</kbd>', text: 'Salvage' })).not.toContain('pr-body');
  });
});
