import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Stack, usePathname, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
// Per-weight imports so only these files ship (the package index pulls every weight, ~20 MB).
import { Archivo_400Regular } from '@expo-google-fonts/archivo/400Regular';
import { Archivo_500Medium } from '@expo-google-fonts/archivo/500Medium';
import { Archivo_700Bold } from '@expo-google-fonts/archivo/700Bold';
import { Archivo_800ExtraBold } from '@expo-google-fonts/archivo/800ExtraBold';
import { Archivo_900Black } from '@expo-google-fonts/archivo/900Black';
import { ZenMaruGothic_500Medium } from '@expo-google-fonts/zen-maru-gothic/500Medium';
import { ZenMaruGothic_700Bold } from '@expo-google-fonts/zen-maru-gothic/700Bold';
import { SessionProvider, useSession } from '../lib/session';
import { Connecting, T } from '../components/ui';
import { c } from '../lib/theme';

const NATIVE_FONTS = Platform.OS === 'web' ? {} : {
  Archivo_400Regular, Archivo_500Medium, Archivo_700Bold, Archivo_800ExtraBold, Archivo_900Black, ZenMaruGothic_500Medium, ZenMaruGothic_700Bold,
};

if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('gfonts')) {
  const l = document.createElement('link');
  l.id = 'gfonts'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700;800;900&family=Zen+Maru+Gothic:wght@400;500;700&display=swap';
  document.head.appendChild(l);
  document.body.style.background = c.bg;
}

function Gate() {
  const { ready, user, status, everConnected } = useSession();
  const path = usePathname();
  useEffect(() => { if (ready && !user && path !== '/login' && !path.startsWith('/join')) router.replace('/login'); }, [ready, user, path]);
  const showLamp = user && !everConnected && path !== '/admin';
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'fade' }} />
      {!ready || showLamp ? <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}>{ready ? <Connecting /> : null}</View> : null}
      {user && everConnected && status !== 'online' ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 4 }} pointerEvents="none">
          <View style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 }}>
            <T size={12} color={c.muted}>Reconnecting…</T>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function Layout() {
  const [loaded] = useFonts(NATIVE_FONTS);
  if (!loaded && Platform.OS !== 'web') return null;
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Gate />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
