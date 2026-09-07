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

/* A secret path segment in front of the dashboard, set as DASH_KEY in the
   environment — the dashboard then lives at /<key>/dashboard/ instead of
   /dashboard/. Students are handed /r/<room>, and the bare host is a short walk
   from there to a panel with "Clear all" on it; this puts the panel behind
   something they cannot guess.
   It is an env var and not a constant because this repo is public: a secret
   committed to it is not a secret. Unset — as when running locally — the
   dashboard stays at /dashboard/ and nothing changes.
   Obscurity, not authentication: anyone who sees the URL over your shoulder or
   in a screen share has it for good. Rotate it by changing the variable. */
const DASH_KEY = String(process.env.DASH_KEY || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
const PREFIX   = DASH_KEY ? '/' + DASH_KEY : '';

/* Bitly, for the link students type off the projector. Set BITLY_TOKEN to a
   generic access token; BITLY_GROUP and BITLY_DOMAIN are optional and only
   needed for a specific group or a branded short domain.
   Shortening happens HERE and never in the browser: a token handed to the page
   is a token handed to every student in the room. Unset, the full links are
   used and nothing changes. */
const BITLY_TOKEN  = String(process.env.BITLY_TOKEN  || '').trim();
const BITLY_GROUP  = String(process.env.BITLY_GROUP  || '').trim();
const BITLY_DOMAIN = String(process.env.BITLY_DOMAIN || '').trim();

/* BITLY_SLUG turns the random back-half into a chosen one: set it to "l1" and
   the groups get <domain>/l1-A and <domain>/l1-B, or plain <domain>/l1 when the
   class is not split.
   Custom back-halves are a paid feature and, per Bitly's own docs, really meant
   for a branded domain — on plain bit.ly the claim can come back 402, and a
   keyword someone else already owns comes back 4xx too. Either way the random
   short link is used instead, so a name that cannot be had costs nothing. */
const BITLY_SLUG = String(process.env.BITLY_SLUG || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
const MAX_WTP   = 100;         // must match MAX_WTP in the dashboard
const MAX_NAME  = 24;
const MAX_ROOMS = 50;          // a stray room code should not grow memory forever
const MAX_PER_ROOM = 600;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* The class answers the SAME question twice under different conditions. Round 1
   is the plain question; round 2 removes the alternatives. Both curves are drawn
   together, so both sets of answers have to survive.

   room -> Map("<deviceToken>#<round>" -> {id, name, wtp, ts, round})
   Keying by token AND round means a second answer in the same round still
   REPLACES the first -- nobody appears on one curve twice -- while an answer in
   round 2 sits alongside the student's round 1 answer instead of erasing it. */
const ROUNDS = 2;
const rooms = new Map();

const keyFor = (token, round) => `${token}#${round}`;

const normRoom = r => String(r || '')
  .trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12) || '15010';

function roomStore(room) {
  if (!rooms.has(room)) {
    if (rooms.size >= MAX_ROOMS) {
      /* Drop the least recently used room that is EMPTY. Evicting a room that
         holds answers loses a live class: the next push recreates it empty, the
         connected dashboard adopts the empty list and overwrites its own cached
         backup, and nothing reconnects to trigger a restore. A quiet room --
         which is what a class looks like while you talk between rounds -- was
         previously the most likely victim. */
      const spare = [...rooms.entries()]
        .filter(([, m]) => m.size === 0)
        .sort((a, b) => (a[1].touched || 0) - (b[1].touched || 0))[0];
      if (spare) rooms.delete(spare[0]);
      else return rooms.get(room) || new Map();   // all full: serve, don't destroy
    }
    const m = new Map();
    m.touched = Date.now();
    m.round = 1;
    rooms.set(room, m);
  }
  const m = rooms.get(room);
  m.touched = Date.now();
  return m;
}

const list = room => [...roomStore(room).values()].sort((a, b) => a.ts - b.ts);

/* The SERVER owns the round, never the client. A phone that was asleep through
   the switch would otherwise post its round 1 answer into round 2. */
const roundOf = room => roomStore(room).round || 1;

const countInRound = (store, round) => {
  let n = 0;
  for (const v of store.values()) if ((v.round || 1) === round) n++;
  return n;
};

function cleanName(first, initial) {
  const f = String(first || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  // [...str] splits by code point, so an emoji or an accented letter survives
  // instead of becoming half a surrogate pair on the projector. Uppercase first
  // so 'ß' does not become 'SS'.
  const i = ([...String(initial || '').trim().toUpperCase()][0] || '')
    .replace(/[^\p{L}\p{N}]/u, '');
  if (!f) return 'Anonymous';
  return i ? `${f} ${i}.` : f;
}

function cleanWtp(v) {
  // Number('') and Number(null) are 0, which would put a silent $0.00 answer on
  // the curve. Anything that is not a real number typed by a person is refused.
  if (v === null || v === undefined || v === '' ||
      (typeof v === 'string' && v.trim() === '') || typeof v === 'boolean' ||
      Array.isArray(v)) return null;
  // Only plain decimal notation. "0x10" is a valid Number (16) but nobody typed
  // hexadecimal into a price box, so it is a tampered client, not a student.
  if (typeof v === 'string' && !/^-?\d*\.?\d+$/.test(v.trim())) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // Out of range is REFUSED, not quietly clamped: the error text promises
  // "a number from 0 to 100", and a silent 1e9 -> $100 is a fabricated answer
  // sitting at the top of the demand curve.
  if (n < 0 || n > MAX_WTP) return null;
  return Math.round(n * 4) / 4;                                  // quarters
}

/* ------------------------------------------------------------------ http */

const app = express();
// Without this, '/dashboard' and '/dashboard/' are the same route and the
// redirect below would point at itself.
app.set('strict routing', true);
// Render terminates TLS in front of us; without this req.protocol reads http
// and every link built from it would be an https page handing out http URLs.
app.set('trust proxy', true);
app.use(cors({ origin: ORIGINS === '*' ? true : ORIGINS.split(',') }));
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) =>
  res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));

// the student form; the room code is read from the path by the page itself
app.get('/r/:room', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'student.html')));

/* Shortened once and remembered. Bitly returns the same short link for a URL
   it has already seen, so this is about latency and quota rather than
   correctness — /links is hit every time the join screen opens.
   Failures are deliberately NOT cached: a Bitly outage five minutes before
   class should not poison the link for the rest of the process's life. The
   caller falls back to the full URL, which always works. */
const shortCache = new Map();

const bitly = (path, method, body) => fetch('https://api-ssl.bitly.com/v4' + path, {
  method,
  headers: { Authorization: 'Bearer ' + BITLY_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(6000)          // a slow shortener must not hang the projector
});

const withScheme = s => (s.startsWith('http') ? s : 'https://' + s);   // v4 may omit it

/* Claim a chosen back-half for a Bitlink we just made.
   POST creates the keyword; if it already exists — same class next term, or a
   second Go live — PATCH moves it onto the new Bitlink instead. That makes the
   pretty link permanent and repointable rather than something that only works
   the first time. */
async function claimCustom(bitlinkId, custom) {
  try {
    let r = await bitly('/custom_bitlinks', 'POST', { bitlink_id: bitlinkId, custom_bitlink: custom });
    if (!r.ok) {
      r = await bitly('/custom_bitlinks/' + encodeURIComponent(custom), 'PATCH', { bitlink_id: bitlinkId });
    }
    if (!r.ok) {
      console.warn(`bitly custom ${r.status} for ${custom}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
      return null;
    }
    return withScheme(custom);
  } catch (e) {
    console.warn('bitly custom failed:', e.message);
    return null;
  }
}

async function shorten(longUrl, slug) {
  if (!BITLY_TOKEN) return null;
  const key = longUrl + '|' + (slug || '');
  if (shortCache.has(key)) return shortCache.get(key);

  const body = { long_url: longUrl };
  if (BITLY_GROUP)  body.group_guid = BITLY_GROUP;
  if (BITLY_DOMAIN) body.domain     = BITLY_DOMAIN;

  try {
    const r = await bitly('/shorten', 'POST', body);
    if (!r.ok) {
      console.warn(`bitly ${r.status} for ${longUrl}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
      return null;
    }
    const j = await r.json();
    if (typeof j.link !== 'string' || !j.link) return null;

    // A chosen name if one can be had, the random one if not.
    let url = withScheme(j.link);
    if (slug && j.id) {
      const custom = `${BITLY_DOMAIN || 'bit.ly'}/${slug}`;
      url = (await claimCustom(j.id, custom)) || url;
    }
    shortCache.set(key, url);
    return url;
  } catch (e) {
    console.warn('bitly failed:', e.message);
    return null;
  }
}

/* The student links for a room, shortened where possible. One place builds
   them, so the dashboard and the projector screen can never disagree about
   what a group was told to type. */
app.get('/links', async (req, res) => {
  const room = normRoom(req.query.room);
  const segs = Math.min(3, Math.max(1, parseInt(req.query.segs, 10) || 1));
  const base = `${req.protocol}://${req.get('host')}`;

  const links = await Promise.all(
    Array.from({ length: segs }, async (_, k) => {
      const r    = segs === 1 ? room : `${room}-${'ABC'[k]}`;
      const url  = `${base}/r/${r}`;
      const slug = !BITLY_SLUG ? '' : segs === 1 ? BITLY_SLUG : `${BITLY_SLUG}-${'ABC'[k]}`;
      return { seg: segs === 1 ? null : 'ABC'[k], room: r, url, short: await shorten(url, slug) };
    })
  );
  res.set('Cache-Control', 'no-store').json({ shortening: Boolean(BITLY_TOKEN), links });
});

/* Shorten an arbitrary URL, for the one-off links that are not room links —
   a dashboard address, another service's page.
   Behind the dashboard key, and switched off entirely when no key is set: an
   ungated version would be an open relay on someone else's Bitly quota. That
   also means the token stays here and nobody needs a copy of it to use it. */
app.get(PREFIX + '/shorten', async (req, res) => {
  if (!DASH_KEY)     return res.status(404).end();
  if (!BITLY_TOKEN)  return res.status(503).json({ error: 'no BITLY_TOKEN set' });

  const url = String(req.query.u || '');
  if (!/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: 'pass ?u=<http url>' });

  const slug = String(req.query.slug || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  res.set('Cache-Control', 'no-store').json({ url, slug: slug || null, short: await shorten(url, slug) });
});

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

/* Mounted under PREFIX, so with DASH_KEY set the whole dashboard — page, script
   and stylesheet — moves together. The page asks for styles.css and app.js
   relatively, so they have to sit beside it wherever it is served from. */
app.get(PREFIX + '/dashboard', (_req, res) => res.redirect(PREFIX + '/dashboard/')); // keep relative asset paths working
app.get(PREFIX + '/dashboard/', sendDash('index.html', 'html'));
app.get(PREFIX + '/dashboard/app.js', sendDash('app.js', 'application/javascript'));
app.get(PREFIX + '/dashboard/styles.css', sendDash('styles.css', 'text/css'));

/* The projector screen: big QR codes and the addresses under them, one card per
   segment. Its own URL rather than a popup the dashboard paints, so it can be
   reloaded, bookmarked, or opened on a second machine driving the projector.
   Rooms come from the query string — /join?room=15010&segs=2 */
app.get('/join', sendDash('join.html', 'html'));

/* Without a key the bare host is a convenience shortcut to the dashboard. With
   one, that shortcut would hand back the very thing the key is hiding, so it
   goes to the join screen instead — which is public by design. */
app.get('/', (_req, res) =>
  res.redirect(DASH_KEY ? '/join' : '/dashboard/'));

/* --------------------------------------------------------------- sockets */

const http = createServer(app);
const io = new Server(http, { cors: { origin: ORIGINS === '*' ? true : ORIGINS.split(',') } });

const studentCount = room =>
  [...io.sockets.adapter.rooms.get(room) || []]
    .filter(id => io.sockets.sockets.get(id)?.data.role === 'student').length;

/* Dashboards sit in a second room so the answers go ONLY to them. Students used
   to receive the whole class's names and amounts on every push -- ~10MB per
   phone across a lecture, and a live roster of everyone's answer readable from
   the phone, in an exercise whose point is that nobody anchors on anyone else.
   They need exactly one integer, so that is all they get. */
const dashRoom = room => room + '\u0000dash';

function push(room) {
  io.to(dashRoom(room)).emit('responses', {
    room, responses: list(room), online: studentCount(room), round: roundOf(room)
  });
  io.to(room).emit('round', { room, round: roundOf(room) });
}

/* A handler must never take the process down. `(payload = {})` only defaults on
   undefined, so a single `emit('join', null)` from any phone's console used to
   throw an uncaught TypeError and kill the server -- taking every room's answers
   with it, mid-lecture. Everything below goes through here instead. */
const on = (socket, event, fn, instructorOnly = false) =>
  socket.on(event, (payload, ack) => {
    try {
      if (instructorOnly && socket.data.role !== 'dashboard') return;
      fn(payload && typeof payload === 'object' ? payload : {},
         typeof ack === 'function' ? ack : () => {});
    } catch (err) {
      console.error(`[${event}]`, err && err.message);
    }
  });

io.on('connection', socket => {
  on(socket, 'join', (payload, ack) => {
    const room = normRoom(payload.room);
    socket.join(room);
    socket.data.room = room;
    socket.data.role = payload.role === 'student' ? 'student' : 'dashboard';
    if (socket.data.role === 'dashboard') {
      socket.join(dashRoom(room));
      /* The room is open from the moment an instructor first arrives, and stays
         open. Deliberately NOT "is a dashboard connected right now": the
         projector laptop dropping its websocket for two seconds mid-lecture
         would otherwise tell all 77 phones the session had not started. */
      roomStore(room).opened = true;
    }
    ack(socket.data.role === 'dashboard'
      ? { room, responses: list(room), online: studentCount(room), round: roundOf(room) }
      : { room, round: roundOf(room) });          // a phone needs nothing else
    push(room);
  });

  on(socket, 'submit', (payload, ack) => {
    const room = normRoom(payload.room || socket.data.room);
    const token = String(payload.token || '').slice(0, 64);
    const wtp = cleanWtp(payload.wtp);
    if (!token) return ack({ ok: false, error: 'missing token' });
    if (wtp === null) return ack({ ok: false, error: `enter a number from 0 to ${MAX_WTP}` });

    const store = roomStore(room);
    /* Nobody is running this room yet. Taking the answer anyway would drop it
       into memory unseen and, worse, show the student a confirmation for a
       poll that is not happening -- so say so plainly and leave them on the
       form with what they typed still in it. */
    if (!store.opened)
      return ack({ ok: false, waiting: true,
                   error: 'The session has not started yet. Your instructor will open it in a moment.' });

    const round = roundOf(room);
    const key = keyFor(token, round);
    // Per ROUND, not a shared budget: a full round 1 used to make round 2
    // impossible for everyone, including the students who had already answered.
    if (!store.has(key) && countInRound(store, round) >= MAX_PER_ROOM)
      return ack({ ok: false, error: 'this room is full' });

    const name = cleanName(payload.first, payload.initial);
    const prev = store.get(key);
    store.set(key, {
      id: prev?.id || randomUUID(), token, name, wtp, round, ts: prev?.ts || Date.now()
    });

    ack({ ok: true, name, wtp, round, changed: Boolean(prev) });
    push(room);
  });

  // instructor actions
  on(socket, 'clear', payload => {
    const room = normRoom(payload.room || socket.data.room);
    const store = roomStore(room);
    store.clear();
    store.round = 1;                 // a cleared room starts the lecture over
    // 'reset' is distinct from 'round': the round may be unchanged, but every
    // phone still has to drop its "your answer is on the board" screen, or the
    // class sits looking at a confirmation for an answer that no longer exists.
    io.to(room).emit('reset', { room, round: 1 });
    push(room);
  }, true);

  /* Moving the class to the next condition. Every student's phone is told at
     once, so the question on the page changes under them and their previous
     answer stops being the one they can edit. Earlier rounds are kept. */
  on(socket, 'setRound', payload => {
    const room = normRoom(payload.room || socket.data.room);
    const next = Math.min(ROUNDS, Math.max(1, Number(payload.round) | 0 || 1));
    const store = roomStore(room);
    store.round = next;
    io.to(room).emit('round', { room, round: next });
    push(room);
  }, true);

  /* The dashboard hands its cached copy back if it reconnects and finds the
     room empty — which is what a free-tier restart mid-class looks like. */
  on(socket, 'restore', payload => {
    const room = normRoom(payload.room || socket.data.room);
    const store = roomStore(room);
    if (store.size) return;                       // never overwrite live answers
    store.round = Math.min(ROUNDS, Math.max(1, Number(payload.round) | 0 || 1));
    for (const r of Array.isArray(payload.responses) ? payload.responses : []) {
      if (!r || typeof r !== 'object') continue;  // one null row used to kill the process
      const wtp = cleanWtp(r.wtp);
      if (wtp === null) continue;
      const round = Math.min(ROUNDS, Math.max(1, Number(r.round) | 0 || 1));
      if (countInRound(store, round) >= MAX_PER_ROOM) continue;   // cap applies here too
      /* Keyed by the DEVICE token, which is why push() now sends it back. Keying
         a restored row by its id instead meant the student's next answer landed
         under a different key and they appeared twice on the same curve --
         exactly in the restart this whole path exists for. */
      const token = String(r.token || r.id || randomUUID()).slice(0, 64);
      store.set(keyFor(token, round), {
        id: r.id || randomUUID(),
        token,
        name: String(r.name || 'Anonymous').slice(0, MAX_NAME + 4),
        wtp,
        round,
        ts: Number(r.ts) || Date.now()
      });
    }
    push(room);
  }, true);

  socket.on('disconnect', () => { if (socket.data.room) push(socket.data.room); });
});

http.listen(PORT, () => console.log(`L1 demand server listening on ${PORT}`));
