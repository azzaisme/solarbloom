import { Rng } from '../core/Rng';
import { PALETTE } from './Palette';
import { SKETCH_HEIGHT, SKETCH_WIDTH, type SketchCapture } from './SketchCapture';

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const pixelAt = (width: number, x: number, y: number) => Math.round(y) * width + Math.round(x);
type Point = [number, number];

function soften(values: Float32Array, radius: number, W: number, H: number) {
  const rows = new Float32Array(values.length);
  const result = new Float32Array(values.length);
  const width = 2 * radius + 1;
  for (let y = 0; y < H; y++) {
    let sum = 0;
    for (let x = -radius; x < W; x++) {
      sum += values[y * W + clamp(x + radius, 0, W - 1)];
      if (x >= 0) {
        rows[y * W + x] = sum / width;
        sum -= values[y * W + clamp(x - radius, 0, W - 1)];
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = -radius; y < H; y++) {
      sum += rows[clamp(y + radius, 0, H - 1) * W + x];
      if (y >= 0) {
        result[y * W + x] = sum / width;
        sum -= rows[clamp(y - radius, 0, H - 1) * W + x];
      }
    }
  }
  return result;
}

function stroke(ctx: CanvasRenderingContext2D, points: Point[], pressure: number, width: number) {
  if (points.length < 2) return;
  ctx.globalAlpha = pressure;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.stroke();
}

function contours(ctx: CanvasRenderingContext2D, ids: Uint8Array, shade: Float32Array, rng: Rng) {
  const { width: W, height: H } = ctx.canvas;
  for (const id of [2, 1]) {
    const mask = Float32Array.from(ids, (value) => Number(value === id));
    const edge: number[] = [];
    for (let i = W + 1; i < ids.length - W - 1; i++) {
      if (mask[i] && (!mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W])) edge.push(i);
    }

    for (const construction of [true, false]) {
      const surface = soften(soften(mask, construction ? 4 : 2, W, H), construction ? 4 : 2, W, H);
      const markSpacing = construction ? 15 : 13;
      const occupied = new Uint8Array(ids.length);
      // Each mark starts at its own edge anchor. No stroke goes around the entire subject.
      for (let k = edge.length - 1; k >= 0; k--) {
        const swap = rng.int(0, k);
        const i = edge[swap];
        edge[swap] = edge[k];
        edge[k] = i;
        const x = i % W, y = Math.floor(i / W);
        if (occupied[i] || (!construction && shade[i] + rng.range(-0.21, 0.15) < 0.37)) continue;
        const distance = construction ? rng.int(9, 18) : rng.int(4, 10);
        const offset = rng.range(-1, 1) * (construction ? 4.5 : 1.7);
        const drift = rng.range(-1, 1) * (construction ? 7 : 2);
        const bow = rng.range(-1, 1) * (construction ? 5 : 2);
        const halves: Point[][] = [];
        for (const sign of [-1, 1]) {
          let px = x, py = y;
          let tx = 0, ty = 0;
          const half: Point[] = [];
          for (let j = 0; j <= distance; j++) {
            if (px < 2 || px > W - 3 || py < 2 || py > H - 3) break;
            const p = pixelAt(W, px, py);
            let nx = surface[p + 1] - surface[p - 1], ny = surface[p + W] - surface[p - W];
            const length = Math.hypot(nx, ny);
            if (length < 0.008) break;
            nx /= length;
            ny /= length;
            const direction = j === 0 ? sign : (-ny * tx + nx * ty < 0 ? -1 : 1);
            tx = 0.48 * tx - ny * direction * 0.52;
            ty = 0.48 * ty + nx * direction * 0.52;
            const t = j / distance;
            const wobble = offset + drift * sign * t + bow * t * t;
            half.push([px + nx * wobble, py + ny * wobble]);
            // Track the middle of the soft mask while letting the pencil itself drift.
            const correction = (0.5 - surface[p]) * 2.7;
            px += tx * 2.4 + nx * correction;
            py += ty * 2.4 + ny * correction;
          }
          halves.push(half);
        }
        const points = halves[0].slice(1).reverse().concat(halves[1]);
        if (points.length < 4) continue;
        const pressure = (construction ? rng.range(0.12, 0.30) : rng.range(0.33, 0.74)) * (id === 2 ? 0.60 : 1);
        stroke(ctx, points, pressure, construction ? rng.range(0.45, 0.9) : rng.range(0.7, 1.8));
        for (let row = Math.max(0, y - markSpacing); row <= Math.min(H - 1, y + markSpacing); row++) {
          occupied.fill(1, row * W + Math.max(0, x - markSpacing), row * W + Math.min(W, x + markSpacing + 1));
        }
      }
    }
  }
}

/** Sketch selected scene edges with a faint searching line and a shorter, darker accent. */
function drawSceneEdges(ctx: CanvasRenderingContext2D, { strength, direction }: NonNullable<SketchCapture['sceneEdges']>, rng: Rng) {
  const { width: W, height: H } = ctx.canvas;
  const smoothed = soften(strength, 1, W, H);
  for (const rough of [true, false]) {
    const spacing = rough ? 7 : 5;
    for (let y = 3; y < H - 3; y += spacing) for (let x = 3; x < W - 3; x += spacing) {
      let i = pixelAt(W, x, y);
      // Pick a nearby strong edge before jittering the mark. Thin silhouettes can fall between grid samples.
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const candidate = pixelAt(W, x + dx, y + dy);
        if (strength[candidate] > strength[i]) i = candidate;
      }
      const px = i % W + rng.range(-1.6, 1.6);
      const py = Math.floor(i / W) + rng.range(-1.6, 1.6);
      const emphasis = Math.max(strength[i], smoothed[i] * 0.85);
      if (emphasis < (rough ? 0.17 : 0.24) || rng.next() > emphasis * (rough ? 0.78 : 0.92)) continue;
      const turn = direction[i] + rng.range(-0.35, 0.35);
      const n = rough ? rng.range(5, 14) : rng.range(2, 6);
      const dx = n * Math.cos(turn), dy = n * Math.sin(turn);
      const drift = rough ? rng.range(-3, 3) : rng.range(-1, 1);
      stroke(ctx, [[px - dx, py - dy], [px + drift, py], [px + dx, py + dy + drift]],
        emphasis * (rough ? 0.17 : 0.59), rough ? 0.65 : 1);
    }
  }
}

/** Draw graphite from the current camera buffers and encode the actual page once for the Collection. */
export function drawPencil({ geometry, colour, width: W = SKETCH_WIDTH, height: H = SKETCH_HEIGHT, sceneEdges }: SketchCapture, seed: number): string {
  const rng = new Rng(seed);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The drawing canvas is unavailable.');
  const paper = ctx.createImageData(W, H);
  const ids = new Uint8Array(W * H);
  const depth = new Float32Array(ids.length);
  const angle = new Float32Array(ids.length);
  const shade = new Float32Array(ids.length);
  const tone = new Float32Array(ids.length);
  const luma = Float32Array.from(ids, (_, i) => {
    const p = i * 4;
    return (colour[p] * 0.2126 + colour[p + 1] * 0.7152 + colour[p + 2] * 0.0722) / 255;
  });
  const nearbyLuma = sceneEdges && soften(luma, 6, W, H);
  for (let i = 0; i < ids.length; i++) {
    const p = i * 4;
    const encoded = geometry[p + 3];
    const grain = rng.range(-4, 4);
    paper.data.set([247 + grain, 237 + grain, 215 + grain, 255], p);
    if (!encoded) continue;
    ids[i] = sceneEdges || encoded < 128 ? 1 : 2;
    depth[i] = encoded;
    const nx = geometry[p] / 127.5 - 1, ny = 1 - geometry[p + 1] / 127.5, nz = geometry[p + 2] / 127.5 - 1;
    const tilt = clamp(Math.hypot(nx, ny) * 3);
    const direction = Math.atan2(nx, -ny);
    angle[i] = Math.atan2(tilt * Math.sin(2 * direction) + (1 - tilt) * Math.sin(-1.1),
                         tilt * Math.cos(2 * direction) + (1 - tilt) * Math.cos(-1.1)) / 2;
    const light = clamp(-0.48 * nx - 0.62 * ny + 0.62 * nz);
    const dark = clamp((0.65 - luma[i]) / 0.51);
    if (sceneEdges && nearbyLuma) {
      // Leave flat sky, sea and sand broadly open, with graphite collecting at local contrast.
      const localShadow = clamp((nearbyLuma[i] - luma[i]) * 3.2);
      shade[i] = clamp(0.11 * (1 - light) + dark * 0.22 + localShadow * 0.5 + sceneEdges.strength[i] * 0.69);
    } else shade[i] = clamp(0.38 * (1 - light) + 0.67 * dark + (ids[i] === 2 ? 0.13 : 0));
    tone[i] = shade[i] ** 1.65;
  }
  const wash = soften(tone, 4, W, H);
  for (let i = 0; i < ids.length; i++) {
    const p = i * 4;
    const ink = wash[i] * 0.32 * rng.range(0.82, 1.15);
    paper.data[p] -= 197 * ink;
    paper.data[p + 1] -= 195 * ink;
    paper.data[p + 2] -= 178 * ink;
  }

  ctx.putImageData(paper, 0, 0);
  ctx.strokeStyle = PALETTE.sketchPencil;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const cross of [false, true]) {
    const step = cross ? 5 : 3;
    for (let y = 2; y < H - 2; y += step) {
      for (let x = 2; x < W - 2; x += step) {
        let px = x + rng.range(-1.7, 1.7), py = y + rng.range(-1.7, 1.7);
        const start = pixelAt(W, px, py);
        const id = ids[start];
        const value = shade[start];
        const patch = 0.75 + 0.30 * Math.sin(x * 0.11 + Math.sin(y * 0.16));
        if (!id || rng.next() > (value - (cross ? 0.42 : 0.11)) * patch * 1.25) continue;
        const points: Point[] = [];
        let previous = angle[start];
        const drift = rng.range(-0.35, 0.35) + (cross ? 1.1 : 0);
        for (let j = 0, n = rng.int(4, 13); j < n; j++) {
          if (px < 1 || px > W - 2 || py < 1 || py > H - 2) break;
          const i = pixelAt(W, px, py);
          if (ids[i] !== id || Math.abs(depth[i] - depth[start]) > 4) break;
          let a = angle[i] + drift;
          if (Math.cos(a - previous) < 0) a += Math.PI;
          previous = a;
          points.push([px, py]);
          px += Math.cos(a) * 1.45;
          py += Math.sin(a) * 1.45;
        }
        stroke(ctx, points, (0.12 + value * 0.54) * rng.range(0.44, 1), rng.range(0.46, 0.94));
      }
    }
  }
  if (sceneEdges) drawSceneEdges(ctx, sceneEdges, rng);
  else contours(ctx, ids, shade, rng);
  return canvas.toDataURL('image/jpeg', 0.89);
}
