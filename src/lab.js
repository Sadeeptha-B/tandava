// Dev-only pose lab: neutral studio lighting for checking mesh, rig and choreography.
//   /lab.html?view=front|side|back|34|top&zoom=1&cy=0.95&beat=11.4
//   /lab.html?sheet=0,4,8,11.4&cols=4&view=front     contact sheet of beats
//   /lab.html?from=16&to=24&step=0.5&cols=8           contact sheet over a range
import * as THREE from 'three';
import { Character } from './character/character.js';
import { attachSecondary } from './character/secondary.js';
import { profile } from './character/fit.js';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6f7479);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.3));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(1.5, 3, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0xaaccff, 1.5);
rim.position.set(-3, 2, -3);
scene.add(rim);
scene.add(new THREE.GridHelper(4, 16, 0x222222, 0x555555));

const character = await Character.create();
scene.add(character.group);
if (q.get('bare') === null) attachSecondary(character, { lab: true });

const zoom = +(q.get('zoom') ?? 1);
const cy = +(q.get('cy') ?? 1.05);
const cx = +(q.get('cx') ?? 0);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
const views = { front: [0, 0, 8], side: [8, 0, 0], back: [0, 0, -8], 34: [4.5, 1.2, 6.5], top: [0, 8, 0.01], left: [-8, 0, 0] };
const setView = (name, w, h) => {
  const v = views[name] ?? views.front;
  const half = 1.3 / zoom, aspect = w / h;
  camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half;
  camera.updateProjectionMatrix();
  camera.position.set(cx + v[0], cy + v[1], v[2]);
  camera.lookAt(cx, cy, 0);
};

const beatToTime = (b) => b * character.choreo.beat;
const sheetParam = q.get('sheet');
const from = q.get('from');
let beats = null;
if (sheetParam) beats = sheetParam.split(',').map(Number);
else if (from !== null) { beats = []; const to = +q.get('to'), step = +(q.get('step') ?? 1); for (let b = +from; b <= to + 1e-6; b += step) beats.push(+b.toFixed(3)); }
const viewNames = (q.get('view') ?? 'front').split(',');

if (beats) {
  const cols = +(q.get('cols') ?? Math.min(beats.length, 8));
  const rows = Math.ceil(beats.length / cols) * viewNames.length;
  const tw = Math.floor(innerWidth / cols), th = Math.floor(innerHeight / rows);
  renderer.setSize(tw, th);
  renderer.domElement.style.display = 'none';
  const cv = document.createElement('canvas');
  cv.width = innerWidth; cv.height = innerHeight;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.font = '13px monospace';
  beats.forEach((b, i) => {
    character.seek(beatToTime(b), q.get('bare') !== null ? 0.02 : 1.2);
    viewNames.forEach((vn, vi) => {
      setView(vn, tw, th);
      renderer.render(scene, camera);
      const x = (i % cols) * tw, y = (Math.floor(i / cols) * viewNames.length + vi) * th;
      ctx.drawImage(renderer.domElement, x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(`${b}${viewNames.length > 1 ? ' ' + vn : ''}`, x + 4, y + 14);
    });
  });
} else {
  renderer.setSize(innerWidth, innerHeight);
  setView(viewNames[0], innerWidth, innerHeight);
  const beat = q.get('beat');
  if (beat !== null) { character.seek(beatToTime(+beat)); renderer.render(scene, camera); }
  else {
    const clock = new THREE.Clock();
    let t = 0;
    renderer.setAnimationLoop(() => { const dt = Math.min(clock.getDelta(), 0.05); t += dt; character.update(t, dt); renderer.render(scene, camera); });
  }
}
// Numerical motion audit: foot sliding, IK reach, speed spikes, hand/body penetration, loop seam.
function analyze(fps = 120) {
  const p = character.performer, rig = character.rig, c = character.choreo;
  const dt = 1 / fps, N = Math.round(c.duration * fps);
  const names = Object.keys(rig.W);
  const prevQ = {}, prevP = {};
  const top = (arr, n = 6) => arr.sort((a, b) => b[0] - a[0]).slice(0, n).map(([v, b, x]) => `${v.toFixed(3)}@${b.toFixed(2)}${x ? ' ' + x : ''}`).join('  ');
  const slide = [], reach = [], ang = [], hand = [], hipAcc = [], pen = [];
  let prevBall = {}, prevLift = {}, prevHipV = null, prevHip = null;
  const seg = (P, A, B) => { const ab = B.clone().sub(A), t = THREE.MathUtils.clamp(P.clone().sub(A).dot(ab) / ab.lengthSq(), 0, 1); return P.distanceTo(A.clone().addScaledVector(ab, t)); };
  p.update(-dt, 0, true);
  for (let i = 0; i <= N; i++) {
    const t = i * dt, beat = (t / c.beat) % c.beats;
    p.update(t, dt, true);
    for (const sd of ['L', 'R']) {
      const leg = p.pose.legs[sd];
      if (prevBall[sd] && leg.lift < 0.002 && prevLift[sd] < 0.002) slide.push([Math.hypot(leg.ball.x - prevBall[sd].x, leg.ball.z - prevBall[sd].z) / dt, beat, sd]);
      prevBall[sd] = leg.ball.clone(); prevLift[sd] = leg.lift;
      reach.push([rig.P['foot.' + sd].distanceTo(leg.ankle), beat, sd]);
    }
    for (const n of names) {
      if (/finger|metacarpal|toe/.test(n)) continue;
      const q = rig.W[n];
      if (prevQ[n] && i > 0) ang.push([2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ[n])))) / dt * 57.3, beat, n]);
      (prevQ[n] ??= new THREE.Quaternion()).copy(q);
    }
    for (const k of ['L', 'R', 'L2', 'R2']) {
      const w = rig.P['wrist.' + k];
      if (prevP[k]) hand.push([w.distanceTo(prevP[k]) / dt, beat, k]);
      (prevP[k] ??= new THREE.Vector3()).copy(w);
      const dTorso = seg(w, rig.P.spine01.clone().add(new THREE.Vector3(0, 0.08, 0)), rig.P.hips);
      if (dTorso < 0.13) pen.push([0.13 - dTorso, beat, k + ' torso']);
      const dHead = w.distanceTo(rig.P.head.clone().add(new THREE.Vector3(0, 0.08, 0)));
      if (dHead < 0.13) pen.push([0.13 - dHead, beat, k + ' head']);
      for (const sd of ['L', 'R']) { const dl = seg(w, rig.P['upperleg01.' + sd], rig.P['lowerleg01.' + sd]); if (dl < 0.08) pen.push([0.08 - dl, beat, k + ' thigh' + sd]); }
    }
    for (const [a, b] of [['L', 'L2'], ['R', 'R2'], ['L', 'R'], ['L2', 'R2']]) {
      const d = rig.P['wrist.' + a].distanceTo(rig.P['wrist.' + b]);
      if (d < 0.07) pen.push([0.07 - d, beat, a + '-' + b + ' wrists']);
      const e = rig.P['lowerarm01.' + a].distanceTo(rig.P['lowerarm01.' + b]);
      if (e < 0.06 && a[0] !== b[0]) pen.push([0.06 - e, beat, a + '-' + b + ' elbows']);
    }
    const hp = p.pose.hipsPos;
    if (prevHip) { const v = hp.clone().sub(prevHip).divideScalar(dt); if (prevHipV) hipAcc.push([v.clone().sub(prevHipV).length() / dt, beat]); prevHipV = v; }
    prevHip = hp.clone();
  }
  return ['foot slide m/s: ' + top(slide), 'IK miss m: ' + top(reach), 'ang vel deg/s: ' + top(ang, 10), 'hand speed m/s: ' + top(hand), 'hip accel m/s2: ' + top(hipAcc), 'penetration m: ' + top(pen, 14)].join('\n');
}
window.lab = { THREE, scene, character, camera, renderer, profile, analyze };
window.__ready = true;
