import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../lib/session';
import { Avatar, Button, Scroll, Screen, Section, Switch, T, TopBar } from '../../components/ui';
import { c } from '../../lib/theme';

const Row = ({ name, sub, color, children }) => (
  <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 10 }}>
    <Avatar name={name} first color={color} size={36} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <T size={15} weight={700} numberOfLines={1}>{name}</T>
      {sub ? <T size={12} color={c.muted} numberOfLines={1}>{sub}</T> : null}
    </View>
    {children}
  </View>
);

// Host panel: door, mic, people, closing time.
export default function Host() {
  const { id } = useLocalSearchParams();
  const { user, room, knocks, emit } = useSession();
  const [err, setErr] = useState('');
  const me = String(user.id);
  const isHost = room?.id === id && room.hostId === me;
  useEffect(() => { if (!isHost) router.replace(room?.id === id ? `/room/${id}` : '/'); }, [isHost, room?.id, id]);
  if (!isHost) return <Screen />;

  const act = (event, data = {}) => emit(event, { roomId: id, ...data }).then(() => setErr('')).catch((e) => setErr(e.message));
  const now = room.now;

  return (
    <Screen>
      <TopBar title="Host panel" sub={room.name} />
      <Scroll>
        {err ? <T size={13} color={c.accentSoft}>{err}</T> : null}

        <Section title={`At the door · ${knocks.length}`}>
          {knocks.length ? knocks.map((k) => (
            <Row key={k.id} name={k.name} sub="is knocking">
              <Button small kind="ghost" label="Decline" onPress={() => act('decline_entry', { userId: k.id })} />
              <Button small label="Admit" onPress={() => act('approve_entry', { userId: k.id })} />
            </Row>
          )) : <T size={13} color={c.muted}>No one is knocking right now.</T>}
          <Switch label="Knock to enter" sub={room.knock ? 'You admit each person' : 'Anyone can walk in'} on={room.knock}
            onPress={() => act('set_knock_required', { on: !room.knock })} />
        </Section>

        <Section title="On the mic">
          {now ? (
            <Row name={now.singerName} color={c.accent} sub={`${now.title}${now.pausedAt != null ? ' · paused' : ''}`}>
              <Button small kind="ghost" icon={now.pausedAt != null ? 'play' : 'pause'} label={now.pausedAt != null ? 'Resume' : 'Pause'}
                onPress={() => act(now.pausedAt != null ? 'resume_song' : 'pause_song')} />
              <Button small kind="ghost" icon="skip" label="Skip" onPress={() => act('skip_song')} />
            </Row>
          ) : <T size={13} color={c.muted}>The mic is free.</T>}
        </Section>

        <Section title={`Queue · ${room.queue.length}`}>
          {room.queue.length ? room.queue.map((q, i) => <Row key={q.userId} name={q.name} sub={`${i + 1}. ${q.title}`} />)
            : <T size={13} color={c.muted}>Nobody is waiting to sing.</T>}
        </Section>

        <Section title={`Inside · ${room.members.length}`}>
          {room.members.map((m) => (
            <Row key={m.id} name={m.name} color={m.id === room.hostId ? c.accent : undefined} sub={[m.id === room.hostId ? 'host' : m.online ? 'here' : 'reconnecting…', m.voice ? (m.muted ? 'muted' : 'on voice') : null].filter(Boolean).join(' · ')}>
              {m.id !== me ? <Button small kind="ghost" label="Remove" onPress={() => act('remove_member', { userId: m.id })} /> : null}
            </Row>
          ))}
        </Section>

        <Button kind="outline" label="Close the booth" icon="x" style={{ marginTop: 8 }}
          onPress={() => act('close_room').then(() => router.replace('/'))} />
      </Scroll>
    </Screen>
  );
}
