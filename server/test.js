// Smoke test: knock -> admit -> chat -> queue -> host-only guard -> close. Run: npm test
process.env.JWT_SECRET = 'test-secret';
process.env.PORT = '3999';
const crypto = require('crypto');
const assert = require('assert');
const { io: ioc } = require('socket.io-client');
const { server, io } = require('./server');

const b64u = (s) => Buffer.from(s).toString('base64url');
const token = (sub, name) => {
  const h = b64u('{"alg":"HS256","typ":"JWT"}'), b = b64u(JSON.stringify({ sub, name, exp: Date.now() / 1000 + 60 }));
  return `${h}.${b}.${crypto.createHmac('sha256', 'test-secret').update(`${h}.${b}`).digest('base64url')}`;
};
const connect = (t) => ioc('http://localhost:3999', { auth: { token: t }, transports: ['websocket'] });
const within = (p, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out: ${what}`)), 3000))]);
const emit = (s, ev, d) => within(new Promise((res) => s.emit(ev, d, res)), `ack ${ev}`);
const once = (s, ev) => within(new Promise((res) => s.once(ev, res)), `event ${ev}`);

(async () => {
  const bad = connect('nope');
  assert.equal((await once(bad, 'connect_error')).message, 'unauthorized');
  bad.close();

  const host = connect(token(1, 'Kenji')), guest = connect(token(2, 'Aster'));
  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);

  const { room } = await emit(host, 'create_room', { name: 'Ramen-ya at 2am', knock: true, level: 'N5' });
  assert.equal(room.hostId, '1');

  const asked = once(host, 'admission_requested');
  assert.equal((await emit(guest, 'request_entry', { roomId: room.id })).status, 'waiting');
  assert.deepEqual((await asked).knocks, [{ id: '2', name: 'Aster' }]);

  assert.match((await emit(guest, 'approve_entry', { roomId: room.id, userId: '2' })).error, /not inside/);
  const approved = once(guest, 'entry_approved');
  await emit(host, 'approve_entry', { roomId: room.id, userId: '2' });
  assert.equal((await approved).room.members.length, 2);

  const chat = once(host, 'chat_message');
  await emit(guest, 'chat_message', { roomId: room.id, text: '灯り = akari' });
  assert.equal((await chat).text, '灯り = akari');

  const started = once(host, 'song_started');
  await emit(guest, 'join_queue', { roomId: room.id, song: { id: 1, title: 'Yoru', duration_s: 48 } });
  const s = await started;
  assert.equal(s.songId, 1);
  assert.ok(s.startedAt > Date.now());

  assert.match((await emit(guest, 'skip_song', { roomId: room.id })).error, /Only the host/);
  assert.match((await emit(guest, 'close_room', { roomId: room.id })).error, /Only the host/);

  // voice: guest can't signal before joining; newcomer gets the peers already on voice; signals are relayed
  assert.match((await emit(guest, 'voice_signal', { roomId: room.id, to: '1', data: {} })).error, /not on voice/);
  assert.deepEqual((await emit(host, 'voice_join', { roomId: room.id })).peers, []);
  assert.deepEqual((await emit(guest, 'voice_join', { roomId: room.id })).peers, ['1']);
  const sig = once(host, 'voice_signal');
  await emit(guest, 'voice_signal', { roomId: room.id, to: '1', data: { sdp: 'offer' } });
  assert.deepEqual(await sig, { from: '2', data: { sdp: 'offer' } });
  const left = once(host, 'voice_left');
  await emit(guest, 'voice_leave', { roomId: room.id });
  assert.equal((await left).userId, '2');

  const removed = once(guest, 'removed');
  await emit(host, 'remove_member', { roomId: room.id, userId: '2' });
  await removed;

  const closed = once(host, 'room_closed');
  await emit(host, 'close_room', { roomId: room.id });
  await closed;
  assert.equal((await emit(host, 'list_rooms')).length, 0);

  host.close(); guest.close(); io.close(); server.close();
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
