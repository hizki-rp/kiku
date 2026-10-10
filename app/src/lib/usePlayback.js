import { useEffect, useState } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

const lyricsCache = new Map();
export function loadLyrics(url) {
  if (!lyricsCache.has(url)) lyricsCache.set(url, fetch(url).then((r) => r.json()).catch((e) => { lyricsCache.delete(url); throw e; }));
  return lyricsCache.get(url);
}

// Drives local audio from the server's { startedAt | pausedAt } and returns the lyric clock.
// The server never streams anything: every client downloads the audio + lyrics and seeks itself.
export function usePlayback(now, song, serverNow) {
  const player = useAudioPlayer(null, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const [lyrics, setLyrics] = useState(null);
  const [, tick] = useState(0);

  const expected = () => (!now ? 0 : now.pausedAt != null ? now.pausedAt : (serverNow() - now.startedAt) / 1000);

  useEffect(() => {
    setLyrics(null);
    if (!song) { player.pause(); return; }
    player.replace(song.audio_url);
    let live = true;
    loadLyrics(song.lyrics_url).then((d) => live && setLyrics(d)).catch(() => {});
    return () => { live = false; };
  }, [song?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!now || !song || !status.isLoaded) return;
    const sync = () => {
      const e = expected();
      const ended = status.duration > 0 && e >= status.duration;
      if (now.pausedAt != null || e < 0 || ended) {
        if (player.playing) player.pause();
        if (Math.abs(player.currentTime - Math.max(0, Math.min(e, status.duration || e))) > 0.5) player.seekTo(Math.max(0, e));
        return;
      }
      if (Math.abs(player.currentTime - e) > 0.5) player.seekTo(e);  // drift correction
      if (!player.playing) player.play();
    };
    sync();
    const iv = setInterval(sync, 1000);
    return () => clearInterval(iv);
  }, [now?.startedAt, now?.pausedAt, song?.id, status.isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // When audio isn't running (still loading, or the browser blocked autoplay) keep lyrics moving on the shared clock.
  const audioDriving = status.playing;
  useEffect(() => {
    if (!now || now.pausedAt != null || audioDriving) return;
    const iv = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(iv);
  }, [now?.startedAt, now?.pausedAt, audioDriving]); // eslint-disable-line react-hooks/exhaustive-deps

  const e = expected();
  const t = audioDriving ? status.currentTime : Math.max(0, e);
  const duration = status.duration || now?.durationS || song?.duration_s || 0;
  const blocked = !!now && now.pausedAt == null && status.isLoaded && !status.playing && e > 1.5 && e < duration;
  return { t, duration, lyrics, blocked, play: () => player.play() };
}
