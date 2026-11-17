import * as THREE from 'three';

// Facial performance. The face is never blank: the eyes open as Shiva awakens, the gaze
// widens and the brow gathers as the dance builds, and the features soften into a faint
// smile in the afterglow. Values are keyed in beats and eased, with breath and slow blinks.
const KEYS = {
  //            beat, value
  eyesOpen: [[0, 0], [3, 0.04], [8, 0.36], [11.4, 0.2], [13.6, 0.2], [16, 0.55], [24, 0.5], [38.4, 0.5], [39.2, 0.22], [40.3, 0.24], [42, 0.56], [56, 0.62], [60.6, 0.7], [61.15, 0.86], [64, 0.8], [68, 0.55], [74, 0.3], [78, 0.03], [80, 0]],
  browDown: [[0, 0], [8, 0.05], [16, 0.3], [32, 0.36], [48, 0.45], [56, 0.6], [61.15, 0.8], [64, 0.5], [70, 0.12], [80, 0]],
  browInnerUp: [[0, 0.3], [6, 0.25], [14, 0.05], [16, 0], [66, 0], [72, 0.3], [80, 0.3]],
  browOuterUp: [[0, 0], [56, 0.05], [61.15, 0.4], [66, 0.1], [72, 0], [80, 0]],
  smile: [[0, 0.3], [8, 0.36], [11.4, 0.42], [14, 0.3], [16, 0.16], [56, 0.1], [61.15, 0.04], [64, 0.25], [68, 0.55], [76, 0.5], [80, 0.3]],
  lipsPart: [[0, 0], [14, 0], [16, 0.1], [56, 0.14], [61.1, 0.45], [63, 0.18], [68, 0.04], [80, 0]],
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
