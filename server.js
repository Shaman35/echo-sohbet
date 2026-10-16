'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const KEY_RE = /^[A-Za-z0-9_-]{4,64}$/;
const HISTORY_LIMIT = 200;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_NICK_LENGTH = 20;

function cleanNick(nick) {
  if (typeof nick !== 'string') return '';
  return nick.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NICK_LENGTH);
}

const app = express();
app.use(express.static(PUBLIC_DIR));

// Odaya Katıl akışı, yanlış yazılmış bir anahtarla boş oda açılmasın diye önce bunu sorar.
app.get('/api/rooms/:key', (req, res) => {
  const { key } = req.params;
  res.json({ exists: KEY_RE.test(key) && rooms.has(key) });
});

app.get('/r/:key', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const server = http.createServer(app);
const io = new Server(server);

// key -> { members: Map<socketId, { num, voice, speaking }>, history: [] }
const rooms = new Map();

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
    voice: m.voice,
    muted: m.muted,
    speaking: m.speaking,
  }));
}

io.on('connection', (socket) => {
  let key = null;

  const currentRoom = () => (key ? rooms.get(key) : null);
  const me = () => currentRoom()?.members.get(socket.id) || null;

  socket.on('join', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (key) return ack({ error: 'already-joined' });
    const requestedKey = payload?.key;
    if (typeof requestedKey !== 'string' || !KEY_RE.test(requestedKey)) {
      return ack({ error: 'invalid-key' });
    }

    let room = rooms.get(requestedKey);
    if (!room) {
      room = { members: new Map(), history: [] };
      rooms.set(requestedKey, room);
    }

    const num = lowestFreeNumber(room);
    const nick = cleanNick(payload.nick) || String(num);
    room.members.set(socket.id, { num, nick, voice: false, muted: false, speaking: false });
    key = requestedKey;
    socket.join(key);

    socket.to(key).emit('member-joined', { id: socket.id, num, nick, voice: false, muted: false, speaking: false });
    ack({ self: { id: socket.id, num, nick }, members: serializeMembers(room), history: room.history });
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
  });

  socket.on('voice-leave', () => {
    const m = me();
    if (!m || !m.voice) return;
    m.voice = false;
    m.muted = false;
    m.speaking = false;
    socket.to(key).emit('voice-state', { id: socket.id, voice: false, muted: false });
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
    if (!room) return;
    room.members.delete(socket.id);
    socket.to(key).emit('member-left', { id: socket.id });
    if (room.members.size === 0) rooms.delete(key);
  });
});

server.listen(PORT, () => {
  console.log(`Mat Sohbet çalışıyor: http://localhost:${PORT}`);
});
