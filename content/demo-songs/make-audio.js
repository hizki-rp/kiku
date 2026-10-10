// Renders the demo songs' audio from their lyrics JSON, so music and lyrics line up exactly.
//   <name>.wav        karaoke: drums, bass, power chords (anime-opening style, 150 bpm)
//   <name>-vocal.wav  training: the same plus a lead "voice" playing a note on every lyric word
// Run: node content/demo-songs/make-audio.js     (22.05 kHz, 16-bit mono, ~2 MB per track)
const fs = require('fs');
const RATE = 22050, SECS = 46, BPM = 150, BEAT = 60 / BPM;
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

const SONGS = {
  'yoake-no-yaiba': { chords: [45, 41, 48, 43], scale: [69, 72, 74, 76, 79, 81], seed: 3 },   // Am F C G, A minor pentatonic
  'aoi-honoo':      { chords: [40, 48, 43, 50], scale: [64, 67, 69, 71, 74, 76], seed: 7 },   // Em C G D, E minor pentatonic
};

let noiseState = 1;
const noise = () => ((noiseState = (noiseState * 16807) % 2147483647) / 2147483647) * 2 - 1;

function render(name, cfg, withVocal) {
  const lyrics = JSON.parse(fs.readFileSync(`${__dirname}/${name}.json`, 'utf8'));
  const words = lyrics.lines.flatMap((l, li) => {
    const step = (l.end - l.start) / l.words.length;
    const chorus = li >= 4;
    return l.words.map((w, wi) => ({
      start: l.start + wi * step, end: l.start + (wi + 1) * step - 0.03,
      midi: cfg.scale[(li * cfg.seed + wi * 2 + (wi % 2)) % cfg.scale.length] + (chorus ? 2 : 0) + (wi === l.words.length - 1 ? -5 : 0),
    }));
  });
  const out = new Int16Array(RATE * SECS);
  let lp = 0, wi = 0;
  noiseState = 1;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const beat = t / BEAT, b = Math.floor(beat), inBeat = beat - b, eighth = (beat * 2) % 1;
    const bar = Math.floor(b / 4), chorus = t >= 23.2 && t < 42, playing = t >= 2.4 && t < 43.2, intro = t < 2.4;
    const root = cfg.chords[bar % 4];
    let s = 0;
    // drums
    if (playing || (intro && b >= 2)) {
      const kickHit = b % 2 === 0 || (chorus && b % 4 === 3 && inBeat > 0.5);
      const kt = kickHit ? (b % 2 === 0 ? inBeat : inBeat - 0.5) * BEAT : 9;
      if (kt >= 0 && kt < 0.25) s += 0.9 * Math.exp(-kt * 18) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-kt * 30)) * kt);
      if (b % 2 === 1) { const st = inBeat * BEAT; s += 0.45 * Math.exp(-st * 22) * noise() + 0.2 * Math.exp(-st * 30) * Math.sin(2 * Math.PI * 190 * st); }
      if (intro) { const ft = (beat * 4 % 1) * BEAT / 4; s += 0.35 * Math.exp(-ft * 40) * noise(); }   // snare roll into the song
      const ht = eighth * BEAT / 2; s += 0.12 * Math.exp(-ht * 90) * noise();                           // hi-hat on eighths
    }
    if (playing) {
      // bass: driving eighths on the chord root
      const bt = eighth * BEAT / 2, bf = hz(root - 12);
      s += 0.35 * Math.min(1, bt * 200) * Math.exp(-bt * 4) * (Math.sin(2 * Math.PI * bf * t) + 0.3 * Math.sin(2 * Math.PI * bf * 3 * t));
      // power chord (root + fifth + octave), palm-muted in verses, open and ringing in the chorus
      const gEnv = chorus ? 0.9 : Math.exp(-bt * 7);
      let g = 0;
      for (const m of [root, root + 7, root + 12]) g += 2 * ((hz(m) * t) % 1) - 1;
      g = Math.tanh(g * 1.8) * 0.32 * gEnv;
      lp += 0.18 * (g - lp);                                                                             // soften the fizz
      s += lp;
    }
    if (t >= 43.2) { const rt = t - 43.2; let g = 0; for (const m of [root, root + 7, root + 12]) g += Math.sin(2 * Math.PI * hz(m) * t); s += 0.25 * Math.exp(-rt * 0.9) * g; }
    // lead "voice" on each lyric word
    if (withVocal) {
      while (wi < words.length - 1 && t >= words[wi].end) wi++;
      const w = words[wi];
      if (t >= w.start && t < w.end) {
        const k = (t - w.start) / (w.end - w.start), env = Math.min(1, k * 12) * Math.min(1, (1 - k) * 8);
        const f = hz(w.midi) * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t));
        s += 0.32 * env * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) + 0.1 * Math.sin(6 * Math.PI * f * t));
      }
    }
    out[i] = Math.round(Math.max(-1, Math.min(1, s * 0.7)) * 32000);
  }
  const data = Buffer.from(out.buffer);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(`${__dirname}/${name}${withVocal ? '-vocal' : ''}.wav`, Buffer.concat([h, data]));
}

for (const [name, cfg] of Object.entries(SONGS)) { render(name, cfg, false); render(name, cfg, true); }
console.log('rendered', Object.keys(SONGS).length * 2, 'tracks');
