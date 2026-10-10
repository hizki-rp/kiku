import { useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '../lib/session';
import { BoothCard, BottomNav, Button, Chip, Empty, Screen, T } from '../components/ui';
import { c, LEVELS } from '../lib/theme';

const FILTERS = ['All', ...LEVELS, 'Open door'];

// Main · Booths tonight
export default function Booths() {
  const { rooms, room } = useSession();
  const [filter, setFilter] = useState('All');
  const shown = rooms.filter((r) => filter === 'All' || (filter === 'Open door' ? !r.knock : r.level === filter));

  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 4 }}>
        <T size={28} weight={900}>Booths tonight</T>
        <T size={14} color={c.muted}>{rooms.length ? `${rooms.length} lamps lit · pull up a stool` : 'Quiet night so far'}</T>
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 14 }}>
          {FILTERS.map((f) => <Chip key={f} label={f} on={filter === f} onPress={() => setFilter(f)} />)}
        </ScrollView>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 12 }}
        renderItem={({ item }) => (
          <BoothCard room={item} onPress={() => router.push(room?.id === item.id ? `/room/${item.id}` : `/knock/${item.id}`)} />
        )}
        ListEmptyComponent={<Empty title="No booths are lit yet" sub="Open one and others will wander in." />}
      />
      <View style={{ paddingVertical: 12, alignItems: 'center' }}>
        <Button label="Open a booth" icon="plus" onPress={() => router.push('/create')} style={{ paddingHorizontal: 24 }} />
      </View>
      <BottomNav />
    </Screen>
  );
}
