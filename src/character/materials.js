import * as THREE from 'three';

const NOISE = /* glsl */ `
float hash31(vec3 p){ p = fract(p * vec3(.1031,.1030,.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(hash31(i), hash31(i+vec3(1,0,0)), f.x), mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x), mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vnoise(p); p *= 2.03; a *= .5; } return s; }
`;

const TIGER = /* glsl */ `
vec3 tigerSkin(vec2 uv, float seed){
  float n = fbm3(vec3(uv * vec2(4., 6.), seed));
  float y = uv.y * 8.5 + (n - .5) * 3.4 + sin(uv.x * 6.283 + seed) * .4;
  float band = abs(fract(y) - .5) * 2.;
  float width = .3 + .34 * fbm3(vec3(uv * vec2(7., 2.), seed + 9.));
  float taper = smoothstep(.0, .4, abs(uv.x - .5) * 2. + (n - .5) * .7);
  float stripe = smoothstep(width, width - .2, band) * mix(.2, 1., taper);
  vec3 fur = mix(vec3(.36, .16, .04), vec3(.62, .36, .11), fbm3(vec3(uv * 13., seed)));
  fur = mix(fur, vec3(.72, .62, .44), smoothstep(.84, 1., abs(uv.x * 2. - 1.)) * .4);
  fur *= .82 + .18 * sin(uv.x * 52. + n * 5.);
  return mix(fur, vec3(.03, .02, .015), stripe);
}
// 1 on the scalp (same function is mirrored on the CPU in hair.js)
float hairMask(vec3 p, vec3 eye){
  float drop = clamp((eye.z - .055 - p.z) * 1.5, 0., .165);
  float line = eye.y + .072 - drop + .006 * sin(p.x * 90.);
  float m = smoothstep(line - .003, line + .003, p.y) * step(abs(p.x), .12) * step(eye.y - .11, p.y);
  if (abs(p.x) > .066 && p.y < eye.y + .034 && p.z > eye.z - .14 && p.z < eye.z - .05) m = 0.;
  return m;
}
`;

// Skin: cool ash-dusted complexion that takes its colour from the fire and water light.
// Sacred markings (tripundra, third eye), blue throat, brows and the wrapped loin-cloth are
// painted procedurally in rest-pose space, so no UV textures are needed.
export function skinMaterial(landmarks, waistY) {
  const m = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.52, metalness: 0.0 });
  m.userData.uniforms = {
    uEyeL: { value: new THREE.Vector3(...landmarks.eyeL) },
    uEyeR: { value: new THREE.Vector3(...landmarks.eyeR) },
    uWaist: { value: waistY },
    uThirdEye: { value: 0.25 },
    uEmber: { value: new THREE.Color(1.0, 0.45, 0.1) },
  };
  m.customProgramCacheKey = () => 'skin';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRest;
uniform vec3 uEyeL; uniform vec3 uEyeR; uniform float uWaist; uniform float uThirdEye; uniform vec3 uEmber;
float gThird = 0.;
float gCloth = 0.;
float gHair = 0.;
${NOISE}${TIGER}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 p = vRest;
  float eyeY = uEyeL.y, eyeZ = uEyeL.z;
  float n = fbm3(p * 55.);
  // ash-dusted skin: mottled, paler on raised forms
  diffuseColor.rgb *= .86 + .28 * n;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.62, .64, .66), .22 * smoothstep(.45, .8, fbm3(p * 9. + 3.)));
  float face = step(eyeZ - .02, p.z) * step(abs(p.x), .09);
  // nilakantha: the blue throat
  float throat = smoothstep(eyeY - .21, eyeY - .16, p.y) * smoothstep(eyeY - .085, eyeY - .12, p.y) * smoothstep(.0, .03, p.z - (eyeZ - .09)) * smoothstep(.065, .03, abs(p.x));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.07, .16, .34), throat * .6);
  // brows
  for (int s = 0; s < 2; s++) {
    vec3 e = s == 0 ? uEyeL : uEyeR;
    float sx = (p.x - e.x) * (s == 0 ? 1. : -1.);          // + towards the temple
    float by = e.y + .0185 + .004 * cos(clamp(sx * 38., -1.6, 1.6)) - max(sx - .018, 0.) * .28;
    float brow = smoothstep(.0046, .0015, abs(p.y - by)) * smoothstep(-.021, -.012, sx) * smoothstep(.032, .02, sx) * face;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.03, .025, .02), brow * .85);
    // lash line of the lowered lid
    float lash = smoothstep(.0022, .0004, abs(p.y - (e.y - .0035 - sx * sx * 3.))) * smoothstep(.018, .012, abs(sx)) * face;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.03, .025, .02), lash * .6);
  }
  // lips
  float lips = smoothstep(.0085, .003, abs(p.y - (eyeY - .079))) * smoothstep(.026, .014, abs(p.x)) * step(eyeZ + .02, p.z);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.8, .58, .56), lips * .5);
  // tripundra: three lines of sacred ash across the forehead
  float fy = eyeY + .049;
  float lines = 0.;
  for (int k = -1; k <= 1; k++) lines = max(lines, smoothstep(.0036, .0018, abs(p.y - fy - float(k) * .0098 + p.x * p.x * 1.4)));
  lines *= smoothstep(.052, .034, abs(p.x)) * face * (.75 + .25 * fbm3(p * 400.));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.86, .85, .8), lines * .82);
  // the third eye: a vertical mark between the brows
  vec2 te = vec2(p.x, (p.y - (eyeY + .034)));
  float third = smoothstep(1., .5, length(te / vec2(.0034, .0105))) * face;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.42, .05, .03), third);
  gThird = third;
  // hair swept back over the scalp into the topknot
  float hm = hairMask(p, uEyeL * vec3(0., 1., 1.));
  if (hm > 0.) {
    vec3 c = p - vec3(0., eyeY + .13, eyeZ - .1);
    float streak = fbm3(vec3(atan(c.x, c.z) * 16., atan(c.y, length(c.xz)) * 16., 2.) * vec3(1., .22, 1.));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.026, .019, .014) * (.4 + 1.4 * streak), hm);
  }
  gHair = hm;
  // loin wrap painted on the body (the simulated panels hang over it)
  float hem = .835 + .012 * sin(atan(p.x, p.z) * 9.) ;
  float cloth = step(hem, p.y) * step(p.y, uWaist) * step(abs(p.x), .3);
  if (cloth > .5) {
    vec2 cuv = vec2(atan(p.x, p.z) / 6.2832 * 3. + .5, p.y * 2.2);
    diffuseColor.rgb = tigerSkin(cuv, 2.) * (.8 + .3 * fbm3(p * 30.));
  }
  gCloth = cloth;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor + (fbm3(vRest * 70.) - .5) * .22, .92, gCloth);
roughnessFactor = mix(roughnessFactor, .97, gHair);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += uEmber * gThird * uThirdEye * 3.;`);
  };
  return m;
}

// Cloth: 'tiger' (loin panels) or 'silk' (sashes) with a ragged hem.
export function fabricMaterial(kind = 'tiger', seed = 1) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: kind === 'tiger' ? 0.9 : 0.55, metalness: 0, side: THREE.DoubleSide });
  m.defines = { USE_UV: '' };
  m.customProgramCacheKey = () => 'fabric-' + kind + seed; // three caches programs by onBeforeCompile source
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}${TIGER}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float rag = fbm3(vec3(vUv.x * 9., 0., ${seed.toFixed(1)})) * .16 + fbm3(vec3(vUv.x * 40., 2., ${seed.toFixed(1)})) * .06;
  float round = pow(abs(vUv.x * 2. - 1.), 2.4) * ${kind === 'tiger' ? '.34' : '.0'};
  if (vUv.y > 1. - rag - round) discard;
  ${kind === 'tiger'
    ? `diffuseColor.rgb = tigerSkin(vec2(vUv.x, vUv.y * .7), ${seed.toFixed(1)});`
    : `vec3 silk = mix(vec3(.42, .07, .03), vec3(.62, .16, .04), fbm3(vec3(vUv * vec2(6., 30.), ${seed.toFixed(1)})));
       float border = smoothstep(.2, .12, min(vUv.x, 1. - vUv.x));
       diffuseColor.rgb = mix(silk, vec3(.85, .58, .18), border * (.6 + .4 * step(.5, fract(vUv.y * 40.))));`}
}`);
  };
  return m;
}

export const gold = () => new THREE.MeshStandardMaterial({ color: 0xd8a343, roughness: 0.34, metalness: 1.0 });
export const rudraksha = () => new THREE.MeshStandardMaterial({ color: 0x4a2414, roughness: 0.78, metalness: 0.0 });
export const serpentMaterial = () => {
  const m = new THREE.MeshStandardMaterial({ color: 0x2c3a30, roughness: 0.36, metalness: 0.35 });
  m.defines = { USE_UV: '' };
  m.customProgramCacheKey = () => 'serpent';
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{
  // overlapping scales + pale belly
  vec2 g = vUv * vec2(9., 22.); g.x += step(1., mod(g.y, 2.)) * .5;
  vec2 f = fract(g) - .5;
  float scale = smoothstep(.55, .2, length(f));
  diffuseColor.rgb *= .45 + .75 * scale;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.5, .46, .3), smoothstep(.3, .1, abs(fract(vUv.x / 3.) - .5)) * .5);
}`);
  };
  return m;
};
