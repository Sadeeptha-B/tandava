import * as THREE from 'three';
import { loadBody, makeSkinned } from './body.js';
import { Rig } from './rig.js';
import { Performer } from './choreo.js';
import { buildTandava } from './tandava.js';

// The dancer: body mesh + rig + choreography (+ secondary motion systems, attached by the caller).
export class Character {
  static async create({ bodyMaterial, eyeMaterial } = {}) {
    const ch = new Character();
    ch.body = await loadBody();
    ch.group = new THREE.Group();
    ch.group.add(ch.body.root);
    ch.mesh = makeSkinned(ch.body.geometries.body, bodyMaterial ?? new THREE.MeshStandardMaterial({ color: 0xb9a48f, roughness: 0.6 }), ch.body);
    ch.eyes = makeSkinned(ch.body.geometries.eyes, eyeMaterial ?? new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.3 }), ch.body);
    ch.group.add(ch.mesh, ch.eyes);
    ch.rig = new Rig(ch.body);
    ch.choreo = buildTandava(ch.rig);
    ch.performer = new Performer(ch.rig, ch.choreo);
    ch.systems = []; // secondary-motion systems: { update(dt, time), reset() }
    ch.time = 0;
    return ch;
  }

  get duration() { return this.choreo.duration; }

  update(time, dt, silent = false) {
    this.time = time;
    this.performer.update(time, dt, silent);
    for (const s of this.systems) s.update(dt, time);
  }

  // jump to a time with a short simulated pre-roll so hair / cloth settle into a plausible state
  seek(time, preroll = 1.5) {
    const step = 1 / 60;
    const n = Math.max(1, Math.round(preroll / step));
    this.performer.update(time - n * step, 0, true);
    for (const s of this.systems) s.reset?.();
    for (let i = n - 1; i >= 0; i--) this.update(time - i * step, step, true);
  }
}
