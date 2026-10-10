import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { api, useSession } from '../../lib/session';
import { loadLyrics } from '../../lib/usePlayback';
import { lyricAt, mmss } from '../../lib/lyrics';
import { Button, Chip, Empty, Icon, LyricPanel, MeaningCard, Scroll, Screen, Section, T, Tag, TopBar } from '../../components/ui';
import { c } from '../../lib/theme';

// Songbook player: listen alone before singing. "With vocals" to learn the song, "Karaoke" to practise over the backing.
export default function Song() {
  const { id } = useLocalSearchParams();
  const { songs, loadSongs } = useSession();
  const song = songs.find((s) => String(s.id) === String(id));
  const [mode, setMode] = useState('vocal');   // 'vocal' falls back to karaoke when a song has no vocal track
  // Source fixed per song; switching vocals/karaoke uses replace() so the player (and position) survives.
  const player = useAudioPlayer(song ? song.vocal_url || song.audio_url : null, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const [lyrics, setLyrics] = useState(null);
  const [showTr, setShowTr] = useState(true);
  const [showRuby, setShowRuby] = useState(true);
  const [sel, setSel] = useState(null);
  const [saved, setSaved] = useState(() => new Set());
  const [msg, setMsg] = useState('');
  const [barW, setBarW] = useState(1);

  useEffect(() => { if (song) loadLyrics(song.lyrics_url).then(setLyrics).catch(() => setMsg('Could not load the lyrics')); }, [song?.lyrics_url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!songs.some((s) => String(s.id) === String(id))) loadSongs(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api('/words').then((ws) => setSaved(new Set(ws.map((w) => w.word)))).catch(() => {}); }, []);

  // Switching vocals ↔ karaoke keeps your place in the song.
  // Waits until the new track has really loaded (slow networks) before seeking, then resumes.
  const switching = useRef(0);
  const switchMode = (m) => {
    if (m === mode || !song) return;
    const at = player.currentTime, wasPlaying = player.playing;
    player.pause();
    setMode(m);
    player.replace((m === 'vocal' && song.vocal_url) || song.audio_url);
    const id = ++switching.current;
    const settle = async (tries) => {
      if (id !== switching.current || tries > 60) return;   // superseded, or give up after ~9 s
      if (player.isLoaded && player.duration > 0) {
        await player.seekTo(at).catch(() => {});
        if (Math.abs(player.currentTime - at) < 1) { if (wasPlaying) player.play(); return; }
      }
      setTimeout(() => settle(tries + 1), 150);
    };
    setTimeout(() => settle(0), 150);
  };

  const lines = lyrics?.lines || [];
  const t = status.currentTime || 0;
  const { cur, sung } = lyricAt(lines, t);
  const word = sel || (cur >= 0 ? { key: `${cur}-0`, word: lines[cur].words[0], line: lines[cur] } : null);
  // Vocabulary pack: every distinct word in the song, in order of appearance.
  const vocab = useMemo(() => {
    const seen = new Map();
    for (const l of lines) for (const w of l.words) if (!seen.has(w.t)) seen.set(w.t, { ...w, line: l });
    return [...seen.values()];
  }, [lines]);
  const unsaved = vocab.filter((w) => !saved.has(w.t));

  if (!song) return <Screen><TopBar title="Song" /><Empty title="Song not found" sub="It may have been unpublished." /></Screen>;

  const toWord = (w, line) => ({ word: w.t, reading: w.reading, romaji: w.romaji, meaning: w.meaning, line_jp: line.jp, line_en: line.en, song_id: song.id, booth_name: 'Songbook' });
  const saveOne = async () => {
    try { await api('/words', { method: 'POST', body: toWord(word.word, word.line) }); setSaved((s) => new Set(s).add(word.word.t)); setMsg(`Saved ${word.word.t}`); }
    catch (e) { setMsg(e.message); }
  };
  const saveAll = async () => {
    try {
      const r = await api('/words', { method: 'POST', body: { words: unsaved.map((w) => toWord(w, w.line)) } });
      setSaved((s) => new Set([...s, ...unsaved.map((w) => w.t)]));
      setMsg(`Added ${r.saved} words to My words — they're waiting as flashcards`);
    } catch (e) { setMsg(e.message); }
  };
  const duration = status.duration || song.duration_s || 0;

  return (
    <Screen>
      <TopBar title={song.title} sub={`${song.artist} · ${song.level}`} />
      <Scroll contentContainerStyle={{ paddingHorizontal: 0, paddingTop: 0, gap: 0 }}>
        <View style={{ marginHorizontal: 16, flexDirection: 'row', gap: 8 }}>
          <Chip label="With vocals · learn" on={mode === 'vocal'} disabled={!song.vocal_url} onPress={() => switchMode('vocal')} />
          <Chip label="Karaoke · no vocals" on={mode === 'karaoke' || !song.vocal_url} onPress={() => switchMode('karaoke')} />
        </View>

        <View style={{ marginTop: 14, marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => (status.playing ? player.pause() : (status.didJustFinish || t >= duration - 0.3 ? (player.seekTo(0), player.play()) : player.play()))}
            accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause' : 'Play'}
            style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={status.playing ? 'pause' : 'play'} size={22} fill={status.playing ? 'none' : '#FFFFFF'} />
          </Pressable>
          <View style={{ flex: 1, gap: 6 }}>
            <Pressable onLayout={(e) => setBarW(e.nativeEvent.layout.width)} accessibilityLabel="Seek"
              onPress={(e) => duration && player.seekTo((e.nativeEvent.locationX / barW) * duration)} style={{ height: 20, justifyContent: 'center' }}>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: c.border }}>
                <View style={{ width: `${duration ? Math.min(100, (t / duration) * 100) : 0}%`, height: 4, borderRadius: 2, backgroundColor: c.accent }} />
              </View>
            </Pressable>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T size={12} weight={800} color={c.muted}>{mmss(t)}</T>
              <T size={12} weight={800} color={c.muted}>{mmss(duration)}</T>
            </View>
          </View>
        </View>

        <LyricPanel lines={lines} cur={cur} sung={status.playing || t > 0 ? sung : 0} showRuby={showRuby} onRuby={() => setShowRuby(!showRuby)}
          showTr={showTr} onTr={() => setShowTr(!showTr)} selKey={word?.key}
          onPick={(li, wi) => setSel({ key: `${li}-${wi}`, word: lines[li].words[wi], line: lines[li] })}
          emptyText="Loading the words…" />
        {word ? <MeaningCard word={word.word} saved={saved.has(word.word.t)} onSave={saveOne} /> : null}
        {msg ? <T size={13} color={c.accentSoft} style={{ marginHorizontal: 16, marginTop: 10 }}>{msg}</T> : null}

        <View style={{ margin: 16, marginTop: 20 }}>
          <Section title={`Vocabulary pack · ${vocab.length} words`}
            right={unsaved.length ? <Button small icon="bookmark" label={`Save all ${unsaved.length}`} onPress={saveAll} /> : <Tag>All saved</Tag>}>
            {vocab.map((w) => (
              <View key={w.t} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12 }}>
                <T jp size={20} weight={700} style={{ minWidth: 64 }}>{w.t}</T>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T size={14} weight={700} numberOfLines={1}>{w.meaning}</T>
                  <T size={12} color={c.muted} numberOfLines={1}>{w.reading} · {w.romaji}</T>
                </View>
                {saved.has(w.t) ? <Icon name="check" size={18} color={c.accentSoft} /> : null}
              </View>
            ))}
          </Section>
        </View>
      </Scroll>
    </Screen>
  );
}
