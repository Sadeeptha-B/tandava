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
// hairline (mirrored on the CPU by scalpDepth() in hair.js): high on the forehead, then at the sides it
// comes down past the temple into a sideburn in front of the ear; the ear itself stays bare
float hairMask(vec3 p, vec3 eye){
  float u = eye.z - p.z, ax = abs(p.x);
  float drop = clamp((u - .055) * 1.5, 0., .165);
  float sb = .085 * smoothstep(.035, .06, ax) * smoothstep(.02, .068, u) * (1. - smoothstep(.11, .15, u));
  float line = eye.y + .064 - drop - sb + .004 * sin(p.x * 90.) - .01 * (1. - smoothstep(0., .02, ax));
  float m = smoothstep(line - .003, line + .003, p.y) * step(ax, .12) * step(eye.y - .11, p.y);
  if (ax > .066 && p.y < eye.y + .02 && u > .07 && u < .125) m = 0.;
  return m;
}
`;

// Skin: cool ash-dusted complexion that takes its colour from the fire and water light.
// Sacred markings (tripundra, third eye), blue throat, brows and the wrapped loin-cloth are
// painted procedurally in rest-pose space, so no UV textures are needed.
export function skinMaterial(landmarks, waistY) {
  const m = new THREE.MeshStandardMaterial({ color: 0x4d6488, roughness: 0.5, metalness: 0.0 });
  m.userData.uniforms = {
    uEyeL: { value: new THREE.Vector3(...landmarks.eyeL) },
    uEyeR: { value: new THREE.Vector3(...landmarks.eyeR) },
    uWaist: { value: waistY },
    uThirdEye: { value: 0.25 },
    uLipY: { value: (landmarks.lipUpper[1] + landmarks.lipLower[1]) / 2 },
    uChinY: { value: landmarks.chin[1] },
    uEmber: { value: new THREE.Color(1.0, 0.45, 0.1) },
  };
  m.customProgramCacheKey = () => 'skin';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;\nattribute float cavity;\nvarying float vCav;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;\nvCav = cavity;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRest;
varying float vCav;
uniform vec3 uEyeL; uniform vec3 uEyeR; uniform float uWaist; uniform float uThirdEye; uniform vec3 uEmber; uniform float uLipY; uniform float uChinY;
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
  diffuseColor.rgb *= .9 + .2 * n;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.56, .6, .68), .12 * smoothstep(.45, .8, fbm3(p * 9. + 3.)));
  // muscle separation: grooves darken and cool, ridges catch a little more light
  float cv = clamp(vCav, -1., 1.);
  diffuseColor.rgb *= 1. + .22 * max(cv, 0.) - .5 * smoothstep(0., .8, -cv);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.7, .76, 1.), .4 * smoothstep(0., .7, -cv));
  float face = step(eyeZ - .02, p.z) * step(abs(p.x), .09);
  // nilakantha: the blue throat
  float throat = smoothstep(eyeY - .21, eyeY - .16, p.y) * smoothstep(eyeY - .085, eyeY - .12, p.y) * smoothstep(.0, .03, p.z - (eyeZ - .09)) * smoothstep(.065, .03, abs(p.x));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.07, .16, .34), throat * .6);
  // brows: full, dark, sweeping out to the temples; kohl along the lowered lids
  for (int s = 0; s < 2; s++) {
    vec3 e = s == 0 ? uEyeL : uEyeR;
    float sx = (p.x - e.x) * (s == 0 ? 1. : -1.);          // + towards the temple
    float by = e.y + .0168 + .0018 * cos(clamp((sx - .006) * 30., -1.6, 1.6)) + sx * .07 - max(sx - .03, 0.) * .3;
    float taper = mix(.0092, .0035, smoothstep(-.005, .042, sx));
    float hairs = .75 + .25 * fbm3(vec3(p.x * 900., p.y * 300., 1.));
    float brow = smoothstep(taper, taper * .35, abs(p.y - by)) * smoothstep(-.024, -.014, sx) * smoothstep(.043, .03, sx) * face * hairs;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.018, .014, .011), brow * .95);
    float seam = e.y - .0042 - sx * sx * 2.2 + max(sx - .012, 0.) * .32;
    float kohl = smoothstep(.0034, .0008, abs(p.y - seam)) * smoothstep(-.02, -.014, sx) * smoothstep(.026, .016, sx) * face;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.012, .01, .01), kohl * .9);
    // soft shadow in the socket gives the eyes depth
    float socket = smoothstep(.022, .004, length(vec2(sx * .8, p.y - e.y - .004))) * face;
    diffuseColor.rgb *= 1. - .28 * socket;
  }
  // lips: fuller colour, darker parting line
  float lipBand = smoothstep(.0115, .0045, abs(p.y - uLipY)) * smoothstep(.031, .019, abs(p.x)) * step(eyeZ + .015, p.z);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.62, .34, .32) + vec3(.015, .0, .0), lipBand * .8);
  // clean-shaven: only a soft shadow under the lower lip and along the jaw to model the face
  {
    float under = smoothstep(.012, .0, abs(p.y - (uLipY - .016))) * smoothstep(.022, .006, abs(p.x)) * step(eyeZ + .01, p.z);
    diffuseColor.rgb *= 1. - .16 * under;
  }
  // tripundra: three lines of sacred ash across the forehead
  float fy = eyeY + .0415;
  float lines = 0.;
  for (int k = -1; k <= 1; k++) lines = max(lines, smoothstep(.0031, .0015, abs(p.y - fy - float(k) * .0082 + p.x * p.x * 1.4)));
  lines *= smoothstep(.05, .032, abs(p.x)) * face * (.75 + .25 * fbm3(p * 400.));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.86, .85, .8), lines * .82);
  // the third eye: a vertical mark between the brows
  vec2 te = vec2(p.x, (p.y - (eyeY + .03)));
  float third = smoothstep(1., .5, length(te / vec2(.0032, .0098))) * face;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.42, .05, .03), third);
  gThird = third;
  // hair swept back over the scalp into the topknot
  float hm = hairMask(p, uEyeL * vec3(0., 1., 1.));
  if (hm > 0.) {
    vec3 c = p - vec3(0., eyeY + .13, eyeZ - .1);
    float streak = fbm3(vec3(atan(c.x, c.z) * 16., atan(c.y, length(c.xz)) * 16., 2.) * vec3(1., .22, 1.));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.012, .009, .007) * (.4 + 1.4 * streak), hm);
  }
  gHair = max(gHair, hm);
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
roughnessFactor = mix(roughnessFactor + (fbm3(vRest * 70.) - .5) * .22 - .08 * max(vCav, 0.), .92, gCloth);
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
  float round = pow(abs(vUv.x * 2. - 1.), 4.) * ${kind === 'tiger' ? '.12' : '.0'};
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

// Sash: a strip of tiger skin edged with a narrow gold-thread border (uv.x across, uv.y along)
export function sashMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  m.defines = { USE_UV: '' };
  m.customProgramCacheKey = () => 'sash';
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}${TIGER}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 c = tigerSkin(vec2(vUv.x * .5 + .25, vUv.y * .09), 7.);
  float edge = min(vUv.x, 1. - vUv.x);
  float trim = smoothstep(.1, .07, edge) * smoothstep(.0, .025, edge);
  c = mix(c, vec3(.78, .54, .2) * (.75 + .25 * step(.5, fract(vUv.y * 3.))), trim);
  c *= (.55 + .45 * smoothstep(.0, .05, edge)) * .72;
  diffuseColor.rgb = c;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{ float edge = min(vUv.x, 1. - vUv.x); roughnessFactor = mix(roughnessFactor, .35, smoothstep(.1, .07, edge) * smoothstep(.0, .025, edge)); }`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
{ float edge = min(vUv.x, 1. - vUv.x); metalnessFactor = smoothstep(.1, .07, edge) * smoothstep(.0, .025, edge); }`);
  };
  return m;
}

export const pearl = () => new THREE.MeshStandardMaterial({ color: 0xe9e2d4, roughness: 0.2, metalness: 0.0 });
export const gem = (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.08, metalness: 0.2, emissive: hex, emissiveIntensity: 0.2 });

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

// Eyes: sclera, amber iris and pupil painted on the eyeball in rest space, gaze lowered.
export function eyeMaterial(landmarks) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.16, metalness: 0.0 });
  const u = { uEyeL: { value: new THREE.Vector3(...landmarks.eyeL) }, uGlow: { value: 0.0 }, uEmber: { value: new THREE.Color(1.0, 0.5, 0.15) } };
  m.userData.uniforms = u;
  m.customProgramCacheKey = () => 'eye';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest; uniform vec3 uEyeL; uniform float uGlow; uniform vec3 uEmber; float gIris = 0.;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 c = vec3(sign(vRest.x) * uEyeL.x, uEyeL.y, uEyeL.z);
  vec3 d = normalize(vRest - c);
  float a = acos(clamp(dot(d, normalize(vec3(0., -.2, 1.))), -1., 1.));
  vec3 sclera = vec3(.46, .45, .43) * (1. - .5 * smoothstep(.5, 1.3, a));
  vec3 iris = mix(vec3(.16, .075, .02), vec3(.04, .02, .008), smoothstep(.16, .46, a));
  iris *= .8 + .4 * fract(sin(atan(d.x, d.y) * 40.) * 43.);
  vec3 col = mix(iris, sclera, smoothstep(.47, .52, a));
  col *= 1. - .85 * smoothstep(.5, .44, a) * smoothstep(.36, .5, a);   // limbal ring
  col = mix(vec3(.004), col, smoothstep(.2, .25, a));                    // pupil
  diffuseColor.rgb = col;
  gIris = smoothstep(.5, .44, a) * smoothstep(.2, .26, a);
}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uEmber * gIris * uGlow;');
  };
  return m;
}
