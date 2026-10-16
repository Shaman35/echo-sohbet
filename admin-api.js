'use strict';

// Yönetim paneli: /admin
// Tek kullanıcı (site sahibi). Şifre ADMIN_PASSWORD ortam değişkeninden gelir; koda yazılmaz.

const crypto = require('crypto');
const path = require('path');
const express = require('express');

const ADMIN_DIR = path.join(__dirname, 'admin');
const COOKIE = 'echo_admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_GLOBAL = 50;
const PAGE_SIZE = 50;
const KEY_RE = /^[A-Za-z0-9_-]{4,64}$/;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

function mountAdmin(app, { store, rooms, password }) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  if (!password) {
    router.use((req, res) => {
      res.status(503).type('text/plain; charset=utf-8')
        .send('Yönetim paneli kapalı: sunucuda ADMIN_PASSWORD tanımlı değil.');
    });
    app.use('/admin', router);
    return;
  }

  const passwordHash = sha256(password);
  const sessions = new Map(); // token -> bitiş zamanı
  const fails = new Map(); // ip -> { count, until }
  let globalFails = { count: 0, until: 0 };

  function readToken(req) {
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)echo_admin=([a-f0-9]{64})/);
    return m ? m[1] : null;
  }

  function isAuthed(req) {
    const token = readToken(req);
    if (!token) return false;
    const exp = sessions.get(token);
    if (!exp || exp < Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  }

  function requireAuth(req, res, next) {
    if (isAuthed(req)) return next();
    res.status(401).json({ error: 'unauthorized' });
  }

  function bump(entry, now) {
    const cur = entry && entry.until > now ? entry : { count: 0, until: now + FAIL_WINDOW_MS };
    cur.count++;
    return cur;
  }

  router.get('/', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'index.html')));
  router.use('/static', express.static(ADMIN_DIR, { index: false }));

  router.post('/api/login', express.json({ limit: '2kb' }), (req, res) => {
    const now = Date.now();
    const ip = req.ip;
    const f = fails.get(ip);
    const blocked =
      (f && f.until > now && f.count >= MAX_FAILS_PER_IP) ||
      (globalFails.until > now && globalFails.count >= MAX_FAILS_GLOBAL);
    if (blocked) {
      const until = Math.max(f?.until || 0, globalFails.until);
      return res.status(429).json({ error: 'too-many', retryAfterSec: Math.ceil((until - now) / 1000) });
    }

    const input = req.body?.password;
    const ok = typeof input === 'string' && crypto.timingSafeEqual(sha256(input), passwordHash);
    if (!ok) {
      fails.set(ip, bump(f, now));
      globalFails = bump(globalFails, now);
      console.warn(`[admin] hatalı giriş denemesi: ${ip}`);
      return res.status(401).json({ error: 'wrong-password' });
    }

    fails.delete(ip);
    for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, now + SESSION_TTL_MS);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      maxAge: SESSION_TTL_MS,
      path: '/admin',
    });
    console.log(`[admin] giriş yapıldı: ${ip}`);
    res.json({ ok: true });
  });

  router.post('/api/logout', (req, res) => {
    const token = readToken(req);
    if (token) sessions.delete(token);
    res.clearCookie(COOKIE, { path: '/admin' });
    res.json({ ok: true });
  });

  router.get('/api/me', (req, res) => res.json({ authed: isAuthed(req) }));

  router.get('/api/rooms', requireAuth, async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim().slice(0, 100);
      const page = Math.max(0, parseInt(req.query.page, 10) || 0);
      const list = await store.listRooms({ q, limit: PAGE_SIZE, offset: page * PAGE_SIZE });

      let online = 0;
      for (const room of rooms.values()) online += room.members.size;

      res.json({
        rooms: list.map((r) => ({
          ...r,
          active: rooms.has(r.key),
          online: rooms.get(r.key)?.members.size || 0,
        })),
        hasMore: list.length === PAGE_SIZE,
        storage: store.kind,
        live: { rooms: rooms.size, users: online },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/rooms/:key', requireAuth, async (req, res, next) => {
    try {
      const { key } = req.params;
      if (!KEY_RE.test(key)) return res.status(400).json({ error: 'invalid-key' });
      const events = await store.getRoom(key);
      const live = rooms.get(key);
      res.json({
        key,
        active: !!live,
        online: live
          ? [...live.members.values()].map((m) => ({ num: m.num, nick: m.nick, voice: m.voice, ip: m.ip }))
          : [],
        events,
      });
    } catch (err) {
      next(err);
    }
  });

  router.use((err, req, res, next) => {
    console.error('[admin]', err);
    res.status(500).json({ error: 'server' });
  });

  app.use('/admin', router);
}

module.exports = { mountAdmin };
