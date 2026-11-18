import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RING } from '../fx/ring.js';

// Cinematic rig: a largely stable full-figure frame with a slow orbital drift, a gentle
// dolly tied to the dance, and a restrained impact response. An interactive orbit mode
// can be toggled; returning to cinematic eases back.
export function createCameraRig(camera, dom, { reducedMotion }) {
  camera.fov = 31;
  const controls = new OrbitControls(camera, dom);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 2.6; controls.maxDistance = 13;
  controls.minPolarAngle = 0.9; controls.maxPolarAngle = Math.PI / 2 - 0.035;
  controls.target.set(0, 1.2, -0.1);

  const state = { mode: 'cinematic', blend: 1, shake: 0, focusX: 0, focusY: 1.2, kick: 0, dist: 7, zoom: 1 };
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), tmp = new THREE.Vector3();
  const fromPos = new THREE.Vector3(), fromLook = new THREE.Vector3();

  const fitDistance = () => {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // landscape: the whole ring; portrait: let the ring's flanks crop so the dancer stays large
    const needV = 1.68, needH = camera.aspect < 1 ? RING.radius * 0.9 : Math.min(RING.radius + 0.45, 1.95);
    return Math.max(needV / t, needH / (t * camera.aspect)) / state.zoom;
  };

  return {
    controls, state,
    setMode(mode) {
      if (mode === state.mode) return;
      state.mode = mode;
      if (mode === 'interactive') { controls.target.copy(look); controls.enabled = true; }
      else { controls.enabled = false; fromPos.copy(camera.position); fromLook.copy(controls.target); state.blend = 0; }
    },
    impact(strength) { state.kick = Math.max(state.kick, strength); },
    update(time, dt, performer) {
      const I = performer.intensity, beat = performer.beatPos;
      // follow the dancer a little so travelling steps stay composed
      const hp = performer.pose.hipsPos;
      const k = 1 - Math.exp(-dt * 1.4);
      state.focusX += (hp.x * 0.55 - state.focusX) * k;
      state.focusY += ((1.16 + (hp.y - 0.9) * 0.3) - state.focusY) * k;
      state.kick *= Math.exp(-dt * 5);

      const base = fitDistance();
      // dolly: drift in through the rhythmic section, pull back for the leap so the shockwave has room
      const land = performer.c.landingBeat;
      const pre = THREE.MathUtils.smoothstep(beat, land - 5, land - 0.5) * (1 - THREE.MathUtils.smoothstep(beat, land + 3, land + 8));
      // push in and up during the storytelling passage so the hand gestures read (cinematic mode
      // only: the orbit camera is never scripted)
      const nr = performer.c.nritya;
      const story = nr ? THREE.MathUtils.smoothstep(beat, nr[0] - 0.5, nr[0] + 1.5) * (1 - THREE.MathUtils.smoothstep(beat, nr[1], nr[1] + 2.5)) : 0;
      const dolly = 1 - 0.13 * THREE.MathUtils.smoothstep(I, 0.2, 0.8) + 0.2 * pre - 0.32 * story;
      const m = reducedMotion ? 0 : 1;
      const yaw = m * (0.2 * Math.sin(time * 0.071) + 0.07 * Math.sin(time * 0.173 + 1.3));
      const dist = base * dolly + m * 0.25 * Math.sin(time * 0.05);
      state.dist += (dist - state.dist) * (1 - Math.exp(-dt * 0.9));
      const height = 1.02 + m * 0.16 * Math.sin(time * 0.043 + 0.7) - 0.25 * pre + 0.14 * story + (state.zoom - 1) * 0.3;
      look.set(state.focusX, state.focusY + 0.08 - 0.1 * pre + 0.17 * story + (state.zoom - 1) * 0.28, -0.1);
      pos.set(look.x + Math.sin(yaw) * state.dist, height, look.z + Math.cos(yaw) * state.dist);
      if (!reducedMotion && state.kick > 0.003) {
        const s = state.kick * 0.022;
        pos.x += Math.sin(time * 71) * s; pos.y += Math.cos(time * 83) * s * 1.4;
      }

      if (state.mode === 'interactive') {
        controls.update();
      } else {
        if (state.blend < 1) {
          state.blend = Math.min(1, state.blend + dt / 1.6);
          const e = state.blend * state.blend * (3 - 2 * state.blend);
          camera.position.lerpVectors(fromPos, pos, e);
          camera.lookAt(tmp.lerpVectors(fromLook, look, e));
        } else {
          camera.position.copy(pos);
          camera.lookAt(look);
        }
      }
    },
    snap() { state.dist = fitDistance(); state.blend = 1; },
  };
}
