#!/usr/bin/env node
// Runs the instructor's side of one game on a server so a real phone or browser tab can play it (teaching23-games,
// 2026-11-08): creates the session, opens the lobby, waits for at least one student (then --wait more seconds for
// others), starts the game and reports the rounds and the final leaderboard. The session is left in place.
//
//   node drive.mjs --host http://127.0.0.1:4998 --key <instructor key> [--rounds 4] [--round-time 45] [--break 8]
//                  [--t 1] [--wait 10] [--chat] [--hide]

import { io } from 'socket.io-client';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
if (!args.host || !args.key) { console.log('usage: node drive.mjs --host <url> --key <key> [--rounds R] [--round-time S] [--break S] [--t T] [--wait S] [--chat] [--hide]'); process.exit(1); }
const BASE = /^https?:\/\//.test(args.host) ? args.host : `https://${args.host}`;
const KEY = String(args.key);
// gas-station settings since 2026-11-10 (since 2026-11-10 evening, the Massachusetts numbers: cost $3.30, a gallon worth $4.50, 10,000 gallons, prices $3.30-$10, random up to $6, t 0.004)
const config = {
  rounds: Number(args.rounds || 4), roundTime: Number(args['round-time'] || 45), breakTime: Number(args.break || 8),
  modelType: 'hotelling', travelCost: args.t === undefined ? 0.004 : Number(args.t), consumerValue: 4.5, marginalCost: 3.3, marketSize: 10000, x1: 0, x2: 100,
  priceBounds: { min: 3.3, max: 10 }, randomPriceMax: 6, enableChat: Boolean(args.chat), hideRoundCount: Boolean(args.hide), showOpponentName: true
};
let code = args.code ? String(args.code).toUpperCase() : null; // --code XXXX drives a session created already
if (!code) {
  const res = await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
    body: JSON.stringify({ instructorName: 'Drive', sessionName: `drive ${new Date().toISOString().slice(11, 16)}`, config }) });
  const session = await res.json();
  if (res.status !== 201) { console.error('could not create the session:', session); process.exit(1); }
  code = session.code;
}
console.log(`session ${code}: students join at ${BASE}/ with code ${code}; dashboard ${BASE}/manage/${code}?key=${KEY}`);

const s = io(BASE, { transports: ['websocket'] });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
s.on('connect', () => s.emit('joinSession', { sessionCode: code, playerName: 'Drive', role: 'instructor', key: KEY }));
let started = false, firstStudentAt = null;
s.on('joinedSession', () => { s.emit('openLobby', { sessionCode: code }); log('lobby open'); });
s.on('sessionUpdate', p => {
  if (started || p.status !== 'lobby') return;
  const n = (p.players || []).filter(q => q.role === 'student' && q.connected).length;
  if (n > 0 && !firstStudentAt) { firstStudentAt = Date.now(); log(`${n} student(s) in; starting in ${args.wait || 10} s`); setTimeout(() => { started = true; s.emit('startSession', { sessionCode: code }); }, Number(args.wait || 10) * 1000); }
});
s.on('roundStarted', p => log(`round ${p.round} started (${p.roundTime} s)`));
s.on('submissionProgress', p => log(`  prices in: ${p.submitted}/${p.total}`));
s.on('roundSummary', p => (p.results || []).forEach(r => log(`  round ${p.round}: ${r.playerA.name} $${r.playerA.price} -> $${r.playerA.profit.toFixed(0)} | ${r.playerB.name} $${r.playerB.price} -> $${r.playerB.profit.toFixed(0)}`)));
s.on('errorMessage', m => log('error:', m));
s.on('sessionComplete', p => { log('game over; leaderboard:'); (p.leaderboard || []).forEach(r => log(`  ${r.name}: $${(r.totalProfit ?? 0).toFixed(0)}`)); s.close(); process.exit(0); });
