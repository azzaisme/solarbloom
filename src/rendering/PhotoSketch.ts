import * as pc from 'playcanvas';
import type { SketchCapture } from './SketchCapture';

interface CapturedPhoto {
  colour: Uint8Array;
  width: number;
  height: number;
  projectionX: number;
  projectionY: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Queue a depth read for the same frame as the PNG shutter, without moving or redrawing the subjects. */
export async function capturePhotoSketch(
  app: pc.AppBase, camera: pc.CameraComponent, post: pc.CameraFrame | undefined,
  background: string, filter: string,
): Promise<SketchCapture> {
  const source = app.graphicsDevice.canvas;
  const scale = Math.min(1, 560 / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const reader = new pc.SceneDepthReader(camera);
  let restoreDepth: (() => void) | undefined;
  let frame: pc.EventHandle | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (post) {
      const prior = post.rendering.sceneDepthMap;
      if (!prior) {
        restoreDepth = () => {
          post.rendering.sceneDepthMap = prior;
          if (post.enabled) post.update();
        };
        post.rendering.sceneDepthMap = true;
        post.update();
      }
    } else {
      camera.requestSceneDepthMap(true);
      restoreDepth = () => camera.requestSceneDepthMap(false);
    }
    const depth = reader.read(new pc.Vec4(0, 0, 1, 1), width, height);
    const image = new Promise<CapturedPhoto>((resolve, reject) => {
      frame = app.once('frameend', () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('The photo canvas is unavailable.');
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, width, height);
          ctx.filter = filter || 'none';
          ctx.drawImage(source, 0, 0, width, height);
          const m = camera.projectionMatrix.data;
          resolve({ colour: new Uint8Array(ctx.getImageData(0, 0, width, height).data), width, height, projectionX: m[0], projectionY: m[5] });
        } catch (error) {
          reject(error);
        } finally {
          restoreDepth?.();
          restoreDepth = undefined;
        }
      });
    });
    const expired = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('The photo frame did not finish.')), 12000);
    });
    app.renderNextFrame = true;
    const [photo, pixels] = await Promise.race([Promise.all([image, depth]), expired]);
    return photoFields(photo, pixels);
  } finally {
    clearTimeout(timeout);
    frame?.off();
    restoreDepth?.();
    reader.destroy();
  }
}

/** Reconstruct a view-space normal from neighbouring depths. Colour edges also catch water and fine texture. */
function photoFields(photo: CapturedPhoto, pixels: Float32Array | null): SketchCapture {
  const { width, height, colour, projectionX, projectionY } = photo;
  const depth = new Float32Array(width * height).fill(Infinity);
  if (pixels) for (let y = 0; y < height; y++) depth.set(pixels.subarray((height - 1 - y) * width, (height - y) * width), y * width);
  const luma = Float32Array.from(depth, (_, i) => {
    const p = i * 4;
    return (0.21 * colour[p] + 0.72 * colour[p + 1] + 0.07 * colour[p + 2]) / 255;
  });
  const geometry = new Uint8Array(depth.length * 4);
  const hasSceneDepth = depth.some(Number.isFinite);
  const strength = new Float32Array(depth.length);
  const direction = new Float32Array(depth.length);
  const usable = (d: number, near: number) => Number.isFinite(d) && Math.abs(d - near) < Math.max(0.45, near * 0.12);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, p = i * 4;
    const d = depth[i];
    const hasDepth = Number.isFinite(d) && d > 0;
    const lr = depth[i + 1], ll = depth[i - 1], up = depth[i - width], dn = depth[i + width];
    const zLeft = usable(ll, d) ? ll : d, zRight = usable(lr, d) ? lr : d;
    const zUp = usable(up, d) ? up : d, zDown = usable(dn, d) ? dn : d;
    const gx = luma[i + 1] - luma[i - 1], gy = luma[i + width] - luma[i - width];
    const colourEdge = Math.hypot(gx, gy);
    let nx = -gx * 5, ny = gy * 5, nz = 1;
    let occlusion = 0;
    if (hasDepth) {
      const sx = (2 * (x + 0.5) / width - 1) / projectionX;
      const sy = (1 - 2 * (y + 0.5) / height) / projectionY;
      const dx = zRight - zLeft, dy = zUp - zDown;
      const ux = sx * dx + (zRight + zLeft) / (width * projectionX);
      const uy = sy * dx;
      const vx = sx * dy;
      const vy = sy * dy + (zUp + zDown) / (height * projectionY);
      nx = dx * vy - uy * dy;
      ny = ux * dy - dx * vx;
      nz = ux * vy - uy * vx;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      occlusion = [ll, lr, up, dn].some((other) => !usable(other, d)) ? 0.33 : 0;
    }
    const length = Math.hypot(nx, ny, nz) || 1;
    geometry[p] = (nx / length * 0.5 + 0.5) * 255;
    geometry[p + 1] = (ny / length * 0.5 + 0.5) * 255;
    geometry[p + 2] = (nz / length * 0.5 + 0.5) * 255;
    // Empty sky stays open paper. Subtle colour outlines still survive where depth cannot represent the view.
    geometry[p + 3] = hasDepth ? clamp(12 + 22 * Math.log2(1 + d), 1, 127) : colourEdge > 0.065 || !hasSceneDepth ? 65 : 0;
    strength[i] = clamp(colourEdge * 2.8 + occlusion, 0, 1);
    if (colourEdge < 0.06 && occlusion && hasDepth) {
      const jump = (other: number) => usable(other, d) ? 0 : 1;
      direction[i] = Math.atan2(jump(dn) - jump(up), jump(lr) - jump(ll)) + Math.PI / 2;
    } else direction[i] = Math.atan2(gy, gx) + Math.PI / 2;
  }
  return { geometry, colour, sceneEdges: { strength, direction }, width, height };
}
