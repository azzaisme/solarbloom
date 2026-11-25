export const WIND_X = 0.8;
export const WIND_Z = -0.6;

/** Shared by stationary and transitioning vegetation so the same gust crosses both. */
export const WIND_GLSL = /* glsl */ `
uniform float uWindTime;
uniform float uWindStrength;
// the waymark's Bloom Pulse: a ring racing out from (x, z) at radius z, pushing the foliage outward by w as it passes
uniform vec4 uBloomWave;
vec3 windOffset(vec3 posW, float flex) {
	if (flex <= 0.0) return vec3(0.0);
	float ph = dot(posW.xz, vec2(0.37, 0.21));
	float wave = uWindTime * 1.2 + ph - dot(posW.xz, vec2(${WIND_X}, ${WIND_Z})) * 0.35;
	float g = uWindStrength * (0.55 + 0.45 * sin(wave) + 0.22 * sin(wave * 2.3 + 1.3));
	vec3 o = vec3(${WIND_X}, 0.0, ${WIND_Z}) * flex * g * 0.05;
	o += vec3(0.6, 0.0, 0.8) * flex * 0.012 * uWindStrength * sin(uWindTime * 1.9 + posW.y * 3.0 + ph);
	o += vec3(sin(uWindTime * 6.1 + ph * 13.0), 0.5 * sin(uWindTime * 7.7 + ph * 7.0), cos(uWindTime * 5.3 + ph * 11.0)) * flex * flex * 0.006 * uWindStrength;
	o.y -= flex * flex * g * g * 0.01;
	if (uBloomWave.w > 0.0) {
		vec2 dw = posW.xz - uBloomWave.xy;
		float dd = max(length(dw), 0.001);
		float band = exp(-pow((dd - uBloomWave.z) / 0.9, 2.0)) * uBloomWave.w;
		o.xz += dw / dd * flex * band * 0.12;
		o.y -= flex * band * 0.03;
	}
	return o;
}
`;
