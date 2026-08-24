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

const DEFAULTS = { classSize: 45, responses: [], mode: 'students',
                   server: DEFAULT_SERVER, room: '15010',
                   view: 'class', cost: 0 };
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

// Sorted highest first — that ordering IS the demand curve.
const ranked = () => state.responses.slice().sort((a, b) => b.wtp - a.wtp);

function summary() {
  const s = ranked().map(r => r.wtp), n = s.length;
  if (!n) return { n: 0 };
  const mid = Math.floor(n / 2);
  return {
    n, max: s[0], min: s[n - 1],
    mean: s.reduce((a, b) => a + b, 0) / n,
    median: n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  };
}

// Everyone whose maximum is at or above the price buys one unit.
const quantityAt = p => state.responses.reduce((n, r) => n + (r.wtp >= p ? 1 : 0), 0);

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

/* Right-skewed draw: most of the class clusters, a few enthusiasts sit high. */
function simulatedWtp() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const x = Math.exp(Math.log(11) + 0.42 * z);
  return Math.max(0, Math.min(MAX_WTP, Math.round(x * 4) / 4));   // quarters, as people answer
}

function addResponse(wtp, name, sim = false) {
  const r = { id: crypto.randomUUID(), name, wtp, ts: Date.now(), sim };
  state.responses.push(r);
  return r;
}
const addSimulated = () => addResponse(simulatedWtp(), simulatedName(), true);

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

  const rows = ranked();
  const css = getComputedStyle(document.documentElement);
  const LINE  = css.getPropertyValue('--line').trim()  || '#e5e5e3';
  const MUTED = css.getPropertyValue('--muted').trim() || '#8a8a8a';
  const BLUE  = css.getPropertyValue('--blue').trim()  || '#2563eb';
  const ACCENT= css.getPropertyValue('--accent').trim()|| '#e05c3e';

  // padL has to clear both the "$00.00" ticks and the rotated axis title
  const padL = 88, padR = 18, padT = 26, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  points = []; geom = null;
  if (plotW <= 10 || plotH <= 10) return;

  // While a class is filing in, hold the frame at the full class size so the
  // curve grows rightward into fixed axes instead of rescaling on every arrival.
  const nMax = Math.max(rows.length, arrivalTimer ? state.classSize : 0, 10);

  // The y-axis follows the data, rounded up to a tick, so no answer ever sits
  // off the top of the plot.
  const top = rows.length ? rows[0].wtp : 10;
  const tick = top <= 10 ? 2 : top <= 30 ? 5 : 10;
  const yMax = Math.max(tick * 2, Math.ceil(top / tick) * tick);

  const X = q => padL + (q / nMax) * plotW;
  const Y = p => padT + plotH - (p / yMax) * plotH;

  geom = { padL, padT, plotW, plotH, nMax, yMax, n: rows.length };

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

  if (!rows.length) return;

  // ---- the staircase: one step per student, one unit wide
  g.beginPath();
  rows.forEach((r, i) => {
    const y = Y(r.wtp);
    if (i === 0) g.moveTo(X(0), y); else g.lineTo(X(i), y);
    g.lineTo(X(i + 1), y);
  });
  g.strokeStyle = BLUE; g.lineWidth = 2; g.lineJoin = 'round';
  g.stroke();

  const priceMode = state.mode === 'price';

  // ---- one point per submission, at the middle of that student's step
  // Always recorded (hit-testing needs them); only drawn in students mode, where
  // they are the thing you are pointing at.
  const dense = rows.length > 90;                 // dots would merge into a smear
  rows.forEach((r, i) => {
    const x = X(i + 0.5), y = Y(r.wtp);
    points.push({ x, y, name: r.name, wtp: r.wtp, id: r.id });
    if (priceMode) return;
    if (dense && i !== hoverIdx) return;
    const on = i === hoverIdx;
    g.beginPath(); g.arc(x, y, on ? 5.5 : 3, 0, Math.PI * 2);
    g.fillStyle = on ? BLUE : '#fff';
    g.fill();
    g.lineWidth = on ? 2 : 1.5; g.strokeStyle = BLUE; g.stroke();
  });

  // ---- students mode: guides to both axes for the student under the cursor
  if (!priceMode && hoverIdx >= 0 && points[hoverIdx]) {
    const p = points[hoverIdx];
    g.save();
    g.setLineDash([3, 4]); g.strokeStyle = BLUE; g.globalAlpha = .45; g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, p.y); g.lineTo(p.x, p.y);
    g.moveTo(p.x, p.y); g.lineTo(p.x, padT + plotH); g.stroke();
    g.restore();
  }

  // ---- price mode: a horizontal line at the cursor, and who is above it
  if (priceMode && hoverPrice !== null) {
    const y = Y(hoverPrice);
    const q = quantityAt(hoverPrice);
    const xq = X(q);

    // The line runs from the price axis only as far as the curve — that IS the
    // quantity, so extending it past the intersection would draw a length that
    // means nothing. When nobody buys there is no intersection, so a short stub
    // stands in, otherwise the cursor's price would be invisible.
    // No shaded block: a wash of colour behind the curve reads badly on a
    // projector. The line, the drop and the readout carry it.
    const xEnd = q > 0 ? xq : padL + 18;

    g.save();
    g.setLineDash([6, 4]); g.strokeStyle = ACCENT; g.lineWidth = 1.75;
    g.beginPath(); g.moveTo(padL, y); g.lineTo(xEnd, y); g.stroke();
    if (q > 0) {                                   // drop to the axis at the quantity
      g.globalAlpha = .55;
      g.beginPath(); g.moveTo(xq, y); g.lineTo(xq, padT + plotH); g.stroke();
    }
    g.restore();

    if (q > 0) {
      g.beginPath(); g.arc(xq, y, 4.5, 0, Math.PI * 2);
      g.fillStyle = ACCENT; g.fill();
    }

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

    if (q > 0) {                                      // quantity, on the x-axis
      const qLabel = String(q);
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
const profitAt = (p, c) => (p - c) * quantityAt(p);

function optimum(c) {
  let best = null;
  for (const p of [...new Set(state.responses.map(r => r.wtp))].sort((a, b) => a - b)) {
    if (p < c) continue;                       // selling below cost is never the answer
    const profit = profitAt(p, c);
    if (!best || profit > best.profit) best = { price: p, qty: quantityAt(p), profit };
  }
  return best;
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
  const BLUE  = css.getPropertyValue('--blue').trim()  || '#2563eb';
  const ACCENT= css.getPropertyValue('--accent').trim()|| '#e05c3e';

  const rows = ranked();
  if (!rows.length) return;

  const c = state.cost;
  const padL = 44, padR = 12, padT = 12, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  if (plotW <= 10 || plotH <= 10) return;

  // Price runs across the same range as the demand chart's y-axis, so the two
  // charts share a scale and "$8 over there" is "$8 over here".
  const top  = rows[0].wtp;
  const tick = top <= 10 ? 2 : top <= 30 ? 5 : 10;
  const pMax = Math.max(tick * 2, Math.ceil(top / tick) * tick);

  const best = optimum(c);
  const yMax = Math.max(best ? best.profit : 0, 1) * 1.12;

  const X = p => padL + (p / pMax) * plotW;
  const Y = v => padT + plotH - (v / yMax) * plotH;

  // ---- axes: baseline and price ticks
  g.strokeStyle = '#d8d8d4'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(padL, Y(0) + .5); g.lineTo(W - padR, Y(0) + .5); g.stroke();

  g.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.fillStyle = MUTED; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let p = 0; p <= pMax + 0.001; p += tick) g.fillText('$' + p, X(p), padT + plotH + 6);
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
  g.beginPath();
  let started = false;
  const steps = Math.max(60, Math.round(plotW));
  for (let i = 0; i <= steps; i++) {
    const p = (i / steps) * pMax;
    const v = profitAt(p, c);
    if (v < 0) { started = false; continue; }
    const x = X(p), y = Y(v);
    if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
  }
  g.strokeStyle = BLUE; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();

  if (!best || best.profit <= 0) return;

  // ---- the peak: a drop to the price axis, a dot, and the price on the axis
  const bx = X(best.price), by = Y(best.profit);
  g.save();
  g.setLineDash([4, 4]); g.strokeStyle = ACCENT; g.lineWidth = 1.5; g.globalAlpha = .75;
  g.beginPath(); g.moveTo(bx, by); g.lineTo(bx, Y(0)); g.stroke();
  g.restore();

  g.beginPath(); g.arc(bx, by, 4, 0, Math.PI * 2);
  g.fillStyle = ACCENT; g.fill();

  const lbl = money(best.price);
  g.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textAlign = 'center'; g.textBaseline = 'top';
  const w = g.measureText(lbl).width;
  g.fillStyle = '#fff';
  g.fillRect(Math.min(Math.max(bx - w / 2 - 4, padL), W - padR - w - 8), padT + plotH + 4, w + 8, 15);
  g.fillStyle = ACCENT;
  g.fillText(lbl, Math.min(Math.max(bx, padL + w / 2 + 4), W - padR - w / 2 - 4), padT + plotH + 6);
}

function renderOptimal() {
  const c = state.cost;
  const best = state.responses.length ? optimum(c) : null;

  $('profitEmpty').classList.toggle('hidden', state.responses.length > 0);
  $('oPrice').textContent  = best ? money(best.price) : '–';
  $('oQty').textContent    = best ? String(best.qty)  : '–';
  $('oProfit').textContent = best ? money(best.profit) : '–';

  if (!state.responses.length) {
    $('oFoot').textContent = '';
  } else if (!best || best.profit <= 0) {
    $('oFoot').textContent = `Nobody is willing to pay ${money(c)}, so there is no price worth setting.`;
  } else {
    const missed = state.responses.length - best.qty;
    $('oFoot').textContent =
      `${best.qty} of ${state.responses.length} buy at ${money(best.price)}; ` +
      `${missed} walk away. Margin ${money(best.price - c)} each.`;
  }
  drawProfit();
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
  const { padL, padT, plotW, plotH, nMax, n } = geom;
  if (mx < padL || mx > padL + plotW || my < padT || my > padT + plotH) return -1;

  const i = Math.floor(((mx - padL) / plotW) * nMax);
  if (i < 0 || i >= n) return -1;                       // past the last student

  // ...and vertically near that student's step, so hovering empty space does nothing
  const p = points[i];
  if (!p) return -1;
  return Math.abs(my - p.y) <= HIT_BAND ? i : -1;
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
    hoverIdx = -1; drawChart();
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
  const q = quantityAt(hoverPrice), n = state.responses.length;
  $('pbPrice').textContent = money(hoverPrice);
  $('pbQty').textContent   = `${q} would buy`;
  $('pbShare').textContent = `${Math.round(100 * q / n)}% of the class`;
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

  const chips = $('chipList');
  chips.innerHTML = '';
  state.responses.slice().reverse().forEach(r => {
    const el = document.createElement('span');
    el.className = 'chip' + (r.sim ? ' sim' : '') + (r.id === newestId ? ' new' : '');
    el.textContent = `${r.name || 'Anonymous'} ${money(r.wtp)}`;
    chips.appendChild(el);
  });

  drawChart();
  showPriceBox();
  if (state.view === 'optimal') renderOptimal();
}

function syncInputs() {
  $('classSize').value = state.classSize;
  $('costInput').value = state.cost;
  setMode(state.mode);
  setView(state.view);
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

function showJoin(base, room) {
  const url = `${base.replace(/\/$/, '')}/r/${room}`;
  $('joinUrl').textContent = url.replace(/^https?:\/\//, '');
  $('qrImg').src = `${base.replace(/\/$/, '')}/qr.svg?text=${encodeURIComponent(url)}`;
  $('joinBox').hidden = false;
}

async function goLive() {
  const base = $('serverUrl').value.trim() || DEFAULT_SERVER;
  const room = normRoom($('roomCode').value);
  state.server = base; state.room = room;
  $('roomCode').value = room;
  save();

  liveStatus('Connecting…');
  try {
    await loadSocketIo(base);
  } catch (e) {
    liveStatus('Could not reach the server. Check the address, or stay on simulated answers.', 'err');
    return;
  }

  socket = window.io(base, { transports: ['websocket', 'polling'], timeout: 8000 });

  socket.on('connect', () => {
    socket.emit('join', { room, role: 'dashboard' }, res => {
      // A restart on the free tier looks like an empty room. Offer our copy back.
      if (res && !res.responses.length && state.responses.length) {
        socket.emit('restore', { room, responses: state.responses });
      } else if (res) {
        adoptRemote(res.responses);
      }
    });
    setLive(true);
    showJoin(base, room);
  });

  socket.on('responses', payload => {
    if (!payload || payload.room !== room) return;
    adoptRemote(payload.responses);
    liveStatus(`Live · ${payload.responses.length} submitted · ${payload.online} on the form`, 'on');
  });

  socket.on('connect_error', () => liveStatus('Server unreachable — retrying…', 'err'));
  socket.on('disconnect', () => { if (live) liveStatus('Disconnected — retrying…', 'err'); });
}

function adoptRemote(responses) {
  state.responses = (responses || []).map(r => ({
    id: r.id, name: r.name, wtp: r.wtp, ts: r.ts, sim: false
  }));
  save();
  render();
}

function goOffline() {
  if (socket) { socket.close(); socket = null; }
  setLive(false);
  $('joinBox').hidden = true;
  liveStatus('Offline. The chart is showing simulated answers.');
}

function setLive(on) {
  live = on;
  $('liveBtn').textContent = on ? 'Stop' : 'Go live';
  $('liveBtn').classList.toggle('live-on', on);
  // Simulated answers would desync from the server the moment one arrived.
  ['arriveBtn', 'oneBtn', 'undoBtn'].forEach(id => { $(id).disabled = on; });
  $('classSize').disabled = on;
  $('sideHint').textContent = on
    ? 'Simulation is paused while live. Press Stop to use it as a fallback.'
    : 'Stands in for the class until you go live. They arrive every 0.3 seconds.';
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

  $('serverUrl').value = state.server || DEFAULT_SERVER;
  $('roomCode').value  = state.room || '15010';
  $('liveBtn').addEventListener('click', () => (live ? goOffline() : goLive()));
  $('serverUrl').addEventListener('change', e => { state.server = e.target.value.trim(); save(); });
  $('roomCode').addEventListener('change', e => {
    state.room = normRoom(e.target.value); e.target.value = state.room; save();
    if (live) { goOffline(); goLive(); }
  });

  $('modeStudents').addEventListener('click', () => setMode('students'));
  $('modePrice').addEventListener('click',    () => setMode('price'));

  $('viewClassBtn').addEventListener('click',   () => setView('class'));
  $('viewOptimalBtn').addEventListener('click', () => setView('optimal'));

  // 'input' rather than 'change' so the curve and the peak move as you drag the
  // stepper — the point of the box is watching the best price walk up with cost.
  $('costInput').addEventListener('input', e => {
    const v = Number(e.target.value);
    state.cost = Number.isFinite(v) ? Math.max(0, Math.min(MAX_WTP, v)) : 0;
    save();
    renderOptimal();
  });

  window.addEventListener('resize', () => { onLeave(); drawChart(); drawProfit(); });
});
