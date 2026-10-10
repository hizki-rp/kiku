import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

// Voice chat inside a booth.
// 1. Direct: a small WebRTC mesh; the socket server only relays offers/answers/ICE. The newcomer calls
//    everyone already on voice, so there is never "glare".
// 2. Relay fallback (web): if a direct link to someone isn't up within RELAY_AFTER_MS (strict mobile NATs, no TURN),
//    we stream 16 kHz PCM to them through the socket server instead. Each side decides for itself, symmetrically.
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
const RELAY_OK = Platform.OS === 'web';   // the PCM fallback needs Web Audio
const RELAY_AFTER_MS = 7000;
const PCM_RATE = 16000;

// STUN by default; the API's /config adds TURN relays when they're configured (setIceServers, called from session.js).
let ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
if (process.env.EXPO_PUBLIC_TURN_URL) {
  ICE.push({ urls: process.env.EXPO_PUBLIC_TURN_URL.split(','), username: process.env.EXPO_PUBLIC_TURN_USERNAME, credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL });
}
export function setIceServers(list) { if (Array.isArray(list) && list.length) ICE = list; }

const plainDesc = (d) => ({ type: d.type, sdp: d.sdp });
const plainCand = (c) => ({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex });

// serverSaysOn: my member.voice flag from room_state (undefined while unknown).
// sendRaw: fire-and-forget socket emit (volatile) for the relay's PCM chunks.
export function useVoice(roomId, emit, subscribe, serverSaysOn, sendRaw) {
  const [state, setState] = useState('off');   // off | joining | on
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [links, setLinks] = useState({});       // userId -> 'connecting' | 'direct' | 'relay'
  const local = useRef(null);
  const peers = useRef(new Map());              // userId -> { pc, el, src, timer, pending: [] }
  const linksRef = useRef({});
  const mutedRef = useRef(false);
  const ctx = useRef(null);                     // Web Audio: plays remote voices + captures PCM for the relay
  const capture = useRef(null);
  const nextAt = useRef({});                    // relay playback schedule per sender

  const setLink = useCallback((id, v) => {
    if (linksRef.current[id] === v) return;
    const next = { ...linksRef.current };
    if (v == null) delete next[id]; else next[id] = v;
    linksRef.current = next;
    setLinks(next);
  }, []);

  const send = useCallback((to, data) => emit('voice_signal', { roomId, to, data }).catch(() => {}), [roomId, emit]);

  const drop = useCallback((id) => {
    const p = peers.current.get(id);
    if (p) {
      clearTimeout(p.timer);
      p.pc.close();
      if (p.el) { p.el.srcObject = null; p.el.remove(); }
      try { p.src?.disconnect(); } catch {}
      peers.current.delete(id);
    }
    delete nextAt.current[id];
    setLink(id, null);
  }, [setLink]);

  const peer = useCallback((id) => {
    if (peers.current.has(id)) return peers.current.get(id);
    const pc = new RTC.PC({ iceServers: ICE });
    const p = { pc, el: null, src: null, timer: null, pending: [] };
    peers.current.set(id, p);
    setLink(id, 'connecting');
    local.current.getTracks().forEach((t) => pc.addTrack(t, local.current));
    pc.addEventListener('icecandidate', (e) => e.candidate && send(id, { candidate: plainCand(e.candidate) }));
    pc.addEventListener('track', (e) => {
      if (Platform.OS !== 'web') return;   // native plays remote audio tracks by itself
      const stream = e.streams[0];
      // Chrome only feeds a remote stream into Web Audio while a (muted) media element is also playing it.
      if (!p.el) { p.el = document.createElement('audio'); p.el.muted = true; p.el.playsInline = true; p.el.style.display = 'none'; document.body.appendChild(p.el); }
      p.el.srcObject = stream;
      p.el.play().catch(() => {});
      // Play through the AudioContext unlocked by the user's tap, so phones don't block it.
      try { p.src?.disconnect(); p.src = ctx.current.createMediaStreamSource(stream); p.src.connect(ctx.current.destination); }
      catch { p.el.muted = false; }   // no Web Audio: let the element itself play
    });
    const fallback = () => { if (RELAY_OK && linksRef.current[id] && linksRef.current[id] !== 'direct') setLink(id, 'relay'); };
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') { clearTimeout(p.timer); setLink(id, 'direct'); }
      if (pc.connectionState === 'failed') fallback();
    });
    p.timer = setTimeout(fallback, RELAY_AFTER_MS);
    return p;
  }, [send, setLink]);

  const flush = async (p) => { for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(RTC.cand(c)).catch(() => {}); };

  // Relay playback: schedule each 16 kHz chunk right after the previous one from the same person.
  const playPcm = useCallback((from, buf) => {
    const ac = ctx.current, link = linksRef.current[from];
    if (!ac || !link || link === 'direct') return;   // not on voice with them, or the direct link carries their voice
    if (link === 'connecting') setLink(from, 'relay');  // they gave up on direct first: answer in kind
    const bytes = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const pcm = new Int16Array(bytes);
    if (!pcm.length) return;
    const ab = ac.createBuffer(1, pcm.length, PCM_RATE), ch = ab.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const node = ac.createBufferSource();
    node.buffer = ab;
    node.connect(ac.destination);
    const now = ac.currentTime;
    let at = nextAt.current[from] || 0;
    if (at < now + 0.05 || at > now + 1) at = now + 0.15;   // (re)start with a small jitter buffer
    node.start(at);
    nextAt.current[from] = at + ab.duration;
  }, [setLink]);

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
    const offPcm = subscribe('voice_pcm', ({ from, pcm }) => playPcm(from, pcm));
    return () => { offSignal(); offLeft(); offPcm(); };
  }, [subscribe, peer, send, drop, playPcm]);

  const stop = useCallback(() => {
    for (const id of [...peers.current.keys()]) drop(id);
    const c = capture.current;
    if (c) { try { c.proc.disconnect(); c.src.disconnect(); } catch {} capture.current = null; }
    local.current?.getTracks().forEach((t) => t.stop());
    if (local.current) InCall?.stop();
    local.current = null;
    ctx.current?.close().catch(() => {});
    ctx.current = null;
    nextAt.current = {};
    setState('off'); setMuted(false); mutedRef.current = false;
  }, [drop]);

  // Tell the server we're on voice and call everyone already there.
  const announce = useCallback(async () => {
    const { peers: others } = await emit('voice_join', { roomId });
    for (const id of others) {
      const p = peer(id);
      await p.pc.setLocalDescription(await p.pc.createOffer());
      send(id, { sdp: plainDesc(p.pc.localDescription) });
    }
  }, [emit, roomId, peer, send]);

  // Relay sender: downsample the mic to 16 kHz PCM and send ~128 ms chunks to everyone reached via the relay.
  const startCapture = useCallback(() => {
    if (!RELAY_OK || !ctx.current || !sendRaw) return;
    const ac = ctx.current, src = ac.createMediaStreamSource(local.current);
    const proc = ac.createScriptProcessor(2048, 1, 1), silent = ac.createGain();
    silent.gain.value = 0;
    const ratio = ac.sampleRate / PCM_RATE;
    proc.onaudioprocess = (e) => {
      const to = Object.keys(linksRef.current).filter((id) => linksRef.current[id] === 'relay');
      if (!to.length || mutedRef.current) return;
      const input = e.inputBuffer.getChannelData(0), n = Math.floor(input.length / ratio), out = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
        let sum = 0;
        for (let j = a; j < b; j++) sum += input[j];
        out[i] = Math.max(-32768, Math.min(32767, Math.round((sum / (b - a)) * 32767)));
      }
      sendRaw('voice_pcm', { roomId, to, pcm: out.buffer });
    };
    src.connect(proc); proc.connect(silent); silent.connect(ac.destination);
    capture.current = { src, proc };
  }, [roomId, sendRaw]);

  const join = useCallback(async () => {
    if (!VOICE_SUPPORTED) { setError('Voice chat needs the Tomoshibi app or the web version (not Expo Go)'); return false; }
    if (state !== 'off') return true;
    // Create + resume the AudioContext *now*, inside the tap: phones only allow audio that starts from a gesture.
    if (Platform.OS === 'web' && !ctx.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { ctx.current = new AC(); ctx.current.resume().catch(() => {}); }
    }
    setState('joining'); setError('');
    try {
      local.current = await RTC.getUserMedia(Platform.OS === 'web'
        ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
        : { audio: true });
      // 'video' mode = loudspeaker by default (Android's 'audio' mode uses the earpiece), still switching to headphones/Bluetooth.
      InCall?.start({ media: 'video', auto: true });
      startCapture();
      await announce();
      setState('on');
      return true;
    } catch (e) {
      stop();
      const denied = e?.name === 'NotAllowedError' || /permission/i.test(e?.message || '');
      setError(denied ? 'Microphone is blocked — allow it in settings to be heard' : e?.message || 'Could not start voice');
      return false;
    }
  }, [state, announce, stop, startCapture]);

  const leave = useCallback(() => { stop(); emit('voice_leave', { roomId }).catch(() => {}); }, [stop, emit, roomId]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    local.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    mutedRef.current = next;
    setMuted(next);
    if (!next) ctx.current?.resume().catch(() => {});   // a tap: good moment to make sure audio is unlocked
    emit('voice_mute', { roomId, muted: next }).catch(() => {});
  }, [muted, emit, roomId]);

  // After a dropped connection the server re-seats us with voice off, while we still hold the mic.
  // If that mismatch lasts, quietly redial everyone (keeping the mic and the mute state).
  useEffect(() => {
    if (state !== 'on' || serverSaysOn !== false) return;
    const t = setTimeout(async () => {
      for (const id of [...peers.current.keys()]) drop(id);
      try {
        await announce();
        if (muted) emit('voice_mute', { roomId, muted: true }).catch(() => {});
      } catch { /* still offline: the next room_state retries */ }
    }, 1500);
    return () => clearTimeout(t);
  }, [state, serverSaysOn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => stop, [roomId, stop]);   // leaving the booth hangs up
  if (Platform.OS === 'web') { window.__voicePeers = peers.current; window.__voiceLinks = linksRef; }   // debug handles

  return { state, muted, error, links, join, leave, toggleMute };
}
