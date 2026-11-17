import * as THREE from 'three';
import { Verlet } from './verlet.js';
import { tubeGeometry } from './fit.js';

// Jata: long hair, partly gathered into a coiled topknot, the rest falling free.
//   1. the coiled topknot with a gold and pearl band (rigid)
//   2. locks from the front and crown laid over the scalp up into the knot (rigid)
//   3. sweeping locks: from the temples and sides, lying along the scalp back over the ears,
//      then falling down the back â€“ so the side of the head reads as one continuous flow
//   4. front locks that fall forward over each shoulder, framing the face
//   5. back and nape locks, a mix of broad clumps and matted ropes
// Free locks are broad, flattened clumps (not round ropes) with a fine strand texture.
// The skin shader paints the scalp dark underneath (hairMask) so no skin shows between locks.

const BACK = 64, SWEEP = 32, FRONT = 8, POINTS = 12, RADIAL = 6, SUB = 2;
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

function strandNormalMap() {
  const w = 128, h = 64, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const rnd = mulberry(11);
  const jitter = Array.from({ length: 64 }, () => rnd());
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    // fine strands running along the lock (v), bunched into a few sub-clumps
    const k = u * 18 + 0.35 * Math.sin(v * 6.283 * 2 + jitter[Math.floor(u * 64)] * 6);
    const dx = Math.cos(k * 6.283) * 0.5 + Math.cos(u * 6.283 * 3 + v * 3) * 0.35;
    const i = (y * w + x) * 4;
    img.data[i] = 128 + dx * 115; img.data[i + 1] = 128; img.data[i + 2] = 225; img.data[i + 3] = 255;
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
  const rimU = { uRim: { value: new THREE.Color(0, 0, 0) } };
  const makeMat = (map, key) => {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0x0b090a, roughness: 0.5, metalness: 0.0, specularIntensity: 0.14,
      specularColor: new THREE.Color(0.55, 0.75, 1.0), normalMap: map, normalScale: new THREE.Vector2(0.9, 0.9),
    });
    m.customProgramCacheKey = () => 'hair-rim-' + key;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, rimU);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float fr = 1. - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0., 1.);
  totalEmissiveRadiance += uRim * pow(fr, 3.6);
}`);
    };
    return m;
  };
  const mat = material ?? makeMat(normalMap, 'rope');
  const flowMat = material ?? makeMat(strandNormalMap(), 'strand');
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
  // skull radius along a direction from C, measured from every head vertex (ears included), so hair
  // lies on the real surface and rises over the ears instead of floating where the scalp mask has gaps
  const headDir = [], headRad = [];
  for (let i = 0; i < bp.count; i++) {
    p.fromBufferAttribute(bp, i);
    const r = p.distanceTo(C);
    if (p.y < eye.y - 0.1 || r > 0.16) continue;
    headDir.push(p.clone().sub(C).divideScalar(r)); headRad.push(r);
  }
  const radiusAlong = (dir) => {
    // max radius among the closest few directions: the outer surface, not an inner fold
    let best = -2, r = 0.1;
    for (let i = 0; i < headDir.length; i++) { const d = headDir[i].dot(dir); if (d > best) { best = d; r = headRad[i]; } }
    let rr = r;
    for (let i = 0; i < headDir.length; i++) if (headDir[i].dot(dir) > best - 0.0012 && headRad[i] > rr) rr = headRad[i];
    return rr;
  };

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
  {
    // gold band and a string of pearls binding the knot
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8a343, roughness: 0.3, metalness: 1.0 });
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.081, 0.0065, 8, 40), gold);
    band.rotation.x = Math.PI / 2; band.position.y = 0.012; band.scale.set(1, 1, 0.9);
    const NP = 30, pearls = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe9e2d4, roughness: 0.2 }), NP);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < NP; i++) { const a = (i / NP) * Math.PI * 2; m4.makeScale(0.0058, 0.0058, 0.0058).setPosition(Math.cos(a) * 0.08, 0.03, Math.sin(a) * 0.072); pearls.setMatrixAt(i, m4); }
    band.castShadow = pearls.castShadow = true;
    knot.add(band, pearls);
  }
  const knotBase = crown.clone().add(new THREE.Vector3(0, -0.02, -0.032));
  knot.position.copy(knotBase).sub(headPos);
  knot.rotation.x = -0.2;
  head.add(knot);

  // ---- swept-back hair over the scalp: broad, flat, overlapping ribbons that start flush with the
  // skin at the hairline (a clean edge, no tips) and run over the skull into the base of the topknot
  {
    const all = scalpPts.map((_, i) => i);
    const central = (i) => Math.abs(scalpPts[i].x) < 0.046 || scalpPts[i].y > crown.y - 0.045;
    const line = all.filter((i) => depth[i] < 0.011 && central(i));
    const inner = all.filter((i) => depth[i] >= 0.011 && central(i) && scalpPts[i].distanceTo(knotBase) > 0.05);
    const starts = [...farthestSample(scalpPts, line, 46), ...farthestSample(scalpPts, inner, 56)];
    const dk = knotBase.clone().sub(C).normalize(), rk = knotBase.distanceTo(C);
    const tubes = [];
    const d = new THREE.Vector3(), side = new THREE.Vector3(), Tn = new THREE.Vector3(), Wn = new THREE.Vector3(), On = new THREE.Vector3(), V3 = new THREE.Vector3();
    const SIDES = 6;
    // flat ribbon along pts: half-width w[j] across the skull, half-thickness h[j] off it
    const ribbon = (pts, outs, w, h, ph) => {
      const n = pts.length, ring = SIDES + 1, P = [], Nn = [], U = [], I = [];
      for (let j = 0; j < n; j++) {
        Tn.subVectors(pts[Math.min(j + 1, n - 1)], pts[Math.max(j - 1, 0)]).normalize();
        On.copy(outs[j]);
        Wn.crossVectors(Tn, On).normalize();
        const Hn = V3.crossVectors(Wn, Tn).normalize();
        for (let r = 0; r < ring; r++) {
          const a = (r / SIDES) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
          // lens-shaped section: flat underside resting on the scalp, domed top
          const up = sn > 0 ? sn : sn * 0.25;
          P.push(pts[j].x + Wn.x * c * w[j] + Hn.x * up * h[j], pts[j].y + Wn.y * c * w[j] + Hn.y * up * h[j], pts[j].z + Wn.z * c * w[j] + Hn.z * up * h[j]);
          const nx = Wn.x * c / Math.max(w[j], 1e-4) + Hn.x * sn / Math.max(h[j], 1e-4), ny = Wn.y * c / Math.max(w[j], 1e-4) + Hn.y * sn / Math.max(h[j], 1e-4), nz = Wn.z * c / Math.max(w[j], 1e-4) + Hn.z * sn / Math.max(h[j], 1e-4);
          const l = Math.hypot(nx, ny, nz) || 1;
          Nn.push(nx / l, ny / l, nz / l);
          U.push((r / SIDES) * 0.8 + ph, j * 0.45);
          if (j < n - 1 && r < SIDES) { const a0 = j * ring + r; I.push(a0, a0 + ring, a0 + 1, a0 + 1, a0 + ring, a0 + ring + 1); }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setIndex(I);
      return g;
    };
    for (const si of starts) {
      const ds = scalpDir[si], thick = 0.0065 + rnd() * 0.0045, wob = (rnd() - 0.5) * 0.02, ph = rnd() * 6.28;
      const ang = ds.angleTo(dk);
      const n = Math.max(5, Math.round(ang / 0.17) + 3);
      const pts = [], outs = [], w = [], h = [];
      side.crossVectors(ds, dk).normalize();
      const layer = 0.0015 + rnd() * 0.003;           // slight stacking so neighbours overlap cleanly
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        d.copy(ds).lerp(dk, t).normalize();                                   // great-arc towards the knot
        d.addScaledVector(side, Math.sin(t * Math.PI) * wob + 0.012 * t * Math.sin(t * 9 + ph)).normalize();
        const grow = THREE.MathUtils.smoothstep(t, 0, 0.3);                  // flush at the hairline, full by a third
        const r = THREE.MathUtils.lerp(radiusAlong(d), rk, t * t) + 0.0008 + (layer + 0.004 * Math.abs(d.x)) * grow;
        pts.push(C.clone().addScaledVector(d, r).sub(headPos));
        outs.push(d.clone());
        w.push(thick * 2.3 * (0.75 + 0.25 * grow) * (1 + 0.1 * Math.sin(j * 2.1 + ph)));
        h.push(thick * 0.55 * (0.15 + 0.85 * grow));
      }
      tubes.push(ribbon(pts, outs, w, h, ph));
    }
    const cap = new THREE.Mesh(mergeGeometries(tubes), mat);
    cap.castShadow = true;
    head.add(cap);
  }

  // ---- simulated locks. Each definition is a rest path (bind pose), a thickness and how
  // strongly its first few points hold their shape against the head.
  const defs = [];

  const earDir = (sgn) => new THREE.Vector3(sgn * 0.078, eye.y - 0.02 - C.y, eye.z - 0.095 - C.z).normalize();
  // lay points over the skull along a great arc from direction ds to dt, standing `lift` off it
  const overSkull = (ds, dt, n, liftOf) => {
    const out = [], d = new THREE.Vector3();
    for (let j = 0; j < n; j++) {
      const t = j / (n - 1);
      d.copy(ds).lerp(dt, t).normalize();
      out.push(C.clone().addScaledVector(d, radiusAlong(d) + liftOf(t, d)));
    }
    return out;
  };
  const hang = (pts, dir, count, seg, sgn) => {
    const cur = pts[pts.length - 1].clone(), step = dir.clone().normalize().multiplyScalar(seg);
    for (let j = 0; j < count; j++) {
      cur.add(step);
      if (cur.y < eye.y - 0.075 && Math.abs(cur.x) < 0.1 && cur.z > -0.05) cur.x = sgn * 0.1;   // clear of jaw and neck
      pts.push(cur.clone());
    }
    return pts;
  };

  // (5) back and nape: broad clumps mixed with matted ropes
  {
    const cand = [];
    scalpPts.forEach((q, i) => { if (q.z < eye.z - 0.12 && q.y < crown.y - 0.03) cand.push(i); });
    const roots = farthestSample(scalpPts, cand, BACK, cand.reduce((m, i) => (scalpPts[i].y < scalpPts[m].y ? i : m), cand[0]));
    for (const ri of roots) {
      const root = scalpPts[ri], nrm = scalpNrm[ri], sgn = Math.sign(root.x) || 1;
      const low = THREE.MathUtils.clamp((crown.y - root.y) / 0.17, 0, 1);
      const dir = nrm.clone().multiplyScalar(0.7).add(new THREE.Vector3(sgn * 0.1, -0.6, -0.4)).normalize();
      const length = 0.3 + rnd() * 0.24 + low * 0.24, seg = length / (POINTS - 1);
      const pts = [];
      for (let j = 0; j < POINTS; j++) pts.push(root.clone().addScaledVector(dir, seg * j).addScaledVector(nrm, -0.004));
      const rope = rnd() < 0.3;
      defs.push({ pts, thick: rope ? 0.006 + rnd() * 0.004 : 0.01 + rnd() * 0.005, aspect: rope ? 1 : 1.8 + rnd() * 1.0, hold: [0.55, 0.14, 0.03], wind: 1, flow: !rope, pivot: 0.14 });
    }
  }

  // (3) sweeping locks: temple and side hairline -> along the scalp over the ear -> down the back
  for (const sgn of [-1, 1]) {
    const cand = [];
    scalpPts.forEach((q, i) => {
      const ax = Math.abs(q.x);
      if (q.x * sgn > 0 && ax > 0.036 && q.y > eye.y - 0.025 && q.y < crown.y - 0.04 && q.z > eye.z - 0.14 && q.z < eye.z - 0.035) cand.push(i);
    });
    const roots = farthestSample(scalpPts, cand, SWEEP);
    const ear = earDir(sgn);
    for (const ri of roots) {
      const ds = scalpDir[ri];
      const thick = 0.011 + rnd() * 0.006;
      const dt = ds.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), sgn * (1.05 + rnd() * 0.25));
      dt.y -= 0.3 + rnd() * 0.15;
      dt.normalize();
      const off = 0.003 + thick * 0.35 + 0.003 * rnd();
      const lift = (t, d) => -0.004 + (0.004 + off) * Math.min(1, t * 3) + 0.003 * THREE.MathUtils.smoothstep(d.dot(ear), 0.88, 0.97);
      const pts = overSkull(ds, dt, 5, lift);
      const T = pts[4].clone().sub(pts[3]).normalize();
      hang(pts, T.lerp(new THREE.Vector3(sgn * 0.12, -1, -0.5).normalize(), 0.65), POINTS - 5, (0.26 + rnd() * 0.22) / (POINTS - 5), sgn);
      defs.push({ pts, thick, aspect: 2.3 + rnd() * 0.9, hold: [0.85, 0.75, 0.6, 0.35, 0.12], wind: 0.5, flow: true, drag: 0.03 });
    }
  }

  // (4) front locks: behind the ear, forward over the shoulder onto the chest
  for (const sgn of [-1, 1]) {
    const cand = [];
    scalpPts.forEach((q, i) => {
      if (q.x * sgn > 0.058 && q.y > eye.y - 0.01 && q.y < eye.y + 0.06 && q.z > eye.z - 0.16 && q.z < eye.z - 0.085) cand.push(i);
    });
    const roots = farthestSample(scalpPts, cand, FRONT);
    for (const ri of roots) {
      const ds = scalpDir[ri], thick = 0.01 + rnd() * 0.005;
      const dt = new THREE.Vector3(sgn * 0.72, -0.62, -0.32).normalize();
      const pts = overSkull(ds, dt, 3, (t) => -0.004 + (0.006 + thick * 0.35) * Math.min(1, t * 2));
      hang(pts, new THREE.Vector3(sgn * 0.3, -1, 0.24), POINTS - 3, (0.34 + rnd() * 0.12) / (POINTS - 3), sgn);
      defs.push({ pts, thick, aspect: 2.0 + rnd() * 0.8, hold: [0.85, 0.6, 0.3, 0.1], wind: 0.25, flow: true, drag: 0.05, pivot: -0.3 });
    }
  }

  const NL = defs.length;
  const sim = new Verlet(NL * POINTS);
  sim.iterations = 3;
  sim.substeps = 2;
  sim.colliders = colliders;
  const lockInfo = [];
  defs.forEach((def, l) => {
    lockInfo.push({ thick: def.thick, aspect: def.aspect ?? 1, flow: !!def.flow, pivot: new THREE.Vector3(0, 0, def.pivot ?? 0), seed: rnd(), wave: (def.flow ? 0.004 : 0.006) + rnd() * 0.01, freq: 1.2 + rnd() * 1.4 });
    for (let j = 0; j < POINTS; j++) {
      const i = l * POINTS + j, q = def.pts[j];
      sim.pos[i * 3] = q.x; sim.pos[i * 3 + 1] = q.y; sim.pos[i * 3 + 2] = q.z;
      sim.radius[i] = def.thick * (0.5 + 0.3 / (def.aspect ?? 1)) + 0.004;
      sim.drag[i] = (def.drag ?? 0.02) + 0.014 * (j / POINTS);
      sim.windK[i] = (0.3 + 0.7 * (j / (POINTS - 1))) * def.wind;
      if (j > 0) sim.link(i - 1, i, 1);
      if (j > 1) sim.link(i - 2, i, 0.07); // slight bending resistance
    }
  });
  defs.forEach((def, l) => {
    sim.pin(l * POINTS, head);
    def.hold.forEach((k, j) => sim.target(l * POINTS + 1 + j, head, k));
  });
  sim.bindRest(() => head);
  const side = new Float32Array(NL);
  defs.forEach((def, l) => { side[l] = Math.sign(def.pts[0].x) || 1; });
  const inv = new THREE.Matrix4(), lp = new THREE.Vector3(), wp = new THREE.Vector3();
  const faceGuard = () => {
    inv.copy(head.matrixWorld).invert();
    const P = sim.pos, Pr = sim.prev;
    for (let l = 0; l < NL; l++) for (let j = 1; j < POINTS; j++) {
      const i = l * POINTS + j;
      lp.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(inv);
      if (lp.z < 0.015 || lp.y < -0.12 || lp.y > 0.125 || Math.abs(lp.x) > 0.085) continue;
      const sx = Math.abs(lp.x) > 0.02 ? Math.sign(lp.x) : side[l];
      const dx = sx * 0.088 - lp.x;
      lp.x += dx;
      wp.copy(lp).applyMatrix4(head.matrixWorld);
      const ox = wp.x - P[i * 3], oy = wp.y - P[i * 3 + 1], oz = wp.z - P[i * 3 + 2];
      P[i * 3] = wp.x; P[i * 3 + 1] = wp.y; P[i * 3 + 2] = wp.z;
      Pr[i * 3] += ox; Pr[i * 3 + 1] += oy; Pr[i * 3 + 2] += oz;
    }
  };

  // ---- tube mesh (Catmull-Rom smoothed, with a rest wave so locks are never ruler-straight)
  const ring = RADIAL + 1;
  const vcount = NL * RINGS * ring;
  const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), uvs = new Float32Array(vcount * 2);
  const idxRope = [], idxFlow = [];
  for (let l = 0; l < NL; l++) for (let j = 0; j < RINGS; j++) for (let r = 0; r < ring; r++) {
    const v = (l * RINGS + j) * ring + r, info = lockInfo[l];
    uvs[v * 2] = (r / RADIAL) * (info.flow ? 1 : 2) + info.seed; uvs[v * 2 + 1] = j * (info.flow ? 0.12 : 0.33) + info.seed * 5;
    if (j < RINGS - 1 && r < RADIAL) { const a = v, b = v + 1, c = v + ring, d = v + ring + 1; (info.flow ? idxFlow : idxRope).push(a, c, b, b, c, d); }
  }
  const idx = [...idxRope, ...idxFlow];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.addGroup(0, idxRope.length, 0);
  geo.addGroup(idxRope.length, idxFlow.length, 1);
  const mesh = new THREE.Mesh(geo, [mat, flowMat]);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  character.group.add(mesh);

  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), Q = new THREE.Vector3();
  const cosT = [], sinT = [];
  for (let r = 0; r < ring; r++) { cosT.push(Math.cos((r / RADIAL) * Math.PI * 2)); sinT.push(Math.sin((r / RADIAL) * Math.PI * 2)); }
  const path = new Float32Array(RINGS * 3);
  const cr = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const Cl = C.clone().sub(headPos), Hc = new THREE.Vector3(), W = new THREE.Vector3(), Wp = new THREE.Vector3(), Th = new THREE.Vector3(), O = new THREE.Vector3();
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
      Wp.set(0, 0, 0);
      const rw = info.aspect, rt = 1 / Math.sqrt(info.aspect);
      // broad faces point away from a per-group pivot: side locks sideways, front locks forward, back locks back
      Hc.copy(Cl).add(info.pivot).applyMatrix4(head.matrixWorld);
      for (let j = 0; j < RINGS; j++) {
        const a = Math.max(j - 1, 0), b = Math.min(j + 1, RINGS - 1);
        T.set(path[b * 3] - path[a * 3], path[b * 3 + 1] - path[a * 3 + 1], path[b * 3 + 2] - path[a * 3 + 2]).normalize();
        N.addScaledVector(T, -N.dot(T));
        if (N.lengthSq() < 1e-6) N.set(T.y, -T.x, 0);
        N.normalize();
        B.crossVectors(T, N);
        const t = j / (RINGS - 1);
        const lump = info.flow ? 0.08 : 0.2;
        const rad = info.thick * (1 - t * t * 0.8) * (1 + lump * Math.sin(j * 1.3 + info.seed * 40)) * (j === 0 ? 0.7 : 1);
        // broad axis W: tangent to a cylinder around the head's vertical axis, across the lock
        O.set(path[j * 3] - Hc.x, 0, path[j * 3 + 2] - Hc.z);
        W.crossVectors(T, O.lengthSq() > 1e-6 ? O.normalize() : N);
        if (W.lengthSq() < 1e-6) W.copy(N); else W.normalize();
        if (Wp.lengthSq() > 0 && W.dot(Wp) < 0) W.negate();
        Wp.copy(W);
        Th.crossVectors(W, T);
        const flat = info.aspect > 1.01 ? Math.min(1, t * 12 + 0.25) : 0;   // roots stay round, then fan out
        const aw = 1 + (rw - 1) * flat, at = 1 + (rt - 1) * flat;
        const wv = info.wave * Math.sin(t * Math.PI) * 1.0, ph = t * info.freq * 6.283 + info.seed * 30;
        const px = path[j * 3] + (N.x * Math.sin(ph) + B.x * Math.cos(ph * 0.7)) * wv;
        const py = path[j * 3 + 1] + (N.y * Math.sin(ph) + B.y * Math.cos(ph * 0.7)) * wv;
        const pz = path[j * 3 + 2] + (N.z * Math.sin(ph) + B.z * Math.cos(ph * 0.7)) * wv;
        const base = (l * RINGS + j) * ring;
        for (let r = 0; r < ring; r++) {
          const v = (base + r) * 3;
          if (info.aspect > 1.01) {
            Q.copy(W).multiplyScalar(cosT[r] / aw).addScaledVector(Th, sinT[r] / at).normalize();
            nor[v] = Q.x; nor[v + 1] = Q.y; nor[v + 2] = Q.z;
            Q.copy(W).multiplyScalar(cosT[r] * aw).addScaledVector(Th, sinT[r] * at);
          } else {
            Q.copy(N).multiplyScalar(cosT[r]).addScaledVector(B, sinT[r]);
            nor[v] = Q.x; nor[v + 1] = Q.y; nor[v + 2] = Q.z;
          }
          pos[v] = px + Q.x * rad; pos[v + 1] = py + Q.y * rad; pos[v + 2] = pz + Q.z * rad;
        }
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
  };

  return {
    sim, mesh, knot, materials: [mat, flowMat], rim: rimU.uRim.value,
    update(dt, time) { sim.update(dt, time); faceGuard(); rebuild(); },
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
