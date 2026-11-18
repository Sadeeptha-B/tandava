import * as THREE from 'three';

// Facial performance. The face is never blank: the eyes open as Shiva awakens, the gaze
// widens and the brow gathers as the dance builds, and the features soften into a faint
// smile in the afterglow. Values are keyed in beats and eased, with breath and slow blinks.
const KEYS = {
  //            beat, value
  // 8–16 nritya: eyes open on the hands with a benevolent, faintly smiling face; 19.4 Nataraja pose;
  // 63.5 spin; 71.7 flight; 72.15 landing on sam; 78.5 return; 88 loop
  eyesOpen: [[0, 0], [3, 0.04], [8, 0.36], [9, 0.5], [16, 0.48], [19.4, 0.2], [21.6, 0.2], [24, 0.55], [32, 0.5], [46.4, 0.5], [47.2, 0.22], [48.3, 0.24], [50, 0.56], [63.5, 0.62], [71.7, 0.7], [72.15, 0.86], [75, 0.8], [78.5, 0.55], [84, 0.3], [87.2, 0.03], [88, 0]],
  browDown: [[0, 0], [8, 0.05], [16, 0.08], [24, 0.3], [40, 0.36], [56, 0.45], [63.5, 0.6], [72.15, 0.8], [75, 0.5], [80.5, 0.12], [88, 0]],
  browInnerUp: [[0, 0.3], [6, 0.25], [9, 0.15], [16, 0.12], [22, 0.05], [24, 0], [77, 0], [82.8, 0.3], [88, 0.3]],
  browOuterUp: [[0, 0], [63.5, 0.05], [72.15, 0.4], [77, 0.1], [82.8, 0], [88, 0]],
  smile: [[0, 0.3], [8, 0.36], [12, 0.44], [16, 0.4], [19.4, 0.42], [22, 0.3], [24, 0.16], [63.5, 0.1], [72.15, 0.04], [75, 0.25], [78.5, 0.55], [85.5, 0.5], [88, 0.3]],
  lipsPart: [[0, 0], [22, 0], [24, 0.1], [63.5, 0.14], [72.1, 0.45], [74, 0.18], [78.5, 0.04], [88, 0]],
};

function sample(keys, beat) {
  for (let i = 0; i < keys.length - 1; i++) {
    const [b0, v0] = keys[i], [b1, v1] = keys[i + 1];
    if (beat >= b0 && beat <= b1) { const s = (beat - b0) / (b1 - b0); return v0 + (v1 - v0) * s * s * (3 - 2 * s); }
  }
  return keys[keys.length - 1][1];
}

export function createFace(character) {
  const mesh = character.mesh, dict = mesh.morphTargetDictionary ?? {}, inf = mesh.morphTargetInfluences;
  const state = { blink: 0, nextBlink: 3, value: {} };
  for (const k of Object.keys(KEYS)) state.value[k] = sample(KEYS[k], 0);
  const set = (name, v) => { if (dict[name] !== undefined) inf[dict[name]] = v; };
  return {
    state,
    update(dt, time) {
      const p = character.performer, beat = p.beatPos;
      const k = dt > 0 ? 1 - Math.exp(-dt * 9) : 1;
      for (const name of Object.keys(KEYS)) state.value[name] += (sample(KEYS[name], beat) - state.value[name]) * k;
      const v = state.value;
      // slow, unhurried blinks – only once the eyes are open
      state.nextBlink -= dt;
      if (state.nextBlink <= 0) { state.blink = 1; state.nextBlink = 3.5 + Math.random() * 4; }
      state.blink = Math.max(0, state.blink - dt * 4.2);
      const lid = Math.sin(Math.min(1, state.blink) * Math.PI);
      const breath = 0.5 + 0.5 * Math.sin(time * 1.5);
      // stamps tighten the face for an instant
      const hit = THREE.MathUtils.clamp(-p.impact.x * 30, 0, 1);
      set('eyesOpen', Math.max(0, v.eyesOpen * (1 - 0.9 * lid) - hit * 0.12));
      set('browDown', THREE.MathUtils.clamp(v.browDown + hit * 0.25, 0, 1));
      set('browInnerUp', v.browInnerUp);
      set('browOuterUp', v.browOuterUp);
      set('smile', v.smile);
      set('lipsPart', THREE.MathUtils.clamp(v.lipsPart * (0.7 + 0.5 * breath) + hit * 0.12, 0, 1));
    },
    reset() { for (const name of Object.keys(KEYS)) state.value[name] = sample(KEYS[name], character.performer.beatPos); state.blink = 0; },
  };
}
