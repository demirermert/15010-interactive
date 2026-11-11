#!/usr/bin/env node
// Classroom trouble (teaching23-games, 2026-11-11; Mert: "what other things haven't we tested yet, thinking about all
// issues we should anticipate when we play this in the classroom"). Real headless Chrome pages, each its own phone, on
// a LOCAL server (it kills and restarts that server in the last part, so never point it at a section):
//
//   cd server && PORT=4997 INSTRUCTOR_KEY=... node server.js      then      node test/classroom.mjs --port 4997 --key ...
//
// Game A (9 students, odd, so the AI seat; 3 rounds of 20 s):
//   lock      the phone is locked through a round end (the page frozen 32 s): back on the current round, can submit
//   offline   submits, then loses the network 25 s across the result: back with the right round and its own price
//   slow      a bad connection all game (1.5 s latency, 40 KB/s): every round and result arrives, prices count
//   nows      a network that blocks websockets: the page falls back to polling and plays
//   twotabs   opens the personal link in a second tab and submits there; then submits from the first tab
//   dup1/dup2 two different phones typing the same name: two seats, not one taking the other's
//   long      a 50-character name with an emoji: the page still fits a phone
//   dark      dark mode and 130% text: screenshots
//   the dashboard page is closed during round 1 and opened again in round 3 (and the driver socket leaves): the game
//   must keep running without any instructor page
// Game B (the same 9 pages, back to back): each goes to the join page and types the new code; must land in the new
//   game, not the old seat. In its round 2 the server is killed and restarted: what the pages show is recorded, and a
//   new game C must be joinable from the same pages (the recovery in class).

import puppeteer from 'puppeteer-core';
import { io } from 'socket.io-client';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
const PORT = Number(args.port || 4997), KEY = String(args.key || '');
const BASE = `http://localhost:${PORT}`;
const OUT = fs.mkdtempSync(path.join(args.out && args.out !== true ? String(args.out) : os.tmpdir(), 'l13-classroom-'));
const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let T0 = Date.now();
const log = (...a) => { const l = `[${((Date.now() - T0) / 1000).toFixed(1)}s] ${a.join(' ')}`; console.log(l); fs.appendFileSync(path.join(OUT, 'log.txt'), l + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); };
const shot = (p, tag) => p.screenshot({ path: path.join(OUT, `${tag}.png`), fullPage: true }).catch(() => {});

const ROUND = 20, BREAK = 6, ROUNDS = 3;
const config = { rounds: ROUNDS, roundTime: ROUND, breakTime: BREAK, modelType: 'hotelling', travelCost: 0.01, consumerValue: 7,
  marginalCost: 3.3, marketSize: 10000, x1: 0, x2: 100, priceBounds: { min: 3.3, max: 10 }, randomPriceMax: 6, showOpponentName: false };

// ---- instructor side: REST + a driver socket -----------------------------------------------------------------------
async function newGame(label) {
  const res = await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
    body: JSON.stringify({ instructorName: 'Classroom test', sessionName: label, config }) });
  const s = await res.json();
  if (res.status !== 201) throw new Error('create failed ' + JSON.stringify(s));
  const g = { code: s.code, round: {}, result: {}, over: false, lobby: 0 };
  g.inst = io(BASE, { transports: ['websocket'] });
  g.inst.on('connect', () => g.inst.emit('joinSession', { sessionCode: g.code, playerName: 'Classroom test', role: 'instructor', key: KEY }));
  g.inst.on('joinedSession', () => g.inst.emit('openLobby', { sessionCode: g.code }));
  g.inst.on('sessionUpdate', p => { g.players = p.players; if (p.status === 'lobby') g.lobby = (p.players || []).filter(q => q.role === 'student' && q.connected).length; });
  g.inst.on('roundStarted', p => { g.round[p.round] ??= Date.now(); });
  g.inst.on('roundSummary', p => { g.result[p.round] ??= Date.now(); });
  g.inst.on('sessionComplete', () => { g.over = true; });
  await new Promise(r => g.inst.on('sessionUpdate', p => p.status === 'lobby' && r()));
  log(`game ${label}: ${g.code}`);
  return g;
}
const csvOf = async code => {
  const t = await (await fetch(BASE + `/api/session/${code}/export`, { headers: { 'x-instructor-key': KEY } })).text();
  fs.writeFileSync(path.join(OUT, `session-${code}.csv`), t);
  return t.trim().split('\n').slice(1).map(l => l.match(/("[^"]*"|[^,]+)/g).map(x => x.replace(/^"|"$/g, '')));
};

// ---- the server (local; restarted in part B) ----------------------------------------------------------------------
const serverPid = () => { try { return Number(execSync(`lsof -tiTCP:${PORT} -sTCP:LISTEN`).toString().trim().split('\n')[0]); } catch { return 0; } };
function startServer() {
  const env = { ...process.env, PORT: String(PORT), INSTRUCTOR_KEY: KEY }; delete env.OPENAI_API_KEY;
  const child = spawn('node', ['server.js'], { cwd: SERVER_DIR, env, detached: true, stdio: ['ignore', fs.openSync(path.join(OUT, 'server.log'), 'a'), fs.openSync(path.join(OUT, 'server.log'), 'a')] });
  child.unref();
}

// ---- pages --------------------------------------------------------------------------------------------------------
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 120000,
  args: ['--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [];
async function newPage(ctx, s, view = { width: 390, height: 844 }) {
  const page = await ctx.newPage();
  await page.setViewport({ ...view, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(`${s.name}: page error ${e.message}`));
  if (s.kind === 'nows') await page.evaluateOnNewDocument(() => { window.WebSocket = undefined; }); // a network where websockets never connect
  if (s.kind === 'slow') await page.emulateNetworkConditions({ download: 40 * 1024, upload: 20 * 1024, latency: 1500 });
  if (s.kind === 'dark') { await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await page.evaluateOnNewDocument(() => addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom = '1.3'; })); }
  return page;
}
const card = p => p.evaluate(() => {
  const c = document.querySelector('#qcard');
  return { kase: c?.querySelector('.case')?.textContent || '', qt: c?.querySelector('.qt')?.textContent || '', err: c?.querySelector('.fb.no')?.textContent || '', ok: c?.querySelector('.fb.ok')?.textContent || '', body: document.body.innerText.slice(0, 400), wide: document.documentElement.scrollWidth > innerWidth + 1 };
}).catch(e => ({ kase: '', qt: '', err: 'evaluate failed: ' + e.message, ok: '', body: '' }));
const roundOf = c => { const m = /^Round (\d+) of/.exec(c.kase); return m && /Set your price|Your price is in/.test(c.qt) ? Number(m[1]) : 0; };
async function join(s, code) {
  await s.page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await s.page.waitForSelector('#student-name', { timeout: 15000 });
  await s.page.$eval('#student-name', el => el.value = '');
  await s.page.type('#student-name', s.name);
  await s.page.type('#session-code', code);
  await s.page.click('button[type=submit]');
  await s.page.waitForFunction(c => new RegExp(`/session/${c}/[A-Z0-9]{6}$`).test(location.pathname), { timeout: 30000 }, code);
  return s.page.url();
}
async function typePrice(page, price, tries = 3) {
  for (let k = 1; ; k++) { try { return await typeOnce(page, price); } catch (e) { if (k >= tries) throw e; await sleep(500); } }
}
async function typeOnce(page, price) {
  const d = String(Math.floor(price)), c = String(Math.round((price - Math.floor(price)) * 100)).padStart(2, '0');
  await page.waitForSelector('.pin2 .dollars', { timeout: 10000 });
  await page.click('.pin2 .dollars');
  await page.keyboard.type(d, { delay: 30 });
  if (!(await page.evaluate(() => document.activeElement?.classList.contains('cents')))) await page.keyboard.type('.', { delay: 30 });
  await page.keyboard.type(c, { delay: 30 });
  await page.click('form button[type=submit]');
}
async function waitCard(p, test, ms) { const t = Date.now(); while (Date.now() - t < ms) { const c = await card(p); if (test(c)) return { c, after: Date.now() - t }; await sleep(250); } return { c: await card(p), after: -1 }; }

const KINDS = ['normal', 'lock', 'offline', 'slow', 'nows', 'twotabs', 'dup1', 'dup2', 'long'];
const NAMES = { normal: 'Ana Normal', lock: 'Lee Locked', offline: 'Omar Offline', slow: 'Sia Slow', nows: 'Nico NoWebsocket', twotabs: 'Tara TwoTabs', dup1: 'Sam Lee', dup2: 'Sam Lee', long: 'Maximiliana Alexandra Konstantinopoulou-Vanderbilt 😀' };
const students = [];
for (const kind of KINDS) {
  const ctx = await browser.createBrowserContext();
  const s = { kind, name: NAMES[kind], ctx, typed: {} };
  s.page = await newPage(ctx, s);
  students.push(s);
}
// a tenth phone only for the dark-mode / big-text look, joined to game A (so 10, even: the AI seat is checked in B)
{ const ctx = await browser.createBrowserContext(); const s = { kind: 'dark', name: 'Dana Dark', ctx, typed: {} }; s.page = await newPage(ctx, s, { width: 375, height: 667 }); students.push(s); }
const byKind = k => students.find(s => s.kind === k);

// =================================================================================================================
// GAME A
// =================================================================================================================
T0 = Date.now();
log(`output ${OUT}`);
const A = await newGame('classroom A');
for (const s of students) { try { s.linkA = await join(s, A.code); } catch (e) { errors.push(`${s.name}: join A failed ${e.message}`); } }
check('A: all 10 pages joined (slow network and no-websocket included)', students.every(s => s.linkA), students.filter(s => !s.linkA).map(s => s.name).join(', '));
const dupCodes = students.filter(s => s.kind.startsWith('dup')).map(s => s.linkA?.split('/').pop());
check('A: two phones with the same name get two seats', dupCodes[0] && dupCodes[1] && dupCodes[0] !== dupCodes[1], dupCodes.join(' vs '));
{ const n2 = await students.find(s => s.kind === 'dup2').page.evaluate(() => document.body.innerText.match(/Sam Lee[^\n·]*/)?.[0]).catch(() => '?'); check('A: the second Sam Lee is shown as "Sam Lee (2)"', /\(2\)/.test(n2 || ''), n2); }
{ const tr = await byKind('nows').page.evaluate(() => window.__socket?.io?.engine?.transport?.name ?? 'no socket').catch(e => 'error ' + e.message); check('A: the no-websocket phone is on polling', tr === 'polling', 'transport: ' + tr); }

// the dashboard page
const dctx = await browser.createBrowserContext();
let dash = await dctx.newPage(); await dash.setViewport({ width: 1400, height: 1000 });
await dash.goto(BASE + `/instructor?key=${encodeURIComponent(KEY)}`, { waitUntil: 'networkidle2' });
await dash.goto(BASE + `/manage/${A.code}`, { waitUntil: 'networkidle2' });

while (A.lobby < students.length) await sleep(300);
await shot(byKind('long').page, 'A-lobby-long-name');
A.inst.emit('startSession', { sessionCode: A.code });
while (!A.round[1]) await sleep(100);
log('A: round 1 started');
await sleep(1000);
(async () => { const P = byKind('normal').page; while (!A.over) { const c = await card(P); const m = /^Round (\d+) (of|result)/.exec(c.kase); if (m) { if (m[2] === 'of') A.round[m[1]] ??= Date.now(); else A.result[m[1]] ??= Date.now(); } if (/^Game over/.test(c.kase)) A.over = true; await sleep(250); } })();
A.inst.close(); // from here only the dashboard page is an instructor; it is closed during round 1
await dash.close();
log('A: driver socket and dashboard page closed');

const priceFor = () => Math.round((3.5 + Math.random() * 2) * 100) / 100;
// everyone except the special ones submits a few seconds into each round
async function playRounds(s, g, skip = () => false) {
  for (let r = 1; r <= ROUNDS; r++) {
    const w = await waitCard(s.page, c => roundOf(c) === r || /^Game over/.test(c.kase), (ROUND + BREAK) * 1000 + 20000);
    if (roundOf(w.c) !== r) { if (!/^Game over/.test(w.c.kase)) errors.push(`${s.name}: never showed round ${r} (${w.c.kase} / ${w.c.err})`); continue; }
    if (skip(r)) continue;
    await sleep(2000 + Math.random() * 3000);
    const p = priceFor();
    try { await typePrice(s.page, p); s.typed[r] = p; } catch (e) { errors.push(`${s.name}: round ${r} typing failed ${e.message.slice(0, 100)}`); }
  }
  await waitCard(s.page, c => /^Game over/.test(c.kase), (ROUND + BREAK) * 1000 + 30000);
}

const special = (async () => { try {
  // lock: frozen 4 s into round 1, for 32 s (through the round 1 result into round 2)
  const L = byKind('lock');
  await sleep(3000);
  const cdp = await L.page.createCDPSession();
  let frozeOk = true;
  try { await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); } catch (e) { frozeOk = false; log('could not freeze: ' + e.message); }
  log('lock: page frozen');
  await sleep(32000);
  if (frozeOk) await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  const cur = Object.keys(A.result).length >= 1 ? 2 : 1;
  const w = await waitCard(L.page, c => roundOf(c) === cur, 25000);
  check('lock: after 32 s frozen the phone shows the current round', w.after >= 0, `round ${cur} after ${(w.after / 1000).toFixed(1)} s (${w.c.kase})`);
  if (w.after >= 0) { const p = priceFor(); await typePrice(L.page, p); L.typed[cur] = p; const ok = await waitCard(L.page, c => /Submitted/.test(c.ok), 6000); check('lock: can submit after unlocking', ok.after >= 0, ok.c.err); }
  } catch (e) { errors.push('task at line 179: ' + e.message.slice(0, 150)); }
})();

const offline = (async () => { try {
  const O = byKind('offline');
  const w2 = await waitCard(O.page, c => roundOf(c) === 2, 60000);
  await sleep(2000);
  const p = priceFor(); await typePrice(O.page, p); O.typed[2] = p;
  await waitCard(O.page, c => /Submitted/.test(c.ok), 6000);
  await sleep(1000);
  await O.page.setOfflineMode(true); log('offline: network off');
  await sleep(25000);
  await O.page.setOfflineMode(false); log('offline: network back');
  const w = await waitCard(O.page, c => roundOf(c) === 3, 20000);
  check('offline: 25 s without network across a result, back on round 3', w.after >= 0, `${(w.after / 1000).toFixed(1)} s after the network came back (${w.c.kase})`);
  const row = await O.page.evaluate(() => [...document.querySelectorAll('table.rounds tbody tr')].map(tr => tr.textContent)).catch(() => []);
  check('offline: its round 2 row shows the price it sent before going offline', row.some(t => t.startsWith('2') && t.includes(p.toFixed(2))), row.join(' | ').slice(0, 200));
  } catch (e) { errors.push('task at line 195: ' + e.message.slice(0, 150)); }
})();

const twotabs = (async () => { try {
  const T = byKind('twotabs');
  await waitCard(T.page, c => roundOf(c) === 2, 60000);
  const tab2 = await T.ctx.newPage(); await tab2.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  tab2.on('pageerror', e => errors.push(`${T.name} tab 2: ${e.message}`));
  await tab2.goto(T.linkA, { waitUntil: 'networkidle2' });
  const w = await waitCard(tab2, c => roundOf(c) === 2, 10000);
  check('twotabs: the personal link in a second tab opens the same round', w.after >= 0, w.c.kase);
  const p = priceFor(); await typePrice(tab2, p); T.typed[2] = p;
  const ok = await waitCard(tab2, c => /Submitted/.test(c.ok), 6000);
  check('twotabs: submitting in the second tab works', ok.after >= 0, ok.c.err);
  // back to the first tab, round 3
  await waitCard(T.page, c => roundOf(c) === 3, 60000);
  await sleep(2000);
  const p3 = priceFor();
  try { await typePrice(T.page, p3); } catch (e) { log('twotabs first tab typing: ' + e.message); }
  const ok1 = await waitCard(T.page, c => /Submitted/.test(c.ok) || c.err, 6000);
  const ok2 = await waitCard(tab2, c => roundOf(c) === 3, 3000);
  log(`twotabs: first tab after submitting round 3: ok="${ok1.c.ok}" err="${ok1.c.err}"`);
  T.typed[3] = p3; T.tab2 = tab2; T.firstTabSaid = ok1.c.ok || ok1.c.err;
  if (!ok2.c) {}
  } catch (e) { errors.push('task at line 211: ' + e.message.slice(0, 150)); }
})();

const reopenDash = (async () => { try {
  while (!A.round[3]) await sleep(300);
  await sleep(3000);
  dash = await dctx.newPage(); await dash.setViewport({ width: 1400, height: 1000 });
  await dash.goto(BASE + `/manage/${A.code}`, { waitUntil: 'networkidle2' });
  await sleep(4000);
  const txt = await dash.evaluate(() => document.body.innerText);
  await shot(dash, 'A-dashboard-reopened-round3');
  check('A: with no instructor page open the game went on to round 3', true);
  check('A: the reopened dashboard shows round 3 and the leaderboard', /ROUND\s*3 of 3/i.test(txt) && /Ana Normal/.test(txt), txt.slice(0, 160).replace(/\n/g, ' '));
  } catch (e) { errors.push('task at line 234: ' + e.message.slice(0, 150)); }
})();

await Promise.all([
  ...students.filter(s => ['normal', 'slow', 'nows', 'dup1', 'dup2', 'long', 'dark'].includes(s.kind)).map(s => playRounds(s, A)),
  playRounds(byKind('lock'), A, r => r <= 2), playRounds(byKind('offline'), A, r => r === 2),
  playRounds(byKind('twotabs'), A, r => r >= 2),
  special, offline, twotabs, reopenDash
]);
while (!A.over) await sleep(500);
await sleep(3000);
for (const s of students) await shot(s.page, `A-over-${s.kind}`);
await shot(byKind('dark').page, 'A-over-dark-zoom130');
const csvA = await csvOf(A.code);
// prices on the server vs what each phone typed
const mism = [];
for (const s of students) for (const [r, p] of Object.entries(s.typed)) {
  if (s.kind === 'twotabs' && r === '3') continue; // typed into the tab that lost the seat: it must not count
  const rows = csvA.filter(x => x[0] === String(r) && (x[1] === s.name || x[1].startsWith(s.name.slice(0, 40)))).map(x => Number(x[2]));
  if (!rows.some(v => Math.abs(v - p) < 0.001)) mism.push(`${s.kind} r${r} typed ${p} server ${rows.join('/')}`);
}
check('A: every typed price is the one the server used (slow, no-websocket, lock, offline, two tabs)', mism.length === 0, mism.join('; '));
const T = byKind('twotabs');
check('twotabs: what the first tab said when it submitted in round 3', true, T.firstTabSaid || '(nothing)');
const wide = []; for (const s of students) { const c = await card(s.page); if (c.wide) wide.push(s.kind); }
check('A: no page wider than the phone at game over (long name, 375 px + 130% text)', wide.length === 0, wide.join(', '));
const slowS = byKind('slow');
check('slow: saw every round and the game over', /^Game over/.test((await card(slowS.page)).kase));

// =================================================================================================================
// GAME B: back to back, then the server dies in round 2
// =================================================================================================================
if (T.tab2) await T.tab2.close();
// the frozen page is unreliable in headless Chrome afterwards (CDP calls time out): the locked phone gets a fresh tab
{ const Lk = byKind('lock'); await Lk.page.close().catch(() => {}); Lk.page = await newPage(Lk.ctx, Lk); }
// the first tab of the two-tab phone: what it shows now that the second tab took the seat
{ const c = await T.page.evaluate(() => document.querySelector('#seat-moved')?.innerText || document.body.innerText.slice(0, 120)).catch(e => e.message); check('twotabs: the first tab says the game is open elsewhere', /another tab/.test(c), c.replace(/\n/g, ' ').slice(0, 120)); }
const B = await newGame('classroom B');
const playersB = students.filter(s => s.kind !== 'dark'); // 9: the AI seat
for (const s of playersB) { try { s.linkB = await join(s, B.code); } catch (e) { errors.push(`${s.name}: join B failed ${e.message}`); log(`join B failed for ${s.kind}: ${e.message.slice(0,120)} | page: ${(await s.page.evaluate(() => location.pathname + ' ' + document.body.innerText.slice(0, 200)).catch(() => '?')).replace(/\n/g, ' ')}`); } }
check('B: all 9 phones joined the next game from the join page', playersB.every(s => s.linkB && s.linkB.includes(`/${B.code}/`)));
{ const t = Date.now(); while (B.lobby < playersB.filter(s => s.linkB).length && Date.now() - t < 30000) await sleep(300); }
B.inst.emit('startSession', { sessionCode: B.code });
await sleep(2500);
const pairsB = B.players || [];
check('B: an odd class gets the AI seat (no Parley key here: the fallback)', pairsB.some(p => /AI Player|ChatGPT/.test(p.name)), pairsB.filter(p => p.role === 'ai' || /AI|Chat/.test(p.name)).map(p => p.name).join(','));
const restart = (async () => {
  while (!B.round[2]) await sleep(200);
  await sleep(5000);
  const pid = serverPid(); log(`B: killing the server (pid ${pid}) in round 2`);
  process.kill(pid, 'SIGKILL');
  await sleep(4000);
  startServer();
  for (let i = 0; i < 40 && !(await fetch(BASE + '/health').then(r => r.ok).catch(() => false)); i++) await sleep(500);
  log('B: server back');
  await sleep(25000);
  const seen = [];
  for (const s of playersB) { const c = await card(s.page); seen.push(`${s.kind}: ${c.body.slice(0, 110).replace(/\n/g, ' ')}`); await shot(s.page, `B-after-restart-${s.kind}`); }
  check('B: after the restart every phone shows the "game has stopped" card', seen.every(x => /stopped/.test(x)), '');
  check('B: what the phones show 25 s after the server restarted', true, '\n    ' + seen.join('\n    '));
})();
await Promise.all([restart, ...playersB.map(s => playRounds(s, B).catch(() => {}))].map(p => Promise.race([p, sleep(90000)])));

// recovery: a new game C from the same phones
const C = await newGame('classroom C (after the restart)');
const joinedC = [];
for (const s of playersB) { try { const u = await join(s, C.code); if (u.includes(`/${C.code}/`)) joinedC.push(s.kind); } catch (e) { errors.push(`${s.name}: join C failed ${e.message.slice(0, 80)}`); } }
check('C: after the restart every phone can join a new game', joinedC.length === playersB.length, `${joinedC.length} of ${playersB.length}`);
C.inst.close();

// ---- report -----------------------------------------------------------------------------------------------------
const fails = results.filter(r => !r.ok);
const summary = [`${results.length - fails.length} of ${results.length} checks passed`, ...results.map(r => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' - ' + r.detail : ''}`),
  `page errors: ${errors.length}`, ...errors.slice(0, 30).map(e => '  ' + e)].join('\n');
fs.writeFileSync(path.join(OUT, 'summary.txt'), summary + '\n');
console.log('\n' + summary + `\n\nfolder: ${OUT}`);
await browser.close();
process.exit(0);
