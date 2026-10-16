'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { createStore } = require('./store');
const { mountAdmin } = require('./admin-api');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOG_RETENTION_DAYS = Math.max(1, parseInt(process.env.LOG_RETENTION_DAYS, 10) || 30);
// Ses mesh mimarisinde her kullanıcı herkese ayrı akış gönderir; 6 kişi rahat sınırdır.
const ROOM_CAPACITY = Math.max(2, parseInt(process.env.ROOM_CAPACITY, 10) || 6);
const KEY_RE = /^[A-Za-z0-9_-]{4,64}$/;
const HISTORY_LIMIT = 200;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_NICK_LENGTH = 20;
const MOD_NICK = 'Moderatör';
const MOD_TICKET_TTL_MS = 2 * 60 * 1000;

function cleanNick(nick) {
  if (typeof nick !== 'string') return '';
  return nick.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NICK_LENGTH);
}

const store = createStore({
  databaseUrl: process.env.DATABASE_URL,
  dataDir: path.join(__dirname, 'data'),
});

// Kayıt yazımı sohbeti asla bloklamaz; hata olursa sadece günlüğe düşer.
function record(room, type, fields = {}) {
  store.log({ room, type, ts: Date.now(), ...fields }).catch((err) => {
    console.error('[log]', err.message);
  });
}

// Render gibi bir proxy arkasında gerçek istemci IP'si X-Forwarded-For'un ilk girdisidir.
function clientIp(socket) {
  const fwd = socket.handshake.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return socket.handshake.address;
}

// Moderatör biletleri: panelde kimliği doğrulanmış admin, bir odaya görünür
// moderatör olarak girmek için tek kullanımlık, kısa ömürlü bir bilet alır.
const modTickets = new Map(); // token -> { key, exp }

function issueModTicket(roomKey) {
  const now = Date.now();
  for (const [t, v] of modTickets) if (v.exp < now) modTickets.delete(t);
  const token = crypto.randomBytes(24).toString('hex');
  modTickets.set(token, { key: roomKey, exp: now + MOD_TICKET_TTL_MS });
  return token;
}

function consumeModTicket(token, roomKey) {
  if (typeof token !== 'string') return false;
  const t = modTickets.get(token);
  if (!t) return false;
  modTickets.delete(token);
  return t.exp >= Date.now() && t.key === roomKey;
}

// Oda kapasitesi yalnızca normal katılımcıları sayar; moderatör sınıra dahil değildir.
function countNormal(room) {
  let n = 0;
  for (const m of room.members.values()) if (!m.mod) n++;
  return n;
}

const app = express();
app.set('trust proxy', true);
app.use(express.static(PUBLIC_DIR));

// Odaya Katıl akışı, yanlış yazılmış bir anahtarla boş oda açılmasın diye önce bunu sorar.
app.get('/api/rooms/:key', (req, res) => {
  const { key } = req.params;
  const room = KEY_RE.test(key) ? rooms.get(key) : null;
  res.json({ exists: !!room, full: !!room && countNormal(room) >= ROOM_CAPACITY, capacity: ROOM_CAPACITY });
});

app.get('/r/:key', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const server = http.createServer(app);
const io = new Server(server);

// key -> { members: Map<socketId, { num, nick, ip, voice, muted, speaking }>, history: [] }
const rooms = new Map();

mountAdmin(app, { store, rooms, password: process.env.ADMIN_PASSWORD, issueModTicket });

function lowestFreeNumber(room) {
  const used = new Set([...room.members.values()].map((m) => m.num));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

function serializeMembers(room) {
  return [...room.members.entries()].map(([id, m]) => ({
    id,
    num: m.num,
    nick: m.nick,
    mod: m.mod,
    voice: m.voice,
    muted: m.muted,
    speaking: m.speaking,
  }));
}

io.on('connection', (socket) => {
  let key = null;
  const ip = clientIp(socket);

  const currentRoom = () => (key ? rooms.get(key) : null);
  const me = () => currentRoom()?.members.get(socket.id) || null;

  socket.on('join', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (key) return ack({ error: 'already-joined' });
    const requestedKey = payload?.key;
    if (typeof requestedKey !== 'string' || !KEY_RE.test(requestedKey)) {
      return ack({ error: 'invalid-key' });
    }

    // Moderatör girişi: yalnızca geçerli, tek kullanımlık bir bilet kabul edilir.
    const isMod = payload.modToken != null;
    if (isMod && !consumeModTicket(payload.modToken, requestedKey)) {
      return ack({ error: 'mod-denied' });
    }

    let room = rooms.get(requestedKey);
    if (!isMod && room && countNormal(room) >= ROOM_CAPACITY) {
      record(requestedKey, 'join_rejected', { nick: cleanNick(payload.nick) || null, ip });
      return ack({ error: 'room-full', capacity: ROOM_CAPACITY });
    }
    // Moderatör boş bir oda açmaz; oda yoksa giriş reddedilir.
    if (!room && isMod) {
      return ack({ error: 'room-closed' });
    }
    if (!room) {
      room = { members: new Map(), history: [] };
      rooms.set(requestedKey, room);
      record(requestedKey, 'room_open', { ip });
    }

    const num = isMod ? null : lowestFreeNumber(room);
    const nick = isMod ? MOD_NICK : (cleanNick(payload.nick) || String(num));
    const member = { num, nick, mod: isMod, ip, voice: false, muted: false, speaking: false };
    room.members.set(socket.id, member);
    key = requestedKey;
    socket.join(key);
    record(key, isMod ? 'mod_join' : 'join', {
      num, nick, ip, text: socket.handshake.headers['user-agent']?.slice(0, 300),
    });

    socket.to(key).emit('member-joined', { id: socket.id, num, nick, mod: isMod, voice: false, muted: false, speaking: false });
    ack({
      self: { id: socket.id, num, nick, mod: isMod },
      members: serializeMembers(room),
      history: room.history,
      capacity: ROOM_CAPACITY,
    });
  });

  socket.on('chat', (text) => {
    const room = currentRoom();
    const m = me();
    if (!room || !m || typeof text !== 'string') return;
    const clean = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!clean) return;

    const msg = { id: socket.id, num: m.num, nick: m.nick, text: clean, ts: Date.now() };
    room.history.push(msg);
    if (room.history.length > HISTORY_LIMIT) room.history.shift();
    io.to(key).emit('chat', msg);
    record(key, 'chat', { num: m.num, nick: m.nick, text: clean });
  });

  socket.on('voice-join', (ack) => {
    const room = currentRoom();
    const m = me();
    if (!room || !m || typeof ack !== 'function') return;

    // Yeni gelen, sesli sohbetteki herkese teklif (offer) gönderir: mesh.
    const peers = [...room.members.entries()]
      .filter(([id, other]) => id !== socket.id && other.voice)
      .map(([id]) => id);

    m.voice = true;
    m.muted = false;
    m.speaking = false;
    socket.to(key).emit('voice-state', { id: socket.id, voice: true, muted: false });
    ack({ peers });
    record(key, 'voice_join', { num: m.num, nick: m.nick });
  });

  socket.on('voice-leave', () => {
    const m = me();
    if (!m || !m.voice) return;
    m.voice = false;
    m.muted = false;
    m.speaking = false;
    socket.to(key).emit('voice-state', { id: socket.id, voice: false, muted: false });
    record(key, 'voice_leave', { num: m.num, nick: m.nick });
  });

  socket.on('mute', (muted) => {
    const m = me();
    if (!m || !m.voice) return;
    m.muted = !!muted;
    if (m.muted) m.speaking = false;
    socket.to(key).emit('voice-state', { id: socket.id, voice: true, muted: m.muted });
  });

  socket.on('speaking', (speaking) => {
    const m = me();
    if (!m || !m.voice) return;
    m.speaking = !!speaking && !m.muted;
    socket.to(key).emit('speaking', { id: socket.id, speaking: m.speaking });
  });

  // WebRTC signaling: SDP ve ICE adaylarını yalnızca aynı odadaki eşe iletir.
  socket.on('signal', (payload) => {
    const room = currentRoom();
    if (!room || !payload || typeof payload.to !== 'string') return;
    if (!room.members.has(payload.to)) return;
    io.to(payload.to).emit('signal', { from: socket.id, data: payload.data });
  });

  socket.on('disconnect', () => {
    const room = currentRoom();
    const m = me();
    if (!room || !m) return;
    room.members.delete(socket.id);
    socket.to(key).emit('member-left', { id: socket.id });
    record(key, m.mod ? 'mod_leave' : 'leave', { num: m.num, nick: m.nick });
    // Oda yalnızca normal katılımcı kalmayınca kapanır; tek başına moderatör odayı tutmaz.
    if (countNormal(room) === 0) {
      for (const id of room.members.keys()) io.to(id).emit('room-empty');
      rooms.delete(key);
      record(key, 'room_close');
    }
  });
});

async function purgeOldLogs() {
  try {
    const removed = await store.purgeOlderThan(LOG_RETENTION_DAYS);
    if (removed) console.log(`[log] ${LOG_RETENTION_DAYS} günden eski ${removed} kayıt silindi`);
  } catch (err) {
    console.error('[log] temizleme hatası:', err.message);
  }
}

(async () => {
  await store.init();
  console.log(`[log] kayıt deposu: ${store.kind === 'postgres' ? 'Postgres' : 'yerel dosya (data/)'}`);
  if (!process.env.ADMIN_PASSWORD) console.warn('[admin] ADMIN_PASSWORD tanımlı değil, /admin kapalı');

  await purgeOldLogs();
  setInterval(purgeOldLogs, 6 * 60 * 60 * 1000).unref();

  server.listen(PORT, () => {
    console.log(`Mat Sohbet çalışıyor: http://localhost:${PORT}`);
  });
})().catch((err) => {
  console.error('Başlatılamadı:', err);
  process.exit(1);
});
