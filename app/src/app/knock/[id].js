import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../lib/session';
import { Button, Glow, Screen, T, TopBar } from '../../components/ui';
import { c } from '../../lib/theme';

// Knock · waiting room. Admission comes from the host via the server.
export default function Knock() {
  const { id } = useLocalSearchParams();
  const { emit, enterRoom, rooms, notice, setNotice, status } = useSession();
  const [phase, setPhase] = useState('knocking');   // knocking | waiting | approved | declined | closed
  const [err, setErr] = useState('');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const booth = rooms.find((r) => r.id === id);

  useEffect(() => {
    if (status !== 'online' || phaseRef.current !== 'knocking') return;
    emit('request_entry', { roomId: id })
      .then((r) => {
        if (r.status === 'inside') { enterRoom(r.room); router.replace(`/room/${id}`); }
        else setPhase('waiting');
      })
      .catch((e) => { setErr(e.message); setPhase('closed'); });
  }, [id, status, emit, enterRoom]);

  useEffect(() => {
    if (notice?.roomId !== id) return;
    if (notice.kind === 'approved') setPhase('approved');
    if (notice.kind === 'declined') setPhase('declined');
    if (notice.kind === 'closed') { setErr('This booth has closed'); setPhase('closed'); }
    setNotice(null);
  }, [notice, id, setNotice]);

  // Leaving while still waiting withdraws the knock.
  useEffect(() => () => { if (phaseRef.current === 'waiting') emit('cancel_entry', { roomId: id }).catch(() => {}); }, [id, emit]);

  const copy = {
    knocking: ['Knocking…', 'Finding the door.'],
    waiting: ['Knock knock', `${booth?.hostName || 'The host'} will let you in soon. Get comfortable.`],
    approved: ['Come on in', 'There is a seat by the lamp for you.'],
    declined: ['Not tonight', 'This booth is full or keeping to itself. Plenty of other lamps are lit.'],
    closed: ['The lamp went out', err || 'This booth has closed.'],
  }[phase];

  return (
    <Screen>
      <TopBar title={booth?.name || 'Booth'} sub={booth ? `${booth.count} inside · host ${booth.hostName}` : ''} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
        <Glow color={booth?.color || c.accent} size={140} />
        <T size={26} weight={900} style={{ textAlign: 'center' }}>{copy[0]}</T>
        <T size={15} color={c.muted} style={{ textAlign: 'center', maxWidth: 300, lineHeight: 21 }}>{copy[1]}</T>
      </View>
      <View style={{ padding: 16, paddingBottom: 24, gap: 8 }}>
        {phase === 'approved' ? <Button label="Step inside" onPress={() => router.replace(`/room/${id}`)} /> : null}
        {phase === 'waiting' || phase === 'knocking' ? <Button kind="ghost" label="Stop knocking" onPress={() => router.back()} /> : null}
        {phase === 'declined' || phase === 'closed' ? <Button kind="ghost" label="Back to booths" onPress={() => router.replace('/')} /> : null}
      </View>
    </Screen>
  );
}
