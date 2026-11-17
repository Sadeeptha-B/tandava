import * as THREE from 'three';

// Analytic rig solver. All bones have identity rest rotation, so a bone's world
// quaternion is its rotation *from the rest pose*. Conventions: metres, Y up,
// the character faces +Z and its left side is +X.

const V = () => new THREE.Vector3();
const Q = () => new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = V(), _y = V(), _z = V(), _a = V(), _b = V(), _c = V(), _d = V();
const _q1 = Q(), _q2 = Q(), _q3 = Q();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

// quaternion whose Y axis is `yDir` and whose X axis is as close as possible to `xHint`
function frameQ(out, yDir, xHint) {
  _y.copy(yDir).normalize();
  _x.copy(xHint).addScaledVector(_y, -xHint.dot(_y));
  if (_x.lengthSq() < 1e-10) _x.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

// q = swing * twist(axis)   (twist is applied first)
function swingTwist(q, axis, swing, twist) {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  twist.set(axis.x * d, axis.y * d, axis.z * d, q.w);
  if (twist.lengthSq() < 1e-12) twist.identity(); else twist.normalize();
  swing.copy(q).multiply(_q3.copy(twist).invert());
}

export const FINGERS = 5;
export const CURLS = FINGERS * 4; // per finger: 3 curls + 1 spread

export class Rig {
  constructor(body) {
    this.body = body;
    this.b = body.byName;
    this.W = {}; // world rotations (from rest)
    this.P = {}; // world joint positions
    for (const bone of body.bones) { this.W[bone.name] = Q(); this.P[bone.name] = V(); }
    const head = (n) => this.b[n].userData.head;

    // ---- limbs
    this.limbs = {};
    const mkLimb = (key, parent, names, hingeRest) => {
      const [u1, u2, l1, l2, end] = names.map((n) => this.b[n]);
      const S0 = head(names[0]), E0 = head(names[2]), W0 = head(names[4]);
      const u0 = V().subVectors(E0, S0), f0 = V().subVectors(W0, E0);
      const L1 = u0.length(), L2 = f0.length();
      u0.normalize(); f0.normalize();
      const h0 = hingeRest ? hingeRest.clone() : V().crossVectors(u0, f0).normalize();
      const pivot = (twistBone, A, dir) => { // offset from the twist bone head to the limb axis
        const p = head(twistBone.name);
        return V().copy(A).addScaledVector(dir, V().subVectors(p, A).dot(dir)).sub(p);
      };
      this.limbs[key] = {
        key, parent, u1, u2, l1, l2, end, L1, L2, u0, f0, h0,
        FU0inv: frameQ(Q(), u0, h0).invert(), FL0inv: frameQ(Q(), f0, h0).invert(),
        cU: pivot(u2, S0, u0), cL: pivot(l2, E0, f0),
        Wu: Q(), Wl: Q(), K: V(), A: V(),
      };
    };
    for (const s of ['L', 'R']) {
      mkLimb('leg' + s, 'hips', [`upperleg01.${s}`, `upperleg02.${s}`, `lowerleg01.${s}`, `lowerleg02.${s}`, `foot.${s}`], X);
      for (const x of ['', '2']) {
        mkLimb('arm' + s + x, `shoulder01.${s}`, [`upperarm01.${s}${x}`, `upperarm02.${s}${x}`, `lowerarm01.${s}${x}`, `lowerarm02.${s}${x}`, `wrist.${s}${x}`]);
      }
    }
    this.legLength = this.limbs.legL.L1 + this.limbs.legL.L2;
    this.armLength = this.limbs.armL.L1 + this.limbs.armL.L2;

    // ---- feet
    this.feet = {};
    for (const s of ['L', 'R']) {
      const ankle = head(`foot.${s}`), ball = head(`toe.${s}`);
      this.feet[s] = {
        ankleH: ankle.y,
        toBall: V().subVectors(ball, ankle), // ankle -> ball joint
        toHeel: V(-0.004 * (s === 'L' ? 1 : -1), -ankle.y, -0.055),
        ballH: ball.y,
      };
    }

    // ---- hands
    this.hands = {};
    for (const s of ['L', 'R']) for (const x of ['', '2']) {
      const k = s + x;
      const w = head(`wrist.${k}`);
      const idx = V().subVectors(head(`finger2-1.${k}`), w), pky = V().subVectors(head(`finger5-1.${k}`), w);
      const fingers0 = V().subVectors(head(`finger3-1.${k}`), w).normalize();
      const palm0 = s === 'L' ? V().crossVectors(pky, idx) : V().crossVectors(idx, pky);
      palm0.normalize();
      const F0inv = frameQ(Q(), fingers0, palm0).invert();
      const fingers = [];
      for (let f = 1; f <= 5; f++) {
        const b1 = this.b[`finger${f}-1.${k}`], b2 = this.b[`finger${f}-2.${k}`], b3 = this.b[`finger${f}-3.${k}`];
        const dir = V().subVectors(b3.userData.tail, b1.userData.head).normalize();
        let axis;
        if (f === 1) {
          const toward = V().subVectors(head(`finger5-1.${k}`), b1.userData.head).normalize().addScaledVector(palm0, 0.55).normalize();
          axis = V().crossVectors(dir, toward).normalize();
        } else axis = V().crossVectors(dir, palm0).normalize();
        // positive spread fans a finger away from the middle finger (thumb/index one way, ring/little the other)
        fingers.push({ bones: [b1, b2, b3], axis, spreadAxis: palm0.clone().multiplyScalar((s === 'L' ? 1 : -1) * (f >= 4 ? -1 : 1)) });
      }
      this.hands[k] = { fingers0, palm0, F0inv, fingers, palmCenter: V().addVectors(idx, pky).multiplyScalar(0.5) };
    }

    // rear arm pair sits slightly behind / above the natural shoulder joint
    this.rearOffset = new THREE.Vector3(-0.012, 0.014, -0.034);
    this.spineBones = ['spine04', 'spine03', 'spine02', 'spine01'].map((n) => this.b[n]);
    this.spineBend = [0.16, 0.26, 0.3, 0.28];
    this.spineTwist = [0.08, 0.2, 0.32, 0.4];
    this.neckBones = ['neck01', 'neck02', 'neck03'].map((n) => this.b[n]);
    this._e = new THREE.Euler();
    this._pole = V(); this._tmp = V(); this._endRot = Q();
    this._headRel = Q(); this._headInit = false;
  }

  // ---- forward bookkeeping: world rot/pos of a bone given its parent's
  _fk(bone) {
    const p = bone.parent, n = bone.name;
    this.W[n].multiplyQuaternions(this.W[p.name], bone.quaternion);
    this.P[n].copy(bone.position).applyQuaternion(this.W[p.name]).add(this.P[p.name]);
  }

  /**
   * pose = {
   *   hipsPos: Vector3, hipsRot: Quaternion,
   *   spine: { fwd, side, twist }, head: Quaternion (world),
   *   legs: { L|R: { ankle: Vector3, rot: Quaternion, pole: Vector3, toe: number } },
   *   arms: { L|R|L2|R2: { u, f: Vector3 (chest space), pole: Vector3, hand: Quaternion|null (chest space), curls: Float32Array(20) } },
   * }
   */
  apply(pose) {
    const b = this.b, W = this.W, P = this.P;
    const hips = b.hips;
    hips.position.copy(pose.hipsPos);
    hips.quaternion.copy(pose.hipsRot);
    W.hips.copy(pose.hipsRot);
    P.hips.copy(pose.hipsPos);

    // spine
    const sp = pose.spine;
    this.spineBones.forEach((bone, i) => {
      this._e.set(sp.fwd * this.spineBend[i], sp.twist * this.spineTwist[i], -sp.side * this.spineBend[i], 'YXZ');
      bone.quaternion.setFromEuler(this._e);
      this._fk(bone);
    });

    // neck + head: head reaches a world-space orientation, shared along the neck
    const rel = _q1.copy(W.spine01).invert().multiply(pose.head);
    if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
    const ang = 2 * Math.acos(Math.min(1, rel.w));
    const lim = 1.15;
    if (ang > lim) rel.slerp(_q2.identity(), 1 - lim / ang).normalize();
    // rate-limit the neck so a "spotting" head whip is fast but never teleports
    if (pose.dt > 0 && this._headInit) this._headRel.rotateTowards(rel, 13 * pose.dt); else { this._headRel.copy(rel); this._headInit = true; }
    rel.copy(this._headRel);
    for (const bone of this.neckBones) { bone.quaternion.identity().slerp(rel, 0.2); this._fk(bone); }
    b.head.quaternion.identity().slerp(rel, 0.4);
    this._fk(b.head);

    // clavicles respond to how high the arms on that side are raised
    for (const s of ['L', 'R']) {
      const sg = s === 'L' ? 1 : -1;
      const a1 = pose.arms[s], a2 = pose.arms[s + '2'];
      const up = Math.max(0, a1.u.y) * 0.22 + Math.max(0, a2.u.y) * 0.2 + 0.05 * Math.max(a1.u.y, a2.u.y);
      const fwd = (a1.u.z + a2.u.z) * 0.1;
      const cl = b[`clavicle.${s}`];
      this._e.set(0, -sg * fwd, sg * up, 'YZX');
      cl.quaternion.setFromEuler(this._e);
      this._fk(cl);
      const sh = b[`shoulder01.${s}`];
      sh.quaternion.identity();
      this._fk(sh);
    }

    // arms
    for (const k of ['L', 'R', 'L2', 'R2']) {
      const limb = this.limbs['arm' + k], a = pose.arms[k];
      const chest = W.spine01;
      const sg = k[0] === 'L' ? 1 : -1;
      limb.u1.position.copy(limb.u1.userData.restPosition);
      if (k.length === 2) limb.u1.position.add(_a.copy(this.rearOffset).setX(this.rearOffset.x * sg));
      const S = _a.copy(limb.u1.position).applyQuaternion(W[limb.parent]).add(P[limb.parent]);
      const u = _b.copy(a.u).applyQuaternion(chest).normalize();
      const f = _c.copy(a.f).applyQuaternion(chest).normalize();
      limb.K.copy(S).addScaledVector(u, limb.L1);
      limb.A.copy(limb.K).addScaledVector(f, limb.L2);
      // hinge: u x f, falling back smoothly to the pole when the arm is nearly straight
      const hinge = _d.crossVectors(u, f);
      const bend = hinge.length();
      const pole = this._pole.copy(a.pole).applyQuaternion(chest);
      // the elbow only flexes one way: when a fast swing leaves the forearm trailing behind the
      // upper arm (a momentary "hyper-extension"), lean on the pole instead of flipping the hinge
      const ref = this._tmp.crossVectors(pole, u).normalize();
      const pw = 0.3 * (1 - THREE.MathUtils.smoothstep(bend, 0.2, 0.6)) + Math.max(0, -hinge.dot(ref)) * 2.2;
      if (pw > 0) hinge.addScaledVector(ref, pw);
      this._solveLimb(limb, S, u, f, hinge, a.hand ? this._endRot.multiplyQuaternions(chest, a.hand) : null);
      this._fingers(k, a.curls);
    }

    // legs
    for (const s of ['L', 'R']) {
      const limb = this.limbs['leg' + s], l = pose.legs[s];
      limb.u1.position.copy(limb.u1.userData.restPosition);
      const H = _a.copy(limb.u1.position).applyQuaternion(W.hips).add(P.hips);
      const n = _b.subVectors(l.ankle, H);
      let d = n.length();
      n.multiplyScalar(1 / d);
      d = Math.min(d, (limb.L1 + limb.L2) * 0.9995);
      d = Math.max(d, Math.abs(limb.L1 - limb.L2) + 0.02);
      const a = (limb.L1 * limb.L1 - limb.L2 * limb.L2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(limb.L1 * limb.L1 - a * a, 0));
      const pp = _c.copy(l.pole).addScaledVector(n, -l.pole.dot(n)).normalize();
      limb.K.copy(H).addScaledVector(n, a).addScaledVector(pp, h);
      limb.A.copy(H).addScaledVector(n, d);
      const hinge = _d.crossVectors(pp, n);
      const t = this._pole.subVectors(limb.K, H).normalize();
      const sdir = this._tmp.subVectors(limb.A, limb.K).normalize();
      this._solveLimb(limb, H, t, sdir, hinge, l.rot);
      const toe = b[`toe.${s}`];
      toe.quaternion.setFromAxisAngle(X, l.toe);
      this._fk(toe);
    }

    this.body.root.updateMatrixWorld(true);
  }

  _solveLimb(limb, S, u, f, hinge, endRot) {
    const W = this.W, P = this.P;
    const Wp = W[limb.parent];
    frameQ(limb.Wu, u, hinge).multiply(limb.FU0inv);
    frameQ(limb.Wl, f, hinge).multiply(limb.FL0inv);
    // upper: swing on *01, twist on *02 (about the limb axis, pivot-compensated)
    const q = _q1.copy(Wp).invert().multiply(limb.Wu);
    const swing = limb.u1.quaternion, twist = limb.u2.quaternion;
    swingTwist(q, limb.u0, swing, twist);
    limb.u2.position.copy(limb.u2.userData.restPosition).add(limb.cU).sub(_x.copy(limb.cU).applyQuaternion(twist));
    this._fk(limb.u1); this._fk(limb.u2);
    // elbow / knee
    limb.l1.quaternion.copy(W[limb.u2.name]).invert().multiply(limb.Wl);
    this._fk(limb.l1);
    // end effector: twist on *02, remainder on the wrist / ankle
    if (endRot) {
      const r = _q2.copy(limb.Wl).invert().multiply(endRot);
      // r = twist * swing  <=>  r^-1 = swing^-1 * twist^-1
      r.invert();
      const sw = _q1, tw = limb.l2.quaternion;
      swingTwist(r, limb.f0, sw, tw);
      tw.invert();
      limb.end.quaternion.copy(sw).invert();
    } else {
      limb.l2.quaternion.identity();
      limb.end.quaternion.identity();
    }
    limb.l2.position.copy(limb.l2.userData.restPosition).add(limb.cL).sub(_x.copy(limb.cL).applyQuaternion(limb.l2.quaternion));
    this._fk(limb.l2); this._fk(limb.end);
  }

  _fingers(k, curls) {
    const hand = this.hands[k];
    for (let f = 0; f < 5; f++) {
      const fg = hand.fingers[f];
      for (let j = 0; j < 3; j++) {
        const q = fg.bones[j].quaternion.setFromAxisAngle(fg.axis, curls[f * 4 + j]);
        if (j === 0) q.premultiply(_q3.setFromAxisAngle(fg.spreadAxis, curls[f * 4 + 3]));
      }
    }
  }

  // hand orientation (from rest) that points the fingers along `fingers` with the palm facing `palm`
  handQuat(out, k, fingers, palm) {
    return frameQ(out, fingers, palm).multiply(this.hands[k].F0inv);
  }
}
