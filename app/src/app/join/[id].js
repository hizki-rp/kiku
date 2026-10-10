import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api, useSession } from '../../lib/session';
import { Button, Field, Glow, Screen, T } from '../../components/ui';
import { c } from '../../lib/theme';

// Shared booth link: /join/<roomId>?code=<invite>. A name is all a guest needs; the code lets them skip the knock.
export default function Join() {
  const { id, code } = useLocalSearchParams();
  const { user, signIn } = useSession();
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const next = `/knock/${id}${code ? `?code=${encodeURIComponent(code)}` : ''}`;

  useEffect(() => { if (user) router.replace(next); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  async function join() {
    setBusy(true); setErr('');
    try { await signIn(await api('/auth/guest', { method: 'POST', body: { name: name.trim() } })); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

  if (user) return <Screen />;
  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : 'padding'} style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
        <View style={{ alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Glow size={96} />
          <T size={28} weight={900} style={{ textAlign: 'center' }}>You're invited</T>
          <T size={15} color={c.muted} style={{ textAlign: 'center', maxWidth: 300, lineHeight: 21 }}>
            Someone saved you a seat in a Tomoshibi karaoke booth. Sing along, learn a little Japanese.
          </T>
        </View>
        <Field label="Your name" value={name} onChangeText={setName} maxLength={24} placeholder="What should the booth call you?"
          autoFocus onSubmitEditing={join} returnKeyType="go" />
        {err ? <T size={13} color={c.accentSoft}>{err}</T> : null}
        <Button label="Join the booth" icon="microphone" onPress={join} disabled={busy || !name.trim()} />
        <Button kind="ghost" label="I have an account" onPress={() => router.replace('/login')} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
