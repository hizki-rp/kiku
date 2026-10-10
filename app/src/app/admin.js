import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { api, uploadForm, useSession } from '../lib/session';
import { lyricAt, validateLyrics, mmss } from '../lib/lyrics';
import { loadLyrics } from '../lib/usePlayback';
import { Button, Chip, Empty, Field, Icon, LyricLine, Screen, Section, T, Tag, TopBar } from '../components/ui';
import { c, font, LEVELS } from '../lib/theme';

const MAX_MB = 20;   // keep in sync with MAX_AUDIO_MB in api/index.php
const AUDIO_TYPES = ['audio/*', 'video/mp4', 'video/webm', '.mp3', '.m4a', '.aac', '.mp4', '.ogg', '.oga', '.opus', '.wav', '.webm', '.weba', '.flac'];
const BLANK = { id: 0, title: '', artist: '', level: 'N5', duration_s: 0, published: false };
const TEMPLATE = { lines: [{ line: 1, start: 0, end: 4, jp: '', en: '', words: [{ t: '', reading: '', romaji: '', meaning: '', note: '' }] }] };
const web = Platform.OS === 'web' ? { outlineStyle: 'none' } : null;

// Compact input for the word-map grid.
const Cell = ({ value, onChange, w = 110, num, jp, placeholder }) => (
  <TextInput value={value == null ? '' : String(value)} placeholder={placeholder} placeholderTextColor={c.dotted}
    onChangeText={(v) => onChange(num ? (v === '' ? undefined : Number(v)) : v)} keyboardType={num ? 'numeric' : 'default'}
    style={{ width: w, height: 36, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface2, color: c.text,
      paddingHorizontal: 8, fontSize: 13, ...font(400, jp), ...web }} />
);

// Admin songbook (desktop web): library, song form, audio upload, lyrics JSON + per-line word map, preview, publish.
// "Hold to sync": play the song and hold Space (or the big button) while each line is sung.
// Press = line start, release = line end. Writes real timestamps into the lyrics JSON.
const r2 = (x) => Math.round(x * 100) / 100;
function SyncTool({ doc, onChange, sources }) {
  const [srcKey, setSrcKey] = useState(sources[0].key);
  const src = (sources.find((s) => s.key === srcKey) || sources[0]).url;
  const audio = useRef(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [next, setNext] = useState(0);          // line that the next hold will time
  const [holding, setHolding] = useState(false);
  const [note, setNote] = useState('');
  const hold = useRef(null);                    // { li, start }
  const history = useRef([]);                   // previous docs, for Undo
  const lines = doc.lines;

  useEffect(() => {
    const a = new window.Audio(src);
    a.preload = 'auto';
    audio.current = a;
    window.__syncAudio = a;   // debug handle for tests and devtools
    a.onloadedmetadata = () => setDur(a.duration);
    a.onplay = () => setPlaying(true);
    a.onpause = () => setPlaying(false);
    const iv = setInterval(() => setT(a.currentTime), 50);
    return () => { clearInterval(iv); a.pause(); a.removeAttribute('src'); a.load(); };
  }, [src]);

  const seek = (s) => { if (audio.current) audio.current.currentTime = Math.max(0, s); };
  const commit = (newLines) => { history.current.push(doc); onChange({ ...doc, lines: newLines }); };

  const down = () => {
    const a = audio.current;
    if (!a || hold.current || next >= lines.length) return;
    if (a.paused) return setNote('Press Play first, then hold while each line is sung.');
    const start = r2(a.currentTime), prev = lines[next - 1];
    if (prev && start <= prev.start) return setNote(`Line ${next + 1} must start after line ${next} (${prev.start}s). Seek forward or use "Start at line".`);
    hold.current = { li: next, start };
    setHolding(true); setNote('');
  };
  const up = () => {
    const h = hold.current;
    if (!h) return;
    hold.current = null; setHolding(false);
    const end = Math.max(r2(audio.current.currentTime), r2(h.start + 0.4));   // a quick tap still gives a short line
    const out = lines.map((l, i) => {
      if (i === h.li) return { ...l, start: h.start, end, words: l.words.map(({ start: _s, ...w }) => w) };   // re-spread words evenly
      if (i === h.li - 1 && l.end > h.start) return { ...l, end: Math.max(r2(l.start + 0.1), r2(h.start - 0.01)) };
      return l;
    });
    // Later lines still on old/placeholder times would now start too early: nudge them after this one so the
    // lyrics stay valid at every step (they get their real times when you reach them).
    for (let j = h.li + 1; j < out.length && out[j].start < out[j - 1].end; j++) {
      const start = r2(out[j - 1].end + 0.01);
      out[j] = { ...out[j], start, end: Math.max(out[j].end, r2(start + 0.5)), words: out[j].words.map(({ start: _s, ...w }) => w) };
    }
    commit(out);
    setNext(h.li + 1);
    if (h.li + 1 >= lines.length) setNote(`All ${lines.length} lines timed. Play it back to check, then Publish.`);
  };
  const keys = useRef({});
  keys.current = { down, up };
  useEffect(() => {
    const typing = (e) => /INPUT|TEXTAREA/.test(e.target?.tagName || '');
    // Capture phase + stopPropagation: otherwise Space also "clicks" the focused button (e.g. Play → pause).
    const kd = (e) => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) keys.current.down(); } };
    const ku = (e) => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); e.stopPropagation(); keys.current.up(); } };
    window.addEventListener('keydown', kd, true); window.addEventListener('keyup', ku, true);
    return () => { window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true); };
  }, []);

  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    onChange(prev); setNext((n) => Math.max(0, n - 1)); setNote('');
  };
  const startAt = (li) => {
    const n = Math.min(Math.max(0, li), lines.length - 1);
    setNext(n); setNote('');
    seek((lines[n - 1]?.end ?? 0) - 1.5);   // a little before: the end of the line above
  };
  const shift = (d) => commit(lines.map((l) => ({ ...l, start: r2(Math.max(0, l.start + d)), end: r2(Math.max(0.1, l.end + d)),
    words: l.words.map((w) => (typeof w.start === 'number' ? { ...w, start: r2(Math.max(0, w.start + d)) } : w)) })));

  const { cur, sung } = lyricAt(lines, t);
  const lastEnd = lines[lines.length - 1]?.end || 0;
  return (
    <Section title="Sync timings · hold to sync" right={sources.length > 1 ? (
      <View style={{ flexDirection: 'row', gap: 8 }}>{sources.map((s) => <Chip key={s.key} label={s.label} on={s.key === srcKey} onPress={() => setSrcKey(s.key)} />)}</View>) : null}>
      <T size={13} color={c.muted} style={{ lineHeight: 19 }}>
        Press Play, then hold <T size={13} weight={800}>Space</T> (or the red button) while each line is sung and let go when it ends.
        The vocal track works best, because you can hear where every line starts.
      </T>
      {lastEnd && dur && (dur - lastEnd > 20 || lastEnd > dur + 2) ? (
        <T size={12} color={c.accentSoft}>The lyrics end at {mmss(lastEnd)} but the song is {mmss(dur)} long, so these timings can't match yet.</T>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button small icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} onPress={() => (playing ? audio.current.pause() : audio.current.play())} />
        <Button small kind="ghost" label="−5 s" onPress={() => seek(t - 5)} />
        <Button small kind="ghost" label="Restart" onPress={() => { seek(0); setNext(0); }} />
        <T size={14} weight={800} style={{ minWidth: 110 }}>{mmss(t)}.{String(Math.floor((t % 1) * 10))} / {mmss(dur)}</T>
        <Button small kind="ghost" label="Undo" onPress={undo} disabled={!history.current.length} />
        <T size={12} color={c.muted}>Start at line</T>
        <Button small kind="ghost" label="−" onPress={() => startAt(next - 1)} />
        <T size={14} weight={800}>{Math.min(next + 1, lines.length)}</T>
        <Button small kind="ghost" label="+" onPress={() => startAt(next + 1)} />
        <T size={12} color={c.muted}>Shift all</T>
        <Button small kind="ghost" label="−0.1 s" onPress={() => shift(-0.1)} />
        <Button small kind="ghost" label="+0.1 s" onPress={() => shift(0.1)} />
      </View>
      <Pressable onPressIn={down} onPressOut={up} disabled={next >= lines.length} accessibilityRole="button" accessibilityLabel={`Hold while line ${next + 1} is sung`}
        style={{ minHeight: 64, borderRadius: 18, padding: 14, gap: 4, alignItems: 'center', justifyContent: 'center', opacity: next >= lines.length ? 0.5 : 1,
          backgroundColor: holding ? c.text : c.accent, ...(Platform.OS === 'web' ? { userSelect: 'none' } : null) }}>
        <T size={13} weight={800} color={holding ? '#000000' : c.text}>
          {next >= lines.length ? 'All lines timed' : holding ? `Recording line ${next + 1}… release when it ends` : `Hold while line ${next + 1} of ${lines.length} is sung`}
        </T>
        {next < lines.length ? <T jp size={18} weight={700} color={holding ? '#000000' : c.text}>{lines[next].jp}</T> : null}
      </Pressable>
      {note ? <T size={12} color={c.accentSoft}>{note}</T> : null}
      <View style={{ backgroundColor: c.lyricBg, borderRadius: 16, padding: 14, gap: 8 }}>
        <T size={11} weight={800} color={c.muted}>PREVIEW · what singers will see right now</T>
        {cur >= 0 && t >= lines[0].start - 0.5
          ? <LyricLine line={lines[cur]} state="current" sung={sung} showRuby showTr />
          : <T size={13} color={c.muted}>Waiting for the first line ({lines[0].start}s)…</T>}
      </View>
    </Section>
  );
}

export default function Admin() {
  const { user, loadSongs } = useSession();
  const [songs, setSongs] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [text, setText] = useState('');
  const [doc, setDoc] = useState(null);          // parsed lyrics, null if the JSON doesn't parse
  const [lyricsDirty, setLyricsDirty] = useState(false);
  const [audio, setAudio] = useState(null);      // karaoke track (no vocals): { file, name, size }
  const [vocal, setVocal] = useState(null);      // original with vocals, for Songbook listening
  const [openLine, setOpenLine] = useState(0);
  const [msg, setMsg] = useState('');
  const [serverErrs, setServerErrs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);   // 0..1 while uploading
  const [open, setOpen] = useState(false);          // editor visible

  const refresh = useCallback(() => api('/songs?all=1').then(setSongs).catch((e) => setMsg(e.message)), []);
  useEffect(() => { if (user?.role === 'admin') refresh(); }, [user, refresh]);

  // Picked files as playable URLs for the sync tool (hooks must stay above the early returns).
  const vocalLocal = useMemo(() => (vocal ? URL.createObjectURL(vocal.file) : null), [vocal]);
  const audioLocal = useMemo(() => (audio ? URL.createObjectURL(audio.file) : null), [audio]);

  if (Platform.OS !== 'web') return <Screen><Empty title="Admin is on the web" sub="Open the web app at /admin on a desktop." /></Screen>;
  if (user?.role !== 'admin') return <Screen><TopBar title="Admin songbook" /><Empty title="Admins only" sub="Ask the owner to set your role to admin, then sign in again." /></Screen>;

  const setLyricsText = (v) => {
    setText(v); setLyricsDirty(true);
    try { setDoc(JSON.parse(v)); } catch { setDoc(null); }
  };
  const setLyricsDoc = (d) => { setDoc(d); setText(JSON.stringify(d, null, 2)); setLyricsDirty(true); };
  const editLine = (li, patch) => setLyricsDoc({ ...doc, lines: doc.lines.map((l, i) => (i === li ? { ...l, ...patch } : l)) });
  const editWord = (li, wi, patch) => editLine(li, { words: doc.lines[li].words.map((w, j) => (j === wi ? { ...w, ...patch } : w)) });

  const edit = async (s) => {
    setForm(s ? { ...s } : BLANK); setAudio(null); setVocal(null); setMsg(''); setServerErrs([]); setLyricsDirty(false); setOpenLine(0); setOpen(true);
    if (!s || !s.lyrics_url) { setText(''); setDoc(null); return; }   // music first, lyrics can come later
    try { const d = await loadLyrics(s.lyrics_url); setDoc(d); setText(JSON.stringify(d, null, 2)); }
    catch { setDoc(null); setText(''); setMsg('Could not load this song’s lyrics file.'); }
  };

  const pickAudio = async (which) => {
    const r = await DocumentPicker.getDocumentAsync({ type: AUDIO_TYPES });
    const a = r.assets?.[0];
    if (!a?.file) return;
    const mb = a.file.size / 1024 / 1024;
    if (mb > MAX_MB) return setMsg(`That file is ${mb.toFixed(1)} MB. The limit is ${MAX_MB} MB per track.`);
    setMsg(mb > 8 ? `${a.name} is ${mb.toFixed(1)} MB: fine, but a 96–128 kbps MP3 (~3–5 MB) loads faster on phones.` : '');
    (which === 'vocal' ? setVocal : setAudio)({ file: a.file, name: a.name, size: a.file.size });
    const el = new window.Audio(URL.createObjectURL(a.file));
    el.onloadedmetadata = () => setForm((f) => ({ ...f, duration_s: f.duration_s && which === 'vocal' ? f.duration_s : Math.round(el.duration) }));
    el.onerror = () => setMsg(`${a.name}: this browser can't play it, so phones may not either. MP3 or M4A is safest.`);
  };
  const pickLyrics = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
    const a = r.assets?.[0];
    if (a?.file) setLyricsText(await a.file.text());
  };

  // Audio to time the lyrics against: freshly picked files first, else what's on the server. Vocals first.
  const syncSources = [
    (vocalLocal || form.vocal_url) && { key: 'vocal', label: 'Vocal track', url: vocalLocal || form.vocal_url },
    (audioLocal || form.audio_url) && { key: 'karaoke', label: 'Karaoke track', url: audioLocal || form.audio_url },
  ].filter(Boolean);

  // Lyrics are optional for a draft (upload the music first); publishing needs them.
  const errs = doc ? validateLyrics(doc) : text.trim() ? ['Not valid JSON'] : [];
  const hasLyrics = (doc && !errs.length) || (!lyricsDirty && !!form.lyrics_url);
  const hasKaraoke = !!audio || !!form.audio_url;
  const save = async (publish) => {
    setBusy(true); setMsg(''); setServerErrs([]);
    const fd = new FormData();
    if (form.id) fd.append('id', String(form.id));
    fd.append('title', form.title); fd.append('artist', form.artist); fd.append('level', form.level);
    fd.append('duration_s', String(form.duration_s || 0));
    if (publish) fd.append('published', '1');
    if (audio) fd.append('audio', audio.file, audio.name);
    if (vocal) fd.append('vocal', vocal.file, vocal.name);
    if (lyricsDirty && text.trim()) fd.append('lyrics', text);
    try {
      setProgress(audio || vocal ? 0 : null);
      const s = await uploadForm('/admin/songs', fd, setProgress);
      setForm({ ...s }); setAudio(null); setVocal(null); setLyricsDirty(false);
      setMsg(s.published ? 'Published — it is in the songbook now.' : 'Saved as a draft.');
      refresh(); loadSongs();
    } catch (e) { setMsg(e.message); setServerErrs(e.details || []); }
    setBusy(false); setProgress(null);
  };

  const editing = open;
  const remove = async () => {
    if (!window.confirm(`Delete "${form.title}" and its audio and lyrics files? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api(`/admin/songs/${form.id}`, { method: 'DELETE' });
      setOpen(false); setForm(BLANK); setMsg(''); refresh(); loadSongs();
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  return (
    <Screen wide>
      <TopBar title="Admin songbook" sub="Songs, lyrics and word maps" />
      <View style={{ flex: 1, flexDirection: 'row', gap: 16, padding: 16, paddingTop: 4 }}>
        {/* library */}
        <View style={{ width: 300, gap: 10 }}>
          <Button label="New song" icon="plus" onPress={() => edit(null)} />
          <ScrollView contentContainerStyle={{ gap: 8 }}>
            {songs.map((s) => (
              <Pressable key={s.id} onPress={() => edit(s)}
                style={{ borderRadius: 16, padding: 12, gap: 4, backgroundColor: form.id === s.id ? c.text : c.surface, borderWidth: 1, borderColor: form.id === s.id ? c.text : c.border }}>
                <T size={14} weight={700} numberOfLines={1} color={form.id === s.id ? '#000000' : c.text}>{s.title}</T>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Tag>{s.level}</Tag>
                  <Tag bg={s.published ? c.accent : c.border} color={s.published ? c.text : c.muted}>{s.published ? 'Live' : 'Draft'}</Tag>
                  <T size={12} color={form.id === s.id ? c.cardMuted : c.muted}>{mmss(s.duration_s)}</T>
                </View>
              </Pressable>
            ))}
            {!songs.length ? <T size={13} color={c.muted}>No songs yet.</T> : null}
          </ScrollView>
        </View>

        {/* editor */}
        {editing ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 20, paddingBottom: 48 }}>
            <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
              <View style={{ flex: 2, minWidth: 260 }}><Field label="Title" value={form.title} onChangeText={(v) => setForm({ ...form, title: v })} placeholder="夜の駅で (Yoru no Eki de)" /></View>
              <View style={{ flex: 1, minWidth: 200 }}><Field label="Artist" value={form.artist} onChangeText={(v) => setForm({ ...form, artist: v })} /></View>
            </View>

            <Section title="JLPT level">
              <View style={{ flexDirection: 'row', gap: 8 }}>{LEVELS.map((l) => <Chip key={l} label={l} on={form.level === l} onPress={() => setForm({ ...form, level: l })} />)}</View>
            </Section>

            <Section title="Audio · up to 20 MB each · MP3, M4A, AAC, OGG, Opus, WAV, WebM, FLAC">
              {[['audio', 'Karaoke track · no vocals (required, used in booths)', audio, form.audio_url],
                ['vocal', 'Vocal track · original with singing (for learning in the Songbook)', vocal, form.vocal_url]].map(([which, label, picked, current]) => (
                <View key={which} style={{ gap: 6 }}>
                  <T size={13} weight={700}>{label}</T>
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button kind="ghost" small icon="songbook" label={picked ? 'Change file' : current ? 'Replace' : 'Choose file'} onPress={() => pickAudio(which)} />
                    <T size={13} color={c.muted}>{picked ? `${picked.name} · ${(picked.size / 1024).toFixed(0)} KB` : current ? current.split('/').pop() : 'No file yet'}</T>
                  </View>
                </View>
              ))}
              {form.duration_s ? <T size={12} color={c.muted}>Length {mmss(form.duration_s)}</T> : null}
            </Section>

            <Section title="Lyrics JSON · needed to publish" right={
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {!text.trim() ? <Button kind="ghost" small label="Start from template" onPress={() => setLyricsDoc(TEMPLATE)} /> : null}
                <Button kind="ghost" small label="Load .json file" onPress={pickLyrics} />
              </View>}>
              <TextInput multiline value={text} onChangeText={setLyricsText} spellCheck={false}
                style={{ minHeight: 220, maxHeight: 360, borderRadius: 16, borderWidth: 1, borderColor: errs.length ? c.accent : c.border, backgroundColor: c.lyricBg,
                  color: c.text, padding: 12, fontSize: 12, fontFamily: Platform.OS === 'web' ? 'ui-monospace, Menlo, Consolas, monospace' : undefined, ...web }} />
              {errs.length ? errs.slice(0, 8).map((e) => <T key={e} size={12} color={c.accentSoft}>• {e}</T>)
                : doc ? <T size={12} color={c.muted}>Looks good · {doc.lines.length} lines · {doc.lines.reduce((n, l) => n + l.words.length, 0)} words</T>
                : <T size={12} color={c.muted}>No lyrics yet. You can save the music as a draft and add lyrics later.</T>}
            </Section>

            {doc?.lines?.length && syncSources.length ? (
              <SyncTool key={form.id || 'new'} doc={doc} onChange={setLyricsDoc} sources={syncSources} />
            ) : null}

            {doc?.lines?.length ? (
              <Section title="Word map & preview" right={
                <Button kind="ghost" small icon="plus" label="Add line" onPress={() => {
                  const last = doc.lines[doc.lines.length - 1] || { end: 0 };
                  setLyricsDoc({ ...doc, lines: [...doc.lines, { line: doc.lines.length + 1, start: last.end, end: (last.end || 0) + 4, jp: '', en: '', words: [{ t: '', reading: '', romaji: '', meaning: '' }] }] });
                  setOpenLine(doc.lines.length);
                }} />}>
                {doc.lines.map((l, li) => (
                  <View key={li} style={{ borderRadius: 16, borderWidth: 1, borderColor: openLine === li ? c.muted : c.border, backgroundColor: c.surface, overflow: 'hidden' }}>
                    <Pressable onPress={() => setOpenLine(openLine === li ? -1 : li)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 }}>
                      <T size={12} weight={800} color={c.muted}>{li + 1}</T>
                      <T size={12} color={c.muted}>{l.start}–{l.end}s</T>
                      <T jp size={15} style={{ flex: 1 }} numberOfLines={1}>{l.jp || '(empty line)'}</T>
                      <T size={13} color={c.muted} numberOfLines={1} style={{ flex: 1 }}>{l.en}</T>
                    </Pressable>
                    {openLine === li ? (
                      <View style={{ padding: 14, paddingTop: 0, gap: 12 }}>
                        <View style={{ backgroundColor: c.lyricBg, borderRadius: 16, padding: 14 }}>
                          {l.words?.length && l.words.every((w) => w.t) ? <LyricLine line={l} state="current" sung={0} showRuby showTr /> : <T size={13} color={c.muted}>Fill in words to preview.</T>}
                        </View>
                        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <Cell num w={70} value={l.start} placeholder="start" onChange={(v) => editLine(li, { start: v })} />
                          <Cell num w={70} value={l.end} placeholder="end" onChange={(v) => editLine(li, { end: v })} />
                          <Cell jp w={220} value={l.jp} placeholder="Japanese line" onChange={(v) => editLine(li, { jp: v })} />
                          <Cell w={300} value={l.en} placeholder="English line" onChange={(v) => editLine(li, { en: v })} />
                          <Pressable onPress={() => { setLyricsDoc({ ...doc, lines: doc.lines.filter((_, i) => i !== li) }); setOpenLine(-1); }}
                            accessibilityLabel="Remove line" style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="x" size={18} color={c.muted} />
                          </Pressable>
                        </View>
                        {(l.words || []).map((w, wi) => (
                          <View key={wi} style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <Cell jp w={80} value={w.t} placeholder="word" onChange={(v) => editWord(li, wi, { t: v })} />
                            <Cell jp w={100} value={w.reading} placeholder="reading" onChange={(v) => editWord(li, wi, { reading: v })} />
                            <Cell w={100} value={w.romaji} placeholder="romaji" onChange={(v) => editWord(li, wi, { romaji: v })} />
                            <Cell w={160} value={w.meaning} placeholder="meaning" onChange={(v) => editWord(li, wi, { meaning: v })} />
                            <Cell w={240} value={w.note} placeholder="note (optional)" onChange={(v) => editWord(li, wi, { note: v })} />
                            <Cell num w={70} value={w.start} placeholder="start?" onChange={(v) => editWord(li, wi, { start: v })} />
                            <Pressable onPress={() => editLine(li, { words: l.words.filter((_, j) => j !== wi) })} accessibilityLabel="Remove word"
                              style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                              <Icon name="x" size={16} color={c.muted} />
                            </Pressable>
                          </View>
                        ))}
                        <View style={{ alignItems: 'flex-start' }}>
                          <Button kind="ghost" small icon="plus" label="Add word" onPress={() => editLine(li, { words: [...(l.words || []), { t: '', reading: '', romaji: '', meaning: '' }] })} />
                        </View>
                      </View>
                    ) : null}
                  </View>
                ))}
              </Section>
            ) : null}

            {msg ? <T size={13} color={serverErrs.length || /fail|must|required|problem|not/i.test(msg) ? c.accentSoft : c.muted}>{msg}</T> : null}
            {serverErrs.map((e) => <T key={e} size={12} color={c.accentSoft}>• {e}</T>)}
            {progress != null ? (
              <View style={{ gap: 6 }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: c.border }}>
                  <View style={{ width: `${Math.round(progress * 100)}%`, height: 6, borderRadius: 3, backgroundColor: c.accent }} />
                </View>
                <T size={12} color={c.muted}>{progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : 'Processing…'}</T>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button kind="ghost" label="Save draft" disabled={busy || !form.title || errs.length > 0 || (!form.id && !audio && !vocal)} onPress={() => save(false)} />
              <Button label="Publish" disabled={busy || !form.title || errs.length > 0 || !hasKaraoke || !hasLyrics} onPress={() => save(true)} />
              {form.id ? <Button kind="outline" icon="x" label="Delete song" disabled={busy} onPress={remove} /> : null}
              {!busy && form.title && (!hasKaraoke || !hasLyrics)
                ? <T size={12} color={c.muted}>To publish, add {[!hasKaraoke && 'a karaoke track', !hasLyrics && 'lyrics'].filter(Boolean).join(' and ')}.</T>
                : null}
            </View>
          </ScrollView>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center' }}><Empty title="Pick a song or add a new one" sub="Upload the music (MP3, M4A, AAC, OGG, Opus, WAV, WebM or FLAC, up to 20 MB), then add lyrics." /></View>
        )}
      </View>
    </Screen>
  );
}
