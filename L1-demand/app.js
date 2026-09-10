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
const MAX_WTP    = 60;     // the most a student may submit; matches the server
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

/* Behind the 15010.ai proxy this page is served under a per-section path
   prefix — 15010.ai/L1-AXX/ rather than the service's own /<key>/dashboard/ —
   because every section is a separate Render service and the section has to be
   somewhere in the URL. socket.io would otherwise dial <origin>/socket.io,
   which names no section and so reaches nothing. Everything before the route we
   know about is the prefix; served from Render direct there is none. */
function labPrefix() {
  const p = location.pathname;
  const r = p.indexOf('/r/');
  if (r >= 0) return p.slice(0, r);            // student form
  if (/\/dashboard\/?$/.test(p)) return '';    // dashboard on the service itself
  return p.replace(/\/$/, '');                 // dashboard behind the proxy
}
const LAB_PREFIX = location.protocol.startsWith('http') ? labPrefix() : '';

/* Only OUR origin is behind the proxy. If the Live panel is pointed at some
   other address the prefix does not belong on it. */
const prefixFor = base => (base === location.origin ? LAB_PREFIX : '');

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
                   segCount: 1, round: 1, curveView: '1',
                   surplusPrice: null, demandView: '1' };
let state = structuredClone(DEFAULTS);
let newestId = null;
let arrivalTimer = null;   // non-null while a class is arriving
let points = [];           // [{x, y, name, wtp}] rebuilt on every draw
let geom = null;           // plot rectangle, so hit-testing can use columns
let hoverIdx = -1;         // students mode: which student is under the cursor
let revealN = 0;           // surplus mode: how many bars of the area are up
let revealTimer = null;
let hoverPrice = null;     // price mode: the price the cursor is sitting at
let pricePinned = false;   // price mode: click to lock the line while you talk
let socket = null;         // non-null once live
let live = false;

const $ = id => document.getElementById(id);
/* Whole dollars lose their decimals. An axis reading "$40.00 / $30.00 / $20.00"
   is mostly noise on a projector, and answers land on quarters, so the cents
   are only worth printing when there are some: $40, but $8.25. */
const money = x =>
  '$' + (Math.round(x * 100) % 100 === 0 ? String(Math.round(x)) : x.toFixed(2));

/* ------------------------------------------------------------------ state */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = Object.assign(structuredClone(DEFAULTS), JSON.parse(raw));
    // A browser that used the old segment picker has 2 or 3 saved; this lab is
    // single-segment now, and a restored 3 would look for rooms that nothing
    // hands out.
    state.segCount = 1;
    state.round = Number(state.round) === 2 ? 2 : 1;
    if (!['1', '2', 'both'].includes(state.curveView)) state.curveView = '1';
    state.demandView = state.curveView;
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

/* Every answer carries the ROUND it was given in. The class answers the same
   question twice under different conditions, so round 2 sits alongside round 1
   rather than replacing it, and both can be drawn together. */
const roundOf = r => (Number(r.round) === 2 ? 2 : 1);
const inRound = n => state.responses.filter(r => roundOf(r) === n);
const roundsWithAnswers = () => [1, 2].filter(n => inRound(n).length);

/* Which round the NUMBERS describe. Averaging across two different conditions
   would be meaningless, so the stats always speak for exactly one round: the
   one being shown, or the current one when both curves are up. */
/* With BOTH curves up the numbers describe the later round that actually has
   answers -- not simply state.round. Pressing "Start round 2" before anyone has
   answered it must not blank the panel and wipe round 1 off the chart. */
const focusRound = () => {
  if (state.curveView === '1') return 1;
  if (state.curveView === '2') return 2;
  const have = roundsWithAnswers();
  return have.length ? have[have.length - 1] : state.round;
};
const visible = () => inRound(focusRound());

// Sorted highest first — that ordering IS the demand curve.
const rankedOf = list => list.slice().sort((a, b) => b.wtp - a.wtp);
const ranked = () => rankedOf(visible());

/* One entry per curve to draw. Pooled is the whole class as a single market;
   segments are the separate ones. Everything downstream — the chart and the
   legend — reads this rather than deciding for itself. */
/* Violet, not --seg-b: that is the same #e05c3e as --accent, which paints the
   surplus price line and the price-mode crosshair. Round 2's curve and the price
   line were indistinguishable in exactly the view where they matter most. */
const ROUND_VARS  = ['--blue', '--seg-c'];
const ROUND_LABEL = ['Round 1', 'Round 2'];

function series(view) {
  const both = view === 'both';
  const shown = both ? roundsWithAnswers() : [view === '2' ? 2 : 1];
  // Before a second round exists there is only one curve, and calling it
  // "Round 1" on a chart with nothing to compare it to is just noise.
  if (shown.length < 2) {
    const n = shown[0] || 1;
    return [{ k: n - 1, label: roundsWithAnswers().length > 1 ? ROUND_LABEL[n - 1] : 'The class',
              rows: rankedOf(inRound(n)), varName: ROUND_VARS[n - 1] }];
  }
  return shown.map(n => ({
    k: n - 1, label: ROUND_LABEL[n - 1], rows: rankedOf(inRound(n)), varName: ROUND_VARS[n - 1]
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

function addResponse(wtp, name, sim = false, round = state.round) {
  const r = { id: crypto.randomUUID(), name, wtp, ts: Date.now(), sim, round };
  state.responses.push(r);
  return r;
}

/* Round-robin rather than random, so the curves grow at the same rate and the
   room watches both fill in together instead of one racing ahead. */
function addSimulated() {
  // Round 1 is the constrained one -- no time to go anywhere else -- and round 2
  // hands the substitutes back, so a rehearsal should show the curve moving
  // DOWN, not a second random cloud.
  const wtp = simulatedWtp(0) * (state.round === 2 ? 0.6 : 1);
  return addResponse(Math.min(MAX_WTP, Math.round(wtp * 4) / 4),
                     simulatedName(), true, state.round);
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
  const AXIS  = '#9c9c96';        // darker than a gridline, lighter than ink
  const ACCENT= css.getPropertyValue('--accent').trim()|| '#e05c3e';
  const colour = s => css.getPropertyValue(s.varName).trim() || '#2563eb';

  // padL has to clear both the "$00.00" ticks and the rotated axis title
  /* Margins are sized for the TYPE, not chosen once. The widest thing on the
     left is not a tick label -- those are whole dollars now -- but the
     price-mode readout, which carries cents and sits on a white patch: at bold
     15px "$15.25" needs about 54px, and it must still clear the rotated axis
     title. */
  const padL = 100, padR = 20, padT = 30, padB = 60;
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
  // off the top of the plot. It spans EVERY curve on screen, not just the round
  // the numbers describe: round 2 takes the substitutes back and comes in lower,
  // so scaling to it alone would push round 1 off the top of the chart.
  const highest = Math.max(0, ...cast.map(sr => (sr.rows.length ? sr.rows[0].wtp : 0)));
  // The price line has to fit as well. Set a price above everyone's answer and
  // it used to be painted above the canvas: no line, no label, no bars, and no
  // hint that anything had happened.
  const priceOnPlot = state.mode === 'surplus' && Number.isFinite(state.surplusPrice)
    ? state.surplusPrice : 0;
  const top = Math.max(highest, priceOnPlot) || 10;
  const tick = top <= 10 ? 2 : top <= 30 ? 5 : 10;
  const yMax = Math.max(tick * 2, Math.ceil(top / tick) * tick);

  const X = q => padL + (q / nMax) * plotW;
  const Y = p => padT + plotH - (p / yMax) * plotH;

  geom = { padL, padT, plotW, plotH, nMax, yMax, n: longest };

  // ---- grid + y ticks
  g.font = '15px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let p = 0; p <= yMax + 0.001; p += tick) {
    const y = Y(p);
    g.strokeStyle = LINE;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, y + .5); g.lineTo(W - padR, y + .5); g.stroke();
    g.strokeStyle = AXIS; g.beginPath();
    g.moveTo(padL - 5, y + .5); g.lineTo(padL, y + .5); g.stroke();
    g.fillStyle = MUTED; g.fillText(money(p), padL - 12, y);
  }

  // ---- x ticks
  g.textAlign = 'center'; g.textBaseline = 'top';
  const stepQ = nMax <= 20 ? 5 : nMax <= 60 ? 10 : 20;
  for (let q = stepQ; q <= nMax; q += stepQ) {
    g.strokeStyle = AXIS; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(q) + .5, padT + plotH); g.lineTo(X(q) + .5, padT + plotH + 5); g.stroke();
    g.fillStyle = MUTED; g.fillText(String(q), X(q), padT + plotH + 11);
  }

  /* ---- the axes themselves. Drawn after the grid so they sit on top of it,
     and darker than a gridline: the eye needs to know where the figure starts,
     particularly with a staircase that can run right along the bottom. */
  g.strokeStyle = AXIS; g.lineWidth = 1.25; g.lineCap = 'square';
  g.beginPath();
  g.moveTo(padL + .5, padT);                                  // up the left
  g.lineTo(padL + .5, padT + plotH + .5);
  g.lineTo(W - padR, padT + plotH + .5);                       // along the bottom
  g.stroke();
  g.lineCap = 'butt';

  // ---- axis titles
  g.fillStyle = MUTED;
  g.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  g.fillText('students who would buy', padL + plotW / 2, padT + plotH + 36);
  g.save();
  g.translate(22, padT + plotH / 2); g.rotate(-Math.PI / 2);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('Price', 0, 0);
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
      points.push({ x, y, name: r.name, wtp: r.wtp, id: r.id, token: r.token,
                    seg: roundOf(r) - 1, col, step: i });
      // In price mode the dots are off, and in a big class they would smear
      // into a line. Either way the LIT ones are drawn further down instead of
      // here, so they sit on top of every curve rather than under the next one.
      if (priceMode || dense) return;
      g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2);
      g.fillStyle = '#fff'; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = col; g.stroke();
    });
  });

  /* ---- the area, built one student at a time. Each bar is that student's
     surplus; side by side, highest first, they ARE the area between the curve
     and the price. Drawn before the hover guides so a bar never sits on top of
     the one being pointed at. */
  if (state.mode === 'surplus' && Number.isFinite(state.surplusPrice) && revealN > 0) {
    const yPrice = Y(state.surplusPrice);
    g.save();
    cast.forEach(sr => {
      const col = colour(sr);
      sr.rows.forEach((r, i) => {
        if (i >= revealN) return;
        if (r.wtp < state.surplusPrice) return;      // no surplus below the price
        const x = X(i + 0.5);
        g.beginPath(); g.moveTo(x, Y(r.wtp)); g.lineTo(x, yPrice);
        // Column pitch is plotW/nMax, so the bar must be measured against nMax.
        // Against all.length (the focus round only) bars ran up to 3x wider than
        // their own step and merged into a solid block.
        g.strokeStyle = col; g.globalAlpha = .5;
        g.lineWidth = Math.max(2, (plotW / nMax) * 0.7);
        g.stroke();
      });
    });
    g.restore();
  }

  // ---- guides to both axes for the student under the cursor, wherever the
  // cursor is — over the curve itself, or over their row in the list
  const mates = hoverIdx >= 0 ? mateIdxs(hoverIdx) : [];

  /* The same person, one round apart. Their two answers share a token, so with
     both curves up the other one lights up at the same time and the vertical
     gap between the dots IS what the second condition did to them -- which is
     the whole reason for asking twice. Fainter, and drawn first, so it reads as
     the echo rather than as the thing being pointed at. */
  mates.forEach(i => {
    const m = points[i];
    if (!m) return;
    g.save();
    g.setLineDash([3, 4]); g.strokeStyle = m.col; g.globalAlpha = .3; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(padL, m.y); g.lineTo(m.x, m.y);
    g.moveTo(m.x, m.y); g.lineTo(m.x, padT + plotH);
    g.stroke();
    g.restore();
  });

  if (hoverIdx >= 0 && points[hoverIdx]) {
    const p = points[hoverIdx];
    const surplusMode = state.mode === 'surplus' && Number.isFinite(state.surplusPrice);
    const buys = surplusMode && p.wtp >= state.surplusPrice;

    g.save();
    g.setLineDash([3, 4]); g.strokeStyle = p.col; g.globalAlpha = .45; g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, p.y); g.lineTo(p.x, p.y);
    // Down to the axis normally. In surplus mode the drop stops at the price
    // instead, because the bit BELOW the price is what they hand over -- it is
    // not theirs, and drawing through it muddles the one thing being shown.
    if (!surplusMode) { g.moveTo(p.x, p.y); g.lineTo(p.x, padT + plotH); }
    g.stroke();
    g.restore();

    /* The surplus itself: a solid bar from the student's maximum down to the
       price. Its LENGTH is the answer, so it is drawn heavy and on top of the
       faint guides rather than as another dashed hint. */
    if (buys) {
      const yPrice = Y(state.surplusPrice);
      g.save();
      g.strokeStyle = p.col; g.lineWidth = 4; g.lineCap = 'butt';
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x, yPrice); g.stroke();

      const gain = p.wtp - state.surplusPrice;
      if (yPrice - p.y > 17) {                    // only when the bar can hold it
        g.fillStyle = p.col;
        g.font = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
        g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(money(gain), p.x + 7, (p.y + yPrice) / 2);
      }
      g.restore();
    }
  }

  /* Both lit dots last of all, so neither ends up under a curve, a surplus bar
     or the other one's guides. The primary is the solid one. */
  [hoverIdx, ...mates].forEach((i, k) => {
    const p = points[i];
    if (!p) return;
    g.save();
    g.globalAlpha = k === 0 ? 1 : .8;
    g.beginPath(); g.arc(p.x, p.y, k === 0 ? 5.5 : 4.5, 0, Math.PI * 2);
    g.fillStyle = p.col; g.fill();
    g.lineWidth = 2; g.strokeStyle = p.col; g.stroke();
    g.restore();
  });

  /* ---- surplus mode: the price everyone pays, drawn right across the plot.
     Unlike the price line above it is FIXED, so it stays put while the cursor
     moves along the curve. Everything above it is surplus; the line has to
     span the whole width because the point is what sits over it. */
  if (state.mode === 'surplus' && Number.isFinite(state.surplusPrice)) {
    const yp = Y(state.surplusPrice);
    g.save();
    g.strokeStyle = ACCENT; g.lineWidth = 1.75; g.setLineDash([6, 4]);
    g.beginPath(); g.moveTo(padL, yp); g.lineTo(padL + plotW, yp); g.stroke();
    g.setLineDash([]);
    g.font = '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'bottom';
    /* On a white patch: the surplus bars start at this very corner, and at 15px
       the figure was being drawn straight over them. */
    const plab = money(state.surplusPrice);
    const plw = g.measureText(plab).width;
    g.fillStyle = '#fff';
    g.fillRect(padL + 3, yp - 21, plw + 8, 19);
    g.fillStyle = ACCENT;
    g.fillText(plab, padL + 7, yp - 5);
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
    g.font = 'bold 15px ui-monospace, SFMono-Regular, Menlo, monospace';

    const pLabel = money(hoverPrice);                 // price, on the y-axis
    g.textAlign = 'right'; g.textBaseline = 'middle';
    const pw = g.measureText(pLabel).width;
    g.fillStyle = '#fff';
    g.fillRect(padL - 14 - pw, y - 11, pw + 10, 22);
    g.fillStyle = ACCENT;
    g.fillText(pLabel, padL - 9, y);

    // Only one curve? Put its quantity on the axis too. With several, the
    // numbers would crowd each other along a short stretch of axis, so they go
    // to the readout box instead, one line per segment.
    if (cuts.length === 1 && cuts[0].q > 0) {
      const qLabel = String(cuts[0].q), xq = X(cuts[0].q);
      g.textAlign = 'center'; g.textBaseline = 'top';
      const qw = g.measureText(qLabel).width;
      g.fillStyle = '#fff';
      g.fillRect(xq - qw / 2 - 6, padT + plotH + 6, qw + 12, 21);
      g.fillStyle = ACCENT;
      g.fillText(qLabel, xq, padT + plotH + 10);
    }
  }
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

/* The two answers one person gave -- one per round -- share a token. With both
   curves up they are two points on the chart, and lighting one has to light the
   other: otherwise the class has to find the same student twice by eye, which
   is exactly the comparison the second round exists to make. Only in 'both';
   with one curve there is nothing to pair with. */
function mateIdxs(idx) {
  const p = points[idx];
  if (!p || !p.token || state.curveView !== 'both') return [];
  const out = [];
  points.forEach((q, i) => { if (i !== idx && q.token && q.token === p.token) out.push(i); });
  return out;
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
  paintTip(idx);
}

/* The label for one student, used by the cursor and by the slow part of the
   area build -- the point of naming them is the same either way. */
function paintTip(idx) {
  const tip = $('tip');
  if (idx >= 0 && points[idx]) {
    const p = points[idx];
    tip.innerHTML = `<div class="tip-name"></div><div class="tip-wtp"></div>` +
                    `<div class="tip-mate"></div>`;
    tip.querySelector('.tip-name').textContent = p.name || 'Anonymous';

    /* In surplus mode the second line answers "what did THIS student get out of
       it": their maximum minus what they actually paid. Below the price they
       do not buy at all, so their surplus is nothing -- not a negative number,
       which is the mistake worth heading off out loud. */
    let line = `would pay ${money(p.wtp)}`;
    if (state.mode === 'surplus') {
      if (!Number.isFinite(state.surplusPrice)) {
        line = `would pay ${money(p.wtp)} · set a price`;
      } else if (p.wtp >= state.surplusPrice) {
        line = `${money(p.wtp)} − ${money(state.surplusPrice)} = ` +
               `surplus ${money(p.wtp - state.surplusPrice)}`;
      } else {
        line = `would pay ${money(p.wtp)} · does not buy, no surplus`;
      }
    }
    tip.querySelector('.tip-wtp').textContent = line;

    /* Say what the same student did in the other round rather than making the
       room read it off the axis. Their own round is named too, because "$6.00
       in round 2" only means something next to which one you are on. */
    const mate = points[mateIdxs(idx)[0]];
    tip.querySelector('.tip-mate').textContent = mate
      ? `${ROUND_LABEL[p.seg]} ${money(p.wtp)}  ·  ${ROUND_LABEL[mate.seg]} ${money(mate.wtp)}`
      : '';

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
    // Two rounds are the SAME class answering twice, so adding the quantities
    // counts everyone twice. Report each round instead.
    const q = cast.map(s => qtyIn(s.rows, hoverPrice));
    $('pbQty').textContent = cast.map((s, i) => `${s.label}: ${q[i]}`).join(' · ');
    $('pbShare').textContent = cast
      .map((s, i) => `${q[i]} of ${s.rows.length}`).join(' · ');
  }
  $('pbPin').textContent   = pricePinned ? 'locked · click to release' : '';
  box.hidden = false;
}

/* Builds the area one student at a time, highest first. Both curves advance
   together when both are up, so the class watches one area outgrow the other
   rather than seeing them sequentially and having to remember the first. */
function stopReveal() {
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
  $('surplusPlay').classList.remove('running');
  $('surplusPlay').textContent = 'Build consumer surplus';
}

function resetReveal() { stopReveal(); revealN = 0; paintTip(-1); }

function buyersShown() {
  if (!Number.isFinite(state.surplusPrice)) return 0;
  return Math.max(0, ...series(state.demandView)
    .map(sr => sr.rows.filter(r => r.wtp >= state.surplusPrice).length));
}

function surplusTotal() {
  if (!Number.isFinite(state.surplusPrice)) return 0;
  return series(state.demandView).reduce((sum, sr) =>
    sum + sr.rows.slice(0, revealN)
      .filter(r => r.wtp >= state.surplusPrice)
      .reduce((a, r) => a + (r.wtp - state.surplusPrice), 0), 0);
}

function revealHint() {
  if (state.mode !== 'surplus') return;
  if (!Number.isFinite(state.surplusPrice)) {
    $('hoverHint').textContent = 'Set a price, then hover a student to see what they gain by buying at it.';
    return;
  }
  if (revealN <= 0) {
    $('hoverHint').textContent = 'Hover a student to see their surplus, or press Build consumer surplus to add them up.';
    return;
  }
  /* One line per curve. Summing across rounds counted the same students under
     both conditions and put that total next to a buyer count that was a max,
     not a sum -- "10 of 10 buyers" while adding up twenty people's surplus. */
  const parts = series(state.demandView).map(sr => {
    const buyers = sr.rows.filter(r => r.wtp >= state.surplusPrice);
    const shown  = Math.min(revealN, buyers.length);
    const total  = buyers.slice(0, revealN)
      .reduce((a, r) => a + (r.wtp - state.surplusPrice), 0);
    return `${sr.label}: ${shown} of ${buyers.length} buyers, ${money(total)}`;
  });
  $('hoverHint').textContent = parts.join('   ·   ') + '  ·  consumer surplus';
}

/* The pace is the teaching. The first few land slowly and NAMED, so the room
   sees that a bar is one person and what they personally gained; after that the
   individual stories stop mattering and only the shape does, so it accelerates
   and runs the rest through quickly -- but still ONE AT A TIME, every student
   getting their own bar. Dropping the remainder in as a block would show the
   answer instead of building it, which is the opposite of the point.

   How many bars belong up is computed from ELAPSED TIME, not counted one per
   tick. A browser throttles a tab that is not on screen -- timers slow to about
   one a second, animation frames stop altogether -- so anything that counts
   ticks comes back half-built when you switch to your slides and return. Read
   the clock instead and a throttled tab merely draws coarser steps, then lands
   in exactly the right place. */
const REVEAL_SLOW  = 3;      // shown one at a time, with a name
const REVEAL_FIRST = 1300;   // ms each -- about 4 seconds for the first three
const REVEAL_MIN   = 55;     // the floor: still fast, still visibly one by one

/* When each bar is due, in ms from the start. The gap shrinks towards the
   floor and then stays there, so the tail is quick but never a single jump. */
function revealSchedule(total) {
  const at = [];
  let t = 0, gap = REVEAL_FIRST;
  for (let i = 0; i < total; i++) {
    at.push(t);
    gap = i < REVEAL_SLOW - 1 ? REVEAL_FIRST : Math.max(REVEAL_MIN, gap * 0.62);
    t += gap;
  }
  return at;
}

let revealAt = [], revealT0 = 0;

function startReveal() {
  const total = buyersShown();
  if (!total) return;
  revealN = 0;
  revealAt = revealSchedule(total);
  revealT0 = performance.now();
  $('surplusPlay').classList.add('running');
  $('surplusPlay').textContent = 'Stop';

  const frame = () => {
    // Recomputed every frame: a student answering mid-build used to leave the
    // area permanently short, with the button already reset and no way to resume.
    const total = buyersShown();
    if (total > revealAt.length) { revealAt = revealSchedule(total); }
    const ms = performance.now() - revealT0;
    let n = 0;
    while (n < revealAt.length && revealAt[n] <= ms) n++;
    if (n !== revealN) {
      revealN = n;
      drawChart();
      // Name whoever just went up, while they are still one at a time.
      paintTip(revealN > 0 && revealN <= REVEAL_SLOW ? revealN - 1 : -1);
      revealHint();
    }
    if (revealN >= buyersShown()) { stopReveal(); paintTip(-1); return; }
    // setTimeout, not requestAnimationFrame: frames stop entirely in a hidden
    // tab, timers only slow down. 30ms is finer than the fastest gap.
    revealTimer = setTimeout(frame, 30);
  };
  frame();
}

/* Everything back to how the lecture starts: no answers in either round, round
   1 live again, no price and no area. Deliberately more than the rehearsal's
   Clear all, which only empties the round you are simulating. */
function startOver() {
  stopArrivals();
  resetReveal();
  if (live && socket) socket.emit('clear', { room: state.room });
  state.responses = [];
  state.surplusPrice = null;
  state.round = 1;
  newestId = null; hoverIdx = -1; hoverPrice = null; pricePinned = false;
  $('tip').hidden = true;
  $('surplusPrice').value = '';
  setDemandView('1');
  setRoundState(1);
  revealHint();                 // the old running total must not survive a wipe
  commit();
}

function setMode(mode) {
  const next = ['price', 'surplus'].includes(mode) ? mode : 'students';
  // Only clear the hover state on an actual switch. syncInputs() calls this on
  // every remote update, and a pinned price must survive students arriving.
  if (next !== state.mode) {
    hoverIdx = -1; hoverPrice = null; pricePinned = false;
  }
  state.mode = next;
  $('tip').hidden = true;
  $('modeStudents').classList.toggle('is-on', state.mode === 'students');
  $('modePrice').classList.toggle('is-on', state.mode === 'price');
  $('modeSurplus').classList.toggle('is-on', state.mode === 'surplus');
  $('surplusBox').hidden = state.mode !== 'surplus';
  if (next !== 'surplus') resetReveal();
  $('surplusPrice').value = Number.isFinite(state.surplusPrice)
    ? state.surplusPrice : '';
  $('hoverHint').textContent =
      state.mode === 'price' ? 'Move up and down the chart to set a price; click to lock it.'
    :                          'Hover anywhere along the curve to see who each student is.';
  // syncInputs() calls setMode on every remote update, so the running total has
  // to be re-stated after it or an arriving answer would wipe it mid-build.
  revealHint();
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
  const split = roundsWithAnswers().length > 1 && state.curveView === 'both';

  // Ranks come from one pass, not a lookup per row: renderList runs on every
  // arrival, and a 500-student class would otherwise re-sort 500 times per
  // frame while they file in. Split, a student is ranked within their OWN
  // segment, because that is the curve they are a step on.
  const rank1 = new Map();
  if (split) {
    [1, 2].forEach(n => rankedOf(inRound(n)).forEach((r, i) => rank1.set(r.id, i + 1)));
  } else {
    rows.forEach((r, i) => rank1.set(r.id, i + 1));
  }

  const css = getComputedStyle(document.documentElement);
  const segCol = k => css.getPropertyValue(ROUND_VARS[Math.min(k, 1)] || '--blue').trim();

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
      s.textContent = 'R' + roundOf(r);
      s.style.color = segCol(roundOf(r) - 1);
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
/* Advancing the round. Offline this just changes which round new answers land
   in; live, the server is told first and every phone follows. */
function setRoundState(n) {
  const next = Number(n) === 2 ? 2 : 1;
  state.round = next;
  // One way only. Round 2 is a thing you announce to the room, and a button
  // offering to undo it is a mis-click that silently sends the next answers
  // into the wrong condition. Clear all is the way back, and it says so.
  $('roundBtn').hidden = next === 2;
  $('roundBtn').textContent = 'Start round 2';
  $('roundTag').textContent = next === 1 ? 'Round 1' : 'Round 2 · live';
  // Once a second curve exists the toggle earns its place; before that it is
  // three buttons that all show the same thing.
  $('demandViewToggle').hidden = roundsWithAnswers().length < 2 && next === 1;
  save();
  render();
  if (live) liveStatus(liveLine(), 'on');
}

function setSegCount(n) {
  // This lab runs as ONE segment. The multi-segment machinery below is left
  // intact -- L5 splits the class and shares this code -- but the picker is
  // gone from the page, so nothing can raise the count and there are no
  // buttons to light up.
  const next = 1;
  const changed = next !== state.segCount;
  state.segCount = next;


  if (changed) { hoverIdx = -1; $('tip').hidden = true; }
  save();
  if (changed) render();
}

function setDemandView(v) {
  const next = ['1', '2', 'both'].includes(v) ? v : '1';
  if (next !== state.curveView) resetReveal();   // a built area belongs to one view
  state.curveView = state.demandView = next;
  [['curve1', '1'], ['curve2', '2'], ['curveBoth', 'both']]
    .forEach(([id, val]) => $(id).classList.toggle('is-on', next === val));
  hoverIdx = -1; $('tip').hidden = true;        // points[] is about to be rebuilt
  save();
  render();
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
  // Enabled by the round Undo actually removes from, not the one on screen.
  $('undoBtn').disabled = inRound(state.round).length === 0 || live;

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
}

function syncInputs() {
  $('classSize').value = state.classSize;
  setSegCount(state.segCount);
  setRoundState(state.round);
  setDemandView(state.demandView);
  setMode(state.mode);
  setSort(state.sort);
}
function commit() { save(); render(); }

/* ---------------------------------------------------------------- arrivals */

/* Students arrive a few per second rather than all at once, so the class watches the
 * curve assemble. Each arrival is saved, so a second tab on the projector fills
 * in at the same pace. */
function startArrivals(target) {
  const btn = $('arriveBtn');
  btn.classList.add('running');
  // Counted within the round being filled, not across both.
  const soFar = () => inRound(state.round).length;
  const tick = () => {
    if (soFar() >= target) { stopArrivals(); return; }
    newestId = addSimulated().id;
    commit();
    btn.textContent = `Arriving… ${soFar()}/${target}`;
    if (soFar() >= target) stopArrivals();
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
    s.src = base.replace(/\/$/, '') + prefixFor(base) + '/socket.io/socket.io.js';
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

let connecting = false;

async function goLive() {
  if (connecting || socket) return;     // a second click during a cold start used
  connecting = true;                    // to leak a socket that outlived "Stop"
  const base = DEFAULT_SERVER;
  const room = normRoom(state.room);
  state.server = base; state.room = room;
  save();

  liveStatus('Connecting…');
  try {
    await loadSocketIo(base);
  } catch (e) {
    connecting = false;
    liveStatus('Could not reach the server. Check the address, or stay on simulated answers.', 'err');
    return;
  }

  const rooms = roomsNow();
  socket = window.io(base, { path: prefixFor(base) + '/socket.io',
                             transports: ['websocket', 'polling'], timeout: 8000 });

  socket.on('connect', () => {
    rooms.forEach((r, k) => {
      socket.emit('join', { room: r, role: 'dashboard' }, res => {
        if (!res) return;
        // A restart on the free tier looks like an empty room. Offer our copy back.
        /* Only offer a restore for answers from THIS sitting. The old guard was
           just "the room came back empty" -- which is the state at the start of
           every back-to-back section, so section A's answers were uploaded into
           section B's room. */
        const FRESH = 3 * 60 * 60 * 1000;             // one lecture, generously
        const mine = state.responses
          .filter(x => !x.sim && Date.now() - (Number(x.ts) || 0) < FRESH);
        if (!res.responses.length && mine.length)
          socket.emit('restore', { room: r, responses: mine, round: state.round });
        else adoptRemote(k, res.responses);
        if (res.round) setRoundState(res.round);
      });
    });
    connecting = false;
    stopArrivals();                       // a running rehearsal would keep adding
    // Simulated rows would be counted into the live statistics and the status
    // line -- a projector reading "Live · 22 submitted" that is 90% invented.
    state.responses = state.responses.filter(r => !r.sim);
    resetReveal();
    setLive(true);
  });

  socket.on('responses', payload => {
    if (!payload) return;
    const k = rooms.indexOf(payload.room);
    if (k < 0) return;                            // a room we are not showing
    adoptRemote(k, payload.responses);
    liveStatus(liveLine(), 'on');
  });

  socket.on('round', d => {
    if (d && d.room === state.room && d.round) setRoundState(d.round);
  });
  // The server resets to round 1 on a clear. Without this the dashboard kept
  // saying "Round 2 — live" while every phone showed the round 1 question, with
  // the round button hidden and no way back.
  socket.on('reset', d => {
    if (!d || d.room !== state.room) return;
    setRoundState(1); setDemandView('1');
  });

  socket.on('connect_error', () => { connecting = false;
    liveStatus('Server unreachable — retrying…', 'err'); });
  socket.on('disconnect', () => { if (live) liveStatus('Disconnected — retrying…', 'err'); });
}

// Per segment while split, because "23 submitted" across two rooms hides the
// thing you actually want to know: whether both links are being used.
function liveLine() {
  const r2 = inRound(2).length;
  if (!r2 && state.round === 1) return `Live · ${inRound(1).length} submitted`;
  return `Live · round ${state.round} · R1 ${inRound(1).length} · R2 ${r2}`;
}

/* The server pushes the room's WHOLE list, every round at once, so the live
   answers replace the live answers wholesale. Simulated rows are kept: a
   rehearsal left on screen should not vanish the moment the room connects. */
function adoptRemote(_k, responses) {
  // points[] is rebuilt by the redraw below, so an index kept from before would
  // point at a different student -- the chart highlighting one name while the
  // tooltip shows another, with the mouse never moving.
  hoverIdx = -1; markRow(null); $('tip').hidden = true;
  const sim = state.responses.filter(r => r.sim);
  const mine = (responses || []).map(r => ({
    id: r.id, token: r.token, name: r.name, wtp: r.wtp, ts: r.ts, sim: false,
    round: Number(r.round) === 2 ? 2 : 1
  }));
  state.responses = sim.concat(mine);
  save();
  render();
}

function goOffline() {
  connecting = false;
  if (socket) { socket.close(); socket = null; }
  setLive(false);
  liveStatus('Offline. The chart is showing simulated answers.');
}

function setLive(on) {
  live = on;
  $('liveBtn').textContent = on ? 'Stop' : 'Go live';
  $('liveBtn').classList.toggle('live-on', on);
  // Simulated answers would desync from the server the moment one arrived.
  // clearBtn belongs in this list: it emits 'clear' to the server, so a button
  // inside a drawer labelled "Simulate a class" could wipe 231 real answers.
  ['arriveBtn', 'oneBtn', 'undoBtn', 'clearBtn'].forEach(id => { $(id).disabled = on; });
  $('classSize').disabled = on;
}

/* ---------------------------------------------------------------- wiring */

document.addEventListener('DOMContentLoaded', () => {
  load(); syncInputs(); render();

  $('arriveBtn').addEventListener('click', () => {
    if (arrivalTimer) { stopArrivals(); return; }        // click again to stop early
    const n = Math.max(1, Math.min(500, Math.round(Number($('classSize').value) || 45)));
    state.classSize = n;
    // Only THIS round's SIMULATED answers are re-run. Two things must survive:
    // the other round (that is the comparison) and anything a student actually
    // typed (this used to delete real answers with one unarmed click).
    state.responses = state.responses.filter(r => !(r.sim && roundOf(r) === state.round));
    resetReveal();
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
    // Take back the last answer in THIS round, not whatever is last overall.
    for (let i = state.responses.length - 1; i >= 0; i--) {
      if (roundOf(state.responses[i]) === state.round) { state.responses.splice(i, 1); break; }
    }
    newestId = null; hoverIdx = -1; $('tip').hidden = true;
    commit();
  });

  $('clearBtn').addEventListener('click', () => {
    // Two-step rather than a modal: confirm() dialogs are awkward on a projector.
    stopArrivals();
    const b = $('clearBtn');
    if (!state.responses.length) return;
    if (b.dataset.armed) {
      // Rehearsal answers only. Wiping the real ones is what "Start over" is
      // for, and it says so on the button.
      state.responses = state.responses.filter(r => !r.sim);
      resetReveal();
      newestId = null; hoverIdx = -1; $('tip').hidden = true;
      delete b.dataset.armed; b.textContent = 'Clear all';
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
  state.room = DEFAULTS.room; save();   // without save() the old room comes back
  $('liveBtn').addEventListener('click', () => (live ? goOffline() : goLive()));

  $('modeStudents').addEventListener('click', () => setMode('students'));
  $('modePrice').addEventListener('click',    () => setMode('price'));
  $('modeSurplus').addEventListener('click',  () => setMode('surplus'));

  $('surplusPrice').addEventListener('input', e => {
    const v = Number(e.target.value);
    state.surplusPrice = e.target.value === '' || !Number.isFinite(v)
      ? null : Math.max(0, Math.min(MAX_WTP, v));
    resetReveal();                       // a new price means a new area
    save();
    drawChart();
    revealHint();
  });

  $('resetBtn').addEventListener('click', () => {
    // Two-step rather than a modal: confirm() dialogs are awkward on a projector.
    const b = $('resetBtn');
    if (b.dataset.armed) {
      delete b.dataset.armed; b.textContent = 'Start over';
      startOver();
    } else {
      b.dataset.armed = '1'; b.textContent = 'Click again to wipe everything';
      setTimeout(() => { delete b.dataset.armed; b.textContent = 'Start over'; }, 4000);
    }
  });

  $('surplusPlay').addEventListener('click', () => {
    if (revealTimer) { stopReveal(); return; }
    if (revealN > 0) { resetReveal(); drawChart(); revealHint(); return; }  // click again to clear
    startReveal();
  });


  $('sortDesc').addEventListener('click', () => setSort('desc'));
  $('sortAsc').addEventListener('click',  () => setSort('asc'));

  $('curve1').addEventListener('click',    () => setDemandView('1'));
  $('curve2').addEventListener('click',    () => setDemandView('2'));
  $('curveBoth').addEventListener('click', () => setDemandView('both'));

  /* One button, both directions. Going back to round 1 is not an undo -- round
     2's answers stay -- it just puts new answers back in the first condition,
     which is what you want if the class is asked to re-do it. */
  $('roundBtn').addEventListener('click', () => {
    if (state.round !== 1) return;                 // one way only
    if (live && socket) socket.emit('setRound', { room: state.room, round: 2 });
    setRoundState(2);
    setDemandView('both');
  });

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
  window.addEventListener('resize', () => { onLeave(); drawChart(); });
});
