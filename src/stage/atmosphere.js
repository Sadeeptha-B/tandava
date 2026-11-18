import * as THREE from 'three';
import { RING } from '../fx/ring.js';

// One atmosphere shared by every fogged surface (built-in materials through the fog chunks, the water
// and sky through ATMO_GLSL):
//  - exp2 fog whose density thickens towards the water (low mist; tall forms rise out of it),
//  - a fog colour that brightens towards the far end of the hall, so distant architecture reads as
//    silhouettes against light and near forms stay dark (atmospheric perspective),
//  - the ring's fire scattered by the fog, closed-form along each view ray, so the hall's air glows
//    gold around the dancer instead of the ring sitting on cold teal.
export const atmoUniforms = {
  uAtmoRing: { value: new THREE.Color() },   // ring in-scatter colour (HDR, includes the ring's power)
  uAtmoGlow: { value: new THREE.Color() },   // colour of the luminous distance
  uAtmoFog: { value: new THREE.Color() },    // base fog colour
  uAtmoDensity: { value: 0.03 },
  uAtmo: { value: new THREE.Vector4(1.6, 1.4, 14, 1.2) }, // x: mist height scale (m), y: low-mist boost, z: ring scatter gain, w: its falloff (1/m)
};

const f = (v) => v.toFixed(4);
const NR = 8;
export const ATMO_GLSL = /* glsl */ `
uniform vec3 uAtmoRing; uniform vec3 uAtmoGlow; uniform vec3 uAtmoFog; uniform float uAtmoDensity; uniform vec4 uAtmo;

// optical depth along a ray of length L: exp2 fog scaled by the mean of a height profile
// (1 + boost * exp(-y / H)) / (1 + boost), integrated in closed form
float atmoTau(vec3 ro, vec3 rd, float L) {
  float H = uAtmo.x, B = uAtmo.y;
  float y0 = max(ro.y, 0.), y1 = max(ro.y + rd.y * L, 0.), dy = y1 - y0;
  float m = abs(dy) < 1e-3 ? exp(-y0 / H) : H * (exp(-y0 / H) - exp(-y1 / H)) / dy;
  float dl = uAtmoDensity * L;
  return dl * dl * (1. + B * m) / (1. + B * .35);
}

// fog colour seen along a direction: dark close to the camera's sides and overhead, luminous at the hall's far end
vec3 atmoFogColor(vec3 rd) {
  float fwd = max(-rd.z, 0.);
  float aperture = pow(fwd, 18.) * exp(-abs(rd.y - .02) * 7.);      // the bright distance behind the ring
  float wide = pow(fwd, 3.) * exp(-abs(rd.y) * 3.);                  // broad lift so the far colonnade separates
  return uAtmoFog * (.55 + .7 * wide) + uAtmoGlow * (aperture + .12 * wide);
}

// light from the ring's fire scattered towards the camera (inverse-square points on the ring, no extinction)
vec3 atmoRing(vec3 ro, vec3 rd, float L) {
  // rays passing well clear of the ring get nothing worth computing (< 2% of the peak)
  vec3 oc = vec3(${f(RING.center.x)}, ${f(RING.center.y)}, ${f(RING.center.z)}) - ro;
  float bc = dot(oc, rd);
  if (dot(oc, oc) - bc * bc > ${f((RING.radius + 3.4) ** 2)} || bc < -3.) return vec3(0.);
  float s = 0.;
  for (int i = 0; i < ${NR}; i++) {
    float a = float(i) * ${f((Math.PI * 2) / NR)} + .3927;
    vec3 op = oc + vec3(cos(a), sin(a), 0.) * ${f(RING.radius)};
    float b = dot(op, rd);
    float h2 = max(dot(op, op) - b * b, 0.) + .2, h = sqrt(h2);
    // atan((L-b)/h) + atan(b/h) as one atan2 (each term lies in (-pi/2, pi/2), so the sum stays in range)
    s += atan(L * h, h2 - (L - b) * b) / h * exp(-h * uAtmo.w);
  }
  // a corona round the outside: rays seen through the ring's opening (the nebula, the dancer) keep their clarity
  float tp = (${f(RING.center.z)} - ro.z) / (abs(rd.z) > 1e-4 ? rd.z : -1e-4);
  float r = tp > 0. ? length(ro.xy + rd.xy * tp - vec2(${f(RING.center.x)}, ${f(RING.center.y)})) / ${f(RING.radius)} : 2.;
  s *= mix(.3, 1., smoothstep(.7, 1.02, r));
  return uAtmoRing * s * (uAtmo.z / ${NR}.);
}

vec3 atmoApply(vec3 col, vec3 world) {
  vec3 d = world - cameraPosition; float L = length(d); vec3 rd = d / max(L, 1e-4);
  float fog = 1. - exp(-atmoTau(cameraPosition, rd, L));
  return mix(col, atmoFogColor(rd), fog) + atmoRing(cameraPosition, rd, L);
}
`;

let installed = false;
/** Route three's fog chunks through the shared atmosphere. Call before any material compiles. */
export function installAtmosphere() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\nvarying vec3 vFogWorld;\n#endif';
  // world position from the view-space position (handles skinning and instancing for free)
  C.fog_vertex = '#ifdef USE_FOG\nvFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);\n#endif';
  C.fog_pars_fragment = `#ifdef USE_FOG\nuniform vec3 fogColor; uniform float fogDensity; uniform float fogNear; uniform float fogFar;\nvarying vec3 vFogWorld;\n${ATMO_GLSL}\n#endif`;
  C.fog_fragment = '#ifdef USE_FOG\ngl_FragColor.rgb = atmoApply(gl_FragColor.rgb, vFogWorld);\n#endif';
}

/** Give every fogged material under `root` the shared atmosphere uniforms (keeps each one's own program key). */
export function attachAtmosphere(root) {
  root.traverse((o) => {
    for (const m of [].concat(o.material ?? [])) {
      if (!m.fog || m.isShaderMaterial || m.userData.atmo) continue;
      m.userData.atmo = true;
      const key = m.customProgramCacheKey();
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = function (sh, r) { Object.assign(sh.uniforms, atmoUniforms); prev.call(this, sh, r); };
      m.customProgramCacheKey = () => key + '|atmo';
    }
  });
}

export function updateAtmosphere(palette, ringPower) {
  const u = atmoUniforms;
  u.uAtmoFog.value.copy(palette.fog);
  u.uAtmoGlow.value.copy(palette.skyGlow);
  u.uAtmoRing.value.copy(palette.ringFlame).lerp(palette.ringCore, 0.25).multiplyScalar(0.012 * ringPower);
}
