/* 15.010 L1 — Live demand curve, instructor dashboard.
 *
 * Two panels: the figure on the left, the numbers and the simulate controls on
 * the right. Shows one thing — the class demand curve, built from student
 * willingness to pay. No price line, no supply, no seller, no taxes, no
 * equilibrium.
 *
 * Every submission is a point on the curve; hover it to see who it was.
 *
 * Two sources of answers:
 *   live      — students submit at <server>/r/<room>; the server pushes the whole
 *               list over Socket.io on every change (see ../server).
 *   simulated — a fake class, for rehearsal and as the fallback if the wifi dies.
 * Whichever is active, `state.responses` is the same shape and everything
 * downstream is identical. The last known list is cached in localStorage, and
 * offered back to the server if we reconnect to an empty room — which is what a
 * free-tier restart mid-class looks like.
 *
 * The chart is drawn by hand on a canvas rather than pulled from a CDN, so the
 * page works with no network at all. That matters in a classroom.
 */

const KEY = 'l1-demand-v4';
const MAX_WTP    = 30;     // the most a student may submit
const ARRIVAL_MS = 300;    // one student every 0.3s, so a class of 45 lands in ~14s
const HIT_BAND   = 55;     // px above/below the step the cursor may be and still count

/* When this page is served BY the submission server (…/dashboard/), the server
   is simply wherever we came from — nothing to configure, which is one less
   thing to get wrong five minutes before class. Opened straight off disk it
   falls back to the deployed address, and the field in the Live panel overrides
   either and is remembered. */
const DEFAULT_SERVER = location.protocol.startsWith('http')
  ? location.origin
  : 'https://l1-demand.onrender.com';

/* The class can be split into up to three segments. Each is a separate room on
   the server — <ROOM>-A, <ROOM>-B, <ROOM>-C — with its own link and QR code, so
   who ends up in which segment is decided by which link they were handed. With
   one segment the plain <ROOM> is used, so every existing student link and
   printed QR keeps working. */
const SEG_NAMES = ['A', 'B', 'C'];
const SEG_VARS  = ['--seg-a', '--seg-b', '--seg-c'];

const DEFAULTS = { classSize: 45, responses: [], mode: 'students',
                   server: DEFAULT_SERVER, room: '15010',
                   view: 'class', cost: 0, price: null, sort: 'desc',
                   segCount: 1, demandView: 'segments', profitView: 'segments' };
let state = structuredClone(DEFAULTS);
let newestId = null;
let arrivalTimer = null;   // non-null while a class is arriving
let points = [];           // [{x, y, name, wtp}] rebuilt on every draw
let geom = null;           // plot rectangle, so hit-testing can use columns
let hoverIdx = -1;         // students mode: which student is under the cursor
let hoverPrice = null;     // price mode: the price the cursor is sitting at
let pricePinned = false;   // price mode: click to lock the line while you talk
let socket = null;         // non-null once live
let live = false;

const $ = id => document.getElementById(id);
const money = x => '$' + x.toFixed(2);

/* ------------------------------------------------------------------ state */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = Object.assign(structuredClone(DEFAULTS), JSON.parse(raw));
  } catch (e) { console.warn('starting fresh:', e); }
  if (!Array.isArray(state.responses)) state.responses = [];
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.warn('could not save:', e); }
}
function applyRemote() { load(); syncInputs(); render(); }

window.addEventListener('storage', e => { if (e.key === KEY) applyRemote(); });

/* ------------------------------------------------------------------- data */

/* Answers carry the segment they came from. Dropping the segment count from 3
   to 2 hides segment C rather than deleting it, so the choice is reversible and
   nothing a student typed is ever thrown away behind their back. */
const segOf = r => Math.min(Math.max(r.seg | 0, 0), 2);
const visible = () => state.responses.filter(r => segOf(r) < state.segCount);
const inSeg = k => state.responses.filter(r => segOf(r) === k);

// Sorted highest first — that ordering IS the demand curve.
const rankedOf = list => list.slice().sort((a, b) => b.wtp - a.wtp);
const ranked = () => rankedOf(visible());

/* One entry per curve to draw. Pooled is the whole class as a single market;
   segments are the separate ones. Everything downstream — the chart, the profit
   view, the legend — reads this rather than deciding for itself. */
function series(mode) {
  if (state.segCount < 2 || mode === 'pooled') {
    return [{ k: -1, label: 'The class', rows: ranked(), varName: '--blue' }];
  }
  return Array.from({ length: state.segCount }, (_, k) => ({
    k, label: 'Segment ' + SEG_NAMES[k], rows: rankedOf(inSeg(k)), varName: SEG_VARS[k]
  }));
}

function summaryOf(list) {
  const s = rankedOf(list).map(r => r.wtp), n = s.length;
  if (!n) return { n: 0 };
  const mid = Math.floor(n / 2);
  return {
    n, max: s[0], min: s[n - 1],
    mean: s.reduce((a, b) => a + b, 0) / n,
    median: n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  };
}
const summary = () => summaryOf(visible());

// Everyone whose maximum is at or above the price buys one unit.
const qtyIn = (list, p) => list.reduce((n, r) => n + (r.wtp >= p ? 1 : 0), 0);
const quantityAt = p => qtyIn(visible(), p);

/* ------------------------------------------------------------- simulation */

// Placeholder names for the simulated class. Real submissions bring their own.
const FIRST = ['Aisha','Marcus','Priya','Diego','Yuki','Nour','Tomas','Leila','Andre','Mei',
  'Jonas','Fatima','Ravi','Elena','Kwame','Sofia','Hassan','Ingrid','Omar','Clara',
  'Nikhil','Zara','Lucas','Amara','Sven','Rania','Felipe','Anika','Kenji','Maya',
  'Idris','Lucia','Arjun','Freya','Samir','Chloe','Bo','Naomi','Viktor','Thandi',
  'Rafael','Yasmin','Henrik','Divya','Malik','Elsa','Pedro','Hana','Tariq','Greta'];
const LAST = 'ABCDEFGHIJKLMNOPRSTVWZ';

function simulatedName() {
  return `${FIRST[Math.floor(Math.random() * FIRST.length)]} ${LAST[Math.floor(Math.random() * LAST.length)]}.`;
}

/* Right-skewed draw: most of the class clusters, a few enthusiasts sit high.
 *
 * Each segment gets its own centre, because a rehearsal where the segments come
 * out identical teaches the opposite of the point — the whole reason to split a
 * market is that the halves are not the same. A is the ordinary class; B sits
 * lower and C higher, far enough apart to be obvious from the back of the room.
 * With one segment the original centre is kept, so the single-market demo looks
 * exactly as it always has. */
const SIM_CENTRE = [14, 8, 20];

function simulatedWtp(seg) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const centre = state.segCount < 2 ? 11 : SIM_CENTRE[seg] ?? 14;
  const spread = state.segCount < 2 ? 0.42 : 0.34;
  const x = Math.exp(Math.log(centre) + spread * z);
  return Math.max(0, Math.min(MAX_WTP, Math.round(x * 4) / 4));   // quarters, as people answer
}

function addResponse(wtp, name, sim = false, seg = 0) {
  const r = { id: crypto.randomUUID(), name, wtp, ts: Date.now(), sim, seg };
  state.responses.push(r);
  return r;
}

/* Round-robin rather than random, so the curves grow at the same rate and the
   room watches both fill in together instead of one racing ahead. */
function addSimulated() {
  const seg = state.segCount < 2 ? 0 : state.responses.length % state.segCount;
  return addResponse(simulatedWtp(seg), simulatedName(), true, seg);
}

/* ------------------------------------------------------------------ chart */

function drawChart() {
  const cv = $('demandCanvas');
  const dpr = window.devicePixelRatio || 1;
  // Size from the CANVAS's own box, not the wrapper's. If the two ever differ —
  // and with height:100% inside a flex item they can — the browser stretches the
  // bitmap to fit, the chart still looks correct, and every hover coordinate is
  // silently offset. Measuring both here and in onMove from the same rect keeps
  // drawing space and mouse space identical by construction.
  const rect = cv.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  if (W < 20 || H < 20) { points = []; geom = null; return; }
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  const cast = series(state.demandView);
  const all  = ranked();
  const css = getComputedStyle(document.documentElement);
  const LINE  = css.getPropertyValue('--line').trim()  || '#e5e5e3';
  const MUTED = css.getPropertyValue('--muted').trim() || '#8a8a8a';
  const ACCENT= css.getPropertyValue('--accent').trim()|| '#e05c3e';
  const colour = s => css.getPropertyValue(s.varName).trim() || '#2563eb';

  // padL has to clear both the "$00.00" ticks and the rotated axis title
  const padL = 88, padR = 18, padT = 26, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  points = []; geom = null;
  if (plotW <= 10 || plotH <= 10) return;

  // While a class is filing in, hold the frame at the full class size so the
  // curve grows rightward into fixed axes instead of rescaling on every arrival.
  // Split in two, each segment only expects its share of the seats.
  const longest = Math.max(...cast.map(s => s.rows.length), 0);
  const expect  = arrivalTimer ? state.classSize / (state.demandView === 'pooled' ? 1 : state.segCount) : 0;
  const nMax = Math.max(longest, expect, 10);

  // The y-axis follows the data, rounded up to a tick, so no answer ever sits
  // off the top of the plot. It follows the WHOLE class, not the curve being
  // drawn, so switching between segments and pooled never rescales underfoot.
  const top = all.length ? all[0].wtp : 10;
  const tick = top <= 10 ? 2 : top <= 30 ? 5 : 10;
  const yMax = Math.max(tick * 2, Math.ceil(top / tick) * tick);

  const X = q => padL + (q / nMax) * plotW;
  const Y = p => padT + plotH - (p / yMax) * plotH;

  geom = { padL, padT, plotW, plotH, nMax, yMax, n: longest };

  // ---- grid + y ticks
  g.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let p = 0; p <= yMax + 0.001; p += tick) {
    const y = Y(p);
    g.strokeStyle = p === 0 ? '#d8d8d4' : LINE;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, y + .5); g.lineTo(W - padR, y + .5); g.stroke();
    g.fillStyle = MUTED; g.fillText(money(p), padL - 9, y);
  }

  // ---- x ticks
  g.textAlign = 'center'; g.textBaseline = 'top';
  const stepQ = nMax <= 20 ? 5 : nMax <= 60 ? 10 : 20;
  for (let q = stepQ; q <= nMax; q += stepQ) {
    g.fillStyle = MUTED; g.fillText(String(q), X(q), padT + plotH + 9);
  }

  // ---- axis titles
  g.fillStyle = MUTED;
  g.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  g.fillText('students who would buy', padL + plotW / 2, padT + plotH + 26);
  g.save();
  g.translate(17, padT + plotH / 2); g.rotate(-Math.PI / 2);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('most they would pay', 0, 0);
  g.restore();

  if (!all.length) return;

  const priceMode = state.mode === 'price';

  // ---- a staircase per curve: one step per student, one unit wide.
  // points[] is flat across every curve, because hit-testing and the list
  // below both address a student by their position in it.
  cast.forEach(s => {
    const col = colour(s);
    if (!s.rows.length) return;

    g.beginPath();
    s.rows.forEach((r, i) => {
      const y = Y(r.wtp);
      if (i === 0) g.moveTo(X(0), y); else g.lineTo(X(i), y);
      g.lineTo(X(i + 1), y);
    });
    g.strokeStyle = col; g.lineWidth = 2; g.lineJoin = 'round';
    g.stroke();

    // one point per submission, at the middle of that student's step. Always
    // recorded (hit-testing needs them); only drawn in students mode, where
    // they are the thing you are pointing at.
    const dense = s.rows.length > 90;             // dots would merge into a smear
    s.rows.forEach((r, i) => {
      const x = X(i + 0.5), y = Y(r.wtp);
      const idx = points.length;
      points.push({ x, y, name: r.name, wtp: r.wtp, id: r.id, seg: segOf(r), col, step: i });
      // In price mode the dots are off — except the one being pointed at in the
      // list below, which should still be findable without changing mode first.
      if (priceMode && idx !== hoverIdx) return;
      if (dense && idx !== hoverIdx) return;
      const on = idx === hoverIdx;
      g.beginPath(); g.arc(x, y, on ? 5.5 : 3, 0, Math.PI * 2);
      g.fillStyle = on ? col : '#fff';
      g.fill();
      g.lineWidth = on ? 2 : 1.5; g.strokeStyle = col; g.stroke();
    });
  });

  // ---- guides to both axes for the student under the cursor, wherever the
  // cursor is — over the curve itself, or over their row in the list
  if (hoverIdx >= 0 && points[hoverIdx]) {
    const p = points[hoverIdx];
    g.save();
    g.setLineDash([3, 4]); g.strokeStyle = p.col; g.globalAlpha = .45; g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, p.y); g.lineTo(p.x, p.y);
    g.moveTo(p.x, p.y); g.lineTo(p.x, padT + plotH); g.stroke();
    g.restore();
  }

  // ---- price mode: a horizontal line at the cursor, and who is above it
  if (priceMode && hoverPrice !== null) {
    const y = Y(hoverPrice);
    // one crossing per curve — the same price sells a different amount into
    // each segment, which is the entire point of splitting them
    const cuts = cast.map(s => ({ q: qtyIn(s.rows, hoverPrice), col: colour(s) }));
    const qMax = Math.max(...cuts.map(c => c.q), 0);

    // The line runs from the price axis only as far as the furthest curve —
    // that IS the quantity, so extending it past the last crossing would draw a
    // length that means nothing. When nobody buys there is no intersection, so
    // a short stub stands in, otherwise the cursor's price would be invisible.
    // No shaded block: a wash of colour behind the curve reads badly on a
    // projector. The line, the drops and the readout carry it.
    g.save();
    g.setLineDash([6, 4]); g.strokeStyle = ACCENT; g.lineWidth = 1.75;
    g.beginPath(); g.moveTo(padL, y); g.lineTo(qMax > 0 ? X(qMax) : padL + 18, y); g.stroke();
    g.restore();

    cuts.forEach(c => {
      if (!c.q) return;
      const xq = X(c.q);
      g.save();
      g.setLineDash([6, 4]); g.strokeStyle = c.col; g.lineWidth = 1.75; g.globalAlpha = .55;
      g.beginPath(); g.moveTo(xq, y); g.lineTo(xq, padT + plotH); g.stroke();
      g.restore();
      g.beginPath(); g.arc(xq, y, 4.5, 0, Math.PI * 2);
      g.fillStyle = c.col; g.fill();
    });

    // ---- label each line where it meets its axis, so the numbers are read
    // off the axes rather than out of a box in the corner. Each label is
    // painted on a white patch so it covers the grey tick underneath instead
    // of colliding with it.
    g.font = 'bold 12px ui-monospace, SFMono-Regular, Menlo, monospace';

    const pLabel = money(hoverPrice);                 // price, on the y-axis
    g.textAlign = 'right'; g.textBaseline = 'middle';
    const pw = g.measureText(pLabel).width;
    g.fillStyle = '#fff';
    g.fillRect(padL - 11 - pw, y - 9, pw + 8, 18);
    g.fillStyle = ACCENT;
    g.fillText(pLabel, padL - 7, y);

    // Only one curve? Put its quantity on the axis too. With several, the
    // numbers would crowd each other along a short stretch of axis, so they go
    // to the readout box instead, one line per segment.
    if (cuts.length === 1 && cuts[0].q > 0) {
      const qLabel = String(cuts[0].q), xq = X(cuts[0].q);
      g.textAlign = 'center'; g.textBaseline = 'top';
      const qw = g.measureText(qLabel).width;
      g.fillStyle = '#fff';
      g.fillRect(xq - qw / 2 - 5, padT + plotH + 5, qw + 10, 17);
      g.fillStyle = ACCENT;
      g.fillText(qLabel, xq, padT + plotH + 8);
    }
  }
}

/* ----------------------------------------------------------------- profit */

/* Profit at a price is (price − cost) × the number who still buy there.
 *
 * Between two adjacent answers nobody changes their mind, so quantity is flat
 * and profit rises with price in a straight line. The maximum therefore always
 * lands exactly ON someone's stated maximum — which is the point worth making
 * in class, and why this searches the answers themselves rather than a grid of
 * prices. Ties go to the lower price, so the seller keeps more buyers. */
const profitIn = (list, p, c) => (p - c) * qtyIn(list, p);
const profitAt = (p, c) => profitIn(visible(), p, c);

function optimumIn(list, c) {
  let best = null;
  for (const p of [...new Set(list.map(r => r.wtp))].sort((a, b) => a - b)) {
    if (p < c) continue;                       // selling below cost is never the answer
    const profit = profitIn(list, p, c);
    if (!best || profit > best.profit) best = { price: p, qty: qtyIn(list, p), profit };
  }
  return best;
}
const optimum = c => optimumIn(visible(), c);

/* The price axis of the profit chart, and the range of the price slider under
   it. Shared so the two can never drift apart. */
function priceMax() {
  const rows = ranked();
  const top  = rows.length ? rows[0].wtp : 10;
  const tick = top <= 10 ? 2 : top <= 30 ? 5 : 10;
  return Math.max(tick * 2, Math.ceil(top / tick) * tick);
}

/* Where the price slider starts before anyone has touched it: the median of the
   class, which is the guess most people make out loud anyway, and is reliably
   wrong in the interesting direction. */
function defaultPrice() {
  const st = summary();
  return st.n ? Math.round(st.median * 4) / 4 : 10;
}

function drawProfit() {
  const cv = $('profitCanvas');
  if (!cv || $('viewOptimal').hidden) return;   // no size to measure while hidden

  const dpr = window.devicePixelRatio || 1;
  const rect = cv.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  if (W < 20 || H < 20) return;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  const css = getComputedStyle(document.documentElement);
  const LINE  = css.getPropertyValue('--line').trim()  || '#e5e5e3';
  const MUTED = css.getPropertyValue('--muted').trim() || '#8a8a8a';
  const ACCENT= css.getPropertyValue('--accent').trim()|| '#e05c3e';

  const all = ranked();
  if (!all.length) return;

  const cast = series(state.profitView);
  const colour = s => css.getPropertyValue(s.varName).trim() || '#2563eb';

  const c = state.cost;
  const padL = 44, padR = 12, padT = 12, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  if (plotW <= 10 || plotH <= 10) return;

  // Price runs across the same range as the demand chart's y-axis, so the two
  // charts share a scale and "$8 over there" is "$8 over here".
  const top  = all[0].wtp;
  const tick = top <= 10 ? 2 : top <= 30 ? 5 : 10;
  const pMax = priceMax();

  // Line the slider's travel up with the plot. The thumb's centre stops half a
  // thumb short of each end, so the margins are the chart's padding less that.
  const sl = $('priceSlideWrap');
  sl.style.marginLeft  = (padL - 9.5) + 'px';
  sl.style.marginRight = (padR - 9.5) + 'px';

  // One optimum per curve. They share a profit axis so the hills are directly
  // comparable — a segment worth half as much should look half as tall.
  const peaks = cast.map(s => optimumIn(s.rows, c));
  const best = peaks[0];                          // pooled: the only one there is
  const yMax = Math.max(...peaks.map(b => b ? b.profit : 0), 1) * 1.12;

  const X = p => padL + (p / pMax) * plotW;
  const Y = v => padT + plotH - (v / yMax) * plotH;

  // Both markers write their own price onto the axis further down. Their
  // positions are needed up here so a tick label that would end up underneath
  // one is dropped outright, rather than left half-covered by its white patch.
  const up = Math.max(0, Math.min(pMax, state.price ?? defaultPrice()));
  const ux = X(up);
  // Only one curve gets its best price written on the axis. With three peaks
  // plus your own price the strip of axis turns to soup, so in segments mode
  // the numbers live in the table underneath and the chart keeps just the dots.
  const single = cast.length === 1;
  const bx = single && best && best.profit > 0 ? X(best.price) : null;

  const MARK_FONT = 'bold 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  const TICK_FONT = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.font = MARK_FONT;
  const uw = g.measureText(money(up)).width;
  const bw = bx === null ? 0 : g.measureText(money(best.price)).width;

  // Measured rather than guessed at: the white patch behind a marker's label is
  // as wide as the label, so a fixed threshold clips a tick at one price range
  // and drops too many at another.
  const buried = (x, half) =>
    (single && Math.abs(x - ux) < uw / 2 + half + 5) ||
    (bx !== null && Math.abs(x - bx) < bw / 2 + half + 5);

  // ---- axes: baseline and price ticks
  g.strokeStyle = '#d8d8d4'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(padL, Y(0) + .5); g.lineTo(W - padR, Y(0) + .5); g.stroke();

  g.font = TICK_FONT;
  g.fillStyle = MUTED; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let p = 0; p <= pMax + 0.001; p += tick) {
    const lbl = '$' + p;
    if (!buried(X(p), g.measureText(lbl).width / 2)) g.fillText(lbl, X(p), padT + plotH + 6);
  }
  g.textAlign = 'center';
  g.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  g.fillText('price', padL + plotW / 2, padT + plotH + 19);

  // ---- profit ticks, rounded to something readable at this height
  const pt = yMax <= 20 ? 5 : yMax <= 60 ? 20 : yMax <= 200 ? 50 : yMax <= 600 ? 100 : 250;
  g.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let v = pt; v <= yMax; v += pt) {
    const y = Y(v);
    g.strokeStyle = LINE;
    g.beginPath(); g.moveTo(padL, y + .5); g.lineTo(W - padR, y + .5); g.stroke();
    g.fillStyle = MUTED; g.fillText('$' + v, padL - 6, y);
  }

  // ---- the profit curve. Sampled finely rather than drawn as steps: what the
  // class should see is a hill with a peak, and the sawtooth of the exact
  // function is a distraction at this size. Nothing below the axis — under cost
  // profit dives steeply negative and would flatten everything worth looking at.
  const steps = Math.max(60, Math.round(plotW));
  cast.forEach(s => {
    if (!s.rows.length) return;
    g.beginPath();
    let started = false;
    for (let i = 0; i <= steps; i++) {
      const p = (i / steps) * pMax;
      const v = profitIn(s.rows, p, c);
      if (v < 0) { started = false; continue; }
      const x = X(p), y = Y(v);
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    }
    g.strokeStyle = colour(s); g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
  });

  // ---- the price you have set: a plain vertical line the full height of the
  // plot, so it stays visible even where profit is zero and the curve is flat
  // on the axis. Drawn before the peak so the accent marker sits on top of it.
  const INK = css.getPropertyValue('--ink').trim() || '#1a1a1a';
  let uxc = -1e6;                                 // off-plot until there is a line

  if (single) {
    g.save();
    g.strokeStyle = INK; g.lineWidth = 1.5; g.globalAlpha = .5;
    g.beginPath(); g.moveTo(ux, padT); g.lineTo(ux, Y(0)); g.stroke();
    g.restore();

    const uv = profitIn(cast[0].rows, up, c);
    if (uv > 0) {
      g.beginPath(); g.arc(ux, Y(uv), 4, 0, Math.PI * 2);
      g.fillStyle = INK; g.fill();
    }

    // its price on the axis, on a white patch so it covers the tick beneath
    g.font = MARK_FONT;
    g.textAlign = 'center'; g.textBaseline = 'top';
    uxc = Math.min(Math.max(ux, padL + uw / 2 + 4), W - padR - uw / 2 - 4);
    g.fillStyle = '#fff';
    g.fillRect(uxc - uw / 2 - 4, padT + plotH + 4, uw + 8, 15);
    g.fillStyle = INK;
    g.fillText(money(up), uxc, padT + plotH + 6);
  }

  // ---- each peak: a drop to the price axis and a dot, in that curve's colour.
  // Pooled uses the accent so it reads as "the answer"; split, each peak wears
  // its own segment's colour so it is obvious which hill it tops.
  peaks.forEach((b, i) => {
    if (!b || b.profit <= 0) return;
    const px = X(b.price), py = Y(b.profit);
    const col = single ? ACCENT : colour(cast[i]);
    g.save();
    g.setLineDash([4, 4]); g.strokeStyle = col; g.lineWidth = 1.5; g.globalAlpha = .75;
    g.beginPath(); g.moveTo(px, py); g.lineTo(px, Y(0)); g.stroke();
    g.restore();
    g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2);
    g.fillStyle = col; g.fill();
  });

  if (bx === null) return;                        // split: no label on the axis

  const lbl = money(best.price);
  g.font = MARK_FONT;
  g.textAlign = 'center'; g.textBaseline = 'top';
  const w = bw;
  const bxc = Math.min(Math.max(bx, padL + w / 2 + 4), W - padR - w / 2 - 4);

  // Both labels live on the same strip of axis. When the price you have set is
  // near the best one they would overprint, and the dropped line already says
  // where the peak is — so the peak's label gives way rather than smear.
  if (Math.abs(bxc - uxc) < (w + uw) / 2 + 6) return;

  g.fillStyle = '#fff';
  g.fillRect(bxc - w / 2 - 4, padT + plotH + 4, w + 8, 15);
  g.fillStyle = ACCENT;
  g.fillText(lbl, bxc, padT + plotH + 6);
}

function renderOptimal() {
  const c = state.cost;
  const n = state.responses.length;
  const best = n ? optimum(c) : null;
  const pMax = priceMax();

  // The price slider only spans prices that exist on the chart, and the chart's
  // range moves with the class, so its bounds are reset on every render.
  if (state.price === null) state.price = defaultPrice();
  state.price = Math.max(0, Math.min(pMax, state.price));
  const p = state.price;

  const ps = $('priceSlider');
  ps.max = String(pMax);
  ps.value = String(p);
  $('priceVal').textContent = money(p);
  $('costSlider').value = String(c);
  $('costVal').textContent = money(c);

  $('profitEmpty').classList.toggle('hidden', n > 0);

  const cast = series(state.profitView);
  const split = cast.length > 1;
  $('pooledBlocks').hidden   = split;
  $('segBlocks').hidden      = !split;
  // One price only means something against one market. Split, the answer is a
  // price per segment, and a single slider laid over three curves invites the
  // exact confusion the split exists to clear up.
  $('yourPriceBlock').hidden = split;

  if (split) renderSegmentBlocks(cast, c);
  else       renderPooledBlocks(n, p, c, best);

  drawProfit();
}

function renderPooledBlocks(n, p, c, best) {
  // ---- what YOUR price does
  const qty = n ? quantityAt(p) : 0;
  const mine = n ? profitAt(p, c) : 0;
  $('uQty').textContent    = n ? String(qty)  : '–';
  $('uProfit').textContent = n ? money(mine)  : '–';
  $('uFoot').textContent = !n ? ''
    : p < c ? `Below the ${money(c)} it costs to make — every sale loses money.`
    : qty === 0 ? 'Nobody in the class would pay that much.'
    : `${qty} of ${n} buy; ${n - qty} walk away. Margin ${money(p - c)} each.`;

  // ---- and what the best price does
  $('oPrice').textContent  = best ? money(best.price) : '–';
  $('oQty').textContent    = best ? String(best.qty)  : '–';
  $('oProfit').textContent = best ? money(best.profit) : '–';

  if (!n) {
    $('oFoot').textContent = '';
  } else if (!best || best.profit <= 0) {
    $('oFoot').textContent = `Nobody is willing to pay ${money(c)}, so there is no price worth setting.`;
  } else {
    const gap = best.profit - mine;
    $('oFoot').textContent = gap <= 0.001
      ? 'That is the price you have set — you found it.'
      : `${money(gap)} more than your price makes.`;
  }
}

/* The best price for each segment on its own, and what that adds up to against
   the best single price for everyone — which is the whole argument for
   splitting a market, in one line. */
function renderSegmentBlocks(cast, c) {
  const css = getComputedStyle(document.documentElement);
  const cell = (text, cls) => {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  };
  const table = (el, head, rows, total) => {
    el.innerHTML = '';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    head.forEach(h => { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
    thead.appendChild(hr); el.appendChild(thead);
    const tb = document.createElement('tbody');
    rows.forEach(r => {
      const tr = document.createElement('tr');
      r.cells.forEach((t, i) => {
        const td = cell(t);
        if (i === 0 && r.colour) td.style.color = r.colour;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    if (total) {
      const tr = document.createElement('tr');
      tr.className = 'total';
      total.forEach(t => tr.appendChild(cell(t)));
      tb.appendChild(tr);
    }
    el.appendChild(tb);
  };

  const col = s => css.getPropertyValue(s.varName).trim();

  // ---- the best price for each segment on its own
  let apart = 0;
  const bestRows = cast.map(s => {
    const b = optimumIn(s.rows, c);
    if (b) apart += b.profit;
    return {
      colour: col(s),
      cells: [SEG_NAMES[s.k], b ? money(b.price) : '–',
              b ? `${b.qty}/${s.rows.length}` : '–', b ? money(b.profit) : '–']
    };
  });
  table($('segBest'), ['Seg', 'Price', 'Buy', 'Profit'], bestRows,
        ['Total', '', '', money(apart)]);

  // Against the best SINGLE price — the fair benchmark, and the reason there is
  // no price slider on this view to muddle it with.
  const one = optimum(c);
  const gain = apart - (one ? one.profit : 0);
  $('segFootB').textContent = !one || one.profit <= 0
    ? 'No price covers the cost in any segment.'
    : gain <= 0.001
      ? `The same as the best single price of ${money(one.price)}: these segments do not differ enough to be worth splitting.`
      : `${money(gain)} more than the best single price for everyone (${money(one.price)} → ${money(one.profit)}).`;
}

function setView(view) {
  const next = view === 'optimal' ? 'optimal' : 'class';
  state.view = next;
  $('viewClass').hidden   = next !== 'class';
  $('viewOptimal').hidden = next !== 'optimal';
  $('viewClassBtn').classList.toggle('is-on',   next === 'class');
  $('viewOptimalBtn').classList.toggle('is-on', next === 'optimal');
  save();
  if (next === 'optimal') renderOptimal();
}

/* ------------------------------------------------------------------ hover */

/* Hit-testing is by COLUMN, not by proximity to the dot. Each student owns a
 * vertical slice of the plot one step wide, so the cursor only has to be
 * somewhere in that slice and roughly level with the curve. Requiring the
 * cursor to land within a few pixels of a 3px dot is unusable on a projector,
 * and impossible once the class is large enough that steps are narrow. */
function pickPoint(mx, my) {
  if (!geom || !geom.n) return -1;
  const { padL, padT, plotW, plotH, nMax } = geom;
  if (mx < padL || mx > padL + plotW || my < padT || my > padT + plotH) return -1;

  const i = Math.floor(((mx - padL) / plotW) * nMax);
  if (i < 0) return -1;

  // Several curves can own the same column, so the column narrows the field and
  // height decides between them — nearest curve to the cursor wins.
  let best = -1, bestDy = Infinity;
  points.forEach((p, idx) => {
    if (p.step !== i) return;
    const dy = Math.abs(my - p.y);
    if (dy <= HIT_BAND && dy < bestDy) { best = idx; bestDy = dy; }
  });
  return best;
}

/* Read the cursor's height back as a price. */
function priceAt(my) {
  if (!geom) return null;
  const { padT, plotH, yMax } = geom;
  if (my < padT || my > padT + plotH) return null;
  const p = ((padT + plotH - my) / plotH) * yMax;
  return Math.max(0, Math.round(p * 4) / 4);        // quarters, like the answers
}

function onMove(e) {
  const cv = $('demandCanvas');
  const rect = cv.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;

  if (state.mode === 'price') {
    if (pricePinned) return;                        // line is locked; ignore the mouse
    const inPlot = geom && mx >= geom.padL && mx <= geom.padL + geom.plotW;
    const p = inPlot ? priceAt(my) : null;
    if (p !== hoverPrice) { hoverPrice = p; drawChart(); showPriceBox(); }
    cv.classList.toggle('pointing', p !== null);
    return;
  }

  const idx = pickPoint(mx, my);
  if (idx !== hoverIdx) {
    hoverIdx = idx;
    cv.classList.toggle('pointing', idx >= 0);
    markRow(idx >= 0 && points[idx] ? points[idx].id : null);
    drawChart();
  }
  const tip = $('tip');
  if (idx >= 0) {
    const p = points[idx];
    tip.innerHTML = `<div class="tip-name"></div><div class="tip-wtp"></div>`;
    tip.querySelector('.tip-name').textContent = p.name || 'Anonymous';
    tip.querySelector('.tip-wtp').textContent = `would pay ${money(p.wtp)}`;
    tip.style.left = p.x + 'px';
    tip.style.top = (p.y - 12) + 'px';
    tip.hidden = false;
  } else {
    tip.hidden = true;
  }
}

function onLeave() {
  if (state.mode === 'price') {
    if (pricePinned) return;                        // keep it up while it is locked
    if (hoverPrice !== null) { hoverPrice = null; drawChart(); showPriceBox(); }
  } else if (hoverIdx !== -1) {
    hoverIdx = -1; markRow(null); drawChart();
  }
  $('tip').hidden = true;
  $('demandCanvas').classList.remove('pointing');
}

/* Click locks the price line so it stays put while you talk about it. */
function onClick() {
  if (state.mode !== 'price' || hoverPrice === null) return;
  pricePinned = !pricePinned;
  showPriceBox();
}

function showPriceBox() {
  const box = $('priceBox');
  if (state.mode !== 'price' || hoverPrice === null || !summary().n) {
    box.hidden = true;
    return;
  }
  const cast = series(state.demandView);
  const n = visible().length;
  $('pbPrice').textContent = money(hoverPrice);

  if (cast.length === 1) {
    const q = qtyIn(cast[0].rows, hoverPrice);
    $('pbQty').textContent   = `${q} would buy`;
    $('pbShare').textContent = `${Math.round(100 * q / n)}% of the class`;
  } else {
    // With the class split, one price sells a different amount into each
    // segment — so the box lists them rather than a single misleading total.
    const q = cast.map(s => qtyIn(s.rows, hoverPrice));
    $('pbQty').textContent = q.reduce((a, b) => a + b, 0) + ' would buy';
    $('pbShare').textContent = cast
      .map((s, i) => `${SEG_NAMES[s.k]} ${q[i]}/${s.rows.length}`).join(' · ');
  }
  $('pbPin').textContent   = pricePinned ? 'locked — click to release' : '';
  box.hidden = false;
}

function setMode(mode) {
  const next = mode === 'price' ? 'price' : 'students';
  // Only clear the hover state on an actual switch. syncInputs() calls this on
  // every remote update, and a pinned price must survive students arriving.
  if (next !== state.mode) {
    hoverIdx = -1; hoverPrice = null; pricePinned = false;
  }
  state.mode = next;
  $('tip').hidden = true;
  $('modeStudents').classList.toggle('is-on', state.mode === 'students');
  $('modePrice').classList.toggle('is-on', state.mode === 'price');
  $('hoverHint').textContent = state.mode === 'price'
    ? 'Move up and down the chart to set a price; click to lock it.'
    : 'Hover anywhere along the curve to see who each student is.';
  showPriceBox();
  save();
  drawChart();
}

/* ------------------------------------------------------------- the numbers */

/* Every answer as a row you can point at. Rank is always by willingness to pay,
 * highest = 1, so a student keeps the same number whichever way you sort — the
 * list reorders, the identity does not. */
let listStale = false;

function renderList() {
  // "Show the numbers" is shut most of the time, and rebuilding a few hundred
  // rows into a multi-column layout nobody can see is the single most expensive
  // thing an arrival does. Defer it to the moment it is opened.
  if (!$('numbersBox').open) { listStale = true; return; }
  listStale = false;

  const list = $('wtpList');
  const rows = ranked();
  const order = state.sort === 'asc' ? rows.slice().reverse() : rows;
  const split = state.segCount > 1;

  // Ranks come from one pass, not a lookup per row: renderList runs on every
  // arrival, and a 500-student class would otherwise re-sort 500 times per
  // frame while they file in. Split, a student is ranked within their OWN
  // segment, because that is the curve they are a step on.
  const rank1 = new Map();
  if (split) {
    for (let k = 0; k < state.segCount; k++) {
      rankedOf(inSeg(k)).forEach((r, i) => rank1.set(r.id, i + 1));
    }
  } else {
    rows.forEach((r, i) => rank1.set(r.id, i + 1));
  }

  const css = getComputedStyle(document.documentElement);
  const segCol = k => css.getPropertyValue(SEG_VARS[k]).trim();

  list.innerHTML = '';
  order.forEach(r => {
    const li = document.createElement('li');
    li.className = 'wtp-row' + (r.sim ? ' sim' : '') + (r.id === newestId ? ' new' : '');
    li.dataset.id = r.id;
    const k = document.createElement('span'); k.className = 'wtp-rank';
    k.textContent = '#' + rank1.get(r.id);
    const n = document.createElement('span'); n.className = 'wtp-name';
    n.textContent = r.name || 'Anonymous';
    const w = document.createElement('span'); w.className = 'wtp-wtp';
    w.textContent = money(r.wtp);
    if (split) {
      const s = document.createElement('span'); s.className = 'wtp-seg';
      s.textContent = SEG_NAMES[segOf(r)];
      s.style.color = segCol(segOf(r));
      li.append(k, s, n, w);
    } else {
      li.append(k, n, w);
    }
    list.appendChild(li);
  });

  $('numbersHint').textContent = rows.length
    ? 'Hover a row to find that student on the curve.' : '';
}

/* Which drawn point is this student? points[] is rebuilt on every draw and is
   the only thing that knows the current layout — with the class pooled a
   student sits in one place, split they sit in another, and in pooled view a
   segment's students are not drawn separately at all. */
function rankOf(id) { return points.findIndex(p => p.id === id); }

/* Hovering the list drives the same highlight the chart's own hover does, and
   hovering the chart lights the matching row. One hovered student, two views
   of it. */
function markRow(id) {
  document.querySelectorAll('.wtp-row.on').forEach(el => el.classList.remove('on'));
  if (id) {
    const el = document.querySelector(`.wtp-row[data-id="${id}"]`);
    if (el) el.classList.add('on');
  }
}

function hoverStudent(id) {
  const i = id === null ? -1 : rankOf(id);
  if (i === hoverIdx) return;
  hoverIdx = i;
  markRow(i < 0 ? null : id);
  drawChart();
}

/* ---------------------------------------------------------------- segments */

function renderLegend() {
  const box = $('legend');
  const cast = series(state.demandView);
  if (cast.length < 2) { box.hidden = true; box.innerHTML = ''; return; }

  const css = getComputedStyle(document.documentElement);
  box.innerHTML = '';
  cast.forEach(s => {
    const item = document.createElement('span'); item.className = 'legend-item';
    const sw = document.createElement('span'); sw.className = 'legend-swatch';
    sw.style.background = css.getPropertyValue(s.varName).trim();
    const label = document.createElement('span'); label.textContent = s.label;
    const n = document.createElement('span'); n.className = 'legend-n';
    n.textContent = s.rows.length ? `${s.rows.length} answers` : 'waiting';
    item.append(sw, label, n);
    box.appendChild(item);
  });
  box.hidden = false;
}

/* Changing the count HIDES segments rather than deleting them, so going 3 → 2
   and back brings segment C's answers straight back. Nothing a student typed is
   thrown away by a click on a toggle. */
function setSegCount(n) {
  const next = Math.min(3, Math.max(1, n | 0));
  const changed = next !== state.segCount;
  state.segCount = next;
  SEG_NAMES.forEach((_, i) => $('seg' + (i + 1)).classList.toggle('is-on', i + 1 === next));

  const split = next > 1;
  $('demandViewToggle').hidden = !split;
  $('profitViewToggle').hidden = !split;
  $('chartNote').textContent = split
    ? 'One curve per segment, each drawn from its own link. Read across at any price to see how many in each would still buy.'
    : "Every student's maximum, highest first. Read across at any price to see how many are still willing to buy. Each step is one student.";

  if (changed) { hoverIdx = -1; $('tip').hidden = true; }
  save();
  if (changed) { renderJoin(); render(); }
}

function setDemandView(v) {
  state.demandView = v === 'pooled' ? 'pooled' : 'segments';
  $('demandSegs').classList.toggle('is-on', state.demandView === 'segments');
  $('demandPool').classList.toggle('is-on', state.demandView === 'pooled');
  hoverIdx = -1; $('tip').hidden = true;        // points[] is about to be rebuilt
  save();
  renderLegend();
  drawChart();
  showPriceBox();
}

function setProfitView(v) {
  state.profitView = v === 'pooled' ? 'pooled' : 'segments';
  $('profitSegs').classList.toggle('is-on', state.profitView === 'segments');
  $('profitPool').classList.toggle('is-on', state.profitView === 'pooled');
  save();
  if (state.view === 'optimal') renderOptimal();
}

function setSort(sort) {
  state.sort = sort === 'asc' ? 'asc' : 'desc';
  $('sortDesc').classList.toggle('is-on', state.sort === 'desc');
  $('sortAsc').classList.toggle('is-on',  state.sort === 'asc');
  save();
  renderList();
}

/* ----------------------------------------------------------------- render */

function render() {
  const st = summary();

  $('emptyNote').classList.toggle('hidden', st.n > 0);
  $('undoBtn').disabled = st.n === 0 || live;

  $('sResponses').textContent = st.n;
  $('sMax').textContent    = st.n ? money(st.max)    : '–';
  $('sMedian').textContent = st.n ? money(st.median) : '–';
  $('sMean').textContent   = st.n ? money(st.mean)   : '–';
  $('sMin').textContent    = st.n ? money(st.min)    : '–';
  $('statFoot').textContent = st.n
    ? `Half the class would pay more than ${money(st.median)}, half less.`
    : '';

  if (st.n) {
    $('numbersLine').innerHTML =
      `<code>${st.n}</code> responses · median <code>${money(st.median)}</code> · ` +
      `mean <code>${money(st.mean)}</code> · range <code>${money(st.min)}</code>–<code>${money(st.max)}</code>`;
  } else {
    $('numbersLine').textContent = 'Nothing submitted yet.';
  }

  renderList();
  drawChart();
  renderLegend();
  showPriceBox();
  if (state.view === 'optimal') renderOptimal();
}

function syncInputs() {
  $('classSize').value = state.classSize;
  setSegCount(state.segCount);  // also shows or hides the two segment toggles
  setDemandView(state.demandView);
  setProfitView(state.profitView);
  setMode(state.mode);
  setSort(state.sort);
  setView(state.view);          // renderOptimal() fills both sliders from state
}
function commit() { save(); render(); }

/* ---------------------------------------------------------------- arrivals */

/* Students arrive a few per second rather than all at once, so the class watches the
 * curve assemble. Each arrival is saved, so a second tab on the projector fills
 * in at the same pace. */
function startArrivals(target) {
  const btn = $('arriveBtn');
  btn.classList.add('running');
  const tick = () => {
    if (state.responses.length >= target) { stopArrivals(); return; }
    newestId = addSimulated().id;
    commit();
    btn.textContent = `Arriving… ${state.responses.length}/${target}`;
    if (state.responses.length >= target) stopArrivals();
  };
  tick();                                   // first one lands immediately
  arrivalTimer = setInterval(tick, ARRIVAL_MS);
}

function stopArrivals() {
  if (!arrivalTimer) return;
  clearInterval(arrivalTimer);
  arrivalTimer = null;
  const btn = $('arriveBtn');
  btn.classList.remove('running');
  btn.textContent = 'Students arrive';
  render();                                 // let the x-axis snap to the real count
}

/* ------------------------------------------------------------------- live */

/* The socket.io client is loaded FROM the server, on demand. That keeps the
   dashboard fully usable with no network at all when it is running on
   simulated answers — which is the fallback if the wifi dies mid-lecture. */
function loadSocketIo(base) {
  if (window.io) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = base.replace(/\/$/, '') + '/socket.io/socket.io.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not reach the server'));
    document.head.appendChild(s);
  });
}

const normRoom = r => String(r || '').trim().toUpperCase()
  .replace(/[^A-Z0-9-]/g, '').slice(0, 12) || '15010';

function liveStatus(text, cls = '') {
  const el = $('liveStatus');
  el.textContent = text;
  el.className = 'live-status' + (cls ? ' ' + cls : '');
}

/* Segment k's room. One segment keeps the bare room code, so every student link
   and printed QR from before the split still works. */
function roomFor(k) {
  const room = normRoom(state.room);
  return state.segCount < 2 ? room : `${room}-${SEG_NAMES[k]}`;
}
const roomsNow = () => Array.from({ length: state.segCount }, (_, k) => roomFor(k));

/* A join box per segment, each with its own QR, its own link and the colour of
   the curve its students will draw. Which link a student is handed IS which
   segment they land in — that is the whole mechanism. */
function renderJoin() {
  const box = $('joinBoxes');
  box.innerHTML = '';
  if (!live) return;

  const base = (state.server || DEFAULT_SERVER).replace(/\/$/, '');
  const css = getComputedStyle(document.documentElement);
  const split = state.segCount > 1;

  roomsNow().forEach((room, k) => {
    const url = `${base}/r/${room}`;
    const wrap = document.createElement('div');
    wrap.className = 'join' + (split ? ' tagged' : '');
    if (split) wrap.style.borderLeftColor = css.getPropertyValue(SEG_VARS[k]).trim();

    const img = document.createElement('img');
    img.className = 'qr'; img.alt = `QR code for ${room}`;
    img.src = `${base}/qr.svg?text=${encodeURIComponent(url)}`;

    const text = document.createElement('div'); text.className = 'join-text';
    if (split) {
      const seg = document.createElement('span'); seg.className = 'join-seg';
      seg.textContent = 'Segment ' + SEG_NAMES[k];
      seg.style.color = css.getPropertyValue(SEG_VARS[k]).trim();
      text.appendChild(seg);
    }
    const lab = document.createElement('span'); lab.className = 'join-label';
    lab.textContent = 'Students go to';
    const code = document.createElement('code'); code.className = 'join-url';
    code.textContent = url.replace(/^https?:\/\//, '');
    text.append(lab, code);

    wrap.append(img, text);
    box.appendChild(wrap);
  });
}

async function goLive() {
  const base = DEFAULT_SERVER;
  const room = normRoom(state.room);
  state.server = base; state.room = room;
  save();

  liveStatus('Connecting…');
  try {
    await loadSocketIo(base);
  } catch (e) {
    liveStatus('Could not reach the server. Check the address, or stay on simulated answers.', 'err');
    return;
  }

  const rooms = roomsNow();
  socket = window.io(base, { transports: ['websocket', 'polling'], timeout: 8000 });

  socket.on('connect', () => {
    rooms.forEach((r, k) => {
      socket.emit('join', { room: r, role: 'dashboard' }, res => {
        if (!res) return;
        // A restart on the free tier looks like an empty room. Offer our copy back.
        const mine = inSeg(k);
        if (!res.responses.length && mine.length) socket.emit('restore', { room: r, responses: mine });
        else adoptRemote(k, res.responses);
      });
    });
    setLive(true);
    renderJoin();
  });

  socket.on('responses', payload => {
    if (!payload) return;
    const k = rooms.indexOf(payload.room);
    if (k < 0) return;                            // a room we are not showing
    adoptRemote(k, payload.responses);
    liveStatus(liveLine(), 'on');
  });

  socket.on('connect_error', () => liveStatus('Server unreachable — retrying…', 'err'));
  socket.on('disconnect', () => { if (live) liveStatus('Disconnected — retrying…', 'err'); });
}

// Per segment while split, because "23 submitted" across two rooms hides the
// thing you actually want to know: whether both links are being used.
function liveLine() {
  if (state.segCount < 2) return `Live · ${visible().length} submitted`;
  return 'Live · ' + SEG_NAMES.slice(0, state.segCount)
    .map((nm, k) => `${nm} ${inSeg(k).length}`).join(' · ');
}

/* Replaces one segment's answers, leaving the others alone — each room pushes
   its own full list, so merging by segment is what keeps them independent. */
function adoptRemote(k, responses) {
  const others = state.responses.filter(r => segOf(r) !== k);
  const mine = (responses || []).map(r => ({
    id: r.id, name: r.name, wtp: r.wtp, ts: r.ts, sim: false, seg: k
  }));
  state.responses = others.concat(mine);
  save();
  render();
}

function goOffline() {
  if (socket) { socket.close(); socket = null; }
  setLive(false);
  $('joinBoxes').innerHTML = '';
  liveStatus('Offline. The chart is showing simulated answers.');
}

function setLive(on) {
  live = on;
  $('liveBtn').textContent = on ? 'Stop' : 'Go live';
  $('liveBtn').classList.toggle('live-on', on);
  // Simulated answers would desync from the server the moment one arrived.
  ['arriveBtn', 'oneBtn', 'undoBtn'].forEach(id => { $(id).disabled = on; });
  $('classSize').disabled = on;
  // Re-splitting mid-stream would point at rooms nobody was sent to.
  [1, 2, 3].forEach(i => { $('seg' + i).disabled = on; });
}

/* ---------------------------------------------------------------- wiring */

document.addEventListener('DOMContentLoaded', () => {
  load(); syncInputs(); render();

  $('arriveBtn').addEventListener('click', () => {
    if (arrivalTimer) { stopArrivals(); return; }        // click again to stop early
    const n = Math.max(1, Math.min(500, Math.round(Number($('classSize').value) || 45)));
    state.classSize = n;
    state.responses = [];
    newestId = null; hoverIdx = -1; $('tip').hidden = true;
    commit();
    startArrivals(n);
  });

  $('oneBtn').addEventListener('click', () => {
    stopArrivals();
    newestId = addSimulated().id;
    commit();
  });

  $('undoBtn').addEventListener('click', () => {
    stopArrivals();
    state.responses.pop();
    newestId = null; hoverIdx = -1; $('tip').hidden = true;
    commit();
  });

  $('clearBtn').addEventListener('click', () => {
    // Two-step rather than a modal: confirm() dialogs are awkward on a projector.
    stopArrivals();
    const b = $('clearBtn');
    if (!state.responses.length) return;
    if (b.dataset.armed) {
      state.responses = []; newestId = null; hoverIdx = -1; $('tip').hidden = true;
      delete b.dataset.armed; b.textContent = 'Clear all';
      if (live && socket) socket.emit('clear', { room: state.room });
      commit();
    } else {
      b.dataset.armed = '1'; b.textContent = 'Click again';
      setTimeout(() => { delete b.dataset.armed; b.textContent = 'Clear all'; }, 4000);
    }
  });

  $('classSize').addEventListener('change', e => {
    state.classSize = Math.max(1, Math.min(500, Math.round(Number(e.target.value) || 45)));
    e.target.value = state.classSize;
    save();
  });

  const cv = $('demandCanvas');
  cv.addEventListener('mousemove', onMove);
  cv.addEventListener('mouseleave', onLeave);
  cv.addEventListener('click', onClick);

  // A stale code saved from an earlier session would silently send this class
  // to a room nobody was given a link to, and there is no field left to spot it
  // in — so the room is pinned to the default on every load.
  state.room = DEFAULTS.room;
  $('liveBtn').addEventListener('click', () => (live ? goOffline() : goLive()));

  $('modeStudents').addEventListener('click', () => setMode('students'));
  $('modePrice').addEventListener('click',    () => setMode('price'));

  $('viewClassBtn').addEventListener('click',   () => setView('class'));
  $('viewOptimalBtn').addEventListener('click', () => setView('optimal'));

  $('sortDesc').addEventListener('click', () => setSort('desc'));
  $('sortAsc').addEventListener('click',  () => setSort('asc'));

  [1, 2, 3].forEach(i => $('seg' + i).addEventListener('click', () => setSegCount(i)));
  $('demandSegs').addEventListener('click', () => setDemandView('segments'));
  $('demandPool').addEventListener('click', () => setDemandView('pooled'));
  $('profitSegs').addEventListener('click', () => setProfitView('segments'));
  $('profitPool').addEventListener('click', () => setProfitView('pooled'));

  // Delegated, because the rows are rebuilt on every arrival — binding each row
  // would mean rebinding 45 listeners several times a second while a class
  // files in. 'mouseover' rather than 'mouseenter': only the former bubbles.
  $('numbersBox').addEventListener('toggle', () => { if (listStale) renderList(); });

  const wtp = $('wtpList');
  wtp.addEventListener('mouseover', e => {
    const row = e.target.closest('.wtp-row');
    if (row) hoverStudent(row.dataset.id);
  });
  wtp.addEventListener('mouseleave', () => hoverStudent(null));

  // 'input' rather than 'change' so everything moves WHILE the handle is being
  // dragged. Watching the peak walk up as cost rises is the whole point of it.
  $('costSlider').addEventListener('input', e => {
    const v = Number(e.target.value);
    state.cost = Number.isFinite(v) ? Math.max(0, Math.min(MAX_WTP, v)) : 0;
    save();
    renderOptimal();
  });

  $('priceSlider').addEventListener('input', e => {
    const v = Number(e.target.value);
    state.price = Number.isFinite(v) ? Math.max(0, Math.min(priceMax(), v)) : 0;
    save();
    renderOptimal();
  });

  window.addEventListener('resize', () => { onLeave(); drawChart(); drawProfit(); });
});
