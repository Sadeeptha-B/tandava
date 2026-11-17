import * as THREE from 'three';

// Measures the rest-pose body so ornaments and garments can be fitted to it.
// profile(): radial silhouette of the mesh around an axis through `center`.
export function profile(body, center, axis, { slab = 0.012, maxR = 0.12, bins = 24, ref = null } = {}) {
  const pos = body.geometries.body.attributes.position;
  const a = axis.clone().normalize();
  const u = (ref ?? (Math.abs(a.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0))).clone();
  u.addScaledVector(a, -u.dot(a)).normalize();
  const v = new THREE.Vector3().crossVectors(a, u);
  const r = new Float32Array(bins);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).sub(center);
    const h = p.dot(a);
    if (Math.abs(h) > slab) continue;
    const x = p.dot(u), y = p.dot(v);
    const d = Math.hypot(x, y);
    if (d > maxR) continue;
    const b = Math.floor(((Math.atan2(y, x) / (Math.PI * 2) + 1) % 1) * bins) % bins;
    if (d > r[b]) r[b] = d;
  }
  // fill gaps and smooth
  let mean = 0, cnt = 0;
  for (const x of r) if (x > 0) { mean += x; cnt++; }
  mean = cnt ? mean / cnt : 0.05;
  for (let i = 0; i < bins; i++) if (r[i] === 0) r[i] = mean;
  const sm = new Float32Array(bins);
  for (let i = 0; i < bins; i++) sm[i] = (r[(i + bins - 1) % bins] + 2 * r[i] + r[(i + 1) % bins]) / 4;
  const radius = (theta) => {
    const f = ((theta / (Math.PI * 2)) % 1 + 1) % 1 * bins - 0.5;
    const i0 = Math.floor(f), t = f - i0;
    return sm[(i0 + bins) % bins] * (1 - t) + sm[(i0 + 1 + bins) % bins] * t;
  };
  // point on the silhouette at angle theta (theta = 0 along `u`), pushed out by `offset`
  const point = (theta, offset = 0, out = new THREE.Vector3()) => {
    const d = radius(theta) + offset;
    return out.copy(center).addScaledVector(u, Math.cos(theta) * d).addScaledVector(v, Math.sin(theta) * d);
  };
  return { radius, point, mean, u, v, axis: a, center: center.clone() };
}

// generic tube along a list of points with per-point elliptical radii
export function tubeGeometry(points, radii, radial = 8, closedEnds = true) {
  const n = points.length, ring = radial + 1;
  const pos = [], nor = [], uv = [], idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(0.21, 0.35, 0.91), B = new THREE.Vector3(), Q = new THREE.Vector3();
  for (let j = 0; j < n; j++) {
    T.subVectors(points[Math.min(j + 1, n - 1)], points[Math.max(j - 1, 0)]).normalize();
    N.addScaledVector(T, -N.dot(T)).normalize();
    B.crossVectors(T, N);
    const [ra, rb] = Array.isArray(radii[j]) ? radii[j] : [radii[j], radii[j]];
    for (let r = 0; r < ring; r++) {
      const th = (r / radial) * Math.PI * 2;
      Q.copy(N).multiplyScalar(Math.cos(th) * ra).addScaledVector(B, Math.sin(th) * rb);
      pos.push(points[j].x + Q.x, points[j].y + Q.y, points[j].z + Q.z);
      Q.copy(N).multiplyScalar(Math.cos(th) / Math.max(ra, 1e-5)).addScaledVector(B, Math.sin(th) / Math.max(rb, 1e-5)).normalize();
      nor.push(Q.x, Q.y, Q.z);
      uv.push((r / radial) * 3, j * 0.35);
      if (j < n - 1 && r < radial) { const a = j * ring + r; idx.push(a, a + ring, a + 1, a + 1, a + ring, a + ring + 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// re-express a world-space (bind pose) geometry in a bone's local space and parent it
export function attachToBone(mesh, bone) {
  mesh.geometry.translate(-bone.userData.head.x, -bone.userData.head.y, -bone.userData.head.z);
  bone.add(mesh);
  return mesh;
}
