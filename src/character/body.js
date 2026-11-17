import * as THREE from 'three';

// Loads the baked MakeHuman-derived body (see tools/build-character.mjs).
export async function loadBody(base = './assets/') {
  const [meta, bin] = await Promise.all([
    fetch(base + 'shiva.json').then((r) => r.json()),
    fetch(base + 'shiva.bin').then((r) => r.arrayBuffer()),
  ]);

  const geometry = (part, skinned = true) => {
    const g = new THREE.BufferGeometry();
    const view = (Type, a) => new Type(bin, a.offset, a.length);
    g.setAttribute('position', new THREE.BufferAttribute(view(Float32Array, part.position), 3));
    const nb = new THREE.InterleavedBuffer(view(Int8Array, part.normal), 4);
    g.setAttribute('normal', new THREE.InterleavedBufferAttribute(nb, 3, 0, true));
    if (skinned) {
      g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(view(Uint8Array, part.skinIndex)), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(view(Uint8Array, part.skinWeight), 4, true));
    }
    g.setIndex(new THREE.BufferAttribute(view(Uint32Array, part.index), 1));
    g.computeBoundingSphere();
    return g;
  };

  const bones = meta.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    const p = b.parent >= 0 ? meta.bones[b.parent].head : [0, 0, 0];
    bone.position.set(b.head[0] - p[0], b.head[1] - p[1], b.head[2] - p[2]);
    bone.userData.head = new THREE.Vector3(...b.head);
    bone.userData.tail = new THREE.Vector3(...b.tail);
    bone.userData.restPosition = bone.position.clone();
    return bone;
  });
  meta.bones.forEach((b, i) => { if (b.parent >= 0) bones[b.parent].add(bones[i]); });
  const root = new THREE.Group();
  root.name = 'rig';
  root.add(bones[0]);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const byName = Object.fromEntries(bones.map((b) => [b.name, b]));

  return {
    meta, root, bones, byName, skeleton,
    geometries: { body: geometry(meta.parts.body), eyes: geometry(meta.parts.eyes), scalp: geometry(meta.parts.scalp, false) },
  };
}

export function makeSkinned(geometry, material, body) {
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.bind(body.skeleton, new THREE.Matrix4());
  mesh.frustumCulled = false;
  return mesh;
}
