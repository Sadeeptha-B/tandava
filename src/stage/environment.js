import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ATMO_GLSL, atmoUniforms } from './atmosphere.js';
import { RING } from '../fx/ring.js';

const GLSL_NOISE = /* glsl */ `
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), f.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), f.x), f.y); }
float fbm2(vec2 p){ float a = .5, s = 0.; for(int i=0;i<5;i++){ s += a*vnoise2(p); p = p*2.02 + 7.1; a *= .5; } return s; }
`;

export const MAX_IMPACTS = 8;

// Shallow reflective water over dark stone, a restrained colonnade receding into fog,
// a vast backdrop, low mist and a shaft of light from above.
export function createEnvironment({ quality }) {
  const group = new THREE.Group();
  const uniforms = {
    uTime: { value: 0 },
    uImpacts: { value: Array.from({ length: MAX_IMPACTS }, () => new THREE.Vector4(0, 0, -100, 0)) },
    uDeep: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uCam: { value: new THREE.Vector3() }, uEnergy: { value: 0 },
    uRingLight: { value: new THREE.Color(0, 0, 0) }, uCaustic: { value: new THREE.Color(0, 0, 0) }, // ring as a light on the stone; light thrown off the water
  };

  // ------------------------------------------------------------------ water
  const res = quality === 'high' ? 1024 : quality === 'medium' ? 640 : 384;
  const water = new Reflector(new THREE.PlaneGeometry(400, 400), {
    textureWidth: res, textureHeight: res, clipBias: 0.003, multisample: quality === 'low' ? 0 : 2,
    shader: {
      name: 'WaterShader',
      uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, ...uniforms, ...atmoUniforms },
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix; varying vec4 vUvR; varying vec3 vWorld;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz; vUvR = textureMatrix * vec4(position, 1.); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform float uTime; uniform vec4 uImpacts[${MAX_IMPACTS}];
        uniform vec3 uDeep; uniform vec3 uGlow; uniform vec3 uCam; uniform float uEnergy;
        varying vec4 vUvR; varying vec3 vWorld;
        ${GLSL_NOISE}
        ${ATMO_GLSL}
        void main(){
          vec2 p = vWorld.xz;
          float dist0 = length(p);
          // ambient wavelets (stronger near the dancer, where the water is always stirred)
          float stir = .5 + 1.5 * exp(-dist0 * .35) * (.4 + uEnergy);
          vec2 g = .0035 * stir * vec2(cos(p.x * 3.1 + uTime * .9 + sin(p.y * 2.)), cos(p.y * 2.7 - uTime * .7 + sin(p.x * 1.7)));
          g += .0022 * stir * vec2(cos(p.x * 9. + p.y * 4. + uTime * 1.6), cos(p.y * 8. - p.x * 5. - uTime * 1.3));
          g += .0025 * (vec2(vnoise2(p * 11. + uTime * .4), vnoise2(p * 11. - uTime * .35 + 9.)) - .5);
          float crest = 0.;
          for (int i = 0; i < ${MAX_IMPACTS}; i++) {
            vec4 im = uImpacts[i];
            float age = uTime - im.z;
            if (age > 0. && age < 7. && im.w > 0.) {
              vec2 d = p - im.xy; float dist = length(d) + 1e-3;
              float x = dist - age * 2.3;
              float env = exp(-x * x * 1.3) * exp(-age * .7) * im.w / (1. + dist * .3);
              g += (d / dist) * sin(x * 8.5) * env * .05;
              crest += pow(max(0., cos(x * 8.5)), 3.) * env;
              // trailing interference left behind the front
              float tail = (1. - smoothstep(-3.5, 0., x)) * smoothstep(-age * 2.3, -age * 2.3 + .6, x) * exp(-age * .9) * im.w;
              g += (d / dist) * sin(dist * 14. - age * 9.) * tail * .02;
            }
          }
          vec3 n = normalize(vec3(-g.x * 8., 1., -g.y * 8.));
          vec3 V = normalize(uCam - vWorld);
          float fres = .03 + .97 * pow(clamp(1. - dot(V, n), 0., 1.), 4.);
          vec2 uv = vUvR.xy / vUvR.w + g * vec2(1.2, 2.6);
          vec3 refl = texture2D(tDiffuse, uv).rgb;
          // soft second tap: cheap blur that grows with distance from the mirror line
          refl = mix(refl, texture2D(tDiffuse, uv + g * 2.5 + vec2(.003, 0.)).rgb, .35);
          vec3 col = mix(uDeep, refl, clamp(fres + .28, 0., 1.) * .92);
          col += uGlow * crest * .75;
          col += uGlow * .012 * exp(-dist0 * .5) * (.5 + uEnergy);   // faint luminous pool under the dancer
          col = atmoApply(col, vWorld);
          gl_FragColor = vec4(col, 1.);
        }`,
    },
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.018;
  group.add(water);
  const wu = water.material.uniforms;
  Object.assign(wu, atmoUniforms); // Reflector clones its uniforms; share the live atmosphere instead

  // dark stone just beneath the surface so feet read as standing *in* shallow water
  // (the reflector is opaque; the stone tint lives in uDeep)

  // ------------------------------------------------------------------ colonnade + distant shrine
  const stone = new THREE.MeshStandardMaterial({ color: 0x201d1a, roughness: 0.82, metalness: 0.05 }); // warm neutral, so firelight reads gold and the fog supplies the teal
  // carved courses and weathering, so the colonnade reads as worked stone rather than flat slabs
  stone.customProgramCacheKey = () => 'temple-stone';
  stone.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: uniforms.uTime, uEnergy: uniforms.uEnergy, uImpacts: wu.uImpacts, uRingLight: uniforms.uRingLight, uCaustic: uniforms.uCaustic });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp; attribute float aMono; varying float vMono;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 wpS = vec4(position, 1.);\n#ifdef USE_INSTANCING\nwpS = instanceMatrix * wpS;\n#endif\nvWp = (modelMatrix * wpS).xyz; vMono = aMono;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWp; varying float vMono;\nuniform float uTime; uniform float uEnergy; uniform vec4 uImpacts[${MAX_IMPACTS}]; uniform vec3 uRingLight; uniform vec3 uCaustic;\n${GLSL_NOISE}
// light thrown up off the stirred water: the bright cell walls of a drifting Voronoi network, two layers
float causticCells(vec2 p, float t){
  vec2 i = floor(p), f = fract(p);
  float d1 = 8., d2 = 8.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y), h = vec2(hash21(i + g), hash21(i + g + 17.3));
    vec2 o = g + .5 + .42 * sin(t + 6.2831 * h) - f;
    float d = dot(o, o);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return exp(-(sqrt(d2) - sqrt(d1)) * 5.5);
}
float caustic(vec2 p, float t){
  return causticCells(p, t) * (.55 + .45 * causticCells(p * 1.7 + 3.1, t * 1.3 + 2.)) * 1.6;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float course = smoothstep(.0, .06, abs(fract(vWp.y * .62) - .5) - .44) * (1. - vMono); // horizontal joints (built-up masonry only)
  float frieze = smoothstep(.3, .5, fbm2(vec2(atan(vWp.x, vWp.z) * 40., vWp.y * 3.))) * step(.72, fract(vWp.y * .155)) * (1. - vMono);
  // weathering sampled triplanar (by the surface's own facing), so mouldings don't show contour rings; plus fine grain
  vec3 gn = abs(normalize(cross(dFdx(vWp), dFdy(vWp)))); gn = gn * gn * gn * gn; gn /= gn.x + gn.y + gn.z;
  float wear = gn.x * fbm2(vWp.zy * vec2(.9, .6)) + gn.y * fbm2(vWp.xz * .9) + gn.z * fbm2(vWp.xy * vec2(.9, .6) + 3.7);
  wear = wear * .85 + .15 * (gn.x * vnoise2(vWp.zy * 22.) + gn.y * vnoise2(vWp.xz * 22.) + gn.z * vnoise2(vWp.xy * 22.));
  diffuseColor.rgb *= (.55 + .7 * wear) * (1. - .55 * course) * (1. + .5 * frieze);
}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec3 nW = inverseTransformDirection(normal, viewMatrix);
  // the ring of fire as a light: inverse-square points round the ring, so faces turned to it catch its gold
  float irr = 0.;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * .7854 + .3927;
    vec3 l = vec3(${RING.center.x.toFixed(3)}, ${RING.center.y.toFixed(3)}, ${RING.center.z.toFixed(3)}) + vec3(cos(a), sin(a), 0.) * ${RING.radius.toFixed(3)} - vWp;
    float d2 = dot(l, l);
    irr += max(dot(nW, l * inversesqrt(d2)), 0.) / (d2 + 1.);
  }
  // pooled around the dancer: it fades up the shafts, so the hall above stays in shadow
  vec3 ringE = uRingLight * irr * .125 * exp(-max(vWp.y - 2.5, 0.) * .16);
  // caustics just above the waterline, lit by the ring's light on the water there; a ripple arriving from a stamp brightens them
  // (light reflected off the water reaches faces turned sideways, not the tops of mouldings)
  float wl = exp(-max(vWp.y, 0.) * 1.3) * step(-.05, vWp.y) * (1. - abs(nW.y)) * (1. - abs(nW.y));
  vec3 caus = vec3(0.);
  if (wl > .01) {
    float swell = 0.;
    for (int i = 0; i < ${MAX_IMPACTS}; i++) {
      vec4 im = uImpacts[i]; float age = uTime - im.z;
      if (age > 0. && age < 9. && im.w > 0.) { float x = length(vWp.xz - im.xy) - age * 2.3; swell += exp(-x * x * .35) * exp(-age * .3) * im.w; }
    }
    // stretched vertically, as light reflected up a wall is
    vec2 cp = vec2(dot(vWp.xz, normalize(vec2(-nW.z, nW.x) + 1e-4)), vWp.y * .45) * 2.4;
    float cs = caustic(cp, uTime * (.7 + .5 * uEnergy + 1.5 * swell));
    float dc = length(vWp.xz - vec2(${RING.center.x.toFixed(3)}, ${RING.center.z.toFixed(3)}));
    caus = uCaustic * wl * cs * (1. + 2.5 * swell) / (1. + dc * dc * .03);
  }
  reflectedLight.directDiffuse += BRDF_Lambert(diffuseColor.rgb) * (ringE + caus);
}`);
  };
  const colGeo = templeColumn();
  const cols = [];
  // a broad hall: the inner rows stand well clear of the dancer so the space reads as expansive
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) {
    cols.push([sx * HALL.inner, -1 - i * HALL.bay, 1]);
    cols.push([sx * HALL.outer, -6 - i * HALL.bay, 1.25]);
  }
  const colonnade = new THREE.InstancedMesh(colGeo, stone, cols.length);
  const m = new THREE.Matrix4();
  cols.forEach(([x, z, s], i) => { m.makeScale(s, s, s).setPosition(x, 0, z); colonnade.setMatrixAt(i, m); });
  group.add(colonnade);
  // one continuous moulded beam along each inner row, resting on the brackets
  const beamGeo = templeBeam(cols[0][1] + 1.75, cols[cols.length - 2][1] - 1.75);
  for (const sx of [-1, 1]) {
    const beam = new THREE.Mesh(beamGeo, stone);
    beam.position.x = sx * HALL.inner;
    group.add(beam);
  }
  // dais the dancer stands on: a broad low stone disc barely breaking the surface
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.06, 64), new THREE.MeshStandardMaterial({ color: 0x0c1114, roughness: 0.55, metalness: 0.1 }));
  dais.position.y = -0.02;
  group.add(dais);

  // ------------------------------------------------------------------ sky
  // the sky's base colour is shared with the gopuram, so its base can dissolve into exactly what lies behind it
  const SKY_GLSL = /* glsl */ `
    uniform vec3 uTop; uniform vec3 uGlow; uniform float uTime; uniform float uEnergy;
    vec3 skyBase(vec3 d){
      float h = clamp(d.y, -1., 1.);
      float neb = fbm2(vec2(atan(d.x, -d.z) * 2.2, h * 3.) + uTime * .008);
      // the far end of the hall takes the colour distant fog takes on, so silhouettes melt into it
      vec3 col = uTop + atmoFogColor(d) * (.75 + .5 * neb) * (1. + .35 * uEnergy);
      // zenith: the source of the falling light
      return col + uGlow * pow(max(h, 0.), 6.) * 1.6 * (.6 + .4 * neb);
    }`;
  const skyU = { uTop: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uTime: uniforms.uTime, uEnergy: uniforms.uEnergy, ...atmoUniforms };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      ${GLSL_NOISE}
      ${ATMO_GLSL}
      ${SKY_GLSL}
      void main(){
        vec3 d = normalize(vWorld - cameraPosition);
        vec3 col = skyBase(d) + atmoRing(cameraPosition, d, 300.);
        // sparse stars
        float h = clamp(d.y, -1., 1.);
        vec2 sp = vec2(atan(d.x, d.z), asin(h)) * 60.;
        float st = step(.9965, hash21(floor(sp))) * smoothstep(.1, .5, h) * (.5 + .5 * sin(uTime * 1.5 + hash21(floor(sp) + 3.) * 40.));
        col += vec3(.7, .9, 1.) * st * .5;
        gl_FragColor = vec4(col, 1.);
      }`,
  }));
  sky.renderOrder = -10;
  group.add(sky);

  // distant gopuram – only ever a silhouette in the haze at the far end of the hall (see gopuram()).
  // Unlit. Its upper tiers stay a faint dark shape against the lit distance (fog capped at uSilhouette);
  // its base dissolves into the sky behind it, so it has no visible seam with the end of the colonnade.
  const gopU = { ...skyU, uSilhouette: { value: 0.8 } };
  const tower = new THREE.Mesh(gopuram(), new THREE.ShaderMaterial({
    uniforms: gopU, fog: false,
    vertexShader: `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uSilhouette; varying vec3 vWorld;
      ${GLSL_NOISE}
      ${ATMO_GLSL}
      ${SKY_GLSL}
      void main(){
        vec3 d = vWorld - cameraPosition; float L = length(d); vec3 rd = d / L;
        float rise = smoothstep(1., 15., vWorld.y + 5. * (fbm2(vec2(vWorld.x * .08, vWorld.y * .05)) - .5));
        float fog = min(1. - exp(-atmoTau(cameraPosition, rd, L)), mix(1., uSilhouette, rise));
        gl_FragColor = vec4(skyBase(rd) * fog + atmoRing(cameraPosition, rd, L), 1.);
      }`,
  }));
  tower.position.set(0, -0.5, -98);
  group.add(tower);

  // ------------------------------------------------------------------ light shaft from the zenith
  const shaftU = { uColor: { value: new THREE.Color() }, uTime: uniforms.uTime, uEnergy: uniforms.uEnergy };
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 3.4, 22, 40, 1, true), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: shaftU,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime; uniform float uEnergy; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      ${GLSL_NOISE}
      void main(){
        float edge = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0., 1.), 2.2);            // soft cone silhouette
        float streak = .55 + .45 * fbm2(vec2(vUv.x * 26., vUv.y * 1.5 - uTime * .05));
        float fall = smoothstep(0., .25, vUv.y) * (.35 + .65 * vUv.y);
        gl_FragColor = vec4(uColor * edge * streak * fall * (.035 + .04 * uEnergy), 1.);
      }`,
  }));
  shaft.position.set(0, 11, -0.3);
  group.add(shaft);

  // ------------------------------------------------------------------ mist
  const mistTex = (() => {
    const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(s, s);
    const rnd = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
    const sm = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return (rnd(xi, yi) * (1 - u) + rnd(xi + 1, yi) * u) * (1 - v) + (rnd(xi, yi + 1) * (1 - u) + rnd(xi + 1, yi + 1) * u) * v; };
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = x / s - 0.5, dy = y / s - 0.5, r = Math.hypot(dx, dy) * 2;
      let n = 0, a = 0.5, f = 4;
      for (let o = 0; o < 4; o++) { n += a * sm(x / s * f, y / s * f); a *= 0.5; f *= 2; }
      const v = Math.max(0, 1 - r) ** 1.6 * (0.35 + n);
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.min(255, v * 255);
    }
    ctx.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(cv);
  })();
  const mistMat = new THREE.SpriteMaterial({ map: mistTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.1, fog: false });
  const mist = [];
  const NM = quality === 'low' ? 10 : 22;
  for (let i = 0; i < NM; i++) {
    const sp = new THREE.Sprite(mistMat.clone());
    const a = (i / NM) * Math.PI * 2 + (i % 3), r = 3.2 + (i % 5) * 2.2;
    sp.userData = { a, r, y: 0.35 + (i % 4) * 0.28, s: 5 + (i % 3) * 3.5, w: 0.02 + (i % 4) * 0.008, ph: i * 1.7 };
    sp.scale.set(sp.userData.s, sp.userData.s * 0.42, 1);
    mist.push(sp);
    group.add(sp);
  }

  return {
    group, water, uniforms, mist, stone, shaft, sky, tower,
    gains: { ringLight: 700, caustic: 45 }, // how strongly the ring lights the stone, and the caustics off the water
    impactIndex: 0,
    addImpact(x, z, time, strength) {
      const v = wu.uImpacts.value[this.impactIndex];
      v.set(x, z, time, strength);
      this.impactIndex = (this.impactIndex + 1) % MAX_IMPACTS;
    },
    clearImpacts() { for (const v of wu.uImpacts.value) v.set(0, 0, -100, 0); },
    update(time, dt, palette, camera, energy) {
      for (const u of [wu, uniforms]) { u.uTime.value = time; u.uEnergy.value = energy; }
      wu.uDeep.value.copy(palette.waterDeep);
      wu.uGlow.value.copy(palette.water);
      wu.uCam.value.copy(camera.position);
      skyU.uTop.value.copy(palette.skyTop); skyU.uGlow.value.copy(palette.skyGlow);
      shaftU.uColor.value.copy(palette.shaft);
      for (const sp of mist) {
        const d = sp.userData;
        const a = d.a + time * d.w;
        sp.position.set(Math.cos(a) * d.r, d.y + Math.sin(time * 0.3 + d.ph) * 0.12, Math.sin(a) * d.r * 0.8 - 1.5);
        sp.material.color.copy(palette.mist);
        sp.material.opacity = (0.028 + 0.02 * Math.sin(time * 0.2 + d.ph)) * (0.8 + energy * 0.3);
        sp.material.rotation = d.ph + time * 0.02;
      }
    },
  };
}

// ------------------------------------------------------------------ temple architecture
// A Dravidian pillar, kept restrained: moulded square base with a rounded roll, a square lower block,
// a slender tapering octagonal shaft, a turned capital (pot, cushion, lotus flare) under a thin square
// abacus, and a stepped bracket whose rolled tiers carry the beam. Built at its final height (19.2 m).
const COL_TOP = 19.2;
const HALL = { inner: 11, outer: 20, bay: 10 }; // column rows (x, m) and spacing along the hall

// Surface of revolution from a profile of [radius, y] points. With `flat`, the section is a regular
// polygon whose faces sit at that radius (crisp carved facets); otherwise it is round. Either way the
// profile's normals are smoothed along it except across sharp creases. Non-indexed: position + normal.
function revolve(profile, sides, flat) {
  const pos = [], nor = [];
  const seg = [];
  for (let k = 0; k < profile.length - 1; k++) {
    const dr = profile[k + 1][0] - profile[k][0], dy = profile[k + 1][1] - profile[k][1], l = Math.hypot(dr, dy) || 1;
    seg.push([dy / l, -dr / l]); // outward (radial, up) normal of each profile segment
  }
  const smooth = (k, end) => {
    // normal at one end of segment k: shared with the neighbour unless the profile turns sharply there
    const j = end ? k + 1 : k - 1, a = seg[k], b = seg[j];
    if (!b || a[0] * b[0] + a[1] * b[1] < 0.75) return a;
    const x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y);
    return [x / l, y / l];
  };
  const scale = flat ? 1 / Math.cos(Math.PI / sides) : 1, off = flat ? Math.PI / sides : 0;
  const v = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), c = new THREE.Vector3();
  for (let k = 0; k < seg.length; k++) {
    const [r0, y0] = profile[k], [r1, y1] = profile[k + 1];
    if (r0 === 0 && r1 === 0) continue;
    const n0 = smooth(k, false), n1 = smooth(k, true);
    for (let j = 0; j < sides; j++) {
      const a0 = (j / sides) * Math.PI * 2 + off, a1 = ((j + 1) / sides) * Math.PI * 2 + off, am = (a0 + a1) / 2;
      const P = (a, r, y) => [Math.cos(a) * r * scale, y, Math.sin(a) * r * scale];
      const N = (a, n) => { const d = flat ? am : a; return [Math.cos(d) * n[0], n[1], Math.sin(d) * n[0]]; };
      const q = [[P(a0, r0, y0), N(a0, n0)], [P(a1, r0, y0), N(a1, n0)], [P(a1, r1, y1), N(a1, n1)], [P(a0, r1, y1), N(a0, n1)]];
      for (const t of [[0, 1, 2], [0, 2, 3]]) {
        let [A, B, C] = t.map((i) => q[i]);
        // degenerate where the profile meets the axis
        if (Math.hypot(B[0][0] - A[0][0], B[0][1] - A[0][1], B[0][2] - A[0][2]) + Math.hypot(C[0][0] - A[0][0], C[0][1] - A[0][1], C[0][2] - A[0][2]) < 1e-6) continue;
        e1.fromArray(B[0]).sub(v.fromArray(A[0])); e2.fromArray(C[0]).sub(v);
        c.crossVectors(e1, e2);
        if (c.lengthSq() < 1e-12) continue;
        if (c.dot(v.fromArray(A[1]).add(e1.fromArray(B[1])).add(e2.fromArray(C[1]))) < 0) [B, C] = [C, B]; // face outward
        for (const p of [A, B, C]) { pos.push(...p[0]); nor.push(...p[1]); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

const curve = (n, f) => Array.from({ length: n + 1 }, (_, i) => f(i / n));

function templeColumn() {
  // base: square plinth, chamfer, a rounded roll (kumuda), a recessed groove, a fillet, chamfered top
  const base = revolve([
    [0, -0.3], [1.4, -0.3], [1.4, 0.45], [1.3, 0.52], [1.3, 0.6],
    ...curve(8, (t) => [1.3 + 0.13 * Math.sin(t * Math.PI), 0.6 + 0.4 * t]),
    [1.17, 1.06], [1.17, 1.24], [1.3, 1.3], [1.3, 1.42], [1.04, 1.56], [0, 1.56],
  ], 4, true);
  // square lower block, softened at its top edge
  const block = revolve([[0, 1.56], [0.92, 1.56], [0.92, 3.6], [0.84, 3.68], [0, 3.68]], 4, true);
  const band = (y, r) => revolve([[0, y], [r, y], ...curve(4, (t) => [r + 0.05 * Math.sin(t * Math.PI), y + 0.15 * t]), [0, y + 0.15]], 24, false);
  // slender octagonal shaft, tapering slightly
  const shaft = revolve([[0, 3.83], [0.8, 3.83], [0.72, 15.6], [0, 15.6]], 8, true);
  // turned capital: pot (kalasha), neck, cushion (kumbha), lotus flare (padma)
  const cap = revolve([
    [0, 15.75], [0.64, 15.75],
    ...curve(8, (t) => [0.64 + 0.2 * Math.sin(t * Math.PI) - 0.08 * t, 15.75 + 0.67 * t]),
    [0.56, 16.5], [0.56, 16.6], [0.66, 16.62], [0.66, 16.7],
    ...curve(8, (t) => [0.68 + 0.3 * Math.sin(t * Math.PI) - 0.02 * t, 16.7 + 0.5 * t]),
    [0.64, 17.24],
    ...curve(6, (t) => [0.66 + 0.58 * t * t, 17.24 + 0.4 * Math.sqrt(t)]),
    [0, 17.64],
  ], 32, false);
  const abacus = revolve([[0, 17.64], [1.24, 17.64], [1.24, 17.84], [0, 17.84]], 4, true);
  const neck = revolve([[0, 17.84], [0.7, 17.84], [0.7, 18.2], [0, 18.2]], 4, true);
  // stepped bracket (taranga potika): three rolled tiers reaching along the beam
  const s = new THREE.Shape();
  s.moveTo(-0.7, 0); s.lineTo(0.7, 0); s.lineTo(0.7, 0.12);
  s.quadraticCurveTo(1.08, 0.12, 1.08, 0.36); s.lineTo(1.08, 0.42);
  s.quadraticCurveTo(1.42, 0.42, 1.42, 0.64); s.lineTo(1.42, 0.7);
  s.quadraticCurveTo(1.75, 0.7, 1.75, 0.9); s.lineTo(1.75, 1.0);
  s.lineTo(-1.75, 1.0); s.lineTo(-1.75, 0.9);
  s.quadraticCurveTo(-1.75, 0.7, -1.42, 0.7); s.lineTo(-1.42, 0.64);
  s.quadraticCurveTo(-1.42, 0.42, -1.08, 0.42); s.lineTo(-1.08, 0.36);
  s.quadraticCurveTo(-1.08, 0.12, -0.7, 0.12); s.closePath();
  const bracket = new THREE.ExtrudeGeometry(s, { depth: 1.4, bevelEnabled: false, curveSegments: 10 });
  bracket.translate(0, 0, -0.7); bracket.rotateY(Math.PI / 2); bracket.translate(0, 18.2, 0);
  bracket.deleteAttribute('uv');
  const g = mergeGeometries([base, block, band(3.68, 0.86), shaft, band(15.6, 0.78), cap, abacus, neck, bracket]);
  return markMonolith(g);
}

// beam along z with a curved, overhanging cornice (kapota), from z0 (near) to z1 (far)
function templeBeam(z0, z1) {
  const s = new THREE.Shape();
  s.moveTo(-0.7, 0); s.lineTo(0.7, 0); s.lineTo(0.7, 0.85);
  s.quadraticCurveTo(1.12, 0.88, 1.12, 1.3); s.lineTo(1.12, 1.42);
  s.lineTo(-1.12, 1.42); s.lineTo(-1.12, 1.3);
  s.quadraticCurveTo(-1.12, 0.88, -0.7, 0.85); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: z0 - z1, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, COL_TOP, z1);
  g.deleteAttribute('uv');
  return markMonolith(g);
}

// monolithic carved pieces skip the coursed-masonry joints the stone shader draws on built-up forms
function markMonolith(g) {
  g.setAttribute('aMono', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
  return g;
}

// Gopuram outline, built at (0, 0, 0) facing +z: rectangular in plan (depth 0.55 of width). Seen only as a
// faint silhouette whose lower 15 m dissolves into the haze, so it is just the stepped outline of tapering
// tiers with cornice lines, on a plain base, under a barrel-vaulted crown (shala).
function gopuram() {
  const prof = [[0, 0], [14, 0], [14, 8.2]];
  const TIERS = 7, H = 4.4;
  for (let i = 0; i < TIERS; i++) {
    const y0 = 8.2 + i * H, w = 12.5 - i * 1.25;
    prof.push([w, y0], [w - 0.5, y0 + 3.7], [w - 0.15, y0 + 3.85], [w - 0.15, y0 + H]);
  }
  const yTop = 8.2 + TIERS * H, wTop = 12.5 - TIERS * 1.25;
  prof.push([wTop, yTop], [0, yTop]);
  const VR = 2.4;
  const vault = new THREE.CylinderGeometry(VR, VR, wTop * 2 + 1, 20, 1, false, 0, Math.PI).toNonIndexed();
  vault.deleteAttribute('uv');
  vault.rotateZ(Math.PI / 2); vault.scale(1, 1, 1 / 0.55); vault.translate(0, yTop, 0); // upper half-cylinder, axis along x
  const g = mergeGeometries([revolve(prof, 4, true), vault]);
  g.scale(1, 1, 0.55);
  return g;
}
