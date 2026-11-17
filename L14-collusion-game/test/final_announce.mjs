#!/usr/bin/env node
// The full test of the announcement game (teaching23-games, 2026-11-17; Mert: "test this end to end in super detail").
// N real pages at phone size join from 15010.ai/l14-<x>, a real instructor dashboard page, the class settings
// (announcements 180 s then 120 s, 60 s for the price, 10 s break), on a live host. Each page behaves like a student:
//   normal      publishes one announcement           edit        publishes, then publishes a new version
//   draft       types it but never presses Publish   none        writes nothing
//   reload      publishes, reloads mid-phase         close       closes the tab in round 2's phase, rejoins, publishes
//   too-high    tries $12.50 first                   late        prices in the last seconds
//   never       never prices (random price)
// Checked: joins; the phase lengths; no price form and no rival text before the reveal; each page's reveal = its own and
// its rival's final announcement (an edit in its last version, a draft sent at the deadline, nothing as "No
// announcement"); a reload keeps the published text; typed prices = CSV, random ones marked; every CSV row recomputed;
// the CSV announcement columns; rounds tables, rounds won and place; the review: every pair has a verdict, each page shows
// its own pair's with its station; the dashboard's Announcements panel (rows, red lines) and review tab; the student
// facing the AI; page errors.
//   node test/final_announce.mjs --host https://lab-a.onrender.com --key KEY [--n 75] [--announce 180,120] [--price 60] [--out DIR] [--keep]
import puppeteer from 'puppeteer-core';
import { io } from 'socket.io-client';
import fs from 'fs';
import os from 'os';
import path from 'path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
const BASE = String(args.host || 'https://lab-a.onrender.com').replace(/\/$/, ''), KEY = String(args.key || 'applied-econ');
const N = Number(args.n || 75);
const ANN = String(args.announce || '180,120').split(',').map(Number);
const PRICE = Number(args.price || 60);
const SECTION = (/lab-([a-f])/.exec(BASE) || [])[1];
const JOIN_URL = SECTION ? `https://15010.ai/l14-${SECTION}` : BASE + '/';
const OUT = args.out && args.out !== true ? String(args.out) : fs.mkdtempSync(path.join(os.tmpdir(), 'l14-final-'));
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const T0 = Date.now();
const log = (...a) => { const l = `[${((Date.now() - T0) / 1000).toFixed(1)}s] ${a.join(' ')}`; console.log(l); fs.appendFileSync(path.join(OUT, 'log.txt'), l + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cents = x => Math.round((Number(x) || 0) * 100);
const withTimeout = (pr, ms) => Promise.race([pr, new Promise(r => setTimeout(() => r(null), ms))]);
const F = []; // failures
const fail = m => { F.push(m); };
const errors = [];

function demandCheck(pA, pB, t, V = 7) {
  const STEPS = 200000, dx = 100 / STEPS; let qA = 0;
  for (let k = 0; k < STEPS; k++) { const x = (k + 0.5) * dx, a = pA + t * x, b = pB + t * (100 - x); if (Math.min(a, b) > V + 1e-12) continue; if (a < b - 1e-12) qA += dx; else if (!(b < a - 1e-12)) qA += dx / 2; }
  return qA * 100;
}

const config = { rounds: 2, roundTime: [PRICE, PRICE], breakTime: 10, announceTime: ANN.length === 1 ? ANN[0] : ANN, modelType: 'hotelling', travelCost: 0.004, consumerValue: 7, marginalCost: 3.3,
  marketSize: 10000, x1: 0, x2: 100, priceBounds: { min: 3.3, max: 10 }, randomPriceMax: 6, aiChatReview: true, showModelParameters: true, hideRoundCount: false, showOpponentName: false, enableChat: false };
const created = await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'Final test', sessionName: `final test: announcement game x${N}`, config }) });
const S = await created.json();
if (created.status !== 201) { log('could not create the game', JSON.stringify(S)); process.exit(1); }
const CODE = S.code;
log(`game ${CODE} on ${BASE}; ${N} pages join at ${JOIN_URL}; announcements ${ANN.join('/')} s, price ${PRICE} s; output ${OUT}`);
if (JSON.stringify(S.config.announceTime) !== JSON.stringify(config.announceTime)) fail(`config: announceTime saved as ${JSON.stringify(S.config.announceTime)}`);

// the observer: phases, pairs, the review, the dashboard's log
const obs = io(BASE, { transports: ['websocket'] });
let pairs = [], over = false, review = null, annLog = [], lobby = 0; const phase = {};
obs.on('connect', () => obs.emit('joinSession', { sessionCode: CODE, playerName: 'Observer', role: 'instructor', key: KEY }));
obs.on('sessionUpdate', p => { if (p.pairs?.length) pairs = p.pairs; if (p.status === 'lobby') lobby = (p.players || []).filter(q => q.role === 'student' && q.connected).length; });
obs.on('announcePhase', p => { phase[`a${p.round}`] ??= Date.now(); log(`server: round ${p.round} announcements, ${p.remaining} s`); });
obs.on('announcementsAll', p => { annLog = p.log; });
obs.on('roundStarted', p => { phase[`p${p.round}`] ??= Date.now(); log(`server: round ${p.round} prices open`); });
obs.on('roundSummary', p => { phase[`r${p.round}`] ??= Date.now(); });
obs.on('sessionComplete', () => { over = true; phase.over = Date.now(); log('server: game over'); });
obs.on('chatReview', r => { review = r; if (r.status === 'done') log(`server: review done, ${r.results.filter(x => x.verdict === 'Illegal').length} illegal, ${r.results.filter(x => x.verdict === 'Legal').length} legal, ${r.results.filter(x => !x.verdict).length} failed`); });

// the pages
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 600000,
  args: ['--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const KINDS = ['normal', 'edit', 'draft', 'none', 'reload', 'normal', 'too-high', 'late', 'never', 'close'];
const LINES = [
  ['Our price is $5.50 a gallon this week.', 'Still $5.50.'],
  ["Let's both set our price at $6.50.", '$6.50 again.'],
  ['We expect our competitor to follow our price of $6.', 'Our price is $5.90.'],
  ['Open 24 hours, now with a car wash.', 'Car wash free on Sundays.'],
  ['We will stay at $6 as long as our competitor does.', 'If anyone undercuts $6, we will go to $3.30.'],
  ['Lowest prices in town, guaranteed.', 'Thank you for choosing us.'],
  ['Our price: $5.80.', 'We price independently.']
];
const students = [];
async function newPage(ctx, s) {
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errors.push(`${s.name}: page error ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${s.name}: console ${m.text().slice(0, 160)}`); });
  return page;
}
for (let i = 0; i < N; i++) {
  const ctx = await browser.createBrowserContext();
  const s = { i, name: `Student ${String(i + 1).padStart(2, '0')}`, kind: KINDS[i % KINDS.length], ctx, final: { 1: '', 2: '' }, typed: {}, refused: 0, seenEarly: [], reveal: {}, kb: Promise.resolve() };
  s.lines = LINES[i % LINES.length];
  s.page = await newPage(ctx, s);
  students.push(s);
}
const dashCtx = await browser.createBrowserContext();
const dash = await dashCtx.newPage(); await dash.setViewport({ width: 1440, height: 1000 });
dash.on('pageerror', e => errors.push(`dashboard: page error ${e.message}`));
await dash.goto(`${BASE}/instructor?key=${encodeURIComponent(KEY)}`, { waitUntil: 'networkidle2', timeout: 60000 });
await dash.goto(`${BASE}/manage/${CODE}`, { waitUntil: 'networkidle2', timeout: 60000 });
const clickText = (page, text) => page.evaluate(t => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t && !x.disabled); if (b) b.click(); return !!b; }, text);
await sleep(1500);
if (!(await clickText(dash, 'Open the lobby'))) fail('dashboard: no "Open the lobby" button');
while (!lobby && Date.now() - T0 < 60000) { await sleep(300); if (!lobby) { const st = await withTimeout(dash.$eval('.dash', e => e.innerText.includes('Lobby open')).catch(() => false), 3000); if (st) break; } }

// join from the real address
const js = Date.now();
await Promise.all(students.map(async (s, k) => {
  await sleep(k * 150 + Math.random() * 2500);
  try {
    await s.page.goto(JOIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await s.page.type('#student-name', s.name); await s.page.type('#session-code', CODE); await s.page.click('button[type=submit]');
    await s.page.waitForFunction(c => new RegExp(`/session/${c}/[A-Z0-9]{6}$`).test(location.pathname), { timeout: 30000 }, CODE);
    s.link = s.page.url();
  } catch (e) { fail(`join: ${s.name} ${e.message.slice(0, 120)}`); }
}));
const joined = students.filter(s => s.link).length;
log(`${joined} of ${N} joined in ${((Date.now() - js) / 1000).toFixed(0)} s`);
const ws = Date.now(); while (lobby < joined && Date.now() - ws < 30000) await sleep(500);
log(`in the lobby: ${lobby}`);
const rulesRes = await Promise.all(students.map(s => withTimeout(s.page.evaluate(() => { const t = document.querySelector('.story')?.innerText || ''; return { ok: /public announcements/i.test(t.split('\n')[0]) && /earnings call/.test(t) && /3 minutes in round 1 and 2 minutes in round 2/.test(t) && /willingness to pay/i.test(t), head: t.slice(0, 120), url: location.pathname, body: document.body.innerText.slice(0, 160) }; }).catch(e => ({ ok: false, head: 'evaluate failed ' + e.message })), 5000)));
const rulesOk = rulesRes.filter(x => x?.ok).length;
students.forEach((s, k) => { if (!rulesRes[k]?.ok) fail(`rules: ${s.name} (${s.kind}) shows ${JSON.stringify(rulesRes[k])}`); });
await students[0].page.screenshot({ path: path.join(OUT, 'shots', 'lobby-phone.png') });
await dash.screenshot({ path: path.join(OUT, 'shots', 'lobby-dashboard.png') });
if (!(await clickText(dash, 'Start the game'))) fail('dashboard: no "Start the game" button');
const startAt = Date.now();
while (!pairs.length || !pairs[0].playerA?.name) await sleep(200);
await sleep(500);
const byName = new Map(students.map(s => [s.name, s]));
for (const p of pairs) { const a = byName.get(p.playerA?.name), b = byName.get(p.playerB?.name); if (a) { a.side = 'A'; a.rival = b || null; a.rivalName = p.playerB?.name; } if (b) { b.side = 'B'; b.rival = a || null; b.rivalName = p.playerA?.name; } }
const vsAI = students.filter(s => s.link && !s.rival);
log(`${pairs.length} pairs; facing the AI seat: ${vsAI.map(s => s.name).join(', ') || 'nobody'}`);

// the phones
const typing = (s, fn) => { const p = s.kb.then(fn); s.kb = p.catch(() => {}); return p; };
async function rejoin(s) {
  await s.page.close().catch(() => {});
  s.page = await newPage(s.ctx, s);
  await s.page.goto(JOIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  const nm = await s.page.$eval('#student-name', e => e.value).catch(() => '');
  if (!nm) await s.page.type('#student-name', s.name);
  await s.page.type('#session-code', CODE); await s.page.click('button[type=submit]');
  await s.page.waitForFunction(c => new RegExp(`/session/${c}/[A-Z0-9]{6}$`).test(location.pathname), { timeout: 30000 }, CODE);
  s.rejoined = s.page.url() === s.link;
}
async function announce(s, r) {
  const len = ANN[Math.min(r, ANN.length) - 1] * 1000;
  if (!s.rival) { // the student facing the AI seat: told there are no announcements, no box
    await s.page.waitForFunction(() => /computer, so there are no announcements/.test(document.body.innerText), { timeout: 30000 }).catch(() => fail(`AI seat: ${s.name} r${r} not told there are no announcements`));
    return;
  }
  await s.page.waitForSelector('#announce-text', { timeout: 30000 });
  if (s.page.$ && await s.page.$('.pin2 .dollars')) s.seenEarly.push(`r${r}: price form during the announcement phase`);
  const text = s.lines[r - 1];
  if (s.kind === 'none' || !s.rival) return;
  await sleep(3000 + Math.random() * len * 0.4);
  if (s.kind === 'close' && r === 2) { await rejoin(s); await s.page.waitForSelector('#announce-text', { timeout: 30000 }); await sleep(1500); }
  await typing(s, () => typeAnnouncement(s.page, text));
  if (s.kind === 'draft') { s.final[r] = text; return; } // never pressed: the page sends it 2 s before the end
  await s.page.click('#announce-card button.go');
  await s.page.waitForSelector('#announce-ok', { timeout: 10000 }).catch(() => fail(`announce: ${s.name} r${r} no "Published"`));
  s.final[r] = text;
  // nothing of the rival before the reveal
  const early = await s.page.evaluate(() => [...document.querySelectorAll('.ann.rival')].map(e => e.innerText).join('|')).catch(() => '');
  if (r === 1 && early) s.seenEarly.push(`r1: rival text before the reveal: ${early.slice(0, 60)}`);
  if (s.kind === 'edit') {
    await sleep(4000);
    const v2 = text + ' (updated)';
    await typing(s, () => typeAnnouncement(s.page, v2));
    await s.page.click('#announce-card button.go');
    s.final[r] = v2;
  }
  if (s.kind === 'reload' && r === 1) {
    await sleep(2000);
    await s.page.reload({ waitUntil: 'networkidle2' });
    await s.page.waitForSelector('#announce-text', { timeout: 15000 });
    const kept = await s.page.$eval('#announce-ok', e => e.innerText).catch(() => '');
    if (!kept.includes(text)) fail(`reload: ${s.name} after a reload the page does not show its published announcement (${kept.slice(0, 80)})`);
    const box = await s.page.$eval('#announce-text', e => e.value).catch(() => '');
    if (box !== text) fail(`reload: ${s.name} the box after a reload has "${box.slice(0, 60)}"`);
  }
}
// a student replacing the text: everything in the box selected, then typed over (a triple-click selects only a part)
async function typeAnnouncement(page, text) {
  await page.focus('#announce-text');
  await page.$eval('#announce-text', e => e.select());
  await page.keyboard.press('Backspace');
  await page.type('#announce-text', text, { delay: 8 });
}
async function typePrice(page, price) {
  const d = String(Math.floor(price)), c = String(Math.round((price - Math.floor(price)) * 100)).padStart(2, '0');
  await page.click('.pin2 .dollars'); await page.keyboard.type(d, { delay: 40 });
  const inCents = await page.evaluate(() => document.activeElement?.classList.contains('cents'));
  if (!inCents) await page.keyboard.type('.', { delay: 40 });
  await page.keyboard.type(c, { delay: 40 });
  await page.click('form button[type=submit]');
}
async function price(s, r) {
  await s.page.waitForFunction(() => !!document.querySelector('.pin2 .dollars'), { timeout: (ANN[Math.min(r, ANN.length) - 1] + 30) * 1000, polling: 500 });
  // the reveal on the price card
  const rv = await s.page.evaluate(() => { const p = document.querySelector('#qcard .ann-pair') || document.querySelector('.card .ann-pair'); if (!p) return null; const g = sel => p.querySelector(sel)?.innerText.replace(/^[^\n]*\n/, '').trim() || ''; return { mine: g('.ann.you'), rival: g('.ann.rival') }; }).catch(() => null);
  s.reveal[r] = rv;
  if (s.kind === 'never') return;
  const len = PRICE * 1000;
  await sleep(s.kind === 'late' ? len - 9000 : 2500 + Math.random() * len * 0.4);
  const p = Math.round((3.6 + Math.random() * 3.2) * 100) / 100;
  try {
    if (s.kind === 'too-high' && r === 1) await typing(s, async () => {
      await typePrice(s.page, 12.5); await sleep(500);
      if (/between/.test(await s.page.evaluate(() => document.querySelector('#qcard .fb.no')?.innerText || '').catch(() => ''))) s.refused++;
      for (const sel of ['.pin2 .cents', '.pin2 .dollars']) { await s.page.focus(sel); await s.page.evaluate(q => document.querySelector(q).select(), sel); await s.page.keyboard.press('Backspace'); }
    });
    const t1 = Date.now();
    await typing(s, () => typePrice(s.page, p));
    s.typed[r] = p;
    let ok = false; while (Date.now() - t1 < 8000) { if (/Submitted at/.test(await s.page.$eval('#price-ok', e => e.innerText).catch(() => ''))) { ok = true; break; } await sleep(150); }
    if (!ok) fail(`price: ${s.name} r${r} typed ${p}, no "Submitted at"`);
  } catch (e) { fail(`price: ${s.name} r${r} ${e.message.slice(0, 100)}`); }
}
async function play(s) {
  for (const r of [1, 2]) {
    try { await announce(s, r); } catch (e) { fail(`announce: ${s.name} r${r} ${e.message.slice(0, 120)}`); }
    try { await price(s, r); } catch (e) { fail(`reveal/price: ${s.name} r${r} ${e.message.slice(0, 120)}`); }
    if (r === 1) await s.page.waitForFunction(() => /Round 1 result|Round 2/.test(document.body.innerText), { timeout: (PRICE + 30) * 1000 }).catch(() => {});
  }
}
// screenshots at moments
(async () => {
  while (!phase.a1) await sleep(200); await sleep(20000);
  await students[0].page.screenshot({ path: path.join(OUT, 'shots', 'r1-announce-phone.png') }).catch(() => {});
  await dash.screenshot({ path: path.join(OUT, 'shots', 'r1-announce-dashboard.png') }).catch(() => {});
  while (!phase.p1) await sleep(200); await sleep(5000);
  await students[0].page.screenshot({ path: path.join(OUT, 'shots', 'r1-price-phone.png') }).catch(() => {});
  await dash.screenshot({ path: path.join(OUT, 'shots', 'r1-price-dashboard.png'), fullPage: true }).catch(() => {});
})();
await Promise.all(students.filter(s => s.link).map(s => play(s).catch(e => fail(`${s.name}: ${e.message}`))));
while (!over) await sleep(300);
const rt = Date.now(); while (!(review?.status === 'done') && Date.now() - rt < 240000) await sleep(500);
await sleep(4000);

// ---- checks -------------------------------------------------------------------------------------------------------
const L = []; // summary lines
const ph = (a, b) => phase[a] && phase[b] ? ((phase[b] - phase[a]) / 1000).toFixed(1) : '?';
L.push(`phases: round 1 announcements ${ph('a1', 'p1')} s (set ${ANN[0]}), prices ${ph('p1', 'r1')} s (set ${PRICE}); round 2 announcements ${ph('a2', 'p2')} s (set ${ANN[1] ?? ANN[0]}), prices ${ph('p2', 'r2')} s; review done ${review?.status === 'done' ? ((Date.now() - rt - 4000) / 1000 < 0 ? '' : '') + 'in time' : 'NOT DONE'}`);
for (const [a, b, want] of [['a1', 'p1', ANN[0]], ['a2', 'p2', ANN[1] ?? ANN[0]]]) if (phase[a] && phase[b] && Math.abs((phase[b] - phase[a]) / 1000 - want) > 2) fail(`phase: ${a}->${b} took ${ph(a, b)} s, set ${want}`);
L.push(`joined ${joined} of ${N} from ${JOIN_URL}; lobby ${lobby}; rules right (announcements first, earnings call, 3 then 2 minutes, willingness to pay) on ${rulesOk} of ${joined}`);

const early = students.flatMap(s => s.seenEarly.map(x => `${s.name} ${x}`));
early.forEach(fail);
// the reveal on each page against the final texts
let revOk = 0, revN = 0;
for (const s of students.filter(x => x.link && x.rival)) for (const r of [1, 2]) {
  revN++;
  const want = { mine: s.final[r] ? `"${s.final[r]}"` : 'No announcement', rival: s.rival.final[r] ? `"${s.rival.final[r]}"` : 'No announcement' };
  const got = s.reveal[r];
  if (got && got.mine === want.mine && got.rival === want.rival) revOk++; else fail(`reveal: ${s.name} r${r} shows ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}
L.push(`reveal on the price card = own and rival's final announcement: ${revOk} of ${revN} (edits in their last version, drafts sent at the deadline, nothing as "No announcement")`);
// the CSV
const csv = await (await fetch(BASE + `/api/session/${CODE}/export`, { headers: { 'x-instructor-key': KEY } })).text();
fs.writeFileSync(path.join(OUT, `${CODE}.csv`), csv);
const parseLine = l => { const out = []; let cur = '', q = false; for (let k = 0; k < l.length; k++) { const ch = l[k]; if (q) { if (ch === '"' && l[k + 1] === '"') { cur += '"'; k++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
const lines = csv.trim().split('\n'); const head = parseLine(lines[0]); const col = n => head.indexOf(n);
const wantHead = ['Round', 'Player Name', 'Price', 'Random Price', 'Opponent Name', 'Opponent Price', 'Opponent Random Price', 'Quantity', 'Profit', 'Market Share', 'Announcement', 'Rival Announcement', 'AI Verdict', 'AI Rule', 'AI Reason'];
if (JSON.stringify(head) !== JSON.stringify(wantHead)) fail(`csv: header ${head.join(',')}`);
const rows = lines.slice(1).map(parseLine).map(c => ({ round: +c[col('Round')], name: c[col('Player Name')], price: +c[col('Price')], forced: c[col('Random Price')] === 'Yes', opp: c[col('Opponent Name')], oppPrice: +c[col('Opponent Price')], q: +c[col('Quantity')], profit: +c[col('Profit')], share: parseFloat(c[col('Market Share')]) / 100, ann: c[col('Announcement')], rivalAnn: c[col('Rival Announcement')], verdict: c[col('AI Verdict')] }));
const byRow = new Map(); rows.forEach(r => byRow.set(`${r.name}|${r.round}`, r));
let math = 0;
for (const r of rows) {
  const q = demandCheck(r.price, r.oppPrice, 0.004);
  if (Math.abs(q - r.q) > 1) fail(`math: ${r.name} r${r.round} ${r.price} vs ${r.oppPrice}: CSV ${r.q}, recomputed ${q.toFixed(2)}`);
  if (Math.abs((r.price - 3.3) * r.q - r.profit) > 0.02) fail(`math: ${r.name} r${r.round} profit`);
  if (Math.abs(r.q / 10000 - r.share) > 0.0002) fail(`math: ${r.name} r${r.round} share`);
  const o = byRow.get(`${r.opp}|${r.round}`); if (!o || o.opp !== r.name || cents(o.price) !== cents(r.oppPrice)) fail(`pair: ${r.name} r${r.round} and ${r.opp} disagree`);
  math++;
}
let typedOk = 0, typedN = 0, randOk = 0, randN = 0, annOk = 0, annN = 0;
for (const s of students.filter(x => x.link)) for (const r of [1, 2]) {
  const row = byRow.get(`${s.name}|${r}`); if (!row) { fail(`csv: no row for ${s.name} r${r}`); continue; }
  if (s.typed[r] != null) { typedN++; if (cents(s.typed[r]) === cents(row.price) && !row.forced) typedOk++; else fail(`typed: ${s.name} r${r} typed ${s.typed[r]}, CSV ${row.price} random=${row.forced}`); }
  else if (s.kind === 'never') { randN++; if (row.forced && row.price >= 3.3 && row.price <= 6) randOk++; else fail(`random: ${s.name} r${r} CSV ${row.price} random=${row.forced}`); }
  if (s.rival) { annN++; if (row.ann === s.final[r] && row.rivalAnn === s.rival.final[r]) annOk++; else fail(`csv announcement: ${s.name} r${r} "${row.ann}" / "${row.rivalAnn}", expected "${s.final[r]}" / "${s.rival.final[r]}"`); }
}
L.push(`typed prices = CSV, not random: ${typedOk} of ${typedN}; never priced = random in $3.30-$6: ${randOk} of ${randN}; too-high refused: ${students.filter(s => s.kind === 'too-high' && s.link && s.rival !== undefined).filter(s => s.refused).length} of ${students.filter(s => s.kind === 'too-high' && s.link).length}`);
L.push(`CSV rows recomputed (gallons by brute force, profit, share, both rows of a pair): ${math} rows, ${F.filter(f => /^(math|pair)/.test(f)).length} problems; announcement columns = final texts: ${annOk} of ${annN}`);
// the review
const res = review?.results || [];
const humanPairs = pairs.filter(p => byName.get(p.playerA?.name) && byName.get(p.playerB?.name));
if (res.length !== humanPairs.length) fail(`review: ${res.length} results for ${humanPairs.length} pairs of students`);
res.filter(r => !r.verdict).forEach(r => fail(`review: ${r.nameA} & ${r.nameB} not reviewed: ${r.error}`));
for (const r of res) { if (r.verdict === 'Illegal' && !(r.illegal || []).length) fail(`review: ${r.nameA} & ${r.nameB} Illegal with no red line`); (r.illegal || []).forEach(x => { const s = byName.get(x.station === 'A' ? r.nameA : r.nameB); if (s && s.final[x.round] !== x.text) fail(`review: red line "${x.text}" is not ${s.name}'s round ${x.round} announcement`); }); }
// a sanity check of the law on the scripted lines: "Let's both set..." and the threat are illegal; a pair of two plain own-price lines legal
for (const r of res) {
  const a = byName.get(r.nameA), b = byName.get(r.nameB); if (!a || !b) continue;
  const texts = [a.final[1], a.final[2], b.final[1], b.final[2]].join(' ');
  if (/Let's both set|as long as our competitor|undercuts \$6|expect our competitor to follow/.test(texts) && r.verdict !== 'Illegal') fail(`law: ${r.nameA} & ${r.nameB} Legal though "${texts.slice(0, 100)}"`);
}
// each page's verdict card
const cards = await Promise.all(students.map(s => withTimeout(s.page.evaluate(() => ({ v: document.querySelector('#ai-verdict .vbig')?.innerText || '', sub: document.querySelector('#ai-verdict .vsub')?.innerText || '', text: document.body.innerText })).catch(() => null), 10000)));
let cardOk = 0, cardN = 0;
students.forEach((s, k) => {
  if (!s.link) return;
  const c = cards[k] || { v: '', sub: '', text: '' };
  if (!s.rival) { if (c.v) fail(`verdict: ${s.name} faces the AI but shows a verdict`); return; }
  cardN++;
  const r = res.find(x => x.nameA === s.name || x.nameB === s.name);
  if (r && c.v === r.verdict && c.sub.includes(`You were Station ${s.side}`)) cardOk++; else fail(`verdict: ${s.name} shows "${c.v}" "${c.sub}", review says ${r?.verdict} (Station ${s.side})`);
});
L.push(`review: ${res.filter(r => r.verdict === 'Illegal').length} illegal, ${res.filter(r => r.verdict === 'Legal').length} legal, ${res.filter(r => !r.verdict).length} not reviewed, of ${humanPairs.length} pairs; red lines ${res.reduce((n, r) => n + (r.illegal || []).length, 0)}; verdict card right (verdict and station) on ${cardOk} of ${cardN} phones`);
// rounds tables, rounds won, place
const totals = new Map(); rows.forEach(r => totals.set(r.name, (totals.get(r.name) || 0) + r.profit));
let tblOk = 0, wonOk = 0, placeOk = 0;
students.forEach((s, k) => {
  if (!s.link) return; const text = cards[k]?.text || '';
  const mine = [1, 2].map(r => byRow.get(`${s.name}|${r}`));
  const wantPlace = 1 + [...totals.values()].filter(v => cents(v) > cents(totals.get(s.name))).length;
  if (new RegExp(`You placed ${wantPlace} of ${totals.size}`).test(text)) placeOk++; else fail(`place: ${s.name} expected ${wantPlace} of ${totals.size}: ${(/You placed[^\n]*/.exec(text) || [''])[0]}`);
  const won = mine.filter(c => c && cents(c.profit) > cents(byRow.get(`${c.opp}|${c.round}`)?.profit)).length;
  if (new RegExp(`Rounds won\\s+${won} of 2`).test(text)) wonOk++; else fail(`won: ${s.name} expected ${won}: ${(/Rounds won[^\n]*/.exec(text) || [''])[0]}`);
});
const tables = await Promise.all(students.map(s => withTimeout(s.page.evaluate(() => [...document.querySelectorAll('table.rounds tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent))).catch(() => []), 8000)));
students.forEach((s, k) => { if (!s.link) return; const t = (tables[k] || []).filter(r => /^\d+$/.test(r[0])); const ok = t.length === 2 && t.every(r => { const c = byRow.get(`${s.name}|${r[0]}`); return c && cents(r[1].replace(/[$,]/g, '')) === cents(c.price) && cents(r[2].replace(/[$,]/g, '')) === cents(c.oppPrice); }); if (ok) tblOk++; else fail(`table: ${s.name} rounds table ${JSON.stringify(t)}`); });
L.push(`phones: rounds table = CSV ${tblOk}, "Rounds won" ${wonOk}, "You placed X of ${totals.size}" ${placeOk}, of ${joined}; reload kept the announcement: ${students.filter(s => s.kind === 'reload' && s.link && s.rival).length} reloaded; closed the tab and got the seat back: ${students.filter(s => s.kind === 'close' && s.link && s.rival).map(s => `${s.name} ${s.rejoined ? 'yes' : 'NO'}`).join(', ')}`);
students.filter(s => s.kind === 'close' && s.link && s.rival && !s.rejoined).forEach(s => fail(`rejoin: ${s.name} did not get its seat back`));
// the AI seat
for (const s of vsAI) { const t = cards[students.indexOf(s)]?.text || ''; if (/AI legal review/.test(t)) fail(`AI seat: ${s.name} shows a review`); }
L.push(`facing the AI seat: ${vsAI.map(s => s.name).join(', ') || 'nobody'} (no announcement, no verdict)`);
// the dashboard
await dash.reload({ waitUntil: 'networkidle2' }); await sleep(3000);
const d = await dash.evaluate(() => ({ rows: document.querySelectorAll('#announcements-panel table.an-table > tbody > tr').length, red: document.querySelectorAll('#announcements-panel td.ill').length, illTags: document.querySelectorAll('#announcements-panel .an-tag.bad').length })).catch(() => ({}));
const wantRows = humanPairs.length * 2, wantRed = res.reduce((n, r) => n + (r.illegal || []).length, 0);
if (d.rows !== wantRows) fail(`dashboard: ${d.rows} announcement rows, expected ${wantRows}`);
if (d.red !== wantRed) fail(`dashboard: ${d.red} red cells, the review has ${wantRed} illegal lines`);
await dash.evaluate(() => document.querySelector('#announcements-panel')?.scrollIntoView()); await dash.screenshot({ path: path.join(OUT, 'shots', 'end-dashboard-announcements.png') });
await dash.click('#tab-review').catch(() => fail('dashboard: no review tab')); await sleep(800);
const rvRows = await dash.$$eval('.review .rv-row', x => x.length).catch(() => 0);
if (rvRows !== humanPairs.length) fail(`dashboard: review tab lists ${rvRows} pairs, expected ${humanPairs.length}`);
await dash.screenshot({ path: path.join(OUT, 'shots', 'end-dashboard-review.png'), fullPage: true });
L.push(`dashboard after a reload: ${d.rows} announcement rows (expected ${wantRows}), ${d.red} red (review: ${wantRed}), review tab ${rvRows} pairs`);
for (const k of [0, 1, 2, 3]) { const s = students[k]; await s.page.evaluate(() => document.querySelector('#ai-verdict')?.scrollIntoView()).catch(() => {}); await s.page.screenshot({ path: path.join(OUT, 'shots', `end-phone-${s.kind}-${s.name.replace(/ /g, '')}.png`) }).catch(() => {}); }
L.push(`page errors: ${errors.length}${errors.length ? '\n    ' + errors.slice(0, 10).join('\n    ') : ''}`);
L.push(`FAILURES: ${F.length}${F.length ? '\n    ' + F.slice(0, 30).join('\n    ') : ''}`);
const summary = `Announcement game: ${CODE}, ${N} pages\n  ` + L.join('\n  ');
fs.writeFileSync(path.join(OUT, 'summary.txt'), summary + '\n'); fs.writeFileSync(path.join(OUT, 'failures.txt'), F.join('\n') + '\n'); fs.writeFileSync(path.join(OUT, 'review.json'), JSON.stringify(review, null, 2));
log('\n' + summary);
if (!args.keep) { await fetch(BASE + `/api/session/${CODE}`, { method: 'DELETE', headers: { 'x-instructor-key': KEY } }).catch(() => {}); log(`game ${CODE} deleted from the service`); }
await browser.close(); obs.close(); process.exit(0);
