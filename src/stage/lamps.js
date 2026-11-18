import * as THREE from 'three';
import { ATMO_GLSL, atmoUniforms } from './atmosphere.js';
import { HALL } from './environment.js';
import { rippleAt, WATER_Y } from './ripples.js';
import { RING } from '../fx/ring.js';

// Floating oil lamps (diyas): small clay bowls with a flame, set adrift in loose rows down the hall.
// Sparse near the camera and thicker into the distance, clear of the dancer and of the view through
// the ring. Each flame is an upright billboard with its own soft halo (no real lights); both the bowls
// and the flames are on layer 0, so the water's reflection doubles them. Stamp ripples rock and heave
// the lamps as they pass, and push them gently outward; a weak spring brings each one back over time.

const FLICK_GLSL = /* glsl */ `
float lampFlick(float t, float s){ return .84 + .09 * sin(t * 11. + s * 60.) + .07 * sin(t * 23.7 + s * 17.) * sin(t * 5.3 + s * 9.); }`;

const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function placeLamps(n) {
  const R = rng(11);
  // lanes: two inside each inner row of columns, two between the inner and outer rows
  const lanes = [5.6, 8.2, 14.4, 17.0];
  const cols = [];
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) {
    cols.push([sx * HALL.inner, -1 - i * HALL.bay, 1.8]);
    cols.push([sx * HALL.outer, -6 - i * HALL.bay, 2.2]);
  }
  const out = [];
  for (let tries = 0; out.length < n && tries < n * 80; tries++) {
    const x = (R() < 0.5 ? -1 : 1) * (lanes[Math.floor(R() * lanes.length)] + (R() - 0.5) * 1.7);
    const z = 5 - R() * 70;
    if (R() > 0.15 + 0.85 * smooth(3, -24, z)) continue;                      // few near the camera, more into the distance
    if (R() > smooth(0.21, 0.3, Math.abs(x) / (6.5 - z))) continue;            // keep the view through the ring clear
    if (Math.hypot(Math.max(Math.abs(x) - RING.radius, 0), z - RING.center.z) < 3) continue; // nothing within ~3 m of the ring
    if (cols.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < 0.75)) continue;
    out.push({ x, z, seed: R(), s: 0.85 + 0.4 * R(), yaw: R() * Math.PI * 2, ox: 0, oz: 0, vx: 0, vz: 0 });
  }
  return out;
}

export function createLamps({ quality }) {
  const lamps = placeLamps(quality === 'low' ? 70 : quality === 'medium' ? 130 : 170);
  const n = lamps.length;
  const group = new THREE.Group();
  const U = { uLamp: { value: new THREE.Color() }, uTime: { value: 0 } };
  const seeds = new Float32Array(lamps.map((l) => l.seed));

  // ---- the clay bowl: shallow, with a rolled lip; the inside glows with its own flame
  const bowlGeo = new THREE.LatheGeometry([
    [0, -0.014], [0.028, -0.013], [0.05, -0.006], [0.064, 0.006], [0.07, 0.016], [0.068, 0.021],
    [0.061, 0.018], [0.048, 0.009], [0.026, 0.004], [0, 0.003],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 20);
  bowlGeo.deleteAttribute('uv');
  bowlGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const clay = new THREE.MeshStandardMaterial({ color: 0x3a1a0e, roughness: 0.9, metalness: 0 });
  clay.customProgramCacheKey = () => 'lamp-clay';
  clay.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uLampGlow: U.uLamp, uTime: U.uTime });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeed; varying float vSeed; varying vec3 vLocal; varying float vUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeed = aSeed; vLocal = position; vUp = normal.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uLampGlow; uniform float uTime; varying float vSeed; varying vec3 vLocal; varying float vUp;\n${FLICK_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // the flame lights the inside of the bowl and the rim; a little reaches the outer wall's shoulder
  float inner = smoothstep(.2, .85, vUp) * smoothstep(.075, .02, length(vLocal.xz));
  float shoulder = smoothstep(-.004, .018, vLocal.y) * (1. - smoothstep(.2, .85, vUp));
  totalEmissiveRadiance += uLampGlow * (.55 * inner + .05 * shoulder) * lampFlick(uTime, vSeed);
}`);
  };
  const bowls = new THREE.InstancedMesh(bowlGeo, clay, n);
  bowls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bowls.frustumCulled = false;
  group.add(bowls);

  // ---- flames: one upright billboard each, carrying the flame and its halo
  const HR = 0.2;   // billboard half-size (m)
  const flameGeo = new THREE.InstancedBufferGeometry();
  flameGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  flameGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const wick = new Float32Array(n * 3);
  const aWick = new THREE.InstancedBufferAttribute(wick, 3).setUsage(THREE.DynamicDrawUsage);
  flameGeo.setAttribute('iPos', aWick);
  flameGeo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  flameGeo.instanceCount = n;
  const FU = { ...U, uPx: { value: 800 }, uDraft: { value: 0 }, ...atmoUniforms };
  const flames = new THREE.Mesh(flameGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: FU,
    vertexShader: /* glsl */ `
      attribute vec3 iPos; attribute float iSeed; uniform float uPx;
      varying vec2 vP; varying float vSeed; varying float vT;
      ${ATMO_GLSL}
      void main(){
        vec3 toC = cameraPosition - iPos; float d = length(toC);
        vec3 right = normalize(vec3(toC.z, 0., -toC.x) + vec3(1e-5, 0., 0.));   // upright: turns only about the vertical
        // keep a distant flame at least ~2 px tall: grow the quad and dim it to match, so it stays a steady point
        float k = max(1., 2.2 * d / (.055 * uPx));
        vP = position.xy * ${HR.toFixed(3)};
        vec3 w = iPos + vec3(0., .035, 0.) + (right * position.x + vec3(0., position.y, 0.)) * ${HR.toFixed(3)} * k;
        vSeed = iSeed;
        vT = exp(-atmoTau(cameraPosition, -toC / d, d)) / (k * k);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLamp; uniform float uTime; uniform float uDraft;
      varying vec2 vP; varying float vSeed; varying float vT;
      ${FLICK_GLSL}
      void main(){
        float fl = lampFlick(uTime, vSeed);
        vec2 q = vP + vec2(0., .031);                       // q.y: height above the wick
        float H = .055 * (.8 + .35 * fl);
        float t = q.y / H;
        q.x -= (uDraft + .006 * sin(uTime * 6.3 + vSeed * 30.) * sin(uTime * 2.1 + vSeed * 7.)) * t * t;   // the tip sways
        float w = .021 * sqrt(max(t, 0.)) * pow(max(1. - t, 0.), .75) + .0012;
        float body = smoothstep(w, w * .2, abs(q.x)) * smoothstep(-.12, .08, t) * step(t, 1.);
        float core = smoothstep(w * .55, 0., abs(q.x)) * smoothstep(-.08, .1, t) * smoothstep(.6, .15, t);
        vec3 col = mix(uLamp * uLamp, uLamp, smoothstep(.95, .35, t)) * body * 2. + (uLamp + .7) * core * 2.4;
        // soft halo round the flame
        vec2 h = vP - vec2(0., -.008);
        float r2 = dot(h, h);
        col += uLamp * (exp(-r2 / .0022) * .2 + exp(-r2 / .011) * .05) * smoothstep(${HR.toFixed(3)}, ${(HR * 0.7).toFixed(3)}, sqrt(r2));
        gl_FragColor = vec4(col * fl * vT, 1.);
      }`,
  }));
  flames.frustumCulled = false;
  flames.renderOrder = 3;
  group.add(flames);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), s = new THREE.Vector3();
  const p = new THREE.Vector3(), nrm = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), w = new THREE.Vector3();
  const rip = { h: 0, sx: 0, sz: 0, px: 0, pz: 0 };

  return {
    group, bowls, flames, lamps, uniforms: FU,
    /** `impacts`: the water's stamp impacts (Vector4 x, z, time, strength); `bufferHeight`: drawing-buffer height (px) */
    update(time, dt, palette, camera, impacts, bufferHeight, wind = 0.2) {
      U.uTime.value = time;
      U.uLamp.value.copy(palette.lamp);
      FU.uPx.value = bufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      FU.uDraft.value = 0.004 + 0.01 * wind;
      for (let i = 0; i < n; i++) {
        const L = lamps[i], sd = L.seed * 100;
        rippleAt(impacts, time, L.x + L.ox, L.z + L.oz, rip);
        // pushed out by a passing front, drawn slowly back to its place
        L.vx += (rip.px - L.ox * 0.12 - L.vx * 0.7) * dt;
        L.vz += (rip.pz - L.oz * 0.12 - L.vz * 0.7) * dt;
        L.ox += L.vx * dt; L.oz += L.vz * dt;
        // a slow wander of its own, and the faint heave of the still water
        const x = L.x + L.ox + 0.25 * Math.sin(time * 0.031 + sd), z = L.z + L.oz + 0.25 * Math.cos(time * 0.026 + sd * 1.3);
        const y = WATER_Y - 0.004 + rip.h + 0.0025 * Math.sin(time * 1.1 + sd);
        nrm.set(-rip.sx * 1.4 + 0.03 * Math.sin(time * 0.9 + sd * 2), 1, -rip.sz * 1.4 + 0.03 * Math.cos(time * 0.8 + sd * 3)).normalize();
        q.setFromUnitVectors(up, nrm).multiply(qy.setFromAxisAngle(up, L.yaw + time * 0.02 * (L.seed - 0.5)));
        m.compose(p.set(x, y, z), q, s.setScalar(L.s));
        bowls.setMatrixAt(i, m);
        w.set(0, 0.012, 0).applyMatrix4(m);
        wick[i * 3] = w.x; wick[i * 3 + 1] = w.y; wick[i * 3 + 2] = w.z;
      }
      bowls.instanceMatrix.needsUpdate = true;
      aWick.needsUpdate = true;
    },
    reset() { for (const L of lamps) L.ox = L.oz = L.vx = L.vz = 0; },
  };
}
