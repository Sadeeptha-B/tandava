import * as THREE from 'three';

// The real skin surface, for things that must lie on it: the sash is projected onto its triangles,
// and bead strands collide with a CPU-skinned sampling of it (so they ride over the pectorals,
// sternum and trapezius in any pose instead of sinking between fitted spheres).

const ARM = /^(upperarm|lowerarm|wrist|finger|metacarpal)/;

// share of a vertex's skin weight carried by arm / hand bones
export function armWeight(body, i) {
  const g = body.geometries.body, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const isArm = body._isArm ??= body.bones.map((b) => ARM.test(b.name));
  let w = 0;
  for (let c = 0; c < 4; c++) if (isArm[si.getComponent(i, c)]) w += sw.getComponent(i, c);
  return w;
}

// vertices of the trunk between two heights (arms excluded by their skin weights)
export function trunkVertices(body, yMin, yMax, maxArm = 0.5) {
  const pos = body.geometries.body.attributes.position, out = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > yMin && y < yMax && armWeight(body, i) <= maxArm) out.push(i);
  }
  return out;
}

// closest-point queries against the rest-pose triangles of a vertex set; returns the surface
// point, its interpolated normal and barycentric-blended skin weights
export function surfaceProjector(body, verts, cell = 0.025) {
  const g = body.geometries.body, pos = g.attributes.position, nrm = g.attributes.normal;
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, index = g.index.array;
  const inSet = new Uint8Array(pos.count);
  for (const i of verts) inSet[i] = 1;
  const grid = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const tris = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    if (!inSet[a] || !inSet[b] || !inSet[c]) continue;
    const k = key((pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(tris.length);
    tris.push(a, b, c);
  }
  const tri = new THREE.Triangle(), cp = new THREE.Vector3(), bary = new THREE.Vector3();
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), C = new THREE.Vector3(), n = new THREE.Vector3();
  // returns null if no triangle lies within ~1.5 cells of p
  return (p) => {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
    let best = -1, bd = Infinity;
    const point = new THREE.Vector3();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!list) continue;
      for (const t of list) {
        tri.set(A.fromBufferAttribute(pos, tris[t]), Bv.fromBufferAttribute(pos, tris[t + 1]), C.fromBufferAttribute(pos, tris[t + 2]));
        tri.closestPointToPoint(p, cp);
        const d = cp.distanceToSquared(p);
        if (d < bd) { bd = d; best = t; point.copy(cp); }
      }
    }
    if (best < 0) return null;
    const ids = [tris[best], tris[best + 1], tris[best + 2]];
    tri.set(A.fromBufferAttribute(pos, ids[0]), Bv.fromBufferAttribute(pos, ids[1]), C.fromBufferAttribute(pos, ids[2]));
    tri.getBarycoord(point, bary);
    const bw = [bary.x, bary.y, bary.z];
    n.set(0, 0, 0);
    const acc = new Map();
    ids.forEach((v, j) => {
      n.addScaledVector(A.fromBufferAttribute(nrm, v), bw[j]);
      for (let c = 0; c < 4; c++) {
        const w = sw.getComponent(v, c) * bw[j];
        if (w > 0) acc.set(si.getComponent(v, c), (acc.get(si.getComponent(v, c)) ?? 0) + w);
      }
    });
    const top = [...acc].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const sum = top.reduce((s, x) => s + x[1], 0) || 1;
    while (top.length < 4) top.push([0, 0]);
    return { point, normal: n.clone().normalize(), skinIndex: top.map((x) => x[0]), skinWeight: top.map((x) => x[1] / sum) };
  };
}

// Collider made of skinned surface samples. Particles are kept `radius` above the tangent plane
// of the nearest sample. Duck-types the capsule Collider (update / lerp / first) plus collide(sim).
export class SurfaceCollider {
  constructor(body, verts, { spacing = 0.015, cell = 0.03, range = 0.03 } = {}) {
    const g = body.geometries.body, pos = g.attributes.position, nrm = g.attributes.normal;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    // thin the vertex set to roughly one sample per `spacing` voxel
    const seen = new Set(), pick = [];
    for (const i of verts) {
      const k = `${Math.floor(pos.getX(i) / spacing)},${Math.floor(pos.getY(i) / spacing)},${Math.floor(pos.getZ(i) / spacing)}`;
      if (!seen.has(k)) { seen.add(k); pick.push(i); }
    }
    const N = this.n = pick.length;
    this.restP = new Float32Array(N * 3); this.restN = new Float32Array(N * 3);
    this.si = new Uint16Array(N * 4); this.sw = new Float32Array(N * 4);
    const used = new Set();
    pick.forEach((v, j) => {
      this.restP.set([pos.getX(v), pos.getY(v), pos.getZ(v)], j * 3);
      const nn = new THREE.Vector3().fromBufferAttribute(nrm, v).normalize();
      this.restN.set([nn.x, nn.y, nn.z], j * 3);
      for (let c = 0; c < 4; c++) { this.si[j * 4 + c] = si.getComponent(v, c); this.sw[j * 4 + c] = sw.getComponent(v, c); if (this.sw[j * 4 + c] > 0) used.add(this.si[j * 4 + c]); }
    });
    this.skeleton = body.skeleton;
    this.used = [...used];
    this.mats = new Float32Array(body.bones.length * 16);
    this.lastMats = new Float32Array(body.bones.length * 16).fill(NaN);
    this.cur = new Float32Array(N * 3); this.prev = new Float32Array(N * 3); this.nor = new Float32Array(N * 3);
    this.cell = cell; this.range = range;
    this.T = 8192;
    this.start = new Int32Array(this.T + 1); this.items = new Int32Array(N); this.keys = new Int32Array(N);
    this.f = 1;
    this.first = true;
    this.frame = 0;
    this._m = new THREE.Matrix4();
    // rest-pose neighbourhoods (CSR) for cheap nearest-sample refinement between full searches
    const R2 = (2.2 * spacing) ** 2, rp = this.restP, nbs = [], off = [0];
    for (let j = 0; j < N; j++) {
      for (let m = 0; m < N; m++) if ((rp[j * 3] - rp[m * 3]) ** 2 + (rp[j * 3 + 1] - rp[m * 3 + 1]) ** 2 + (rp[j * 3 + 2] - rp[m * 3 + 2]) ** 2 < R2) nbs.push(m);
      off.push(nbs.length);
    }
    this.nbOff = Int32Array.from(off); this.nb = Int32Array.from(nbs);
  }

  _hash(ix, iy, iz) { return (((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) >>> 0) % this.T; }

  update() {
    const { skeleton, mats, used } = this;
    for (const b of used) this._m.multiplyMatrices(skeleton.bones[b].matrixWorld, skeleton.boneInverses[b]).toArray(mats, b * 16);
    // the collider is shared by several solvers: skin it once per pose, not once per solver
    let same = !this.first;
    if (same) for (const b of used) { for (let e = 0; e < 16; e++) if (mats[b * 16 + e] !== this.lastMats[b * 16 + e]) { same = false; break; } if (!same) break; }
    if (same) return;
    this.lastMats.set(mats);
    this.prev.set(this.cur);
    const { restP, restN, si, sw, cur, nor, n } = this;
    for (let j = 0; j < n; j++) {
      const x = restP[j * 3], y = restP[j * 3 + 1], z = restP[j * 3 + 2];
      const nx = restN[j * 3], ny = restN[j * 3 + 1], nz = restN[j * 3 + 2];
      let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
      for (let c = 0; c < 4; c++) {
        const w = sw[j * 4 + c];
        if (w === 0) continue;
        const o = si[j * 4 + c] * 16;
        px += w * (mats[o] * x + mats[o + 4] * y + mats[o + 8] * z + mats[o + 12]);
        py += w * (mats[o + 1] * x + mats[o + 5] * y + mats[o + 9] * z + mats[o + 13]);
        pz += w * (mats[o + 2] * x + mats[o + 6] * y + mats[o + 10] * z + mats[o + 14]);
        qx += w * (mats[o] * nx + mats[o + 4] * ny + mats[o + 8] * nz);
        qy += w * (mats[o + 1] * nx + mats[o + 5] * ny + mats[o + 9] * nz);
        qz += w * (mats[o + 2] * nx + mats[o + 6] * ny + mats[o + 10] * nz);
      }
      cur[j * 3] = px; cur[j * 3 + 1] = py; cur[j * 3 + 2] = pz;
      const l = Math.hypot(qx, qy, qz) || 1;
      nor[j * 3] = qx / l; nor[j * 3 + 1] = qy / l; nor[j * 3 + 2] = qz / l;
    }
    if (this.first) { this.prev.set(cur); this.first = false; }
    this.frame++;
    // spatial hash (counting sort into buckets)
    const { start, items, keys, T, cell } = this;
    start.fill(0);
    for (let j = 0; j < n; j++) {
      keys[j] = this._hash(Math.floor(cur[j * 3] / cell), Math.floor(cur[j * 3 + 1] / cell), Math.floor(cur[j * 3 + 2] / cell));
      start[keys[j] + 1]++;
    }
    for (let k = 0; k < T; k++) start[k + 1] += start[k];
    const fill = start.slice(0, T);
    for (let j = 0; j < n; j++) items[fill[keys[j]]++] = j;
  }

  lerp(f) { this.f = f; }

  // rest pose: lift a point out of the skin so it sits `r` above the tangent plane of the nearest sample
  restPushOut(p, r) {
    const { restP, restN, n } = this;
    let best = 0, bd = Infinity;
    for (let j = 0; j < n; j++) {
      const d = (p.x - restP[j * 3]) ** 2 + (p.y - restP[j * 3 + 1]) ** 2 + (p.z - restP[j * 3 + 2]) ** 2;
      if (d < bd) { bd = d; best = j * 3; }
    }
    const depth = (p.x - restP[best]) * restN[best] + (p.y - restP[best + 1]) * restN[best + 1] + (p.z - restP[best + 2]) * restN[best + 2] - r;
    if (depth < 0) p.set(p.x - restN[best] * depth, p.y - restN[best + 1] * depth, p.z - restN[best + 2] * depth);
    return p;
  }

  collide(sim) {
    const { pos, prev: pk, invMass, radius, n: np } = sim;
    const { cur, prev, nor, start, items, cell, f, nb, nbOff } = this;
    const r2 = this.range * this.range;
    // full hash search once per pose; later passes in the same frame only refine among the
    // neighbours of the sample found then (particles move far less than a sample spacing)
    if (!sim._surfNear) sim._surfNear = new Int32Array(np).fill(-1);
    const near = sim._surfNear, full = sim._surfFrame !== this.frame;
    sim._surfFrame = this.frame;
    for (let i = 0; i < np; i++) {
      if (invMass[i] === 0) continue;
      const k = i * 3, px = pos[k], py = pos[k + 1], pz = pos[k + 2];
      let best = -1, bd = r2;
      if (full) {
        const cx = Math.floor(px / cell), cy = Math.floor(py / cell), cz = Math.floor(pz / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const h = this._hash(cx + dx, cy + dy, cz + dz);
          for (let s = start[h], e = start[h + 1]; s < e; s++) {
            const j = items[s] * 3;
            const d = (px - cur[j]) ** 2 + (py - cur[j + 1]) ** 2 + (pz - cur[j + 2]) ** 2;
            if (d < bd) { bd = d; best = j; }
          }
        }
        near[i] = best < 0 ? -1 : best / 3;
      } else {
        const j0 = near[i];
        if (j0 < 0) continue;
        for (let s = nbOff[j0], e = nbOff[j0 + 1]; s < e; s++) {
          const j = nb[s] * 3;
          const d = (px - cur[j]) ** 2 + (py - cur[j + 1]) ** 2 + (pz - cur[j + 2]) ** 2;
          if (d < bd) { bd = d; best = j; }
        }
        if (best >= 0) near[i] = best / 3;
      }
      if (best < 0) continue;
      // contact point at this substep (the sample moves from its previous to its current pose)
      const bx = prev[best] + (cur[best] - prev[best]) * f, by = prev[best + 1] + (cur[best + 1] - prev[best + 1]) * f, bz = prev[best + 2] + (cur[best + 2] - prev[best + 2]) * f;
      const nx = nor[best], ny = nor[best + 1], nz = nor[best + 2];
      const depth = (px - bx) * nx + (py - by) * ny + (pz - bz) * nz - radius[i];
      if (depth >= 0) continue;
      pos[k] -= nx * depth; pos[k + 1] -= ny * depth; pos[k + 2] -= nz * depth;
      // friction: bleed tangential velocity while in contact
      pk[k] += (pos[k] - pk[k]) * 0.25; pk[k + 1] += (pos[k + 1] - pk[k + 1]) * 0.25; pk[k + 2] += (pos[k + 2] - pk[k + 2]) * 0.25;
    }
  }
}
