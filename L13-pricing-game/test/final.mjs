#!/usr/bin/env node
// The final class rehearsal (teaching23-games, 2026-11-11; Mert: "a browser based test with 75 students of all games,
// in an extremely detailed way"). One set of N real browser pages (headless Chrome at phone size, each its own profile)
// plays the class's games back to back with the class presets: Game 1, Game 2, Game 3 and the bonus chat game. The first
// game is joined from 15010.ai/l13-<x> (the real redirect); each later one through the game-over card's "Join the next
// game" button, the name already filled in, typing the new code, as students will in class.
//
//   node test/final.mjs --host https://lab-a.onrender.com --key <instructor key> [--n 75] [--games 1,2,3,chat]
//        [--out DIR] [--short] [--keep]
//
// Students, by number: most submit at a random moment; some in the last seconds; some never (the game gives a random
// price); some type a price above the max first (refused) then a valid one; some reload mid-round; some close the tab in
// round 3 and come back through the join page. In the chat game every page writes to its rival each round.
//
// Checked, per game: every page joined and was in the lobby; every page showed every round, result and the game over
// (with the delay after the server); every typed price was confirmed on the page ("Submitted at") and how long that took;
// every page's rounds table equals the CSV; every typed price is the CSV price with "Random Price" No, and every unsent
// one is "Yes" and within the random range; every CSV row's gallons are recomputed independently (drivers along the
// road, brute force), profit = (price - cost) x gallons, share = gallons / 10,000, and the two rows of a pair agree;
// "Rounds won" and "You placed X of N" on every page against the CSV (ties to the cent, the AI seat counted); the AI
// seat's name and prices; in the chat game: the lobby says the chat opens at the start, the student facing the AI sees
// no chat, each page shows its rival's messages (after a reload too) and the CSV has them; no page errors.
// Recorded in --out: log, summary per game, the CSVs, screenshots and a report (index.html). The test games are deleted
// from the service at the end unless --keep (the CSVs stay in --out).

import puppeteer from 'puppeteer-core';
import { io } from 'socket.io-client';
import fs from 'fs';
import os from 'os';
import path from 'path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
if (!args.host || !args.key) { console.log('usage: node final.mjs --host <url> --key <key> [--n 75] [--games 1,2,3,chat] [--out DIR] [--short] [--keep]'); process.exit(1); }
const BASE = String(args.host).replace(/\/$/, '');
const KEY = String(args.key);
const N = Number(args.n || 75);
const SECTION = (/lab-([a-f])/.exec(BASE) || [])[1];
const JOIN_URL = SECTION ? `https://15010.ai/l13-${SECTION}` : BASE + '/';
const OUT = args.out && args.out !== true ? String(args.out) : fs.mkdtempSync(path.join(os.tmpdir(), 'l13-final-'));
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const T0 = Date.now();
const sec = () => ((Date.now() - T0) / 1000).toFixed(1);
const log = (...a) => { const line = `[${sec()}s] ${a.join(' ')}`; console.log(line); fs.appendFileSync(path.join(OUT, 'log.txt'), line + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cents = x => Math.round((Number(x) || 0) * 100);

// ---- the class presets (client/src/pages/InstructorPage.jsx, DEFAULT_GAMES on DEFAULT_CONFIG) ---------------------
const COMMON = { breakTime: 10, marketSize: 10000, marginalCost: 3.3, randomPriceMax: 6, modelType: 'hotelling', consumerValue: 7,
  x1: 0, x2: 100, priceBounds: { min: 3.3, max: 10 }, enableChat: false, hideRoundCount: false, showOpponentName: false, showModelParameters: false };
const PRESETS = {
  1: { label: 'Game 1', rounds: 10, roundTime: [60, 50, 40, 30, 30, 30, 30, 30, 30, 30], travelCost: 0.01, nash: 4.30 },
  2: { label: 'Game 2', rounds: 10, roundTime: [45, 30, 30, 30, 30, 30, 30, 30, 30, 30], travelCost: 0.004, nash: 3.70 },
  3: { label: 'Game 3', rounds: 10, roundTime: [45, 30, 30, 30, 30, 30, 30, 30, 30, 30], travelCost: 0.0002, nash: 3.32 },
  chat: { label: 'Chat game', rounds: 5, roundTime: [60, 60, 60, 60, 60], travelCost: 0.004, nash: 3.70, enableChat: true }
};
const GAME_KEYS = String(args.games || '1,2,3,chat').split(',').map(s => s.trim());
const presetOf = k => {
  const p = { ...PRESETS[k] };
  if (args.short) { p.rounds = 3; p.roundTime = p.roundTime.slice(0, 3).map(() => 25); p.label += ' (short)'; }
  return p;
};

// ---- independent demand: drivers spread along the 100-mile road, 100 gallons a mile, brute force ------------------
function demandCheck(pA, pB, t, V = 7) {
  const STEPS = 200000, dx = 100 / STEPS;
  let qA = 0, qB = 0;
  for (let k = 0; k < STEPS; k++) {
    const x = (k + 0.5) * dx, a = pA + t * x, b = pB + t * (100 - x);
    if (Math.min(a, b) > V + 1e-12) continue;
    if (a < b - 1e-12) qA += dx; else if (b < a - 1e-12) qB += dx; else { qA += dx / 2; qB += dx / 2; }
  }
  return { qA: qA * 100, qB: qB * 100 };
}

// ---- the pages ---------------------------------------------------------------------------------------------------
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 180000,
  args: ['--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const kinds = i => (i % 10 === 3 ? 'late' : i % 10 === 7 ? 'never' : i % 10 === 5 ? 'too-high-first' : i % 16 === 9 ? 'reload' : i % 25 === 12 ? 'close-and-rejoin' : 'normal');
const students = [];
let errors = [];
async function newPage(ctx, s) {
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(`${s.name}: page error ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(`${s.name}: console ${m.text().slice(0, 200)}`); });
  return page;
}
for (let i = 0; i < N; i++) {
  const ctx = await browser.createBrowserContext();
  const s = { i, name: `Student ${String(i + 1).padStart(2, '0')}`, kind: kinds(i), ctx };
  s.page = await newPage(ctx, s);
  students.push(s);
}
const dashCtx = await browser.createBrowserContext();
const dash = await dashCtx.newPage();
await dash.setViewport({ width: 1400, height: 1000 });
dash.on('pageerror', e => errors.push(`dashboard: page error ${e.message}`));
await dash.goto(BASE + `/instructor?key=${encodeURIComponent(KEY)}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => errors.push('dashboard: ' + e.message));
log(`${N} pages open; games ${GAME_KEYS.join(', ')} on ${BASE}; students join at ${JOIN_URL}; output ${OUT}`);

const withTimeout = (pr, ms) => Promise.race([pr, new Promise(r => setTimeout(() => r(null), ms))]);
const readCard = p => withTimeout(p.evaluate(() => {
  const c = document.querySelector('#qcard');
  return { kase: c?.querySelector('.case')?.textContent || '', qt: c?.querySelector('.qt')?.textContent || '', err: c?.querySelector('.fb.no')?.textContent || '',
    ok: document.querySelector('#price-ok')?.textContent || '', sending: !!document.querySelector('#price-sending') };
}).catch(() => null), 5000);
async function typePrice(page, price) {
  const d = String(Math.floor(price)), c = String(Math.round((price - Math.floor(price)) * 100)).padStart(2, '0');
  await page.click('.pin2 .dollars');
  await page.keyboard.type(d, { delay: 40 });
  const inCents = await page.evaluate(() => document.activeElement?.classList.contains('cents'));
  if (!inCents) await page.keyboard.type('.', { delay: 40 });
  await page.keyboard.type(c, { delay: 40 });
  await page.click('form button[type=submit]');
}

const allSummaries = [];
const codes = [];
for (let gi = 0; gi < GAME_KEYS.length; gi++) {
  const G = presetOf(GAME_KEYS[gi]);
  errors = [];
  const config = { ...COMMON, rounds: G.rounds, roundTime: G.roundTime, travelCost: G.travelCost, enableChat: !!G.enableChat };
  const created = await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
    body: JSON.stringify({ instructorName: 'Final test', sessionName: `final test ${G.label} x${N}`, config }) });
  const session = await created.json();
  if (created.status !== 201) { log('could not create the session:', JSON.stringify(session)); break; }
  const CODE = session.code; codes.push(CODE);
  const GT0 = Date.now();
  const gsec = () => Date.now() - GT0;
  log(`=== ${G.label}: session ${CODE}`);
  const inst = io(BASE, { transports: ['websocket'] });
  const announced = { round: {}, result: {} };
  let lobbyCount = 0, gameOver = false, lobbyOpen = false, overAt = 0;
  const stuck = [];
  inst.on('connect', () => inst.emit('joinSession', { sessionCode: CODE, playerName: 'Final test', role: 'instructor', key: KEY }));
  inst.on('joinedSession', () => inst.emit('openLobby', { sessionCode: CODE }));
  inst.on('sessionUpdate', p => { if (p.status === 'lobby') { lobbyOpen = true; lobbyCount = (p.players || []).filter(q => q.role === 'student' && q.connected).length; } });
  inst.on('roundStarted', p => { announced.round[p.round] ??= gsec(); log(`server: ${G.label} round ${p.round} started`); });
  inst.on('roundSummary', p => { announced.result[p.round] ??= gsec(); });
  inst.on('submissionProgress', p => { if (p.submitted === p.total) log(`server: all ${p.total} prices in for round ${p.round}`); });
  inst.on('sessionComplete', () => { gameOver = true; overAt = Date.now(); log(`server: ${G.label} over`); });
  inst.on('errorMessage', m => log('server error to instructor:', m));
  while (!lobbyOpen) await sleep(200);
  dash.goto(BASE + `/manage/${CODE}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => errors.push('dashboard: ' + e.message));

  // join: the first game from the join page; later ones with "Join the next game"
  const prefillWrong = [];
  const joinVia = async (s, how) => {
    if (how === 'button') {
      await s.page.waitForSelector('#next-game', { timeout: 30000 });
      await s.page.click('#next-game');
      await s.page.waitForSelector('#session-code', { timeout: 30000 });
      const nm = await s.page.$eval('#student-name', e => e.value);
      if (nm !== s.name) prefillWrong.push(`${s.name}: name box had "${nm}"`);
      if (!nm) await s.page.type('#student-name', s.name);
    } else {
      await s.page.goto(JOIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });
      const nm = await s.page.$eval('#student-name', e => e.value).catch(() => '');
      if (nm !== s.name) { await s.page.click('#student-name', { clickCount: 3 }); await s.page.keyboard.press('Backspace'); await s.page.type('#student-name', s.name); }
    }
    await s.page.type('#session-code', CODE);
    await s.page.click('button[type=submit]');
    await s.page.waitForFunction(code => new RegExp(`/session/${code}/[A-Z0-9]{6}$`).test(location.pathname), { timeout: 30000 }, CODE);
  };
  students.forEach(s => Object.assign(s, { link: null, seen: { round: {}, result: {} }, submitted: {}, ack: {}, refused: 0, rejoined: null, sent: [] }));
  const js = Date.now();
  await Promise.all(students.map(async (s, k) => {
    await sleep(k * 150 + Math.random() * 3000);
    try { await joinVia(s, gi === 0 ? 'page' : 'button'); s.link = s.page.url(); } catch (e) { errors.push(`${s.name}: join failed ${e.message.slice(0, 150)}`); }
  }));
  log(`${students.filter(s => s.link).length} of ${N} joined in ${((Date.now() - js) / 1000).toFixed(0)} s`);
  const ws = Date.now();
  while (lobbyCount < students.filter(s => s.link).length && Date.now() - ws < 60000) await sleep(500);
  const lobbyAtStart = lobbyCount;
  await sleep(2000);
  let chatLobbyOk = null;
  if (G.enableChat) chatLobbyOk = (await Promise.all(students.map(s => s.page.$('#chat-wait').then(Boolean).catch(() => false)))).filter(Boolean).length;
  await shoot(gi, 'lobby');
  log(`starting ${G.label} with ${lobbyAtStart} in the lobby`);
  inst.emit('startSession', { sessionCode: CODE });

  // one student's game
  async function play(s) {
    let done = false, chatOff = null;
    while (!done) {
      const card = await readCard(s.page);
      const t = gsec();
      let m;
      if (card && (m = /^Round (\d+) of/.exec(card.kase)) && /Set your price|Your price is in|Sending your price/.test(card.qt)) {
        const r = Number(m[1]);
        s.seen.round[r] ??= t;
        if (G.enableChat && chatOff === null) chatOff = await s.page.$('#chat-off').then(Boolean).catch(() => false);
        if (!s.submitted[r]) {
          s.submitted[r] = 'planned';
          const len = G.roundTime[r - 1] * 1000;
          const elapsed = t - (announced.round[r] ?? t);
          const at = s.kind === 'late' ? len - 5000 - Math.random() * 2500 : 1500 + Math.random() * Math.min(len * 0.6, 25000);
          const price = Math.round((3.4 + Math.random() * 3.4) * 100) / 100;
          if (G.enableChat && !chatOff) (async () => {
            await sleep(1000 + Math.random() * 6000);
            const msg = `${s.name} r${r}: how about $${(6 + Math.random()).toFixed(2)}?`;
            try { await s.page.type('.chatrow input', msg, { delay: 5 }); await s.page.click('.chatrow button'); s.sent.push({ r, msg }); } catch (e) { errors.push(`${s.name}: chat r${r} failed ${e.message.slice(0, 100)}`); }
          })();
          if (s.kind === 'never') { s.submitted[r] = 'never'; }
          else (async () => {
            await sleep(Math.max(0, at - elapsed));
            try {
              if (s.kind === 'reload' && r % 3 === 1) { await s.page.reload({ waitUntil: 'networkidle2' }); await s.page.waitForSelector('.pin2 .dollars', { timeout: 15000 }); }
              if (s.kind === 'close-and-rejoin' && r === 3) {
                await s.page.close();
                s.page = await newPage(s.ctx, s);
                await s.page.goto(JOIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });
                const nm = await s.page.$eval('#student-name', e => e.value).catch(() => '');
                if (!nm) await s.page.type('#student-name', s.name);
                await s.page.type('#session-code', CODE); await s.page.click('button[type=submit]');
                await s.page.waitForFunction(code => new RegExp(`/session/${code}/[A-Z0-9]{6}$`).test(location.pathname), { timeout: 30000 }, CODE);
                s.rejoined = s.page.url() === s.link;
                await s.page.waitForSelector('.pin2 .dollars', { timeout: 15000 });
              }
              if (s.kind === 'too-high-first' && r === 2) {
                await typePrice(s.page, 12.5);
                await sleep(500);
                const c2 = await readCard(s.page);
                if (/between/.test(c2?.err || '')) s.refused++;
                for (const sel of ['.pin2 .cents', '.pin2 .dollars']) { await s.page.focus(sel); await s.page.evaluate(q => document.querySelector(q).select(), sel); await s.page.keyboard.press('Backspace'); }
              }
              const t1 = Date.now();
              await typePrice(s.page, price);
              s.submitted[r] = price;
              let ok = false;
              while (Date.now() - t1 < 8000) { const c = await readCard(s.page); if (/Submitted at/.test(c?.ok || '')) { ok = true; break; } await sleep(150); }
              if (ok) s.ack[r] = (Date.now() - t1) / 1000;
              else { const c = await readCard(s.page); errors.push(`${s.name}: round ${r} typed ${price}, no "Submitted at" within 8 s (${(c?.err || (c?.sending ? 'Sending...' : c?.qt) || '').slice(0, 100)})`); }
            } catch (e) { errors.push(`${s.name}: round ${r} submit failed ${e.message.slice(0, 120)}`); s.submitted[r] = 'failed'; }
          })();
        }
      } else if (card && (m = /^Round (\d+) result/.exec(card.kase))) s.seen.result[Number(m[1])] ??= t;
      else if (card && /^Game over/.test(card.kase)) { s.seen.over = t; done = true; }
      // a page that has not shown the game over 45 s after the server ended the game: record what it shows and move on
      if (!done && gameOver && Date.now() - overAt > 45000) {
        const info = await withTimeout(s.page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 400) })).catch(e => ({ err: e.message })), 5000);
        await withTimeout(s.page.screenshot({ path: path.join(OUT, `stuck-${gi + 1}-${s.name.replace(/ /g, '')}.png`) }).catch(() => {}), 10000);
        stuck.push(`${s.name} (${s.kind}): card ${JSON.stringify(card)}; page ${JSON.stringify(info)}`);
        log(`STUCK ${s.name} (${s.kind}): ${JSON.stringify(card)} ${JSON.stringify(info).slice(0, 300)}`);
        done = true;
      }
      if (!done) await sleep(300);
    }
    s.chatOff = chatOff;
  }
  const shots = (async () => {
    for (let r = 1; r <= G.rounds; r++) {
      while (announced.round[r] === undefined && !gameOver) await sleep(200);
      if (r === 1) { await sleep(G.roundTime[0] * 600); await shoot(gi, 'r1-mid'); }
      while (announced.result[r] === undefined && !gameOver) await sleep(200);
      if (r === 1 || r === G.rounds) { await sleep(2500); await shoot(gi, `r${r}-result`); }
    }
  })();
  await Promise.all(students.map(s => play(s).catch(e => errors.push(`${s.name}: ${e.message}`))));
  await shots;
  while (!gameOver) await sleep(300);
  await sleep(4000);
  await shoot(gi, 'over');

  // ---- checks ------------------------------------------------------------------------------------------------
  const csv = await (await fetch(BASE + `/api/session/${CODE}/export`, { headers: { 'x-instructor-key': KEY } })).text();
  fs.writeFileSync(path.join(OUT, `${gi + 1}-${G.label.replace(/\W+/g, '_')}-${CODE}.csv`), csv);
  const parseLine = l => { const out = []; let cur = '', q = false; for (let k = 0; k < l.length; k++) { const ch = l[k]; if (q) { if (ch === '"' && l[k + 1] === '"') { cur += '"'; k++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const lines = csv.trim().split('\n');
  const head = parseLine(lines[0]);
  const col = n => head.indexOf(n);
  const rows = lines.slice(1).map(parseLine).map(c => ({ round: Number(c[col('Round')]), name: c[col('Player Name')], price: Number(c[col('Price')]), forced: c[col('Random Price')] === 'Yes',
    opp: c[col('Opponent Name')], oppPrice: Number(c[col('Opponent Price')]), oppForced: c[col('Opponent Random Price')] === 'Yes', q: Number(c[col('Quantity')]), profit: Number(c[col('Profit')]),
    share: Number(String(c[col('Market Share')]).replace('%', '')) / 100, sent: col('Chat Sent') >= 0 ? c[col('Chat Sent')] : null, recv: col('Chat Received') >= 0 ? c[col('Chat Received')] : null }));
  const F = []; // failures
  const byName = new Map(); rows.forEach(r => { if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name)[r.round - 1] = r; });
  // the arithmetic of every row, recomputed
  let mathRows = 0;
  for (const r of rows) {
    const { qA } = demandCheck(r.price, r.oppPrice, G.travelCost);
    if (Math.abs(qA - r.q) > 1) F.push(`math: ${r.name} r${r.round} ${r.price} vs ${r.oppPrice}: CSV ${r.q} gallons, recomputed ${qA.toFixed(2)}`);
    if (Math.abs((r.price - 3.3) * r.q - r.profit) > 0.02) F.push(`math: ${r.name} r${r.round} profit ${r.profit} is not (price - cost) x gallons`);
    if (Math.abs(r.q / 10000 - r.share) > 0.0002) F.push(`math: ${r.name} r${r.round} share ${r.share} vs gallons ${r.q}`);
    const o = byName.get(r.opp)?.[r.round - 1];
    if (!o || o.opp !== r.name || cents(o.price) !== cents(r.oppPrice) || o.forced !== r.oppForced) F.push(`pair: ${r.name} r${r.round} and ${r.opp} do not agree`);
    mathRows++;
  }
  // the pages
  const pageTables = await Promise.all(students.map(s => withTimeout(s.page.evaluate(() => ({
    rows: [...document.querySelectorAll('table.rounds tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent)),
    text: document.body.innerText,
    chat: [...document.querySelectorAll('.chat .m')].map(m => ({ me: m.classList.contains('me'), t: m.textContent.replace(/^(You|Rival)/, '') }))
  })).catch(() => null), 10000).then(x => x || { rows: [], text: '', chat: [] })));
  const totals = new Map(); rows.forEach(r => totals.set(r.name, (totals.get(r.name) || 0) + r.profit));
  const ai = [...byName.keys()].filter(n => !students.some(s => s.name === n));
  let placeOk = 0, wonOk = 0, tableOk = 0, typedOk = 0, typedN = 0, randomOk = 0, randomN = 0;
  students.forEach((s, k) => {
    const mine = byName.get(s.name) || [];
    const pt = pageTables[k];
    const tr = pt.rows.filter(r => /^\d+$/.test(r[0]));
    let bad = tr.length !== G.rounds;
    tr.forEach(r => { const c = mine[Number(r[0]) - 1]; if (!c || cents(r[1].replace(/[$,]/g, '')) !== cents(c.price) || cents(r[2].replace(/[$,]/g, '')) !== cents(c.oppPrice)) bad = true; });
    if (bad) F.push(`table: ${s.name} page rounds table differs from the CSV (${tr.length} rows)`); else tableOk++;
    for (let r = 1; r <= G.rounds; r++) {
      const c = mine[r - 1]; if (!c) { F.push(`csv: no row for ${s.name} round ${r}`); continue; }
      const typed = s.submitted[r];
      if (typeof typed === 'number') { typedN++; if (cents(typed) === cents(c.price) && !c.forced) typedOk++; else F.push(`typed: ${s.name} r${r} typed ${typed}, CSV ${c.price} random=${c.forced}`); }
      else if (typed === 'never') { randomN++; if (c.forced && c.price >= 3.3 && c.price <= 6) randomOk++; else F.push(`random: ${s.name} r${r} sent nothing, CSV ${c.price} random=${c.forced}`); }
    }
    const won = mine.filter(c => c && cents(c.profit) > cents(byName.get(c.opp)?.[c.round - 1]?.profit)).length;
    const lost = mine.filter(c => c && cents(c.profit) < cents(byName.get(c.opp)?.[c.round - 1]?.profit)).length;
    const wm = /Rounds won\s+(\d+) of (\d+)\s+(\d+) of (\d+)/.exec(pt.text);
    if (wm && Number(wm[1]) === won && Number(wm[3]) === lost) wonOk++; else F.push(`won: ${s.name} page "${wm?.[0]}" vs CSV ${won}/${lost}`);
    const my = cents(totals.get(s.name));
    const place = 1 + [...totals.values()].filter(v => cents(v) > my).length;
    const tied = [...totals.entries()].filter(([n, v]) => n !== s.name && cents(v) === my).length;
    const want = `You placed ${place} of ${totals.size} in the class by total profit${tied ? `, tied with ${tied} other${tied > 1 ? 's' : ''}` : ''}.`;
    if (pt.text.includes(want)) placeOk++; else F.push(`place: ${s.name} expected "${want}", page "${(/You placed[^\n]*/.exec(pt.text) || [''])[0]}"`);
  });
  // chat
  let chatLine = '';
  if (G.enableChat) {
    let shown = 0, expected = 0, csvSent = 0, csvSentN = 0;
    const vsAI = students.filter(s => s.chatOff);
    students.forEach((s, k) => {
      const mine = byName.get(s.name) || [];
      if (s.chatOff) return;
      const rivalName = mine[0]?.opp; const rival = students.find(x => x.name === rivalName);
      (rival?.sent || []).forEach(m => { expected++; if (pageTables[k].chat.some(c => !c.me && c.t === m.msg)) shown++; else F.push(`chat: ${s.name} does not show ${rivalName}'s "${m.msg}"`); });
      s.sent.forEach(m => { csvSentN++; if ((mine[m.r - 1]?.sent || '').includes(m.msg) || (mine[m.r]?.sent || '').includes(m.msg)) csvSent++; else F.push(`chat csv: ${s.name} "${m.msg}" not under Chat Sent`); });
      if (pageTables[k].chat.filter(c => c.me).length !== s.sent.length) F.push(`chat: ${s.name} shows ${pageTables[k].chat.filter(c => c.me).length} of own ${s.sent.length} messages on its side`);
    });
    chatLine = `chat: lobby said "Chat opens when the game starts" on ${chatLobbyOk} of ${N}; facing the AI with no chat: ${vsAI.map(s => s.name).join(', ') || 'nobody'}; rival messages shown ${shown} of ${expected}; own messages in the CSV ${csvSent} of ${csvSentN}`;
  }
  const missing = [];
  students.forEach(s => { for (let r = 1; r <= G.rounds; r++) { if (s.seen.round[r] === undefined) missing.push(`${s.name} r${r}`); if (s.seen.result[r] === undefined) missing.push(`${s.name} result ${r}`); } if (s.seen.over === undefined) missing.push(`${s.name} game over`); });
  const lag = kind => { const ds = []; students.forEach(s => Object.entries(s.seen[kind]).forEach(([r, t]) => { const a = announced[kind][r]; if (a !== undefined) ds.push((t - a) / 1000); })); ds.sort((a, b) => a - b); const q = p => ds.length ? ds[Math.min(ds.length - 1, Math.floor(p * ds.length))].toFixed(1) : '-'; return `median ${q(0.5)} s, 95% ${q(0.95)} s, slowest ${q(1)} s`; };
  const acks = students.flatMap(s => Object.values(s.ack)).sort((a, b) => a - b);
  const aq = p => acks.length ? acks[Math.min(acks.length - 1, Math.floor(p * acks.length))].toFixed(2) : '-';
  const aiRows = ai.flatMap(n => byName.get(n) || []);
  const summary = [
    `${G.label}: session ${CODE}, ${N} pages`,
    `joined ${students.filter(s => s.link).length} of ${N} (${gi === 0 ? 'from ' + JOIN_URL : 'with "Join the next game"'}); in the lobby at Start ${lobbyAtStart}${prefillWrong.length ? `; name not prefilled: ${prefillWrong.length} (${prefillWrong.slice(0, 3).join('; ')})` : gi ? '; name prefilled on every page' : ''}`,
    `rounds shown after the server started them: ${lag('round')}; results: ${lag('result')}; pages that missed a round, result or game over: ${missing.length}${missing.length ? ' (' + missing.slice(0, 8).join(', ') + ')' : ''}`,
    `"Submitted at" after Submit: median ${aq(0.5)} s, 95% ${aq(0.95)} s, slowest ${aq(1)} s (${acks.length} prices)`,
    `typed prices = CSV price, not random: ${typedOk} of ${typedN}; unsent rounds marked random and in $3.30-$6: ${randomOk} of ${randomN}`,
    `CSV rows recomputed (gallons by brute force, profit, share, both rows of a pair): ${mathRows} rows, ${F.filter(f => /^(math|pair)/.test(f)).length} problems`,
    `page rounds tables = CSV: ${tableOk} of ${N}; "Rounds won" right: ${wonOk} of ${N}; "You placed X of ${totals.size}" right: ${placeOk} of ${N}`,
    `AI seat: ${ai.join(', ') || 'none'}${aiRows.length ? `; prices ${aiRows.map(r => r.price.toFixed(2)).join(' ')}${aiRows.every(r => cents(r.price) === cents(G.nash)) ? ' (every round the Nash price: probably the fallback, OpenAI not answering)' : ''}; random ${aiRows.filter(r => r.forced).length}` : ''}`,
    `too-high price refused: ${students.filter(s => s.kind === 'too-high-first').filter(s => s.refused).length} of ${students.filter(s => s.kind === 'too-high-first').length}; closed the tab in round 3 and got the seat back: ${students.filter(s => s.kind === 'close-and-rejoin').map(s => `${s.name} ${s.rejoined ? 'yes' : 'NO'}`).join(', ')}`,
    ...(chatLine ? [chatLine] : []),
    `pages that never showed the game over: ${stuck.length}${stuck.length ? '\n    ' + stuck.join('\n    ') : ''}`,
    `page errors: ${errors.length}${errors.length ? '\n    ' + errors.slice(0, 12).join('\n    ') : ''}`,
    `FAILURES: ${F.length}${F.length ? '\n    ' + F.slice(0, 25).join('\n    ') : ''}`
  ].join('\n  ');
  allSummaries.push(summary);
  fs.writeFileSync(path.join(OUT, 'summary.txt'), allSummaries.join('\n\n') + '\n');
  log('\n' + summary);
  inst.close();
  await sleep(8000); // the instructor reads the results, then puts the next code on the screen
}

// ---- the report --------------------------------------------------------------------------------------------------
const tags = ['lobby', 'r1-mid', 'r1-result', 'over'];
const html = `<!doctype html><meta charset="utf-8"><title>Final test</title><style>body{font:14px -apple-system,sans-serif;margin:16px;background:#f6f7f9}h2{margin:24px 0 8px}h3{margin:16px 0 6px}div.g{display:flex;flex-wrap:wrap;gap:6px}figure{margin:0;width:120px}figure img{width:120px;border:1px solid #ccc;border-radius:6px}figcaption{font-size:10px;color:#555}pre{background:#fff;padding:12px;border-radius:8px;white-space:pre-wrap}</style>
<h1>Final test, ${N} students, ${BASE}</h1><pre>${allSummaries.join('\n\n').replace(/</g, '&lt;')}</pre>
${GAME_KEYS.map((k, gi) => `<h2>${presetOf(k).label}</h2>${tags.map(t => `<h3>${t}</h3><div class="g">${students.map(s => `<figure><img src="shots/${gi + 1}-${t}-${String(s.i + 1).padStart(2, '0')}.png" loading="lazy"><figcaption>${s.name} (${s.kind})</figcaption></figure>`).join('')}</div><p>Dashboard:</p><img src="shots/${gi + 1}-${t}-dashboard.png" style="max-width:100%;border:1px solid #ccc">`).join('')}`).join('')}`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
log(`report: ${path.join(OUT, 'index.html')}`);
if (!args.keep) for (const c of codes) await fetch(BASE + `/api/session/${c}`, { method: 'DELETE', headers: { 'x-instructor-key': KEY } }).catch(() => {});
log(args.keep ? 'test games kept on the service' : `test games deleted from the service: ${codes.join(', ')}`);
await browser.close();
process.exit(0);

async function shoot(gi, tag) {
  await Promise.all(students.map(s => withTimeout(s.page.screenshot({ path: path.join(OUT, 'shots', `${gi + 1}-${tag}-${String(s.i + 1).padStart(2, '0')}.png`) }).catch(() => {}), 20000)));
  await withTimeout(dash.screenshot({ path: path.join(OUT, 'shots', `${gi + 1}-${tag}-dashboard.png`), fullPage: true }).catch(() => {}), 20000);
}
