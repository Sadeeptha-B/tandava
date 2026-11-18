// CPU side of the stamp ripples drawn by the water shader (environment.js), for things that float on them.
// Each impact is a Vector4 (x, z, time, strength); the front travels at RIPPLE_SPEED, as in the shader.
export const RIPPLE_SPEED = 2.3;
export const WATER_Y = 0.018;

/**
 * Surface response at (x, z): `h` heave (m), `sx`/`sz` surface slope, `push` an outward drift impulse
 * (m/s per second, along x/z). Uses the broad swell envelope the caustics use (it carries further than
 * the sharp crest), with the crest's own short wavelength on top so small floats bob quickly as it passes.
 */
export function rippleAt(impacts, time, x, z, out) {
  let h = 0, sx = 0, sz = 0, px = 0, pz = 0;
  for (let i = 0; i < impacts.length; i++) {
    const im = impacts[i], age = time - im.z;
    if (!(age > 0 && age < 9 && im.w > 0)) continue;
    const dx = x - im.x, dz = z - im.y, dist = Math.hypot(dx, dz) + 1e-3;
    const f = dist - age * RIPPLE_SPEED;
    const s = Math.exp(-f * f * 0.35) * Math.exp(-age * 0.3) * im.w / (1 + dist * 0.06);
    if (s < 1e-4) continue;
    const ux = dx / dist, uz = dz / dist;
    h += s * (0.018 * Math.sin(f * 8.5) + 0.045 * Math.sin(f * 2.2));
    const slope = s * (0.018 * 8.5 * Math.cos(f * 8.5) + 0.045 * 2.2 * Math.cos(f * 2.2));
    sx += ux * slope; sz += uz * slope;
    const k = s * Math.exp(-f * f * 0.8) * 0.5;      // the front itself carries floats outward
    px += ux * k; pz += uz * k;
  }
  out.h = h; out.sx = sx; out.sz = sz; out.px = px; out.pz = pz;
  return out;
}
