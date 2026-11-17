import * as THREE from 'three';

// Elemental looks. Colours are linear-space HDR values; `apply` cross-fades between them.
const c = (r, g, b) => new THREE.Color(r, g, b);
export const PALETTES = {
  // golden divine fire against a deep turquoise world (the brief's preferred synthesis)
  both: {
    ringCore: c(1.0, 0.62, 0.2), ringFlame: c(1.0, 0.36, 0.06), ringTip: c(0.75, 0.08, 0.01),
    ember: c(1.0, 0.5, 0.12), flame: c(1.0, 0.55, 0.14), spark: c(1.0, 0.62, 0.2),
    water: c(0.35, 0.95, 1.0), fog: c(0.002, 0.013, 0.018), skyTop: c(0.0, 0.003, 0.005), skyGlow: c(0.005, 0.045, 0.058),
    rim: c(1.0, 0.56, 0.2), fill: c(0.12, 0.62, 0.78), shaft: c(0.5, 0.95, 1.0), key: c(1.0, 0.82, 0.62),
    waterDeep: c(0.002, 0.016, 0.022), mist: c(0.06, 0.34, 0.4), shock: c(0.55, 0.95, 1.0), gradeShadow: c(0.0, 0.035, 0.05), gradeHigh: c(1.0, 0.94, 0.84),
  },
  fire: {
    ringCore: c(1.0, 0.66, 0.24), ringFlame: c(1.0, 0.38, 0.06), ringTip: c(0.8, 0.07, 0.01),
    ember: c(1.0, 0.5, 0.12), flame: c(1.0, 0.55, 0.14), spark: c(1.0, 0.62, 0.2),
    water: c(1.0, 0.6, 0.22), fog: c(0.022, 0.007, 0.002), skyTop: c(0.006, 0.002, 0.0), skyGlow: c(0.1, 0.03, 0.005),
    rim: c(1.0, 0.5, 0.16), fill: c(0.8, 0.3, 0.08), shaft: c(1.0, 0.72, 0.36), key: c(1.0, 0.8, 0.56),
    waterDeep: c(0.018, 0.006, 0.001), mist: c(0.4, 0.14, 0.03), shock: c(1.0, 0.66, 0.26), gradeShadow: c(0.04, 0.012, 0.0), gradeHigh: c(1.0, 0.92, 0.78),
  },
  water: {
    ringCore: c(0.5, 0.95, 1.0), ringFlame: c(0.08, 0.6, 0.85), ringTip: c(0.01, 0.12, 0.4),
    ember: c(0.45, 0.9, 1.0), flame: c(0.4, 0.85, 1.0), spark: c(0.7, 0.97, 1.0),
    water: c(0.5, 0.97, 1.0), fog: c(0.003, 0.03, 0.042), skyTop: c(0.0, 0.006, 0.012), skyGlow: c(0.012, 0.13, 0.16),
    rim: c(0.35, 0.9, 1.0), fill: c(0.1, 0.5, 0.75), shaft: c(0.6, 1.0, 1.0), key: c(0.7, 0.92, 1.0),
    waterDeep: c(0.002, 0.022, 0.032), mist: c(0.08, 0.46, 0.55), shock: c(0.7, 1.0, 1.0), gradeShadow: c(0.0, 0.04, 0.07), gradeHigh: c(0.9, 0.98, 1.0),
  },
};

export class Palette {
  constructor(name = 'both') {
    this.name = name;
    this.cur = {};
    for (const [k, v] of Object.entries(PALETTES[name])) this.cur[k] = v.clone();
  }
  set(name) { if (PALETTES[name]) this.name = name; }
  update(dt) {
    const target = PALETTES[this.name], k = 1 - Math.exp(-dt * 2.2);
    for (const key of Object.keys(this.cur)) this.cur[key].lerp(target[key], k);
  }
  snap() { for (const key of Object.keys(this.cur)) this.cur[key].copy(PALETTES[this.name][key]); }
}
