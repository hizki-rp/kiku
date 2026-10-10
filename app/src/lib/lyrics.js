// Lyric timing + validation. Pure functions, shared by the room screen and the admin editor.
// Format: { songId, lines: [{ line, start, end, jp, en, words: [{ t, reading, romaji, meaning, note?, start? }] }] }

// Each word starts at its own "start" if given, otherwise the line duration is spread evenly across words.
export function wordStarts(line) {
  const step = (line.end - line.start) / line.words.length;
  return line.words.map((w, i) => (typeof w.start === 'number' ? w.start : line.start + i * step));
}

// Which line is current at time t (seconds) and how many of its words have been sung.
export function lyricAt(lines, t) {
  if (!lines?.length) return { cur: -1, sung: 0 };
  let cur = 0;
  for (let i = 0; i < lines.length; i++) if (lines[i].start <= t) cur = i;
  const sung = wordStarts(lines[cur]).filter((s) => s <= t).length;
  return { cur, sung };
}

// Mirrors validate_lyrics() in api/index.php. Returns a list of problems (empty = valid).
export function validateLyrics(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.lines) || !d.lines.length) return ['"lines" must be a non-empty array'];
  const errs = [];
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const str = (v) => typeof v === 'string' && v.trim() !== '';
  let prev = -1;
  d.lines.forEach((l, i) => {
    const n = `Line ${i + 1}`;
    if (!l || typeof l !== 'object') return errs.push(`${n}: must be an object`);
    if (!num(l.start) || !num(l.end) || l.end <= l.start) return errs.push(`${n}: needs numeric start < end`);
    if (l.start < prev) errs.push(`${n}: starts before the previous line`);
    prev = l.start;
    if (!str(l.jp)) errs.push(`${n}: "jp" is required`);
    if (typeof l.en !== 'string') errs.push(`${n}: "en" must be a string`);
    if (!Array.isArray(l.words) || !l.words.length) return errs.push(`${n}: "words" must be a non-empty array`);
    l.words.forEach((w, j) => {
      const wn = `${n} word ${j + 1}`;
      if (!w || !str(w.t)) return errs.push(`${wn}: "t" is required`);
      for (const k of ['reading', 'romaji', 'meaning']) if (!str(w[k])) errs.push(`${wn} (${w.t}): "${k}" is required`);
      if (w.note != null && typeof w.note !== 'string') errs.push(`${wn}: "note" must be a string`);
      if (w.start != null && (!num(w.start) || w.start < l.start || w.start >= l.end)) errs.push(`${wn}: "start" must be inside the line`);
    });
  });
  return errs;
}

export const mmss = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
