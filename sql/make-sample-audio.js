// Generates the two placeholder tracks for the sample song (48 s, 8 kHz mono 8-bit WAV, ~380 KB each):
//   yoru-no-eki.wav        karaoke (no vocals): the backing loop
//   yoru-no-eki-vocal.wav  training (with vocals): backing + a lead "voice" tone on every lyric word
// Run: node sql/make-sample-audio.js   Replace with real <=64 kbps MP3/Opus recordings later.
const fs = require('fs');
const dir = __dirname + '/../api/uploads/sample/';
const lyrics = JSON.parse(fs.readFileSync(dir + 'yoru-no-eki.json', 'utf8'));
const RATE = 8000, SECS = 48;
const notes = [220, 262, 294, 330, 294, 262, 247, 220]; // gentle A-minor loop, one note per beat
const scale = [440, 494, 523, 587, 659, 587, 523, 494];

// word timings, same rule as the app: spread evenly unless a word has its own start
const words = lyrics.lines.flatMap((l) => {
  const step = (l.end - l.start) / l.words.length;
  return l.words.map((w, i) => ({ start: w.start ?? l.start + i * step, end: l.start + (i + 1) * step, f: scale[(l.line + i) % scale.length] }));
});

function track(withVocal) {
  const data = Buffer.alloc(RATE * SECS);
  let wi = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE, beat = Math.floor(t * 2), inBeat = (t * 2) % 1;
    const f = notes[beat % notes.length];
    let s = Math.exp(-3 * inBeat) * 0.5 * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t));
    if (withVocal) {
      while (wi < words.length - 1 && t >= words[wi].end) wi++;
      const w = words[wi];
      if (t >= w.start && t < w.end) {
        const k = (t - w.start) / (w.end - w.start), env = Math.min(1, k * 10) * Math.min(1, (1 - k) * 6);
        s = s * 0.6 + 0.4 * env * Math.sin(2 * Math.PI * w.f * t + 0.004 * Math.sin(2 * Math.PI * 5.5 * t) * w.f);
      }
    }
    data[i] = 128 + Math.round(Math.max(-1, Math.min(1, s)) * 90);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
fs.writeFileSync(dir + 'yoru-no-eki.wav', track(false));
fs.writeFileSync(dir + 'yoru-no-eki-vocal.wav', track(true));
