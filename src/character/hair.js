import * as THREE from 'three';
import { Verlet } from './verlet.js';
import { tubeGeometry } from './fit.js';

// Jata: matted locks. The scalp hair is painted by the skin shader (hairMask); here we
// add the coiled topknot (rigid on the head bone) and simulated locks that stream from
// the back and sides of the head.

const LOCKS = 72, POINTS = 12, RADIAL = 6, SUB = 2;
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

// CPU mirror of hairMask() in materials.js
function onScalp(p, eye) {
  const drop = THREE.MathUtils.clamp((eye.z - 0.055 - p.z) * 1.5, 0, 0.165);
  const line = eye.y + 0.072 - drop;
  if (p.y < line + 0.004 || Math.abs(p.x) > 0.12 || p.y < eye.y - 0.11) return false;
  if (Math.abs(p.x) > 0.066 && p.y < eye.y + 0.034 && p.z > eye.z - 0.14 && p.z < eye.z - 0.05) return false;
  return true;
}

export function createHair(character, colliders, { material } = {}) {
  const { body } = character;
  const head = body.byName.head;
  const headPos = head.userData.head;
  const eye = new THREE.Vector3(...body.meta.landmarks.eyeL);
  const normalMap = ropeNormalMap();
  const mat = material ?? new THREE.MeshPhysicalMaterial({ color: 0x120c08, roughness: 0.68, metalness: 0.0, specularIntensity: 0.3, normalMap, normalScale: new THREE.Vector2(0.8, 0.8) });

  // ---- scalp samples from the body mesh
  const bp = body.geometries.body.attributes.position, bn = body.geometries.body.attributes.normal;
  const scalpPts = [], scalpNrm = [];
  const crown = new THREE.Vector3(0, -Infinity, 0);
  const p = new THREE.Vector3();
  for (let i = 0; i < bp.count; i++) {
    p.fromBufferAttribute(bp, i);
    if (p.y < eye.y - 0.12) continue;
    if (p.y > crown.y) crown.copy(p);
    if (!onScalp(p, eye)) continue;
    scalpPts.push(p.clone());
    scalpNrm.push(new THREE.Vector3().fromBufferAttribute(bn, i).normalize());
  }

  // ---- topknot: one thick rope of hair wound into a tapering spiral
  const knot = new THREE.Group();
  {
    const pts = [], radii = [];
    const N = 90, turns = 3.4;
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = t * turns * Math.PI * 2;
      const R = 0.05 * (1 - t * 0.82) + 0.004, y = 0.006 + t * 0.118 + 0.004 * Math.sin(a * 2.0);
      pts.push(new THREE.Vector3(Math.cos(a) * R, y, Math.sin(a) * R));
      radii.push(0.026 * (1 - t * 0.42) * (i === 0 ? 0.6 : 1) * (t > 0.96 ? 1 - (t - 0.96) * 12 : 1));
    }
    const g = tubeGeometry(pts, radii, 9);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.9, uv.getY(i) * 0.5);
    const coil = new THREE.Mesh(g, mat);
    coil.castShadow = true;
    knot.add(coil);
    // base band gathering the hair
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.02, 8, 26), mat);
    band.rotation.x = Math.PI / 2; band.position.y = -0.006; band.scale.set(1, 1, 0.8);
    knot.add(band);
  }
  knot.position.copy(crown).sub(headPos).add(new THREE.Vector3(0, -0.012, -0.03));
  knot.rotation.x = -0.2;
  head.add(knot);

  // ---- free locks: roots are a farthest-point sample of the back / sides / nape
  const cand = [];
  scalpPts.forEach((q, i) => { if (q.z < eye.z - 0.085 && q.y < crown.y - 0.03) cand.push(i); });
  const roots = [];
  let cur = cand.reduce((b, i) => (scalpPts[i].y < scalpPts[b].y ? i : b), cand[0]);
  const dist = new Float32Array(scalpPts.length).fill(Infinity);
  for (let k = 0; k < LOCKS; k++) {
    roots.push(cur);
    let best = cand[0], bd = -1;
    for (const i of cand) {
      const d = scalpPts[i].distanceToSquared(scalpPts[cur]);
      if (d < dist[i]) dist[i] = d;
      if (dist[i] > bd) { bd = dist[i]; best = i; }
    }
    cur = best;
  }

  const sim = new Verlet(LOCKS * POINTS);
  sim.iterations = 3;
  sim.substeps = 2;
  sim.colliders = colliders;
  const rnd = mulberry(7);
  const lockInfo = [];
  roots.forEach((ri, l) => {
    const root = scalpPts[ri], nrm = scalpNrm[ri];
    const low = THREE.MathUtils.clamp((crown.y - root.y) / 0.17, 0, 1);
    const dir = nrm.clone().multiplyScalar(0.8).add(new THREE.Vector3(Math.sign(root.x) * 0.12, -0.5, -0.45)).normalize();
    const length = 0.26 + rnd() * 0.2 + low * 0.26;
    const seg = length / (POINTS - 1);
    const thick = 0.0056 + rnd() * 0.0054;
    lockInfo.push({ thick, seed: rnd(), wave: 0.006 + rnd() * 0.012, freq: 1.4 + rnd() * 1.6 });
    for (let j = 0; j < POINTS; j++) {
      const i = l * POINTS + j;
      sim.pos[i * 3] = root.x + dir.x * seg * j - nrm.x * 0.004;
      sim.pos[i * 3 + 1] = root.y + dir.y * seg * j - nrm.y * 0.004;
      sim.pos[i * 3 + 2] = root.z + dir.z * seg * j - nrm.z * 0.004;
      sim.radius[i] = thick * 0.8 + 0.004;
      sim.drag[i] = 0.02 + 0.014 * (j / POINTS);
      sim.windK[i] = 0.3 + 0.7 * (j / (POINTS - 1));
      if (j > 0) sim.link(i - 1, i, 1, seg);
      if (j > 1) sim.link(i - 2, i, 0.07, seg * 2); // slight bending resistance
    }
  });
  for (let l = 0; l < LOCKS; l++) {
    sim.pin(l * POINTS, head);
    sim.target(l * POINTS + 1, head, 0.55);
    sim.target(l * POINTS + 2, head, 0.14);
    sim.target(l * POINTS + 3, head, 0.03);
  }
  sim.bindRest(() => head);

  // ---- tube mesh (Catmull-Rom smoothed, with a rest wave so locks are never ruler-straight)
  const ring = RADIAL + 1;
  const vcount = LOCKS * RINGS * ring;
  const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), uvs = new Float32Array(vcount * 2);
  const idx = [];
  for (let l = 0; l < LOCKS; l++) for (let j = 0; j < RINGS; j++) for (let r = 0; r < ring; r++) {
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
    for (let l = 0; l < LOCKS; l++) {
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
