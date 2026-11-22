import * as pc from 'playcanvas';

/**
 * Look 1.3: a warm rim on silhouettes. A directional back light barely shows in this high camera view (the faces
 * it lights point away from the camera), so the rim is a view-dependent term added to every lit standard
 * material's emission: strongest where a surface turns edge-on to the camera, and on the side facing the sun.
 * It is tinted partly by the surface's own albedo and partly by the rim's gold (Phase 6), so it reads as warm
 * light catching the edge, not as an outline.
 *
 * Unlit materials (glows, overlays, fog) and the shadow and depth passes don't define LIT_NEEDS_NORMAL, so they
 * keep the stock chunk. WebGPU (WGSL) keeps the stock chunk too; the game runs on WebGL2.
 */
const RIM_GLSL = `
uniform vec4 look_rim;
uniform vec3 look_rimDir;
uniform vec3 look_camPos;
uniform float look_vcGlow;
void addLookRim() {
#if defined(LOOK_VC_GLOW) && defined(STD_DIFFUSE_VERTEX)
	// Look 1.9: the shared vertex-colour material glows where the vertex alpha is below 1.
	dEmission += dAlbedo * (1.0 - vVertexColor.a) * look_vcGlow;
#endif
#if defined(LIT_NEEDS_NORMAL) && defined(FORWARD_PASS)
	vec3 v = normalize(look_camPos - vPositionW);
	// Phase 6: a golden edge light, like the reference. Only surfaces that really turn edge-on to the camera catch
	// it (flat ground seen from above stays clear), it is strongest on the side facing the sun, and it carries its
	// own gold as well as the surface's colour, so leaves, stone and machines all get a warm yellow edge.
	float edge = pow(smoothstep(0.5, 1.0, 1.0 - clamp(dot(dNormalW, v), 0.0, 1.0)), look_rim.a);
	float sun = clamp(dot(dNormalW, look_rimDir) * 0.5 + 0.5, 0.0, 1.0);
	float side = 0.12 + 0.88 * sun * sun;
	dEmission += look_rim.rgb * (dAlbedo * 0.55 + 0.16) * edge * side;
#endif
}
`;

/**
 * E27.1 (#679): haze toward the horizon. With the skyline gone (#681) the camera looks straight out over the sea, and
 * from the low follow camera the whole far sea (and the far coast) is squeezed into a few rows of pixels just under
 * the horizon, long before the depth fog has caught up: a half-fogged sea met the sky in a hard line. This thickens
 * the haze for far surfaces seen close to the horizon line: by how little below the camera they are (as an angle) and,
 * so nothing near is touched, by how far away they are. Lit and unlit standard materials only (particles and splats
 * include the fog chunk too, without a world position).
 */
const HORIZON_GLSL = `
#if !defined(VERTEXSHADER) && defined(LIT_BLEND_TYPE) && (FOG != NONE)
uniform vec3 look_hzCam;
uniform vec4 look_horizon;
float lookHorizonFog(float f) {
	vec3 d = vPositionW - look_hzCam;
	float len = max(length(d), 1e-4);
	float down = -d.y / len;
	float h = (1.0 - smoothstep(0.0, look_horizon.x, down)) * smoothstep(look_horizon.y, look_horizon.z, len) * look_horizon.w;
	return min(f, 1.0 - h);
}
#else
float lookHorizonFog(float f) { return f; }
#endif
`;

let installed = false;

/** Installs the rim into the standard emissive chunk (once per device; materials compile it on first use). */
export function installLookShaders(device: pc.GraphicsDevice) {
  if (installed || device.isWebGPU) return;
  const chunks = pc.ShaderChunks.get(device, pc.SHADERLANGUAGE_GLSL);
  const stock = chunks.get('emissivePS');
  if (!stock || stock.includes('look_rim')) return;
  // getEmission() runs after getAlbedo() and getNormal() in the standard front end, so both are ready here.
  // The rim is added at the end of getEmission(): the stock chunk ends with the function's closing brace.
  const at = stock.lastIndexOf('}');
  chunks.set('emissivePS', RIM_GLSL + stock.slice(0, at) + '\taddLookRim();\n' + stock.slice(at));
  const fog = chunks.get('fogPS');
  const mixFrag = 'return mix(fog_color * dBlendModeFogFactor, color, getFogFactor());';
  if (fog && fog.includes(mixFrag) && !fog.includes('lookHorizonFog')) {
    // the fragment addFog() (the vertex one takes a depth) mixes by the horizon haze too; its helper goes in first
    const at2 = fog.indexOf('#ifdef VERTEXSHADER\n\tvec3 addFog');
    const withHelper = at2 >= 0 ? fog.slice(0, at2) + HORIZON_GLSL + fog.slice(at2) : fog + HORIZON_GLSL;
    if (at2 >= 0) chunks.set('fogPS', withHelper.replace(mixFrag, 'return mix(fog_color * dBlendModeFogFactor, color, lookHorizonFog(getFogFactor()));'));
  }
  setLookHorizon(device, 1, 0, 1, 0, { x: 0, y: 0, z: 0 });
  installed = true;
}

const hz = new Float32Array(4);
const hzCam = new Float32Array(3);

/**
 * Per frame: the horizon haze. `band` is the angle (degrees below the camera) over which it fades out; it reaches
 * full strength `strength` beyond `far` and none nearer than `near` (world units from the camera).
 */
export function setLookHorizon(device: pc.GraphicsDevice, band: number, near: number, far: number, strength: number, camPos: { x: number; y: number; z: number }) {
  hz[0] = Math.max(1e-4, Math.sin((band * Math.PI) / 180));
  hz[1] = near;
  hz[2] = Math.max(near + 1e-3, far);
  hz[3] = strength;
  hzCam[0] = camPos.x;
  hzCam[1] = camPos.y;
  hzCam[2] = camPos.z;
  device.scope.resolve('look_horizon').setValue(hz);
  device.scope.resolve('look_hzCam').setValue(hzCam);
}

/** The horizon haze's share (0 none … 1 full) for a point `down` degrees below the camera, `dist` away (tests). */
export function horizonHaze(down: number, dist: number, band: number, near: number, far: number, strength: number): number {
  const ss = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return (1 - ss(0, Math.sin((band * Math.PI) / 180), Math.sin((down * Math.PI) / 180))) * ss(near, Math.max(near + 1e-3, far), dist) * strength;
}

const rim = new Float32Array(4);
const dir = new Float32Array(3);
const cam = new Float32Array(3);

/** Per-frame rim uniforms: colour × intensity (linear), edge power, the direction toward the sun, the camera. */
export function setLookRim(device: pc.GraphicsDevice, colour: pc.Color, intensity: number, power: number, toSun: pc.Vec3, camPos: pc.Vec3, vcGlow: number) {
  device.scope.resolve('look_vcGlow').setValue(vcGlow);
  rim[0] = Math.pow(colour.r, 2.2) * intensity;
  rim[1] = Math.pow(colour.g, 2.2) * intensity;
  rim[2] = Math.pow(colour.b, 2.2) * intensity;
  rim[3] = power;
  dir[0] = toSun.x;
  dir[1] = toSun.y;
  dir[2] = toSun.z;
  cam[0] = camPos.x;
  cam[1] = camPos.y;
  cam[2] = camPos.z;
  device.scope.resolve('look_rim').setValue(rim);
  device.scope.resolve('look_rimDir').setValue(dir);
  device.scope.resolve('look_camPos').setValue(cam);
}

/**
 * E27.1 (#679): the scene fog colour (0–1 sRGB) that matches the sky's horizon `[r, g, b]` as it is seen. The sky
 * dome and the clear colour reach the screen as given, while the engine decodes the fog colour (pow 2.2) before
 * fogging, so the fogged distance landed darker than the sky behind it. The gap is wide in dark colours (night:
 * 51,72,124 against 110,131,171) and small in bright ones (noon: 200 against 220), so the fog is encoded by `dark`
 * (0 day … 1 night): at dusk and night it lands on the sky's colour exactly, and by day the distance keeps its
 * clearer haze (encoding there would pale the whole distance) and the horizon haze alone softens the line.
 */
export function fogMatchingSky(r: number, g: number, b: number, dark = 1): [number, number, number] {
  const k = Math.min(1, Math.max(0, dark));
  const f = (c: number) => {
    const x = Math.min(1, Math.max(0, c));
    return x + (Math.pow(x, 1 / 2.2) - x) * k;
  };
  return [f(r), f(g), f(b)];
}
