import { PALETTE } from './Palette';

/** A cupped leaf with a raised midrib. Coordinates run left to right across the vein, root to tip. */
const PROFILE = [
  [-1, 0.01, 0.03],
  [-0.76, 0.43, 0],
  [-0.42, 0.85, 0.025],
  [0, 1, 0.06],
  [0.39, 0.76, 0.11],
  [0.72, 0.39, 0.17],
  [1.02, 0.01, 0.24],
] as const;
const ACROSS = [-1, -0.045, 0, 0.045, 1] as const;
const rgb = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
const BLADES = PALETTE.signal.trailLeaves.map(rgb);
const VEIN = rgb(PALETTE.signal.trailVein);

export const LEAF_VERTICES = PROFILE.flatMap(([forward, width, tip], row) =>
  ACROSS.map((across, column) => ({
    x: across * width * (across < 0 ? 1 : 0.88) * 0.112,
    y: (tip + 0.12 * across * across + (column === 2 ? 0.08 : 0)) * 0.16,
    z: forward * 0.245,
    vein: column === 2,
    shade: (across < 0 ? 0.79 : 0.95) + row * 0.008,
  })),
);

export const LEAF_INDICES: number[] = [];
for (let row = 0; row < PROFILE.length - 1; row++) {
  for (let col = 0; col < ACROSS.length - 1; col++) {
    const a = row * ACROSS.length + col;
    const b = a + ACROSS.length;
    LEAF_INDICES.push(a, b, a + 1, a + 1, b, b + 1);
  }
}

export function leafColor(index: number, vertex: (typeof LEAF_VERTICES)[number]) {
  const base = BLADES[index % BLADES.length];
  return vertex.vein ? VEIN : base.map(channel => Math.round(channel * vertex.shade));
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

/** World-space drift from the landing point. Offset and flutter ease into the same pose as the settled leaf. */
export function leafFlight(progress: number, phase: number, height: number) {
  const t = clamp01(progress);
  const envelope = 1 - smooth(t);
  const sway = Math.sin(phase + t * Math.PI * 3.2);
  const turn = Math.cos(phase * 0.7 + t * Math.PI * 2.2);
  return {
    height: height * Math.pow(1 - t, 1.18),
    sideways: 0.29 * sway * envelope,
    along: 0.15 * turn * envelope,
    yaw: 0.65 * turn * envelope,
    pitch: (0.48 + 0.44 * turn) * envelope,
    roll: 1.05 * sway * envelope,
  };
}
