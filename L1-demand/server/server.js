/* 15.010 L1 — live submission backend.
 *
 * Students open /r/<room> on their phone, give a first name, a last initial and
 * one number. The instructor dashboard joins the same room over Socket.io and
 * receives the whole list on every change.
 *
 * State is in memory on purpose. A class poll is worth nothing an hour later,
 * and this way there is no database to provision or migrate. The trade is that
 * a server restart empties the room — so the dashboard keeps its own copy and
 * offers it back via `restore` when it reconnects to an empty room.
 *
 * Deployed to Render as `l1-demand`, source bound to the GitHub connection
 * so pushes to main deploy automatically.
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import QRCode from 'qrcode';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT      = process.env.PORT || 3000;
const ORIGINS   = process.env.ALLOWED_ORIGINS || '*';
const MAX_WTP   = 30;          // must match MAX_WTP in the dashboard
const MAX_NAME  = 24;
const MAX_ROOMS = 50;          // a stray room code should not grow memory forever
const MAX_PER_ROOM = 600;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* room -> Map(deviceToken -> {id, name, wtp, ts})
   Keyed by device token so a student who answers twice REPLACES their answer
   rather than appearing on the curve twice. */
const rooms = new Map();

const normRoom = r => String(r || '')
  .trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12) || '15010';

function roomStore(room) {
  if (!rooms.has(room)) {
    if (rooms.size >= MAX_ROOMS) {                 // drop the least recently used
      const oldest = [...rooms.entries()]
        .sort((a, b) => (a[1].touched || 0) - (b[1].touched || 0))[0];
      if (oldest) rooms.delete(oldest[0]);
    }
    const m = new Map();
    m.touched = Date.now();
    rooms.set(room, m);
  }
  const m = rooms.get(room);
  m.touched = Date.now();
  return m;
}

const list = room => [...roomStore(room).values()].sort((a, b) => a.ts - b.ts);

function cleanName(first, initial) {
  const f = String(first || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  const i = String(initial || '').trim().slice(0, 1).toUpperCase();
  if (!f) return 'Anonymous';
  return i ? `${f} ${i}.` : f;
}

function cleanWtp(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(MAX_WTP, Math.round(n * 4) / 4));   // quarters
}

/* ------------------------------------------------------------------ http */

const app = express();
// Without this, '/dashboard' and '/dashboard/' are the same route and the
// redirect below would point at itself.
app.set('strict routing', true);
app.use(cors({ origin: ORIGINS === '*' ? true : ORIGINS.split(',') }));
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) =>
  res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));

// the student form; the room code is read from the path by the page itself
app.get('/r/:room', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'student.html')));

// QR for the projector, rendered server-side so the dashboard needs no library
app.get('/qr.svg', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 400);
  if (!text) return res.status(400).send('missing text');
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch (e) {
    res.status(500).send('qr failed');
  }
});

/* The instructor dashboard is served from this same service, so one deploy
   yields both links. Its canonical copy stays one directory up so it still
   opens straight off disk with no network — the fallback if the wifi dies.
   Only the three files are exposed, not the whole parent directory. */
const DASH = path.join(__dirname, '..');
const sendDash = (file, type) => (_req, res) =>
  res.type(type).sendFile(path.join(DASH, file));

app.get('/dashboard', (_req, res) => res.redirect('/dashboard/'));   // keep relative asset paths working
app.get('/dashboard/', sendDash('index.html', 'html'));
app.get('/dashboard/app.js', sendDash('app.js', 'application/javascript'));
app.get('/dashboard/styles.css', sendDash('styles.css', 'text/css'));

/* The projector screen: big QR codes and the addresses under them, one card per
   segment. Its own URL rather than a popup the dashboard paints, so it can be
   reloaded, bookmarked, or opened on a second machine driving the projector.
   Rooms come from the query string — /join?room=15010&segs=2 */
app.get('/join', sendDash('join.html', 'html'));

app.get('/', (_req, res) => res.redirect('/dashboard/'));

/* --------------------------------------------------------------- sockets */

const http = createServer(app);
const io = new Server(http, { cors: { origin: ORIGINS === '*' ? true : ORIGINS.split(',') } });

const studentCount = room =>
  [...io.sockets.adapter.rooms.get(room) || []]
    .filter(id => io.sockets.sockets.get(id)?.data.role === 'student').length;

function push(room) {
  io.to(room).emit('responses', { room, responses: list(room), online: studentCount(room) });
}

io.on('connection', socket => {
  socket.on('join', (payload = {}, ack) => {
    const room = normRoom(payload.room);
    socket.join(room);
    socket.data.room = room;
    socket.data.role = payload.role === 'student' ? 'student' : 'dashboard';
    if (typeof ack === 'function') ack({ room, responses: list(room), online: studentCount(room) });
    push(room);
  });

  socket.on('submit', (payload = {}, ack) => {
    const room = normRoom(payload.room || socket.data.room);
    const token = String(payload.token || '').slice(0, 64);
    const wtp = cleanWtp(payload.wtp);
    if (!token) return ack?.({ ok: false, error: 'missing token' });
    if (wtp === null) return ack?.({ ok: false, error: `enter a number from 0 to ${MAX_WTP}` });

    const store = roomStore(room);
    if (!store.has(token) && store.size >= MAX_PER_ROOM)
      return ack?.({ ok: false, error: 'this room is full' });

    const name = cleanName(payload.first, payload.initial);
    const prev = store.get(token);
    store.set(token, { id: prev?.id || randomUUID(), name, wtp, ts: prev?.ts || Date.now() });

    ack?.({ ok: true, name, wtp, changed: Boolean(prev) });
    push(room);
  });

  // instructor actions
  socket.on('clear', (payload = {}) => {
    const room = normRoom(payload.room || socket.data.room);
    roomStore(room).clear();
    push(room);
  });

  /* The dashboard hands its cached copy back if it reconnects and finds the
     room empty — which is what a free-tier restart mid-class looks like. */
  socket.on('restore', (payload = {}) => {
    const room = normRoom(payload.room || socket.data.room);
    const store = roomStore(room);
    if (store.size) return;                       // never overwrite live answers
    for (const r of Array.isArray(payload.responses) ? payload.responses : []) {
      const wtp = cleanWtp(r.wtp);
      if (wtp === null) continue;
      const token = String(r.token || r.id || randomUUID()).slice(0, 64);
      store.set(token, {
        id: r.id || randomUUID(),
        name: String(r.name || 'Anonymous').slice(0, MAX_NAME + 4),
        wtp,
        ts: Number(r.ts) || Date.now()
      });
    }
    push(room);
  });

  socket.on('disconnect', () => { if (socket.data.room) push(socket.data.room); });
});

http.listen(PORT, () => console.log(`L1 demand server listening on ${PORT}`));
