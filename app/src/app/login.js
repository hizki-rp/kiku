import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { router } from 'expo-router';
import { api, useSession } from '../lib/session';
import { Button, Field, Glow, Screen, T } from '../components/ui';
import { c } from '../lib/theme';

export default function Login() {
  const { signIn } = useSession();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setErr('');
    try {
      await signIn(await api(`/auth/${mode}`, { method: 'POST', body: { username, password } }));
      router.replace('/');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : 'padding'} style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
        <View style={{ alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Glow size={96} />
          <T size={32} weight={900}>Tomoshibi</T>
          <T jp size={16} color={c.muted}>ともしび · a little lamp to sing by</T>
        </View>
        <Field label="Name" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="e.g. aster" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="6+ characters" onSubmitEditing={submit} />
        {err ? <T size={13} color={c.accentSoft}>{err}</T> : null}
        <Button label={mode === 'login' ? 'Come in' : 'Make my seat'} onPress={submit} disabled={busy || !username || !password} />
        <Button kind="ghost" label={mode === 'login' ? 'First time? Create an account' : 'I already have a seat'}
          onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
