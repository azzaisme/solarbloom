import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/GameState';
import { botParts, growthKey, MOVE_ORDER, nextGrowth, partsAdded, pieceOf, UPGRADE_PART, type BotGrowth, type PartPiece } from '../src/data/botParts';
import { KEEPERS } from '../src/data/oldcity';
import { PARK_GROWTH } from '../src/data/bloombot';
import { RESEARCH_UPGRADES } from '../src/data/research';
import { Sim } from '../src/gameplay/Sim';
import { bloombotRows } from '../src/ui/BloombotPage';

/**
 * #627 (E25): Bloombot's parts. Every upgrade, move and park growth shows on Bloombot as a part that changes at every
 * level, all from one list (data/botParts), so you can tell how far a Bloombot has come at a glance. Knacks (#625)
 * have their slot. The look itself is checked in tests/e2e/bloombot-parts-shots.mjs.
 */
const BLOOM = RESEARCH_UPGRADES.filter((u) => u.branch === 'bloombot');
const none: BotGrowth = { moves: [], levels: {}, park: 0 };
const sig = (ps: PartPiece[]) => JSON.stringify(ps.map((p) => [p.name, p.scale, p.at, p.mat]));
const ofPart = (g: BotGrowth, part: string) => botParts(g).filter((p) => p.part === part);
const full: BotGrowth = { moves: [...MOVE_ORDER], levels: Object.fromEntries(BLOOM.map((u) => [u.id, u.levels.length])), park: PARK_GROWTH.length, knacks: ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'] };

describe('#627: one list of Bloombot\'s parts', () => {
  it('a new Bloombot wears nothing extra', () => {
    expect(botParts(none)).toEqual([]);
  });

  it('every Bloombot upgrade has a part, and each of its levels changes that part', () => {
    for (const u of BLOOM) {
      const part = UPGRADE_PART[u.id];
      expect(part, u.id).toBeDefined();
      let before = sig(ofPart(none, part));
      for (let l = 1; l <= u.levels.length; l++) {
        const now = ofPart({ ...none, levels: { [u.id]: l } }, part);
        expect(now.length, `${u.id} ${l}`).toBeGreaterThan(0);
        expect(sig(now), `${u.id} level ${l} looks different from ${l - 1}`).not.toBe(before);
        before = sig(now);
      }
      // and only its own part changes
      expect(new Set(botParts({ ...none, levels: { [u.id]: u.levels.length } }).map((p) => p.part)), u.id).toEqual(new Set([part]));
    }
  });

  it('each move has its own mark, and only the moves learned show', () => {
    const marks = (moves: string[]) => ofPart({ ...none, moves }, 'marks').map((p) => p.name);
    expect(marks(['prune'])).toEqual(['grow-marks-prune']);
    expect(marks(['prune', 'hover', 'climb', 'glide'])).toEqual(['grow-marks-prune', 'grow-marks-hover', 'grow-marks-climb', 'grow-marks-glide']);
    // each a different shape or turn, so they read apart
    const shapes = ofPart({ ...none, moves: [...MOVE_ORDER] }, 'marks').map((p) => `${p.shape}:${p.euler}`);
    expect(new Set(shapes).size).toBe(4);
  });

  it('the park grows its bud, collar and cuffs (#622), in their parts', () => {
    expect([1, 2, 3].map((park) => [...new Set(botParts({ ...none, park }).map((p) => p.part))])).toEqual([['bud'], ['bud', 'collar'], ['bud', 'collar', 'cuffs']]);
    expect(PARK_GROWTH.map((d) => d.part)).toEqual(['bud', 'collar', 'cuffs']);
  });

  it('#625 knacks have their slot: a bead each, up to ten (one per Keeper)', () => {
    expect(ofPart({ ...none, knacks: ['market'] }, 'knacks').map((p) => p.name)).toEqual(['grow-knacks-market']);
    expect(ofPart(full, 'knacks')).toHaveLength(10);
  });

  it('fully grown: every name is unique, and every piece stays close to Bloombot (it still reads from the follow camera)', () => {
    const ps = botParts(full);
    expect(new Set(ps.map((p) => p.name)).size).toBe(ps.length);
    for (const p of ps) {
      expect(Math.hypot(...p.at), p.name).toBeLessThan(0.45);
      expect(Math.max(...p.scale), p.name).toBeLessThan(p.shape === 'torus' ? 0.32 : 0.2); // a torus 1 across before scaling: the collar wraps the neck
    }
  });

  it('the page names the same part each row grows (the turntable lights it)', () => {
    const sim = new Sim(createInitialState(7));
    const rows = bloombotRows(sim);
    for (const r of rows) {
      if (r.kind === 'upgrade') expect(r.part, r.id).toBe(UPGRADE_PART[r.id]);
      if (r.kind === 'move') expect(r.part, r.id).toBe('marks');
    }
    const drawn = new Set(botParts(full).map((p) => p.part));
    for (const r of rows) expect(drawn.has(r.part), `${r.id}: ${r.part} is drawn`).toBe(true);
  });

  it('the visuals rebuild only when something they draw changes', () => {
    const a = growthKey({ moves: ['prune'], levels: { chargeCells: 1, sprint: 0 }, park: 1 });
    expect(growthKey({ moves: ['prune'], levels: { chargeCells: 1 }, park: 1 })).toBe(a);
    expect(growthKey({ moves: ['prune'], levels: { chargeCells: 2 }, park: 1 })).not.toBe(a);
  });
});

describe('#629: what the next level adds (the turntable shows it as a ghost)', () => {
  const g: BotGrowth = { moves: ['prune'], levels: { chargeCells: 2 }, park: 1 };
  const added = (row: Parameters<typeof nextGrowth>[1]) => partsAdded(g, nextGrowth(g, row)).map((p) => p.name);

  it('an upgrade: the next level of its part, and nothing at the top level', () => {
    expect(added({ kind: 'upgrade', id: 'chargeCells', max: 5 })).toEqual(['grow-cells-2']);
    expect(added({ kind: 'upgrade', id: 'lantern', max: 2 })).toContain('grow-lamp-bulb');
    expect(added({ kind: 'upgrade', id: 'chargeCells', max: 2 })).toEqual([]);
  });

  it('a move: its mark, if not learned yet', () => {
    expect(added({ kind: 'move', id: 'climb' })).toEqual(['grow-marks-climb']);
    expect(added({ kind: 'move', id: 'prune' })).toEqual([]);
  });

  it('a park milestone: its part, once the park gets there', () => {
    expect(PARK_GROWTH.map((d) => d.id)).toEqual(['spill', 'thrift', 'quick']);
    expect(added({ kind: 'park', id: 'thrift' })).toEqual(['grow-collar-ring']);
    expect(added({ kind: 'park', id: 'spill' })).toEqual([]);
    expect(new Set(partsAdded(g, nextGrowth(g, { kind: 'park', id: 'quick' })).map((p) => p.part))).toEqual(new Set(['collar', 'cuffs']));
  });

  it("a knack (#625): its bead, in its Keeper's colour", () => {
    const k = KEEPERS[0];
    const [bead] = partsAdded(g, nextGrowth(g, { kind: 'knack', id: `knack-${k.id}` }));
    expect(bead.name).toBe(`grow-knacks-${k.id}`);
    expect(bead.tint).toBe(k.tint);
    expect(partsAdded({ ...g, knacks: [k.id] }, nextGrowth({ ...g, knacks: [k.id] }, { kind: 'knack', id: `knack-${k.id}` }))).toEqual([]);
    expect(pieceOf({ kind: 'knack', id: `knack-${k.id}` })).toBe(k.id);
  });

  it('every row on the page shows its ghost on its own part', () => {
    const sim = new Sim(createInitialState(7));
    for (const r of bloombotRows(sim)) {
      const ps = partsAdded(none, nextGrowth(none, r));
      if (r.kind === 'upgrade' || r.kind === 'move' || r.kind === 'knack') expect(ps.length, r.id).toBeGreaterThan(0);
      // a move or knack row glows its own piece: one that is drawn once it has it
      const own = pieceOf(r);
      if (own && r.kind !== 'move2') expect(ps.map((p) => p.name), r.id).toEqual([`grow-${r.part}-${own}`]);
      // a move's second level (#626) lights its move's own mark
      if (r.kind === 'move2') expect([r.part, own], r.id).toEqual(['marks', r.id.slice(0, -1)]);
      if (r.kind !== 'park') for (const p of ps) expect(p.part, r.id).toBe(r.part);
    }
  });
});
