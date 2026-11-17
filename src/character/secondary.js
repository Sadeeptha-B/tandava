import * as THREE from 'three';
import { Collider } from './verlet.js';
import { createHair } from './hair.js';
import { createGarment } from './garment.js';
import { createOrnaments } from './ornaments.js';
import { skinMaterial, eyeMaterial } from './materials.js';
import { createFace } from './face.js';

// Dresses the dancer: skin, hair, garment, ornaments – and wires their simulations
// (hair locks, cloth, bead mala) to the skeleton, with a wind field driven by the dance.
export function attachSecondary(character, opts = {}) {
  const { body } = character;
  const B = body.byName;
  const v = (a) => new THREE.Vector3(...a);
  const C = (a, offA, rA, b = null, offB = [0, 0, 0], rB = rA) => new Collider(B[a], v(offA), rA, b ? B[b] : null, v(offB), rB);

  const headC = C('head', [0, 0.085, -0.012], 0.102);
  const neckC = C('neck01', [0, 0, 0], 0.058, 'head', [0, 0.02, 0], 0.062);
  const torsoC = C('spine01', [0, 0.07, 0.015], 0.15, 'hips', [0, 0.05, 0], 0.142);
  const shouldersC = C('upperarm01.L', [-0.02, 0, 0], 0.08, 'upperarm01.R', [0.02, 0, 0], 0.08);
  const pelvisC = C('upperleg01.L', [0, 0.01, 0], 0.118, 'upperleg01.R', [0, 0.01, 0], 0.118);
  const arms = [];
  for (const k of ['L', 'R', 'L2', 'R2']) arms.push(C(`upperarm01.${k}`, [0, 0, 0], 0.058, `lowerarm01.${k}`, [0, 0, 0], 0.048), C(`lowerarm01.${k}`, [0, 0, 0], 0.046, `wrist.${k}`, [0, 0, 0], 0.036));
  const legs = [];
  for (const s of ['L', 'R']) legs.push(C(`upperleg01.${s}`, [0, -0.02, 0.012], 0.116, `lowerleg01.${s}`, [0, 0.02, 0.004], 0.074), C(`lowerleg01.${s}`, [0, 0, 0], 0.066, `foot.${s}`, [0, 0, 0], 0.048));
  // collider with a centre given in bind-pose world space
  const CW = (a, w, r) => new Collider(B[a], v(w).sub(B[a].userData.head), r);
  // chest / abdomen fitted to the measured silhouette (front surface z ~ 0.16 at the pectorals)
  const chest = [
    CW('spine01', [0.078, 1.375, 0.045], 0.127), CW('spine01', [-0.078, 1.375, 0.045], 0.127),
    CW('spine01', [0, 1.385, 0.03], 0.132), CW('spine01', [0, 1.465, 0.012], 0.123),
    CW('spine02', [0, 1.275, 0.018], 0.134), CW('spine03', [0, 1.18, 0.012], 0.13),
  ];
  const bellyC = C('spine03', [0, 0, 0.02], 0.135);

  const beltY = B.hips.userData.head.y + 0.046;
  const skin = skinMaterial(body.meta.landmarks, beltY + 0.006);
  if (!opts.plainBody) character.mesh.material = skin;
  const eyeMat = eyeMaterial(body.meta.landmarks);
  character.eyes.material = eyeMat;
  const face = createFace(character);
  character.mesh.castShadow = true;
  character.mesh.receiveShadow = true;

  const hair = createHair(character, [headC, neckC, torsoC, shouldersC, ...chest.slice(0, 4), ...arms]);
  const garment = createGarment(character, [pelvisC, ...legs, bellyC], beltY);
  const ornaments = createOrnaments(character, [torsoC, ...chest, neckC]);

  // crescent moon tucked into the topknot
  ornaments.moon.position.set(0.058, 0.05, 0.052);
  ornaments.moon.scale.setScalar(0.82);
  ornaments.moon.rotation.set(-0.1, 0.5, -0.5);
  hair.knot.add(ornaments.moon);

  // ---- wind: an updraft and outward pressure radiating from the dancer, plus gusts from stamps
  const state = { gust: 0, cx: 0, cz: 0, level: 0 };
  const wind = (x, y, z, t, out, i) => {
    const W = state.level;
    const dx = x - state.cx, dz = z - state.cz;
    const r = Math.hypot(dx, dz) + 0.25;
    const tb = Math.sin(t * 2.1 + y * 4.0 + i * 0.37) + Math.sin(t * 3.7 - x * 5.0 + i * 0.11) * 0.6;
    out.x = W * ((dx / r) * 7 + tb * 4.5 + Math.sin(t * 0.7 + i) * 2);
    out.y = W * (10.5 + 4 * Math.sin(t * 1.3 + i * 0.5 + x * 3)) + state.gust * 2.5;
    out.z = W * ((dz / r) * 7 + Math.cos(t * 2.6 + y * 3 + i * 0.23) * 4.5 - 2.5);
    return out;
  };
  const hp = new THREE.Vector3();
  hair.sim.wind = (x, y, z, t, out, i) => {
    // locks fan outwards from the head and lift with the updraft
    const W = state.level;
    const dx = x - hp.x, dz = z - hp.z;
    const r = Math.hypot(dx, dz) + 0.12;
    out.x = W * ((dx / r) * 11 + Math.sin(t * 2.1 + i * 0.37) * 2.6);
    out.y = W * (9.5 + 3.5 * Math.sin(t * 1.3 + i * 0.5)) + state.gust * 9;
    out.z = W * ((dz / r) * 5 + Math.cos(t * 2.6 + i * 0.23) * 2.6 - 3);
    return out;
  };
  garment.sim.wind = wind;
  ornaments.mala.wind = wind;
  character.performer.onStamp((e) => { state.gust = Math.max(state.gust, e.strength * 1.6); });

  const driver = {
    update(dt) {
      const p = character.performer;
      state.cx = p.pose.hipsPos.x; state.cz = p.pose.hipsPos.z;
      hp.setFromMatrixPosition(B.head.matrixWorld);
      state.gust *= Math.exp(-dt * 3.2);
      state.level = p.fx.wind + state.gust * 0.5;
    },
    reset() { state.gust = 0; },
  };
  character.systems.push(driver, face, hair, garment, ...ornaments.systems);
  return { hair, garment, ornaments, skin, eyeMat, face, wind: state };
}
