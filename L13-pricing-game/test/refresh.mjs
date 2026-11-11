#!/usr/bin/env node
// What happens when students refresh, lose wifi, open a second tab or come back late (teaching23-games, 2026-11-08).
// Starts its own server on port 4997 and plays three short games at once; each "refresh" closes the student's socket
// and joins again from a new one with the student's personal code, as the page does on reload.
//
//   node test/refresh.mjs
//
// Scenarios: refresh in the lobby (with the stored name, with the code only, with the wrong name, five times in one
// second); refresh mid-round before and after submitting (the remaining time, the submitted price and the seat must
// come back; a price sent after the refresh must count); refresh in the break; a phone offline across a whole round;
// a phone dark when the game starts (paired anyway, plays when it wakes); a duplicate seat (same name, offline) dropped
// at the start; a brand-new student after the start; the same personal link open in two tabs; the instructor
// refreshing mid-game; a reload in flight at the start; a refresh after the game is over (history comes back).

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { io } from 'socket.io-client';

const PORT = 4997;
const KEY = 'refresh-local-key';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = `http://127.0.0.1:${PORT}`;
const ROUND = 6, BREAK = 3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); if (!ok) console.log(`FAIL  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const api = (p, opts = {}) => fetch(BASE + '/api' + p, { ...opts, headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY, ...(opts.headers || {}) } });

function client(label) {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  const got = {}, waiters = [];
  ['joinedSession', 'sessionUpdate', 'roundStarted', 'priceAccepted', 'roundResults', 'roundSummary', 'nextRoundCountdown',
    'sessionComplete', 'errorMessage', 'submissionProgress', 'opponentInfo', 'timerUpdate'].forEach(ev => s.on(ev, p => {
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
  const last = ev => (got[ev] || []).slice(-1)[0]?.p;
  const connected = new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); });
  return { label, s, got, until, last, connected, close: () => s.close() };
}

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

// join as a brand-new student and come back with the personal code (what the page stores in the address)
async function joinNew(code, name) {
  const c = client(name);
  await c.connected;
  c.s.emit('joinSession', { sessionCode: code, playerName: name, role: 'student' });
  const j = await c.until('joinedSession', null, 5000);
  return { ...c, name, studentCode: j.studentCode, joined: j };
}
// the reload: the old socket goes away, a new one joins with the personal code (and the stored name, unless expired)
async function refresh(c, { withName = true, name = c.name, closeOld = true, waitJoin = true } = {}) {
  if (closeOld) c.close();
  const n = client(`${c.name} (refreshed)`);
  await n.connected;
  n.s.emit('joinSession', { sessionCode: c.code, playerName: withName ? name : '', studentCode: c.studentCode, role: 'student' });
  const out = { ...n, name: c.name, studentCode: c.studentCode, code: c.code };
  if (waitJoin) out.joined = await n.until('joinedSession', null, 5000);
  return out;
}

async function newSession(name, config) {
  const res = await api('/session', { method: 'POST', body: JSON.stringify({ instructorName: 'Refresh test', sessionName: name, config: { rounds: 3, roundTime: ROUND, breakTime: BREAK, modelType: 'hotelling', travelCost: 1, consumerValue: 200, x1: 0, x2: 100, priceBounds: { min: 0, max: 250 }, ...config } }) });
  const body = await res.json();
  if (res.status !== 201) throw new Error('create failed: ' + JSON.stringify(body));
  const inst = client('instructor');
  await inst.connected;
  inst.s.emit('joinSession', { sessionCode: body.code, playerName: 'Refresh test', role: 'instructor', key: KEY });
  await inst.until('joinedSession');
  inst.s.emit('openLobby', { sessionCode: body.code });
  await inst.until('sessionUpdate', p => p.status === 'lobby');
  return { code: body.code, inst };
}
const studentsIn = p => (p.players || []).filter(q => q.role === 'student');

// ---- game 1: refreshes in the lobby, mid-round, in the break, across a round, after the end ------------------------
async function game1() {
  const T = '[game1]';
  const { code, inst } = await newSession('refresh 1', {});
  let A = { ...await joinNew(code, 'Ann'), code }, B = { ...await joinNew(code, 'Bob'), code };
  let C = { ...await joinNew(code, 'Cem'), code }, D = { ...await joinNew(code, 'Dee'), code };
  check(`${T} every student has a personal code`, [A, B, C, D].every(x => /^[A-Z0-9]{6}$/.test(x.studentCode || '')), [A, B, C, D].map(x => x.studentCode).join(','));

  // lobby: Ann reloads with her stored name, Bob with the code only (storage expired), Cem with the wrong name, Dee five times
  A = await refresh(A);
  check(`${T} lobby reload with the stored name keeps the seat`, A.joined.studentCode === A.studentCode && A.joined.playerName === 'Ann' && A.joined.status === 'lobby', JSON.stringify(A.joined));
  B = await refresh(B, { withName: false });
  check(`${T} lobby reload with the code only gets the old name back`, B.joined.studentCode === B.studentCode && B.joined.playerName === 'Bob', JSON.stringify(B.joined));
  const wrong = await refresh(C, { name: 'Someone Else', waitJoin: false });
  const err = await wrong.until('errorMessage', null, 3000).catch(() => null);
  check(`${T} the wrong name with a personal code is refused`, typeof err === 'string' && /name does not match/i.test(err), String(err));
  wrong.close();
  C = await refresh(C, { closeOld: false });
  check(`${T} after the refusal the right name still rejoins`, C.joined.studentCode === C.studentCode, JSON.stringify(C.joined));
  for (let i = 0; i < 5; i++) D = await refresh(D);
  check(`${T} five reloads in a row keep one seat`, D.joined.studentCode === D.studentCode && D.joined.playerName === 'Dee');
  await sleep(300);
  const roster = studentsIn(inst.last('sessionUpdate'));
  check(`${T} the instructor sees four students, all online, no duplicates`, roster.length === 4 && roster.every(p => p.connected), roster.map(p => `${p.name}:${p.connectionStatus}`).join(' '));
  check(`${T} students see a count of four`, A.last('sessionUpdate')?.playerCount === 4, String(A.last('sessionUpdate')?.playerCount));

  // round 1
  inst.s.emit('startSession', { sessionCode: code });
  const r1 = await Promise.all([A, B, C, D].map(x => x.until('roundStarted', p => p.round === 1)));
  check(`${T} round 1 reaches all four reloaded sockets with a seat`, r1.every(p => p.round === 1 && ['A', 'B'].includes(p.side)), JSON.stringify(r1.map(p => p.side)));
  const sides = Object.fromEntries([A, B, C, D].map((x, i) => [x.name, r1[i].side]));
  // Ann submits, then reloads: her price must come back
  const accA = await sendAndWait(A, { sessionCode: code, price: 50 });
  check(`${T} Ann's price accepted`, accA.accepted === 50, JSON.stringify(accA));
  A = await refresh(A);
  const rsA = await A.until('roundStarted', p => p.round === 1, 3000);
  check(`${T} reload after submitting: round 1 comes back with the price in`, rsA.hasSubmitted === true && rsA.submittedPrice === 50 && rsA.side === sides.Ann && rsA.roundTime <= ROUND && rsA.roundTime >= 1 && rsA.fullTime === ROUND, JSON.stringify(rsA));
  // Bob reloads before submitting, then submits from the new socket
  B = await refresh(B);
  const rsB = await B.until('roundStarted', p => p.round === 1, 3000);
  check(`${T} reload before submitting: round 1 comes back open, no price, time remaining`, rsB.hasSubmitted === false && rsB.submittedPrice === null && rsB.side === sides.Bob && rsB.roundTime <= ROUND && rsB.roundTime >= 1, JSON.stringify(rsB));
  const accB = await sendAndWait(B, { sessionCode: code, price: 60 });
  check(`${T} a price sent after the reload is accepted`, accB.accepted === 60, JSON.stringify(accB));
  // Cem reloads twice quickly, then submits; Dee submits, reloads, submits again
  C = await refresh(C); C = await refresh(C);
  await C.until('roundStarted', p => p.round === 1, 3000);
  const accC = await sendAndWait(C, { sessionCode: code, price: 70 });
  check(`${T} price after two quick reloads accepted`, accC.accepted === 70, JSON.stringify(accC));
  await sendAndWait(D, { sessionCode: code, price: 80 });
  D = await refresh(D);
  await D.until('roundStarted', p => p.round === 1, 3000);
  const accD2 = await sendAndWait(D, { sessionCode: code, price: 90 });
  check(`${T} a second price after a reload replaces the first`, accD2.accepted === 90, JSON.stringify(accD2));
  const prog = await D.until('submissionProgress', p => p.submitted === 4, 3000).catch(() => null);
  check(`${T} the instructor's count shows 4 of 4 prices in`, prog?.submitted === 4 && prog?.total === 4, JSON.stringify(prog));

  const res1 = await Promise.all([A, B, C, D].map(x => x.until('roundResults', p => p.round === 1, ROUND * 1000 + 4000)));
  const want = { Ann: 50, Bob: 60, Cem: 70, Dee: 90 };
  check(`${T} round 1 results reach the four current sockets with the prices they sent`, [A, B, C, D].every((x, i) => res1[i].price === want[x.name]), JSON.stringify(res1.map(r => r.price)));
  const byName = Object.fromEntries([A, B, C, D].map((x, i) => [x.name, res1[i]]));
  const partnersOk = [A, B, C, D].every(x => { const r = byName[x.name]; return r.opponentPrice === want[r.opponentName]; });
  check(`${T} each result names the partner and carries the partner's price`, partnersOk, JSON.stringify(Object.values(byName).map(r => [r.price, r.opponentName, r.opponentPrice])));
  check(`${T} profits are consistent in each pair (same demand model)`, [A, B, C, D].every(x => { const r = byName[x.name]; const o = byName[r.opponentName]; return o && Math.abs(r.profit - o.opponentProfit) < 1e-6 && Math.abs(r.demand - o.opponentDemand) < 1e-6; }));

  // break: Ann reloads between rounds
  A = await refresh(A);
  const brRes = await A.until('roundResults', p => p.round === 1, 2000).catch(() => null);
  check(`${T} reload in the break brings back the round 1 result and history`, brRes && brRes.price === 50 && brRes.history?.length === 1, JSON.stringify(brRes && [brRes.price, brRes.history?.length]));
  const stray = (A.got.roundStarted || []).find(x => x.p.round === 1);
  check(`${T} reload in the break does not reopen round 1`, !stray, JSON.stringify(stray?.p));
  const r2 = await A.until('roundStarted', p => p.round === 2, BREAK * 1000 + 3000);
  check(`${T} round 2 reaches the socket reloaded in the break`, r2.round === 2 && r2.side === sides.Ann && r2.roundTime === ROUND, JSON.stringify(r2));

  // round 2: Bob's phone is off for the whole round; the others play
  B.close();
  await Promise.all([C, D].map(x => x.until('roundStarted', p => p.round === 2)));
  await Promise.all([[A, 100], [C, 110], [D, 120]].map(([x, p]) => sendAndWait(x, { sessionCode: code, price: p })));
  const res2 = await Promise.all([A, C, D].map(x => x.until('roundResults', p => p.round === 2, ROUND * 1000 + 4000)));
  const bobPartner = res2.find(r => r.opponentName === 'Bob');
  check(`${T} the partner of an offline phone still gets a result, against a forced price inside the bounds`, bobPartner && Number.isFinite(bobPartner.opponentPrice) && bobPartner.opponentPrice >= 0 && bobPartner.opponentPrice <= 250, JSON.stringify(bobPartner && [bobPartner.opponentName, bobPartner.opponentPrice]));
  // Bob comes back during round 3
  await A.until('roundStarted', p => p.round === 3, BREAK * 1000 + 3000);
  B = await refresh(B, { closeOld: false, withName: false });
  const rsB3 = await B.until('roundStarted', p => p.round === 3, 3000);
  const histB = await B.until('roundResults', null, 3000).catch(() => null);
  check(`${T} back after a missed round: round 3 open, no price yet, history has rounds 1 and 2`, rsB3.hasSubmitted === false && histB?.history?.length === 2 && histB.history[1].round === 2 && histB.round === 2, JSON.stringify([rsB3.hasSubmitted, histB?.history?.map(h => [h.round, h.price])]));
  check(`${T} the missed round was forced to a whole dollar inside the bounds`, histB && Number.isInteger(histB.history[1].price) && histB.history[1].price >= 0 && histB.history[1].price <= 250, JSON.stringify(histB?.history?.[1]?.price));

  // round 3: the instructor reloads mid-round
  inst.close();
  const inst2 = client('instructor 2');
  await inst2.connected;
  inst2.s.emit('joinSession', { sessionCode: code, playerName: 'Refresh test', role: 'instructor', key: KEY });
  await inst2.until('joinedSession');
  await sleep(300);
  const sums = (inst2.got.roundSummary || []).map(x => x.p.round);
  check(`${T} instructor reload mid-game replays the summaries of rounds 1 and 2`, sums.includes(1) && sums.includes(2) && sums.length === 2, JSON.stringify(sums));
  const instRs = inst2.last('roundStarted');
  check(`${T} instructor reload mid-round shows round 3 with time remaining`, instRs?.round === 3 && instRs.roundTime <= ROUND, JSON.stringify(instRs));
  await Promise.all([[A, 130], [B, 140], [C, 150], [D, 160]].map(([x, p]) => sendAndWait(x, { sessionCode: code, price: p })));
  const done = await Promise.all([A, B, C, D].map(x => x.until('sessionComplete', null, ROUND * 1000 + 6000)));
  check(`${T} game over reaches every current socket with a leaderboard of four`, done.every(p => p.leaderboard?.length === 4), JSON.stringify(done[0]?.leaderboard?.map(l => [l.name, Math.round(l.totalProfit)])));
  const instDone = await inst2.until('sessionComplete', null, 3000);
  check(`${T} game over reaches the reloaded instructor with all three rounds`, instDone.rounds?.length === 3 && instDone.leaderboard?.length === 4, JSON.stringify(instDone.rounds?.length));

  // after the end: Ann reloads (the page has forgotten her stored name by now, so code only)
  const A2 = await refresh(A, { withName: false });
  check(`${T} reload after game over still joins as Ann with the final leaderboard`, A2.joined.status === 'complete' && A2.joined.playerName === 'Ann' && A2.joined.leaderboard?.length === 4, JSON.stringify([A2.joined.status, A2.joined.playerName, A2.joined.leaderboard?.length]));
  const histAfter = await A2.until('roundResults', null, 1500).catch(() => null);
  check(`${T} reload after game over brings back the student's own rounds (her total on the game-over card)`, histAfter?.history?.length === 3, histAfter ? `history ${histAfter.history?.length}` : 'no roundResults sent after the end: the card would show $0');
  [A2, B, C, D, inst2].forEach(x => x.close());
  return code;
}

// ---- game 2: a dark phone at the start, a duplicate seat, a latecomer, the same link in two tabs ---------------------
async function game2() {
  const T = '[game2]';
  const { code, inst } = await newSession('refresh 2', { rounds: 2, showOpponentName: true });
  const A = { ...await joinNew(code, 'Eve'), code }, B = { ...await joinNew(code, 'Fay'), code }, C = { ...await joinNew(code, 'Gus'), code };
  // Fay's browser forgot her seat and she joined again from the join page: a second seat, "Fay (2)" since 2026-11-11, the old one offline
  const Bdup = { ...await joinNew(code, 'Fay'), code };
  B.close();
  // Gus's phone is locked when the instructor presses start
  C.close();
  await sleep(400);
  const roster = studentsIn(inst.last('sessionUpdate'));
  check(`${T} the instructor's lobby shows the offline phones`, roster.find(p => p.name === 'Gus')?.connected === false && roster.filter(p => /^Fay( \(2\))?$/.test(p.name)).length === 2, JSON.stringify(roster.map(p => [p.name, p.connectionStatus])));
  inst.s.emit('startSession', { sessionCode: code });
  const started = await Promise.all([A, Bdup].map(x => x.until('roundStarted', p => p.round === 1)));
  check(`${T} the connected phones get round 1`, started.every(p => p.round === 1));
  await sleep(300);
  const roster2 = studentsIn(inst.last('sessionUpdate'));
  check(`${T} the dark phone is paired; the offline duplicate seat is not`, roster2.find(p => p.name === 'Gus')?.pairId && roster2.filter(p => /^Fay( \(2\))?$/.test(p.name)).length === 2 && roster2.filter(p => /^Fay( \(2\))?$/.test(p.name) && p.pairId).length === 1 && roster2.find(p => p.name === 'Fay (2)' && p.connected)?.pairId, JSON.stringify(roster2.map(p => [p.name, p.connectionStatus, !!p.pairId])));
  // Gus unlocks his phone during round 1: he is in the game, with the round open
  const C2 = await refresh(C, { closeOld: false });
  const rsC = await C2.until('roundStarted', p => p.round === 1, 3000).catch(() => null);
  check(`${T} a phone dark at the start is in the game when it wakes up`, C2.joined.spectator === false && ['A', 'B'].includes(C2.joined.side) && rsC && rsC.hasSubmitted === false && rsC.roundTime <= ROUND, JSON.stringify([C2.joined.spectator, C2.joined.side, rsC && rsC.roundTime]));
  const subC = await sendAndWait(C2, { sessionCode: code, price: 10 });
  check(`${T} and can submit a price`, subC.accepted === 10, JSON.stringify(subC));
  const oppC = await C2.until('opponentInfo', null, 2000).catch(() => null);
  check(`${T} the rejoin brings the rival's name when the game shows it`, typeof oppC?.opponentName === 'string' && oppC.opponentName.length > 0, JSON.stringify(oppC));
  // the forgotten duplicate seat tries to come back: it is a spectator, told so, and refused a price
  const Bold = await refresh(B, { closeOld: false });
  check(`${T} the dropped duplicate seat is a spectator`, Bold.joined.spectator === true && Bold.joined.side === null, JSON.stringify([Bold.joined.spectator, Bold.joined.side]));
  const specSub = await sendAndWait(Bold, { sessionCode: code, price: 10 });
  check(`${T} a spectator's price is refused with the sitting-out message`, /sitting this one out/i.test(specSub.rejected || ''), JSON.stringify(specSub));
  // a brand-new student after the start
  const late = client('late');
  await late.connected;
  late.s.emit('joinSession', { sessionCode: code, playerName: 'Hal', role: 'student' });
  const lateErr = await late.until('errorMessage', null, 3000).catch(() => null);
  check(`${T} a new student after the start is refused and pointed to the personal link`, /already started/i.test(lateErr || '') && /personal link/i.test(lateErr || ''), String(lateErr));
  late.close();
  // Eve opens her personal link in a second tab while the first is still open
  const A2 = await refresh(A, { closeOld: false });
  await A2.until('roundStarted', p => p.round === 1, 3000);
  const oldTab = await sendAndWait(A, { sessionCode: code, price: 20 });
  check(`${T} the old tab can no longer submit and is told to reload`, /reload/i.test(oldTab.rejected || ''), JSON.stringify(oldTab));
  const newTab = await sendAndWait(A2, { sessionCode: code, price: 25 });
  check(`${T} the new tab submits normally`, newTab.accepted === 25, JSON.stringify(newTab));
  A.close(); // closing the old tab must not mark Eve offline
  await sleep(400);
  const r = studentsIn(inst.last('sessionUpdate')).find(p => p.name === 'Eve');
  check(`${T} closing the old tab leaves Eve online`, r?.connected === true, JSON.stringify(r));
  await sendAndWait(Bdup, { sessionCode: code, price: 30 });
  const res = await Promise.all([A2, Bdup, C2].map(x => x.until('roundResults', p => p.round === 1, ROUND * 1000 + 4000)));
  check(`${T} round 1 results reach Eve, Fay and Gus with their prices (one of them plays the AI seat)`, res[0].price === 25 && res[1].price === 30 && res[2].price === 10 && Number.isFinite(res[2].opponentPrice), JSON.stringify(res.map(x => [x.price, x.opponentName, x.opponentPrice])));
  check(`${T} the spectator gets no results of his own`, (Bold.got.roundResults || []).length === 0);
  await Promise.all([A2, Bdup, C2].map(x => x.until('roundStarted', p => p.round === 2, BREAK * 1000 + 3000)));
  await Promise.all([[A2, 40], [Bdup, 45], [C2, 50]].map(([x, p]) => sendAndWait(x, { sessionCode: code, price: p })));
  const fin = await Promise.all([A2, Bdup, C2, Bold].map(x => x.until('sessionComplete', null, ROUND * 1000 + 6000)));
  check(`${T} game over reaches everyone; the leaderboard has the three players and the AI seat`, fin.every(p => p.leaderboard?.length === 4), JSON.stringify(fin.map(p => p.leaderboard?.length)));
  [A2, Bdup, Bold, C2, inst].forEach(x => x.close());
  return code;
}

// ---- game 3: a reload exactly as the round ends, and one exactly as the game starts ---------------------------------
async function game3() {
  const T = '[game3]';
  const { code, inst } = await newSession('refresh 3', { rounds: 2, roundTime: 4 });
  let A = { ...await joinNew(code, 'Ida'), code }, B = { ...await joinNew(code, 'Jon'), code };
  // Ida's reload is in flight when the instructor presses start (old socket gone, new one not yet joined)
  A.close();
  const n = client('Ida (reloading)');
  inst.s.emit('startSession', { sessionCode: code });
  await n.connected;
  n.s.emit('joinSession', { sessionCode: code, playerName: 'Ida', studentCode: A.studentCode, role: 'student' });
  const j = await n.until('joinedSession', null, 5000);
  A = { ...n, name: 'Ida', studentCode: A.studentCode, code, joined: j };
  // since 2026-11-08 everyone in the lobby is paired, so the reload in flight keeps the seat and gets the round
  const rs = await A.until('roundStarted', p => p.round === 1, 2000).catch(() => null);
  check(`${T} a reload in flight at the start keeps the seat and gets round 1`, j.spectator === false && rs && ['A', 'B'].includes(rs.side), JSON.stringify([j.spectator, rs?.side]));
  // Jon reloads in the last second of round 1
  await B.until('roundStarted', p => p.round === 1);
  await sendAndWait(B, { sessionCode: code, price: 50 });
  await sleep(3400);
  B = await refresh(B);
  const r1 = await B.until('roundResults', p => p.round === 1, 6000).catch(() => null);
  check(`${T} reload in the last second of a round: the result still arrives on the new socket`, r1 && r1.price === 50, JSON.stringify(r1 && [r1.round, r1.price]));
  await B.until('roundStarted', p => p.round === 2, BREAK * 1000 + 4000);
  if (!j.spectator) { await A.until('roundStarted', p => p.round === 2, 2000).catch(() => null); await sendAndWait(A, { sessionCode: code, price: 60 }); }
  await sendAndWait(B, { sessionCode: code, price: 70 });
  const fin = await B.until('sessionComplete', null, 12000);
  check(`${T} game 3 completes`, Array.isArray(fin.leaderboard));
  [A, B, inst].forEach(x => x.close());
  return code;
}

// ---- main -------------------------------------------------------------------------------------------------------
const dbFiles = () => fs.readdirSync(path.join(ROOT, 'server')).filter(f => f.startsWith('game_sessions.db'));
const hadDb = dbFiles().length > 0;
const serverLog = [];
const server = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), INSTRUCTOR_KEY: KEY, OPENAI_API_KEY: '', OPENAI_BASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', d => serverLog.push(...String(d).split('\n').filter(Boolean)));
server.stderr.on('data', d => serverLog.push(...String(d).split('\n').filter(Boolean)));
let up = false;
for (let i = 0; i < 50 && !up; i++) { await sleep(200); up = await fetch(BASE + '/health').then(r => r.ok).catch(() => false); }
if (!up) { console.error('server did not start:\n' + serverLog.join('\n')); server.kill(); process.exit(1); }
console.log(`server up on ${BASE}; three games at once`);
const t0 = Date.now();
const codes = [];
try {
  const out = await Promise.all([game1, game2, game3].map(g => g().catch(err => { check(`${g.name} finished without an exception`, false, err.message); return null; })));
  codes.push(...out.filter(Boolean));
} finally {
  for (const c of codes) await api(`/session/${c}`, { method: 'DELETE' }).catch(() => {});
  server.kill();
  await sleep(300);
  const errors = serverLog.filter(l => /UNCAUGHT|UNHANDLED|handler error|TypeError|ReferenceError|Error:/.test(l) && !/OpenAI/.test(l));
  check('server log has no handler errors or crashes', errors.length === 0, errors.slice(0, 3).join(' | '));
  if (!hadDb) dbFiles().forEach(f => fs.unlinkSync(path.join(ROOT, 'server', f)));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)} s${failed.length ? '; FAILED:\n  ' + failed.map(f => f.name + (f.detail ? '  (' + f.detail + ')' : '')).join('\n  ') : ''}`);
  process.exit(failed.length ? 1 : 0);
}
