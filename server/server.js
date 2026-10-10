// Tomoshibi real-time server (Render free tier). All live state is in memory; nothing here touches MySQL.
// Auth: JWTs are issued by the PHP API on Hostinger and verified here with the shared JWT_SECRET.
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET is not set');
const ORIGINS = (process.env.CLIENT_ORIGIN || '*').split(',').map((s) => s.trim());
const GRACE_MS = 30_000;          // keep a dropped member's seat this long (weak networks reconnect)
const MAX_ROOMS = 200, MAX_MEMBERS = 20, CHAT_KEEP = 40;
const MAX_VOICE = 8;               // voice is a peer-to-peer mesh; keep it small
const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1', 'Any'];
const REACTIONS = ['Nice!', 'Encore', 'Clap'];

function verifyJwt(token) {
  if (typeof token !== 'string') return null;
  const [h, b, s] = token.split('.');
  if (!s) return null;
  const want = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
  if (want.length !== s.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null;
  try {
    const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
    return claims.exp * 1000 > Date.now() ? claims : null;
  } catch { return null; }
}

const server = http.createServer((req, res) => {
  // Health check + cold-start wake-up ping.
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify({ ok: true, now: Date.now() }));
});
const io = new Server(server, {
  cors: { origin: ORIGINS.includes('*') ? '*' : ORIGINS },
  maxHttpBufferSize: 64_000,        // room for WebRTC SDP offers
});

/** @type {Map<string, any>} */
const rooms = new Map();

const summary = (r) => ({
  id: r.id, name: r.name, color: r.color, level: r.level, knock: r.knock,
  count: r.members.size, hostName: r.members.get(r.hostId)?.name || '',
  nowTitle: r.now?.title || null, nowSinger: r.now?.singerName || null,
});
const roomState = (r) => ({
  ...summary(r), hostId: r.hostId,
  members: [...r.members.values()].map((m) => ({ id: m.id, name: m.name, online: !!m.socketId, voice: !!m.voice, muted: !!m.muted })),
  queue: r.queue, now: r.now, chat: r.chat,
});
const lobby = () => io.to('lobby').emit('rooms_updated', [...rooms.values()].map(summary));
function broadcast(r, membersChanged) {
  io.to(r.id).emit('room_state', roomState(r));
  if (membersChanged) io.to(r.id).emit('user_list_updated', roomState(r).members);
  lobby();
}
const knockList = (r) => [...r.knocks.values()].map(({ id, name }) => ({ id, name }));
const notifyHost = (r, extra) => {
  const host = r.members.get(r.hostId);
  if (host?.socketId) io.to(host.socketId).emit('admission_requested', { ...extra, knocks: knockList(r) });
};

function addMember(r, user, socketId) {
  const old = r.members.get(user.id);
  if (old) clearTimeout(old.leaveTimer);
  r.members.set(user.id, { id: user.id, name: user.name, socketId, joinedAt: old?.joinedAt || Date.now(), voice: false, muted: false });
  if (old?.voice) io.to(r.id).emit('voice_left', { userId: user.id });   // a rejoin starts voice fresh
  io.sockets.sockets.get(socketId)?.join(r.id);
}
function removeMember(r, userId) {
  const m = r.members.get(userId);
  if (!m) return;
  clearTimeout(m.leaveTimer);
  r.members.delete(userId);
  if (m.voice) io.to(r.id).emit('voice_left', { userId });
  if (m.socketId) io.sockets.sockets.get(m.socketId)?.leave(r.id);
  r.queue = r.queue.filter((q) => q.userId !== userId);
  if (!r.members.size) return closeRoom(r, false);
  if (r.hostId === userId) {
    r.hostId = [...r.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
    notifyHost(r, {});
  }
  if (r.now?.singerId === userId) return advance(r, 'singer_left');
  broadcast(r, true);
}
function closeRoom(r, notify = true) {
  clearTimeout(r.endTimer);
  for (const m of r.members.values()) clearTimeout(m.leaveTimer);
  if (notify) io.to(r.id).emit('room_closed', { roomId: r.id });
  for (const k of r.knocks.values()) io.to(k.socketId).emit('room_closed', { roomId: r.id });
  io.in(r.id).socketsLeave(r.id);
  rooms.delete(r.id);
  lobby();
}

// ---- playback: the server only stores { songId, startedAt }; clients sync audio themselves ----
const position = (now) => (now.pausedAt != null ? now.pausedAt : (Date.now() - now.startedAt) / 1000);
function scheduleEnd(r) {
  clearTimeout(r.endTimer);
  if (!r.now || r.now.pausedAt != null || !r.now.durationS) return;
  r.endTimer = setTimeout(() => advance(r, 'ended'), (r.now.durationS - position(r.now)) * 1000 + 1500);
}
function advance(r, reason) {
  clearTimeout(r.endTimer);
  if (r.now) io.to(r.id).emit('song_skipped', { songId: r.now.songId, reason });
  const next = r.queue.shift();
  r.now = next ? { songId: next.songId, title: next.title, singerId: next.userId, singerName: next.name,
                   durationS: next.durationS, startedAt: Date.now() + 1500, pausedAt: null } : null;
  // startedAt is 1.5 s in the future so every client has time to load before the first note.
  if (r.now) io.to(r.id).emit('song_started', { songId: r.now.songId, startedAt: r.now.startedAt });
  scheduleEnd(r);
  broadcast(r, false);
}

io.use((socket, next) => {
  const c = verifyJwt(socket.handshake.auth?.token);
  if (!c) return next(new Error('unauthorized'));
  socket.data.user = { id: String(c.sub), name: String(c.name || 'guest').slice(0, 24) };
  next();
});

io.on('connection', (socket) => {
  const me = socket.data.user;
  let lastChat = 0;
  const on = (event, fn) => socket.on(event, (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try { fn(data && typeof data === 'object' ? data : {}, reply); } catch (e) { console.error(event, e); reply({ error: 'Server error' }); }
  });
  // Look up a room the sender is in; host-only events also check the sender is the host.
  const roomFor = (d, reply, { host = false, member = true } = {}) => {
    const r = rooms.get(String(d.roomId));
    if (!r) return reply({ error: 'This booth has closed' }), null;
    if (member && r.members.get(me.id)?.socketId !== socket.id) return reply({ error: 'You are not inside this booth' }), null;
    if (host && r.hostId !== me.id) return reply({ error: 'Only the host can do that' }), null;
    return r;
  };

  on('time_sync', (_, reply) => reply({ now: Date.now() }));

  on('list_rooms', (_, reply) => {
    socket.join('lobby');
    reply([...rooms.values()].map(summary));
  });

  on('create_room', (d, reply) => {
    const name = String(d.name || '').trim().slice(0, 40);
    if (!name) return reply({ error: 'Give your booth a name' });
    if (rooms.size >= MAX_ROOMS) return reply({ error: 'Too many booths open right now' });
    const r = {
      id: crypto.randomBytes(4).toString('hex'), name,
      color: /^#[0-9a-fA-F]{6}$/.test(d.color) ? d.color : '#E11D2B',
      level: LEVELS.includes(d.level) ? d.level : 'Any',
      knock: d.knock !== false, hostId: me.id,
      members: new Map(), knocks: new Map(), queue: [], now: null, chat: [], endTimer: null,
    };
    rooms.set(r.id, r);
    addMember(r, me, socket.id);
    broadcast(r, true);
    reply({ room: roomState(r) });
  });

  on('request_entry', (d, reply) => {
    const r = roomFor(d, reply, { member: false });
    if (!r) return;
    if (r.members.has(me.id) || !r.knock) {   // rejoin after a drop, or open-door booth
      if (!r.members.has(me.id) && r.members.size >= MAX_MEMBERS) return reply({ error: 'This booth is full' });
      addMember(r, me, socket.id);
      broadcast(r, true);
      return reply({ status: 'inside', room: roomState(r) });
    }
    if (r.members.size >= MAX_MEMBERS) return reply({ error: 'This booth is full' });
    r.knocks.set(me.id, { ...me, socketId: socket.id });
    notifyHost(r, { userId: me.id, name: me.name });
    reply({ status: 'waiting', room: summary(r) });
  });

  on('cancel_entry', (d, reply) => {
    const r = rooms.get(String(d.roomId));
    if (r?.knocks.delete(me.id)) notifyHost(r, {});
    reply({ ok: true });
  });

  on('approve_entry', (d, reply) => {
    const r = roomFor(d, reply, { host: true });
    if (!r) return;
    const k = r.knocks.get(String(d.userId));
    if (!k) return reply({ error: 'They stopped knocking' });
    r.knocks.delete(k.id);
    addMember(r, k, k.socketId);
    io.to(k.socketId).emit('entry_approved', { room: roomState(r) });
    notifyHost(r, {});
    broadcast(r, true);
    reply({ ok: true });
  });

  on('decline_entry', (d, reply) => {
    const r = roomFor(d, reply, { host: true });
    if (!r) return;
    const k = r.knocks.get(String(d.userId));
    if (k) { r.knocks.delete(k.id); io.to(k.socketId).emit('entry_declined', { roomId: r.id }); }
    notifyHost(r, {});
    reply({ ok: true });
  });

  on('remove_member', (d, reply) => {
    const r = roomFor(d, reply, { host: true });
    if (!r) return;
    const m = r.members.get(String(d.userId));
    if (!m || m.id === me.id) return reply({ error: 'Cannot remove that person' });
    if (m.socketId) io.to(m.socketId).emit('removed', { roomId: r.id });
    removeMember(r, m.id);
    reply({ ok: true });
  });

  on('leave_room', (d, reply) => {
    const r = rooms.get(String(d.roomId));
    if (r?.members.has(me.id)) removeMember(r, me.id);
    reply({ ok: true });
  });

  on('chat_message', (d, reply) => {
    const r = roomFor(d, reply);
    if (!r) return;
    const text = String(d.text || '').trim().slice(0, 200);
    if (!text) return reply({ error: 'Empty message' });
    if (Date.now() - lastChat < 700) return reply({ error: 'Slow down a little' });
    lastChat = Date.now();
    const msg = { id: crypto.randomBytes(4).toString('hex'), userId: me.id, name: me.name, text, at: Date.now() };
    r.chat.push(msg);
    if (r.chat.length > CHAT_KEEP) r.chat.shift();
    io.to(r.id).emit('chat_message', msg);
    reply({ ok: true });
  });

  on('reaction', (d, reply) => {
    const r = roomFor(d, reply);
    if (!r || !REACTIONS.includes(d.kind)) return;
    if (Date.now() - lastChat < 700) return reply({ error: 'Slow down a little' });
    lastChat = Date.now();
    io.to(r.id).emit('reaction', { id: crypto.randomBytes(4).toString('hex'), userId: me.id, name: me.name, kind: d.kind, at: Date.now() });
    reply({ ok: true });
  });

  on('join_queue', (d, reply) => {
    const r = roomFor(d, reply);
    if (!r) return;
    const s = d.song || {};
    const songId = Number(s.id);
    if (!Number.isInteger(songId) || songId <= 0) return reply({ error: 'Pick a song' });
    if (r.queue.some((q) => q.userId === me.id)) return reply({ error: 'You are already in line' });
    r.queue.push({ userId: me.id, name: me.name, songId, title: String(s.title || '').slice(0, 120),
                   durationS: Math.min(1800, Math.max(0, Number(s.duration_s) || 0)) });
    if (!r.now) advance(r, 'queued'); else broadcast(r, false);
    reply({ ok: true });
  });

  on('leave_queue', (d, reply) => {
    const r = roomFor(d, reply);
    if (!r) return;
    r.queue = r.queue.filter((q) => q.userId !== me.id);
    broadcast(r, false);
    reply({ ok: true });
  });

  on('pause_song', (d, reply) => {
    const r = roomFor(d, reply, { host: true });
    if (!r?.now || r.now.pausedAt != null) return reply({ ok: true });
    r.now.pausedAt = Math.max(0, position(r.now));
    scheduleEnd(r);
    io.to(r.id).emit('song_paused', { songId: r.now.songId, position: r.now.pausedAt });
    broadcast(r, false);
    reply({ ok: true });
  });

  on('resume_song', (d, reply) => {
    const r = roomFor(d, reply, { host: true });
    if (!r?.now || r.now.pausedAt == null) return reply({ ok: true });
    r.now.startedAt = Date.now() + 500 - r.now.pausedAt * 1000;
    r.now.pausedAt = null;
    scheduleEnd(r);
    io.to(r.id).emit('song_started', { songId: r.now.songId, startedAt: r.now.startedAt });
    broadcast(r, false);
    reply({ ok: true });
  });

  on('skip_song', (d, reply) => {
    const r = roomFor(d, reply, { host: true });
    if (!r) return;
    advance(r, 'skipped');
    reply({ ok: true });
  });

  on('set_knock_required', (d, reply) => {
    const r = roomFor(d, reply, { host: true });
    if (!r) return;
    r.knock = !!d.on;
    if (!r.knock) for (const k of r.knocks.values()) {   // door opened: let everyone waiting in
      addMember(r, k, k.socketId);
      io.to(k.socketId).emit('entry_approved', { room: roomState(r) });
    }
    if (!r.knock) r.knocks.clear();
    notifyHost(r, {});
    broadcast(r, true);
    reply({ ok: true });
  });

  // ---- voice chat: WebRTC mesh, the server only relays offers/answers/ICE between members ----
  on('voice_join', (d, reply) => {
    const r = roomFor(d, reply);
    if (!r) return;
    const m = r.members.get(me.id);
    const others = [...r.members.values()].filter((x) => x.voice && x.id !== me.id);
    if (!m.voice && others.length >= MAX_VOICE) return reply({ error: `Voice is full (${MAX_VOICE} people)` });
    m.voice = true; m.muted = false;
    broadcast(r, true);
    reply({ peers: others.map((x) => x.id) });   // the newcomer calls everyone already on voice
  });

  on('voice_leave', (d, reply) => {
    const r = roomFor(d, reply);
    if (!r) return;
    const m = r.members.get(me.id);
    if (m.voice) { m.voice = false; m.muted = false; io.to(r.id).emit('voice_left', { userId: me.id }); broadcast(r, true); }
    reply({ ok: true });
  });

  on('voice_mute', (d, reply) => {
    const r = roomFor(d, reply);
    if (!r) return;
    r.members.get(me.id).muted = !!d.muted;
    broadcast(r, true);
    reply({ ok: true });
  });

  on('voice_signal', (d, reply) => {
    const r = roomFor(d, reply);
    if (!r) return;
    const to = r.members.get(String(d.to));
    if (!r.members.get(me.id).voice || !to?.voice || !to.socketId) return reply({ error: 'They are not on voice' });
    io.to(to.socketId).emit('voice_signal', { from: me.id, data: d.data });
    reply({ ok: true });
  });

  on('close_room', (d, reply) => {
    const r = roomFor(d, reply, { host: true });
    if (!r) return;
    closeRoom(r);
    reply({ ok: true });
  });

  socket.on('disconnect', () => {
    for (const r of rooms.values()) {
      if (r.knocks.get(me.id)?.socketId === socket.id) { r.knocks.delete(me.id); notifyHost(r, {}); }
      const m = r.members.get(me.id);
      if (m?.socketId === socket.id) {
        m.socketId = null;
        if (m.voice) { m.voice = false; io.to(r.id).emit('voice_left', { userId: me.id }); }
        m.leaveTimer = setTimeout(() => removeMember(r, me.id), GRACE_MS);
        broadcast(r, true);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Tomoshibi socket server on :${PORT}`));
module.exports = { server, io };
