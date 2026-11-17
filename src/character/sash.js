import * as THREE from 'three';
import { makeSkinned } from './body.js';
import { sashMaterial } from './materials.js';

// A tiger-skin sash worn over the left shoulder and across the body to the right hip,
// front and back. It is laid on the rest-pose body surface and skinned with the weights
// of the skin directly beneath it, so it deforms exactly with the torso and never floats.
export function createSash(character, { width = 0.058, lift = 0.005 } = {}) {
  const { body } = character;
  const B = body.byName;
  const g = body.geometries.body;
  const pos = g.attributes.position, nrm = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const N = pos.count;
  const P = new THREE.Vector3(), Q = new THREE.Vector3();

  // torso-only vertex set (excludes arms, so rays never hit an arm in the bind pose)
  const shoulderX = Math.abs(B['upperarm01.L'].userData.head.x) - 0.02;
  const hipY = B['upperleg01.L'].userData.head.y - 0.04;
  const neckY = B['neck01'].userData.head.y + 0.03;
  const torso = [];
  for (let i = 0; i < N; i++) {
    const y = pos.getY(i), x = Math.abs(pos.getX(i));
    if (y > hipY && y < neckY && x < shoulderX + 0.03 * Math.max(0, (neckY - y) / 0.2)) torso.push(i);
  }

  // first surface vertex along a ray (vertices within `tol` of the ray, nearest to the origin)
  const cast = (o, d, tol = 0.014) => {
    let best = -1, bt = Infinity;
    for (const i of torso) {
      P.fromBufferAttribute(pos, i).sub(o);
      const t = P.dot(d);
      if (t <= 0 || t >= bt) continue;
      if (P.addScaledVector(d, -t).lengthSq() < tol * tol) { bt = t; best = i; }
    }
    return best;
  };

  // guide curve: back of the right hip -> up the back -> over the left shoulder -> down the front -> right hip
  const sh = B['clavicle.L'].userData.tail, beltY = B.hips.userData.head.y + 0.05;
  const top = new THREE.Vector3(sh.x + 0.005, sh.y + 0.04, sh.z - 0.02);
  const hipR = new THREE.Vector3(-0.15, beltY + 0.005, 0);
  const guides = [];
  const STEPS = 22;
  for (let i = STEPS; i >= 1; i--) {                 // back, from the hip up
    const t = i / STEPS, x = THREE.MathUtils.lerp(top.x, hipR.x, t), y = THREE.MathUtils.lerp(top.y - 0.06, hipR.y, t);
    guides.push({ o: new THREE.Vector3(x, y, -0.6), d: new THREE.Vector3(0, 0, 1), side: 'back' });
  }
  for (let k = -3; k <= 3; k++) {                    // over the shoulder: rays converge on the trapezius
    const a = (k / 3) * 1.25;
    const o = new THREE.Vector3(top.x, top.y - 0.04 + 0.5 * Math.cos(a), top.z + 0.5 * Math.sin(a));
    guides.push({ o, d: new THREE.Vector3(top.x, top.y - 0.04, top.z).sub(o).normalize() });
  }
  for (let i = 1; i <= STEPS; i++) {                 // front, down to the hip
    const t = i / STEPS, x = THREE.MathUtils.lerp(top.x, hipR.x, t), y = THREE.MathUtils.lerp(top.y - 0.06, hipR.y, t);
    guides.push({ o: new THREE.Vector3(x, y, 0.6), d: new THREE.Vector3(0, 0, -1), side: 'front' });
  }

  // surface samples (position, normal, nearest vertex for weights), smoothed along the strip
  let samples = [];
  for (const gd of guides) {
    const vi = cast(gd.o, gd.d);
    if (vi < 0) continue;
    // a ray that slipped past the near surface lands on the far side of the body: skip it
    const hz = pos.getZ(vi);
    if ((gd.side === 'front' && hz < 0.02) || (gd.side === 'back' && hz > 0.02)) continue;
    samples.push({ p: new THREE.Vector3().fromBufferAttribute(pos, vi), n: new THREE.Vector3().fromBufferAttribute(nrm, vi).normalize() });
  }
  for (let it = 0; it < 3; it++) {
    samples = samples.map((s, i) => {
      if (i === 0 || i === samples.length - 1) return s;
      return {
        p: s.p.clone().multiplyScalar(0.5).addScaledVector(samples[i - 1].p, 0.25).addScaledVector(samples[i + 1].p, 0.25),
        n: s.n.clone().multiplyScalar(0.5).addScaledVector(samples[i - 1].n, 0.25).addScaledVector(samples[i + 1].n, 0.25).normalize(),
      };
    });
  }

  // strip geometry: 3 vertices across (edges slightly lower so the band hugs the body)
  const ACROSS = 3, n = samples.length;
  const vp = new Float32Array(n * ACROSS * 3), vn = new Float32Array(n * ACROSS * 3), vuv = new Float32Array(n * ACROSS * 2);
  const vsi = new Uint16Array(n * ACROSS * 4), vsw = new Float32Array(n * ACROSS * 4);
  const idx = [];
  const T = new THREE.Vector3(), W = new THREE.Vector3();
  let along = 0;
  // nearest torso vertex for skin weights
  const nearest = (p) => { let b = 0, bd = Infinity; for (const i of torso) { const d = P.fromBufferAttribute(pos, i).distanceToSquared(p); if (d < bd) { bd = d; b = i; } } return b; };
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    T.subVectors(samples[Math.min(i + 1, n - 1)].p, samples[Math.max(i - 1, 0)].p).normalize();
    W.crossVectors(s.n, T).normalize();
    if (i > 0) along += s.p.distanceTo(samples[i - 1].p);
    for (let k = 0; k < ACROSS; k++) {
      const u = k / (ACROSS - 1) - 0.5, v = i * ACROSS + k;
      Q.copy(s.p).addScaledVector(W, u * width).addScaledVector(s.n, lift - Math.abs(u) * 0.004);
      Q.toArray(vp, v * 3);
      s.n.toArray(vn, v * 3);
      vuv[v * 2] = u + 0.5; vuv[v * 2 + 1] = along / width;
      const b = nearest(Q);
      for (let c = 0; c < 4; c++) { vsi[v * 4 + c] = si.getComponent(b, c); vsw[v * 4 + c] = sw.getComponent(b, c); }
      if (i < n - 1 && k < ACROSS - 1) { const a = v, b2 = v + 1, c = v + ACROSS, d = v + ACROSS + 1; idx.push(a, c, b2, b2, c, d); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vp, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(vn, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(vuv, 2));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(vsi, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(vsw, 4));
  geo.setIndex(idx);
  const mesh = makeSkinned(geo, sashMaterial(), body);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  character.group.add(mesh);
  return { mesh, samples: n };
}
