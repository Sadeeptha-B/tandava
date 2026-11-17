import * as THREE from 'three';
import { Verlet } from './verlet.js';
import { profile, attachToBone } from './fit.js';
import { fabricMaterial } from './materials.js';

// Tiger-skin loin panels (front / back), two long silk sashes and a twisted waist sash.
// The panels and sashes are simulated cloth pinned to the hips.
export function createGarment(character, colliders, beltY) {
  const { body } = character;
  const hips = body.byName.hips;
  const waist = profile(body, new THREE.Vector3(0, beltY, hips.userData.head.z), new THREE.Vector3(0, 1, 0), { maxR: 0.26, bins: 32, ref: new THREE.Vector3(0, 0, 1) });
  const D = Math.PI / 180;

  // ---- belt: a thick twisted sash
  const SEG = 48, rows = [[-0.034, 0.004], [-0.02, 0.017], [0, 0.021], [0.02, 0.017], [0.034, 0.004]];
  const bp = [], buv = [], bi = [];
  const tmp = new THREE.Vector3();
  for (let r = 0; r < rows.length; r++) for (let s = 0; s <= SEG; s++) {
    const th = (s / SEG) * Math.PI * 2;
    const tw = 0.004 * Math.sin(th * 14 + r * 1.3);
    waist.point(th, rows[r][1] + tw, tmp);
    bp.push(tmp.x, beltY + rows[r][0], tmp.z);
    buv.push(s / SEG * 4, 0.05 + r / (rows.length - 1) * 0.5);
    if (r < rows.length - 1 && s < SEG) { const a = r * (SEG + 1) + s; bi.push(a, a + 1, a + SEG + 1, a + 1, a + SEG + 2, a + SEG + 1); }
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  bg.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
  bg.setIndex(bi);
  bg.computeVertexNormals();
  const belt = attachToBone(new THREE.Mesh(bg, fabricMaterial('silk', 3)), hips);
  belt.castShadow = true;

  // ---- cloth pieces
  const pieces = [
    { name: 'front', t0: -62 * D, t1: 62 * D, cols: 10, rows: 10, seg: 0.047, flare: 0.006, kind: 'tiger', seed: 1 },
    { name: 'back', t0: 112 * D, t1: 248 * D, cols: 10, rows: 11, seg: 0.047, flare: 0.007, kind: 'tiger', seed: 5 },
    { name: 'sashL', t0: 86 * D, t1: 108 * D, cols: 3, rows: 18, seg: 0.058, flare: 0.004, kind: 'silk', seed: 2 },
    { name: 'sashR', t0: -108 * D, t1: -86 * D, cols: 3, rows: 16, seg: 0.058, flare: 0.004, kind: 'silk', seed: 7 },
  ];
  const total = pieces.reduce((s, p) => s + p.cols * p.rows, 0);
  const sim = new Verlet(total);
  sim.iterations = 5;
  sim.substeps = 2;
  sim.colliders = colliders;
  sim.floor = 0.012;
  let base = 0;
  const meshes = [];
  for (const pc of pieces) {
    pc.base = base;
    const id = (c, r) => pc.base + r * pc.cols + c;
    for (let r = 0; r < pc.rows; r++) for (let c = 0; c < pc.cols; c++) {
      const th = pc.t0 + (pc.t1 - pc.t0) * (c / (pc.cols - 1));
      waist.point(th, 0.016 + r * pc.flare, tmp);
      const i = id(c, r);
      sim.pos[i * 3] = tmp.x; sim.pos[i * 3 + 1] = beltY - 0.012 - r * pc.seg; sim.pos[i * 3 + 2] = tmp.z;
      sim.radius[i] = 0.016;
      sim.drag[i] = pc.kind === 'silk' ? 0.03 : 0.022;
      sim.windK[i] = (pc.kind === 'silk' ? 1.0 : 0.45) * (r / (pc.rows - 1));
    }
    for (let r = 0; r < pc.rows; r++) for (let c = 0; c < pc.cols; c++) {
      if (c < pc.cols - 1) sim.link(id(c, r), id(c + 1, r), 0.9);
      if (r < pc.rows - 1) sim.link(id(c, r), id(c, r + 1), 1);
      if (c < pc.cols - 1 && r < pc.rows - 1) { sim.link(id(c, r), id(c + 1, r + 1), 0.5); sim.link(id(c + 1, r), id(c, r + 1), 0.5); }
      if (r < pc.rows - 2) sim.link(id(c, r), id(c, r + 2), 0.18);
      if (c < pc.cols - 2) sim.link(id(c, r), id(c + 2, r), 0.18);
    }
    base += pc.cols * pc.rows;
  }
  for (const pc of pieces) for (let c = 0; c < pc.cols; c++) {
    sim.pin(pc.base + c, hips);
    sim.target(pc.base + pc.cols + c, hips, 0.4);
  }
  sim.bindRest(() => hips);

  for (const pc of pieces) {
    const n = pc.cols * pc.rows;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
    for (let r = 0; r < pc.rows; r++) for (let c = 0; c < pc.cols; c++) {
      const i = r * pc.cols + c;
      uv[i * 2] = c / (pc.cols - 1); uv[i * 2 + 1] = r / (pc.rows - 1);
      if (c < pc.cols - 1 && r < pc.rows - 1) idx.push(i, i + pc.cols, i + 1, i + 1, i + pc.cols, i + pc.cols + 1);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, fabricMaterial(pc.kind, pc.seed));
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    character.group.add(mesh);
    meshes.push(mesh);
    pc.mesh = mesh; pc.pos = pos; pc.nor = nor;
  }

  const rebuild = () => {
    const P = sim.pos;
    for (const pc of pieces) {
      const { cols, rows, pos, nor, base: b0 } = pc;
      pos.set(P.subarray(b0 * 3, (b0 + cols * rows) * 3));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const l = r * cols + Math.max(c - 1, 0), rt = r * cols + Math.min(c + 1, cols - 1);
        const u = Math.max(r - 1, 0) * cols + c, d = Math.min(r + 1, rows - 1) * cols + c;
        const ax = pos[rt * 3] - pos[l * 3], ay = pos[rt * 3 + 1] - pos[l * 3 + 1], az = pos[rt * 3 + 2] - pos[l * 3 + 2];
        const bx = pos[d * 3] - pos[u * 3], by = pos[d * 3 + 1] - pos[u * 3 + 1], bz = pos[d * 3 + 2] - pos[u * 3 + 2];
        let nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
        const len = Math.hypot(nx, ny, nz) || 1;
        nor[i * 3] = nx / len; nor[i * 3 + 1] = ny / len; nor[i * 3 + 2] = nz / len;
      }
      pc.mesh.geometry.attributes.position.needsUpdate = true;
      pc.mesh.geometry.attributes.normal.needsUpdate = true;
    }
  };

  return {
    sim, meshes, belt, waist,
    update(dt, time) { sim.update(dt, time); rebuild(); },
    reset() { sim.reset(); rebuild(); },
  };
}
