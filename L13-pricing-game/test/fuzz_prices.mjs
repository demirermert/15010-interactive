#!/usr/bin/env node
// Fuzzes the price entry and the round results of the pricing game on a LOCAL server (teaching23-games, 2026-11-08).
// Starts server/server.js on a free port with its own instructor key (no OpenAI key: the AI seat plays the Nash price),
// then runs many games at once, each with a different configuration. Every student sends a stream of payloads a phone
// might (or could never) send: cents, strings, spaces, commas, dollar signs, exponents, hex, empty, null, booleans,
// arrays, objects, Infinity, out of range, -0, absurdly long strings. It checks that
//   - each payload is accepted (priceAccepted with the right number) or refused (errorMessage) exactly as expected;
//   - the price in the results is the last accepted one, or a whole-dollar price inside the bounds when none was;
//   - every result equals a brute-force street (Hotelling) or the logit formula, profit = price x demand, shares add up;
//   - the rival's price in my results is the rival's own (the Nash price for the AI seat);
//   - the instructor's roundSummary has every pair and the leaderboard total is the sum of profits;
//   - GET /session and the CSV agree with what the phones were told; DELETE removes the session;
//   - bad game settings are refused by POST /session with a message, odd-but-fine ones are accepted and normalised;
//   - the server log shows no handler errors or crashes.
//
//   node fuzz_prices.mjs [--quick] [--port 4999] [--keep-db]
//
// Rounds are 4 s (3 s in --quick), breaks 3 s; the whole run takes about a minute. Never points at a live service.

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { io } from 'socket.io-client';
import { nashPrice } from '../server/aiPlayer.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
const QUICK = Boolean(args.quick);
const PORT = Number(args.port || 4999);
const KEY = 'fuzz-local-key';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = `http://127.0.0.1:${PORT}`;
const ROUND_TIME = QUICK ? 3 : 4, BREAK = 3;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); if (!ok) console.log(`FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = (p, opts = {}, withKey = true) => fetch(BASE + '/api' + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(withKey ? { 'x-instructor-key': KEY } : {}), ...(opts.headers || {}) } });

// ---- the truth ----------------------------------------------------------------------------------------------------
const G = 20000;
function truth(pA, pB, c) {
  if (c.modelType === 'logit') {
    const sigma = Math.max(c.sigma, 1e-6);
    const uA = (10 - c.alpha * pA) / sigma, uB = (10 - c.alpha * pB) / sigma, m = Math.max(uA, uB, 0);
    const eA = Math.exp(uA - m), eB = Math.exp(uB - m), e0 = Math.exp(-m);
    return { dA: c.marketSize * eA / (eA + eB + e0), dB: c.marketSize * eB / (eA + eB + e0), tol: 1e-6 * c.marketSize, M: c.marketSize };
  }
  const { travelCost: t, x1, x2, consumerValue: V } = c;
  let a = 0, b = 0;
  for (let i = 0; i < G; i++) {
    const x = (i + 0.5) * (100 / G);
    const uA = V - pA - t * Math.abs(x - x1), uB = V - pB - t * Math.abs(x - x2);
    if (uA < 0 && uB < 0) continue;
    if (Math.abs(uA - uB) < 1e-9) { a += 0.5; b += 0.5; } else if (uA > uB) a++; else b++;
  }
  return { dA: a * 100 / G, dB: b * 100 / G, tol: 100 / G * 4, M: 100 };
}

// ---- payloads a phone might send ----------------------------------------------------------------------------------
// expected(lo, hi, V) -> a number (accepted as that price) or 'reject'
const inRange = (v, lo, hi) => (v >= lo && v <= hi ? v : 'reject');
const cents = v => Math.round(v * 100 + 1e-9) / 100;
const CASES = [
  ['number 35', 35, (lo, hi) => inRange(35, lo, hi)],
  ["string '35'", '35', (lo, hi) => inRange(35, lo, hi)],
  ["string '35.5'", '35.5', (lo, hi) => inRange(35.5, lo, hi)],
  ["string ' 35 ' (spaces)", ' 35 ', (lo, hi) => inRange(35, lo, hi)],
  ["string '35.555' (3 decimals -> cents)", '35.555', (lo, hi) => inRange(35.56, lo, hi)],
  ['number 35.999999 -> 36', 35.999999, (lo, hi) => inRange(36, lo, hi)],
  ["string '1e2' (exponent)", '1e2', (lo, hi) => inRange(100, lo, hi)],
  ["string '0x10' (hex)", '0x10', (lo, hi) => inRange(16, lo, hi)],
  ["string '+35'", '+35', (lo, hi) => inRange(35, lo, hi)],
  ["string '.5'", '.5', (lo, hi) => inRange(0.5, lo, hi)],
  ["string '35.'", '35.', (lo, hi) => inRange(35, lo, hi)],
  ["string '-0' -> 0", '-0', (lo, hi) => inRange(0, lo, hi)],
  ['number 1e-7 -> 0', 1e-7, (lo, hi) => inRange(0, lo, hi)],
  ["string '35,5' (comma)", '35,5', () => 'reject'],
  ["string '$35'", '$35', () => 'reject'],
  ["string 'abc'", 'abc', () => 'reject'],
  ["string '35abc'", '35abc', () => 'reject'],
  ["string '3 5'", '3 5', () => 'reject'],
  ["string '' (empty)", '', () => 'reject'],
  ["string '   ' (blank)", '   ', () => 'reject'],
  ['null', null, () => 'reject'],
  ['no price field', undefined, () => 'reject'],
  ['true', true, () => 'reject'],
  ['false', false, () => 'reject'],
  ['empty array', [], () => 'reject'],
  ['array [35]', [35], () => 'reject'],
  ['object {}', {}, () => 'reject'],
  ['object {price: 35}', { price: 35 }, () => 'reject'],
  ["string 'Infinity'", 'Infinity', () => 'reject'],
  ['Infinity (sent as null)', Infinity, () => 'reject'],
  ['NaN (sent as null)', NaN, () => 'reject'],
  ["string '1e400' (overflows)", '1e400', () => 'reject'],
  ["string '-5'", '-5', () => 'reject'],
  ['arabic-indic digits', '٣٥', () => 'reject'],
  ['100,000-character string', 'a'.repeat(100000), () => 'reject'],
  ['the max', 'MAX', (lo, hi) => hi],
  ['the min', 'MIN', (lo, hi) => lo],
  ['just above the max', 'MAX+', () => 'reject'],
  ['just below the min', 'MIN-', (lo) => (lo > 0 ? 'reject' : 'reject')],
  ['the valuation V', 'V', (lo, hi, V) => inRange(cents(V), lo, hi)],
  ['V - 1', 'V-1', (lo, hi, V) => inRange(cents(V - 1), lo, hi)],
  ['V + 1', 'V+1', (lo, hi, V) => inRange(cents(V + 1), lo, hi)],
  ['190', 190, (lo, hi) => inRange(190, lo, hi)],
  ['200', 200, (lo, hi) => inRange(200, lo, hi)],
  ['150', 150, (lo, hi) => inRange(150, lo, hi)],
  ['47.5', 47.5, (lo, hi) => inRange(47.5, lo, hi)],
  ['0', 0, (lo, hi) => inRange(0, lo, hi)]
];
function materialise(value, lo, hi, V) {
  if (value === 'MAX') return hi;
  if (value === 'MIN') return lo;
  if (value === 'MAX+') return hi + 0.01;
  if (value === 'MIN-') return lo - 0.01;
  if (value === 'V') return V;
  if (value === 'V-1') return V - 1;
  if (value === 'V+1') return V + 1;
  return value;
}

// deterministic pseudo-random per game
const rng = seed => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// ---- a socket client that records what it receives (as in sim_class.mjs) ----------------------------------------
function client(label) {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  const got = {}, waiters = [];
  ['joinedSession', 'sessionUpdate', 'roundStarted', 'priceAccepted', 'roundResults', 'roundSummary', 'nextRoundCountdown',
    'sessionComplete', 'errorMessage', 'submissionProgress', 'opponentInfo', 'chatMessage'].forEach(ev => s.on(ev, p => {
    (got[ev] ||= []).push({ at: Date.now(), p });
    waiters.filter(w => w.event === ev && (!w.pred || w.pred(p))).forEach(w => { w.resolve(p); w.done = true; });
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].done) waiters.splice(i, 1);
  }));
  const until = (event, pred, ms = 20000) => new Promise((resolve, reject) => {
    const hit = (got[event] || []).find(x => !pred || pred(x.p));
    if (hit) return resolve(hit.p);
    const w = { event, pred, resolve };
    waiters.push(w);
    setTimeout(() => { if (!w.done) { w.done = true; reject(new Error(`${label}: no ${event} within ${ms} ms`)); } }, ms);
  });
  const connected = new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); });
  return { label, s, got, until, connected, close: () => s.close() };
}

// send one submitPrice and wait for its answer (the server answers each message in order)
function sendAndWait(c, payload, ms = 4000) {
  return new Promise(resolve => {
    const done = r => { clearTimeout(timer); c.s.off('priceAccepted', onAcc); c.s.off('errorMessage', onErr); resolve(r); };
    const onAcc = p => done({ accepted: p.price, round: p.round });
    const onErr = m => done({ rejected: String(m) });
    const timer = setTimeout(() => done({ timeout: true }), ms);
    c.s.on('priceAccepted', onAcc); c.s.on('errorMessage', onErr);
    c.s.emit('submitPrice', payload);
  });
}

// ---- the games ----------------------------------------------------------------------------------------------------
const H = (travelCost, extra = {}) => ({ modelType: 'hotelling', travelCost, consumerValue: 200, x1: 0, x2: 100, priceBounds: { min: 0, max: 250 }, ...extra });
const GAMES = [
  { name: 'game1 t=1', students: 8, rounds: 3, config: H(1) },
  { name: 'game2 t=0.3', students: 8, rounds: 3, config: H(0.3) },
  { name: 'game3 t=0', students: 8, rounds: 3, config: H(0) },
  { name: 'demo t=0.1 V=100', students: 6, rounds: 3, config: H(0.1, { consumerValue: 100 }) },
  { name: 'inner spots 35/65 t=0.3', students: 8, rounds: 3, config: H(0.3, { x1: 35, x2: 65 }) },
  { name: 'reversed spots 65/35 t=0.3', students: 6, rounds: 3, config: H(0.3, { x1: 65, x2: 35 }) },
  { name: 'same spot 50/50 t=1', students: 6, rounds: 3, config: H(1, { x1: 50, x2: 50 }) },
  { name: 'logit', students: 6, rounds: 3, config: { modelType: 'logit', alpha: 1, sigma: 5, marketSize: 1000, priceBounds: { min: 0, max: 100 } } },
  { name: 'fractional bounds 0.5-20.5', students: 6, rounds: 3, config: H(0.1, { consumerValue: 100, priceBounds: { min: 0.5, max: 20.5 } }) },
  { name: 'huge numbers', students: 4, rounds: 2, config: H(1e6, { consumerValue: 1e9, priceBounds: { min: 0, max: 1e6 } }) },
  { name: 'per-round times, hidden count, chat, odd class', students: 7, rounds: 3, config: H(1, { roundTime: [ROUND_TIME, ROUND_TIME + 1, ROUND_TIME], hideRoundCount: true, enableChat: true, showOpponentName: true }) },
  { name: 'one student vs the AI seat', students: 1, rounds: 2, config: H(0.3) },
  { name: 'big class (120 students)', students: QUICK ? 40 : 120, rounds: 3, config: H(1) },
  { name: 'shortest rounds (3 s)', students: 4, rounds: 2, config: H(1, { roundTime: 3 }) },
  { name: 'min price 10, max 50', students: 4, rounds: 2, config: H(0.5, { priceBounds: { min: 10, max: 50 } }) }
];

async function runGame(g, seed) {
  const rnd = rng(seed);
  const tag = `[${g.name}]`;
  const config = { rounds: g.rounds, roundTime: ROUND_TIME, breakTime: BREAK, ...g.config };
  const lo = config.priceBounds.min, hi = config.priceBounds.max, V = config.consumerValue ?? 100;
  const created = await api('/session', { method: 'POST', body: JSON.stringify({ instructorName: 'Fuzz', sessionName: `fuzz ${g.name}`, config }) });
  const session = await created.json();
  check(`${tag} session created`, created.status === 201 && session.code, `HTTP ${created.status} ${session.error || ''}`);
  if (created.status !== 201) return null;
  const code = session.code;
  const serverConfig = session.config;

  const instr = client('instructor');
  await instr.connected;
  instr.s.emit('joinSession', { sessionCode: code, playerName: 'Fuzz', role: 'instructor', key: KEY });
  await instr.until('joinedSession');
  instr.s.emit('openLobby', { sessionCode: code });
  await instr.until('sessionUpdate', p => p.status === 'lobby');

  const students = [];
  for (let i = 0; i < g.students; i++) {
    const c = client(`S${i + 1}`);
    await c.connected;
    c.name = `Fuzz S${i + 1}`;
    c.s.emit('joinSession', { sessionCode: code, playerName: c.name, role: 'student' });
    const j = await c.until('joinedSession');
    c.studentCode = j.studentCode;
    c.joined = j;
    students.push(c);
  }
  if (config.hideRoundCount) {
    const j = students[0].joined;
    check(`${tag} hidden round count: students are not told the number of rounds or the per-round list`, j.config && j.config.rounds === undefined && !Array.isArray(j.config.roundTime), JSON.stringify({ rounds: j.config?.rounds, roundTime: j.config?.roundTime }));
  }

  instr.s.emit('startSession', { sessionCode: code });
  const running = await instr.until('sessionUpdate', p => p.status === 'running');
  const pairs = running.pairs || [];
  check(`${tag} pairs = ceil(N/2)`, pairs.length === Math.ceil(g.students / 2), `${pairs.length}`);
  const aiNash = nashPrice(serverConfig);

  let mismatches = [], wrongReplies = [], timeouts = 0, forcedBad = [], rivalMismatch = [], leaks = 0;
  const seen = []; // {round, name, price, profit} from the phones, for the CSV check
  for (let round = 1; round <= g.rounds; round++) {
    await Promise.all(students.map(c => c.until('roundStarted', p => p.round === round, (ROUND_TIME + BREAK + 25) * 1000)));
    const rs0 = students[0].got.roundStarted.map(x => x.p).find(p => p.round === round);
    const expectTime = Array.isArray(config.roundTime) ? config.roundTime[round - 1] : config.roundTime;
    if (round === 1 || Array.isArray(config.roundTime)) check(`${tag} round ${round} time announced = ${expectTime}`, rs0.roundTime === expectTime, `${rs0.roundTime}`);

    // every student fires a few payloads; the first student in round 1 only hopeless ones (so a forced price follows)
    const chat = config.enableChat && round === 1;
    await Promise.all(students.map(async (c, i) => {
      const picks = [];
      if (i === 0 && round === 1) picks.push(...CASES.filter(k => k[2](lo, hi, V) === 'reject').slice(0, 6));
      else {
        const n = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) picks.push(CASES[Math.floor(rnd() * CASES.length)]);
        if (rnd() < 0.5) picks.push(CASES[0]); // usually end on a plain number
      }
      c.lastAccepted = null;
      for (const [label, value, expect] of picks) {
        const v = materialise(value, lo, hi, V);
        const payload = value === undefined ? { sessionCode: code } : { sessionCode: code, price: v };
        const want = expect(lo, hi, V);
        const r = await sendAndWait(c, payload);
        if (r.timeout) { timeouts++; continue; }
        if (want === 'reject') {
          if (r.rejected === undefined) wrongReplies.push(`${label}: accepted as ${r.accepted}, expected a refusal`);
          else if (!/numeric|between/.test(r.rejected)) wrongReplies.push(`${label}: refused with an odd message "${r.rejected}"`);
        } else {
          if (r.accepted === undefined) wrongReplies.push(`${label}: refused ("${r.rejected}"), expected ${want}`);
          else if (Math.abs(r.accepted - want) > 1e-9 || Object.is(r.accepted, -0)) wrongReplies.push(`${label}: accepted as ${r.accepted}, expected ${want}`);
          else c.lastAccepted = r.accepted;
        }
      }
    }));
    if (chat) {
      // a chat line reaches the rival only
      const before = students.map(c => (c.got.chatMessage || []).length);
      students[1].s.emit('chatMessage', { sessionCode: code, message: 'hello rival' });
      await sleep(400);
      const after = students.map(c => (c.got.chatMessage || []).length);
      const receivers = students.filter((c, i) => after[i] > before[i]).map(c => c.name);
      check(`${tag} chat line reaches the sender and the rival only`, receivers.length <= 2 && receivers.length >= 1, receivers.join(', '));
    }

    const res = await Promise.all(students.map(c => c.until('roundResults', p => p.round === round, (ROUND_TIME + BREAK + 25) * 1000)));
    students.forEach((c, i) => {
      const r = res[i];
      const side = c.got.roundStarted.map(x => x.p).reverse().find(p => p.round === round)?.side;
      seen.push({ round, name: c.name, price: r.price, profit: r.profit });
      if (c.lastAccepted !== null) {
        if (Math.abs(r.price - c.lastAccepted) > 1e-9) mismatches.push(`round ${round} ${c.name}: result price ${r.price}, last accepted ${c.lastAccepted}`);
      } else if (!(r.price >= lo && r.price <= hi) || (Number.isInteger(lo) && !Number.isInteger(r.price))) forcedBad.push(`round ${round} ${c.name}: forced price ${r.price} (bounds ${lo}-${hi})`);
      const [pa, pb] = side === 'A' ? [r.price, r.opponentPrice] : [r.opponentPrice, r.price];
      const t = truth(pa, pb, serverConfig);
      const my = side === 'A' ? t.dA : t.dB, theirs = side === 'A' ? t.dB : t.dA;
      const bad = [];
      if (Math.abs(my - r.demand) > t.tol) bad.push(`demand ${r.demand.toFixed(3)} vs street ${my.toFixed(3)}`);
      if (Math.abs(r.price * r.demand - r.profit) > 1e-6 * Math.max(1, r.profit)) bad.push(`profit ${r.profit} != price x demand ${r.price * r.demand}`);
      if (Math.abs(r.demand / t.M - r.share) > 1e-9) bad.push(`share ${r.share} vs ${r.demand / t.M}`);
      if (Math.abs(theirs - r.opponentDemand) > t.tol) bad.push(`rival demand ${r.opponentDemand.toFixed(3)} vs street ${theirs.toFixed(3)}`);
      if (Math.abs(r.opponentPrice * r.opponentDemand - r.opponentProfit) > 1e-6 * Math.max(1, r.opponentProfit)) bad.push('rival profit != price x demand');
      if (![r.price, r.demand, r.profit, r.share, r.opponentPrice, r.opponentDemand, r.opponentProfit, r.opponentShare].every(Number.isFinite)) bad.push('non-finite field');
      if (bad.length) mismatches.push(`round ${round} ${c.name} (${side}) prices ${pa}/${pb}: ${bad.join('; ')}`);
      const rival = students.find(o => o.name === r.opponentName);
      if (rival) { if (rival.lastAccepted !== null && Math.abs(r.opponentPrice - rival.lastAccepted) > 1e-9) rivalMismatch.push(`round ${round} ${c.name}: rival ${rival.name} chose ${rival.lastAccepted}, I was told ${r.opponentPrice}`); }
      else if (/AI Player|ChatGPT/.test(r.opponentName || '') && Math.abs(r.opponentPrice - aiNash) > 1e-9) rivalMismatch.push(`round ${round} ${c.name}: AI seat played ${r.opponentPrice}, Nash is ${aiNash}`);
      const summary = (c.got.roundSummary || []).map(x => x.p).find(p => p.round === round);
      if (summary && summary.results) leaks++;
    });
    const sum = await instr.until('roundSummary', p => p.round === round, 20000);
    if (round === 1) {
      check(`${tag} roundSummary has every pair`, (sum.results || []).length === pairs.length, `${(sum.results || []).length} of ${pairs.length}`);
      const total = (sum.results || []).reduce((a, p) => a + p.playerA.profit + p.playerB.profit, 0);
      const lb = (sum.leaderboard || []).reduce((a, p) => a + (p.totalProfit ?? 0), 0);
      check(`${tag} leaderboard total = sum of profits`, Math.abs(total - lb) < 1e-6 * Math.max(1, total), `${total} vs ${lb}`);
    }
  }
  check(`${tag} every payload answered within 4 s`, timeouts === 0, `${timeouts} unanswered`);
  check(`${tag} every payload accepted or refused as expected`, wrongReplies.length === 0, wrongReplies.slice(0, 4).join(' | ') + (wrongReplies.length > 4 ? ` | +${wrongReplies.length - 4}` : ''));
  check(`${tag} results = last accepted price, demand/profit/share = the model, all finite`, mismatches.length === 0, mismatches.slice(0, 3).join(' | ') + (mismatches.length > 3 ? ` | +${mismatches.length - 3}` : ''));
  check(`${tag} forced prices (no submission) are whole dollars inside the bounds`, forcedBad.length === 0, forcedBad.slice(0, 3).join(' | '));
  check(`${tag} the rival's price in my results is what the rival chose (Nash for the AI seat)`, rivalMismatch.length === 0, rivalMismatch.slice(0, 3).join(' | '));
  check(`${tag} students never get other pairs' results`, leaks === 0, `${leaks}`);

  const done = await instr.until('sessionComplete', null, 30000).catch(() => null);
  check(`${tag} sessionComplete after the last round`, Boolean(done));
  const data = await (await api(`/session/${code}`)).json();
  check(`${tag} GET /session has ${g.rounds} rounds`, (data.rounds || []).length === g.rounds, `${(data.rounds || []).length}`);
  const csvRes = await api(`/session/${code}/export`);
  const csv = await csvRes.text();
  const rows = csv.trim().split('\n').slice(1).map(l => l.split(',').map(x => x.replace(/^"|"$/g, '')));
  const players = g.students + (g.students % 2);
  check(`${tag} CSV has ${g.rounds * players} rows`, rows.length === g.rounds * players, `${rows.length}`);
  const csvSet = new Map(rows.map(r => [`${r[0]}|${r[1]}`, { price: Number(r[2]), profit: Number(r[6]) }]));
  const csvBad = seen.filter(s => { const row = csvSet.get(`${s.round}|${s.name}`); return !row || Math.abs(row.price - s.price) > 1e-9 || Math.abs(row.profit - s.profit) > 0.006; });
  check(`${tag} CSV prices and profits = what the phones were told`, csvBad.length === 0, csvBad.slice(0, 3).map(s => `${s.round} ${s.name} ${s.price}`).join(' | '));
  students.forEach(c => c.close()); instr.close();
  const del = await api(`/session/${code}`, { method: 'DELETE' });
  const gone = await api(`/session/${code}`);
  check(`${tag} DELETE removes the session`, del.status === 200 && gone.status === 404, `${del.status} then ${gone.status}`);
  return code;
}

// ---- settings the instructor's form could send ----------------------------------------------------------------
async function settingsChecks() {
  const base = { rounds: 3, roundTime: 30, breakTime: 10, modelType: 'hotelling', travelCost: 1, consumerValue: 200, x1: 0, x2: 100, priceBounds: { min: 0, max: 250 } };
  const bad = [
    ['rounds 0', { rounds: 0 }], ['rounds 3.5', { rounds: 3.5 }], ['rounds 201', { rounds: 201 }], ["rounds 'ten'", { rounds: 'ten' }],
    ['roundTime 1 s', { roundTime: 1 }], ["roundTime 'abc'", { roundTime: 'abc' }], ['roundTime []', { roundTime: [] }], ["roundTime [30,'x']", { roundTime: [30, 'x'] }],
    ['roundTime [30, 2]', { roundTime: [30, 2] }], ['break 1 s', { breakTime: 1 }], ['min = max', { priceBounds: { min: 50, max: 50 } }], ['min > max', { priceBounds: { min: 60, max: 50 } }],
    ['min -1', { priceBounds: { min: -1, max: 50 } }], ['max 2e6', { priceBounds: { min: 0, max: 2e6 } }], ['t -1', { travelCost: -1 }], ["t 'x'", { travelCost: 'x' }],
    ['V 0', { consumerValue: 0 }], ['V <= min price', { consumerValue: 10, priceBounds: { min: 10, max: 50 } }], ['x1 101', { x1: 101 }], ['x2 -5', { x2: -5 }], ["x1 'left'", { x1: 'left' }],
    ['logit sigma 0', { modelType: 'logit', sigma: 0 }], ['logit alpha -1', { modelType: 'logit', alpha: -1 }], ['logit market 0', { modelType: 'logit', marketSize: 0 }]
  ];
  for (const [label, patch] of bad) {
    const r = await api('/session', { method: 'POST', body: JSON.stringify({ instructorName: 'Fuzz', sessionName: 'fuzz bad', config: { ...base, ...patch } }) });
    const body = await r.json();
    check(`[settings] refused: ${label}`, r.status === 400 && typeof body.error === 'string' && body.error.length > 5, `HTTP ${r.status} ${body.error || JSON.stringify(body).slice(0, 80)}`);
    if (r.status === 201) await api(`/session/${body.code}`, { method: 'DELETE' });
  }
  const noName = await api('/session', { method: 'POST', body: JSON.stringify({ sessionName: 'x', config: base }) });
  check('[settings] refused: no instructor name', noName.status === 400);
  const odd = [
    ["numbers as strings ('10' rounds, '60' s, '0.3' t)", { rounds: '10', roundTime: '60', travelCost: '0.3' }, c => c.rounds === 10 && c.roundTime === 60 && c.travelCost === 0.3],
    ['per-round list shorter than rounds is padded', { rounds: 4, roundTime: [40, 30] }, c => JSON.stringify(c.roundTime) === '[40,30,30,30]'],
    ['per-round list longer than rounds is cut', { rounds: 2, roundTime: [40, 30, 20] }, c => JSON.stringify(c.roundTime) === '[40,30]'],
    ['x1 > x2 allowed', { x1: 100, x2: 0 }, c => c.x1 === 100 && c.x2 === 0], ['t = 0 allowed', { travelCost: 0 }, c => c.travelCost === 0],
    ['unknown model type -> hotelling', { modelType: 'cournot' }, c => c.modelType === 'hotelling'],
    ['missing fields -> defaults', { rounds: undefined, roundTime: undefined, breakTime: undefined }, c => c.rounds === 10 && c.roundTime === 30 && c.breakTime === 10]
  ];
  for (const [label, patch, ok] of odd) {
    const r = await api('/session', { method: 'POST', body: JSON.stringify({ instructorName: 'Fuzz', sessionName: 'fuzz odd', config: { ...base, ...patch } }) });
    const body = await r.json();
    check(`[settings] accepted and normalised: ${label}`, r.status === 201 && ok(body.config || {}), `HTTP ${r.status} ${body.error || JSON.stringify(body.config || {}).slice(0, 120)}`);
    if (r.status === 201) await api(`/session/${body.code}`, { method: 'DELETE' });
  }
}

// ---- main -----------------------------------------------------------------------------------------------------
const dbFiles = () => fs.readdirSync(path.join(ROOT, 'server')).filter(f => f.startsWith('game_sessions.db'));
const hadDb = dbFiles().length > 0;
const serverLog = [];
const server = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), INSTRUCTOR_KEY: KEY, OPENAI_API_KEY: '', OPENAI_BASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', d => serverLog.push(...String(d).split('\n').filter(Boolean)));
server.stderr.on('data', d => serverLog.push(...String(d).split('\n').filter(Boolean)));
let up = false;
for (let i = 0; i < 50 && !up; i++) { await sleep(200); up = await fetch(BASE + '/health').then(r => r.ok).catch(() => false); }
if (!up) { console.error('server did not start:\n' + serverLog.join('\n')); server.kill(); process.exit(1); }
console.log(`server up on ${BASE}; running ${GAMES.length} games at once (${QUICK ? 'quick' : 'full'})`);
const t0 = Date.now();
try {
  await settingsChecks();
  await Promise.all(GAMES.map((g, i) => runGame(g, 1000 + i).catch(err => check(`[${g.name}] run finished without an exception`, false, err.message))));
} finally {
  server.kill();
  await sleep(300);
  const errors = serverLog.filter(l => /UNCAUGHT|UNHANDLED|handler error|non-finite|TypeError|ReferenceError|Error:/.test(l) && !/OpenAI/.test(l));
  check('server log has no handler errors or crashes', errors.length === 0, errors.slice(0, 3).join(' | '));
  if (!hadDb && !args['keep-db']) dbFiles().forEach(f => fs.unlinkSync(path.join(ROOT, 'server', f)));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)} s${failed.length ? '; FAILED:\n  ' + failed.map(f => f.name + (f.detail ? '  (' + f.detail + ')' : '')).join('\n  ') : ''}`);
  process.exit(failed.length ? 1 : 0);
}
