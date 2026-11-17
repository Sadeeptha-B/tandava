import * as THREE from 'three';
import { Verlet } from './verlet.js';
import { profile, tubeGeometry, attachToBone } from './fit.js';
import { gold, rudraksha, serpentMaterial } from './materials.js';

// Rudraksha bands, the serpent Vasuki, a long bead mala (simulated), damaru, crescent moon, earrings.
export function createOrnaments(character, colliders) {
  const { body } = character;
  const B = body.byName;
  const head = (n) => B[n].userData.head;
  const out = { meshes: [], systems: [] };
  const beadMat = rudraksha(), goldMat = gold();
  const beadGeo = new THREE.SphereGeometry(1, 10, 8);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();

  // ring of beads around a limb, fitted to the mesh silhouette, parented to `bone`
  const beadRing = (bone, a, b, t, { r = 0.0075, material = beadMat, maxR = 0.09, gap = 1.0, rowOffset = 0 } = {}) => {
    const axis = new THREE.Vector3().subVectors(b, a);
    const center = new THREE.Vector3().copy(a).addScaledVector(axis, t);
    const pr = profile(body, center, axis, { maxR, slab: 0.012 });
    const circ = 2 * Math.PI * (pr.mean + r * 0.6);
    const n = Math.max(8, Math.round(circ / (2 * r * gap)));
    const im = new THREE.InstancedMesh(beadGeo, material, n);
    for (let i = 0; i < n; i++) {
      pr.point(((i + rowOffset) / n) * Math.PI * 2, r * 0.55, p).sub(bone.userData.head);
      m4.compose(p, q.identity(), s.set(r, r * 0.92, r));
      im.setMatrixAt(i, m4);
    }
    im.castShadow = true;
    bone.add(im);
    out.meshes.push(im);
    return im;
  };

  for (const sd of ['L', 'R']) {
    for (const x of ['', '2']) {
      const k = sd + x;
      // armlet (two rows) and wristlet
      beadRing(B[`upperarm02.${k}`], head(`upperarm01.${k}`), head(`lowerarm01.${k}`), 0.52);
      beadRing(B[`upperarm02.${k}`], head(`upperarm01.${k}`), head(`lowerarm01.${k}`), 0.58, { rowOffset: 0.5 });
      beadRing(B[`lowerarm02.${k}`], head(`lowerarm01.${k}`), head(`wrist.${k}`), 0.9, { r: 0.0068, maxR: 0.06 });
      beadRing(B[`lowerarm02.${k}`], head(`lowerarm01.${k}`), head(`wrist.${k}`), 0.84, { r: 0.0068, maxR: 0.06, rowOffset: 0.5 });
    }
    // anklets: gold with a row of beads
    beadRing(B[`lowerleg02.${sd}`], head(`lowerleg01.${sd}`), head(`foot.${sd}`), 0.9, { r: 0.008, material: goldMat, maxR: 0.075 });
    beadRing(B[`lowerleg02.${sd}`], head(`lowerleg01.${sd}`), head(`foot.${sd}`), 0.865, { r: 0.007, maxR: 0.075, rowOffset: 0.5 });
  }

  // ---- serpent coiled about the neck, hood raised at the left shoulder
  {
    const chest = B.spine01;
    const nk = head('neck01');
    // fitted to the neck / chest silhouette: tail down the right chest, 1.6 coils, head on the left shoulder
    const Yax = new THREE.Vector3(0, 1, 0), Zax = new THREE.Vector3(0, 0, 1);
    const cache = new Map();
    const sil = (y, maxR) => {
      const key = Math.round(y * 200) + ':' + maxR;
      if (!cache.has(key)) cache.set(key, profile(body, new THREE.Vector3(0, y, nk.z - 0.005), Yax, { maxR, slab: 0.009, bins: 24, ref: Zax }));
      return cache.get(key);
    };
    const D = Math.PI / 180;
    const pts = [];
    for (const dy of [-0.125, -0.095]) pts.push(sil(nk.y + dy, 0.2).point(-28 * D, 0.011, new THREE.Vector3()).setY(nk.y + dy));
    const T0 = -40, T1 = -630, STEPS = 20;
    for (let i = 0; i <= STEPS; i++) {
      const f = i / STEPS, th = (T0 + (T1 - T0) * f) * D;
      const y = nk.y - 0.052 + f * 0.022 + 0.02 * (1 - Math.cos(th)) / 2 + 0.02 * Math.sin(th) ** 2;
      pts.push(sil(y, 0.125).point(th, 0.0105, new THREE.Vector3()).setY(y));
    }
    const end = pts[pts.length - 1];
    for (const [x, y, z] of [[0.118, 0.012, 0.012], [0.138, 0.04, 0.035], [0.148, 0.072, 0.062], [0.144, 0.09, 0.095], [0.138, 0.092, 0.128]]) pts.push(new THREE.Vector3(x, nk.y + y, nk.z + z));
    void end;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const N = 180, cp = curve.getSpacedPoints(N);
    const radii = cp.map((_, i) => {
      const t = i / N;
      const body = 0.0105 * Math.min(1, 0.2 + t * 6);
      const hood = Math.exp(-(((t - 0.93) / 0.035) ** 2)); // modestly flared hood
      const snout = t > 0.975 ? 1 - (t - 0.975) / 0.025 * 0.6 : 1;
      return [body * (1 + hood * 0.95) * snout, body * (1 - hood * 0.25) * snout];
    });
    const g = tubeGeometry(cp, radii, 10);
    const snake = attachToBone(new THREE.Mesh(g, serpentMaterial()), chest);
    snake.castShadow = true;
    out.meshes.push(snake);
    out.serpent = snake;
    // eyes
    const eyeM = new THREE.MeshStandardMaterial({ color: 0x110000, emissive: 0xff5a10, emissiveIntensity: 2.2, roughness: 0.3 });
    const hp = cp[N - 3], dir = new THREE.Vector3().subVectors(cp[N], cp[N - 6]).normalize();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    for (const sg of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 8, 6), eyeM);
      e.position.copy(hp).addScaledVector(side, sg * 0.0075).add(new THREE.Vector3(0, 0.006, 0)).sub(chest.userData.head);
      chest.add(e);
    }
  }

  // ---- long rudraksha mala: a simulated string resting on the chest
  {
    const chest = B.spine01;
    const nk = head('neck01');
    const NB = 44;
    const sim = new Verlet(NB);
    sim.iterations = 6;
    sim.substeps = 2;
    sim.colliders = colliders;
    const a = new THREE.Vector3(nk.x - 0.062, nk.y - 0.012, nk.z - 0.05), b = new THREE.Vector3(nk.x + 0.062, nk.y - 0.012, nk.z - 0.05);
    const drop = 0.3, fwd = 0.225;
    for (let i = 0; i < NB; i++) {
      const t = i / (NB - 1), ang = t * Math.PI;
      // U-shaped loop draped forward over the collarbones
      const x = a.x + (b.x - a.x) * (0.5 - 0.5 * Math.cos(ang)) + Math.sign(t - 0.5) * 0.045 * Math.sin(ang);
      const y = a.y - drop * Math.pow(Math.sin(ang), 0.8);
      const z = a.z + fwd * Math.pow(Math.sin(ang), 0.45);
      sim.pos[i * 3] = x; sim.pos[i * 3 + 1] = y; sim.pos[i * 3 + 2] = z;
      sim.radius[i] = 0.011;
      sim.drag[i] = 0.035;
      sim.windK[i] = 0.05;
    }
    for (let i = 1; i < NB; i++) sim.link(i - 1, i, 1);
    sim.pin(0, chest); sim.pin(NB - 1, chest);
    sim.bindRest(() => chest);
    const im = new THREE.InstancedMesh(beadGeo, beadMat, NB + 1);
    im.frustumCulled = false;
    im.castShadow = true;
    character.group.add(im);
    out.meshes.push(im);
    const sync = () => {
      for (let i = 0; i < NB; i++) {
        p.set(sim.pos[i * 3], sim.pos[i * 3 + 1], sim.pos[i * 3 + 2]);
        const r = i === (NB >> 1) ? 0.012 : 0.0078;
        m4.compose(p, q.identity(), s.set(r, r, r));
        im.setMatrixAt(i, m4);
      }
      // pendant bead below the centre
      const c = NB >> 1;
      p.set(sim.pos[c * 3], sim.pos[c * 3 + 1] - 0.02, sim.pos[c * 3 + 2]);
      m4.compose(p, q.identity(), s.set(0.007, 0.011, 0.007));
      im.setMatrixAt(NB, m4);
      im.instanceMatrix.needsUpdate = true;
    };
    out.systems.push({ sim, update(dt, time) { sim.update(dt, time); sync(); }, reset() { sim.reset(); sync(); } });
    out.mala = sim;
  }

  // ---- damaru in the rear right hand
  {
    const k = 'R2', wrist = B[`wrist.${k}`], hand = character.rig.hands[k];
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14 * 2 - 1; // -1..1 along the drum axis
      pts.push(new THREE.Vector2(0.017 + 0.03 * Math.pow(Math.abs(t), 1.5), t * 0.055));
    }
    const drum = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), new THREE.MeshStandardMaterial({ color: 0x5a2c12, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide }));
    drum.add(shell);
    for (const sg of [-1, 1]) {
      const skin = new THREE.Mesh(new THREE.CircleGeometry(0.0465, 20), new THREE.MeshStandardMaterial({ color: 0xcdb48a, roughness: 0.8 }));
      skin.rotation.x = -sg * Math.PI / 2; skin.position.y = sg * 0.0552;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.004, 6, 20), goldMat);
      rim.rotation.x = Math.PI / 2; rim.position.y = sg * 0.054;
      drum.add(skin, rim);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.004, 6, 16), goldMat);
    band.rotation.x = Math.PI / 2;
    drum.add(band);
    // two knotted cords with striker beads
    const strikers = [];
    for (const sg of [-1, 1]) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 8, 6), goldMat);
      drum.add(bead);
      strikers.push({ bead, sg });
    }
    // drum axis lies across the palm; the waist sits in the curl of the fingers
    const across = new THREE.Vector3().crossVectors(hand.palm0, hand.fingers0).normalize();
    drum.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), across);
    drum.position.copy(hand.palmCenter).multiplyScalar(0.8).addScaledVector(hand.palm0, 0.034);
    drum.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    wrist.add(drum);
    out.damaru = drum;
    out.systems.push({
      update(dt, time) {
        // strikers whip between the two heads with the wrist tremolo
        const sh = character.performer.shake;
        for (const st of strikers) st.bead.position.set(0.05 * st.sg * Math.cos(sh * 1.4), st.sg * sh * 0.05, 0.02 * Math.abs(sh));
      },
    });
  }

  // ---- crescent moon in the hair, earrings
  {
    const hd = B.head;
    // crescent: an arc whose thickness tapers to nothing at the horns
    const shape = new THREE.Shape();
    const R = 0.027, W0 = 0.0115, AL = 2.0, NS = 24;
    for (let i = 0; i <= NS; i++) { const th = -AL + (2 * AL * i) / NS; const x = R * Math.sin(th), y = -R * Math.cos(th); if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y); }
    for (let i = NS - 1; i >= 1; i--) { const th = -AL + (2 * AL * i) / NS; const r = R - W0 * Math.cos((th / AL) * Math.PI / 2); shape.lineTo(r * Math.sin(th), -r * Math.cos(th)); }
    shape.closePath();
    const moon = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 2, curveSegments: 20 }),
      new THREE.MeshStandardMaterial({ color: 0xdfe9f2, emissive: 0xbfe2ff, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.2 }));
    out.moon = moon;
    out.moonParent = hd;
    out.meshes.push(moon);

    // ear lobes: lowest lateral points of the ears
    const pos = body.geometries.body.attributes.position;
    const eye = new THREE.Vector3(...body.meta.landmarks.eyeL);
    for (const sg of [1, -1]) {
      let best = null, by = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) * sg, y = pos.getY(i), z = pos.getZ(i);
        if (x > 0.066 && x < 0.1 && y > eye.y - 0.075 && y < eye.y && z < eye.z - 0.05 && z > eye.z - 0.13 && y < by) { by = y; best = [x * sg, y, z]; }
      }
      if (!best) continue;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0028, 8, 20), goldMat);
      ring.position.set(best[0] + sg * 0.003, best[1] - 0.012, best[2]).sub(hd.userData.head);
      ring.rotation.y = Math.PI / 2 - sg * 0.3;
      ring.castShadow = true;
      hd.add(ring);
      out.meshes.push(ring);
    }
  }
  return out;
}
