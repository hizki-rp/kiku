import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { api, useSession } from '../lib/session';
import { validateLyrics, mmss } from '../lib/lyrics';
import { loadLyrics } from '../lib/usePlayback';
import { Button, Chip, Empty, Field, Icon, LyricLine, Screen, Section, T, Tag, TopBar } from '../components/ui';
import { c, font, LEVELS } from '../lib/theme';

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

  const refresh = useCallback(() => api('/songs?all=1').then(setSongs).catch((e) => setMsg(e.message)), []);
  useEffect(() => { if (user?.role === 'admin') refresh(); }, [user, refresh]);

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
    setForm(s ? { ...s } : BLANK); setAudio(null); setVocal(null); setMsg(''); setServerErrs([]); setLyricsDirty(false); setOpenLine(0);
    if (!s) { setText(JSON.stringify(TEMPLATE, null, 2)); setDoc(TEMPLATE); setLyricsDirty(true); return; }
    try { const d = await loadLyrics(s.lyrics_url); setDoc(d); setText(JSON.stringify(d, null, 2)); }
    catch { setDoc(null); setText(''); setMsg('Could not load this song’s lyrics file.'); }
  };

  const pickAudio = async (which) => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
    const a = r.assets?.[0];
    if (!a?.file) return;
    if (a.file.size > 3 * 1024 * 1024) return setMsg('Audio must be 3 MB or less — export at 64 kbps MP3/Opus.');
    (which === 'vocal' ? setVocal : setAudio)({ file: a.file, name: a.name, size: a.file.size });
    const el = new window.Audio(URL.createObjectURL(a.file));
    el.onloadedmetadata = () => setForm((f) => ({ ...f, duration_s: f.duration_s && which === 'vocal' ? f.duration_s : Math.round(el.duration) }));
  };
  const pickLyrics = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
    const a = r.assets?.[0];
    if (a?.file) setLyricsText(await a.file.text());
  };

  const errs = doc ? validateLyrics(doc) : text.trim() ? ['Not valid JSON'] : (form.id ? [] : ['Lyrics are required']);
  const save = async (publish) => {
    setBusy(true); setMsg(''); setServerErrs([]);
    const fd = new FormData();
    if (form.id) fd.append('id', String(form.id));
    fd.append('title', form.title); fd.append('artist', form.artist); fd.append('level', form.level);
    fd.append('duration_s', String(form.duration_s || 0));
    if (publish) fd.append('published', '1');
    if (audio) fd.append('audio', audio.file, audio.name);
    if (vocal) fd.append('vocal', vocal.file, vocal.name);
    if (lyricsDirty) fd.append('lyrics', text);
    try {
      const s = await api('/admin/songs', { method: 'POST', form: fd });
      setForm({ ...s }); setAudio(null); setVocal(null); setLyricsDirty(false);
      setMsg(s.published ? 'Published — it is in the songbook now.' : 'Saved as a draft.');
      refresh(); loadSongs();
    } catch (e) { setMsg(e.message); setServerErrs(e.details || []); }
    setBusy(false);
  };

  const editing = form.id || text;
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

            <Section title="Audio · each max 3 MB, 64 kbps MP3/Opus">
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

            <Section title="Lyrics JSON" right={<Button kind="ghost" small label="Load .json file" onPress={pickLyrics} />}>
              <TextInput multiline value={text} onChangeText={setLyricsText} spellCheck={false}
                style={{ minHeight: 220, maxHeight: 360, borderRadius: 16, borderWidth: 1, borderColor: errs.length ? c.accent : c.border, backgroundColor: c.lyricBg,
                  color: c.text, padding: 12, fontSize: 12, fontFamily: Platform.OS === 'web' ? 'ui-monospace, Menlo, Consolas, monospace' : undefined, ...web }} />
              {errs.length ? errs.slice(0, 8).map((e) => <T key={e} size={12} color={c.accentSoft}>• {e}</T>)
                : <T size={12} color={c.muted}>Looks good · {doc?.lines.length} lines · {doc?.lines.reduce((n, l) => n + l.words.length, 0)} words</T>}
            </Section>

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
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button kind="ghost" label="Save draft" disabled={busy || !form.title || errs.length > 0} onPress={() => save(false)} />
              <Button label="Publish" disabled={busy || !form.title || errs.length > 0 || (!form.id && !audio)} onPress={() => save(true)} />
            </View>
          </ScrollView>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center' }}><Empty title="Pick a song or add a new one" sub="Upload a small audio file and its lyrics JSON." /></View>
        )}
      </View>
    </Screen>
  );
}
