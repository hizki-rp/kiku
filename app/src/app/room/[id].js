import { useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, Share, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api, SITE_URL, useSession } from '../../lib/session';
import { usePlayback } from '../../lib/usePlayback';
import { useVoice } from '../../lib/useVoice';
import { lyricAt, mmss } from '../../lib/lyrics';
import { AvatarStack, Button, Chip, DiscoLights, Empty, Icon, LyricPanel, MeaningCard, Screen, T, Tag, TopBar } from '../../components/ui';
import { c, font } from '../../lib/theme';

const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]);
const REACTIONS = ['Nice!', 'Encore', 'Clap'];

// Room · in the booth. Matches design-export/Room.dc.html, plus voice chat and disco lights.
export default function Room() {
  const { id } = useLocalSearchParams();
  const { user, room, feed, knocks, songs, loadSongs, emit, subscribe, leaveRoom, serverNow, notice, setNotice } = useSession();
  const [gone, setGone] = useState(null);
  const [showTr, setShowTr] = useState(true);
  const [showRuby, setShowRuby] = useState(true);
  const [sel, setSel] = useState(null);           // { key, word, line }
  const [saved, setSaved] = useState(() => new Set());
  const [msg, setMsg] = useState('');
  const [picking, setPicking] = useState(false);
  const [toast, setToast] = useState('');
  const [pickVocals, setPickVocals] = useState(true);         // picker choice: sing along with the original, or karaoke
  const [myVocals, setMyVocals] = useState(null);             // listener's own override; null = follow the singer's choice

  const now = room?.id === id ? room.now : null;
  const song = useMemo(() => songs.find((s) => s.id === now?.songId) || null, [songs, now?.songId]);
  const vocalsOn = !!song?.vocal_url && (myVocals ?? !!now?.vocals);
  const { t, duration, lyrics, blocked, play } = usePlayback(now, song, serverNow, vocalsOn);
  const myVoice = room?.id === id ? room.members.find((m) => m.id === String(user.id))?.voice : undefined;
  const voice = useVoice(id, emit, subscribe, myVoice);
  const lines = lyrics?.lines || [];
  const { cur, sung } = lyricAt(lines, t);

  useEffect(() => {
    if (notice?.roomId === id && (notice.kind === 'closed' || notice.kind === 'removed')) { setGone(notice.kind); setNotice(null); }
  }, [notice, id, setNotice]);
  useEffect(() => { if (!gone && room?.id !== id) router.replace(`/knock/${id}`); }, [room?.id, id, gone]);
  useEffect(() => { api('/words').then((ws) => setSaved(new Set(ws.map((w) => w.word)))).catch(() => {}); }, []);
  useEffect(() => { if (voice.error) setToast(voice.error); }, [voice.error]);
  useEffect(() => { setMyVocals(null); }, [now?.songId, now?.singerId]);   // each new song starts with the singer's choice
  useEffect(() => { if (!toast) return; const tm = setTimeout(() => setToast(''), 3000); return () => clearTimeout(tm); }, [toast]);

  if (gone) {
    return (
      <Screen>
        <Empty title={gone === 'removed' ? 'The host asked you to step out' : 'The lamp went out'} sub="This booth is closed to you now. Plenty of others are lit." />
        <View style={{ padding: 16 }}><Button label="Back to booths" onPress={() => router.replace('/')} /></View>
      </Screen>
    );
  }
  if (!room || room.id !== id) return <Screen />;

  const me = String(user.id);
  const isHost = room.hostId === me;
  const qIdx = room.queue.findIndex((q) => q.userId === me);
  const onMic = now?.singerId === me;
  const raised = onMic || qIdx >= 0;
  const onVoice = room.members.filter((m) => m.voice).length;
  const word = sel || (cur >= 0 ? { key: `${cur}-0`, word: lines[cur].words[0], line: lines[cur] } : null);
  const progress = duration ? Math.min(1, t / duration) : 0;
  const partying = !!now && now.pausedAt == null;

  const leave = () => { voice.leave(); leaveRoom(); router.replace('/'); };
  const send = () => {
    const text = msg.trim();
    if (!text) return;
    setMsg('');
    emit('chat_message', { roomId: id, text }).catch((e) => { setMsg(text); setToast(e.message); });
  };
  const react = (kind) => emit('reaction', { roomId: id, kind }).catch((e) => setToast(e.message));
  const raise = () => {
    if (onMic) return;
    if (qIdx >= 0) return emit('leave_queue', { roomId: id }).catch((e) => setToast(e.message));
    loadSongs();   // songs added since login show up
    setPicking(true);
  };
  const pickSong = (s) => {
    setPicking(false);
    // Singing means being heard: queuing also opens your microphone (this tap is the user gesture browsers want).
    if (voice.state === 'off') voice.join();
    else if (voice.muted) voice.toggleMute();
    emit('join_queue', { roomId: id, song: { id: s.id, title: s.title, duration_s: s.duration_s, vocals: pickVocals && !!s.vocal_url } }).catch((e) => setToast(e.message));
  };
  // Invite link: anyone with it types a name and walks straight in (the code skips the knock).
  const share = async () => {
    const link = `${SITE_URL}/join/${id}${room.invite ? `?code=${room.invite}` : ''}`;
    const text = `Come sing with me in "${room.name}" on Tomoshibi`;
    try {
      if (Platform.OS !== 'web') return void (await Share.share({ message: `${text}: ${link}` }));
      if (navigator.share) return void (await navigator.share({ title: 'Tomoshibi', text, url: link }));
      await navigator.clipboard.writeText(link);
      setToast('Invite link copied — paste it to a friend');
    } catch { /* share sheet dismissed */ }
  };
  const voiceTap = () => (voice.state === 'off' ? voice.join() : voice.toggleMute());
  const save = async () => {
    if (!word) return;
    try {
      await api('/words', { method: 'POST', body: {
        word: word.word.t, reading: word.word.reading, romaji: word.word.romaji, meaning: word.word.meaning,
        line_jp: word.line.jp, line_en: word.line.en, booth_name: room.name, song_id: now?.songId,
      } });
      setSaved((s) => new Set(s).add(word.word.t));
      setToast(`Saved ${word.word.t} to My words`);
    } catch (e) { setToast(e.message); }
  };

  const upNext = room.queue[0];
  const voiceOn = voice.state === 'on';
  return (
    <Screen>
      <DiscoLights on={partying} />
      <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : 'padding'} style={{ flex: 1 }}>
        <TopBar title={room.name} sub={`${room.count} inside · host ${room.hostName}${onVoice ? ` · ${onVoice} on voice` : ''}`} onBack={leave}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Pressable onPress={share} accessibilityRole="button" accessibilityLabel="Share invite link"
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="share" size={20} />
            </Pressable>
            <Pressable onPress={isHost ? () => router.push(`/host/${id}`) : undefined} disabled={!isHost}
              accessibilityLabel={isHost ? `Host panel${knocks.length ? `, ${knocks.length} knocking` : ''}` : 'People inside'}
              style={{ minHeight: 44, justifyContent: 'center' }}>
              <AvatarStack members={room.members} hostId={room.hostId} />
              {isHost && knocks.length ? (
                <View style={{ position: 'absolute', top: 2, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                  <T size={11} weight={800}>{knocks.length}</T>
                </View>
              ) : null}
            </Pressable>
            </View>
          } />

        {/* now playing */}
        <View style={{ marginTop: 4, marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {blocked ? (
            <Pressable onPress={play} accessibilityRole="button"><Tag bg={c.accent}>Tap for sound</Tag></Pressable>
          ) : (
            <Tag bg={now ? c.accent : c.border} color={now ? c.text : c.muted}>{now ? (now.pausedAt != null ? 'Paused' : 'On mic') : 'Quiet'}</Tag>
          )}
          <T size={13} numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
            {now ? <>{now.singerName} · {song?.title || now.title} <T size={13} color={c.muted}>{song?.artist}</T></> : <T size={13} color={c.muted}>No one on the mic yet</T>}
          </T>
          <T size={12} weight={800} color={c.muted}>{now ? mmss(t) : ''}</T>
        </View>
        <View style={{ marginTop: 8, marginHorizontal: 16, height: 4, borderRadius: 2, backgroundColor: c.border }}>
          <View style={{ width: `${progress * 100}%`, height: 4, borderRadius: 2, backgroundColor: c.accent }} />
        </View>

        <LyricPanel lines={lines} cur={cur} sung={sung} showRuby={showRuby} onRuby={() => setShowRuby(!showRuby)} showTr={showTr} onTr={() => setShowTr(!showTr)}
          selKey={word?.key} onPick={(li, wi) => setSel({ key: `${li}-${wi}`, word: lines[li].words[wi], line: lines[li] })}
          emptyText={now ? 'Warming up the words…' : 'Tap “Sing next”, pick a song, and the words will glow here.'}
          extra={song?.vocal_url ? [{ label: 'Vocals', on: vocalsOn, onPress: () => setMyVocals(!vocalsOn) }] : []} />

        {word ? <MeaningCard word={word.word} saved={saved.has(word.word.t)} onSave={save} /> : null}

        {/* chat */}
        <View style={{ flex: 1, minHeight: 0, marginTop: 12, marginHorizontal: 16, gap: 8, overflow: 'hidden', justifyContent: 'flex-end' }}>
          <T size={13} color={toast ? c.accentSoft : c.muted} numberOfLines={2}>
            {toast || (upNext ? `Up next · ${upNext.name} — ${upNext.title}` : 'Up next · nobody yet')}
          </T>
          {feed.slice(-6).map((m) => (
            <T key={m.id} size={14} style={{ lineHeight: 20 }}>
              <T size={14} weight={700} color={c.accentSoft}>{m.name}</T> {m.reaction ? <T size={14} color={c.muted}>{m.text}</T> : m.text}
            </T>
          ))}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {REACTIONS.map((r) => (
              <Pressable key={r} onPress={() => react(r)} accessibilityRole="button"
                style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, justifyContent: 'center' }}>
                <T size={13}>{r}</T>
              </Pressable>
            ))}
          </View>
        </View>

        {/* composer: voice toggle · message · sing next */}
        <View style={{ paddingTop: 10, paddingHorizontal: 16, paddingBottom: 24, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable onPress={voiceTap} onLongPress={voiceOn ? voice.leave : undefined} accessibilityRole="button"
            accessibilityLabel={!voiceOn ? 'Join voice chat' : voice.muted ? 'Unmute microphone' : 'Mute microphone'}
            accessibilityHint={voiceOn ? 'Long press to leave voice chat' : undefined}
            style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
              backgroundColor: voiceOn && !voice.muted ? c.text : c.surface, borderColor: voiceOn ? c.text : c.border, opacity: voice.state === 'joining' ? 0.5 : 1 }}>
            <Icon name={!voiceOn ? 'headphones' : voice.muted ? 'micOff' : 'mic'} size={20} color={voiceOn && !voice.muted ? '#000000' : c.text} />
          </Pressable>
          <View style={{ flex: 1, height: 48, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, justifyContent: 'center', paddingHorizontal: 16 }}>
            <TextInput value={msg} onChangeText={setMsg} onSubmitEditing={send} returnKeyType="send" maxLength={200}
              placeholder="Say something kind…" placeholderTextColor={c.muted} accessibilityLabel="Message the booth"
              style={{ color: c.text, fontSize: 15, ...font(400), ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) }} />
          </View>
          <Button kind={raised ? 'outline' : 'accent'} icon="microphone" onPress={raise}
            label={onMic ? 'On mic' : qIdx >= 0 ? `${ordinal(qIdx + 1)} in line` : 'Sing next'} />
        </View>
      </KeyboardAvoidingView>

      <Modal visible={picking} transparent animationType="slide" onRequestClose={() => setPicking(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setPicking(false)} />
        <View style={{ maxHeight: '75%', flexShrink: 1, backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: c.border, padding: 16, paddingBottom: 28, gap: 12, width: '100%', maxWidth: 480, alignSelf: 'center' }}>
          <T size={18} weight={800}>Pick your song</T>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label="With vocals · sing along" on={pickVocals} onPress={() => setPickVocals(true)} />
            <Chip label="Karaoke · no vocals" on={!pickVocals} onPress={() => setPickVocals(false)} />
          </View>
          <T size={12} color={c.muted}>
            {pickVocals ? 'Everyone hears the original singer with you: great for learning a new song.' : 'Just the backing track: you are the singer.'}
            {' '}Your microphone opens so the booth can hear you; headphones stop echo. Anyone can flip Vocals for themselves.
          </T>
          <FlatList data={songs} keyExtractor={(s) => String(s.id)} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 8 }}
            ListEmptyComponent={<Empty title="The songbook is empty" sub="An admin needs to add songs first." />}
            renderItem={({ item }) => (
              <Pressable onPress={() => pickSong(item)} accessibilityRole="button"
                style={{ minHeight: 56, borderRadius: 16, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T size={15} weight={700} numberOfLines={1}>{item.title}</T>
                  <T size={12} color={c.muted} numberOfLines={1}>{[item.artist, mmss(item.duration_s), pickVocals && !item.vocal_url ? 'karaoke only' : ''].filter(Boolean).join(" · ")}</T>
                </View>
                <Tag>{item.level}</Tag>
              </Pressable>
            )} />
        </View>
      </Modal>
    </Screen>
  );
}
