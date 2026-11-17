// Builds the Shiva body asset from the CC0 MakeHuman base mesh:
//   morph targets -> joints -> Catmull-Clark subdivision -> four-arm duplication
//   -> quantised binary (public/assets/shiva.bin) + metadata (public/assets/shiva.json)
// Run `npm run assets:fetch` first.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets-src', 'makehuman');
const OUT = join(ROOT, 'public', 'assets');

// ---------------------------------------------------------------- recipe
const MUSCLE = 0.85; // 0 = average, 1 = MakeHuman "max muscle"
const TARGETS = {
  'universal-male-young-averagemuscle-averageweight': 1 - MUSCLE,
  'universal-male-young-maxmuscle-averageweight': MUSCLE,
  'caucasian-male-young': 0.5,
  'asian-male-young': 0.3,
  'african-male-young': 0.2,
  'male-young-maxmuscle-averageweight-idealproportions': 0.8 * MUSCLE,
  'male-young-averagemuscle-averageweight-idealproportions': 0.8 * (1 - MUSCLE),
  'torso-vshape-incr': 0.45,
  'torso-muscle-pectoral-incr': 0.25,
  'stomach-tone-incr': 0.8,
  'eye-left-closure': 0.86,
  'eye-right-closure': 0.86,
  'mouth-corner-puller': 0.1,
  'chin-bones-incr': 0.3,
  'l-cheek-bones-incr': 0.3,
  'r-cheek-bones-incr': 0.3,
  'nose-scale-vert-incr': 0.15,
};
const HEIGHT = 1.84; // metres, final stature

// ---------------------------------------------------------------- load obj
const V = []; // flat xyz
const groups = {}; // name -> faces (arrays of vertex indices)
{
  let g = 'none';
  for (const l of readFileSync(join(SRC, 'base.obj'), 'utf8').split(/\r?\n/)) {
    if (l.startsWith('v ')) {
      const p = l.split(/\s+/);
      V.push(+p[1], +p[2], +p[3]);
    } else if (l.startsWith('g ')) {
      g = l.slice(2).trim();
      groups[g] ??= [];
    } else if (l.startsWith('f ')) {
      groups[g].push(l.split(/\s+/).slice(1).map((s) => parseInt(s, 10) - 1));
    }
  }
}
const NV0 = V.length / 3;

// ---------------------------------------------------------------- targets
for (const [name, w] of Object.entries(TARGETS)) {
  if (!w) continue;
  for (const l of readFileSync(join(SRC, 'targets', name + '.target'), 'utf8').split(/\r?\n/)) {
    if (!l || l[0] === '#') continue;
    const p = l.split(/\s+/);
    const i = +p[0] * 3;
    V[i] += w * +p[1];
    V[i + 1] += w * +p[2];
    V[i + 2] += w * +p[3];
  }
}

// ---------------------------------------------------------------- normalise to metres, feet on y=0
const bodyFaces = groups['body'];
const bodyVertCount = 1 + bodyFaces.reduce((m, f) => Math.max(m, ...f), 0);
let minY = Infinity, maxY = -Infinity;
for (let i = 0; i < bodyVertCount; i++) {
  minY = Math.min(minY, V[i * 3 + 1]);
  maxY = Math.max(maxY, V[i * 3 + 1]);
}
const S = HEIGHT / (maxY - minY);
for (let i = 0; i < NV0; i++) {
  V[i * 3] *= S;
  V[i * 3 + 1] = (V[i * 3 + 1] - minY) * S;
  V[i * 3 + 2] *= S;
}

// ---------------------------------------------------------------- skeleton
const sk = JSON.parse(readFileSync(join(SRC, 'default.mhskel'), 'utf8'));
const mhw = JSON.parse(readFileSync(join(SRC, 'default_weights.mhw'), 'utf8')).weights;
const joint = (name) => {
  const ids = sk.joints[name];
  const c = [0, 0, 0];
  for (const i of ids) for (let a = 0; a < 3; a++) c[a] += V[i * 3 + a] / ids.length;
  return c;
};

const KEEP = /^(root|spine0[1-4]|neck0[1-3]|head|clavicle|shoulder01|upperarm0[12]|lowerarm0[12]|wrist|metacarpal\d|finger\d-\d|upperleg0[12]|lowerleg0[12]|foot)(\.[LR])?$/;
const outName = (mh) => {
  // returns the output bone a MakeHuman bone maps onto
  let n = mh;
  for (;;) {
    const toe = /^toe\d-\d\.([LR])$/.exec(n);
    if (toe) return 'toe.' + toe[1];
    if (n === 'spine05' || n === 'root') return 'hips';
    if (KEEP.test(n)) return n;
    n = sk.bones[n].parent;
    if (!n) return 'hips';
  }
};

const bones = []; // {name, parent, head, tail}
const boneIndex = new Map();
const addBone = (name, parentName, head, tail) => {
  boneIndex.set(name, bones.length);
  bones.push({ name, parent: parentName == null ? -1 : boneIndex.get(parentName), head, tail });
};
{
  // topological walk of the MakeHuman hierarchy
  const children = {};
  for (const [n, b] of Object.entries(sk.bones)) (children[b.parent ?? ''] ??= []).push(n);
  const mean = (pts) => pts[0].map((_, a) => pts.reduce((s, p) => s + p[a], 0) / pts.length);
  const visit = (n) => {
    const b = sk.bones[n];
    const on = outName(n);
    if (on === n || (n === 'root')) {
      const parent = b.parent ? outName(b.parent) : null;
      if (n === 'root') addBone('hips', null, joint(sk.bones.spine05.head), joint(sk.bones.spine05.tail));
      else addBone(n, parent, joint(b.head), joint(b.tail));
    } else if (/^toe1-1\./.test(n)) {
      const side = n.slice(-1);
      const heads = [1, 2, 3, 4, 5].map((k) => joint(sk.bones[`toe${k}-1.${side}`].head));
      const tails = [1, 2, 3].map((k) => joint(sk.bones[`toe${k}-${k === 1 ? 2 : 3}.${side}`].tail));
      addBone('toe.' + side, 'foot.' + side, mean(heads), mean(tails));
    }
    for (const c of children[n] ?? []) visit(c);
  };
  visit('root');
}

// second (rear) arm pair: clone the chain from upperarm01 downwards
const ARM2 = /^(upperarm0[12]|lowerarm0[12]|wrist|metacarpal\d|finger\d-\d)\.([LR])$/;
{
  const n0 = bones.length;
  for (let i = 0; i < n0; i++) {
    const b = bones[i];
    if (!ARM2.test(b.name)) continue;
    const pn = bones[b.parent].name;
    addBone(b.name + '2', ARM2.test(pn) ? pn + '2' : pn, b.head, b.tail);
  }
}

// ---------------------------------------------------------------- per-vertex weights (sparse)
const vw = Array.from({ length: NV0 }, () => new Map());
for (const [mhBone, list] of Object.entries(mhw)) {
  const bi = boneIndex.get(outName(mhBone));
  for (const [vi, w] of list) vw[vi].set(bi, (vw[vi].get(bi) ?? 0) + w);
}

// ---------------------------------------------------------------- Catmull-Clark
function subdivide(nVerts, faces) {
  const combos = []; // per new vertex: Map(oldIndex -> coef)
  const add = (m, i, c) => m.set(i, (m.get(i) ?? 0) + c);
  const edges = new Map();
  const vertEdges = Array.from({ length: nVerts }, () => []);
  const vertFaces = Array.from({ length: nVerts }, () => []);
  const ekey = (a, b) => (a < b ? a * nVerts + b : b * nVerts + a);
  faces.forEach((f, fi) => {
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      const key = ekey(a, b);
      let e = edges.get(key);
      if (!e) {
        e = { a, b, faces: [], id: edges.size };
        edges.set(key, e);
        vertEdges[a].push(e);
        vertEdges[b].push(e);
      }
      e.faces.push(fi);
      vertFaces[a].push(fi);
    }
  });
  const E0 = nVerts, F0 = nVerts + edges.size;
  // vertex points
  for (let v = 0; v < nVerts; v++) {
    const m = new Map();
    const es = vertEdges[v];
    const boundary = es.filter((e) => e.faces.length === 1);
    if (es.length === 0) add(m, v, 1);
    else if (boundary.length > 0) {
      if (boundary.length === 2) {
        add(m, v, 0.75);
        for (const e of boundary) add(m, e.a === v ? e.b : e.a, 0.125);
      } else add(m, v, 1);
    } else {
      const n = es.length;
      add(m, v, (n - 3) / n);
      for (const e of es) {
        add(m, v, 1 / (n * n));
        add(m, e.a === v ? e.b : e.a, 1 / (n * n));
      }
      const fs = vertFaces[v];
      for (const fi of fs) for (const u of faces[fi]) add(m, u, 1 / (n * fs.length * faces[fi].length));
    }
    combos.push(m);
  }
  // edge points
  const edgeList = [...edges.values()];
  for (const e of edgeList) {
    const m = new Map();
    if (e.faces.length === 2) {
      add(m, e.a, 0.25);
      add(m, e.b, 0.25);
      for (const fi of e.faces) for (const u of faces[fi]) add(m, u, 0.25 / faces[fi].length);
    } else {
      add(m, e.a, 0.5);
      add(m, e.b, 0.5);
    }
    combos.push(m);
  }
  // face points
  for (const f of faces) {
    const m = new Map();
    for (const u of f) add(m, u, 1 / f.length);
    combos.push(m);
  }
  const out = [];
  faces.forEach((f, fi) => {
    const n = f.length;
    for (let k = 0; k < n; k++) {
      const v = f[k], nx = f[(k + 1) % n], pv = f[(k + n - 1) % n];
      out.push([v, E0 + edges.get(ekey(v, nx)).id, F0 + fi, E0 + edges.get(ekey(pv, v)).id]);
    }
  });
  return { combos, faces: out };
}

function buildPart(faces, levels) {
  // compact the vertex set
  const remap = new Map();
  const src = [];
  let quads = faces.map((f) => f.map((v) => {
    if (!remap.has(v)) { remap.set(v, src.length); src.push(v); }
    return remap.get(v);
  }));
  let pos = src.map((v) => [V[v * 3], V[v * 3 + 1], V[v * 3 + 2]]);
  let wts = src.map((v) => vw[v]);
  for (let l = 0; l < levels; l++) {
    const { combos, faces: nf } = subdivide(pos.length, quads);
    const np = [], nw = [];
    for (const m of combos) {
      const p = [0, 0, 0];
      const w = new Map();
      for (const [i, c] of m) {
        p[0] += c * pos[i][0]; p[1] += c * pos[i][1]; p[2] += c * pos[i][2];
        for (const [b, x] of wts[i]) w.set(b, (w.get(b) ?? 0) + c * x);
      }
      np.push(p); nw.push(w);
    }
    pos = np; wts = nw; quads = nf;
  }
  return { pos, wts, quads };
}

const body = buildPart(bodyFaces, 1);
const eyes = buildPart([...groups['helper-l-eye'], ...groups['helper-r-eye']], 1);
const scalp = buildPart(groups['helper-hair'], 1);

// ---------------------------------------------------------------- duplicate arms
{
  const isArm2 = bones.map((b) => /2$/.test(b.name) && ARM2.test(b.name.slice(0, -1)));
  const armSrc = new Map(); // original arm bone index -> clone index
  bones.forEach((b, i) => { if (isArm2[i]) armSrc.set(boneIndex.get(b.name.slice(0, -1)), i); });
  const armW = body.wts.map((m) => { let s = 0; for (const [b, w] of m) if (armSrc.has(b)) s += w; return s; });
  const dup = new Map();
  const nq = body.quads.length;
  for (let q = 0; q < nq; q++) {
    const f = body.quads[q];
    if (!f.some((v) => armW[v] > 1e-4)) continue;
    body.quads.push(f.map((v) => {
      if (!dup.has(v)) {
        dup.set(v, body.pos.length);
        body.pos.push(body.pos[v].slice());
        const m = new Map();
        for (const [b, w] of body.wts[v]) m.set(armSrc.get(b) ?? b, w);
        body.wts.push(m);
      }
      return dup.get(v);
    }));
  }
  console.log('arm duplication: +%d verts', dup.size);
}

// ---------------------------------------------------------------- pack
function pack(part) {
  const n = part.pos.length;
  const position = new Float32Array(n * 3);
  const normalAcc = new Float64Array(n * 3);
  part.pos.forEach((p, i) => position.set(p, i * 3));
  const index = [];
  const P = (i) => part.pos[i];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  for (const f of part.quads) {
    const tris = f.length === 3 ? [f] :
      d2(P(f[0]), P(f[2])) <= d2(P(f[1]), P(f[3])) ? [[f[0], f[1], f[2]], [f[0], f[2], f[3]]] : [[f[0], f[1], f[3]], [f[1], f[2], f[3]]];
    for (const [a, b, c] of tris) {
      index.push(a, b, c);
      const A = P(a), B = P(b), C = P(c);
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
      const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) { normalAcc[v * 3] += nx; normalAcc[v * 3 + 1] += ny; normalAcc[v * 3 + 2] += nz; }
    }
  }
  // weld normals of coincident vertices (arm duplicates share the torso seam)
  const normal = new Int8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = normalAcc[i * 3], y = normalAcc[i * 3 + 1], z = normalAcc[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    normal[i * 4] = Math.round((x / l) * 127);
    normal[i * 4 + 1] = Math.round((y / l) * 127);
    normal[i * 4 + 2] = Math.round((z / l) * 127);
  }
  const skinIndex = new Uint8Array(n * 4);
  const skinWeight = new Uint8Array(n * 4);
  part.wts.forEach((m, i) => {
    const top = [...m].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, t) => s + t[1], 0) || 1;
    let acc = 0;
    top.forEach(([b, w], k) => {
      const q = k === 0 ? 0 : Math.round((w / sum) * 255);
      skinIndex[i * 4 + k] = b;
      skinWeight[i * 4 + k] = q;
      acc += q;
    });
    if (top.length) skinWeight[i * 4] = 255 - acc; else { skinIndex[i * 4] = boneIndex.get('head'); skinWeight[i * 4] = 255; }
  });
  return { position, normal, skinIndex, skinWeight, index: new Uint32Array(index) };
}

// arm-duplicate normals: accumulate face normals across coincident originals so the seam shades smoothly
const packed = { body: pack(body), eyes: pack(eyes), scalp: pack(scalp) };

const chunks = [];
let offset = 0;
const meta = { height: HEIGHT, bones: bones.map((b) => ({ name: b.name, parent: b.parent, head: b.head.map((x) => +x.toFixed(5)), tail: b.tail.map((x) => +x.toFixed(5)) })), parts: {} };
for (const [name, p] of Object.entries(packed)) {
  meta.parts[name] = { vertices: p.position.length / 3, triangles: p.index.length / 3 };
  for (const [attr, arr] of Object.entries(p)) {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    meta.parts[name][attr] = { offset, length: arr.length };
    chunks.push(buf);
    offset += buf.length;
  }
}
meta.landmarks = {
  eyeL: joint(sk.bones['eye.L'].head), eyeR: joint(sk.bones['eye.R'].head),
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'shiva.bin'), Buffer.concat(chunks));
writeFileSync(join(OUT, 'shiva.json'), JSON.stringify(meta));
console.log('bones: %d', bones.length);
for (const [k, v] of Object.entries(meta.parts)) console.log('%s: %d verts, %d tris', k, v.vertices, v.triangles);
console.log('bin: %s MB', (offset / 1e6).toFixed(2));
const show = ['hips', 'spine04', 'spine01', 'neck01', 'head', 'clavicle.L', 'upperarm01.L', 'lowerarm01.L', 'wrist.L', 'upperleg01.L', 'lowerleg01.L', 'foot.L', 'toe.L'];
for (const n of show) { const b = bones[boneIndex.get(n)]; console.log(n.padEnd(14), b.head.map((x) => x.toFixed(3)).join(', '), ' tail', b.tail.map((x) => x.toFixed(3)).join(', ')); }
