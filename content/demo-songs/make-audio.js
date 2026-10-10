// Builds the demo songs' audio + timings from their lyrics:
//   1. speak-lines.ps1 voices every line in Japanese (Microsoft Haruka) and reports when each word starts
//   2. the backing track is synthesised on the same timeline
//   3. <name>.wav        karaoke: music only
//      <name>-vocal.wav  learning: the voice over the music (music dips while she speaks)
//      <name>.json       lyrics rewritten with each word's real start, so the highlight follows the voice
// Run on Windows (needs a ja-JP voice):  node content/demo-songs/make-audio.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RATE = 22050;
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const SONGS = [
  { name: 'yoake-no-yaiba', dir: __dirname, style: 'rock', bpm: 150, chords: [45, 41, 48, 43] },                                  // Am F C G
  { name: 'aoi-honoo', dir: __dirname, style: 'rock', bpm: 150, chords: [40, 48, 43, 50] },                                       // Em C G D
  { name: 'yoru-no-eki', dir: path.join(__dirname, '../../api/uploads/sample'), style: 'ballad', bpm: 84, chords: [45, 41, 48, 43] },
];

let seed = 1;
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function readWav(file) {   // 16-bit mono PCM -> Float32 samples
  const b = fs.readFileSync(file);
  let p = 12;
  while (b.toString('ascii', p, p + 4) !== 'data') p += 8 + b.readUInt32LE(p + 4);
  const n = b.readUInt32LE(p + 4) / 2, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(p + 8 + i * 2) / 32768;
  return out;
}
function writeWav(file, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

// Speak every line; returns per-line { wav: Float32Array, words: [seconds...] }.
function speak(song) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tomoshibi-tts-'));
  const input = JSON.parse(JSON.stringify(song));
  for (const l of input.lines) for (const w of l.words) {
    if (w.t === 'は' && w.romaji === 'wa') w.say = 'わ';   // particles are read by sound
    if (w.t === 'へ' && w.romaji === 'e') w.say = 'え';
    if (w.t === 'を') w.say = 'お';
  }
  fs.writeFileSync(path.join(tmp, 'in.json'), JSON.stringify(input));
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'speak-lines.ps1'),
    '-Lyrics', path.join(tmp, 'in.json'), '-OutDir', tmp], { stdio: 'inherit' });
  const timings = JSON.parse(fs.readFileSync(path.join(tmp, 'timings.json'), 'utf8').replace(/^﻿/, ''));
  const res = timings.map((t) => ({ wav: readWav(path.join(tmp, `line-${t.line}.wav`)), words: t.words.map((ms) => ms / 1000) }));
  fs.rmSync(tmp, { recursive: true, force: true });
  return res;
}

function backing(cfg, secs, lastEnd, chorusFrom) {
  const out = new Float32Array(Math.round(RATE * secs));
  const BEAT = 60 / cfg.bpm, rock = cfg.style === 'rock';
  let lp = 0;
  seed = 1;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE, beat = t / BEAT, b = Math.floor(beat), inBeat = beat - b, eighth = (beat * 2) % 1;
    const root = cfg.chords[Math.floor(b / 4) % 4];
    const intro = t < 2.4, playing = t >= 2.4 && t < lastEnd + 1, chorus = rock && t >= chorusFrom && t < lastEnd;
    let s = 0;
    if (playing || (intro && b >= 2)) {   // drums (lighter for the ballad)
      const k = rock ? 0.9 : 0.5;
      const kickHit = b % 2 === 0 || (chorus && b % 4 === 3 && inBeat > 0.5);
      const kt = kickHit ? (b % 2 === 0 ? inBeat : inBeat - 0.5) * BEAT : 9;
      if (kt >= 0 && kt < 0.25) s += k * Math.exp(-kt * 18) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-kt * 30)) * kt);
      if (b % 2 === 1) { const st = inBeat * BEAT; s += (rock ? 0.45 : 0.18) * Math.exp(-st * 22) * noise(); }
      if (intro && rock) { const ft = ((beat * 4) % 1) * BEAT / 4; s += 0.35 * Math.exp(-ft * 40) * noise(); }
      const ht = (rock ? eighth : inBeat) * BEAT / (rock ? 2 : 1); s += (rock ? 0.12 : 0.06) * Math.exp(-ht * 90) * noise();
    }
    if (playing) {
      const bt = (rock ? eighth * BEAT / 2 : inBeat * BEAT), bf = hz(root - 12);
      s += (rock ? 0.35 : 0.3) * Math.min(1, bt * 200) * Math.exp(-bt * (rock ? 4 : 1.5)) * (Math.sin(2 * Math.PI * bf * t) + 0.3 * Math.sin(2 * Math.PI * bf * 3 * t));
      let g = 0;
      if (rock) {   // distorted power chord, palm-muted in verses, ringing in the chorus
        for (const m of [root, root + 7, root + 12]) g += 2 * ((hz(m) * t) % 1) - 1;
        g = Math.tanh(g * 1.8) * 0.32 * (chorus ? 0.9 : Math.exp(-bt * 7));
      } else {      // soft electric-piano chord
        for (const m of [root + 12, root + 15 + (root % 2 ? 1 : 0), root + 19]) g += Math.sin(2 * Math.PI * hz(m) * t);
        g *= 0.09 * (0.6 + 0.4 * Math.exp(-((b % 4) + inBeat) * BEAT * 0.8));
      }
      lp += 0.18 * (g - lp);
      s += lp;
    }
    const outroAt = lastEnd + 1;
    if (t >= outroAt) { const rt = t - outroAt; let g = 0; for (const m of [root, root + 7, root + 12]) g += Math.sin(2 * Math.PI * hz(m) * t); s += 0.22 * Math.exp(-rt * 0.9) * g; }
    out[i] = s * 0.7;
  }
  return out;
}

for (const cfg of SONGS) {
  const file = path.join(cfg.dir, `${cfg.name}.json`);
  const song = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`\n${cfg.name}: voicing ${song.lines.length} lines…`);
  const spoken = speak(song);

  // Place each line's voice at its start; the line ends just after the voice does.
  song.lines.forEach((l, i) => {
    const v = spoken[i], next = song.lines[i + 1];
    const dur = v.wav.length / RATE;
    l.end = Math.round(Math.min(l.start + dur + 0.35, next ? next.start - 0.15 : l.start + dur + 0.35) * 100) / 100;
    l.words.forEach((w, wi) => { w.start = Math.round((l.start + v.words[wi]) * 100) / 100; });
    l.words[0].start = l.start;
    for (const w of l.words) if (w.start >= l.end) w.start = Math.round((l.end - 0.05) * 100) / 100;
  });
  const lastEnd = song.lines[song.lines.length - 1].end;
  const secs = Math.ceil(lastEnd + 4);
  const music = backing(cfg, secs, lastEnd, song.lines[Math.floor(song.lines.length / 2)].start);

  // Voice: normalise loudness, then mix over the music with the music dipped underneath.
  const voice = new Float32Array(music.length);
  song.lines.forEach((l, i) => {
    const w = spoken[i].wav, at = Math.round(l.start * RATE);
    for (let j = 0; j < w.length && at + j < voice.length; j++) voice[at + j] += w[j];
  });
  let peak = 0; for (const x of voice) peak = Math.max(peak, Math.abs(x));
  const vGain = 0.95 / (peak || 1);
  const vocal = new Float32Array(music.length);
  let env = 0;
  for (let i = 0; i < music.length; i++) {
    env = Math.max(Math.abs(voice[i]) > 0.01 ? 1 : 0, env * 0.99995);   // hold the dip through short gaps
    // Voice on top: music drops to ~25% under her, and the voice is gently compressed so quiet syllables stay clear.
    vocal[i] = music[i] * (1 - 0.75 * env) + Math.tanh(voice[i] * vGain * 2.2) * 0.75;
  }
  const rms = (a, from, to) => { let s = 0, n = 0; for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++, n++) s += a[i] * a[i]; return Math.sqrt(s / n); };
  const l0 = song.lines[0], vOnly = new Float32Array(music.length);
  for (let i = 0; i < music.length; i++) vOnly[i] = vocal[i] - music[i] * (1 - 0.75 * (Math.abs(voice[i]) > 0.01 ? 1 : 0));
  const ratio = rms(vOnly, l0.start + 0.2, l0.end - 0.4) / (rms(music, l0.start + 0.2, l0.end - 0.4) * 0.25);
  console.log(`${cfg.name}: voice is ${(20 * Math.log10(ratio)).toFixed(1)} dB above the music underneath`);
  writeWav(path.join(cfg.dir, `${cfg.name}.wav`), music);
  writeWav(path.join(cfg.dir, `${cfg.name}-vocal.wav`), vocal);
  fs.writeFileSync(file, JSON.stringify(song, null, 2) + '\n');
  console.log(`${cfg.name}: ${secs}s, lyrics end ${lastEnd}s, voice gain ×${vGain.toFixed(2)}`);
}
