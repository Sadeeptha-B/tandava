// Original, fully synthesised score (Web Audio). Nothing is sampled, so there is nothing to license.
//   drone        tanpura-like Sa / Pa / upper Sa
//   mridangam    plays the sollukattu of the jathis (character/score.js) and a gentle theka elsewhere
//   nattuvangam  small cymbals: they strike with the sollukattu, and keep the tala's claps outside the jathis
//   damaru       rhythmic phrases while the drum hand shakes
//   stamps       salangai (ankle bells), splash and body for every strike the dancer actually makes
// Score events are scheduled a little ahead at their exact beat times (not on frame boundaries), so the
// music keeps time whatever the frame rate. Audio starts muted and is enabled by the user.
export function createAudio({ context = null } = {}) {
  let ctx = null, master = null, verb = null, drone = null, noiseBuf = null, enabled = false;
  let busDrum = null, busCym = null, busBell = null, busFx = null;
  let next = null; // absolute beat up to which the score has been scheduled
  let lastGreat = -1; // audio time of the last great landing (both feet land together)
  const SA = 73.42; // D2
  const RH = SA * 2; // mridangam right head (valanthalai) tuned to Sa
  const LOOKAHEAD = 0.15; // seconds scheduled ahead of the dance

  const build = (c) => {
    ctx = c ?? new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.22;
    // a fast limiter after the glue compressor, so nothing (two feet landing at once, say) can clip
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
    master.connect(comp); comp.connect(lim); lim.connect(ctx.destination);
    // temple reverb: exponentially decaying noise
    const len = ctx.sampleRate * 3.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * (i < 400 ? i / 400 : 1); }
    verb = ctx.createConvolver(); verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    verb.connect(wet); wet.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    // the accompanists sit to either side: drum a little left, cymbals a little right
    const bus = (pan, wetAmt) => {
      const g = ctx.createGain();
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(master); } else g.connect(master);
      const w = ctx.createGain(); w.gain.value = wetAmt; g.connect(w); w.connect(verb);
      return g;
    };
    busDrum = bus(-0.22, 0.32); busCym = bus(0.28, 0.42); busBell = bus(0, 0.3); busFx = bus(0, 0.5);
    // drone: Sa, Pa, upper Sa – detuned saws through a slowly breathing low-pass
    drone = ctx.createGain(); drone.gain.value = 0.0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.8;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.07; lfoG.gain.value = 180; lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
    for (const [mult, g, det] of [[1, 0.5, -4], [1, 0.5, 5], [1.5, 0.26, 2], [2, 0.3, -3], [2, 0.2, 7], [0.5, 0.5, 0]]) {
      const o = ctx.createOscillator(); o.type = mult === 0.5 ? 'sine' : 'sawtooth'; o.frequency.value = SA * mult; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = g * 0.2; o.connect(og); og.connect(lp); o.start();
    }
    lp.connect(drone); drone.connect(master); drone.connect(verb);
  };

  // ---- building blocks
  // one decaying sine partial (decay: seconds to silence), optionally gliding to f1
  const partial = (dest, t, f, amp, decay, f1 = 0) => {
    if (amp < 1e-4) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + decay * 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.002 + decay);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + decay + 0.05);
  };
  // a filtered noise burst
  const burst = (dest, t, freq, q, amp, decay, type = 'bandpass', freq1 = 0) => {
    if (amp < 1e-4) return;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freq1) f.frequency.exponentialRampToValueAtTime(freq1, t + decay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.001 + decay);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5, decay + 0.05);
  };

  // ---- mridangam. The right head's modes are nearly harmonic (the black karanai tunes them): open
  // strokes ring, damped strokes die at once. The left head (thoppi) gives the bass.
  const right = (t, v, open, amps = open ? [1, 0.5, 0.34, 0.2, 0.1] : [1, 0.6, 0.45, 0.3, 0.2]) => {
    for (let i = 0; i < 5; i++) partial(busDrum, t, RH * (i + 1) * (1 + 0.0015 * i), v * amps[i] * 0.22, open ? 0.9 * open / (1 + i * 0.45) : 0.06 / (1 + i * 0.3));
    burst(busDrum, t, 2600, 1.1, v * 0.16, 0.018);
  };
  const left = (t, v, open = true) => {
    partial(busDrum, t, 92, v * 0.5, open ? 0.55 : 0.08, open ? 78 : 0);
    partial(busDrum, t, 92 * 2.1, v * 0.12, open ? 0.25 : 0.05);
    burst(busDrum, t, 420, 0.9, v * 0.12, 0.03);
  };
  const STROKES = {
    ta: (t, v) => right(t, v, 0),
    ki: (t, v) => { burst(busDrum, t, 3800, 1.4, v * 0.16, 0.014); partial(busDrum, t, RH * 3, v * 0.06, 0.03); },
    ka: (t, v) => left(t, v * 0.7, false),
    dhi: (t, v) => right(t, v, 1),
    nam: (t, v) => right(t, v, 0.8, [0.25, 0.9, 0.6, 0.35, 0.15]),
    thom: (t, v) => left(t, v),
    tham: (t, v) => { left(t, v); right(t, v * 0.7, 0); },
    thai: (t, v) => { right(t, v, 0); left(t, v * 0.5); },
    dhit: (t, v) => { right(t, v, 1); burst(busDrum, t, 3200, 1.2, v * 0.2, 0.02); },
    dhim: (t, v) => { right(t, v, 1); left(t, v); },
  };
  STROKES.tha = STROKES.ta; STROKES.thi = STROKES.dhi; STROKES.mi = (t, v) => STROKES.nam(t, v * 0.7);
  const DRUM = 0.7; // the five right-head partials start in phase, so the drum peaks hot
  const play = (syl, t, v) => (STROKES[syl] ?? STROKES.ta)(t, v * DRUM);

  // ---- nattuvangam: a pair of small bronze cymbals; open strokes ring (sam, accents), closed are damped
  const CYM = [[1, 1], [1.47, 0.7], [2.09, 0.5], [2.56, 0.45], [3.18, 0.3], [3.86, 0.2]];
  const talam = (t, v, open) => {
    const f0 = 2240 + Math.random() * 30;
    for (const [r, a] of CYM) partial(busCym, t, f0 * r, v * a * 0.035, open ? 1.4 / (1 + r * 0.25) : 0.09);
    burst(busCym, t, 7000, 0.7, v * 0.07, open ? 0.08 : 0.03, 'highpass');
  };

  // ---- salangai: a cluster of small bells on the ankle
  const bells = (t, v) => {
    for (let i = 0; i < 6; i++) {
      const dt = Math.random() * 0.02, f = 3400 + Math.random() * 2400;
      partial(busBell, t + dt, f, v * 0.03, 0.18 + Math.random() * 0.15);
      partial(busBell, t + dt, f * 2.71, v * 0.012, 0.08);
    }
    burst(busBell, t, 8000, 0.8, v * 0.05, 0.05, 'highpass');
  };

  // ---- damaru: the bead strikes the two heads in turn; a phrase per beat ("dha . ki ta dha . ki ta")
  const DAMARU = [1, 0, 0.55, 0.7, 0.9, 0, 0.55, 0.75];
  const damaruHit = (t, v, head) => {
    partial(busFx, t, head ? 330 : 262, v * 0.2, 0.09, head ? 250 : 200);
    burst(busFx, t, head ? 1980 : 1570, 1.2, v * 0.16, 0.035);
  };

  const swell = (t, dur) => burst(busFx, t, 200, 0.9, 0.16, dur, 'bandpass', 2600);

  // ---- scheduling: everything in the absolute beat span [b0, b1), b0 sounding at audio time t0
  let fxBuf = null;
  function scheduleSpan(c, b0, b1, t0) {
    const B = c.beats, sc = c.score;
    const at = (b) => t0 + (b - b0) * c.beat;
    const loc = (b) => ((b % B) + B) % B;
    const inTala = (lb) => sc.talaSpans.some(([a, z]) => lb >= a && lb < z);
    // the jathis: syllables on the drum, the cymbals with every spoken (not filler) syllable
    for (let k = Math.floor(b0 / B); k <= Math.floor(b1 / B); k++) {
      for (const e of sc.events) {
        const ab = k * B + e.b;
        if (ab < b0 || ab >= b1) continue;
        play(e.syl, at(ab), e.filler ? 0.28 : e.accent ? 1 : 0.62);
        if (!e.filler) talam(at(ab), e.accent ? 1 : 0.55, e.accent);
      }
    }
    // elsewhere: the theka, and the cymbals on the claps (1, 5, 7; sam rings)
    for (let hb = Math.ceil(b0 * 2) / 2; hb < b1; hb += 0.5) {
      const lb = loc(hb);
      if (!inTala(lb)) continue;
      const I = c.intensity(lb), slot = Math.round(lb * 2) % 16, th = sc.theka[slot];
      if (th) play(th.syl, at(hb), (th.filler ? 0.2 : 0.42) * (0.35 + 0.65 * I));
      if (slot === 0 || slot === 8 || slot === 12) talam(at(hb), (slot === 0 ? 0.55 : 0.32) * (0.5 + 0.5 * I), slot === 0);
    }
    // damaru phrases while the drum hand shakes
    const fx = c.ch.fx;
    fxBuf ??= new Float32Array(fx.size);
    for (let e8 = Math.ceil(b0 * 8) / 8; e8 < b1; e8 += 0.125) {
      const lb = loc(e8), d = fx.sample(lb, fxBuf)[0];
      if (d <= 0.15) continue;
      const slot = Math.round(lb * 8) % 8;
      if (DAMARU[slot]) damaruHit(at(e8), DAMARU[slot] * d, slot % 2);
    }
    // the drone follows the dance's intensity
    for (let wb = Math.ceil(b0); wb < b1; wb++) drone.gain.setTargetAtTime(0.35 + 0.5 * c.intensity(loc(wb)), at(wb), 0.6);
    // a rising breath into the landing, kept short and low so the tihai stays clear
    for (let k = Math.floor(b0 / B); k <= Math.floor(b1 / B); k++) {
      const ab = k * B + c.landingBeat - 1.3;
      if (ab >= b0 && ab < b1) swell(at(ab), 1.25 * c.beat);
    }
  }

  const api = {
    get enabled() { return enabled; },
    async toggle(on = !enabled) {
      if (on && !ctx) build();
      enabled = on;
      if (!ctx) return enabled;
      if (on) await ctx.resume();
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(on ? 0.9 : 0, ctx.currentTime + (on ? 1.2 : 0.4));
      return enabled;
    },
    suspend(paused) { if (ctx && enabled) master.gain.linearRampToValueAtTime(paused ? 0 : 0.9, ctx.currentTime + 0.3); },

    // called every frame: schedule what falls in the next LOOKAHEAD seconds of the dance
    update(performer) {
      if (!enabled || !ctx) return;
      const c = performer.c, abs = performer.time / c.beat, ahead = abs + LOOKAHEAD / c.beat;
      if (next === null || next < abs - 0.02 || next > ahead + 0.25) next = abs; // first run, a stall, or a seek
      if (ahead <= next) return;
      scheduleSpan(c, next, ahead, ctx.currentTime + (next - abs) * c.beat);
      next = ahead;
    },

    // a foot strikes the ground (when: audio time, defaults to now)
    stamp(strength, when) {
      if (!enabled || !ctx) return;
      const t = when ?? ctx.currentTime + 0.005, s = strength;
      // the body of the strike on stone under water (kept low: the mridangam carries the rhythm)
      partial(busFx, t, 95 + 30 * s, 0.1 + 0.2 * s, 0.35 + 0.9 * s, 38);
      burst(busFx, t, 3200, 0.7, 0.05 + 0.2 * s, 0.25 + 0.4 * s, 'bandpass', 900); // splash
      bells(t, 0.35 + 0.65 * s);
      if (s > 0.8 && t - lastGreat > 0.1) {
        // the great landing (once, though both feet strike): sub drop and a bell-like shimmer on Sa / Pa
        lastGreat = t;
        partial(busFx, t, 62, 0.7, 2.2, 27);
        for (const [m, v] of [[4, 0.07], [6, 0.05], [8, 0.035], [12.02, 0.02]]) partial(busFx, t, SA * m, v * 0.6, 4.5);
      }
    },

    // offline rendering (dev): schedule a whole span at once
    scheduleSpan,
  };
  if (context) { build(context); enabled = true; master.gain.value = 0.9; }
  return api;
}
