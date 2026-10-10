import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, useSession } from '../lib/session';
import { BottomNav, Button, Empty, Icon, Scroll, Screen, Section, T } from '../components/ui';
import { c } from '../lib/theme';

// Words · flashcards from saved words
export default function Words() {
  const { user, signOut } = useSession();
  const guest = user?.role === 'guest';
  const [words, setWords] = useState(null);
  const [deck, setDeck] = useState([]);       // ids of words still being learned, in review order
  const [flipped, setFlipped] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    if (guest) return;
    api('/words').then((ws) => {
      setWords(ws);
      setDeck(ws.filter((w) => !w.known).map((w) => w.id));
      setFlipped(false);
    }).catch((e) => setErr(e.message));
  }, [guest]);
  useFocusEffect(load);

  const card = words?.find((w) => w.id === deck[0]);
  const setKnown = (w, known) => {
    setWords((ws) => ws.map((x) => (x.id === w.id ? { ...x, known } : x)));
    api(`/words/${w.id}`, { method: 'PATCH', body: { known } }).catch((e) => setErr(e.message));
  };
  const again = () => { setDeck(([h, ...rest]) => [...rest, h]); setFlipped(false); };
  const gotIt = () => { setKnown(card, true); setDeck(([, ...rest]) => rest); setFlipped(false); };
  const learned = words?.filter((w) => w.known).length || 0;

  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 4 }}>
        <T size={28} weight={900}>My words</T>
        <T size={14} color={c.muted}>{words ? `${words.length} saved · ${learned} learned` : 'Opening your notebook…'}</T>
      </View>
      <Scroll>
        {err ? <T size={13} color={c.accentSoft}>{err}</T> : null}
        {guest ? (
          <>
            <Empty title="Keep the words you learn" sub="Guests can look words up in booths. Make a free account to save them as flashcards." />
            <Button label="Create a free account" onPress={signOut} />
          </>
        ) : card ? (
          <>
            <Pressable onPress={() => setFlipped(!flipped)} accessibilityRole="button" accessibilityHint="Flip card"
              style={{ minHeight: 260, borderRadius: 24, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: flipped ? c.text : c.lyricBg, borderWidth: 1, borderColor: flipped ? c.text : c.border }}>
              {flipped ? (
                <>
                  <T jp size={40} weight={700} color="#000000">{card.word}</T>
                  <T size={14} color={c.cardMuted}>{card.reading} · {card.romaji}</T>
                  <T size={20} weight={800} color="#000000" style={{ textAlign: 'center' }}>{card.meaning}</T>
                  {card.line_jp ? <T jp size={14} color={c.cardMuted} style={{ textAlign: 'center', marginTop: 8 }}>{card.line_jp}</T> : null}
                  {card.line_en ? <T size={13} color={c.cardMuted} style={{ textAlign: 'center' }}>{card.line_en}</T> : null}
                  {card.booth_name ? <T size={11} color={c.cardMuted}>heard in {card.booth_name}</T> : null}
                </>
              ) : (
                <>
                  <T jp size={56} weight={700}>{card.word}</T>
                  <T size={13} color={c.muted}>Tap to flip · {deck.length} to go</T>
                </>
              )}
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button kind="ghost" label="Again" onPress={again} style={{ flex: 1 }} />
              <Button label="Got it" icon="check" onPress={gotIt} style={{ flex: 1 }} />
            </View>
          </>
        ) : words?.length ? (
          <Empty title="All caught up" sub="Every saved word is marked learned. Sing a little more tonight." />
        ) : words ? (
          <Empty title="Your notebook is empty" sub="In a booth, tap any lyric word and press the bookmark to save it here." />
        ) : null}

        {words?.length ? (
          <Section title="Saved words">
            {words.map((w) => (
              <Pressable key={w.id} onPress={() => setKnown(w, !w.known)} accessibilityRole="checkbox" accessibilityState={{ checked: w.known }}
                style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 }}>
                <T jp size={22} weight={700} style={{ minWidth: 56 }}>{w.word}</T>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T size={14} weight={700} numberOfLines={1}>{w.meaning}</T>
                  <T size={12} color={c.muted} numberOfLines={1}>{w.reading} · {w.romaji}</T>
                </View>
                <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: w.known ? c.accent : 'transparent', borderWidth: 1, borderColor: w.known ? c.accent : c.border }}>
                  {w.known ? <Icon name="check" size={16} /> : null}
                </View>
              </Pressable>
            ))}
          </Section>
        ) : null}
      </Scroll>
      <BottomNav />
    </Screen>
  );
}
