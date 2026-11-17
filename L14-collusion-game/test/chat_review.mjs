#!/usr/bin/env node
// The AI legal review of the chat game (teaching23-games, 2026-11-16). Starts its own local server on --port (default
// 4994) with the OpenAI/Parley settings from the environment (OPENAI_API_KEY, OPENAI_BASE_URL, AI_MODEL), plays a
// 2-round chat game with 20 socket students in 10 pairs, each pair a scripted conversation with a known answer, then
// checks: every pair reviewed, each verdict against the expected one, both phones of a pair got their verdict (with
// their station, without names), a reloaded phone gets it again, the chat is closed after the end, the dashboard state,
// the CSV columns, and that a game without the review is unchanged. Real pages: one student's game-over card and the
// dashboard are screenshotted to --out.
//   OPENAI_API_KEY=... OPENAI_BASE_URL=... AI_MODEL=... node test/chat_review.mjs [--out DIR]
import puppeteer from 'puppeteer-core';
import { io } from 'socket.io-client';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(x => x.length));
const PORT = Number(args.port || 4994), KEY = 'test-key', BASE = `http://127.0.0.1:${PORT}`;
const OUT = args.out || fs.mkdtempSync('/tmp/chat-review-');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`); };
if (!process.env.OPENAI_API_KEY) { console.log('needs OPENAI_API_KEY (and OPENAI_BASE_URL, AI_MODEL) in the environment'); process.exit(1); }
const server = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), INSTRUCTOR_KEY: KEY }, stdio: ['ignore', 'pipe', 'pipe'] });
const serverLog = [];
server.stdout.on('data', d => serverLog.push(String(d))); server.stderr.on('data', d => serverLog.push(String(d)));
// whatever happens, the test server goes with the test (2026-11-16: a crash left it running and the next run talked to it)
process.on('exit', () => { try { server.kill(); } catch {} });
process.on('uncaughtException', e => { console.log('CRASH', e.message); fs.writeFileSync(path.join(OUT, 'server.log'), serverLog.join('')); process.exit(1); });
for (let i = 0; i < 50 && !(await fetch(BASE + '/health').then(r => r.ok).catch(() => false)); i++) await sleep(200);

// ten conversations, [station, round, text], with the verdict the law file asks for and who crossed the line
const SCRIPTS = [
  { name: 'explicit deal', want: 'Illegal', by: 'both', lines: [['A', 1, "let's both set $6.50 every round"], ['B', 1, 'deal'], ['A', 2, 'still at 6.50?'], ['B', 2, 'yes']] },
  { name: 'invitation refused', want: 'Illegal', by: 'A', lines: [['A', 1, 'how about we both stay at $6 so neither of us loses money?'], ['B', 1, "no thanks, I'll set my own price"]] },
  { name: 'small talk', want: 'Legal', by: 'neither', lines: [['A', 1, 'hi! good luck'], ['B', 1, 'you too, have fun'], ['A', 2, 'this class is early lol']] },
  // B's "ok" can be read as accepting: A or both (2026-11-16)
  { name: 'future price signal', want: 'Illegal', by: ['A', 'both'], lines: [['A', 1, "FYI I'm going to charge $5.80 next round"], ['B', 2, 'ok']] },
  { name: 'no messages', want: 'Legal', by: 'neither', lines: [] },
  { name: 'threat', want: 'Illegal', by: 'B', lines: [['B', 1, 'if you go below $5 I will drop to $3.30 and we both lose'], ['A', 1, 'whatever']] },
  { name: 'coded language', want: 'Illegal', by: 'both', lines: [['A', 1, "let's be nice to each other, no price war"], ['B', 1, 'agreed, keep it high']] },
  { name: 'past results only', want: 'Legal', by: 'neither', lines: [['A', 2, 'wow you beat me last round'], ['B', 2, 'lucky, I guess']] },
  { name: 'rival refuses, legal side', want: 'Illegal', by: 'B', lines: [['B', 1, 'we should keep prices high together'], ['A', 1, "I'll do whatever I want"]] },
  { name: 'asking how the game works', want: 'Legal', by: 'neither', lines: [['A', 1, 'do you know how the driving cost works?'], ['B', 1, 'I think drivers just go to whoever is cheaper after the drive']] }
];

const config = { rounds: 2, roundTime: 20, breakTime: 4, modelType: 'hotelling', travelCost: 0.004, consumerValue: 7, marginalCost: 3.3, marketSize: 10000, x1: 0, x2: 100,
  priceBounds: { min: 3.3, max: 10 }, randomPriceMax: 6, enableChat: true, aiChatReview: true };
const make = async cfg => (await (await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'T', sessionName: 'chat review', config: cfg }) })).json());
const s = await make(config);
check('the server keeps aiChatReview in a chat game', s.config?.aiChatReview === true, JSON.stringify(s.config?.aiChatReview));
const plain = await make({ ...config, enableChat: false });
check('...and drops it in a game without chat', plain.config?.aiChatReview === false);
const code = s.code;

const inst = io(BASE, { transports: ['websocket'] });
let over = false, pairs = [], review = null;
inst.on('connect', () => inst.emit('joinSession', { sessionCode: code, playerName: 'T', role: 'instructor', key: KEY }));
inst.on('joinedSession', () => inst.emit('openLobby', { sessionCode: code }));
inst.on('sessionUpdate', p => { if (p.pairs?.length) pairs = p.pairs; });
inst.on('sessionComplete', () => { over = true; });
inst.on('chatReview', r => { review = r; });
await sleep(800);

const N = 20, studs = [];
for (let k = 0; k < N; k++) {
  const name = `Student ${String(k + 1).padStart(2, '0')}`;
  const st = { name, verdicts: [], errors: [], so: io(BASE, { transports: ['websocket'] }) };
  st.so.on('connect', () => st.so.emit('joinSession', { sessionCode: code, playerName: name, role: 'student' }));
  st.so.on('joinedSession', p => { st.link = p.playerLink || p.studentCode; st.code = p.studentCode; });
  st.so.on('chatVerdict', v => st.verdicts.push(v));
  st.so.on('errorMessage', m => st.errors.push(m));
  st.so.on('roundStarted', p => setTimeout(() => st.so.emit('submitPrice', { sessionCode: code, price: 5 + Math.random(), round: p.round }), 6000));
  studs.push(st);
}
await sleep(2000);
inst.emit('startSession', { sessionCode: code });
while (pairs.length < N / 2 || !pairs[0].playerA?.name) await sleep(200);
const byName = n => studs.find(x => x.name === n);
const plan = pairs.map((p, i) => ({ pairId: p.id, A: byName(p.playerA.name), B: byName(p.playerB.name), script: SCRIPTS[i] }));
// the lines of each round, a second apart, after the round starts
inst.on('roundStarted', p => plan.forEach(pl => pl.script.lines.filter(l => l[1] === p.round).forEach(([st, , text], j) =>
  setTimeout(() => pl[st].so.emit('chatMessage', { sessionCode: code, message: text }), 1000 + j * 700))));
// round 1 may already have started before this handler: send its lines now
plan.forEach(pl => pl.script.lines.filter(l => l[1] === 1).forEach(([st, , text], j) => setTimeout(() => pl[st].so.emit('chatMessage', { sessionCode: code, message: text }), 1000 + j * 700)));
while (!over) await sleep(300);
const t0 = Date.now();
// after the end the chat is closed
const late = plan[0].A; late.errors = [];
late.so.emit('chatMessage', { sessionCode: code, message: 'one more thing' });
await sleep(800);
check('after the end the chat is closed', late.errors.some(e => /chat is closed/.test(e)), late.errors.join('; '));
while (!(review && review.status === 'done') && Date.now() - t0 < 180000) await sleep(500);
console.log(`review took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
check('the review finished, every pair reviewed', review?.status === 'done' && review.results.length === N / 2 && review.results.every(r => r.verdict), `${review?.status} ${review?.results?.length}`);

for (const pl of plan) {
  const r = review.results.find(x => x.pairId === pl.pairId);
  const ok = r?.verdict === pl.script.want;
  check(`${pl.script.name}: ${pl.script.want}`, ok, `${r?.verdict} (crossed by ${r?.crossedBy}; ${r?.rule}) ${r?.reason}`);
  if (pl.script.want === 'Illegal') check(`${pl.script.name}: crossed by ${pl.script.by}`, [].concat(pl.script.by).includes(r?.crossedBy), r?.crossedBy);
  for (const side of ['A', 'B']) {
    const v = pl[side].verdicts.filter(x => !x.pending).pop();
    if (!v || v.verdict !== r?.verdict || v.myStation !== side || 'nameA' in v || 'nameB' in v || !v.law) check(`${pl.script.name}: ${side}'s phone got its verdict`, false, JSON.stringify(v)?.slice(0, 200));
  }
  for (const e of r?.evidence || []) if (!pl.script.lines.some(l => l[0] === e.station && l[2] === e.text)) check(`${pl.script.name}: quote is a real message`, false, JSON.stringify(e));
}
check('every phone got its own verdict with its station and no names', !plan.some(pl => ['A', 'B'].some(side => { const v = pl[side].verdicts.filter(x => !x.pending).pop(); return !v || v.myStation !== side || 'nameA' in v; })));

// a reloaded phone gets it again
const again = io(BASE, { transports: ['websocket'] });
const gotAgain = await new Promise(res => { again.on('chatVerdict', v => res(v)); again.on('connect', () => again.emit('joinSession', { sessionCode: code, playerName: plan[0].A.name, role: 'student', studentCode: plan[0].A.code })); setTimeout(() => res(null), 5000); });
check('a reloaded phone gets its verdict again', gotAgain?.verdict === review.results.find(x => x.pairId === plan[0].pairId).verdict, JSON.stringify(gotAgain)?.slice(0, 120));

// the API and the CSV
const data = await (await fetch(BASE + `/api/session/${code}`, { headers: { 'x-instructor-key': KEY } })).json();
check('the saved game has the reviews with their chats', data.chatReviews?.length === N / 2 && data.chatReviews.every(r => Array.isArray(r.messages)), String(data.chatReviews?.length));
const csv = await (await fetch(BASE + `/api/session/${code}/export`, { headers: { 'x-instructor-key': KEY } })).text();
const lines = csv.trim().split('\n');
check('the CSV has AI Verdict, AI Rule, AI Reason', lines[0].endsWith(',Chat Sent,Chat Received,AI Verdict,AI Rule,AI Reason'), lines[0]);
check('every CSV row has a verdict', lines.slice(1).every(l => /"(Legal|Illegal)","/.test(l)), lines.find(l => !/"(Legal|Illegal)","/.test(l)));

// pages: one student's game-over card (an illegal pair), the dashboard
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ill = plan.find(pl => review.results.find(x => x.pairId === pl.pairId)?.verdict === 'Illegal');
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto(`${BASE}/session/${code}/${ill.A.code}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('#ai-verdict .vbig', { timeout: 15000 }).catch(() => {});
const card = await page.$eval('#ai-verdict', e => e.innerText).catch(() => '');
check('the game-over card shows the verdict', /AI legal review[\s\S]*(Illegal|Legal)/i.test(card), card.slice(0, 160));
check('the chat card says the chat is closed', !!(await page.$('#chat-closed')));
const el = await page.$('#ai-verdict'); if (el) await el.screenshot({ path: path.join(OUT, 'student-verdict.png') });
await page.screenshot({ path: path.join(OUT, 'student-page.png'), fullPage: true });
const dash = await browser.newPage();
await dash.setViewport({ width: 1440, height: 1000 });
await dash.goto(`${BASE}/instructor?key=${KEY}`, { waitUntil: 'networkidle2' });
await dash.goto(`${BASE}/manage/${code}`, { waitUntil: 'networkidle2' });
await dash.waitForSelector('#tab-review', { timeout: 15000 }).catch(() => {});
await dash.click('#tab-review').catch(() => {}); // the review has its own tab (2026-11-16)
await dash.waitForSelector('.review .rv-row', { timeout: 15000 }).catch(() => {});
const rows = await dash.$$eval('.review .rv-row', r => r.length).catch(() => 0);
check('the dashboard lists every pair', rows === N / 2, String(rows));
await dash.click('.review .rv-row').catch(() => {});
await sleep(400);
const panel = await dash.$('.review'); if (panel) await panel.screenshot({ path: path.join(OUT, 'dashboard-review.png') });

console.log(`\n${pass} of ${pass + fail} checks passed; screenshots in ${OUT}`);
fs.writeFileSync(path.join(OUT, 'review.json'), JSON.stringify(review, null, 2));
fs.writeFileSync(path.join(OUT, 'server.log'), serverLog.join(''));
await browser.close(); server.kill(); process.exit(fail ? 1 : 0);
