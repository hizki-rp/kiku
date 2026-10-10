import { Platform, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '../lib/session';
import { Avatar, BottomNav, Button, Screen, T } from '../components/ui';
import { c } from '../lib/theme';

export default function Me() {
  const { user, signOut } = useSession();
  return (
    <Screen>
      <View style={{ flex: 1, padding: 16, paddingTop: 20, gap: 16 }}>
        <T size={28} weight={900}>Me</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 20, padding: 16 }}>
          <Avatar name={user?.username} first color={c.accent} size={52} />
          <View>
            <T size={18} weight={800}>{user?.username}</T>
            <T size={13} color={c.muted}>{user?.role === 'admin' ? 'Admin · keeper of the songbook' : user?.role === 'guest' ? 'Guest · joined from a link' : 'Regular at the booths'}</T>
          </View>
        </View>
        {user?.role === 'admin' ? (
          Platform.OS === 'web'
            ? <Button kind="white" label="Open admin songbook" icon="songbook" onPress={() => router.push('/admin')} />
            : <T size={13} color={c.muted}>The admin songbook is on the web app at /admin.</T>
        ) : null}
        {user?.role === 'guest' ? <Button label="Create a free account" onPress={signOut} /> : null}
        <Button kind="ghost" label={user?.role === 'guest' ? 'Leave' : 'Sign out'} onPress={signOut} />
      </View>
      <BottomNav />
    </Screen>
  );
}
