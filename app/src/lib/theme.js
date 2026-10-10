import { Platform } from 'react-native';

// Design tokens from design-export/Room.dc.html.
export const c = {
  bg: '#0B0B0B',
  surface: '#181818',
  surface2: '#121212',
  border: '#2A2A2A',
  text: '#FFFFFF',
  muted: '#A7A7A7',
  accent: '#E11D2B',
  accentSoft: '#FF5A5F',
  accentTint: 'rgba(225,29,43,0.16)',
  lyricBg: '#000000',
  lyricPast: '#8A7D90',
  lyricEn: '#BDBDBD',
  avatar: '#3A3A3A',
  dotted: '#4A4A4A',
  cardMuted: '#4A4A4A',
};

export const COVERS = ['#E11D2B', '#FF5A5F', '#C2410C', '#B45309', '#4D7C0F', '#0F766E', '#1D4ED8', '#6D28D9'];
export const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];

const JP = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;
export const hasJp = (s) => JP.test(s || '');
export const hasKanji = (s) => /[㐀-鿿]/.test(s || '');

// Web loads the fonts from Google Fonts (unicode-range subsets, a few KB). Native bundles the TTFs once.
const ARCHIVO = { 400: 'Archivo_400Regular', 500: 'Archivo_500Medium', 700: 'Archivo_700Bold', 800: 'Archivo_800ExtraBold', 900: 'Archivo_900Black' };
export function font(weight = 400, jp = false) {
  if (Platform.OS === 'web') {
    return { fontFamily: jp ? "'Zen Maru Gothic', sans-serif" : "Archivo, 'Zen Maru Gothic', sans-serif", fontWeight: String(weight) };
  }
  if (jp) return { fontFamily: weight >= 700 ? 'ZenMaruGothic_700Bold' : 'ZenMaruGothic_500Medium' };
  return { fontFamily: ARCHIVO[weight] || ARCHIVO[400] };
}
// Pick the Japanese face automatically when the text contains Japanese (native has no font fallback chain).
export const fontFor = (text, weight) => font(weight, hasJp(text));

export const pill = (on) => ({
  height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, justifyContent: 'center', alignItems: 'center',
  backgroundColor: on ? c.text : 'transparent', borderColor: on ? c.text : c.border,
});
export const pillText = (on) => ({ fontSize: 12, color: on ? '#000000' : c.muted, ...font(on ? 700 : 400) });
