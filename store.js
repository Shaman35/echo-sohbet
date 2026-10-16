'use strict';

// Oda kayıtları (log) deposu.
// DATABASE_URL varsa Postgres'e yazar (Render gibi diski kalıcı olmayan ortamlar için şart),
// yoksa yerel geliştirme için data/events.jsonl dosyasına yazar.

const fs = require('fs');
const path = require('path');

const MAX_ROOM_EVENTS = 5000;

function createStore({ databaseUrl, dataDir }) {
  return databaseUrl ? createPgStore(databaseUrl) : createFileStore(dataDir);
}

function toRow(e) {
  return {
    room: e.room,
    ts: e.ts ?? Date.now(),
    type: e.type,
    num: e.num ?? null,
    nick: e.nick ?? null,
    ip: e.ip ?? null,
    text: e.text ?? null,
  };
}

/* ---------------- Postgres ---------------- */

function createPgStore(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString, max: 5 });
  pool.on('error', (err) => console.error('[db]', err.message));

  const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');
  const mapEvent = (r) => ({
    id: Number(r.id),
    ts: r.ts.getTime(),
    type: r.type,
    num: r.num,
    nick: r.nick,
    ip: r.ip,
    text: r.text,
  });

  return {
    kind: 'postgres',

    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS events (
          id       BIGSERIAL PRIMARY KEY,
          room_key TEXT        NOT NULL,
          ts       TIMESTAMPTZ NOT NULL DEFAULT now(),
          type     TEXT        NOT NULL,
          num      INTEGER,
          nick     TEXT,
          ip       TEXT,
          text     TEXT
        )`);
      await pool.query('CREATE INDEX IF NOT EXISTS events_room_idx ON events (room_key, id)');
      await pool.query('CREATE INDEX IF NOT EXISTS events_ts_idx ON events (ts)');
    },

    async log(e) {
      const r = toRow(e);
      await pool.query(
        'INSERT INTO events (room_key, ts, type, num, nick, ip, text) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [r.room, new Date(r.ts), r.type, r.num, r.nick, r.ip, r.text],
      );
    },

    async listRooms({ q, limit, offset }) {
      const params = [];
      let where = '';
      if (q) {
        params.push('%' + escapeLike(q) + '%');
        where = `WHERE room_key IN (
          SELECT room_key FROM events
          WHERE room_key ILIKE $1 OR nick ILIKE $1 OR text ILIKE $1 OR ip ILIKE $1)`;
      }
      params.push(limit, offset);
      const { rows } = await pool.query(
        `SELECT room_key,
                MIN(ts) AS created_at,
                MAX(ts) AS last_at,
                COUNT(*) FILTER (WHERE type = 'chat')::int AS messages,
                COUNT(DISTINCT nick) FILTER (WHERE type = 'join')::int AS people
         FROM events ${where}
         GROUP BY room_key
         ORDER BY MAX(ts) DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return rows.map((r) => ({
        key: r.room_key,
        createdAt: r.created_at.getTime(),
        lastAt: r.last_at.getTime(),
        messages: r.messages,
        people: r.people,
      }));
    },

    async getRoom(key) {
      const { rows } = await pool.query(
        'SELECT id, ts, type, num, nick, ip, text FROM events WHERE room_key = $1 ORDER BY id LIMIT $2',
        [key, MAX_ROOM_EVENTS],
      );
      return rows.map(mapEvent);
    },

    async purgeOlderThan(days) {
      const res = await pool.query('DELETE FROM events WHERE ts < now() - make_interval(days => $1)', [days]);
      return res.rowCount;
    },
  };
}

/* ---------------- Yerel dosya (geliştirme) ---------------- */

function createFileStore(dir) {
  const file = path.join(dir, 'events.jsonl');
  let events = [];
  let nextId = 1;
  let writing = Promise.resolve();

  const enqueue = (fn) => (writing = writing.then(fn, fn));
  const rewrite = () =>
    enqueue(() => fs.promises.writeFile(file, events.map((e) => JSON.stringify(e) + '\n').join('')));

  return {
    kind: 'file',

    async init() {
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(file)) return;
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { /* bozuk satırı atla */ }
      }
      nextId = events.reduce((max, e) => Math.max(max, e.id), 0) + 1;
    },

    async log(e) {
      const row = { id: nextId++, ...toRow(e) };
      events.push(row);
      await enqueue(() => fs.promises.appendFile(file, JSON.stringify(row) + '\n'));
    },

    async listRooms({ q, limit, offset }) {
      const needle = q ? q.toLocaleLowerCase('tr') : '';
      const byRoom = new Map();
      for (const e of events) {
        let r = byRoom.get(e.room);
        if (!r) {
          r = { key: e.room, createdAt: e.ts, lastAt: e.ts, messages: 0, nicks: new Set(), match: false };
          byRoom.set(e.room, r);
        }
        r.createdAt = Math.min(r.createdAt, e.ts);
        r.lastAt = Math.max(r.lastAt, e.ts);
        if (e.type === 'chat') r.messages++;
        if (e.type === 'join' && e.nick) r.nicks.add(e.nick);
        if (needle && !r.match) {
          r.match = [e.room, e.nick, e.text, e.ip].some((v) => v && v.toLocaleLowerCase('tr').includes(needle));
        }
      }
      return [...byRoom.values()]
        .filter((r) => !needle || r.match)
        .sort((a, b) => b.lastAt - a.lastAt)
        .slice(offset, offset + limit)
        .map(({ key, createdAt, lastAt, messages, nicks }) => ({ key, createdAt, lastAt, messages, people: nicks.size }));
    },

    async getRoom(key) {
      return events
        .filter((e) => e.room === key)
        .slice(0, MAX_ROOM_EVENTS)
        .map(({ room, ...rest }) => rest);
    },

    async purgeOlderThan(days) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const before = events.length;
      events = events.filter((e) => e.ts >= cutoff);
      if (events.length !== before) await rewrite();
      return before - events.length;
    },
  };
}

module.exports = { createStore };
