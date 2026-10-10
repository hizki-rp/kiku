import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

// Voice chat inside a booth: a small WebRTC mesh. Audio goes peer-to-peer; the socket server only relays
// offers/answers/ICE. The newcomer calls everyone already on voice, so there is never "glare".
// Web uses the browser's WebRTC; the APK uses react-native-webrtc (not in Expo Go, so voice is off there).
let RTC = null;
let InCall = null;
if (Platform.OS === 'web') {
  if (typeof window !== 'undefined' && window.RTCPeerConnection) {
    RTC = { PC: window.RTCPeerConnection, getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c), desc: (d) => d, cand: (c) => c };
  }
} else {
  try {
    const w = require('react-native-webrtc');
    RTC = { PC: w.RTCPeerConnection, getUserMedia: (c) => w.mediaDevices.getUserMedia(c), desc: (d) => new w.RTCSessionDescription(d), cand: (c) => new w.RTCIceCandidate(c) };
    InCall = require('react-native-incall-manager').default;
  } catch { RTC = null; }   // Expo Go: native module not present
}
export const VOICE_SUPPORTED = !!RTC;

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
// Strict NATs (some mobile carriers) need a TURN relay; set these to use one.
if (process.env.EXPO_PUBLIC_TURN_URL) {
  ICE.push({ urls: process.env.EXPO_PUBLIC_TURN_URL.split(','), username: process.env.EXPO_PUBLIC_TURN_USERNAME, credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL });
}
const plainDesc = (d) => ({ type: d.type, sdp: d.sdp });
const plainCand = (c) => ({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex });

export function useVoice(roomId, emit, subscribe) {
  const [state, setState] = useState('off');   // off | joining | on
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const local = useRef(null);
  const peers = useRef(new Map());              // userId -> { pc, audio, pending: [] }

  const send = useCallback((to, data) => emit('voice_signal', { roomId, to, data }).catch(() => {}), [roomId, emit]);

  const drop = useCallback((id) => {
    const p = peers.current.get(id);
    if (!p) return;
    p.pc.close();
    if (p.audio) p.audio.srcObject = null;
    peers.current.delete(id);
  }, []);

  const peer = useCallback((id) => {
    if (peers.current.has(id)) return peers.current.get(id);
    const pc = new RTC.PC({ iceServers: ICE });
    const p = { pc, audio: null, pending: [] };
    peers.current.set(id, p);
    local.current.getTracks().forEach((t) => pc.addTrack(t, local.current));
    pc.addEventListener('icecandidate', (e) => e.candidate && send(id, { candidate: plainCand(e.candidate) }));
    pc.addEventListener('track', (e) => {
      if (Platform.OS !== 'web') return;   // native plays remote audio tracks by itself
      if (!p.audio) { p.audio = new window.Audio(); p.audio.autoplay = true; }
      p.audio.srcObject = e.streams[0];
      p.audio.play().catch(() => {});
    });
    pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') drop(id); });
    return p;
  }, [send, drop]);

  const flush = async (p) => { for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(RTC.cand(c)).catch(() => {}); };

  useEffect(() => {
    if (!VOICE_SUPPORTED) return;
    // Subscribed for the whole visit (not just while 'on'), so an answer can't beat the listener.
    const offSignal = subscribe('voice_signal', async ({ from, data }) => {
      try {
        if (!local.current) return;   // not on voice
        if (data.sdp?.type === 'offer') {
          const p = peer(from);
          await p.pc.setRemoteDescription(RTC.desc(data.sdp));
          await flush(p);
          await p.pc.setLocalDescription(await p.pc.createAnswer());
          send(from, { sdp: plainDesc(p.pc.localDescription) });
        } else if (data.sdp?.type === 'answer') {
          const p = peers.current.get(from);
          if (!p) return;
          await p.pc.setRemoteDescription(RTC.desc(data.sdp));
          await flush(p);
        } else if (data.candidate) {
          const p = peers.current.get(from);
          if (!p) return;
          if (p.pc.remoteDescription) await p.pc.addIceCandidate(RTC.cand(data.candidate)).catch(() => {});
          else p.pending.push(data.candidate);
        }
      } catch (e) { console.warn('voice signal', e); }
    });
    const offLeft = subscribe('voice_left', ({ userId }) => drop(userId));
    return () => { offSignal(); offLeft(); };
  }, [subscribe, peer, send, drop]);

  const stop = useCallback(() => {
    for (const id of [...peers.current.keys()]) drop(id);
    local.current?.getTracks().forEach((t) => t.stop());
    if (local.current) InCall?.stop();
    local.current = null;
    setState('off'); setMuted(false);
  }, [drop]);

  const join = useCallback(async () => {
    if (!VOICE_SUPPORTED) { setError('Voice chat needs the Tomoshibi app or the web version (not Expo Go)'); return false; }
    if (state !== 'off') return true;
    setState('joining'); setError('');
    try {
      local.current = await RTC.getUserMedia(Platform.OS === 'web'
        ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
        : { audio: true });
      // 'video' mode = loudspeaker by default (Android's 'audio' mode uses the earpiece), still switching to headphones/Bluetooth.
      InCall?.start({ media: 'video', auto: true });
      const { peers: others } = await emit('voice_join', { roomId });
      setState('on');
      for (const id of others) {
        const p = peer(id);
        await p.pc.setLocalDescription(await p.pc.createOffer());
        send(id, { sdp: plainDesc(p.pc.localDescription) });
      }
      return true;
    } catch (e) {
      stop();
      const denied = e?.name === 'NotAllowedError' || /permission/i.test(e?.message || '');
      setError(denied ? 'Microphone is blocked — allow it in settings to be heard' : e?.message || 'Could not start voice');
      return false;
    }
  }, [state, emit, roomId, peer, send, stop]);

  const leave = useCallback(() => { stop(); emit('voice_leave', { roomId }).catch(() => {}); }, [stop, emit, roomId]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    local.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
    emit('voice_mute', { roomId, muted: next }).catch(() => {});
  }, [muted, emit, roomId]);

  useEffect(() => stop, [roomId, stop]);   // leaving the booth hangs up
  if (__DEV__ && Platform.OS === 'web') window.__voicePeers = peers.current;

  return { state, muted, error, join, leave, toggleMute };
}
