import * as THREE from 'three';
import { CURLS } from './rig.js';

// ---------------------------------------------------------------------------
// Keyframe engine. Time is measured in beats. Every channel is a flat float
// vector interpolated with a monotone cubic Hermite spline (no overshoot, so a
// planted foot stays exactly planted), with optional per-key easing:
//   'hit'  – arrive with velocity and stop dead (foot stamps, accents)
//   'stop' – zero velocity through the key
//   'lin'  – linear in / out
// ---------------------------------------------------------------------------

const deg = Math.PI / 180;

// finger order: thumb, index, middle, ring, little; per finger [curl1, curl2, curl3, spread]
// (radians). The rest hand is splayed: a negative spread closes index, ring and little toward
// the middle finger, a positive one fans them out (alapadma).
export const MUDRA = {
  relaxed: [.1, .15, .15, .05, .22, .28, .18, .03, .26, .3, .2, 0, .3, .32, .2, .02, .34, .34, .2, .06],
  pataka: [.25, .1, .2, -.28, -.14, -.06, 0, -.03, -.14, -.06, 0, 0, -.14, -.06, 0, -.04, -.12, -.06, 0, -.02],
  cup: [-.1, .05, .05, .5, .1, .16, .12, .12, .14, .18, .12, 0, .16, .2, .12, .1, .16, .22, .14, .2],
  alapadma: [-.15, 0, 0, .6, -.34, -.08, 0, .3, .02, .1, .05, 0, .55, .3, .1, .2, 1.0, .5, .2, .36],
  grip: [.5, .4, .45, -.1, 1.0, 1.1, .6, 0, 1.1, 1.2, .6, 0, 1.15, 1.2, .6, 0, 1.2, 1.2, .6, 0],
  kataka: [.55, .3, .4, -.1, 1.0, .9, .3, 0, 1.05, 1.0, .3, 0, .25, .15, 0, .15, -.06, .05, 0, .3],
  tripataka: [.25, .1, .2, -.28, -.14, -.06, 0, -.03, -.14, -.06, 0, 0, 1.3, .5, .2, 0, -.12, -.06, 0, -.02],
  fist: [.6, .5, .6, -.2, 1.45, 1.5, 1.0, 0, 1.45, 1.5, 1.0, 0, 1.45, 1.5, 1.0, 0, 1.45, 1.5, 1.0, 0],
  dola: [.1, .1, .1, .1, .1, .16, .12, .04, .16, .2, .14, 0, .22, .24, .16, .03, .28, .28, .18, .08],
  // nritya (storytelling) hands
  // chandrakala, the crescent moon: thumb and index stretched apart, the rest folded
  chandrakala: [-.25, 0, 0, .9, -.1, -.05, 0, -.05, 1.45, 1.5, 1.0, 0, 1.45, 1.5, 1.0, 0, 1.45, 1.5, 1.0, 0],
  // sarpashirsha, the serpent's hood: pataka with the fingers held together and gently domed
  sarpashirsha: [.25, .1, .2, -.3, .14, .06, .04, -.3, .14, .06, .04, 0, .14, .06, .04, -.26, .16, .08, .04, -.42],
  // mrigashirsha, the deer's head: the three middle fingers bent forward, thumb and little finger raised
  mrigashirsha: [-.2, 0, 0, .5, 1.35, .35, .15, 0, 1.4, .35, .15, 0, 1.4, .35, .15, 0, -.1, -.05, 0, .4],
};

const ARM_SCHEMA = [['u', 3, [0.3, -0.9, 0.1]], ['f', 3, [0.2, -0.9, 0.3]], ['hand', 4, [0, 0, 0, 1]], ['pole', 3, [0, -0.5, -1]], ['curls', CURLS, MUDRA.relaxed]];
// foot: (x, z) is the heel/ankle ground point, or the ball of the foot when pivot = 1 (turns on the ball)
const FOOT_SCHEMA = [['x', 1, [0]], ['z', 1, [0]], ['lift', 1, [0]], ['yaw', 1, [0]], ['pitch', 1, [0]], ['roll', 1, [0]], ['pole', 3, [0, 0, 0]], ['rel', 1, [0]], ['pivot', 1, [0]]];
export const SCHEMA = {
  hips: [['w', 1, [0.5]], ['dx', 1, [0]], ['y', 1, [0.98]], ['dz', 1, [0]], ['yaw', 1, [0]], ['pitch', 1, [0]], ['roll', 1, [0]]],
  spine: [['fwd', 1, [0]], ['side', 1, [0]], ['twist', 1, [0]]],
  head: [['yaw', 1, [0]], ['pitch', 1, [0]], ['roll', 1, [0]]],
  footL: FOOT_SCHEMA, footR: FOOT_SCHEMA,
  armL: ARM_SCHEMA, armR: ARM_SCHEMA, armL2: ARM_SCHEMA, armR2: ARM_SCHEMA,
  fx: [['damaru', 1, [0]], ['flame', 1, [0.6]], ['wind', 1, [0.2]]],
};
const MIRROR_X = { armR: ['u', 'f', 'pole'], armR2: ['u', 'f', 'pole'] };

class Channel {
  constructor(name, schema, handQuat = null) {
    this.name = name;
    // arms: palm / fingers directions are authored, but stored (and interpolated) as a rotation,
    // so a hand can never collapse through a zero vector when it turns over
    this.handQuat = handQuat;
    this.aux = { palm: [-1, 0, 0], fingers: [0.1, -0.95, 0.3] };
    this.auxDirty = !!handQuat;
    this.schema = schema;
    this.size = schema.reduce((s, f) => s + f[1], 0);
    this.offset = {};
    let o = 0;
    for (const [n, sz] of schema) { this.offset[n] = o; o += sz; }
    this.keys = []; // {t, v, ease}
    this.state = new Float32Array(this.size);
    for (const [n, sz, def] of schema) for (let i = 0; i < sz; i++) this.state[this.offset[n] + i] = def[i];
  }

  add(t, props) {
    const mirror = MIRROR_X[this.name];
    for (const [k, val] of Object.entries(props)) {
      if (k === 'ease') continue;
      if (k === 'mudra') { this.state.set(MUDRA[val], this.offset.curls); continue; }
      if (k === 'palm' || k === 'fingers') { this.aux[k] = [mirror ? -val[0] : val[0], val[1], val[2]]; this.auxDirty = true; continue; }
      const o = this.offset[k];
      if (o === undefined) throw new Error(`unknown prop ${this.name}.${k}`);
      if (typeof val === 'number') this.state[o] = val;
      else {
        for (let i = 0; i < val.length; i++) this.state[o + i] = val[i];
        if (mirror && mirror.includes(k)) this.state[o] = -this.state[o];
      }
    }
    if (this.auxDirty) {
      const q = this.handQuat(this.aux.fingers, this.aux.palm), o = this.offset.hand, s = this.state;
      // keep consecutive keys in the same hemisphere so interpolation takes the short way round
      const sign = q.x * s[o] + q.y * s[o + 1] + q.z * s[o + 2] + q.w * s[o + 3] < 0 ? -1 : 1;
      s[o] = q.x * sign; s[o + 1] = q.y * sign; s[o + 2] = q.z * sign; s[o + 3] = q.w * sign;
      this.auxDirty = false;
    }
    const last = this.keys[this.keys.length - 1];
    if (last && Math.abs(last.t - t) < 1e-6) { last.v = this.state.slice(); last.ease = props.ease ?? last.ease; }
    else this.keys.push({ t, v: this.state.slice(), ease: props.ease });
  }

  finalize(period, wrap) {
    const ks = this.keys.sort((a, b) => a.t - b.t);
    const n = ks.length;
    if (!n) throw new Error('channel without keys: ' + this.name);
    const wv = new Float32Array(this.size);
    if (wrap) for (const [k, val] of Object.entries(wrap)) wv[this.offset[k]] = val;
    const shifted = (k, s) => ({ t: k.t + s * period, v: k.v.map((x, i) => x + s * wv[i]), ease: k.ease });
    const ext = [];
    const pre = Math.min(2, n);
    for (let i = n - pre; i < n; i++) ext.push(shifted(ks[i], -1));
    for (const k of ks) ext.push(k);
    for (let i = 0; i < pre; i++) ext.push(shifted(ks[i], 1));
    if (n === 1) { ext.unshift(shifted(ks[0], -2)); ext.push(shifted(ks[0], 2)); }
    if (this.offset.hand !== undefined) {
      // hand rotations: q and -q are the same pose, so keep the whole (wrapped) sequence sign-continuous
      const o = this.offset.hand;
      for (let i = 1; i < ext.length; i++) {
        const a = ext[i - 1].v;
        if (ext[i].v === a) continue;
        const b = ext[i].v = ext[i].v.slice();
        if (a[o] * b[o] + a[o + 1] * b[o + 1] + a[o + 2] * b[o + 2] + a[o + 3] * b[o + 3] < 0) for (let k = 0; k < 4; k++) b[o + k] = -b[o + k];
      }
    }
    const N = ext.length, S = this.size;
    this.T = new Float32Array(N);
    this.Vv = new Float32Array(N * S);
    this.Min = new Float32Array(N * S);
    this.Mout = new Float32Array(N * S);
    ext.forEach((k, i) => { this.T[i] = k.t; this.Vv.set(k.v, i * S); });
    for (let i = 1; i < N - 1; i++) {
      const hl = this.T[i] - this.T[i - 1], hr = this.T[i + 1] - this.T[i];
      const ease = ext[i].ease;
      for (let c = 0; c < S; c++) {
        const v = this.Vv[i * S + c];
        const dl = (v - this.Vv[(i - 1) * S + c]) / hl, dr = (this.Vv[(i + 1) * S + c] - v) / hr;
        let mi, mo;
        if (ease === 'hit') { mi = 2.1 * dl; mo = 0; }
        else if (ease === 'stop') { mi = mo = 0; }
        else if (ease === 'lin') { mi = dl; mo = dr; }
        else if (dl * dr <= 0) { mi = mo = 0; }
        else {
          let m = (hr * dl + hl * dr) / (hl + hr);
          const lim = 3 * Math.min(Math.abs(dl), Math.abs(dr));
          if (Math.abs(m) > lim) m = Math.sign(m) * lim;
          mi = mo = m;
        }
        this.Min[i * S + c] = mi; this.Mout[i * S + c] = mo;
      }
    }
    this.period = period;
    this.N = N;
    this._i = 2;
  }

  sample(t, out) {
    const T = this.T, S = this.size;
    t = ((t % this.period) + this.period) % this.period;
    let i = this._i;
    if (!(T[i] <= t && t < T[i + 1])) {
      let lo = 1, hi = this.N - 2;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid; else hi = mid; }
      i = this._i = lo;
    }
    const h = T[i + 1] - T[i], s = (t - T[i]) / h, s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = (s3 - 2 * s2 + s) * h, h01 = -2 * s3 + 3 * s2, h11 = (s3 - s2) * h;
    const a = i * S, b = (i + 1) * S;
    for (let c = 0; c < S; c++) out[c] = h00 * this.Vv[a + c] + h10 * this.Mout[a + c] + h01 * this.Vv[b + c] + h11 * this.Min[b + c];
    return out;
  }
}

export class Choreography {
  constructor({ beats, bpm, wrap = {}, rig }) {
    this.beats = beats;
    this.beat = 60 / bpm; // seconds per beat
    this.duration = beats * this.beat;
    this.ch = {};
    const hq = new THREE.Quaternion(), vf = new THREE.Vector3(), vp = new THREE.Vector3();
    for (const [n, schema] of Object.entries(SCHEMA)) {
      const k = n.startsWith('arm') ? n.slice(3) : null;
      this.ch[n] = new Channel(n, schema, k ? (fingers, palm) => rig.handQuat(hq, k, vf.fromArray(fingers).normalize(), vp.fromArray(palm).normalize()) : null);
    }
    this.wrap = wrap;
    this.intensityKeys = [];
    this.pending = [];
  }

  // keys may be declared in any order; they are applied chronologically (props carry forward per channel)
  key(t, spec) {
    for (const n of Object.keys(spec)) if (!this.ch[n]) throw new Error('unknown channel ' + n);
    this.pending.push({ t, spec, i: this.pending.length });
    return this;
  }

  finalize() {
    this.pending.sort((a, b) => a.t - b.t || a.i - b.i);
    for (const { t, spec } of this.pending) for (const [n, props] of Object.entries(spec)) this.ch[n].add(t, props);
    for (const [n, c] of Object.entries(this.ch)) c.finalize(this.beats, this.wrap[n]);
    return this;
  }

  intensity(beat) {
    const k = this.intensityKeys;
    beat = ((beat % this.beats) + this.beats) % this.beats;
    for (let i = 0; i < k.length - 1; i++) {
      if (beat >= k[i][0] && beat <= k[i + 1][0]) {
        const s = (beat - k[i][0]) / (k[i + 1][0] - k[i][0]);
        return k[i][1] + (k[i + 1][1] - k[i][1]) * s * s * (3 - 2 * s);
      }
    }
    return k.length ? k[0][1] : 0.5;
  }
}

// ---------------------------------------------------------------------------
// Performer: samples the choreography, resolves balance / foot contact, adds
// follow-through and impact response, and feeds the rig.
// ---------------------------------------------------------------------------
// window (seconds) over which a foot's touchdown speed is measured; stamp strengths are tuned to it
const CONTACT_WINDOW = 1 / 60;
const _e = new THREE.Euler();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Yaxis = new THREE.Vector3(0, 1, 0);

export class Performer {
  constructor(rig, choreo) {
    this.rig = rig;
    this.c = choreo;
    this.buf = {};
    for (const [n, ch] of Object.entries(choreo.ch)) this.buf[n] = [new Float32Array(ch.size), new Float32Array(ch.size), new Float32Array(ch.size), new Float32Array(ch.size)];
    const arm = () => ({ u: new THREE.Vector3(), f: new THREE.Vector3(), pole: new THREE.Vector3(), hand: new THREE.Quaternion(), curls: new Float32Array(CURLS) });
    const leg = () => ({ ankle: new THREE.Vector3(), rot: new THREE.Quaternion(), pole: new THREE.Vector3(), toe: 0, lift: 0, ball: new THREE.Vector3(), flat: new THREE.Vector3() });
    this.pose = {
      hipsPos: new THREE.Vector3(), hipsRot: new THREE.Quaternion(),
      spine: { fwd: 0, side: 0, twist: 0 }, head: new THREE.Quaternion(),
      legs: { L: leg(), R: leg() }, arms: { L: arm(), R: arm(), L2: arm(), R2: arm() },
    };
    this.fx = { damaru: 0, flame: 0.6, wind: 0.2 };
    this.time = 0;
    this.beatPos = 0;
    this.intensity = 0;
    this.listeners = [];
    this.contact = { L: { down: true, peak: 0, prev: 0 }, R: { down: true, peak: 0, prev: 0 } };
    this.impact = { x: 0, v: 0 };
    this.prevHipsY = null;
    this.hipsVelY = 0;
    this.shake = 0; // damaru wrist tremolo phase value
  }

  onStamp(fn) { this.listeners.push(fn); }

  /** advance to absolute dance time `time` (seconds); dt drives the springs / contact detection */
  update(time, dt, silent = false) {
    const c = this.c, P = this.pose, rig = this.rig;
    this.time = time;
    const beat = this.beatPos = (time / c.beat) % c.beats;
    this.intensity = c.intensity(beat);
    const lag = (s) => beat - s / c.beat;
    const S = (name, t, slot = 0) => c.ch[name].sample(t, this.buf[name][slot]);

    const fx = S('fx', beat);
    this.fx.damaru = fx[0]; this.fx.flame = fx[1]; this.fx.wind = fx[2];

    // ---- hips orientation first (feet may be authored relative to it)
    const hips = S('hips', beat);
    const hipsYaw = hips[4] * deg;

    // ---- feet
    for (const s of ['L', 'R']) {
      const f = S('foot' + s, beat);
      const leg = P.legs[s], foot = rig.feet[s];
      let x = f[0], z = f[1], yaw = f[3] * deg;
      leg._rel = f[9]; leg._x = x; leg._z = z; leg._yaw = yaw; leg._pivot = f[10];
      leg.lift = f[2]; leg._pitch = f[4] * deg; leg._roll = f[5] * deg;
      leg._pole = [f[6], f[7], f[8]];
    }
    // support point: weighted between the feet; a foot carried in the hips frame bears no weight
    const fl = P.legs.L, fr = P.legs.R;
    for (const leg of [fl, fr]) {
      // heel point on the ground (when turning on the ball, the authored point is the ball)
      const tb = rig.feet[leg === fl ? 'L' : 'R'].toBall, cy = Math.cos(leg._yaw), sy = Math.sin(leg._yaw);
      leg._hx = leg._x - leg._pivot * (tb.x * cy + tb.z * sy);
      leg._hz = leg._z - leg._pivot * (-tb.x * sy + tb.z * cy);
    }
    const w = hips[0];
    let wl = (1 - w) * (1 - fl._rel), wr = w * (1 - fr._rel);
    const ws = wl + wr;
    if (ws < 1e-4) { wl = 1 - w; wr = w; } else { wl /= ws; wr /= ws; }
    let hx = fl._hx * wl + fr._hx * wr + hips[1], hz = fl._hz * wl + fr._hz * wr + hips[3];
    let hy = hips[2];

    _e.set(hips[5] * deg, hipsYaw, hips[6] * deg, 'YXZ');
    P.hipsRot.setFromEuler(_e);

    for (const s of ['L', 'R']) {
      const leg = P.legs[s], foot = rig.feet[s];
      let x = leg._hx, z = leg._hz, yaw = leg._yaw;
      if (leg._rel > 0) {
        const cy = Math.cos(hipsYaw), sy = Math.sin(hipsYaw);
        const rx = hx + x * cy + z * sy, rz = hz - x * sy + z * cy;
        x += (rx - x) * leg._rel; z += (rz - z) * leg._rel; yaw += hipsYaw * leg._rel;
      }
      _e.set(leg._pitch, yaw, leg._roll, 'YXZ');
      leg.rot.setFromEuler(_e);
      _q.setFromAxisAngle(Yaxis, yaw);
      leg.flat.set(x, 0, z);
      // pitch pivots about the ball of the foot
      leg.ball.copy(foot.toBall).applyQuaternion(_q).add(_v.set(x, foot.ankleH + leg.lift, z));
      leg.ankle.copy(foot.toBall).negate().applyQuaternion(leg.rot).add(leg.ball);
      const heelY = leg.ankle.y + _v.copy(foot.toHeel).applyQuaternion(leg.rot).y;
      if (heelY < 0) { leg.ankle.y -= heelY; leg.ball.y -= heelY; }
      const grounded = 1 - THREE.MathUtils.smoothstep(leg.lift, 0.0, 0.07);
      leg.toe = leg._pitch > 0 ? -leg._pitch * grounded : 0;
      leg.grounded = grounded;
      // knee direction: follows the toes unless a pole is authored
      const pl = leg._pole;
      const pm = Math.min(1, Math.hypot(pl[0], pl[1], pl[2]));
      _v.set(Math.sin(yaw), 0.05, Math.cos(yaw)).multiplyScalar(1 - pm);
      // (wrapped, so leaving the hips frame after a full turn does not unwind the knee through 360 degrees)
      if (leg._rel > 0) _v2.set(pl[0], pl[1], pl[2]).applyAxisAngle(Yaxis, Math.atan2(Math.sin(hipsYaw), Math.cos(hipsYaw)) * leg._rel); else _v2.set(pl[0], pl[1], pl[2]);
      leg.pole.copy(_v).add(_v2).normalize();
    }

    // ---- impact spring (stamps compress the body) + breathing
    const im = this.impact;
    if (dt > 0) {
      const k = 420, d = 19;
      const steps = Math.max(1, Math.ceil(dt / 0.008));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) { im.v += (-k * im.x - d * im.v) * h; im.x += im.v * h; }
    }
    const breath = Math.sin(time * 1.5) * (1.2 - this.intensity * 0.6);
    hy += im.x + breath * 0.003;

    // ---- keep planted feet reachable: lower the hips rather than let a foot float
    P.hipsPos.set(hx, hy, hz);
    for (const s of ['L', 'R']) {
      const leg = P.legs[s], limb = rig.limbs['leg' + s];
      const gw = Math.min(1, leg.grounded * 1.6);
      if (gw <= 0) continue;
      const H = _v.copy(limb.u1.userData.restPosition).applyQuaternion(P.hipsRot).add(P.hipsPos);
      const lim = (limb.L1 + limb.L2) * 0.992;
      const dx = Math.hypot(H.x - leg.ankle.x, H.z - leg.ankle.z);
      if (dx < lim) {
        const maxY = leg.ankle.y + Math.sqrt(lim * lim - dx * dx);
        if (H.y > maxY) P.hipsPos.y -= (H.y - maxY) * gw;
      }
    }

    // ---- spine / head (slightly delayed: follow-through)
    const sp = S('spine', lag(0.03));
    P.spine.fwd = sp[0] * deg + breath * 0.012 - im.x * 1.6;
    P.spine.side = sp[1] * deg;
    P.spine.twist = sp[2] * deg;
    const hd = S('head', lag(0.07));
    _e.set(hd[1] * deg + im.x * 0.8, hd[0] * deg, -hd[2] * deg, 'YXZ');
    P.head.setFromEuler(_e);

    // ---- arms: successive breaking of joints (upper arm, forearm, hand, fingers each a little later)
    const tremolo = Math.sin(beat * Math.PI * 8) * this.fx.damaru;
    this.shake = tremolo;
    for (const k of ['L', 'R', 'L2', 'R2']) {
      const name = 'arm' + k, arm = P.arms[k];
      const rear = k.length === 2 ? 0.02 : 0;
      const a0 = S(name, lag(rear), 0), a1 = S(name, lag(rear + 0.04), 1), a2 = S(name, lag(rear + 0.08), 2), a3 = S(name, lag(rear + 0.12), 3);
      arm.u.set(a0[0], a0[1], a0[2]).normalize();
      arm.f.set(a1[3], a1[4], a1[5]).normalize();
      arm.pole.set(a0[10], a0[11], a0[12]);
      // organic micro-motion so held poses stay alive
      const ph = k.charCodeAt(0) * 1.7 + k.length * 2.3;
      const n1 = Math.sin(time * 0.9 + ph) * 0.012 + Math.sin(time * 2.3 + ph * 2) * 0.006;
      arm.u.y += n1; arm.f.y += n1 * 1.5; arm.f.x += Math.cos(time * 1.1 + ph) * 0.012;
      arm.u.normalize(); arm.f.normalize();
      arm.hand.set(a2[6], a2[7], a2[8], a2[9]).normalize();
      // damaru: rapid pronation / supination about the forearm
      if (k === 'R2' && this.fx.damaru > 0.001) arm.hand.premultiply(_q.setFromAxisAngle(arm.f, tremolo * 0.6));
      for (let i = 0; i < CURLS; i++) arm.curls[i] = a3[13 + i];
    }

    P.dt = dt;
    rig.apply(P);

    // ---- foot contact events
    if (dt > 0) {
      const vy = this.prevHipsY === null ? 0 : (P.hipsPos.y - this.prevHipsY) / dt;
      this.hipsVelY += (vy - this.hipsVelY) * (1 - Math.exp(-dt * 30));
      // Stamp strength is read from the authored foot curves rather than from whatever the frames
      // happened to catch, so it does not depend on frame rate or phase.
      let fb0 = this.prevBeat ?? beat - dt / c.beat;
      if (fb0 > beat) fb0 -= c.beats; // the frame straddles the loop seam
      for (const s of ['L', 'R']) {
        const leg = P.legs[s], ct = this.contact[s];
        const lift = leg.lift;
        const TH = 0.012;
        const liftAt = (b) => c.ch['foot' + s].sample(b, this.buf['foot' + s][1])[2];
        if (lift > TH) {
          ct.down = false;
          // highest point of the lift, including between frames
          for (let k = 1; k <= 4; k++) ct.peak = Math.max(ct.peak, liftAt(fb0 + (beat - fb0) * k / 4));
        } else if (!ct.down) {
          ct.down = true;
          if (ct.prev > TH) for (let k = 1; k < 4; k++) ct.peak = Math.max(ct.peak, liftAt(fb0 + (beat - fb0) * k / 4));
          // touchdown speed: find the instant within this frame at which the foot reached the
          // floor, then measure its descent over a fixed window ending there
          // (contact triggers a few millimetres up, so the floor may still be just ahead of this frame)
          let b0 = fb0, b1 = beat;
          if (liftAt(b1) > 1e-3 && liftAt(beat + 0.2) <= 1e-3) b1 = beat + 0.2;
          for (let i = 0; i < 24; i++) { const m = (b0 + b1) / 2; if (liftAt(m) > 1e-3) b0 = m; else b1 = m; }
          const speed = Math.min(8, Math.max(0, liftAt(b1 - CONTACT_WINDOW / c.beat) - liftAt(b1)) / CONTACT_WINDOW);
          let strength = THREE.MathUtils.clamp((speed - 0.3) / 2.6, 0, 1) * THREE.MathUtils.clamp(ct.peak / 0.12, 0.3, 1);
          strength = Math.min(1, strength + Math.max(0, -this.hipsVelY - 1.2) * 0.35);
          ct.peak = 0;
          if (strength > 0.04) {
            im.v -= strength * 0.85;
            if (!silent) for (const fn of this.listeners) fn({ side: s, strength, position: leg.ball.clone().setY(0), time });
          }
        }
        ct.prev = lift;
      }
    }
    this.prevHipsY = P.hipsPos.y;
    this.prevBeat = dt > 0 ? beat : null; // a seek (dt = 0) breaks the frame-to-frame link
  }
}
