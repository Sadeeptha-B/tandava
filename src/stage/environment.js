import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

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
    uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.03 },
    uCam: { value: new THREE.Vector3() }, uEnergy: { value: 0 },
  };

  // ------------------------------------------------------------------ water
  const res = quality === 'high' ? 1024 : quality === 'medium' ? 640 : 384;
  const water = new Reflector(new THREE.PlaneGeometry(400, 400), {
    textureWidth: res, textureHeight: res, clipBias: 0.003, multisample: quality === 'low' ? 0 : 2,
    shader: {
      name: 'WaterShader',
      uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, ...uniforms },
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix; varying vec4 vUvR; varying vec3 vWorld;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz; vUvR = textureMatrix * vec4(position, 1.); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform float uTime; uniform vec4 uImpacts[${MAX_IMPACTS}];
        uniform vec3 uDeep; uniform vec3 uGlow; uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uCam; uniform float uEnergy;
        varying vec4 vUvR; varying vec3 vWorld;
        ${GLSL_NOISE}
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
          float fd = length(uCam - vWorld);
          col = mix(col, uFogColor, 1. - exp(-uFogDensity * uFogDensity * fd * fd));
          gl_FragColor = vec4(col, 1.);
        }`,
    },
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.018;
  group.add(water);
  const wu = water.material.uniforms;

  // dark stone just beneath the surface so feet read as standing *in* shallow water
  // (the reflector is opaque; the stone tint lives in uDeep)

  // ------------------------------------------------------------------ colonnade + distant shrine
  const stone = new THREE.MeshStandardMaterial({ color: 0x1a2226, roughness: 0.82, metalness: 0.05 });
  // carved courses and weathering, so the colonnade reads as worked stone rather than flat slabs
  stone.customProgramCacheKey = () => 'temple-stone';
  stone.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 wpS = vec4(position, 1.);\n#ifdef USE_INSTANCING\nwpS = instanceMatrix * wpS;\n#endif\nvWp = (modelMatrix * wpS).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWp;\n${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float course = smoothstep(.0, .06, abs(fract(vWp.y * .62) - .5) - .44);          // horizontal joints
  float frieze = smoothstep(.3, .5, fbm2(vec2(atan(vWp.x, vWp.z) * 40., vWp.y * 3.))) * step(.72, fract(vWp.y * .155));
  float wear = fbm2(vWp.xz * .9 + vWp.y * .35);
  diffuseColor.rgb *= (.55 + .7 * wear) * (1. - .55 * course) * (1. + .5 * frieze);
}`);
  };
  const colGeo = (() => {
    const parts = [];
    const add = (g, y) => { g.translate(0, y, 0); parts.push(g); };
    add(new THREE.BoxGeometry(2.6, 0.7, 2.6), 0.35);
    add(new THREE.BoxGeometry(2.2, 0.5, 2.2), 0.95);
    add(new THREE.CylinderGeometry(0.82, 0.92, 11, 16, 1), 6.7);
    add(new THREE.CylinderGeometry(1.15, 0.84, 0.8, 16, 1), 12.6);
    add(new THREE.BoxGeometry(2.7, 0.6, 2.7), 13.3);
    add(new THREE.BoxGeometry(3.3, 0.8, 3.3), 14.0);
    return mergeGeometries(parts);
  })();
  const cols = [];
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) {
    cols.push([sx * 7.5, -3 - i * 8.5, 1]);
    cols.push([sx * 15.5, -7 - i * 8.5, 1.25]);
  }
  const colonnade = new THREE.InstancedMesh(colGeo, stone, cols.length);
  const m = new THREE.Matrix4();
  cols.forEach(([x, z, s], i) => { m.makeScale(s, s * 1.35, s).setPosition(x, -0.2, z); colonnade.setMatrixAt(i, m); });
  group.add(colonnade);
  // lintels
  const lintel = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 1.6, 9), stone, 16);
  let li = 0;
  for (let i = 0; i < 8; i++) for (const sx of [-1, 1]) { m.makeTranslation(sx * 7.5, 19.9, -7.25 - i * 8.5); lintel.setMatrixAt(li++, m); }
  group.add(lintel);
  // distant stepped tower (vimana) – only ever a silhouette in the haze
  const tower = new THREE.Group();
  for (let i = 0; i < 11; i++) {
    const w = 30 - i * 2.5, h = 3.4 - i * 0.12;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.7), stone);
    b.position.y = i * 3.1 + h / 2;
    tower.add(b);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 10), stone);
  dome.position.y = 36.6;
  tower.add(dome);
  tower.position.set(0, -0.5, -92);
  group.add(tower);
  // dais the dancer stands on: a broad low stone disc barely breaking the surface
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.06, 64), new THREE.MeshStandardMaterial({ color: 0x0c1114, roughness: 0.55, metalness: 0.1 }));
  dais.position.y = -0.02;
  group.add(dais);

  // ------------------------------------------------------------------ sky
  const skyU = { uTop: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uTime: uniforms.uTime, uEnergy: uniforms.uEnergy };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uGlow; uniform float uTime; uniform float uEnergy; varying vec3 vDir;
      ${GLSL_NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -1., 1.);
        // horizon haze and a broad glow behind the dancer
        float haze = exp(-abs(h) * 5.5);
        float back = pow(max(dot(normalize(d.xz + 1e-4), vec2(0., -1.)), 0.), 3.) * exp(-abs(h - .12) * 3.2);
        float neb = fbm2(vec2(atan(d.x, -d.z) * 2.2, h * 3.) + uTime * .008);
        vec3 col = uTop + uGlow * (haze * .3 + back * (.9 + .5 * uEnergy)) * (.55 + .9 * neb);
        // zenith: the source of the falling light
        col += uGlow * pow(max(h, 0.), 6.) * 1.6 * (.6 + .4 * neb);
        // sparse stars
        vec2 sp = vec2(atan(d.x, d.z), asin(h)) * 60.;
        float st = step(.9965, hash21(floor(sp))) * smoothstep(.1, .5, h) * (.5 + .5 * sin(uTime * 1.5 + hash21(floor(sp) + 3.) * 40.));
        col += vec3(.7, .9, 1.) * st * .5;
        gl_FragColor = vec4(col, 1.);
      }`,
  }));
  sky.renderOrder = -10;
  group.add(sky);

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
    group, water, uniforms, mist, stone, shaft, sky,
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
      wu.uFogColor.value.copy(palette.fog);
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
    setFogDensity(d) { wu.uFogDensity.value = d; },
  };
}

function mergeGeometries(parts) {
  let nv = 0, ni = 0;
  for (const g of parts) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
    vo += g.attributes.position.count; io += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
