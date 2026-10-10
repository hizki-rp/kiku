import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '../lib/session';
import { BottomNav, Empty, Icon, Screen, T, Tag } from '../components/ui';
import { mmss } from '../lib/lyrics';
import { c } from '../lib/theme';

// Songbook · what can be sung tonight
export default function Songbook() {
  const { songs } = useSession();
  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 14, gap: 4 }}>
        <T size={28} weight={900}>Songbook</T>
        <T size={14} color={c.muted}>Listen with vocals to learn it, then sing it in a booth.</T>
      </View>
      <FlatList data={songs} keyExtractor={(s) => String(s.id)} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}
        ListEmptyComponent={<Empty title="No songs yet" sub="The house band is still tuning up." />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/song/${item.id}`)} accessibilityRole="button"
            style={({ pressed }) => ({ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 12, opacity: pressed ? 0.85 : 1 })}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="songbook" size={20} color={c.accentSoft} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T size={15} weight={700} numberOfLines={1}>{item.title}</T>
              <T size={12} color={c.muted} numberOfLines={1}>{item.artist} · {mmss(item.duration_s)}{item.vocal_url ? ' · vocals + karaoke' : ' · karaoke'}</T>
            </View>
            <Tag>{item.level}</Tag>
            <Icon name="play" size={16} color={c.muted} fill={c.muted} />
          </Pressable>
        )} />
      <BottomNav />
    </Screen>
  );
}
