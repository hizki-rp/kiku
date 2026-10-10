import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { io } from 'socket.io-client';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8080/api').replace(/\/$/, '');
// Fallback only: the API's /config (SOCKET_URL in api/.env) wins, so moving the Render service needs no rebuild.
// Public site address, used to build shareable booth links.
export const SITE_URL = Platform.OS === 'web' && typeof window !== 'undefined' && window.location ? window.location.origin : API_URL.replace(/\/api$/, '');
export const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || 'http://localhost:3001';

const store = Platform.OS === 'web'
  ? {
      get: async (k) => { try { return localStorage.getItem(k); } catch { return null; } },
      set: async (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
    }
  : { get: (k) => SecureStore.getItemAsync(k), set: (k, v) => (v == null ? SecureStore.deleteItemAsync(k) : SecureStore.setItemAsync(k, v)) };

let currentToken = null;
let onUnauthorized = () => {};
// JSON body, tolerating a PHP warning printed before it (only skips ahead when plain parsing fails).
const parseBody = (t) => { try { return JSON.parse(t); } catch { try { return JSON.parse(t.slice(t.search(/[[{]/))); } catch { return {}; } } };
export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_URL + path, { method, headers, body: form || (body && JSON.stringify(body)) });
  const text = await res.text();
  const data = parseBody(text);
  if (res.status === 401 && currentToken) onUnauthorized();   // expired or revoked token: back to login
  // Not our JSON (a host firewall page, wrong URL…): say where it came from so it can be diagnosed.
  const where = `${API_URL}${path}`.replace(/^https?:\/\//, '');
  if (!res.ok && /captcha|bot verification/i.test(text)) {
    throw new Error("The server's bot protection blocked the app. Turn off bot verification for this site in hPanel → Security / CDN.");
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status}) at ${where}: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)}`), { details: data.details });
  return data;
}

// Multipart upload with progress (fetch can't report upload progress). Same errors as api().
export function uploadForm(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + path);
    if (currentToken) xhr.setRequestHeader('Authorization', `Bearer ${currentToken}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new Error('Upload failed: check your connection and try again'));
    xhr.ontimeout = () => reject(new Error('Upload timed out: try a smaller file or a better connection'));
    xhr.timeout = 10 * 60 * 1000;
    xhr.onload = () => {
      const data = parseBody(xhr.responseText);
      if (xhr.status === 401 && currentToken) onUnauthorized();
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const blocked = /captcha|bot verification/i.test(xhr.responseText);
      reject(Object.assign(new Error(data.error || (blocked ? "The server's bot protection blocked the upload" : `Upload failed (${xhr.status})`)), { details: data.details }));
    };
    xhr.send(form);
  });
}

const Ctx = createContext(null);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('idle');          // idle | connecting | online | offline
  const [everConnected, setEverConnected] = useState(false);
  const [songs, setSongs] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [room, setRoom] = useState(null);                 // full state of the booth we're inside
  const [feed, setFeed] = useState([]);                   // chat messages + reactions for that booth
  const [knocks, setKnocks] = useState([]);               // host only: people waiting at the door
  const [notice, setNotice] = useState(null);             // { kind: 'closed'|'removed'|'declined'|'approved', roomId }
  const sockRef = useRef(null);
  const offsetRef = useRef(0);                            // serverNow - Date.now()
  const roomIdRef = useRef(null);

  const signIn = useCallback(async ({ token, user }) => {
    currentToken = token;
    await store.set('session', JSON.stringify({ token, user }));
    setUser(user);
  }, []);
  const signOut = useCallback(async () => {
    currentToken = null;
    await store.set('session', null);
    sockRef.current?.close();
    setUser(null); setRoom(null); setStatus('idle');
  }, []);

  useEffect(() => { onUnauthorized = signOut; }, [signOut]);

  useEffect(() => {
    store.get('session').then((raw) => {
      try { const s = JSON.parse(raw); if (s?.token) { currentToken = s.token; setUser(s.user); } } catch {}
      setReady(true);
    });
  }, []);

  const loadSongs = useCallback(() => api('/songs').then(setSongs).catch(() => {}), []);
  useEffect(() => { if (user) loadSongs(); }, [user, loadSongs]);

  useEffect(() => {
    if (!user) return;
    setStatus('connecting');
    let s = null, cancelled = false;
    (async () => {
      const cfg = await api('/config').catch(() => ({}));
      if (cancelled) return;
      const url = cfg.socket_url || SOCKET_URL;
      // Render free tier sleeps; wake it over plain HTTP while socket.io retries with backoff.
      fetch(url).catch(() => {});
      s = io(url, {
        auth: { token: currentToken }, transports: ['websocket'],
        reconnectionDelay: 1000, reconnectionDelayMax: 10000, timeout: 20000,
      });
      sockRef.current = s;
      if (Platform.OS === 'web') window.__socket = s;   // debug handle for tests and devtools

      s.on('connect', async () => {
        setStatus('online'); setEverConnected(true);
        // Clock offset: keep the lowest-latency of three pings.
        let best = Infinity;
        for (let i = 0; i < 3; i++) {
          const t0 = Date.now();
          const { now } = await s.timeout(5000).emitWithAck('time_sync', {}).catch(() => ({}));
          const t1 = Date.now();
          if (now && t1 - t0 < best) { best = t1 - t0; offsetRef.current = now - (t0 + t1) / 2; }
        }
        s.emit('list_rooms', {}, setRooms);
        if (roomIdRef.current) {  // back from a drop: reclaim our seat (the server holds it for 30 s)
          s.emit('request_entry', { roomId: roomIdRef.current }, (r) => {
            if (r?.status === 'inside') setRoom(r.room);
            else if (r?.error) { setRoom(null); setNotice({ kind: 'closed', roomId: roomIdRef.current }); }
          });
        }
      });
      s.on('disconnect', () => setStatus('offline'));
      s.on('connect_error', (e) => { setStatus('offline'); if (e.message === 'unauthorized') signOut(); });
      s.on('rooms_updated', setRooms);
      s.on('room_state', (r) => { if (r.id === roomIdRef.current) setRoom(r); });
      s.on('chat_message', (m) => setFeed((f) => [...f.slice(-30), m]));
      s.on('reaction', (m) => setFeed((f) => [...f.slice(-30), { ...m, text: m.kind, reaction: true }]));
      s.on('admission_requested', ({ knocks }) => setKnocks(knocks));
      s.on('entry_approved', ({ room }) => { roomIdRef.current = room.id; setRoom(room); setFeed(room.chat); setNotice({ kind: 'approved', roomId: room.id }); });
      s.on('entry_declined', ({ roomId }) => setNotice({ kind: 'declined', roomId }));
      const gone = (kind) => ({ roomId }) => {
        if (roomId === roomIdRef.current) { roomIdRef.current = null; setRoom(null); }
        setNotice({ kind, roomId });
      };
      s.on('room_closed', gone('closed'));
      s.on('removed', gone('removed'));
    })();
    return () => { cancelled = true; s?.close(); sockRef.current = null; };
  }, [user, signOut]);

  // Promise-style emit; resolves with the server's ack, rejects with { error }.
  const emit = useCallback((event, data = {}) => new Promise((resolve, reject) => {
    const s = sockRef.current;
    if (!s?.connected) return reject(new Error('Still lighting the lamp… try again in a moment'));
    s.timeout(10000).emit(event, data, (err, res) => {
      if (err) return reject(new Error('The booth did not answer'));
      if (res?.error) return reject(new Error(res.error));
      resolve(res);
    });
  }), []);

  const enterRoom = useCallback((r) => { roomIdRef.current = r.id; setRoom(r); setFeed(r.chat || []); setKnocks([]); }, []);
  const leaveRoom = useCallback(() => {
    const id = roomIdRef.current;
    roomIdRef.current = null; setRoom(null); setFeed([]); setKnocks([]);
    if (id) emit('leave_room', { roomId: id }).catch(() => {});
  }, [emit]);
  const subscribe = useCallback((event, fn) => {
    const s = sockRef.current;
    s?.on(event, fn);
    return () => s?.off(event, fn);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const value = {
    ready, user, status, everConnected, songs, loadSongs, rooms, room, feed, knocks, notice, setNotice,
    signIn, signOut, emit, subscribe, enterRoom, leaveRoom, serverNow,
  };
  return createElement(Ctx.Provider, { value }, children);
}
