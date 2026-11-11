#!/usr/bin/env node
// A class of real browser pages (teaching23-games, 2026-11-10; Mert: "50 students on the actual browser, record
// everything, make sure nothing gets stuck"). Headless Chrome (the installed one, through puppeteer-core) opens N
// student pages at phone size, each in its own browser profile, and plays the actual student page: types a name and
// the code on the join page, types dollars and cents into the price boxes, taps Submit. The instructor side is a socket
// that creates the game, opens the lobby, starts when every page is in, and records when the server announced each
// round; one more page shows the instructor dashboard.
//
// Behaviours, by student number: most submit at a random moment; some in the last seconds; some never (random price);
// some type a price above the max first (must be refused, then a valid one); some reload mid-round; some close the tab
// mid-game and come back through the join page (must get their seat back).
//
// Recorded in --out (default: a new folder in the system temp dir): a screenshot of every page at chosen moments
// (contact sheets in index.html), each page's delay between the server announcing a round/result and the page
// showing it, every page error, and a final check of every page's rounds table against the server's CSV.
//
//   node browsers.mjs --host https://lab-a.onrender.com --key <instructor key> [--n 49] [--game 1] [--out DIR]

import puppeteer from 'puppeteer-core';
import { io } from 'socket.io-client';
import fs from 'fs';
import os from 'os';
import path from 'path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
if (!args.host || !args.key) { console.log('usage: node browsers.mjs --host <url> --key <key> [--n 49] [--game 1] [--out DIR]'); process.exit(1); }
const BASE = String(args.host).replace(/\/$/, '');
const KEY = String(args.key);
const N = Number(args.n || 49);
const OUT = args.out && args.out !== true ? String(args.out) : fs.mkdtempSync(path.join(os.tmpdir(), 'l13-browsers-'));
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sec = m => ((Date.now() - T0) / 1000).toFixed(1);
let T0 = Date.now();
const log = (...a) => { const line = `[${sec()}s] ${a.join(' ')}`; console.log(line); fs.appendFileSync(path.join(OUT, 'log.txt'), line + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the games of the class (option C, 2026-11-10)
const GAMES = {
  1: { label: 'Game 1', rounds: 10, roundTime: [60, 50, 40, 30, 30, 30, 30, 30, 30, 30], travelCost: 0.01 },
  2: { label: 'Game 2', rounds: 10, roundTime: [45, 30, 30, 30, 30, 30, 30, 30, 30, 30], travelCost: 0.004 },
  3: { label: 'Game 3', rounds: 10, roundTime: [45, 30, 30, 30, 30, 30, 30, 30, 30, 30], travelCost: 0 }
};
const G = { ...GAMES[Number(args.game || 1)] };
if (args.short) { G.rounds = 3; G.roundTime = [25, 25, 25]; G.label += ' (short)'; } // a quick dry run
const config = {
  rounds: G.rounds, roundTime: G.roundTime, breakTime: 10, modelType: 'hotelling', travelCost: G.travelCost, consumerValue: 7,
  marginalCost: 3.3, marketSize: 10000, x1: 0, x2: 100, priceBounds: { min: 3.3, max: 10 }, randomPriceMax: 6, showOpponentName: false
};
const SHOT_AT = new Set(['lobby', 'r1-mid', 'r1-result', 'r2-mid', `r${Math.ceil(G.rounds / 2)}-result`, 'over']);

// ---- the instructor: a socket ------------------------------------------------------------------------------------
const created = await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'Browser test', sessionName: `browser test ${G.label} x${N}`, config }) });
const session = await created.json();
if (created.status !== 201) { console.error('could not create the session:', session); process.exit(1); }
const CODE = session.code;
T0 = Date.now();
log(`session ${CODE} on ${BASE}: ${G.label}, ${N} browser students; output ${OUT}`);
const inst = io(BASE, { transports: ['websocket'] });
const announced = { round: {}, result: {} }; // server time each round started / each result went out (ms since T0)
let lobbyCount = 0, gameOver = false;
inst.on('connect', () => inst.emit('joinSession', { sessionCode: CODE, playerName: 'Browser test', role: 'instructor', key: KEY }));
inst.on('joinedSession', () => inst.emit('openLobby', { sessionCode: CODE }));
inst.on('sessionUpdate', p => { if (p.status === 'lobby') lobbyCount = (p.players || []).filter(q => q.role === 'student' && q.connected).length; });
inst.on('roundStarted', p => { announced.round[p.round] ??= Date.now() - T0; log(`server: round ${p.round} started (${p.roundTime} s)`); });
inst.on('roundSummary', p => { announced.result[p.round] ??= Date.now() - T0; log(`server: round ${p.round} results out`); });
inst.on('submissionProgress', p => { if (p.submitted === p.total) log(`server: all ${p.total} prices in for round ${p.round}`); });
inst.on('sessionComplete', () => { gameOver = true; log('server: game over'); });
inst.on('errorMessage', m => log('server error to instructor:', m));
await new Promise(r => inst.on('sessionUpdate', p => p.status === 'lobby' && r()));

// ---- the students: real pages ------------------------------------------------------------------------------------
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 120000,
  args: ['--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [];
const kinds = i => (i % 10 === 3 ? 'late' : i % 10 === 7 ? 'never' : i % 10 === 5 ? 'too-high-first' : i % 16 === 9 ? 'reload' : i % 25 === 12 ? 'close-and-rejoin' : 'normal');
const students = [];

async function newPage(ctx, s) {
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(`${s.name}: page error ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${s.name}: console ${m.text().slice(0, 200)}`); });
  return page;
}
async function joinFromJoinPage(s) {
  await s.page.goto(BASE.includes('lab-a') ? 'https://15010.ai/l13-a' : BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await s.page.type('#student-name', s.name);
  await s.page.type('#session-code', CODE);
  await s.page.click('button[type=submit]');
  await s.page.waitForFunction(code => new RegExp(`/session/${code}/[A-Z0-9]{6}$`).test(location.pathname), { timeout: 30000 }, CODE);
}
for (let i = 0; i < N; i++) {
  const ctx = await browser.createBrowserContext(); // own storage: each student is a separate phone
  const s = { i, name: `Student ${String(i + 1).padStart(2, '0')}`, kind: kinds(i), ctx, seen: { round: {}, result: {} }, submitted: {}, refused: 0, rejoined: false };
  s.page = await newPage(ctx, s);
  students.push(s);
}
log(`opening ${N} join pages`);
const joinStart = Date.now();
await Promise.all(students.map(async (s, k) => { await sleep(k * 120); try { await joinFromJoinPage(s); s.link = s.page.url(); } catch (e) { errors.push(`${s.name}: join failed ${e.message}`); } }));
log(`${students.filter(s => s.link).length} of ${N} pages joined in ${((Date.now() - joinStart) / 1000).toFixed(0)} s`);

// the instructor dashboard in a real page (the xx link stores the key)
const dashCtx = await browser.createBrowserContext();
const dash = await dashCtx.newPage();
await dash.setViewport({ width: 1400, height: 1000 });
dash.on('pageerror', e => errors.push(`dashboard: page error ${e.message}`));
try {
  await dash.goto(BASE + `/instructor?key=${encodeURIComponent(KEY)}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await dash.goto(BASE + `/manage/${CODE}`, { waitUntil: 'networkidle2', timeout: 60000 });
} catch (e) { errors.push('dashboard: ' + e.message); }

// what a page shows: the left card's heading and title, as typed in the code (textContent ignores CSS upper-casing)
const readCard = p => p.evaluate(() => {
  const c = document.querySelector('#qcard');
  return { kase: c?.querySelector('.case')?.textContent || '', qt: c?.querySelector('.qt')?.textContent || '', err: c?.querySelector('.fb.no')?.textContent || '', ok: c?.querySelector('.fb.ok')?.textContent || '' };
}).catch(() => null);

async function shootAll(tag) {
  if (!SHOT_AT.has(tag)) return;
  await Promise.all(students.map(s => s.page.screenshot({ path: path.join(OUT, 'shots', `${tag}-${String(s.i + 1).padStart(2, '0')}.png`) }).catch(() => {})));
  await dash.screenshot({ path: path.join(OUT, 'shots', `${tag}-dashboard.png`), fullPage: true }).catch(() => {});
  log(`screenshots: ${tag}`);
}

async function typePrice(page, price) {
  const d = String(Math.floor(price)), c = String(Math.round((price - Math.floor(price)) * 100)).padStart(2, '0');
  await page.click('.pin2 .dollars');
  await page.keyboard.type(d, { delay: 40 });
  const inCents = await page.evaluate(() => document.activeElement?.classList.contains('cents'));
  if (!inCents) await page.keyboard.type('.', { delay: 40 }); // "10" fits under the max, so the point moves on
  await page.keyboard.type(c, { delay: 40 });
  await page.click('.pin2 ~ * button[type=submit], form button[type=submit]');
}

// one student's game: watch the card, act once per round
async function play(s) {
  let done = false;
  while (!done) {
    const card = await readCard(s.page);
    const t = Date.now() - T0;
    if (card) {
      let m;
      if ((m = /^Round (\d+) of/.exec(card.kase)) && /Set your price|Your price is in/.test(card.qt)) {
        const r = Number(m[1]);
        s.seen.round[r] ??= t;
        if (!s.submitted[r] && s.kind !== 'never') {
          s.submitted[r] = 'planned';
          const len = G.roundTime[r - 1] * 1000;
          const elapsed = t - (announced.round[r] ?? t);
          const at = s.kind === 'late' ? len - 5000 - Math.random() * 2500 : 1500 + Math.random() * Math.min(len * 0.6, 25000);
          const price = Math.round((3.4 + Math.random() * 2.6) * 100) / 100;
          (async () => {
            await sleep(Math.max(0, at - elapsed));
            try {
              if (s.kind === 'reload' && r % 3 === 1) { await s.page.reload({ waitUntil: 'networkidle2' }); await s.page.waitForSelector('.pin2 .dollars', { timeout: 15000 }); }
              if (s.kind === 'close-and-rejoin' && r === 3) {
                await s.page.close();
                s.page = await newPage(s.ctx, s);
                await joinFromJoinPage(s);
                s.rejoined = s.page.url() === s.link;
                await s.page.waitForSelector('.pin2 .dollars', { timeout: 15000 });
              }
              if (s.kind === 'too-high-first' && r === 2) {
                await typePrice(s.page, 12.5);
                await sleep(400);
                const c2 = await readCard(s.page);
                if (/between/.test(c2?.err || '')) s.refused++;
                // clear both boxes the way a thumb would: select the box's text, then delete it
                for (const sel of ['.pin2 .cents', '.pin2 .dollars']) {
                  await s.page.focus(sel);
                  await s.page.evaluate(q => document.querySelector(q).select(), sel);
                  await s.page.keyboard.press('Backspace');
                }
                s.afterRefusal = await s.page.evaluate(() => [document.querySelector('.pin2 .dollars').value, document.querySelector('.pin2 .cents').value].join('.'));
              }
              await typePrice(s.page, price);
              s.submitted[r] = price;
              await sleep(1200);
              const after = await readCard(s.page);
              if (!/Submitted/.test(after?.ok || '')) errors.push(`${s.name}: round ${r} typed ${price} but the page did not confirm (${(after?.err || after?.qt || '').slice(0, 120)}; boxes after the refusal: ${s.afterRefusal ?? '-'})`);
            } catch (e) { errors.push(`${s.name}: round ${r} submit failed ${e.message.slice(0, 120)}`); s.submitted[r] = 'failed'; }
          })();
        }
      } else if ((m = /^Round (\d+) result/.exec(card.kase))) {
        s.seen.result[Number(m[1])] ??= t;
      } else if (/^Game over/.test(card.kase)) {
        s.seen.over = t; done = true;
      }
    }
    if (!done) await sleep(300);
  }
}

// screenshots on the server's clock
const shots = (async () => {
  await shootAll('lobby');
  for (let r = 1; r <= G.rounds; r++) {
    while (announced.round[r] === undefined && !gameOver) await sleep(200);
    if (r <= 2) { await sleep(G.roundTime[r - 1] * 500); await shootAll(`r${r}-mid`); }
    while (announced.result[r] === undefined && !gameOver) await sleep(200);
    await sleep(2500); await shootAll(`r${r}-result`);
  }
  while (!gameOver) await sleep(300);
  await sleep(4000); await shootAll('over');
})();

// start once every page is in the lobby (or after 60 s)
const waitStart = Date.now();
while (lobbyCount < students.filter(s => s.link).length && Date.now() - waitStart < 60000) await sleep(500);
log(`starting with ${lobbyCount} students in the lobby`);
inst.emit('startSession', { sessionCode: CODE });
await Promise.all(students.map(s => play(s).catch(e => errors.push(`${s.name}: ${e.message}`))));
await shots;

// ---- the report --------------------------------------------------------------------------------------------------
const csv = await (await fetch(BASE + `/api/session/${CODE}/export`, { headers: { 'x-instructor-key': KEY } })).text();
fs.writeFileSync(path.join(OUT, `session-${CODE}.csv`), csv);
const rows = csv.trim().split('\n').slice(1).map(l => l.match(/("[^"]*"|[^,]+)/g).map(x => x.replace(/^"|"$/g, '')));
const byName = new Map();
rows.forEach(r => { const k = r[1]; if (!byName.has(k)) byName.set(k, []); byName.get(k)[Number(r[0]) - 1] = { price: Number(r[2]), opp: Number(r[4]), profit: Number(r[6]) }; });
const mismatches = [];
for (const s of students) {
  const table = await s.page.evaluate(() => [...document.querySelectorAll('table.rounds tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent))).catch(() => []);
  const mine = byName.get(s.name) || [];
  table.filter(r => /^\d+$/.test(r[0])).forEach(r => {
    const k = Number(r[0]), you = Number(r[1].replace(/[$,]/g, '')), riv = Number(r[2].replace(/[$,]/g, ''));
    const c = mine[k - 1];
    if (!c || Math.abs(c.price - you) > 0.001 || Math.abs(c.opp - riv) > 0.001) mismatches.push(`${s.name} round ${k}: page ${r[1]} vs ${r[2]}, CSV ${c?.price} vs ${c?.opp}`);
    const typed = s.submitted[k];
    if (typeof typed === 'number' && Math.abs(typed - you) > 0.001) mismatches.push(`${s.name} round ${k}: typed ${typed}, page shows ${r[1]}`);
  });
  if (table.filter(r => /^\d+$/.test(r[0])).length !== G.rounds) mismatches.push(`${s.name}: rounds table has ${table.filter(r => /^\d+$/.test(r[0])).length} rows`);
}
const lag = kind => {
  const all = [];
  students.forEach(s => Object.entries(s.seen[kind]).forEach(([r, t]) => { const a = announced[kind][r]; if (a !== undefined) all.push({ s: s.name, r: Number(r), d: (t - a) / 1000 }); }));
  all.sort((a, b) => b.d - a.d);
  const ds = all.map(x => x.d).sort((a, b) => a - b);
  const q = p => ds.length ? ds[Math.min(ds.length - 1, Math.floor(p * ds.length))] : NaN;
  return { n: all.length, median: q(0.5), p95: q(0.95), max: q(1), worst: all.slice(0, 5) };
};
const missing = [];
students.forEach(s => { for (let r = 1; r <= G.rounds; r++) { if (s.seen.round[r] === undefined) missing.push(`${s.name} never showed round ${r}`); if (s.seen.result[r] === undefined) missing.push(`${s.name} never showed the round ${r} result`); } if (s.seen.over === undefined) missing.push(`${s.name} never showed game over`); });
const L1 = lag('round'), L2 = lag('result');
const summary = [
  `${G.label}, ${N} browser students, session ${CODE}, ${BASE}`,
  `joined: ${students.filter(s => s.link).length} of ${N}`,
  `round shown after the server started it: median ${L1.median?.toFixed(1)} s, 95% within ${L1.p95?.toFixed(1)} s, slowest ${L1.max?.toFixed(1)} s (${L1.n} page-rounds)`,
  `result shown after the server sent it: median ${L2.median?.toFixed(1)} s, 95% within ${L2.p95?.toFixed(1)} s, slowest ${L2.max?.toFixed(1)} s (${L2.n})`,
  `slowest rounds: ${L1.worst.map(w => `${w.s} r${w.r} ${w.d.toFixed(1)} s`).join('; ')}`,
  `pages that missed a round, a result or the game over: ${missing.length}${missing.length ? '\n  ' + missing.slice(0, 15).join('\n  ') : ''}`,
  `page tables vs server CSV: ${mismatches.length} mismatches${mismatches.length ? '\n  ' + mismatches.slice(0, 15).join('\n  ') : ''}`,
  `too-high price refused on the page: ${students.filter(s => s.kind === 'too-high-first').map(s => `${s.name} ${s.refused ? 'yes' : 'NO'}`).join(', ')}`,
  `closed the tab and came back through the join page: ${students.filter(s => s.kind === 'close-and-rejoin').map(s => `${s.name} ${s.rejoined ? 'got the seat back' : 'DID NOT get the seat back'}`).join(', ')}`,
  `page errors: ${errors.length}${errors.length ? '\n  ' + errors.slice(0, 15).join('\n  ') : ''}`
].join('\n');
fs.writeFileSync(path.join(OUT, 'summary.txt'), summary + '\n');
log('\n' + summary);

// contact sheets
const tags = [...SHOT_AT];
const html = `<!doctype html><meta charset="utf-8"><title>Browser test ${CODE}</title><style>body{font:14px -apple-system,sans-serif;margin:16px;background:#f6f7f9}h2{margin:24px 0 8px}div.g{display:flex;flex-wrap:wrap;gap:6px}figure{margin:0;width:156px}figure img{width:156px;border:1px solid #ccc;border-radius:6px}figcaption{font-size:11px;color:#555}pre{background:#fff;padding:12px;border-radius:8px;white-space:pre-wrap}</style>
<h1>Browser test, ${G.label}, ${N} students, session ${CODE}</h1><pre>${summary.replace(/</g, '&lt;')}</pre>
${tags.map(t => `<h2>${t}</h2><div class="g">${students.map(s => `<figure><img src="shots/${t}-${String(s.i + 1).padStart(2, '0')}.png" loading="lazy"><figcaption>${s.name} (${s.kind})</figcaption></figure>`).join('')}</div><p>Dashboard:</p><img src="shots/${t}-dashboard.png" style="max-width:100%;border:1px solid #ccc">`).join('')}`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
log(`report: ${path.join(OUT, 'index.html')}`);
inst.close();
await browser.close();
process.exit(0);
