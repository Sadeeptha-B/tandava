import { Choreography } from './choreo.js';

// ---------------------------------------------------------------------------
// The Tandava: an 88-beat (52.8 s) seamless cycle at 100 BPM, i.e. eleven cycles of
// 8-beat Adi tala (4+2+2) with sam on beats 0, 8, 16, ... 80.
//
//   A  0–24     Awakening          stillness -> aramandi -> nritya (8–16: Ganga, the
//                                  crescent moon, the serpent, Shiva's sign) -> the Nataraja pose
//   B 24–63     Rhythmic Tandava   stamps, lunges, knee lifts, rechaka, build
//   C 63–78.5   Cosmic crescendo   pivot spin -> three-fold phrase (tihai) whose last
//                                  accent is the leap's landing, on sam (72)
//   D 78.5–88   Return             gathering back into stillness
//
// Stage: +Z is towards the audience, +X is the dancer's left. Metres/degrees.
// Arm vectors are [out, up, forward] in chest space ("out" = away from the
// midline on that arm's own side), so one preset serves both sides.
// Arms: L/R are the natural (front) pair, L2/R2 the rear pair:
//   R2 damaru · L2 agni (flame) · R abhaya · L gaja-hasta
// ---------------------------------------------------------------------------

let TURN = 0; // accumulated full turns (deg) – added to every world yaw after the spin

const H = (w, y, o = {}) => ({ w, y, dx: 0, dz: 0, pitch: 0, roll: 0, ...o, yaw: (o.yaw ?? 0) + TURN });
const SP = (fwd, side, twist) => ({ fwd, side, twist });
const HD = (yaw, pitch = 0, roll = 0) => ({ yaw: yaw + TURN, pitch, roll });
const foot = (x, z, yaw, o = {}) => ({ x, z, lift: 0, pitch: 0, roll: 0, pole: [0, 0, 0], rel: 0, pivot: 0, ...o, yaw: yaw + (o.rel ? 0 : TURN) });

// ---- arm vocabulary -------------------------------------------------------
const A = {
  // rear right: damaru
  dLow: { u: [.8, -.3, -.3], f: [.62, .72, .25], fingers: [.45, .85, .2], palm: [-.45, 0, .9], pole: [0, -.6, -1], mudra: 'grip' },
  dAloft: { u: [.86, .28, -.3], f: [.38, .9, .16], fingers: [.22, .96, .1], palm: [-.5, 0, .86], pole: [0, -.6, -1], mudra: 'grip' },
  dHigh: { u: [.62, .72, -.2], f: [.3, .93, .15], fingers: [.2, .97, .1], palm: [-.5, 0, .86], pole: [.3, -.5, -1], mudra: 'grip' },
  dOut: { u: [.9, .34, -.22], f: [.86, .5, .05], fingers: [.7, .7, .05], palm: [-.2, .1, 1], pole: [0, -.8, -.6], mudra: 'grip' },
  // rear left: agni – the palm stays level so the flame is carried, not thrown
  fLow: { u: [.8, -.3, -.3], f: [.78, .52, .3], fingers: [.9, .05, .42], palm: [0, 1, 0], pole: [0, -.6, -1], mudra: 'cup' },
  fAloft: { u: [.86, .16, -.3], f: [.66, .7, .2], fingers: [.9, .12, .4], palm: [0, 1, .05], pole: [0, -.6, -1], mudra: 'cup' },
  fHigh: { u: [.62, .7, -.2], f: [.5, .85, .12], fingers: [.86, .3, .3], palm: [-.1, 1, 0], pole: [.3, -.5, -1], mudra: 'cup' },
  fOut: { u: [.9, .32, -.22], f: [.92, .36, .05], fingers: [1, .02, .12], palm: [0, 1, 0], pole: [0, -.8, -.6], mudra: 'cup' },
  // front pair
  open: { u: [.2, -.97, .04], f: [.16, -.9, .4], fingers: [.08, -.9, .42], palm: [-.8, .1, .6], pole: [.2, 0, -1], mudra: 'dola' },
  abhaya: { u: [.2, -.94, .14], f: [.14, .8, .58], fingers: [0, 1, .06], palm: [-.12, 0, 1], pole: [.3, -.2, -1], mudra: 'pataka' },
  varada: { u: [.26, -.94, .1], f: [.3, -.72, .6], fingers: [.16, -.84, .5], palm: [0, .5, .88], pole: [.3, 0, -1], mudra: 'pataka' },
  gaja: { u: [.02, -.62, .78], f: [-.93, -.3, .22], fingers: [-.5, -.86, .08], palm: [.3, -.25, -.9], pole: [.8, -.4, -.4], mudra: 'dola' },
  side: { u: [.88, -.2, .4], f: [.8, .02, .6], fingers: [.8, .24, .55], palm: [.1, -.95, .25], pole: [0, -.6, -.8], mudra: 'pataka' },
  sideUp: { u: [.92, -.02, .3], f: [.86, .22, .44], fingers: [.86, .3, .4], palm: [-.1, 1, .1], pole: [0, -.7, -.7], mudra: 'alapadma' },
  chest: { u: [.52, -.76, .3], f: [-.78, .36, .5], fingers: [-.72, .5, .46], palm: [.1, -.3, -.95], pole: [.6, -.5, -.6], mudra: 'kataka' },
  high: { u: [.66, .66, .3], f: [.56, .78, .28], fingers: [.4, .9, .2], palm: [.1, -.1, 1], pole: [.2, -.6, -.8], mudra: 'alapadma' },
  low: { u: [.72, -.64, -.22], f: [.8, -.56, -.16], fingers: [.82, -.56, -.1], palm: [0, -.5, -.86], pole: [0, .2, -1], mudra: 'pataka' },
  over: { u: [.38, .9, .12], f: [-.16, .96, .2], fingers: [-.3, .95, .05], palm: [.2, 0, 1], pole: [.8, -.2, -.5], mudra: 'alapadma' },
  press: { u: [.56, -.76, .3], f: [.62, -.64, .44], fingers: [.78, -.08, .62], palm: [0, -1, 0], pole: [.3, .1, -1], mudra: 'pataka' },
  fwd: { u: [.34, -.25, .9], f: [.22, .3, .93], fingers: [.15, .5, .85], palm: [-.6, -.5, .6], pole: [.7, -.6, -.3], mudra: 'pataka' },
  lowFwd: { u: [.24, -.84, .5], f: [-.58, -.52, .62], fingers: [-.7, -.12, .7], palm: [.1, .95, .25], pole: [.7, -.2, -.6], mudra: 'cup' },

  // ---- nritya: depicting Shiva's attributes (front pair)
  // Ganga: a pataka hand, palm down, descends in waves from high above into the jata
  gangaHigh: { u: [.5, .82, .28], f: [.2, .95, .25], fingers: [-.5, .3, .8], palm: [0, -1, .1], pole: [.3, -.6, -.8], mudra: 'pataka' },
  gangaWave1: { u: [.6, .72, .3], f: [.02, .92, .4], fingers: [-.2, .2, .95], palm: [.45, -.88, 0], pole: [.4, -.6, -.7], mudra: 'pataka' },
  gangaWave2: { u: [.56, .76, .3], f: [-.3, .86, .4], fingers: [-.75, .1, .65], palm: [-.4, -.9, .1], pole: [.5, -.5, -.7], mudra: 'pataka' },
  gangaCrown: { u: [.55, .78, .22], f: [-.8, .45, .2], fingers: [-.95, 0, .25], palm: [0, -1, 0], pole: [.6, -.4, -.6], mudra: 'pataka' },
  // the crescent moon, held beside the topknot
  moon: { u: [.75, .3, .55], f: [-.5, .85, 0], fingers: [-.15, .95, .2], palm: [.1, 0, 1], pole: [.5, -.5, -.7], mudra: 'chandrakala' },
  // the serpent: it lies at the neck, glides out along the shoulder, and raises its hood
  // beside the head (fingers up, palm out, cupped)
  snakeRest: { u: [.45, -.75, .45], f: [-.35, .75, .55], fingers: [.6, .1, .8], palm: [0, -1, .1], pole: [.5, -.3, -.8], mudra: 'sarpashirsha' },
  snakeRise: { u: [.65, -.3, .7], f: [.35, .45, .82], fingers: [.3, .25, .92], palm: [.2, -.95, .2], pole: [.3, -.6, -.7], mudra: 'sarpashirsha' },
  snakeSway: { u: [.62, 0, .78], f: [.55, .6, .58], fingers: [.6, .4, .7], palm: [-.3, -.9, .3], pole: [.3, -.6, -.7], mudra: 'sarpashirsha' },
  snakeHood: { u: [.75, .2, .6], f: [-.15, .95, .25], fingers: [0, 1, .15], palm: [0, .1, 1], pole: [.4, -.6, -.7], mudra: 'sarpashirsha' },
  // Shiva's deva-hasta: mrigashirsha in the left hand, tripataka in the right, raised either side
  shivaL: { u: [.85, -.35, .4], f: [.15, .95, .25], fingers: [0, 1, .1], palm: [-.1, 0, 1], pole: [.3, -.4, -1], mudra: 'mrigashirsha' },
  shivaR: { u: [.85, -.35, .4], f: [.15, .95, .25], fingers: [0, 1, .1], palm: [-.1, 0, 1], pole: [.3, -.4, -1], mudra: 'tripataka' },
};

export function buildTandava(rig) {
  TURN = 0;
  const c = new Choreography({ beats: 88, bpm: 100, rig, wrap: { hips: { yaw: 360 }, head: { yaw: 360 }, footL: { yaw: 360 }, footR: { yaw: 360 } } });
  const K = (t, spec) => c.key(t, spec);

  // a weighted stamp: shift weight away, lift, strike on the beat
  const stamp = (t, side, x, yaw, { lift = 0.14, prep = 0.5, w = 0.22, z = 0, from = x, quick = false, post = !quick } = {}) => {
    const ch = 'foot' + side;
    const away = side === 'R' ? w : 1 - w;
    K(t - prep, { hips: { w: away } });
    K(t - (quick ? 0.4 : 0.62), { [ch]: {} }); // hold where it stands until the lift begins
    K(t - (quick ? 0.2 : 0.3), { [ch]: foot((from + x) / 2, z, yaw, { lift, pitch: 10 }) });
    K(t, { [ch]: { ...foot(x, z, yaw), ease: 'hit' } });
    if (post) K(t + 0.14, { hips: { w: 0.5 + (away - 0.5) * 0.3 } });
  };

  // ===================================================================== A
  // 0: stillness – head bowed, arms low
  K(0, {
    hips: H(.68, .972, { roll: -3 }), spine: SP(3, 4, 0), head: HD(0, 11, -2),
    footL: foot(.10, 0, 18), footR: foot(-.10, 0, -18),
    armR: A.open, armL: A.open, armR2: A.dLow, armL2: A.fLow,
    fx: { damaru: 0, flame: .3, wind: .08 },
  });
  K(2.5, { head: HD(0, 2, -1), spine: SP(0, 3, 0) });
  K(4, { hips: H(.74, .975, { roll: -2 }), armR2: A.dAloft, armL2: A.fAloft, spine: SP(-3, 0, 0), head: HD(0, -3, 0), fx: { flame: .6, wind: .15 } });
  K(5, { armR: A.abhaya, armL: A.varada });
  // step out into aramandi (left, then right), then sink
  K(4.2, { footL: foot(.10, 0, 18) });
  K(4.7, { footL: foot(.13, .02, 36, { lift: .05, pitch: 8 }) });
  K(5.2, { footL: foot(.14, 0, 52), hips: H(.72, .97) });
  K(5.8, { hips: H(.26, .96), footR: foot(-.10, 0, -18) });
  K(6.3, { footR: foot(-.13, .02, -36, { lift: .05, pitch: 8 }) });
  K(6.8, { footR: foot(-.14, 0, -52), hips: H(.3, .95) });
  K(8, { hips: H(.5, .83), spine: SP(0, 0, 0), head: HD(0, 0, 0), armR: A.side, armL: A.side });

  // ---- nritya, 8–16: one tala cycle in which he shows who he is. The feet hold aramandi and
  // the eyes follow the hands (yato hastas tato drishtih).
  // Ganga descends from the heavens into the jata (right hand)
  K(8.7, { armR: A.gangaHigh, hips: H(.56, .83), spine: SP(-3, -3, -4), head: HD(-18, -16, -4) });
  K(9.2, { armR: A.gangaWave1, head: HD(-13, -12, -3) });
  K(9.65, { armR: A.gangaWave2, head: HD(-7, -8, -2) });
  K(10.1, { armR: A.gangaCrown, spine: SP(0, -2, -2), head: HD(-2, -3, -5) });
  K(10.5, { armR: A.gangaCrown, armL: A.side }); // the idle arm holds until its own gesture
  // the crescent moon in the hair (left hand); the right hand comes away
  K(11, { armL: A.moon, armR: A.side, hips: H(.46, .83), spine: SP(0, 3, 3), head: HD(4, 0, 8) });
  K(11.8, { armL: A.moon, head: HD(4, 0, 7) });
  // Vasuki: the serpent rises from the left shoulder, sways, and raises its hood
  K(12.2, { armL: A.snakeRest, spine: SP(2, 2, 6), head: HD(16, 6, 0) });
  K(12.7, { armL: A.snakeRise, head: HD(22, 1, 2) });
  K(13.2, { armL: A.snakeSway, head: HD(26, -3, 0) });
  K(13.7, { armL: A.snakeHood, armR: A.side, spine: SP(0, 3, 6), head: HD(24, -7, 4) });
  // Shiva's sign: mrigashirsha (left) with tripataka (right), gazing out
  K(14.4, { armL: A.shivaL, armR: A.shivaR, hips: H(.5, .83), spine: SP(-3, 0, 0), head: HD(0, -2, 0) });
  K(16.4, { armL: A.shivaL, armR: A.shivaR, spine: SP(-3, 0, 0), head: HD(0, -1, 0) });

  // transfer onto the right leg and raise the left into the Nataraja pose
  K(17, { hips: H(.94, .86), footL: foot(.14, 0, 52), spine: SP(0, -3, 0) });
  K(18, { footL: foot(.24, .16, 20, { lift: .26, pitch: 28, pole: [1, .5, .5] }), hips: H(1, .89, { dx: .02, roll: 3 }) });
  K(19.4, {
    footL: { ...foot(-.2, .33, -78, { lift: .6, pitch: 38, pole: [1, .7, .15] }), ease: 'stop' },
    hips: H(1, .9, { dx: .03, roll: 5, yaw: 5 }), spine: SP(-2, -4, -6), head: HD(0, 0, 3),
    armR: A.abhaya, armL: A.gaja, armR2: A.dAloft, armL2: A.fAloft,
  });
  K(19.8, { fx: { damaru: 0 } });
  K(20.2, { fx: { damaru: .9 } });
  K(21.2, { fx: { damaru: .9 } });
  K(21.6, { fx: { damaru: 0 }, hips: H(1, .91, { dx: .03, roll: 5, yaw: 5 }), footL: foot(-.2, .33, -78, { lift: .61, pitch: 38, pole: [1, .7, .15] }), spine: SP(-2, -4, -6), armR: A.abhaya, armL: A.gaja });
  // the raised leg opens out to the left and drives down: first great stamp
  K(22.8, {
    footL: foot(.52, .06, 40, { lift: .4, pitch: 35, pole: [.5, 1, .3] }),
    hips: H(1, .93, { dx: .02, roll: 6 }), spine: SP(-2, -9, 0), head: HD(14, -2, 0),
    armL: A.sideUp, armR: A.side, armR2: A.dHigh, armL2: A.fHigh,
  });
  K(24, {
    footL: { ...foot(.4, 0, 50), ease: 'hit' },
    hips: H(.66, .8), spine: SP(4, 2, 0), head: HD(0, 2, 0),
    armL: A.press, armR: A.press, armR2: A.dOut, armL2: A.fOut, fx: { flame: .8, wind: .4 },
  });

  // ===================================================================== B1  stamps in the wide stance
  K(24.35, { hips: H(.55, .74) });
  K(25, { armR: A.chest, armL: A.side, armR2: A.dAloft, armL2: A.fAloft, spine: SP(0, 5, 4) });
  stamp(26, 'R', -.4, -50, { from: -.14, lift: .16, prep: 1.2 });
  K(26, { hips: { y: .74 }, armR: A.press, armL: A.chest, spine: SP(5, -8, -6), head: HD(-18, 3, -5), fx: { damaru: .7 } });
  K(26.5, { fx: { damaru: 0 } });
  stamp(28, 'L', .4, 50, { lift: .16, prep: 1.3 });
  K(28, { armL: A.press, armR: A.chest, spine: SP(5, 8, 6), head: HD(18, 3, 5), fx: { damaru: .7 } });
  K(28.5, { fx: { damaru: 0 } });
  stamp(29, 'R', -.4, -50);
  K(29, { armR: A.high, armL: A.side, spine: SP(0, -7, -8), head: HD(-22, -6, -4), armR2: A.dHigh });
  stamp(30, 'L', .4, 50, { post: false });
  K(30, { armL: A.high, armR: A.side, spine: SP(0, 7, 8), head: HD(22, -6, 4), armL2: A.fHigh, armR2: A.dAloft, fx: { damaru: .6 } });
  stamp(30.5, 'R', -.5, -55, { from: -.4, lift: .08, prep: .32, quick: true, w: .3 });
  stamp(31, 'L', .5, 55, { from: .4, lift: .08, prep: .32, quick: true, w: .3 });
  K(31, { fx: { damaru: 0 }, armL2: A.fAloft });
  K(32, { hips: H(.5, .66), spine: SP(12, 0, 0), head: HD(0, 2, 0), armL: A.low, armR: A.low });

  // ===================================================================== B2  lunges – long diagonal lines
  K(33.6, {
    hips: H(.82, .72, { yaw: -18 }), spine: SP(5, -10, -12), head: HD(-42, -6, 0),
    armR: A.high, armL: A.low, armR2: A.dHigh, armL2: A.fOut,
  });
  K(34.6, { hips: H(.84, .7, { yaw: -20 }), spine: SP(6, -12, -14), head: HD(-44, -8, 0) });
  K(35.6, { hips: H(.5, .64), spine: SP(10, 0, 0), head: HD(0, 2, 0), armR: A.lowFwd, armL: A.lowFwd, armR2: A.dAloft, armL2: A.fAloft });
  K(36.7, {
    hips: H(.18, .72, { yaw: 18 }), spine: SP(5, 10, 12), head: HD(42, -6, 0),
    armL: A.high, armR: A.low, armL2: A.fHigh, armR2: A.dOut,
  });
  K(37.6, { hips: H(.16, .7, { yaw: 20 }), spine: SP(6, 12, 14), head: HD(44, -8, 0) });
  // gather the feet back under the body
  K(37.7, { footR: foot(-.5, 0, -55) });
  K(38.05, { footR: foot(-.32, .03, -55, { lift: .1, pitch: 12 }) });
  K(38.45, { footR: foot(-.13, 0, -55) });
  K(38.5, { hips: H(.3, .8, { yaw: 6 }), spine: SP(2, 3, 4), armL: A.side, armR: A.side, armL2: A.fAloft, armR2: A.dAloft, head: HD(10, 0, 0) });
  K(39.1, { hips: H(.88, .86), footL: foot(.5, 0, 55) });
  K(39.6, { footL: foot(.3, .03, 55, { lift: .16, pitch: 12 }) });
  K(40, { footL: { ...foot(.13, 0, 55), ease: 'hit' }, hips: H(.6, .82), spine: SP(0, 0, 0), head: HD(0, 0, 0), armL: A.chest, armR: A.chest });

  // ===================================================================== B3  urdhva-janu: knee lifts and stamps
  K(40.4, { hips: H(.06, .84), footR: foot(-.13, 0, -55) });
  K(41, {
    footR: foot(-.17, .3, -8, { lift: .5, pitch: 42, pole: [-.3, .5, 1] }),
    hips: H(0, .93, { dx: -.02, roll: -3 }), spine: SP(-3, 5, 8), head: HD(-10, -5, 0),
    armR: A.over, armL: A.chest, armR2: A.dHigh,
  });
  K(42, {
    footR: { ...foot(-.13, 0, -55), ease: 'hit' }, hips: H(.42, .8), spine: SP(5, -4, -5), head: HD(-6, 3, 0),
    armR: A.press, armL: A.side, armR2: A.dAloft, fx: { damaru: .6 },
  });
  K(42.4, { hips: H(.94, .84), footL: foot(.13, 0, 55), fx: { damaru: 0 } });
  K(43, {
    footL: foot(.17, .3, 8, { lift: .5, pitch: 42, pole: [.3, .5, 1] }),
    hips: H(1, .93, { dx: .02, roll: 3 }), spine: SP(-3, -5, -8), head: HD(10, -5, 0),
    armL: A.over, armR: A.chest, armL2: A.fHigh,
  });
  K(44, {
    footL: { ...foot(.13, 0, 55), ease: 'hit' }, hips: H(.58, .8), spine: SP(5, 4, 5), head: HD(6, 3, 0),
    armL: A.press, armR: A.side, armL2: A.fAloft, fx: { damaru: .6 },
  });
  stamp(44.5, 'R', -.13, -55, { lift: .08, prep: .3, quick: true, w: .28 });
  stamp(45, 'L', .13, 55, { lift: .08, prep: .3, quick: true, w: .28 });
  stamp(45.5, 'R', -.13, -55, { lift: .08, prep: .3, quick: true, w: .28 });
  K(45.5, { armL: A.chest, armR: A.chest, spine: SP(2, 0, 0), head: HD(0, 0, 0), fx: { damaru: 0 }, hips: { y: .82 } });
  // snap into the Nataraja pose
  K(45.9, { hips: H(.95, .84), footL: foot(.13, 0, 55) });
  K(46.4, { footL: foot(.24, .18, 10, { lift: .3, pitch: 30, pole: [1, .6, .4] }) });
  K(47, {
    footL: { ...foot(-.2, .33, -78, { lift: .6, pitch: 38, pole: [1, .7, .15] }), ease: 'stop' },
    hips: H(1, .9, { dx: .03, roll: 5, yaw: 5 }), spine: SP(-2, -4, -6), head: HD(0, 0, 3),
    armR: A.abhaya, armL: A.gaja, armR2: A.dAloft, armL2: A.fAloft, fx: { damaru: .9 },
  });
  K(48.2, { footL: foot(-.2, .33, -78, { lift: .61, pitch: 38, pole: [1, .7, .15] }), hips: H(1, .91, { dx: .03, roll: 5, yaw: 5 }), spine: SP(-2, -4, -6), armR: A.abhaya, armL: A.gaja, fx: { damaru: 0 } });

  // ===================================================================== B4  rechaka: the torso draws a great circle
  K(48.75, { footL: foot(.5, .05, 40, { lift: .36, pitch: 35, pole: [.5, 1, .3] }), hips: H(1, .92, { roll: 6 }), spine: SP(-2, -8, 0) });
  K(49.2, { footL: { ...foot(.45, 0, 50), ease: 'hit' }, hips: H(.7, .78), spine: SP(4, 0, 0), armL: A.side, armR2: A.dOut, armL2: A.fOut });
  stamp(50, 'R', -.45, -50, { from: -.13, lift: .14, prep: .6 });
  K(50, { hips: { y: .72 }, spine: SP(2, 0, 0), head: HD(0, 0, 0), armR: A.side, armL: A.side });
  K(51, { hips: H(.5, .7, { pitch: 8 }), spine: SP(22, 0, 0), head: HD(0, 12, 0), armR: A.lowFwd, armL: A.lowFwd, armR2: A.dLow, armL2: A.fLow, fx: { wind: .6 } });
  K(52, { hips: H(.26, .72, { pitch: 3, roll: -3 }), spine: SP(8, 17, 10), head: HD(24, 2, 10), armL: A.sideUp, armR: A.chest, armL2: A.fOut, armR2: A.dAloft });
  K(53, { hips: H(.5, .76, { pitch: -4 }), spine: SP(-12, 0, 0), head: HD(0, -14, 0), armL: A.sideUp, armR: A.sideUp, armR2: A.dHigh, armL2: A.fHigh });
  K(54, { hips: H(.74, .72, { pitch: 3, roll: 3 }), spine: SP(8, -17, -10), head: HD(-24, 2, -10), armR: A.sideUp, armL: A.chest, armR2: A.dOut, armL2: A.fAloft });
  K(55, { hips: H(.5, .7, { pitch: 7 }), spine: SP(18, 0, 0), head: HD(0, 8, 0), armR: A.lowFwd, armL: A.lowFwd, armR2: A.dAloft });
  K(56, { hips: H(.5, .76), spine: SP(2, 0, 0), head: HD(0, 0, 0), armR: A.side, armL: A.side });

  // ===================================================================== B5  the build: stamps double in speed, arms rise
  const sway = (t, dir, k) => K(t, { spine: SP(3 + k * 4, dir * 5, dir * 4), head: HD(dir * 8, 0, dir * 3) });
  stamp(57, 'R', -.38, -52, { from: -.45, lift: .15 }); sway(57, -1, 0);
  stamp(58, 'L', .38, 52, { from: .45, lift: .15 }); sway(58, 1, 0);
  stamp(59, 'R', -.38, -52, { lift: .15 }); sway(59, -1, .3);
  stamp(60, 'L', .38, 52, { lift: .15, post: false }); sway(60, 1, .3);
  K(58, { armR: A.sideUp, armL: A.sideUp, fx: { damaru: .3, wind: .5 } });
  K(60, { armR: A.high, armL: A.high, armR2: A.dHigh, armL2: A.fHigh, fx: { damaru: .8, flame: .9 }, hips: { y: .74 } });
  for (let i = 0; i < 4; i++) {
    const t = 60.5 + i * 0.5, R = i % 2 === 0;
    stamp(t, R ? 'R' : 'L', R ? -.38 : .38, R ? -52 : 52, { lift: .085, prep: .3, quick: true, w: .3 });
    sway(t, R ? -1 : 1, .6);
  }
  K(62, { armR: A.over, armL: A.over, hips: { y: .7 }, fx: { damaru: 1, wind: .7 } });
  // wind-up: coil against the turn
  K(63.05, {
    hips: H(.6, .68, { yaw: -24 }), spine: SP(10, 0, -22), head: HD(0, 4, 0),
    armR: A.chest, armL: A.chest, armR2: A.dLow, armL2: A.fLow, fx: { damaru: 0 },
  });

  // ===================================================================== C  spin – three-fold phrase – landing on sam
  K(63.5, { hips: H(1, .8, { yaw: -18 }), footL: foot(.38, 0, 52), footR: foot(-.38, 0, -52) });
  // the right foot now turns on its ball: author the ball point so it stays put while the heel swings round
  const tb = rig.feet.R.toBall, a0 = -52 * Math.PI / 180;
  const bx = -.38 + tb.x * Math.cos(a0) + tb.z * Math.sin(a0), bz = -tb.x * Math.sin(a0) + tb.z * Math.cos(a0);
  const spinFoot = (yaw, pitch) => foot(bx, bz, yaw, { pitch, pivot: 1 });
  K(63.75, { footR: spinFoot(-52, 14) });
  // kunchita bhramari: the left leg folds with the knee opened right out to the side and the foot
  // drawn up, flexed rather than pointed, to the standing knee, which stays softly bent (authored in the hips frame so it
  // travels with the turn)
  const fold = (lift) => foot(-.02, .05, 40, { lift, pitch: 22, pole: [1, .3, .08], rel: 1 });
  K(64.15, {
    footL: fold(.42),
    footR: spinFoot(-30, 24),
    hips: H(1, .9, { yaw: 22 }), spine: SP(-2, 0, 10), head: HD(0, 0, 0),
    armR: A.side, armL: A.side, armR2: A.dOut, armL2: A.fOut, fx: { wind: 1, flame: 1 },
  });
  K(64.65, { hips: H(1, .9, { yaw: 105 }), footR: spinFoot(55, 24) });
  K(64.95, { head: HD(0, 0, 0) });
  K(65.15, { hips: H(1, .9, { yaw: 195 }), footR: spinFoot(145, 24), spine: SP(-2, 0, 6) });
  K(65.5, { head: HD(360, 0, 0) });
  K(65.65, { hips: H(1, .9, { yaw: 285 }), footR: spinFoot(235, 24) });
  K(66.05, { footL: fold(.4) });
  K(66.15, { hips: H(1, .88, { yaw: 352 }), footR: spinFoot(300, 18), spine: SP(0, 0, 0) });
  K(66.35, { footR: spinFoot(308, 6) });
  TURN = 360;

  // Three-fold phrase (tihai / teermanam): "ta ka - DHIM" three times, accents on 68, 70 and 72,
  // i.e. on the claps of beats 5 and 7 and then on sam. The spin's landing is the first "ta"; the
  // phrases mirror side to side; the third "DHIM" is the leap's landing.
  const ta = (t, side, from) => stamp(t, side, side === 'R' ? -.38 : -.02, side === 'R' ? -52 : 52, { lift: .09, prep: .3, quick: true, w: .3, from });
  const dhim = (t, side) => stamp(t, side, side === 'R' ? -.38 : -.02, side === 'R' ? -52 : 52, { lift: .18, prep: .5, w: .2, post: false });
  const gather = (t) => K(t, { hips: { y: .74 }, spine: SP(4, 0, 0), head: HD(0, 2, 0), armR: A.chest, armL: A.chest, armR2: A.dAloft, armL2: A.fAloft });
  // phrase 1 (accent left): the foot comes down out of the passe, then strikes as lightly as the other "ta"s
  K(66.32, { footL: foot(-.02, 0, 52, { lift: .09, pitch: 10 }) });
  K(66.5, { footL: { ...foot(-.02, 0, 52), ease: 'hit' }, hips: H(.6, .8) });
  ta(67, 'R', bx); gather(67); // the right foot steps off its pivot point
  dhim(68, 'L');
  K(68, { hips: { y: .72 }, spine: SP(0, 7, 8), head: HD(22, -6, 4), armL: A.high, armR: A.side, armL2: A.fHigh, armR2: A.dOut });
  // phrase 2 (accent right)
  ta(68.5, 'R'); ta(69, 'L'); gather(69);
  dhim(70, 'R');
  K(70, { hips: { y: .72 }, spine: SP(0, -7, -8), head: HD(-22, -6, -4), armR: A.high, armL: A.side, armR2: A.dHigh, armL2: A.fOut });
  // phrase 3: the second stroke drives down into the crouch, the accent is the landing
  ta(70.5, 'L'); ta(71, 'R');
  K(70.85, { armR: A.low, armL: A.low, armR2: A.dLow, armL2: A.fLow }); // backswing starts on the "ta"
  K(71.08, { hips: H(.5, .66), spine: SP(16, 0, 0), head: HD(0, 4, 0) });
  K(71.12, { footL: foot(-.02, 0, 52), footR: foot(-.38, 0, -52) });
  K(71.32, { hips: H(.5, .98), footL: foot(-.02, 0, 52, { pitch: 38 }), footR: foot(-.38, 0, -52, { pitch: 38 }), spine: SP(0, 0, 0) });
  K(71.3, { armR: A.fwd, armL: A.fwd });
  // flight
  K(71.66, {
    hips: H(.5, 1.25), footL: foot(.2, 0, 48, { lift: .44, pitch: 30 }), footR: foot(-.44, 0, -48, { lift: .44, pitch: 30 }),
    spine: SP(-6, 0, 0), head: HD(0, -6, 0), armR: A.over, armL: A.over, armR2: A.dOut, armL2: A.fOut,
  });
  // landing: the cosmic stamp, on sam
  K(72, {
    hips: H(.5, .87), footL: { ...foot(.45, 0, 50), ease: 'hit' }, footR: { ...foot(-.45, 0, -50), ease: 'hit' },
    spine: SP(2, 0, 0), armR: A.side, armL: A.side,
  });
  K(72.32, { hips: H(.5, .62), spine: SP(12, 0, 0), head: HD(0, 4, 0), armR: A.press, armL: A.press, armR2: A.dOut, armL2: A.fOut, fx: { damaru: 0 } });
  K(72.6, { fx: { damaru: 1 } });
  K(73.6, { hips: H(.5, .72), spine: SP(-2, 0, 0), head: HD(0, -6, 0) });
  K(74.6, { fx: { damaru: 1 } });
  K(75, { hips: H(.5, .75), spine: SP(-5, 0, 0), head: HD(0, -9, 0), armR: A.sideUp, armL: A.sideUp, armR2: A.dHigh, armL2: A.fHigh, fx: { damaru: 0, wind: .6 } });
  // afterglow sway
  K(76.2, { hips: H(.72, .74), spine: SP(0, -9, -5), head: HD(-14, -3, -5), armR: A.high, armL: A.side });
  K(77.5, { hips: H(.28, .74), spine: SP(0, 9, 5), head: HD(14, -3, 5), armL: A.high, armR: A.side, armR2: A.dAloft, armL2: A.fAloft });
  K(78.5, { hips: H(.5, .78), spine: SP(0, 0, 0), head: HD(0, 0, 0), armL: A.sideUp, armR: A.sideUp, fx: { flame: .7, wind: .3 } });

  // ===================================================================== D  return
  K(79.1, { hips: H(.84, .79), footL: foot(.45, 0, 50) });
  K(79.7, { footL: foot(.28, .03, 30, { lift: .09, pitch: 12 }) });
  K(80.3, { footL: foot(.10, 0, 18), hips: H(.86, .9) });
  K(81, { hips: H(.16, .86), footR: foot(-.45, 0, -50) });
  K(81.6, { footR: foot(-.28, .03, -30, { lift: .09, pitch: 12 }) });
  K(82.2, { footR: foot(-.10, 0, -18), hips: H(.2, .95) });
  K(82.8, { armR: A.over, armL: A.over, spine: SP(-4, 0, 0), head: HD(0, -8, 0) });
  K(83.7, { hips: H(.5, .975) });
  K(85.5, { armR: A.chest, armL: A.chest, spine: SP(0, 0, 0), head: HD(0, 2, 0), armR2: A.dAloft, armL2: A.fAloft });
  K(87.2, { armR: A.open, armL: A.open, armR2: A.dLow, armL2: A.fLow, hips: H(.68, .972, { roll: -3 }), spine: SP(3, 4, 0), head: HD(0, 9, -2), fx: { flame: .3, wind: .08, damaru: 0 } });

  c.intensityKeys = [[0, .12], [8, .28], [16, .32], [20, .4], [24, .6], [32, .62], [40, .7], [48, .72], [56, .8], [63, .86], [66.5, .9], [70, .95], [72, 1], [75, .95], [78.5, .6], [84, .3], [88, .12]];
  c.phases = [[0, 'A'], [24, 'B'], [63, 'C'], [78.5, 'D']];
  c.landingBeat = 72; // sam of the tenth Adi tala cycle
  c.poseBeat = 19.4; // first arrival in the Nataraja pose (held to 21.6)
  return c.finalize();
}
