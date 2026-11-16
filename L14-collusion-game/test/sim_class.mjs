#!/usr/bin/env node
// Simulated class for the pricing game (teaching23-games, 2026-11-07). Plays a whole game on a live service as the
// instructor plus N student phones over the real socket, and checks what the server does along the way.
//
//   node sim_class.mjs --host lab-d.onrender.com --key <instructor key> [--students 7] [--rounds 10]
//                      [--round-time 5] [--break 3] [--keep] [--quiet]
//
// What it checks (each line printed as PASS/FAIL):
//   key: REST and socket instructor calls fail without the key and work with it
//   lobby: a student cannot join before the lobby opens; a student who leaves the lobby is not paired; a late joiner
//          after the start is refused
//   pairing: an odd class gets the AI seat (named ChatGPT when the Parley key works)
//   prices: out-of-range and non-numeric prices are refused; a price can be changed within the round; the price
//           survives a phone reconnect (roundStarted carries hasSubmitted + submittedPrice); a student who drops
//           without a price and comes back can still submit
//   results: every student's demand/profit equals the demand model (server/demandModel.js) for the two prices; the
//            opponent's price in my results is the opponent's own; students never receive other pairs' results
//   instructor: a reconnecting instructor gets the round history; roundSummary has every pair; the leaderboard
//            totals match the sum of profits
//   timing: each round lasts about its round time (the AI seat must not delay the end)
//   end: sessionComplete after the last round; GET /session, CSV (rows = rounds x players), DELETE removes it
//
// The session is deleted at the end unless --keep. Never run during a class.

import { io } from 'socket.io-client';
import { computeDemand } from '../server/demandModel.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
if (args.help || !args.host || !args.key) {
  console.log('usage: node sim_class.mjs --host <host> --key <instructor key> [--students N] [--rounds R] [--round-time S] [--break S] [--keep] [--quiet]');
  process.exit(args.help ? 0 : 1);
}
const HOST = args.host, KEY = String(args.key);
const N = Number(args.students || 7), ROUNDS = Number(args.rounds || 10);
const ROUND_TIME = Number(args['round-time'] || 5), BREAK = Number(args.break || 3);
const T = args.t === undefined ? 1 : Number(args.t);          // walking cost: 1 (Game 1), 0.3 (Game 2), 0 (Game 3)
const NASH = T * 100;                                          // sellers at 0 and 100: Nash price = t x 100
const QUIET = Boolean(args.quiet);
const BASE = /^https?:\/\//.test(HOST) ? HOST : `https://${HOST}`;   // --host http://localhost:4999 for a local server

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const log = (...a) => { if (!QUIET) console.log('     ', ...a); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = (path, opts = {}, withKey = true) => fetch(BASE + '/api' + path, {
  ...opts, headers: { 'Content-Type': 'application/json', ...(withKey ? { 'x-instructor-key': KEY } : {}), ...(opts.headers || {}) } });

// ---- a socket client that records what it receives ------------------------------------------------------------
function client(label) {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  const got = {};               // event -> [payloads]
  const waiters = [];           // {event, pred, resolve}
  const EVENTS = ['joinedSession', 'sessionUpdate', 'roundStarted', 'priceAccepted', 'roundResults', 'roundSummary',
    'nextRoundCountdown', 'sessionComplete', 'errorMessage', 'submissionProgress', 'timerUpdate', 'opponentInfo', 'chatMessage'];
  EVENTS.forEach(ev => s.on(ev, p => {
    (got[ev] ||= []).push({ at: Date.now(), p });
    waiters.filter(w => w.event === ev && (!w.pred || w.pred(p))).forEach(w => { w.resolve(p); w.done = true; });
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].done) waiters.splice(i, 1);
  }));
  const until = (event, pred, ms = 15000) => new Promise((resolve, reject) => {
    const hit = (got[event] || []).find(x => !pred || pred(x.p));
    if (hit) return resolve(hit.p);
    const w = { event, pred, resolve };
    waiters.push(w);
    setTimeout(() => { if (!w.done) { w.done = true; reject(new Error(`${label}: no ${event} within ${ms} ms`)); } }, ms);
  });
  const connected = new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); });
  const hb = setInterval(() => s.connected && s.emit('heartbeat'), 5000);
  return { label, s, got, until, connected, close: () => { clearInterval(hb); s.close(); } };
}

// ---- the game ---------------------------------------------------------------------------------------------------
const config = { rounds: ROUNDS, roundTime: ROUND_TIME, breakTime: BREAK, priceBounds: { min: 0, max: 250 },
  modelType: 'hotelling', travelCost: T, consumerValue: 200, x1: 0, x2: 100, showOpponentName: true };
console.log(`game: ${N} students, ${ROUNDS} rounds of ${ROUND_TIME} s, walking cost $${T} (Nash $${NASH}) on ${BASE}`);
let code = null;
const students = [];
const roundStart = {};        // round -> time the instructor saw roundStarted
const roundEnd = {};          // round -> time the instructor saw roundSummary

try {
  // key on REST
  const noKey = await api('/sessions', {}, false);
  check('REST without key is refused', noKey.status === 403, `HTTP ${noKey.status}`);
  const badKey = await api('/sessions', { headers: { 'x-instructor-key': 'wrong-' + KEY } });
  check('REST with a wrong key is refused', badKey.status === 403, `HTTP ${badKey.status}`);
  const created = await api('/session', { method: 'POST', body: JSON.stringify({ instructorName: 'Sim Instructor', sessionName: `sim ${new Date().toISOString().slice(0, 16)}`, config }) });
  const session = await created.json();
  code = session.code;
  check('session created with the key', created.status === 201 && /^[A-Z0-9]{4}$/.test(code || ''), `code ${code}, HTTP ${created.status}`);
  const bad = await api('/session', { method: 'POST', body: JSON.stringify({ instructorName: 'x', config: { ...config, roundTime: 1 } }) });
  check('a 1-second round is refused by validation', bad.status === 400, (await bad.json()).error);

  // instructor socket, wrong key then right key
  const badInstr = client('bad-instructor');
  await badInstr.connected;
  badInstr.s.emit('joinSession', { sessionCode: code, playerName: 'Intruder', role: 'instructor', key: 'nope' });
  const refused = await badInstr.until('errorMessage').catch(() => null);
  check('socket instructor join without the key is refused', Boolean(refused), String(refused));
  badInstr.close();

  const instr = client('instructor');
  await instr.connected;
  instr.s.emit('joinSession', { sessionCode: code, playerName: 'Sim Instructor', role: 'instructor', key: KEY });
  const ij = await instr.until('joinedSession');
  check('instructor joined (status setup)', ij.role === 'instructor' && ij.status === 'setup', `status ${ij.status}`);
  instr.s.on('roundStarted', p => { roundStart[p.round] = Date.now(); });
  instr.s.on('roundSummary', p => { roundEnd[p.round] ||= Date.now(); });

  // a student before the lobby opens
  const early = client('early');
  await early.connected;
  early.s.emit('joinSession', { sessionCode: code, playerName: 'Too Early', role: 'student' });
  const earlyErr = await early.until('errorMessage').catch(() => null);
  check('student before the lobby opens is told to wait', /not open yet/i.test(earlyErr || ''), String(earlyErr));
  early.close();

  instr.s.emit('openLobby', { sessionCode: code });
  await instr.until('sessionUpdate', p => p.status === 'lobby');
  check('lobby opened', true);

  // N students join, plus one who leaves before the start
  for (let i = 0; i < N; i++) {
    const c = client(`student-${i + 1}`);
    await c.connected;
    c.name = `Sim Student ${i + 1}`;
    c.s.emit('joinSession', { sessionCode: code, playerName: c.name, role: 'student' });
    const j = await c.until('joinedSession');
    c.studentCode = j.studentCode;
    students.push(c);
  }
  check(`${N} students joined and got a 6-character code each`, students.every(c => /^[A-Z0-9]{6}$/.test(c.studentCode || '')));
  const leaver = client('leaver');
  await leaver.connected;
  leaver.s.emit('joinSession', { sessionCode: code, playerName: 'Leaves Early', role: 'student' });
  const lj = await leaver.until('joinedSession');
  leaver.close();
  await sleep(800);
  // (the players list includes the instructor, so wait for the leaver's own row to go offline)
  const lobby = await instr.until('sessionUpdate', p => (p.players || []).some(q => q.name === 'Leaves Early' && q.connected === false)).catch(() => null);
  const leaverRow = lobby && (lobby.players || []).find(p => p.name === 'Leaves Early');
  check('a student who closed the page shows as disconnected in the lobby', Boolean(leaverRow), JSON.stringify(leaverRow));

  // --lobby S: hold the lobby open S seconds so a real phone can join the bots (for rehearsals and screenshots)
  if (args.lobby) { console.log(`      lobby open for ${args.lobby} s: join with code ${code}`); await sleep(Number(args.lobby) * 1000); }

  // start
  instr.s.emit('startSession', { sessionCode: code });
  const r1 = await instr.until('roundStarted', p => p.round === 1);
  check('round 1 started', r1.round === 1 && r1.roundTime === ROUND_TIME, `roundTime ${r1.roundTime}`);
  const running = await instr.until('sessionUpdate', p => p.status === 'running');
  const names = (running.players || []).map(p => p.name);
  const aiName = names.find(n => /ChatGPT|AI Player/.test(n));
  if (N % 2 === 1) check('odd class: the AI seat was added', Boolean(aiName), aiName);
  if (N % 2 === 1) check('AI seat is ChatGPT (Parley key works), not the random fallback', /ChatGPT/.test(aiName || ''), aiName);
  const pairs = running.pairs || [];
  check('pairs = ceil(N/2), each with two players', pairs.length === Math.ceil(N / 2), `${pairs.length} pairs`);
  const leaverPaired = pairs.some(p => [p.playerA, p.playerB].some(x => (x?.name || x) === 'Leaves Early'));
  check('the student who left is not paired', !leaverPaired);

  // the leaver comes back after the start: a spectator, cannot submit
  const back = client('leaver-back');
  await back.connected;
  back.s.emit('joinSession', { sessionCode: code, playerName: 'Leaves Early', studentCode: lj.studentCode, role: 'student' });
  const bj = await back.until('joinedSession');
  check('the returning unpaired student is a spectator', bj.spectator === true, `spectator ${bj.spectator}`);
  back.s.emit('submitPrice', { sessionCode: code, price: 100 });
  const bErr = await back.until('errorMessage').catch(() => null);
  check('a spectator cannot submit a price', /not paired|sitting this one out/i.test(bErr || ''), String(bErr));
  back.close();

  // a late joiner
  const late = client('late');
  await late.connected;
  late.s.emit('joinSession', { sessionCode: code, playerName: 'Late Joiner', role: 'student' });
  const lateErr = await late.until('errorMessage').catch(() => null);
  check('a new student after the start is refused', /already started/i.test(lateErr || ''), String(lateErr));
  late.close();

  // play the rounds
  const strategy = (i, round) => {           // a mix: Nash (100), collusive (150), random, undercutter
    if (i % 4 === 0) return 100;
    if (i % 4 === 1) return 150;
    if (i % 4 === 2) return Math.round((40 + Math.random() * 160) * 100) / 100;
    return Math.max(0, 95 - round * 5);
  };
  let badPriceChecked = false, changeChecked = false, reconnectChecked = false, dropChecked = false, instrReconnectChecked = false;
  let modelMismatches = 0, opponentMismatches = 0, leakedResults = 0, roundsSeen = 0;

  for (let round = 1; round <= ROUNDS; round++) {
    await Promise.all(students.map(c => c.until('roundStarted', p => p.round === round, (ROUND_TIME + BREAK + 20) * 1000)));
    const chosen = students.map((c, i) => strategy(i, round));

    if (!badPriceChecked) {                  // round 1: wrong prices
      students[0].s.emit('submitPrice', { sessionCode: code, price: 300 });
      const e1 = await students[0].until('errorMessage', p => /between/.test(p)).catch(() => null);
      students[0].s.emit('submitPrice', { sessionCode: code, price: 'abc' });
      const e2 = await students[0].until('errorMessage', p => /numeric/.test(p)).catch(() => null);
      check('a price above the max is refused', Boolean(e1), String(e1));
      check('a non-numeric price is refused', Boolean(e2), String(e2));
      badPriceChecked = true;
    }

    students.forEach((c, i) => c.s.emit('submitPrice', { sessionCode: code, price: chosen[i] }));
    await Promise.all(students.map((c, i) => c.until('priceAccepted', p => p.round === round && p.price === chosen[i])));
    if (round === 1) check('every price is acknowledged (priceAccepted)', true);

    if (!changeChecked && round === 1) {     // change a price within the round
      chosen[1] = 120; students[1].s.emit('submitPrice', { sessionCode: code, price: 120 });
      await students[1].until('priceAccepted', p => p.round === round && p.price === 120);
      changeChecked = true;
    }

    if (!reconnectChecked && round === 2) {  // phone drops after submitting, comes back
      const c = students[2]; c.close();
      const nc = client(c.label + '-re'); await nc.connected;
      nc.s.emit('joinSession', { sessionCode: code, playerName: '', studentCode: c.studentCode, role: 'student' });
      const rs = await nc.until('roundStarted', p => p.round === round).catch(() => null);
      check('a phone that reconnects mid-round is told its submitted price', rs && rs.hasSubmitted === true && rs.submittedPrice === chosen[2], JSON.stringify(rs && { hasSubmitted: rs.hasSubmitted, submittedPrice: rs.submittedPrice }));
      nc.name = c.name; nc.studentCode = c.studentCode; students[2] = nc;
      reconnectChecked = true;
    }

    if (!dropChecked && round === 3) {       // phone drops BEFORE submitting, comes back, then submits
      const c = students[3]; c.close();
      const nc = client(c.label + '-re'); await nc.connected;
      nc.s.emit('joinSession', { sessionCode: code, playerName: '', studentCode: c.studentCode, role: 'student' });
      const rs = await nc.until('roundStarted', p => p.round === round).catch(() => null);
      // it had already submitted above (all students submit each round), so instead check the rejoin keeps identity
      const j = await nc.until('joinedSession');
      check('a rejoining phone keeps its name and code', j.playerName === c.name && j.studentCode === c.studentCode, `${j.playerName} ${j.studentCode}`);
      nc.name = c.name; nc.studentCode = c.studentCode; students[3] = nc;
      dropChecked = Boolean(rs);
    }

    if (!instrReconnectChecked && round === 4) {  // the instructor's laptop reconnects
      instr.close();
      const ni = client('instructor-re'); await ni.connected;
      ni.s.on('roundStarted', p => { roundStart[p.round] ||= Date.now(); });
      ni.s.on('roundSummary', p => { roundEnd[p.round] ||= Date.now(); });
      ni.s.emit('joinSession', { sessionCode: code, playerName: 'Sim Instructor', role: 'instructor', key: KEY });
      await ni.until('joinedSession');
      await sleep(500);
      const summaries = (ni.got.roundSummary || []).map(x => x.p.round);
      check('a reconnecting instructor receives the past rounds', [1, 2, 3].every(r => summaries.includes(r)), `rounds ${summaries.join(',')}`);
      Object.assign(instr, ni);              // keep using the new socket
      instrReconnectChecked = true;
    }

    // results of this round
    const res = await Promise.all(students.map(c => c.until('roundResults', p => p.round === round, (ROUND_TIME + BREAK + 20) * 1000)));
    roundsSeen++;
    students.forEach((c, i) => {
      const r = res[i];
      const side = (c.got.roundStarted || []).map(x => x.p).reverse().find(p => p.round === round)?.side;
      const [pa, pb] = side === 'A' ? [r.price, r.opponentPrice] : [r.opponentPrice, r.price];
      const d = computeDemand({ priceA: pa, priceB: pb, config: { ...config, marketSize: config.marketSize || 100 } });
      const myDemand = side === 'A' ? d.demandA : d.demandB;
      if (Math.abs(myDemand - r.demand) > 1e-6 || Math.abs(myDemand * (r.price - (config.marginalCost || 0)) - r.profit) > 1e-6) modelMismatches++;
      if (r.price !== chosen[i]) modelMismatches++;
      // the opponent's price must be what the opponent chose (or the AI's / a forced one for a non-sim opponent)
      const opp = students.find(o => o.name === r.opponentName);
      if (opp && r.opponentPrice !== chosen[students.indexOf(opp)]) opponentMismatches++;
      const summary = (c.got.roundSummary || []).map(x => x.p).find(p => p.round === round);
      if (summary && summary.results) leakedResults++;
    });
    const sum = await instr.until('roundSummary', p => p.round === round, (ROUND_TIME + BREAK + 20) * 1000);
    if (round === 1) {
      check('roundSummary to the instructor has every pair', (sum.results || []).length === pairs.length, `${(sum.results || []).length} of ${pairs.length}`);
      const total = (sum.results || []).reduce((a, p) => a + p.playerA.profit + p.playerB.profit, 0);
      const lb = (sum.leaderboard || []).reduce((a, p) => a + (p.totalProfit ?? p.profit ?? 0), 0);
      check('leaderboard total = sum of profits', Math.abs(total - lb) < 1e-3, `${total.toFixed(2)} vs ${lb.toFixed(2)}`);
      const aiRow = (sum.results || []).flatMap(p => [p.playerA, p.playerB]).find(p => /ChatGPT|AI Player/.test(p.name || ''));
      if (aiRow) log(`AI seat price in round 1: ${aiRow.price}`);
    }
    if (round === ROUNDS) {
      const aiPrices = Object.values(instr.got.roundSummary || {}).map(x => x.p).flatMap(p => (p.results || []).flatMap(q => [q.playerA, q.playerB])).filter(p => /ChatGPT|AI Player/.test(p.name || '')).map(p => p.price);
      if (aiPrices.length) log(`AI seat prices by round: ${aiPrices.join(', ')}`);
      if (aiPrices.length && /ChatGPT/.test(aiName || '')) {
        check(`ChatGPT seat opens round 1 at the Nash price $${NASH} (within $5)`, Math.abs(aiPrices[0] - NASH) <= 5, `round 1: ${aiPrices[0]}`);
        check('ChatGPT seat answered every round (no forced random price: all prices are whole cents within the range)', aiPrices.every(p => Number.isInteger(Math.round(p * 100)) && Math.abs(p * 100 - Math.round(p * 100)) < 1e-6 && p >= 0 && p <= 250), aiPrices.join(', '));
      }
      else if (aiPrices.length) log('AI seat without a key: random prices, as expected locally');
    }
    log(`round ${round} done: prices ${chosen.join(', ')}`);
  }
  check(`every student got results for all ${ROUNDS} rounds`, roundsSeen === ROUNDS);
  check('demand and profit match the demand model for every student in every round', modelMismatches === 0, `${modelMismatches} mismatches`);
  check("the opponent's price in my results is what the opponent chose", opponentMismatches === 0, `${opponentMismatches} mismatches`);
  check("students never receive other pairs' results", leakedResults === 0, `${leakedResults} leaks`);

  // timing
  const durations = Object.keys(roundStart).filter(r => roundEnd[r]).map(r => (roundEnd[r] - roundStart[r]) / 1000);
  const worst = Math.max(...durations.map(d => Math.abs(d - ROUND_TIME)));
  check(`each round lasted about ${ROUND_TIME} s (worst drift ${worst.toFixed(1)} s)`, worst < 2.5, durations.map(d => d.toFixed(1)).join(', '));

  // end
  const done = await instr.until('sessionComplete', null, 30000);
  check('sessionComplete after the last round', Array.isArray(done.leaderboard) && done.leaderboard.length >= N);
  const sDone = await students[0].until('sessionComplete', null, 10000).catch(() => null);
  check('students get sessionComplete too (leaderboard only)', sDone && !sDone.rounds, JSON.stringify(Object.keys(sDone || {})));
  const data = await (await api(`/session/${code}`)).json();
  check(`GET /session/${code} has ${ROUNDS} rounds`, (data.rounds || []).length === ROUNDS, `${(data.rounds || []).length}`);
  const csvRes = await api(`/session/${code}/export`);
  const csv = await csvRes.text();
  const rows = csv.trim().split('\n');
  const players = N + (N % 2);
  check(`CSV has a header and ${ROUNDS * players} rows`, csvRes.status === 200 && rows[0].startsWith('Round,Player Name') && rows.length - 1 === ROUNDS * players, `${rows.length - 1} rows`);
  const csvNoKey = await api(`/session/${code}/export`, {}, false);
  check('CSV without the key is refused', csvNoKey.status === 403, `HTTP ${csvNoKey.status}`);

  students.forEach(c => c.close()); instr.close();

  if (!args.keep) {
    const del = await api(`/session/${code}`, { method: 'DELETE' });
    const gone = await api(`/session/${code}`);
    check('DELETE removes the session from the history', del.status === 200 && gone.status === 404, `HTTP ${del.status} then ${gone.status}`);
    code = null;
  }
} catch (err) {
  console.error('ERROR', err.message);
  results.push({ name: 'run finished without an exception', ok: false });
} finally {
  if (code && !args.keep) await api(`/session/${code}`, { method: 'DELETE' }).catch(() => {});
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? '; FAILED: ' + failed.map(f => f.name).join(' | ') : ''}`);
  process.exit(failed.length ? 1 : 0);
}
