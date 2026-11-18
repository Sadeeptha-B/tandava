// Original, fully synthesised score (Web Audio): a tanpura-like drone, damaru rattles,
// a soft percussion pulse on the tala and deep hits for every stamp. Nothing is sampled,
// so there is nothing to license. Audio starts muted and is enabled by the user.
export function createAudio() {
  let ctx = null, master = null, verb = null, drone = null, enabled = false;
  let lastBeat = -1, lastRattle = -1, swellDone = false;
  const SA = 73.42; // D2

  const build = () => {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.22;
    master.connect(comp); comp.connect(ctx.destination);
    // temple reverb: exponentially decaying noise
    const len = ctx.sampleRate * 3.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * (i < 400 ? i / 400 : 1); }
    verb = ctx.createConvolver(); verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    verb.connect(wet); wet.connect(master);
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

  const noise = (dur) => {
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource(); s.buffer = b; return s;
  };
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const out = (node, dry = 1, wetAmt = 0.3) => { const g = ctx.createGain(); g.gain.value = dry; node.connect(g); g.connect(master); if (wetAmt) { const w = ctx.createGain(); w.gain.value = wetAmt; node.connect(w); w.connect(verb); } };

  // a tuned membrane hit: sine with a falling pitch + a short noise transient
  const drum = (t, f0, f1, dur, vol, click = 0.3, wet = 0.3) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    env(g, t, 0.003, vol, dur); o.connect(g); out(g, 1, wet); o.start(t); o.stop(t + dur + 0.05);
    if (click > 0) {
      const n = noise(0.05), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = f0 * 6; bp.Q.value = 1.2;
      env(ng, t, 0.001, vol * click, 0.035); n.connect(bp); bp.connect(ng); out(ng, 1, wet * 0.6); n.start(t);
    }
  };

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

    // called every frame with the dance state
    update(performer) {
      if (!enabled || !ctx) return;
      const t = ctx.currentTime + 0.012, beat = performer.beatPos, I = performer.intensity;
      drone.gain.setTargetAtTime(0.35 + 0.5 * I, t, 0.6);
      // tala pulse: Adi tala, 8 beats as 4+2+2. Claps fall on 1 (sam), 5 and 7; finger counts
      // on 2-4; waves on 6 and 8. Sam is the heaviest, waves the lightest.
      const whole = Math.floor(beat * 2) / 2;
      if (whole !== lastBeat) {
        lastBeat = whole;
        const onBeat = whole % 1 === 0, pos = whole % 8;
        if (I > 0.2) {
          if (onBeat) {
            const sam = pos === 0, clap = pos === 4 || pos === 6, wave = pos === 5 || pos === 7;
            const vol = sam ? 0.34 : clap ? 0.26 : wave ? 0.11 : 0.16;
            drum(t, sam ? 150 : clap ? 132 : 196, sam || clap ? 70 : 150, sam ? 0.32 : 0.26, vol * (0.4 + I), 0.25);
          } else if (I > 0.6) drum(t, 392, 340, 0.08, 0.07 * I, 0.6, 0.2);
        }
        if (Math.abs(whole - (performer.c.landingBeat - 2.5)) < 0.01) swellDone = false;
      }
      // rising breath before the landing
      const land = performer.c.landingBeat;
      if (!swellDone && beat > land - 2.4 && beat < land - 2) {
        swellDone = true;
        const dur = 2.3 * performer.c.beat, n = noise(dur + 0.1), bp = ctx.createBiquadFilter(), g = ctx.createGain();
        bp.type = 'bandpass'; bp.Q.value = 0.9; bp.frequency.setValueAtTime(200, t); bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
        n.connect(bp); bp.connect(g); out(g, 1, 0.6); n.start(t);
      }
      // damaru: two alternating heads, eight strokes a beat while the wrist is shaking
      const rt = Math.floor(beat * 8);
      if (rt !== lastRattle) {
        lastRattle = rt;
        const d = performer.fx.damaru;
        if (d > 0.15) drum(t, rt % 2 ? 330 : 262, rt % 2 ? 250 : 200, 0.07, 0.2 * d, 0.9, 0.25);
      }
    },

    // a foot strikes the ground
    stamp(strength) {
      if (!enabled || !ctx) return;
      const t = ctx.currentTime + 0.005, s = strength;
      drum(t, 95 + 30 * s, 38, 0.35 + 0.9 * s, 0.35 + 0.6 * s, 0.25, 0.5);
      // splash
      const n = noise(0.7), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.Q.value = 0.7; bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(900, t + 0.5);
      env(g, t, 0.006, 0.05 + 0.2 * s, 0.25 + 0.4 * s); n.connect(bp); bp.connect(g); out(g, 1, 0.5); n.start(t);
      if (s > 0.8) {
        // the great landing: sub drop and a bell-like shimmer on Sa / Pa
        drum(t, 62, 27, 2.2, 0.9, 0, 0.7);
        for (const [m, v] of [[4, 0.07], [6, 0.05], [8, 0.035], [12.02, 0.02]]) {
          const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = SA * m;
          env(og, t, 0.01, v, 4.5); o.connect(og); out(og, 0.6, 0.9); o.start(t); o.stop(t + 5);
        }
      }
    },
  };
  return api;
}
