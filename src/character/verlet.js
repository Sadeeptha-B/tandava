import * as THREE from 'three';

// Small position-based (Verlet) solver shared by hair locks, cloth panels, sashes and bead strings.
// Particles can be pinned to bones; colliders are capsules stretched between bone-space points.

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3();

export class Collider {
  // capsule from (boneA, offsetA) to (boneB, offsetB) with radii rA / rB (a sphere if boneB is omitted)
  constructor(boneA, offA, rA, boneB = null, offB = null, rB = rA) {
    this.boneA = boneA; this.offA = offA ?? new THREE.Vector3(); this.rA = rA;
    this.boneB = boneB; this.offB = offB ?? new THREE.Vector3(); this.rB = rB;
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3();
    this.pa = new THREE.Vector3(); this.pb = new THREE.Vector3(); // previous frame
    this.ca = new THREE.Vector3(); this.cb = new THREE.Vector3(); // current substep
    this.first = true;
  }
  update() {
    this.pa.copy(this.a); this.pb.copy(this.b);
    this.a.copy(this.offA).applyMatrix4(this.boneA.matrixWorld);
    if (this.boneB) this.b.copy(this.offB).applyMatrix4(this.boneB.matrixWorld); else this.b.copy(this.a);
    if (this.first) { this.pa.copy(this.a); this.pb.copy(this.b); this.first = false; }
  }
  lerp(t) { this.ca.lerpVectors(this.pa, this.a, t); this.cb.lerpVectors(this.pb, this.b, t); }
}

export class Verlet {
  constructor(n) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.invMass = new Float32Array(n).fill(1);
    this.drag = new Float32Array(n).fill(0.012);
    this.windK = new Float32Array(n).fill(1);
    this.radius = new Float32Array(n).fill(0.01);
    this.cons = []; // flat: i, j, rest, stiffness
    this.pins = []; // { i, bone, local, world, prevWorld }
    this.targets = []; // soft shape targets: { i, bone, local, k }
    this.colliders = [];
    this.gravity = -9.8;
    this.iterations = 4;
    this.substeps = 2;
    this.floor = -Infinity;
    this.wind = null; // (x, y, z, time, out) => acceleration
    this.rest = []; // { bone, local } per particle for resets
    this._w = new THREE.Vector3();
  }

  link(i, j, stiffness = 1, rest = null) {
    if (rest === null) {
      const p = this.pos;
      rest = Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
    }
    this.cons.push(i, j, rest, stiffness);
  }

  // call once after particles are placed in the bind pose
  bindRest(boneOf) {
    for (let i = 0; i < this.n; i++) {
      const bone = boneOf(i);
      const local = new THREE.Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]).applyMatrix4(_m.copy(bone.matrixWorld).invert());
      this.rest.push({ bone, local });
    }
    this.prev.set(this.pos);
    this.C = new Float32Array(this.cons);
  }

  pin(i, bone) {
    const local = new THREE.Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]).applyMatrix4(_m.copy(bone.matrixWorld).invert());
    this.invMass[i] = 0;
    this.pins.push({ i, bone, local, world: new THREE.Vector3(), prevWorld: new THREE.Vector3() });
  }

  target(i, bone, k) {
    const local = new THREE.Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]).applyMatrix4(_m.copy(bone.matrixWorld).invert());
    this.targets.push({ i, bone, local, k, w: new THREE.Vector3() });
  }

  reset() {
    for (let i = 0; i < this.n; i++) {
      const r = this.rest[i];
      _p.copy(r.local).applyMatrix4(r.bone.matrixWorld);
      this.pos[i * 3] = _p.x; this.pos[i * 3 + 1] = Math.max(_p.y, this.floor); this.pos[i * 3 + 2] = _p.z;
    }
    this.prev.set(this.pos);
    for (const pin of this.pins) { pin.world.copy(pin.local).applyMatrix4(pin.bone.matrixWorld); pin.prevWorld.copy(pin.world); }
    for (const c of this.colliders) { c.first = true; c.update(); }
  }

  update(dt, time) {
    if (dt <= 0) return;
    dt = Math.min(dt, 1 / 30);
    const { pos, prev, invMass, n } = this;
    for (const pin of this.pins) { pin.prevWorld.copy(pin.world); pin.world.copy(pin.local).applyMatrix4(pin.bone.matrixWorld); }
    for (const t of this.targets) t.w.copy(t.local).applyMatrix4(t.bone.matrixWorld);
    for (const c of this.colliders) c.update();
    const h = dt / this.substeps, h2 = h * h;
    const C = this.C, nc = C.length / 4;
    const w = this._w;
    for (let s = 1; s <= this.substeps; s++) {
      const f = s / this.substeps;
      // integrate
      for (let i = 0; i < n; i++) {
        if (invMass[i] === 0) continue;
        const k = i * 3;
        const x = pos[k], y = pos[k + 1], z = pos[k + 2];
        const damp = 1 - this.drag[i];
        let ax = 0, ay = this.gravity, az = 0;
        if (this.wind) {
          this.wind(x, y, z, time, w, i);
          const wk = this.windK[i];
          ax += w.x * wk; ay += w.y * wk; az += w.z * wk;
        }
        pos[k] = x + (x - prev[k]) * damp + ax * h2;
        pos[k + 1] = y + (y - prev[k + 1]) * damp + ay * h2;
        pos[k + 2] = z + (z - prev[k + 2]) * damp + az * h2;
        prev[k] = x; prev[k + 1] = y; prev[k + 2] = z;
      }
      for (const pin of this.pins) {
        const k = pin.i * 3;
        pos[k] = pin.prevWorld.x + (pin.world.x - pin.prevWorld.x) * f;
        pos[k + 1] = pin.prevWorld.y + (pin.world.y - pin.prevWorld.y) * f;
        pos[k + 2] = pin.prevWorld.z + (pin.world.z - pin.prevWorld.z) * f;
      }
      for (const c of this.colliders) c.lerp(f);
      for (let it = 0; it < this.iterations; it++) {
        for (let q = 0; q < nc; q++) {
          const i = C[q * 4], j = C[q * 4 + 1], rest = C[q * 4 + 2], st = C[q * 4 + 3];
          const wi = invMass[i], wj = invMass[j];
          const ws = wi + wj;
          if (ws === 0) continue;
          const a = i * 3, b = j * 3;
          const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = ((d - rest) / d) * st / ws;
          pos[a] += dx * diff * wi; pos[a + 1] += dy * diff * wi; pos[a + 2] += dz * diff * wi;
          pos[b] -= dx * diff * wj; pos[b + 1] -= dy * diff * wj; pos[b + 2] -= dz * diff * wj;
        }
        for (const t of this.targets) {
          const k = t.i * 3;
          pos[k] += (t.w.x - pos[k]) * t.k; pos[k + 1] += (t.w.y - pos[k + 1]) * t.k; pos[k + 2] += (t.w.z - pos[k + 2]) * t.k;
        }
        if (it === this.iterations - 1 || it === 0) this._collide();
      }
    }
  }

  _collide() {
    const { pos, n, invMass, radius } = this;
    for (const c of this.colliders) {
      const ax = c.ca.x, ay = c.ca.y, az = c.ca.z;
      const bx = c.cb.x - ax, by = c.cb.y - ay, bz = c.cb.z - az;
      const len2 = bx * bx + by * by + bz * bz;
      const maxR = Math.max(c.rA, c.rB) + 0.03;
      for (let i = 0; i < n; i++) {
        if (invMass[i] === 0) continue;
        const k = i * 3;
        const px = pos[k] - ax, py = pos[k + 1] - ay, pz = pos[k + 2] - az;
        let t = len2 > 0 ? (px * bx + py * by + pz * bz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxR * maxR) continue;
        const r = c.rA + (c.rB - c.rA) * t + radius[i];
        if (d2 < r * r) {
          const d = Math.sqrt(d2) || 1e-6;
          const push = (r - d) / d;
          pos[k] += dx * push; pos[k + 1] += dy * push; pos[k + 2] += dz * push;
          // friction: bleed tangential velocity while in contact
          const pk = this.prev;
          pk[k] += (pos[k] - pk[k]) * 0.25; pk[k + 1] += (pos[k + 1] - pk[k + 1]) * 0.25; pk[k + 2] += (pos[k + 2] - pk[k + 2]) * 0.25;
        }
      }
    }
    if (this.floor > -Infinity) {
      for (let i = 0; i < n; i++) if (pos[i * 3 + 1] < this.floor) { pos[i * 3 + 1] = this.floor; const k = i * 3; this.prev[k] += (pos[k] - this.prev[k]) * 0.4; this.prev[k + 2] += (pos[k + 2] - this.prev[k + 2]) * 0.4; }
    }
  }
}
const _m = new THREE.Matrix4();
