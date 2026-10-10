import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { router, usePathname } from 'expo-router';
import { c, font, fontFor, hasKanji, pill, pillText } from '../lib/theme';

// ---- icons (stroke style matching the export) ----
const ICONS = {
  back: <Path d="M15 18l-6-6 6-6" />,
  bookmark: <Path d="M6 3h12v18l-6-4-6 4z" />,
  mic: <><Rect x="9" y="2" width="6" height="12" rx="3" /><Path d="M5 11a7 7 0 0 0 14 0" /><Path d="M12 18v4" /></>,
  micOff: <><Path d="M3 3l18 18" /><Path d="M9 9v2a3 3 0 0 0 5.1 2.1" /><Path d="M15 10V5a3 3 0 0 0-5.9-.8" /><Path d="M19 11a7 7 0 0 1-1.2 3.9" /><Path d="M5 11a7 7 0 0 0 10.7 6" /><Path d="M12 18v4" /></>,
  // handheld karaoke microphone
  microphone: <><Circle cx="15.5" cy="8.5" r="5" /><Path d="M12 5l7 7" /><Path d="M12 12l-7.3 7.3a1.4 1.4 0 0 1-2-2L10 10" /></>,
  headphones: <><Path d="M3 18v-6a9 9 0 0 1 18 0v6" /><Rect x="3" y="14" width="4" height="7" rx="1.5" /><Rect x="17" y="14" width="4" height="7" rx="1.5" /></>,
  booths: <><Path d="M3 10l9-6 9 6" /><Path d="M5 9v11h14V9" /><Path d="M10 20v-6h4v6" /></>,
  songbook: <><Path d="M9 18V5l12-2v13" /><Circle cx="6" cy="18" r="3" /><Circle cx="18" cy="16" r="3" /></>,
  words: <><Rect x="3" y="5" width="14" height="16" rx="2" /><Path d="M7 3h12a2 2 0 0 1 2 2v12" /></>,
  me: <><Circle cx="12" cy="8" r="4" /><Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  lamp: <><Path d="M9 18h6" /><Path d="M10 22h4" /><Path d="M12 2a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 2z" /></>,
  lock: <><Rect x="5" y="11" width="14" height="10" rx="2" /><Path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  plus: <><Path d="M12 5v14" /><Path d="M5 12h14" /></>,
  check: <Path d="M5 12l5 5L20 7" />,
  x: <><Path d="M18 6L6 18" /><Path d="M6 6l12 12" /></>,
  play: <Path d="M7 4l13 8-13 8z" />,
  pause: <><Path d="M8 4v16" /><Path d="M16 4v16" /></>,
  skip: <><Path d="M5 4l10 8-10 8z" /><Path d="M19 5v14" /></>,
  users: <><Circle cx="9" cy="8" r="3.5" /><Path d="M2 20c1-3.5 3.8-5 7-5s6 1.5 7 5" /><Path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><Path d="M18 15c2 .6 3.4 2.2 4 5" /></>,
};
export function Icon({ name, size = 22, color = c.text, fill = 'none', width = 2 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </Svg>
  );
}

// ---- layout ----
// Phone-width column, centred on desktop web. `wide` is for the admin page.
export function Screen({ children, wide, style }) {
  const inset = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center' }}>
      <View style={[{ flex: 1, width: '100%', maxWidth: wide ? 1200 : 480, paddingTop: inset.top, paddingBottom: inset.bottom }, style]}>{children}</View>
    </View>
  );
}

export const T = ({ children, size = 14, weight = 400, color = c.text, jp, style, ...p }) => (
  <Text {...p} style={[{ color, fontSize: size }, jp == null ? fontFor(String(children ?? ''), weight) : font(weight, jp), style]}>{children}</Text>
);

export function TopBar({ title, sub, onBack, right }) {
  return (
    <View style={{ paddingTop: 16, paddingRight: 12, paddingBottom: 6, paddingLeft: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Pressable onPress={onBack || (() => (router.canGoBack() ? router.back() : router.replace('/')))} accessibilityLabel="Back"
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="back" color={c.text} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T size={16} weight={700} numberOfLines={1}>{title}</T>
        {sub ? <T size={12} color={c.muted} numberOfLines={1}>{sub}</T> : null}
      </View>
      {right}
    </View>
  );
}

// ---- buttons & controls ----
export function Button({ label, onPress, kind = 'accent', icon, disabled, style, small }) {
  const h = small ? 40 : 48;
  const look = {
    accent: { bg: c.accent, fg: c.text, border: c.accent },
    outline: { bg: 'transparent', fg: c.accent, border: c.accent },
    ghost: { bg: c.surface, fg: c.text, border: c.border },
    white: { bg: c.text, fg: '#000000', border: c.text },
  }[kind];
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={({ pressed }) => [{ height: h, paddingHorizontal: 16, borderRadius: h / 2, borderWidth: 1, borderColor: look.border, backgroundColor: look.bg,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, style]}>
      {icon ? <Icon name={icon} size={18} color={look.fg} /> : null}
      <T size={small ? 13 : 14} weight={700} color={look.fg} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}

// Filter / option chip. Selected = white bg, black text.
export function Chip({ label, on, onPress, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: !!on, disabled: !!disabled }}
      style={[pill(on), { height: 36, borderRadius: 18, paddingHorizontal: 14, opacity: disabled ? 0.4 : 1 }]}>
      <T style={[pillText(on), { fontSize: 13 }]}>{label}</T>
    </Pressable>
  );
}

// Small pill toggle used on the lyric screen (Furigana / English).
export function Toggle({ label, on, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={pill(on)}>
      <T style={pillText(on)}>{label}</T>
    </Pressable>
  );
}

export function Switch({ label, sub, on, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: on }}
      style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <View style={{ flex: 1 }}>
        <T size={15} weight={700}>{label}</T>
        {sub ? <T size={12} color={c.muted}>{sub}</T> : null}
      </View>
      <View style={{ width: 48, height: 28, borderRadius: 14, padding: 3, backgroundColor: on ? c.accent : c.border, alignItems: on ? 'flex-end' : 'flex-start' }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.text }} />
      </View>
    </Pressable>
  );
}

export function Field({ label, style, ...p }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <T size={13} color={c.muted}>{label}</T> : null}
      <TextInput placeholderTextColor={c.muted} {...p}
        style={[{ minHeight: 48, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, paddingHorizontal: 16,
          color: c.text, fontSize: 15, ...font(400), ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) }, style]} />
    </View>
  );
}

// ---- people ----
export function Avatar({ name, color = c.avatar, size = 30, first }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: 2, borderColor: c.bg,
      alignItems: 'center', justifyContent: 'center', marginLeft: first ? 0 : -8 }}>
      <T size={13} weight={700}>{(name || '?')[0].toUpperCase()}</T>
    </View>
  );
}
export function AvatarStack({ members, hostId }) {
  const shown = [...members].sort((a, b) => (b.id === hostId) - (a.id === hostId)).slice(0, 2);
  const extra = members.length - shown.length;
  return (
    <View style={{ flexDirection: 'row' }}>
      {shown.map((m, i) => <Avatar key={m.id} name={m.name} first={i === 0} color={m.id === hostId ? c.accent : c.avatar} />)}
      {extra > 0 ? (
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.border, borderWidth: 2, borderColor: c.bg, marginLeft: -8, alignItems: 'center', justifyContent: 'center' }}>
          <T size={11}>+{extra}</T>
        </View>
      ) : null}
    </View>
  );
}

// ---- booths ----
export function BoothCard({ room, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${room.name}, ${room.count} inside`}
      style={({ pressed }) => ({ backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 14,
        flexDirection: 'row', gap: 14, alignItems: 'center', opacity: pressed ? 0.85 : 1 })}>
      <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: room.color, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="lamp" size={26} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T size={16} weight={700} numberOfLines={1}>{room.name}</T>
        <T size={13} color={c.muted} numberOfLines={1}>
          {room.nowTitle ? `${room.nowSinger} · ${room.nowTitle}` : 'Warming up — no one on the mic'}
        </T>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 }}>
          <Tag>{room.level}</Tag>
          <T size={12} color={c.muted}>{room.count} inside · host {room.hostName}</T>
        </View>
      </View>
      {room.knock ? <Icon name="lock" size={18} color={c.muted} /> : null}
    </Pressable>
  );
}
export const Tag = ({ children, color = c.text, bg = c.border }) => (
  <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
    <T size={11} weight={800} color={color} style={{ textTransform: 'uppercase' }}>{children}</T>
  </View>
);

// ---- lyrics ----
// One word with furigana above it. Same metrics as the export: 30/20 px, ruby 11/9 px, dotted underline, min 44 px tap target.
export function WordChip({ word, current, color, selected, showRuby, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${word.t}, ${word.romaji}, ${word.meaning}`}
      style={{ alignItems: 'center', justifyContent: 'flex-end', minHeight: 44, paddingVertical: 2, paddingHorizontal: 3,
        borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: selected ? c.accentTint : 'transparent',
        borderBottomWidth: 2, borderStyle: selected ? 'solid' : 'dotted', borderBottomColor: selected ? c.accent : c.dotted }}>
      <T jp size={current ? 11 : 9} color={c.muted} style={{ lineHeight: (current ? 11 : 9) * 1.2, opacity: showRuby && hasKanji(word.t) ? 1 : 0 }}>
        {word.reading}
      </T>
      <T jp weight={current ? 700 : 500} size={current ? 30 : 20} color={color}>{word.t}</T>
    </Pressable>
  );
}

// state: 'past' | 'current' | 'next'
export function LyricLine({ line, state, sung = 0, showRuby, showTr, isSelected, onPick }) {
  const current = state === 'current';
  return (
    <View style={{ opacity: current ? 1 : 0.75 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-end', rowGap: 2, columnGap: 4 }}>
        {line.words.map((w, wi) => (
          <WordChip key={wi} word={w} current={current} showRuby={showRuby} selected={isSelected?.(wi)} onPress={() => onPick?.(wi)}
            color={state === 'past' ? c.lyricPast : current && wi < sung ? c.accent : c.text} />
        ))}
      </View>
      {showTr ? <T size={14} color={c.lyricEn} style={{ textAlign: 'center', marginTop: 4 }}>{line.en}</T> : null}
    </View>
  );
}

// Lyric screen: toggles + previous / current / next line. Shared by booths and the Songbook player.
export function LyricPanel({ lines, cur, sung, showRuby, onRuby, showTr, onTr, selKey, onPick, emptyText }) {
  const shown = cur < 0 ? [] : [cur - 1, cur, cur + 1].filter((i) => i >= 0 && i < lines.length);
  return (
    <View style={{ marginTop: 14, marginHorizontal: 16, backgroundColor: c.lyricBg, borderWidth: 1, borderColor: c.border, borderRadius: 20,
      paddingTop: 14, paddingHorizontal: 14, paddingBottom: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
        <Toggle label="Furigana" on={showRuby} onPress={onRuby} />
        <Toggle label="English" on={showTr} onPress={onTr} />
      </View>
      {shown.length ? shown.map((li) => (
        <LyricLine key={li} line={lines[li]} state={li < cur ? 'past' : li === cur ? 'current' : 'next'} sung={sung}
          showRuby={showRuby} showTr={showTr} isSelected={(wi) => selKey === `${li}-${wi}`} onPick={(wi) => onPick(li, wi)} />
      )) : <T size={15} color={c.muted} style={{ textAlign: 'center', paddingVertical: 28 }}>{emptyText}</T>}
    </View>
  );
}

// The white "what does this word mean" card with a save button.
export function MeaningCard({ word, saved, onSave }) {
  return (
    <View style={{ marginTop: 12, marginHorizontal: 16, backgroundColor: c.text, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <T jp size={32} weight={700} color="#000000" style={{ minWidth: 64, textAlign: 'center' }}>{word.t}</T>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={13} color={c.cardMuted}>{word.reading} · {word.romaji}</T>
        <T size={15} weight={700} color="#000000">{word.meaning}</T>
        {word.note ? <T size={12} color={c.cardMuted} style={{ lineHeight: 17 }}>{word.note}</T> : null}
      </View>
      <Pressable onPress={onSave} accessibilityRole="button" accessibilityLabel={saved ? 'Saved to My words' : 'Save word to My words'}
        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="bookmark" size={20} color={c.accent} fill={saved ? c.accent : 'none'} />
      </Pressable>
    </View>
  );
}

// ---- disco ----
// Swinging spotlights, slowly turning coloured glows and mirror-ball sparkles behind the booth.
// Only transforms/opacity animate (native driver on phones), so it stays cheap on weak devices.
const GLOWS = [['#E11D2B', 260, 300], ['#FF2EC4', 640, 300], ['#2E6BFF', 260, 620], ['#FFB020', 640, 620]];
const BEAMS = [{ x: 18, color: '#FF5A5F', from: -24, to: 18, ms: 3200 }, { x: 50, color: '#7C5CFF', from: 20, to: -20, ms: 4100 }, { x: 82, color: '#FFB020', from: -14, to: 26, ms: 3600 }];
const SPARKS = Array.from({ length: 14 }, (_, i) => ({ x: (i * 37) % 100, y: ((i * 53) % 70) + 4, p: 0.12 + ((i * 0.29) % 0.76), s: 2 + (i % 3) }));
export function DiscoLights({ on }) {
  const native = Platform.OS !== 'web';
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(new Animated.Value(0)).current;
  const sways = useRef(BEAMS.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (!on) return;
    let loops = [];
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then((reduce) => {
      if (reduce || cancelled) return;
      const loop = (v, ms, back) => Animated.loop(back
        ? Animated.sequence([Animated.timing(v, { toValue: 1, duration: ms, useNativeDriver: native }), Animated.timing(v, { toValue: 0, duration: ms, useNativeDriver: native })])
        : Animated.timing(v, { toValue: 1, duration: ms, useNativeDriver: native }));
      loops = [loop(spin, 24000), loop(pulse, 250, true), loop(twinkle, 1800), ...sways.map((v, i) => loop(v, BEAMS[i].ms, true))];
      loops.forEach((l) => l.start());
    });
    return () => { cancelled = true; loops.forEach((l) => l.stop()); };
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!on) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <Animated.View style={{ position: 'absolute', width: 900, height: 900, left: '50%', top: '45%', marginLeft: -450, marginTop: -450,
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0.5] }),
        transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
        <Svg width={900} height={900}>
          <Defs>
            {GLOWS.map(([col], i) => (
              <RadialGradient key={i} id={`glow${i}`} cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={col} stopOpacity="0.9" /><Stop offset="1" stopColor={col} stopOpacity="0" />
              </RadialGradient>
            ))}
          </Defs>
          {GLOWS.map(([, x, y], i) => <Circle key={i} cx={x} cy={y} r={230} fill={`url(#glow${i})`} />)}
        </Svg>
      </Animated.View>
      {BEAMS.map((b, i) => (
        <Animated.View key={i} style={{ position: 'absolute', top: -10, left: `${b.x}%`, width: 140, height: 760, marginLeft: -70, opacity: 0.22,
          transformOrigin: '50% 0%', transform: [{ rotate: sways[i].interpolate({ inputRange: [0, 1], outputRange: [`${b.from}deg`, `${b.to}deg`] }) }] }}>
          <Svg width={140} height={760}>
            <Defs>
              <LinearGradient id={`beam${i}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={b.color} stopOpacity="1" /><Stop offset="1" stopColor={b.color} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Polygon points="62,0 78,0 140,760 0,760" fill={`url(#beam${i})`} />
          </Svg>
        </Animated.View>
      ))}
      {SPARKS.map((sp, i) => (
        <Animated.View key={i} style={{ position: 'absolute', left: `${sp.x}%`, top: `${sp.y}%`, width: sp.s * 2, height: sp.s * 2, borderRadius: sp.s, backgroundColor: '#FFFFFF',
          opacity: twinkle.interpolate({ inputRange: [0, sp.p - 0.1, sp.p, sp.p + 0.1, 1], outputRange: [0.05, 0.05, 0.95, 0.05, 0.05] }) }} />
      ))}
    </View>
  );
}

// ---- nav ----
const TABS = [['/', 'Booths', 'booths'], ['/songbook', 'Songbook', 'songbook'], ['/words', 'My words', 'words'], ['/me', 'Me', 'me']];
export function BottomNav() {
  const path = usePathname();
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface2, paddingTop: 6, paddingBottom: 10 }}>
      {TABS.map(([href, label, icon]) => {
        const on = path === href;
        return (
          <Pressable key={href} onPress={() => router.replace(href)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            <Icon name={icon} size={22} color={on ? c.text : c.muted} />
            <T size={11} weight={on ? 700 : 400} color={on ? c.text : c.muted}>{label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---- states ----
export function Glow({ color = c.accent, size = 120 }) {
  const a = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 1400, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(a, { toValue: 0.4, duration: 1400, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [a]);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0, 0.25] }) }} />
      <View style={{ width: size * 0.6, height: size * 0.6, borderRadius: size * 0.3, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="lamp" size={size * 0.28} color="#FFFFFF" />
      </View>
    </View>
  );
}

// Branded cold-start screen while Render wakes up.
export function Connecting() {
  return (
    <Screen style={{ alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32 }}>
      <Glow />
      <T size={22} weight={800}>Lighting the lamp…</T>
      <T size={14} color={c.muted} style={{ textAlign: 'center', maxWidth: 280 }}>
        The booths are waking up. On a quiet night this can take up to a minute.
      </T>
    </Screen>
  );
}

export const Empty = ({ title, sub }) => (
  <View style={{ padding: 32, alignItems: 'center', gap: 6 }}>
    <T size={16} weight={700} style={{ textAlign: 'center' }}>{title}</T>
    {sub ? <T size={13} color={c.muted} style={{ textAlign: 'center' }}>{sub}</T> : null}
  </View>
);

export const Section = ({ title, children, right }) => (
  <View style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <T size={13} weight={800} color={c.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</T>
      {right}
    </View>
    {children}
  </View>
);

export const Scroll = (p) => <ScrollView {...p} contentContainerStyle={[{ padding: 16, gap: 16 }, p.contentContainerStyle]} keyboardShouldPersistTaps="handled" />;
