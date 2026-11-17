import * as THREE from 'three';

// CPU-simulated particle pool drawn as velocity-stretched billboards (one draw call):
//   type 0 water droplets · 1 sparks · 2 flame (palm fire, leaves trails as the hand moves)
// plus pooled shockwave rings and impact flashes.
export const WATER = 0, SPARK = 1, FLAME = 2;

export function createParticles({ quality }) {
  const N = quality === 'low' ? 1800 : quality === 'medium' ? 3500 : 6000;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), data = new Float32Array(N * 4);
  const life = new Float32Array(N), maxLife = new Float32Array(N), grav = new Float32Array(N), drag = new Float32Array(N), size0 = new Float32Array(N);
  const type = new Uint8Array(N);
  let cursor = 0, alive = 0;

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aPos = new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aVel = new THREE.InstancedBufferAttribute(vel, 3).setUsage(THREE.DynamicDrawUsage);
  const aData = new THREE.InstancedBufferAttribute(data, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', aPos); geo.setAttribute('iVel', aVel); geo.setAttribute('iData', aData);
  geo.instanceCount = N;
  const u = { uWater: { value: new THREE.Color() }, uSpark: { value: new THREE.Color() }, uFlame: { value: new THREE.Color() } };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: u,
    vertexShader: /* glsl */ `
      attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iData; // life01, size, type, seed
      uniform vec3 uWater, uSpark, uFlame; varying vec2 vUv; varying vec3 vCol; varying float vSoft;
      void main(){
        vUv = position.xy;
        float l = iData.x, sz = iData.y, ty = iData.z;
        if (ty < .5 && iData.w > .8) sz *= 3.5;
        if (sz <= 0.) { gl_Position = vec4(2., 2., 2., 1.); return; }
        vec4 mv = viewMatrix * vec4(iPos, 1.);
        vec3 vv = (viewMatrix * vec4(iVel, 0.)).xyz;
        float sp = length(vv.xy);
        vec2 dir = sp > 1e-3 ? vv.xy / sp : vec2(0., 1.);
        float streak = ty > 1.5 ? .01 : ty > .5 ? .028 : .018;
        float halfLen = sz + sp * streak;
        mv.xy += dir * position.y * halfLen + vec2(dir.y, -dir.x) * position.x * sz;
        gl_Position = projectionMatrix * mv;
        float fade;
        if (ty > 1.5) {            // flame: white-hot -> body -> ember red
          fade = smoothstep(0., .12, l) * (1. - l);
          vCol = mix(vec3(1.6, 1.3, 1.0) * uFlame + .3, uFlame, smoothstep(0., .35, l));
          vCol = mix(vCol, uFlame * vec3(.8, .25, .12), smoothstep(.45, 1., l)) * fade * .5;
          vSoft = 1.4;
        } else if (ty > .5) {      // spark
          fade = pow(clamp(1. - l, 0., 1.), 1.3) * (.6 + .4 * sin(l * 40. + iData.w * 30.));
          vCol = uSpark * fade * 2.2;
          vSoft = 2.2;
        } else {                   // water
          fade = smoothstep(0., .05, l) * (1. - l * l);
          float puff = step(.8, iData.w);                       // one in five is a soft puff of spray
          vCol = (uWater * .8 + .1) * fade * mix(.75, .035 * smoothstep(0., .3, l), puff);
          vSoft = mix(1.8, 1.1, puff);
        }
        vCol *= sz / halfLen * .6 + .4;   // long streaks carry the same energy
      }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vCol; varying float vSoft; void main(){ float d = length(vUv); float a = pow(clamp(1. - d, 0., 1.), vSoft); gl_FragColor = vec4(vCol * a, 1.); }`,
  }));
  mesh.frustumCulled = false;

  const spawn = (x, y, z, vx, vy, vz, ty, sz, lf, g, dr) => {
    const i = cursor; cursor = (cursor + 1) % N;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    life[i] = 0; maxLife[i] = lf; grav[i] = g; drag[i] = dr; size0[i] = sz; type[i] = ty;
    data[i * 4] = 0; data[i * 4 + 1] = sz; data[i * 4 + 2] = ty; data[i * 4 + 3] = Math.random();
  };
  const R = Math.random;

  // ---- shockwave rings + flashes
  const group = new THREE.Group();
  group.add(mesh);
  const ringGeo = new THREE.RingGeometry(0.86, 1.0, 96, 1);
  ringGeo.rotateX(-Math.PI / 2);
  const shocks = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uColor: { value: new THREE.Color() }, uA: { value: 0 } },
      vertexShader: `varying float vR; void main(){ vR = (length(position.xz) - .86) / .14; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uA; varying float vR; void main(){ float r = clamp(vR, 0., 1.); float b = pow(r, 2.5) * (1. - smoothstep(.9, 1., r)); gl_FragColor = vec4(uColor * b * uA, 1.); }`,
    }));
    m.visible = false;
    m.userData = { age: 0, strength: 0 };
    shocks.push(m);
    group.add(m);
  }
  let shockI = 0;
  const flashTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  const flashes = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 }));
    s.visible = false; s.userData = { age: 9, strength: 0 };
    flashes.push(s); group.add(s);
  }
  let flashI = 0;
  // glow at the heart of the palm flame
  const flameGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  group.add(flameGlow);

  const scale = quality === 'low' ? 0.45 : quality === 'medium' ? 0.75 : 1;
  const prevFlame = new THREE.Vector3(), flameVel = new THREE.Vector3();
  let flameAcc = 0, hasPrev = false;

  return {
    group, uniforms: u, get alive() { return alive; },

    // a foot strikes the water
    stamp(p, strength, reduced = false) {
      const s = strength, k = scale * (reduced ? 0.4 : 1);
      const nd = Math.round((40 + 330 * s * s) * k);
      for (let i = 0; i < nd; i++) {
        const a = R() * 6.2832, c = Math.cos(a), sn = Math.sin(a);
        const out = (0.4 + R() * 2.2) * (0.4 + 0.6 * s), up = (1.3 + R() * 4.3) * (0.42 + 0.58 * s);
        const r0 = 0.05 + R() * 0.12;
        spawn(p.x + c * r0, 0.03, p.z + sn * r0, c * out, up, sn * out, WATER, 0.005 + R() * 0.009, 0.6 + R() * 1.0, -9.8, 0.25);
      }
      const ns = Math.round((8 + 90 * s) * k);
      for (let i = 0; i < ns; i++) {
        const a = R() * 6.2832, out = 0.3 + R() * 2.4 * s, up = 1.5 + R() * 5.5 * s;
        spawn(p.x, 0.05, p.z, Math.cos(a) * out, up, Math.sin(a) * out, SPARK, 0.004 + R() * 0.006, 0.6 + R() * 1.3, -2.2, 1.3);
      }
      if (s > 0.8) { // the great landing: a low radial sheet of spray
        const nr = Math.round(260 * k);
        for (let i = 0; i < nr; i++) {
          const a = (i / nr) * 6.2832 + R() * 0.05, c = Math.cos(a), sn = Math.sin(a), out = 4.2 + R() * 3.4;
          spawn(p.x + c * 0.3, 0.04, p.z + sn * 0.3, c * out, 0.9 + R() * 2.4, sn * out, WATER, 0.005 + R() * 0.008, 0.6 + R() * 0.7, -9.8, 0.5);
        }
      }
      const sh = shocks[shockI]; shockI = (shockI + 1) % shocks.length;
      sh.position.set(p.x, 0.035, p.z); sh.userData.age = 0; sh.userData.strength = s; sh.visible = true;
      const fl = flashes[flashI]; flashI = (flashI + 1) % flashes.length;
      fl.position.set(p.x, 0.06, p.z); fl.userData.age = 0; fl.userData.strength = s; fl.visible = true;
    },

    // continuous fire in the palm; `p` is the palm position this frame
    flame(p, level, dt) {
      if (!hasPrev) { prevFlame.copy(p); hasPrev = true; }
      if (dt > 0) flameVel.subVectors(p, prevFlame).divideScalar(dt); else flameVel.set(0, 0, 0);
      if (flameVel.lengthSq() > 400) flameVel.set(0, 0, 0); // teleport (seek)
      flameAcc += dt * (90 + 150 * level) * scale;
      const n = Math.floor(flameAcc); flameAcc -= n;
      for (let i = 0; i < n; i++) {
        const t = R();
        const x = prevFlame.x + (p.x - prevFlame.x) * t, y = prevFlame.y + (p.y - prevFlame.y) * t, z = prevFlame.z + (p.z - prevFlame.z) * t;
        const a = R() * 6.2832, r = R() * 0.018;
        spawn(x + Math.cos(a) * r, y + R() * 0.01, z + Math.sin(a) * r,
          flameVel.x * 0.25 + (R() - 0.5) * 0.16, 0.3 + R() * 0.55 + flameVel.y * 0.15, flameVel.z * 0.25 + (R() - 0.5) * 0.16,
          FLAME, (0.012 + R() * 0.014) * (0.8 + 0.4 * level), 0.24 + R() * 0.34, 1.8, 2.0);
        if (R() < 0.035 * (0.5 + level)) spawn(x, y + 0.03, z, (R() - 0.5) * 0.9, 0.8 + R() * 1.6, (R() - 0.5) * 0.9, SPARK, 0.0025 + R() * 0.003, 0.5 + R() * 0.9, -1.2, 1.0);
      }
      prevFlame.copy(p);
      flameGlow.position.copy(p).y += 0.05;
      const fs = (0.16 + 0.1 * level) * (0.9 + 0.2 * Math.sin(performance.now() * 0.021) * Math.sin(performance.now() * 0.013));
      flameGlow.scale.set(fs, fs, 1);
      flameGlow.material.color.copy(u.uFlame.value).multiplyScalar(0.22 + 0.25 * level);
    },

    update(dt, palette) {
      u.uWater.value.copy(palette.water); u.uSpark.value.copy(palette.spark); u.uFlame.value.copy(palette.flame);
      alive = 0;
      for (let i = 0; i < N; i++) {
        if (size0[i] === 0) continue;
        life[i] += dt;
        const l = life[i] / maxLife[i];
        const k = i * 3;
        if (l >= 1 || (type[i] === WATER && pos[k + 1] < 0.0 && vel[k + 1] < 0)) { size0[i] = 0; data[i * 4 + 1] = 0; continue; }
        alive++;
        const d = Math.max(0, 1 - drag[i] * dt);
        vel[k] *= d; vel[k + 2] *= d; vel[k + 1] = vel[k + 1] * d + grav[i] * dt;
        pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
        data[i * 4] = l;
        data[i * 4 + 1] = type[i] === FLAME ? size0[i] * (0.6 + 1.3 * Math.max(0, Math.sin(Math.min(1, l * 1.4) * Math.PI)) ** 0.7) * (1 - l * 0.4) : size0[i];
      }
      aPos.needsUpdate = aVel.needsUpdate = aData.needsUpdate = true;
      for (const sh of shocks) {
        if (!sh.visible) continue;
        const d = sh.userData; d.age += dt;
        const r = 0.25 + d.age * 2.3;
        sh.scale.set(r, 1, r);
        sh.material.uniforms.uColor.value.copy(palette.shock);
        sh.material.uniforms.uA.value = d.strength * 1.8 * Math.exp(-d.age * 1.25) * Math.min(1, d.age * 14);
        if (d.age > 4) sh.visible = false;
      }
      for (const fl of flashes) {
        if (!fl.visible) continue;
        const d = fl.userData; d.age += dt;
        const s = (0.5 + d.strength * 1.4) * (1 + d.age * 3);
        fl.scale.set(s, s * 0.5, 1);
        fl.material.color.copy(palette.shock);
        fl.material.opacity = d.strength * Math.exp(-d.age * 10) * 0.12;
        if (d.age > 0.6) fl.visible = false;
      }
    },
    clear() { size0.fill(0); for (let i = 0; i < N; i++) data[i * 4 + 1] = 0; for (const s of shocks) s.visible = false; for (const f of flashes) f.visible = false; hasPrev = false; },
  };
}
