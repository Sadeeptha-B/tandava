import * as THREE from 'three';
import { RING } from './ring.js';
import { rippleAt, WATER_Y } from '../stage/ripples.js';

// Pushpa vrishti: a single shower of flowers released from above at the landing stamp. Mostly lotus petals
// in pinks, with small whole jasmine flowers. They are made to read as flowers at a few metres among the
// embers, sparks and motes: large enough for their shape to show, coloured as nothing else in the scene is,
// shaded (they glint as they turn) rather than glowing, and falling the way petals do: slow, swinging,
// rocking and tumbling. A few fall close past the camera. They are carried on the dance's wind and the
// swirl the spin leaves in the air, part round the dancer, settle onto the water, ride the ripples and
// sink before the dance begins again. A petal that drifts into the ring of fire burns.
// Not continuous: the embers and sparks already own the air the rest of the time.

const IDLE = 0, WAITING = 1, FALLING = 2, FLOATING = 3, BURNING = 4;
// pinks leaning to magenta, so they stay pink (not salmon, not ember) in the ring's gold light
const LOTUS_PALE = new THREE.Color(0.92, 0.55, 0.8), LOTUS_DEEP = new THREE.Color(0.78, 0.12, 0.52);
const JASMINE = new THREE.Color(0.92, 0.9, 0.84);
const WHITE = new THREE.Color(1, 1, 1);
const A0 = THREE.MathUtils.degToRad(-60), A1 = THREE.MathUtils.degToRad(240); // the arc the fire burns on (ring.js)

// grid surface → indexed geometry with a per-vertex gradient (aGrad: rgb the base colour, a its weight)
function sheet(NU, NV, f, grad) {
  const pos = [], gr = [], idx = [];
  for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
    const u = i / NU, v = (j / NV) * 2 - 1;
    pos.push(...f(u, v));
    gr.push(...grad(u, v));
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = i * (NV + 1) + j, b = a + NV + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aGrad', new THREE.Float32BufferAttribute(gr, 4));
  g.setIndex(idx);
  return g;
}

// a lotus petal, 1 m long along x: narrow at the base, broad, then a pointed tip; boat-shaped (cupped across
// its width, lifting towards the tip). Pale at the base, its full colour towards the tip.
function lotusPetal() {
  const g = sheet(9, 4, (u, v) => {
    const half = 0.23 * Math.sin(Math.PI * u ** 0.85) ** 0.7;
    return [u - 0.5, 0.2 * v * v * (half / 0.23) + 0.12 * u * u, v * half];
  }, (u) => [0.96, 0.92, 0.86, 0.85 * (1 - u) ** 1.6]);
  g.computeVertexNormals();
  return g;
}

// a jasmine flower, 1 m across: five slender petals radiating from a short tube, opening upward a little;
// a faint yellow-green heart
function jasmineFlower() {
  const parts = [];
  for (let k = 0; k < 5; k++) {
    const p = sheet(6, 2, (u, v) => {
      const r = 0.05 + 0.45 * u, half = 0.13 * Math.sin(Math.PI * Math.min(1, 0.15 + u * 0.9)) ** 0.8 + 0.01;
      return [r, 0.1 * u * u + 0.04 * v * v, v * half];
    }, (u) => [0.82, 0.86, 0.45, 0.8 * Math.max(0, 1 - u * 3.5)]);
    p.rotateY((k / 5) * Math.PI * 2);
    parts.push(p);
  }
  const tube = new THREE.CylinderGeometry(0.05, 0.035, 0.12, 6, 1, true).translate(0, -0.06, 0);
  tube.deleteAttribute('uv');
  tube.deleteAttribute('normal');
  tube.setAttribute('aGrad', new THREE.Float32BufferAttribute(new Array(tube.attributes.position.count).fill([0.8, 0.85, 0.5, 0.9]).flat(), 4));
  const merged = new THREE.BufferGeometry();
  // merge by hand (all indexed, same attributes)
  const all = [...parts, tube];
  const pos = [], gr = [], idx = [];
  let base = 0;
  for (const g of all) {
    pos.push(...g.attributes.position.array); gr.push(...g.attributes.aGrad.array);
    for (const i of g.index.array) idx.push(i + base);
    base += g.attributes.position.count;
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('aGrad', new THREE.Float32BufferAttribute(gr, 4));
  merged.setIndex(idx);
  merged.computeVertexNormals();
  return merged;
}

export function createPetals({ quality }) {
  const N = quality === 'low' ? 70 : quality === 'medium' ? 120 : 160;
  const NL = Math.round(N * 0.6);                 // lotus petals first, then jasmine flowers
  const burn = new Float32Array(N);
  const U = { uEmber: { value: new THREE.Color() }, uTrans: { value: new THREE.Color() }, uSky: { value: new THREE.Color() } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  mat.customProgramCacheKey = () => 'petal';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBurn; attribute vec4 aGrad; varying float vBurn; varying vec4 vGrad; varying vec3 vPw;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBurn = aBurn; vGrad = aGrad; vPw = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uEmber; uniform vec3 uTrans; uniform vec3 uSky; varying float vBurn; varying vec4 vGrad; varying vec3 vPw;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vGrad.rgb, vGrad.a);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // shaded by the cool light falling from above: bright when a face turns up to it, dark as it turns away, with
  // a glint at the turn, so a petal flickers as it rocks and tumbles (instead of glowing like a mote or an ember)
  vec3 nW = inverseTransformDirection(normal, viewMatrix);
  vec3 V = normalize(cameraPosition - vPw);
  float upF = nW.y * .5 + .5;
  float glint = pow(max(dot(nW, normalize(vec3(0., 1., 0.) + V)), 0.), 28.);
  vec3 d = vPw - vec3(${RING.center.x.toFixed(3)}, ${RING.center.y.toFixed(3)}, ${RING.center.z.toFixed(3)});
  totalEmissiveRadiance += diffuseColor.rgb * (uSky * (.1 + .9 * upF * upF) + uTrans / (1. + dot(d, d) * .6)) + uSky * glint * 1.6;
  // a burning petal chars and glows ember
  diffuseColor.rgb *= 1. - .85 * vBurn;
  totalEmissiveRadiance += uEmber * vBurn * vBurn * 3.;
}`);
  };
  const meshes = [[lotusPetal(), 0, NL], [jasmineFlower(), NL, N - NL]].map(([geo, start, count]) => {
    geo.setAttribute('aBurn', new THREE.InstancedBufferAttribute(burn.subarray(start, start + count), 1).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.userData = { start, cap: count };
    mesh.count = 0; // drawn only during the shower (kept visible so its shader compiles in the warm-up)
    return mesh;
  });
  const group = new THREE.Group();
  group.add(...meshes);
  const meshOf = (i) => (i < NL ? meshes[0] : meshes[1]);
  const setMatrix = (i, mat4) => { const ms = meshOf(i); ms.setMatrixAt(i - ms.userData.start, mat4); };

  // ---- per-petal state
  const st = new Uint8Array(N);
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
  const release = new Float32Array(N), fall = new Float32Array(N), amp = new Float32Array(N), freq = new Float32Array(N), ph = new Float32Array(N);
  const rock = new Float32Array(N), yaw = new Float32Array(N), yawRate = new Float32Array(N), tumble = new Float32Array(N), size = new Float32Array(N);
  const t1 = new Float32Array(N); // floating: time it starts to sink; burning: time it caught
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < N; i++) setMatrix(i, zero);
  // colours never change: lotus petals from pale to deep pink, jasmine near-white
  const _c = new THREE.Color();
  const R = Math.random;
  for (let i = 0; i < N; i++) {
    if (i < NL) {
      size[i] = 0.06 + 0.022 * R();
      meshes[0].setColorAt(i, _c.copy(LOTUS_PALE).lerp(LOTUS_DEEP, R() ** 0.8));
    } else {
      size[i] = 0.034 + 0.012 * R();
      meshes[1].setColorAt(i - NL, _c.copy(JASMINE).multiplyScalar(0.94 + 0.08 * R()));
    }
  }

  const state = { prevBeat: null, active: 0, spin: 0, deadline: 0, gusts: [], falling: 0, air: 0 };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), nrm = new THREE.Vector3();
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const rip = { h: 0, sx: 0, sz: 0, px: 0, pz: 0 };
  const fwd = new THREE.Vector3(), right = new THREE.Vector3();

  function shower(time, deadline, camera) {
    state.deadline = deadline;
    // the camera's horizontal frame, so the near layer falls where it will be seen
    camera.getWorldDirection(fwd).setY(0).normalize();
    right.set(-fwd.z, 0, fwd.x);
    for (let i = 0; i < N; i++) {
      const k = i * 3, lotus = i < NL;
      st[i] = WAITING;
      release[i] = time + 2.4 * R() ** 1.5;   // most early, a few stragglers
      if (R() < 0.12) {
        // a few close past the camera, to either side of the dancer
        const d = 2.2 + 1.4 * R(), side = (R() < 0.5 ? -1 : 1) * (0.2 + 0.3 * R()) * d;
        pos[k] = camera.position.x + fwd.x * d + right.x * side;
        pos[k + 1] = 2.3 + 0.8 * R();
        pos[k + 2] = camera.position.z + fwd.z * d + right.z * side;
      } else {
        const a = R() * Math.PI * 2, r = 3.4 * Math.sqrt(R());
        pos[k] = Math.cos(a) * r; pos[k + 1] = 3.5 + 1.1 * R(); pos[k + 2] = -0.4 + Math.sin(a) * r * 0.8;
      }
      vel[k] = 0; vel[k + 1] = -0.3; vel[k + 2] = 0;
      ph[i] = R() * 6.28; yaw[i] = R() * 6.28;
      if (lotus) {
        // a single petal: slow, wide pendulum swings, rocking hard; some tumble end over end
        fall[i] = 0.5 + 0.25 * R(); amp[i] = 0.35 + 0.35 * R(); freq[i] = 1.1 + 0.9 * R();
        rock[i] = 0.6 + 0.5 * R(); yawRate[i] = (R() - 0.5) * 1.5;
        tumble[i] = R() < 0.35 ? (R() < 0.5 ? -1 : 1) * (1.5 + 2.5 * R()) : 0;
      } else {
        // a whole flower falls faster, face up, spinning like a sycamore seed and wobbling
        fall[i] = 0.62 + 0.2 * R(); amp[i] = 0.15 + 0.2 * R(); freq[i] = 1.6 + 1.2 * R();
        rock[i] = 0.25 + 0.3 * R(); yawRate[i] = (R() < 0.5 ? -1 : 1) * (1.5 + 2.5 * R());
        tumble[i] = 0;
      }
      burn[i] = 0;
    }
    state.active = N;
    for (const ms of meshes) ms.count = ms.userData.cap;
  }

  return {
    group, meshes, uniforms: U,
    get active() { return state.active; },
    /** how much of the shower is in the air (0..1, smoothed): other airborne effects give way to it */
    get air() { return state.air; },
    /** dev: how many petals are idle, waiting, falling, floating, burning */
    stats() { const c = [0, 0, 0, 0, 0]; for (let i = 0; i < N; i++) c[st[i]]++; return c; },
    shower,
    /** a stamp: a puff of air thrown outward from the foot */
    gust(position, strength) { state.gusts.push({ x: position.x, z: position.z, s: strength }); },
    /**
     * `beat`/`landingBeat`/`beatDur`/`beats`: the dance clock; `hips`: the dancer's position; `wind`: the dance's
     * wind level; `spin`: turning rate (rad/s); `impacts`: water ripples; `power`: the ring's power; `camera`
     */
    update(time, dt, palette, { beat, landingBeat, beatDur, beats, hips, wind, spin, impacts, power, camera }) {
      if (state.prevBeat !== null && state.prevBeat < landingBeat && beat >= landingBeat && beat - state.prevBeat < 2) {
        shower(time, time + Math.max(4, (beats - 3.5 - landingBeat) * beatDur), camera);
      }
      state.prevBeat = beat;
      // the air keeps turning a while after the spin stops
      state.spin += (THREE.MathUtils.clamp(spin, -8, 8) - state.spin) * (1 - Math.exp(-dt * 0.8));
      const gusts = state.gusts; state.gusts = [];
      // (last frame's count of falling petals, eased so whatever follows it fades rather than steps)
      state.air += (state.falling / N - state.air) * (1 - Math.exp(-dt * 1.2));
      if (!state.active) { state.falling = 0; return; }
      U.uEmber.value.copy(palette.ember);
      U.uTrans.value.copy(palette.rim).multiplyScalar(0.01 * power);
      U.uSky.value.copy(palette.shaft).lerp(WHITE, 0.5).multiplyScalar(0.3);
      const hx = hips.x, hz = hips.z, sp = state.spin;
      let active = 0, falling = 0;
      for (let i = 0; i < N; i++) {
        const S = st[i];
        if (S === IDLE) continue;
        active++;
        const k = i * 3;
        if (S === WAITING) { if (time < release[i]) continue; st[i] = FALLING; }
        let x = pos[k], y = pos[k + 1], z = pos[k + 2];
        let scale = size[i];
        if (st[i] === FALLING) {
          const dx = x - hx, dz = z - hz, r = Math.hypot(dx, dz) + 0.2, ux = dx / r, uz = dz / r;
          const tt = time * freq[i] + ph[i], sw = Math.sin(tt);
          // a falling leaf's pendulum: it slides side to side, slowing and lifting a little at each end of the
          // swing; plus the outward breath and updraft round the dancer and the spin's swirl
          const out = wind * 0.5 * Math.exp(-r / 2.5), swirl = sp * 0.12 * Math.exp(-r / 2);
          const sx = Math.cos(ph[i] * 3), sz = Math.sin(ph[i] * 3);     // each petal swings along its own line
          const tx = amp[i] * sw * sx + out * ux + swirl * dz;
          const ty = -fall[i] * (1 - 0.45 * Math.cos(2 * tt)) + wind * 0.45 * Math.exp(-r * r / 1.2);
          const tz = amp[i] * sw * sz + out * uz - swirl * dx;
          const kv = 1 - Math.exp(-dt * 2.5);
          vel[k] += (tx - vel[k]) * kv; vel[k + 1] += (ty - vel[k + 1]) * kv; vel[k + 2] += (tz - vel[k + 2]) * kv;
          for (const g of gusts) {
            const gx = x - g.x, gz = z - g.z, gr = Math.hypot(gx, gz) + 0.1, f = g.s * Math.exp(-gr / 1.2) * Math.exp(-y / 2);
            vel[k] += (gx / gr) * f * 1.4; vel[k + 2] += (gz / gr) * f * 1.4; vel[k + 1] += f * 0.6;
          }
          x += vel[k] * dt; y += vel[k + 1] * dt; z += vel[k + 2] * dt;
          // part round the dancer's body
          const bx = x - hx, bz = z - hz, br = Math.hypot(bx, bz);
          if (y < 1.95 && br < 0.3) { x = hx + (bx / (br + 1e-4)) * 0.3; z = hz + (bz / (br + 1e-4)) * 0.3; }
          // into the ring's fire?
          if (Math.abs(z - RING.center.z) < 0.1) {
            const rx = x - RING.center.x, ry = y - RING.center.y, rr = Math.hypot(rx, ry) - RING.radius;
            let a = Math.atan2(ry, rx); if (a < -Math.PI / 2) a += Math.PI * 2;
            if (rr > -0.06 && rr < 0.4 && a > A0 && a < A1) { st[i] = BURNING; t1[i] = time; }
          }
          if (y <= WATER_Y + 0.003) {
            st[i] = FLOATING; y = WATER_Y + 0.003;
            vel[k] *= 0.3; vel[k + 2] *= 0.3; vel[k + 1] = 0;
            t1[i] = Math.min(time + 4 + 3 * R(), state.deadline);
          }
          // tilted along its swing, hardest at the ends; spinning about its own axis; tumbling, for some
          qa.setFromAxisAngle(nrm.set(-sz, 0, sx), rock[i] * Math.cos(tt));
          qb.setFromAxisAngle(Y, yaw[i] + yawRate[i] * time);
          q.copy(qa).multiply(qb);
          if (tumble[i]) q.multiply(qb.setFromAxisAngle(Z, tumble[i] * time));
          if (time > state.deadline) scale *= Math.max(0, 1 - (time - state.deadline) / 0.8);
          if (time > state.deadline + 0.8) st[i] = IDLE;
        } else if (st[i] === FLOATING) {
          rippleAt(impacts, time, x, z, rip);
          vel[k] += (rip.px * 1.3 - vel[k] * 0.6) * dt; vel[k + 2] += (rip.pz * 1.3 - vel[k + 2] * 0.6) * dt;
          x += vel[k] * dt; z += vel[k + 2] * dt;
          y = WATER_Y + 0.003 + rip.h;
          // then slowly sinks: the opaque surface swallows it
          const sink = Math.max(0, time - t1[i]);
          y -= sink * 0.015;
          scale *= Math.max(0, 1 - sink / 1.2);
          if (sink > 1.2) st[i] = IDLE;
          nrm.set(-rip.sx * 1.5, 1, -rip.sz * 1.5).normalize();
          q.setFromUnitVectors(Y, nrm).multiply(qb.setFromAxisAngle(Y, yaw[i] + yawRate[i] * 0.1 * time));
        } else if (st[i] === BURNING) {
          // chars and shrinks to nothing as it is carried up on the heat
          const b = (time - t1[i]) / 0.45;
          burn[i] = Math.min(1, b * 2);
          vel[k] *= 0.9; vel[k + 1] = 0.35; vel[k + 2] *= 0.9;
          x += vel[k] * dt; y += vel[k + 1] * dt; z += vel[k + 2] * dt;
          scale *= Math.max(0, 1 - b);
          q.setFromAxisAngle(X, rock[i] * Math.sin(time * freq[i] + ph[i])).premultiply(qb.setFromAxisAngle(Y, yaw[i] + time * 3));
          if (b >= 1) st[i] = IDLE;
        }
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
        if (st[i] === FALLING) falling++;
        if (st[i] === IDLE) { setMatrix(i, zero); burn[i] = 0; continue; }
        m.compose(p.set(x, y, z), q, s.setScalar(scale));
        setMatrix(i, m);
      }
      state.active = active; state.falling = falling;
      for (const ms of meshes) {
        if (!active) ms.count = 0;
        ms.instanceMatrix.needsUpdate = true;
        ms.geometry.attributes.aBurn.needsUpdate = true;
      }
    },
    clear() {
      st.fill(IDLE); burn.fill(0); state.active = 0; state.falling = 0; state.air = 0; state.prevBeat = null; state.spin = 0; state.gusts = [];
      for (let i = 0; i < N; i++) setMatrix(i, zero);
      for (const ms of meshes) { ms.instanceMatrix.needsUpdate = true; ms.count = 0; }
    },
  };
}
