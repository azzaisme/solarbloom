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
  installed = true;
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
