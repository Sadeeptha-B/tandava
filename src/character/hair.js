import * as THREE from 'three';
import { Verlet } from './verlet.js';
import { tubeGeometry } from './fit.js';

// Jata: matted locks, built in three layers so the hair grows out of the head rather than
// sitting on it:
//   1. swept-back locks laid over the scalp from the hairline up into the topknot (rigid)
//   2. the coiled topknot itself (rigid)
//   3. free locks from the temples, sides and nape that fall past the shoulders (simulated)
// The skin shader paints the scalp dark underneath (hairMask) so no skin shows between locks.

const LOCKS = 92, POINTS = 12, RADIAL = 6, SUB = 2;
const RINGS = (POINTS - 1) * SUB + 1;

function ropeNormalMap() {
  const s = 64, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const u = x / s, v = y / s;
    const ph = (u * 2 + v * 3) * Math.PI * 2;
    const dx = Math.cos(ph) * 0.55 + Math.cos((u * 9 + v) * Math.PI * 2) * 0.2;
    const dy = Math.cos(ph) * 0.4;
    const i = (y * s + x) * 4;
    img.data[i] = 128 + dx * 110; img.data[i + 1] = 128 + dy * 110; img.data[i + 2] = 220; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// CPU mirror of hairMask() in materials.js: > 0 inside the hair-bearing scalp, ~0 at the hairline
function scalpDepth(p, eye) {
  if (Math.abs(p.x) > 0.12 || p.y < eye.y - 0.11) return -1;
  if (Math.abs(p.x) > 0.066 && p.y < eye.y + 0.034 && p.z > eye.z - 0.14 && p.z < eye.z - 0.05) return -1;
  const drop = THREE.MathUtils.clamp((eye.z - 0.055 - p.z) * 1.5, 0, 0.165);
  const peak = 0.01 * (1 - THREE.MathUtils.smoothstep(Math.abs(p.x), 0, 0.02)); // widow's peak (matches shader)
  return p.y - (eye.y + 0.064 - drop - peak);
}

function farthestSample(points, cand, count, first) {
  const out = [], dist = new Map();
  let cur = first ?? cand[0];
  for (let k = 0; k < Math.min(count, cand.length); k++) {
    out.push(cur);
    let best = cand[0], bd = -1;
    for (const i of cand) {
      const d = Math.min(dist.get(i) ?? Infinity, points[i].distanceToSquared(points[cur]));
      dist.set(i, d);
      if (d > bd) { bd = d; best = i; }
    }
    cur = best;
  }
  return out;
}

function mergeGeometries(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export function createHair(character, colliders, { material } = {}) {
  const { body } = character;
  const head = body.byName.head;
  const headPos = head.userData.head;
  const eye = new THREE.Vector3(...body.meta.landmarks.eyeL).setX(0);
  const normalMap = ropeNormalMap();
  const mat = material ?? new THREE.MeshPhysicalMaterial({ color: 0x0a0705, roughness: 0.58, metalness: 0.0, specularIntensity: 0.085, specularColor: new THREE.Color(1.0, 0.8, 0.55), normalMap, normalScale: new THREE.Vector2(0.9, 0.9) });
  const rnd = mulberry(7);

  // ---- scalp samples from the body mesh
  const bp = body.geometries.body.attributes.position, bn = body.geometries.body.attributes.normal;
  const scalpPts = [], scalpNrm = [], depth = [];
  const crown = new THREE.Vector3(0, -Infinity, 0);
  const p = new THREE.Vector3();
  for (let i = 0; i < bp.count; i++) {
    p.fromBufferAttribute(bp, i);
    if (p.y < eye.y - 0.12) continue;
    if (p.y > crown.y) crown.copy(p);
    const d = scalpDepth(p, eye);
    if (d < 0.002) continue;
    scalpPts.push(p.clone());
    scalpNrm.push(new THREE.Vector3().fromBufferAttribute(bn, i).normalize());
    depth.push(d);
  }
  const C = new THREE.Vector3(0, eye.y + 0.035, eye.z - 0.1);          // skull centre
  const scalpDir = scalpPts.map((q) => q.clone().sub(C).normalize());
  const scalpRad = scalpPts.map((q) => q.distanceTo(C));
  const radiusAlong = (dir) => { let best = -2, r = 0.1; for (let i = 0; i < scalpDir.length; i++) { const d = scalpDir[i].dot(dir); if (d > best) { best = d; r = scalpRad[i]; } } return r; };

  // ---- topknot: one thick rope of hair wound into a tall tapering pile
  const knot = new THREE.Group();
  {
    const pts = [], radii = [];
    const N = 110, turns = 4.1;
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = t * turns * Math.PI * 2;
      const R = 0.056 * (1 - t * 0.8) + 0.004, y = 0.004 + t * 0.15 + 0.005 * Math.sin(a * 2.0);
      pts.push(new THREE.Vector3(Math.cos(a) * R, y, Math.sin(a) * R));
      radii.push(0.03 * (1 - t * 0.42) * (i === 0 ? 0.6 : 1) * (t > 0.96 ? 1 - (t - 0.96) * 12 : 1) * (1 + 0.1 * Math.sin(a * 3.3)));
    }
    const g = tubeGeometry(pts, radii, 10);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.9, uv.getY(i) * 0.5);
    const coil = new THREE.Mesh(g, mat);
    coil.castShadow = true;
    knot.add(coil);
    // a few stray loops escaping the pile
    const strays = [];
    for (let k = 0; k < 7; k++) {
      const a0 = rnd() * 6.28, y0 = 0.02 + rnd() * 0.1, sp = [], sr = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10, a = a0 + t * (1.2 + rnd() * 0.4), R = (0.05 - y0 * 0.2) + 0.03 * Math.sin(t * Math.PI);
        sp.push(new THREE.Vector3(Math.cos(a) * R, y0 + 0.03 * Math.sin(t * Math.PI) * (k % 2 ? 1 : -0.4), Math.sin(a) * R));
        sr.push(0.0045 * (0.4 + 0.6 * Math.sin(t * Math.PI)));
      }
      strays.push(tubeGeometry(sp, sr, 5));
    }
    const stray = new THREE.Mesh(mergeGeometries(strays), mat);
    stray.castShadow = true;
    knot.add(stray);
  }
  const knotBase = crown.clone().add(new THREE.Vector3(0, -0.02, -0.032));
  knot.position.copy(knotBase).sub(headPos);
  knot.rotation.x = -0.2;
  head.add(knot);

  // ---- swept-back locks over the scalp: every lock starts fine at the hairline, thickens,
  // and runs over the skull into the base of the topknot
  {
    const all = scalpPts.map((_, i) => i);
    const line = all.filter((i) => depth[i] < 0.011);
    const inner = all.filter((i) => depth[i] >= 0.011 && scalpPts[i].distanceTo(knotBase) > 0.05);
    const starts = [...farthestSample(scalpPts, line, 60), ...farthestSample(scalpPts, inner, 70)];
    const dk = knotBase.clone().sub(C).normalize(), rk = knotBase.distanceTo(C);
    const tubes = [];
    const d = new THREE.Vector3(), side = new THREE.Vector3();
    for (const si of starts) {
      const ds = scalpDir[si], thick = 0.0065 + rnd() * 0.0045, wob = (rnd() - 0.5) * 0.02, ph = rnd() * 6.28;
      const ang = ds.angleTo(dk);
      const n = Math.max(5, Math.round(ang / 0.17) + 3);
      const pts = [], radii = [];
      side.crossVectors(ds, dk).normalize();
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        d.copy(ds).lerp(dk, t).normalize();                                   // great-arc towards the knot
        d.addScaledVector(side, Math.sin(t * Math.PI) * wob + 0.012 * t * Math.sin(t * 9 + ph)).normalize();
        // roots sit just under the skin so no cut ends show along the hairline
        const r = THREE.MathUtils.lerp(radiusAlong(d), rk, t * t) - 0.004 + (0.004 + thick) * Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5);
        pts.push(C.clone().addScaledVector(d, r).sub(headPos));
        radii.push(thick * (0.92 + 0.08 * THREE.MathUtils.smoothstep(t, 0, 0.25)) * (1 + 0.14 * Math.sin(j * 2.1 + ph)));
      }
      const g = tubeGeometry(pts, radii, 5);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.7 + ph, uv.getY(i) * 1.3);
      tubes.push(g);
    }
    const cap = new THREE.Mesh(mergeGeometries(tubes), mat);
    cap.castShadow = true;
    head.add(cap);
  }

  // ---- free locks: temples, sides and nape
  const cand = [];
  scalpPts.forEach((q, i) => {
    const back = q.z < eye.z - 0.085, temple = Math.abs(q.x) > 0.062 && q.z < eye.z - 0.062;
    if ((back || temple) && q.y < crown.y - 0.03) cand.push(i);
  });
  const roots = farthestSample(scalpPts, cand, LOCKS, cand.reduce((b, i) => (scalpPts[i].y < scalpPts[b].y ? i : b), cand[0]));
  const NL = roots.length;

  const sim = new Verlet(NL * POINTS);
  sim.iterations = 3;
  sim.substeps = 2;
  sim.colliders = colliders;
  const lockInfo = [];
  roots.forEach((ri, l) => {
    const root = scalpPts[ri], nrm = scalpNrm[ri];
    const low = THREE.MathUtils.clamp((crown.y - root.y) / 0.17, 0, 1);
    const front = THREE.MathUtils.smoothstep(root.z, eye.z - 0.1, eye.z - 0.05);        // 1 at the temples
    const dir = nrm.clone().multiplyScalar(0.8 - 0.3 * front)
      .add(new THREE.Vector3(Math.sign(root.x) * (0.12 + 0.2 * front), -0.5 - 0.45 * front, -0.45 + 0.6 * front)).normalize();
    const length = 0.28 + rnd() * 0.2 + low * 0.26 + front * 0.1;
    const seg = length / (POINTS - 1);
    const thick = 0.006 + rnd() * 0.006;
    lockInfo.push({ thick, seed: rnd(), wave: 0.006 + rnd() * 0.012, freq: 1.4 + rnd() * 1.6 });
    for (let j = 0; j < POINTS; j++) {
      const i = l * POINTS + j;
      sim.pos[i * 3] = root.x + dir.x * seg * j - nrm.x * 0.004;
      sim.pos[i * 3 + 1] = root.y + dir.y * seg * j - nrm.y * 0.004;
      sim.pos[i * 3 + 2] = root.z + dir.z * seg * j - nrm.z * 0.004;
      sim.radius[i] = thick * 0.8 + 0.004;
      sim.drag[i] = 0.02 + 0.014 * (j / POINTS);
      sim.windK[i] = (0.3 + 0.7 * (j / (POINTS - 1))) * (1 - 0.35 * front);
      if (j > 0) sim.link(i - 1, i, 1, seg);
      if (j > 1) sim.link(i - 2, i, 0.07, seg * 2); // slight bending resistance
    }
  });
  for (let l = 0; l < NL; l++) {
    sim.pin(l * POINTS, head);
    sim.target(l * POINTS + 1, head, 0.55);
    sim.target(l * POINTS + 2, head, 0.14);
    sim.target(l * POINTS + 3, head, 0.03);
  }
  sim.bindRest(() => head);

  // ---- tube mesh (Catmull-Rom smoothed, with a rest wave so locks are never ruler-straight)
  const ring = RADIAL + 1;
  const vcount = NL * RINGS * ring;
  const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), uvs = new Float32Array(vcount * 2);
  const idx = [];
  for (let l = 0; l < NL; l++) for (let j = 0; j < RINGS; j++) for (let r = 0; r < ring; r++) {
    const v = (l * RINGS + j) * ring + r;
    uvs[v * 2] = (r / RADIAL) * 2 + lockInfo[l].seed; uvs[v * 2 + 1] = j * 0.33 + lockInfo[l].seed * 5;
    if (j < RINGS - 1 && r < RADIAL) { const a = v, b = v + 1, c = v + ring, d = v + ring + 1; idx.push(a, c, b, b, c, d); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  character.group.add(mesh);

  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), Q = new THREE.Vector3();
  const cosT = [], sinT = [];
  for (let r = 0; r < ring; r++) { cosT.push(Math.cos((r / RADIAL) * Math.PI * 2)); sinT.push(Math.sin((r / RADIAL) * Math.PI * 2)); }
  const path = new Float32Array(RINGS * 3);
  const cr = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const rebuild = () => {
    const P = sim.pos;
    for (let l = 0; l < NL; l++) {
      const info = lockInfo[l], o = l * POINTS;
      for (let j = 0; j < RINGS; j++) {
        const s = Math.min(Math.floor(j / SUB), POINTS - 2), t = j / SUB - s;
        const i0 = o + Math.max(s - 1, 0), i1 = o + s, i2 = o + s + 1, i3 = o + Math.min(s + 2, POINTS - 1);
        for (let k = 0; k < 3; k++) path[j * 3 + k] = cr(P[i0 * 3 + k], P[i1 * 3 + k], P[i2 * 3 + k], P[i3 * 3 + k], t);
      }
      N.set(0.3, 0.2, 1);
      for (let j = 0; j < RINGS; j++) {
        const a = Math.max(j - 1, 0), b = Math.min(j + 1, RINGS - 1);
        T.set(path[b * 3] - path[a * 3], path[b * 3 + 1] - path[a * 3 + 1], path[b * 3 + 2] - path[a * 3 + 2]).normalize();
        N.addScaledVector(T, -N.dot(T));
        if (N.lengthSq() < 1e-6) N.set(T.y, -T.x, 0);
        N.normalize();
        B.crossVectors(T, N);
        const t = j / (RINGS - 1);
        const rad = info.thick * (1 - t * t * 0.8) * (1 + 0.2 * Math.sin(j * 1.3 + info.seed * 40)) * (j === 0 ? 0.7 : 1);
        const wv = info.wave * Math.sin(t * Math.PI) * 1.0, ph = t * info.freq * 6.283 + info.seed * 30;
        const px = path[j * 3] + (N.x * Math.sin(ph) + B.x * Math.cos(ph * 0.7)) * wv;
        const py = path[j * 3 + 1] + (N.y * Math.sin(ph) + B.y * Math.cos(ph * 0.7)) * wv;
        const pz = path[j * 3 + 2] + (N.z * Math.sin(ph) + B.z * Math.cos(ph * 0.7)) * wv;
        const base = (l * RINGS + j) * ring;
        for (let r = 0; r < ring; r++) {
          const v = (base + r) * 3;
          Q.copy(N).multiplyScalar(cosT[r]).addScaledVector(B, sinT[r]);
          nor[v] = Q.x; nor[v + 1] = Q.y; nor[v + 2] = Q.z;
          pos[v] = px + Q.x * rad; pos[v + 1] = py + Q.y * rad; pos[v + 2] = pz + Q.z * rad;
        }
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
  };

  return {
    sim, mesh, knot, materials: [mat],
    update(dt, time) { sim.update(dt, time); rebuild(); },
    reset() { sim.reset(); rebuild(); },
  };
}

export function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
