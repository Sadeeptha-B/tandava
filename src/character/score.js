// ---------------------------------------------------------------------------
// The spoken rhythm (sollukattu) of the dance, on the same beat timeline as the
// choreography (tandava.js): 88 beats of Adi tala, sam on 0, 8, 16 ... 80.
//
// In the jathi passages (24–72) the mridangam plays these syllables and the
// nattuvangam cymbals strike with them. Every foot strike in the choreography
// falls on a syllable; not every syllable is a strike (the drum and cymbals also
// accent body arrivals such as the lunges and the Nataraja pose, and fill rests).
// Elsewhere (the awakening, storytelling, Nataraja pose and return) the drum plays
// a gentle theka and the cymbals keep the tala's claps.
//
// Notation: one token per half beat, '|' marks the beat (ignored). A capitalised
// syllable is an accent, '-' a rest (karvai), a leading '.' a soft drum fill
// (no cymbal).
// ---------------------------------------------------------------------------

const JATHIS = [
  // B1 24–32: stamps in the wide stance, closing with "tha ka dhi" into the sink
  [24, 'THAM - | .ki .ta | tha - | .ki .ta | thai - | tha - | thai tha | ka dhi'],
  // B2 32–40: the lunges ("DHIT", body accents), the gathering step and the stamp on sam
  [32, 'THOM - | .dhi - | DHIT - | - .ki | tham - | DHIT - | - ta | .ki .ta'],
  // B3 40–48: knee lifts ("tha") and stamps ("THAI"), quick footwork, then the Nataraja pose on sam
  [40, 'THOM - | tha - | THAI - | tha - | THAI tha | ka dhi | mi tha | - -'],
  // B4 48–56: the pose, two stamps, the torso circle, a stamp on sam
  [48, 'DHIM - | - .ki | tha - | thai - | dhi - | thom - | nam - | thom .ta'],
  // B5 56–64: the build, doubling into "tha ka dhi mi"
  [56, 'THAM - | tha - | thai - | tha - | thai tha | ka dhi | mi - | .ki .ta'],
  // C 64–72: the spin, then the tihai "ta ka - DHIM" x3, the last DHIM the leap's landing on sam
  [64, 'DHIM - | .dhi .ki | .ta ta | ka - | DHIM ta | ka - | DHIM ta | ka - | DHIM'],
];

// gentle Adi tala theka for the non-jathi passages (16 half beats)
const THEKA = 'thom - | .ki .ta | dhi - | .ta - | thom - | nam - | dhi .ki | .ta -';

// spans (beats) in which the drum plays the theka and the cymbals keep the tala's claps
const TALA_SPANS = [[4, 24], [72.5, 86]];

const tokens = (text) => text.split(/\s+/).filter((t) => t && t !== '|');

function parse(at, text) {
  const out = [];
  tokens(text).forEach((t, i) => {
    if (t === '-') return;
    const filler = t.startsWith('.');
    const syl = filler ? t.slice(1) : t;
    const accent = !filler && syl !== syl.toLowerCase();
    out.push({ b: at + i * 0.5, syl: syl.toLowerCase(), accent, filler });
  });
  return out;
}

export function buildScore() {
  const events = JATHIS.flatMap(([at, text]) => parse(at, text)).sort((a, b) => a.b - b.b);
  for (let i = 1; i < events.length; i++) if (events[i].b === events[i - 1].b) throw new Error(`score: two syllables on beat ${events[i].b}`);
  const theka = tokens(THEKA).map((t) => (t === '-' ? null : { syl: t.replace('.', '').toLowerCase(), filler: t.startsWith('.') }));
  if (theka.length !== 16) throw new Error('score: the theka must be 16 half beats');
  return { events, theka, talaSpans: TALA_SPANS };
}
