// #689 (E27.5): at the Great Bloom a flock flies in from both sides of the screen and makes a heart in the sky.
import * as pc from 'playcanvas';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BIRD_HEART } from '../src/data/birdHeart';
import { TIERS } from '../src/data/salvage';
import { BirdHeart, type HeartBird, type HeartCamera } from '../src/rendering/BirdHeart';
import { bloomGetsHeart, flightSeconds, HEART_ASPECT, heartBox, HeartFlight, heartSlots, onScreen, outlineAt, type Box } from '../src/rendering/HeartFlight';

const W = 1280;
const H = 800;
/** the Deck at UI 150%: the objective card top left, the charge card top right */
const CARDS = [
  { left: 27, top: 27, right: 597, bottom: 330 },
  { left: 883, top: 27, right: 1253, bottom: 200 },
];
const box = heartBox(W, H, CARDS);
const n = BIRD_HEART.birds;

/** run a flight at 60 fps to time t, returning the flight */
const flyTo = (t: number, calm = false, b: Box = box) => {
  const f = new HeartFlight(W, H, b, calm);
  const dt = 1 / 60;
  while (f.t < t - 1e-9 && !f.done) f.step(Math.min(dt, t - f.t));
  return f;
};

describe('#689: the heart', () => {
  it('its places are spread evenly round a heart: a dip at the top, a point at the bottom, left mirroring right', () => {
    const slots = heartSlots(n);
    expect(slots).toHaveLength(n);
    // the top dip and the bottom tip are on the middle line, the tip lowest of all
    expect(slots[0].u).toBeCloseTo(0, 3);
    expect(slots[n / 2].u).toBeCloseTo(0, 3);
    expect(slots[n / 2].v).toBeCloseTo(-0.5, 2);
    expect(slots[0].v).toBeGreaterThan(0.1);
    // the two lobes rise above the dip
    expect(Math.max(...slots.map((s) => s.v))).toBeGreaterThan(slots[0].v + 0.15);
    // mirror pairs
    for (let i = 1; i < n / 2; i++) {
      expect(slots[i].u).toBeCloseTo(-slots[n - i].u, 3);
      expect(slots[i].v).toBeCloseTo(slots[n - i].v, 3);
    }
    // evenly spaced on screen: neighbours within 25% of the mean gap
    const pts = slots.map((s) => onScreen(box, s.u, s.v));
    const gaps = pts.map((p, i) => Math.hypot(p[0] - pts[(i + 1) % n][0], p[1] - pts[(i + 1) % n][1]));
    const mean = gaps.reduce((a, b) => a + b, 0) / n;
    for (const g of gaps) expect(Math.abs(g - mean) / mean).toBeLessThan(0.25);
  });

  it('every place lies on the heart curve (x = 16 sin³a, y = 13 cos a − 5 cos 2a − 2 cos 3a − cos 4a)', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 4096; i++) {
      const a = (i / 4096) * Math.PI * 2;
      const s = Math.sin(a);
      pts.push([16 * s * s * s, 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)]);
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const unit = pts.map(([x, y]) => [(x - x0) / (x1 - x0) - 0.5, (y - y0) / (y1 - y0) - 0.5]);
    for (let k = 0; k < 100; k++) {
      const [u, v] = outlineAt(k / 100);
      let best = Infinity;
      for (const [x, y] of unit) best = Math.min(best, Math.hypot(x - u, y - v));
      expect(best, `place ${k}`).toBeLessThan(0.004);
    }
  });

  it('half the flock comes from each side', () => {
    const slots = heartSlots(n);
    expect(slots.filter((s) => s.side < 0)).toHaveLength(n / 2);
    expect(slots.filter((s) => s.side > 0)).toHaveLength(n / 2);
    for (const s of slots) if (Math.abs(s.u) > 0.01) expect(Math.sign(s.u)).toBe(s.side);
  });
});

describe('#689: where the heart goes', () => {
  it('in the top band, between the cards, the size it can be', () => {
    expect(box.x).toBeGreaterThanOrEqual(CARDS[0].right + BIRD_HEART.box.gap - 1e-6);
    expect(box.x + box.w).toBeLessThanOrEqual(CARDS[1].left - BIRD_HEART.box.gap + 1e-6);
    expect(box.y).toBeCloseTo(H * BIRD_HEART.box.top);
    expect(box.y + box.h).toBeLessThan(H * 0.45);
    expect(box.h / box.w).toBeCloseTo(HEART_ASPECT);
    expect(box.w).toBeGreaterThan(W * 0.15);
  });

  it('with no HUD it is centred; with no room between the cards it drops below them', () => {
    const free = heartBox(W, H, []);
    expect(free.x + free.w / 2).toBeCloseTo(W / 2);
    const tight = heartBox(W, H, [{ left: 0, top: 20, right: 600, bottom: 300 }, { left: 640, top: 20, right: 1280, bottom: 250 }]);
    expect(tight.y).toBeGreaterThanOrEqual(300);
    expect(tight.x + tight.w / 2).toBeCloseTo(W / 2);
  });
});

describe('#689: the flight', () => {
  const formed = BIRD_HEART.stagger + BIRD_HEART.flyIn;

  it('the birds start off the screen at their own edge', () => {
    const f = flyTo(0);
    f.slots.forEach((s, i) => {
      const p = f.poses[i];
      if (s.side < 0) expect(p.x).toBeLessThan(0);
      else expect(p.x).toBeGreaterThan(W);
    });
  });

  it('by the time it is formed every bird is in its place on the heart', () => {
    const f = flyTo(formed);
    f.slots.forEach((s, i) => {
      const [x, y] = onScreen(box, s.u, s.v);
      expect(Math.hypot(f.poses[i].x - x, f.poses[i].y - y), `bird ${i}`).toBeLessThan(0.5);
    });
  });

  it('while it holds every bird stays on the outline, inside its box', () => {
    for (const t of [formed + 0.5, formed + BIRD_HEART.hold * 0.5, formed + BIRD_HEART.hold]) {
      const f = flyTo(t);
      for (const p of f.poses) {
        expect(p.x).toBeGreaterThanOrEqual(box.x - 1);
        expect(p.x).toBeLessThanOrEqual(box.x + box.w + 1);
        expect(p.y).toBeGreaterThanOrEqual(box.y - 1);
        expect(p.y).toBeLessThanOrEqual(box.y + box.h + 1);
      }
    }
  });

  it('they fly, not snap: no bird jumps, and headings turn smoothly with a bank kept within limits', () => {
    const f = new HeartFlight(W, H, box, false);
    const dt = 1 / 60;
    let prev = f.poses.map((p) => ({ ...p }));
    const bankMax = (BIRD_HEART.bank * Math.PI) / 180;
    while (!f.done) {
      f.step(dt);
      f.poses.forEach((p, i) => {
        if (!p.shown || !prev[i].shown) return;
        expect(Math.hypot(p.x - prev[i].x, p.y - prev[i].y), `bird ${i} at ${f.t.toFixed(2)}`).toBeLessThan(W * 0.025);
        const d = Math.atan2(Math.sin(p.heading - prev[i].heading), Math.cos(p.heading - prev[i].heading));
        expect(Math.abs(d)).toBeLessThanOrEqual(6 * dt + 1e-9);
        expect(Math.abs(p.bank)).toBeLessThanOrEqual(bankMax + 1e-9);
      });
      prev = f.poses.map((p) => ({ ...p }));
    }
  });

  it('then they break away off the screen and the flight ends', () => {
    const f = flyTo(flightSeconds(false) + 0.2);
    expect(f.done).toBe(true);
    for (const p of f.poses) expect(p.shown).toBe(false);
  });

  it('reduced motion: no flight across the screen; they grow into place, hold, and go, in a few seconds', () => {
    expect(flightSeconds(true)).toBeLessThan(4);
    expect(flightSeconds(true)).toBeLessThan(flightSeconds(false) / 2);
    const start = flyTo(0, true);
    for (const p of start.poses) expect(p.scale).toBe(0);
    const mid = flyTo(BIRD_HEART.calm.fadeIn + 1, true);
    mid.slots.forEach((s, i) => {
      const [x, y] = onScreen(box, s.u, s.v);
      expect(mid.poses[i].x).toBeCloseTo(x);
      expect(mid.poses[i].y).toBeCloseTo(y);
      expect(mid.poses[i].scale).toBe(1);
    });
    expect(flyTo(flightSeconds(true) + 0.2, true).done).toBe(true);
  });
});

describe('#689: once per Great Bloom, and nothing left after', () => {
  // (entities made outside a running app make PlayCanvas say so on every one: quiet here)
  let quiet: ReturnType<typeof vi.spyOn>[] = [];
  beforeAll(() => {
    quiet = (['log', 'warn', 'error'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
  });
  afterAll(() => quiet.forEach((q) => q.mockRestore()));
  it('only the Great Bloom gets the heart', () => {
    const with_ = TIERS.filter((t) => bloomGetsHeart(t.look));
    expect(with_.map((t) => t.name)).toEqual(['The Great Bloom']);
  });

  // a camera looking down −z from the origin, 60° fov, on a 1280 × 800 screen
  const cam: HeartCamera = {
    entity: { forward: new pc.Vec3(0, 0, -1) },
    screenToWorld(x, y, z, out = new pc.Vec3()) {
      const t = Math.tan(Math.PI / 6);
      return out.set(((x / W) * 2 - 1) * t * (W / H) * z, (1 - (y / H) * 2) * t * z, -z);
    },
  };
  const bird = (parent: pc.Entity): HeartBird => {
    const root = new pc.Entity('heart-bird');
    parent.addChild(root);
    const wings = [new pc.Entity('wing'), new pc.Entity('wing')] as [pc.Entity, pc.Entity];
    wings.forEach((w) => root.addChild(w));
    return { root, wings };
  };

  it('plays once at a time, flies through, and removes every bird when it ends', () => {
    const world = new pc.Entity('world');
    const heart = new BirdHeart(world, bird);
    expect(heart.play(W, H, box, false)).toBe(true);
    expect(heart.play(W, H, box, false)).toBe(false); // a second call while it flies does nothing
    expect(world.children).toHaveLength(1);
    expect(world.children[0].children).toHaveLength(n);
    // (outside an app `enabled` is never true in the hierarchy: count each bird's own switch)
    let shownMid = 0;
    const mid = Math.round((BIRD_HEART.stagger + BIRD_HEART.flyIn + 1) * 30);
    for (let k = 0; k < (flightSeconds(false) + 1) * 30; k++) {
      heart.update(1 / 30, cam);
      if (k === mid) shownMid = (world.children[0]?.children ?? []).filter((c) => (c as unknown as { _enabled: boolean })._enabled).length;
    }
    expect(shownMid).toBe(n);
    expect(heart.active).toBe(false);
    expect(world.children).toHaveLength(0);
    // and it can play again at the next bloom
    expect(heart.play(W, H, box, true)).toBe(true);
    for (let t = 0; t < flightSeconds(true) + 1; t += 1 / 30) heart.update(1 / 30, cam);
    expect(world.children).toHaveLength(0);
  });

  it('the birds face the camera with their backs, in front of it at the flock depth', () => {
    const world = new pc.Entity('world');
    const heart = new BirdHeart(world, bird);
    heart.play(W, H, box, false);
    for (let k = 0; k < 60 * (BIRD_HEART.stagger + BIRD_HEART.flyIn + 0.5); k++) heart.update(1 / 60, cam);
    for (const b of world.children[0].children as pc.Entity[]) {
      expect(b.getPosition().z).toBeCloseTo(-BIRD_HEART.depth, 4);
      // the bird's up (its back) points back toward the camera, give or take its bank
      expect(b.up.z).toBeGreaterThan(Math.cos((BIRD_HEART.bank * Math.PI) / 180) - 0.05);
    }
    heart.stop();
    expect(world.children).toHaveLength(0);
  });
});
