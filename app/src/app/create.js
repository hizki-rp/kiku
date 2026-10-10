import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '../lib/session';
import { Button, Chip, Field, Icon, Scroll, Screen, Section, Switch, T, TopBar } from '../components/ui';
import { c, COVERS, LEVELS } from '../lib/theme';

// Create · open a booth
export default function Create() {
  const { emit, enterRoom } = useSession();
  const [name, setName] = useState('');
  const [color, setColor] = useState(COVERS[0]);
  const [level, setLevel] = useState('N5');
  const [knock, setKnock] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true); setErr('');
    try {
      const { room } = await emit('create_room', { name, color, level, knock });
      enterRoom(room);
      router.replace(`/room/${room.id}`);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Screen>
      <TopBar title="Open a booth" sub="Light a lamp, others will find it" />
      <Scroll>
        <Field label="Name" value={name} onChangeText={setName} maxLength={40} placeholder="Ramen-ya at 2am" />

        <Section title="Cover colour">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {COVERS.map((col) => (
              <Pressable key={col} onPress={() => setColor(col)} accessibilityLabel={`Cover ${col}`} accessibilityState={{ selected: color === col }}
                style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: col, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 2, borderColor: color === col ? c.text : 'transparent' }}>
                {color === col ? <Icon name="check" size={20} /> : null}
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="Level">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[...LEVELS, 'Any'].map((l) => <Chip key={l} label={l} on={level === l} onPress={() => setLevel(l)} />)}
          </View>
        </Section>

        <Section title="Language">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="Japanese" on />
            <Chip label="Korean · soon" disabled />
            <Chip label="Spanish · soon" disabled />
          </View>
        </Section>

        <Switch label="Knock to enter" sub={knock ? 'You admit each person' : 'Anyone can walk in'} on={knock} onPress={() => setKnock(!knock)} />

        {err ? <T size={13} color={c.accentSoft}>{err}</T> : null}
        <Button label="Light the lamp" icon="lamp" onPress={open} disabled={busy || !name.trim()} />
      </Scroll>
    </Screen>
  );
}
