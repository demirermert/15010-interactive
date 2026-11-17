#!/usr/bin/env node
// The announcement game (teaching23-games, 2026-11-16). Starts its own local server on --port (default 4993) with the
// OpenAI/Parley settings from the environment, plays a 2-round announcement game (short times) with 8 socket students in
// 4 scripted pairs plus a 9th who faces the AI seat, and one real page, and checks: prices and chat are refused during
// the announcement phase; nobody sees the rival's announcement before the reveal; the reveal shows each pair both
// final announcements (an edited one in its last version); a reload mid-phase gets the phase and the draft back; the
// student facing the AI cannot announce; prices then work as usual; the AI review gives the expected verdicts; the CSV
// has Announcement / Rival Announcement; the dashboard gets every pair's announcements. Screenshots to --out.
//   OPENAI_API_KEY=... OPENAI_BASE_URL=... AI_MODEL=... node test/announce.mjs [--out DIR]
import puppeteer from 'puppeteer-core';
import { io } from 'socket.io-client';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(x => x.length));
const PORT = Number(args.port || 4993), KEY = 'test-key', BASE = `http://127.0.0.1:${PORT}`;
const OUT = args.out || fs.mkdtempSync('/tmp/announce-');
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`); };
if (!process.env.OPENAI_API_KEY) { console.log('needs OPENAI_API_KEY (and OPENAI_BASE_URL, AI_MODEL)'); process.exit(1); }
const server = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), INSTRUCTOR_KEY: KEY }, stdio: ['ignore', 'pipe', 'pipe'] });
const serverLog = []; server.stdout.on('data', d => serverLog.push(String(d))); server.stderr.on('data', d => serverLog.push(String(d)));
process.on('exit', () => { try { server.kill(); } catch {} });
process.on('uncaughtException', e => { console.log('CRASH', e.stack); fs.writeFileSync(path.join(OUT, 'server.log'), serverLog.join('')); process.exit(1); });
for (let i = 0; i < 50 && !(await fetch(BASE + '/health').then(r => r.ok).catch(() => false)); i++) await sleep(200);

const ANN = 14, PRICE = 10; // seconds
const config = { rounds: 2, roundTime: PRICE, breakTime: 4, modelType: 'hotelling', travelCost: 0.004, consumerValue: 7, marginalCost: 3.3, marketSize: 10000, x1: 0, x2: 100,
  priceBounds: { min: 3.3, max: 10 }, randomPriceMax: 6, enableChat: true, announceTime: ANN, aiChatReview: true };
const s = await (await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'T', sessionName: 'announcement test', config }) })).json();
check('the server keeps the announcement time, turns chat off, keeps the review', s.config?.announceTime === ANN && s.config.enableChat === false && s.config.aiChatReview === true, JSON.stringify({ a: s.config?.announceTime, c: s.config?.enableChat, r: s.config?.aiChatReview }));
const code = s.code;

const inst = io(BASE, { transports: ['websocket'] });
let pairs = [], over = false, review = null, annLog = [], progress = null;
inst.on('connect', () => inst.emit('joinSession', { sessionCode: code, playerName: 'T', role: 'instructor', key: KEY }));
inst.on('joinedSession', () => inst.emit('openLobby', { sessionCode: code }));
inst.on('sessionUpdate', p => { if (p.pairs?.length) pairs = p.pairs; });
inst.on('sessionComplete', () => { over = true; });
inst.on('chatReview', r => { review = r; });
inst.on('announcementsAll', p => { annLog = p.log; });
inst.on('announceProgress', p => { progress = p; });
await sleep(800);

// scripts per pair index, per round: [A's announcements in order (the last counts), B's]
const SCRIPTS = [
  { name: 'own prices only', want: 'Legal', r: { 1: [['We will charge $5.50 a gallon next round.'], ['Our price is $5.20 a gallon.']], 2: [['Thank you for choosing our station.'], ['Lowest prices on the road!']] } },
  { name: "let's set our price", want: 'Illegal', by: 'both', r: { 1: [["Let's set our price at $6.50, both of us."], ['We agree: $6.50.']], 2: [['$6.50 again.'], ['Same.']] } },
  { name: 'expects the rival to follow', want: 'Illegal', by: 'A', r: { 1: [['We are raising our price to $6 and expect our competitor to follow.'], []], 2: [[], ['Our price is $5.']] } },
  { name: 'edited into a conditional offer', want: 'Illegal', by: 'A', r: { 1: [['Hello drivers!', 'We will stay at $6 as long as our competitor does.'], ['Fresh coffee with every fill-up.']], 2: [[], []] } }
];
const N = 8;
const studs = [];
const mk = name => {
  const st = { name, so: io(BASE, { transports: ['websocket'] }), errors: [], phases: [], revealed: [], saved: [], verdicts: [] };
  st.so.on('connect', () => st.so.emit('joinSession', { sessionCode: code, playerName: name, role: 'student', studentCode: st.code }));
  st.so.on('joinedSession', p => { st.code = p.studentCode || st.code; });
  st.so.on('errorMessage', m => st.errors.push(m));
  st.so.on('announcePhase', p => st.phases.push(p));
  st.so.on('announcementsRevealed', p => st.revealed.push({ at: Date.now(), list: p.revealed }));
  st.so.on('announcementSaved', p => st.saved.push(p));
  st.so.on('chatVerdict', v => { if (!v.pending) st.verdicts.push(v); });
  st.so.on('roundStarted', p => setTimeout(() => st.so.emit('submitPrice', { sessionCode: code, price: 5 + Math.random(), round: p.round }), 2000));
  return st;
};
for (let k = 0; k < N; k++) studs.push(mk(`Student ${k + 1}`));
studs.push(mk('Student 9'));
// one real page as a 10th... it would be paired with someone; instead it replaces Student 9 below? Keep it simple: a real page joins too (10 players, no AI) in a second check below.
await sleep(1500);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
await page.type('#student-name', 'Page Student');
await page.type('#session-code', code);
await page.click('button[type=submit]');
await page.waitForFunction(c => new RegExp(`/session/${c}/[A-Z0-9]{6}$`).test(location.pathname), { timeout: 15000 }, code);
await sleep(1000); // 10 students: no AI seat. The AI case: checked with a second small game at the end.
const t0 = Date.now();
inst.emit('startSession', { sessionCode: code });
while (pairs.length < 5 || !pairs[0].playerA?.name) await sleep(200);
const byName = n => studs.find(x => x.name === n);
const scripted = pairs.filter(p => byName(p.playerA.name) && byName(p.playerB.name)).slice(0, 4).map((p, i) => ({ A: byName(p.playerA.name), B: byName(p.playerB.name), script: SCRIPTS[i], pairId: p.id }));
check('4 scripted pairs found', scripted.length === 4, String(scripted.length));

async function playRound(r) {
  // during the phase: a price and a chat are refused
  const probe = scripted[0].A; probe.errors = [];
  probe.so.emit('submitPrice', { sessionCode: code, price: 5, round: r });
  probe.so.emit('chatMessage', { sessionCode: code, message: 'hi' });
  for (const pl of scripted) for (const side of ['A', 'B']) {
    const lines = pl.script.r[r][side === 'A' ? 0 : 1];
    lines.forEach((text, j) => setTimeout(() => pl[side].so.emit('announce', { sessionCode: code, text, round: r }), 1000 + j * 2500));
  }
  await sleep(1500 + 2 * 2500 + 500);
  check(`round ${r}: a price during the announcement phase is refused`, probe.errors.some(e => /Prices open when the announcements are revealed/.test(e)), probe.errors.join('; '));
  check(`round ${r}: chat is refused in the announcement game`, probe.errors.some(e => /no chat|not enabled|chat/i.test(e)), probe.errors.join('; '));
  check(`round ${r}: nobody has the rival's announcement before the reveal`, scripted.every(pl => ['A', 'B'].every(side => !pl[side].revealed.some(x => x.list.some(y => y.round === r)))));
}

// round 1
while (!studs[0].phases.some(p => p.round === 1)) await sleep(100);
check('every student got the round 1 announcement phase', studs.every(st => st.phases.some(p => p.round === 1 && p.remaining > 0)));
// the real page: type and publish an announcement
await page.waitForSelector('#announce-text', { timeout: 10000 });
await page.type('#announce-text', 'Page Student station: open 24 hours.');
await page.screenshot({ path: path.join(OUT, '1-announce-typing.png') });
await page.click('#announce-card button.go');
await page.waitForSelector('#announce-ok', { timeout: 5000 }).catch(() => {});
check('the page publishes its announcement', /Published/.test(await page.$eval('#announce-ok', e => e.innerText).catch(() => '')));
await page.screenshot({ path: path.join(OUT, '2-announce-published.png') });
await playRound(1);
// a reload mid-phase: a scripted student reconnects and gets the phase and its draft
const re = scripted[3].A; const before = re.phases.length;
re.so.disconnect(); await sleep(300); re.so.connect(); await sleep(1200);
const last = re.phases[re.phases.length - 1];
check('a reconnect mid-phase gets the phase back with its own announcement', re.phases.length > before && last.round === 1 && /as long as our competitor does/.test(last.mine), JSON.stringify(last));
check('the dashboard counts announcements', progress && progress.round === 1 && progress.done >= 7, JSON.stringify(progress));
// the reveal
while (!scripted[0].A.revealed.some(x => x.list.some(y => y.round === 1))) await sleep(100);
const revealAt = Date.now() - t0;
// every scripted phone gets its reveal a moment apart: wait for all of them (up to 3 s)
for (let w = 0; w < 30 && !scripted.every(pl => ['A', 'B'].every(side => pl[side].revealed.some(x => x.list.some(y => y.round === 1)))); w++) await sleep(100);
check(`the reveal comes at the end of the ${ANN} s`, revealAt > ANN * 1000 - 500 && revealAt < ANN * 1000 + 6000, `${(revealAt / 1000).toFixed(1)} s after the start`);
const rv = (st, r) => st.revealed[st.revealed.length - 1]?.list.find(x => x.round === r);
const pl3 = scripted[3];
check('the reveal shows the final version of an edited announcement, to both', rv(pl3.A, 1)?.mine === 'We will stay at $6 as long as our competitor does.' && rv(pl3.B, 1)?.rival === 'We will stay at $6 as long as our competitor does.', JSON.stringify(rv(pl3.B, 1)));
check('each student sees its own and the rival\'s', scripted.every(pl => { const a = rv(pl.A, 1), b = rv(pl.B, 1); return a && b && a.mine === b.rival && a.rival === b.mine; }));
check('a station that wrote nothing shows as empty', rv(scripted[2].B, 1)?.mine === '' && rv(scripted[2].A, 1)?.rival === '');
await page.waitForSelector('.ann-pair', { timeout: 10000 }).catch(() => {});
await page.screenshot({ path: path.join(OUT, '3-price-with-announcements.png') });
check('the page shows both announcements above the price', (await page.$$('#qcard .ann-pair, .card .ann-pair')).length > 0);
// round 2
while (!studs[0].phases.some(p => p.round === 2)) await sleep(100);
await page.waitForSelector('#announce-text', { timeout: 20000 }).catch(() => {});
await page.type('#announce-text', 'Still open 24 hours.').catch(() => {});
await page.click('#announce-card button.go').catch(() => {});
await playRound(2);
while (!over) await sleep(300);
check('every price that was sent counted (no errors after the reveal)', studs.every(st => !st.errors.some(e => /round .* is over|not running/i.test(e))), studs.flatMap(st => st.errors).filter(e => /over|running/.test(e)).slice(0, 3).join('; '));

// the review
const rt = Date.now();
while (!(review?.status === 'done') && Date.now() - rt < 180000) await sleep(500);
console.log(`review took ${((Date.now() - rt) / 1000).toFixed(1)} s`);
for (const pl of scripted) {
  const r = review?.results.find(x => x.pairId === pl.pairId);
  check(`${pl.script.name}: ${pl.script.want}`, r?.verdict === pl.script.want, `${r?.verdict} (${r?.crossedBy}; ${r?.rule}) ${r?.reason}`);
  if (pl.script.by && r?.verdict === 'Illegal') check(`${pl.script.name}: crossed by ${pl.script.by}`, r.crossedBy === pl.script.by, r.crossedBy);
}
check('the dashboard has every pair\'s announcements for both rounds', annLog.filter(e => e.round === 1).length === 5 && annLog.filter(e => e.round === 2).length === 5, `${annLog.length}`);
const csv = await (await fetch(BASE + `/api/session/${code}/export`, { headers: { 'x-instructor-key': KEY } })).text();
check('the CSV has Announcement, Rival Announcement and the AI columns', csv.split('\n')[0].endsWith(',Announcement,Rival Announcement,AI Verdict,AI Rule,AI Reason'), csv.split('\n')[0]);
check('the CSV has an announcement in its round', csv.includes('We will stay at $6 as long as our competitor does.'));
await page.waitForSelector('#ai-verdict .vbig', { timeout: 20000 }).catch(() => {});
await page.screenshot({ path: path.join(OUT, '4-game-over.png'), fullPage: true });
const dash = await browser.newPage(); await dash.setViewport({ width: 1440, height: 1000 });
await dash.goto(`${BASE}/instructor?key=${KEY}`, { waitUntil: 'networkidle2' });
await dash.goto(`${BASE}/manage/${code}`, { waitUntil: 'networkidle2' }); await sleep(1500);
const panel = await dash.$('#announcements-panel'); if (panel) await panel.screenshot({ path: path.join(OUT, '5-dashboard-announcements.png') });
check('the dashboard shows the announcements panel after a reload', !!panel && /stay at \$6/.test(await dash.$eval('#announcements-panel', e => e.innerText).catch(() => '')));
await dash.click('#tab-review').catch(() => {}); await sleep(400);
const rp = await dash.$('.review'); if (rp) await rp.screenshot({ path: path.join(OUT, '6-dashboard-review.png') });

// the AI seat: an odd game of 3, the one facing the AI cannot announce
const g2 = await (await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'T', sessionName: 'announce AI', config: { ...config, rounds: 1, announceTime: 10, aiChatReview: false } }) })).json();
const inst2 = io(BASE, { transports: ['websocket'] }); let pairs2 = [];
inst2.on('connect', () => inst2.emit('joinSession', { sessionCode: g2.code, playerName: 'T', role: 'instructor', key: KEY }));
inst2.on('joinedSession', () => inst2.emit('openLobby', { sessionCode: g2.code }));
inst2.on('sessionUpdate', p => { if (p.pairs?.length) pairs2 = p.pairs; });
await sleep(600);
const three = ['X1', 'X2', 'X3'].map(n => { const st = { name: n, so: io(BASE, { transports: ['websocket'] }), errors: [], phases: [] }; st.so.on('connect', () => st.so.emit('joinSession', { sessionCode: g2.code, playerName: n, role: 'student' })); st.so.on('errorMessage', m => st.errors.push(m)); st.so.on('announcePhase', p => st.phases.push(p)); return st; });
await sleep(1500); inst2.emit('startSession', { sessionCode: g2.code });
while (!three.every(st => st.phases.length)) await sleep(100);
const vsAI = three.find(st => st.phases[0].rivalIsAI);
check('the student facing the AI is told so', !!vsAI);
if (vsAI) { vsAI.so.emit('announce', { sessionCode: g2.code, text: 'hello', round: 1 }); await sleep(500); check('...and cannot announce', vsAI.errors.some(e => /computer/.test(e)), vsAI.errors.join('; ')); }

console.log(`\n${pass} of ${pass + fail} checks passed; screenshots in ${OUT}`);
fs.writeFileSync(path.join(OUT, 'review.json'), JSON.stringify(review, null, 2));
fs.writeFileSync(path.join(OUT, 'server.log'), serverLog.join(''));
await browser.close(); process.exit(fail ? 1 : 0);
