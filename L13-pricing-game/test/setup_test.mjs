#!/usr/bin/env node
// "Test this with me" (Mert, 2026-11-10): creates ONE game on a service and opens its lobby, then exits. Mert joins
// from his phone at the student address with the code and presses "Start the game" on the dashboard himself.
// The session stays in the lobby with no instructor connected until he opens the dashboard; that is fine.
//
//   node test/setup_test.mjs --host https://lab-a.onrender.com --key <instructor key> [--name "test with Mert"]
//        [--rounds 3] [--round-time 45] [--break 12] [--t 0.01] [--cost 2.5] [--value 5] [--gallons 10000]
//        [--min 0] [--max 10] [--chat] [--hide] [--no-names]
//
// Defaults are Game 1 of the class (gas stations, Massachusetts Nov 2026: cost $3.30 a gallon, a gallon worth $4.50, 10,000 gallons a
// round, prices $3.30 to $6, random price up to $5, driving cost 0.004, so the Nash price is $3.70 and the collusive $4.30), cut to 3 rounds of
// 45 s with 12 s breaks, rival's name shown. The key is never printed.

import { io } from 'socket.io-client';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
if (!args.host || !args.key) {
  console.log('usage: node setup_test.mjs --host <url> --key <instructor key> [--name N] [--rounds R] [--round-time S] [--break S] [--t T] [--cost C] [--value V] [--gallons G] [--min P] [--max P] [--chat] [--hide] [--no-names]');
  process.exit(1);
}
const BASE = /^https?:\/\//.test(args.host) ? args.host.replace(/\/$/, '') : `https://${args.host}`;
const KEY = String(args.key);
const n = (v, d) => (v === undefined || v === true ? d : Number(v));
const rounds = n(args.rounds, 3);
const config = {
  rounds,
  roundTime: Array(rounds).fill(n(args['round-time'], 45)),
  breakTime: n(args.break, 12),
  modelType: 'hotelling',
  travelCost: n(args.t, 0.004),
  consumerValue: n(args.value, 4.5),
  marginalCost: n(args.cost, 3.3),
  marketSize: n(args.gallons, 10000),
  x1: 0,
  x2: 100,
  priceBounds: { min: n(args.min, 3.3), max: n(args.max, 6) },
  randomPriceMax: n(args['random-max'], 5),
  enableChat: Boolean(args.chat),
  hideRoundCount: Boolean(args.hide),
  showOpponentName: !args['no-names']
};
const stamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const name = args.name && args.name !== true ? String(args.name) : `test with Mert ${stamp}`;

const res = await fetch(BASE + '/api/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'Mert', sessionName: name, config })
});
const session = await res.json().catch(() => ({}));
if (res.status !== 201) { console.error(`could not create the session: HTTP ${res.status} ${session.error || ''}`); process.exit(1); }
const code = session.code;

// open the lobby through a short-lived instructor socket
const s = io(BASE, { transports: ['websocket'] });
const fail = msg => { console.error(msg); s.close(); process.exit(1); };
const timer = setTimeout(() => fail(`the lobby did not open within 15 s (session ${code} exists; open it from the dashboard)`), 15000);
s.on('connect_error', e => fail('could not connect: ' + e.message));
s.on('errorMessage', m => fail('server said: ' + m));
s.on('connect', () => s.emit('joinSession', { sessionCode: code, playerName: 'Mert', role: 'instructor', key: KEY }));
s.on('joinedSession', () => s.emit('openLobby', { sessionCode: code }));
s.on('sessionUpdate', p => {
  if (p.status !== 'lobby') return;
  clearTimeout(timer);
  // the 15010.ai shortcut for the section services; anything else is shown by its own address
  const m = /^https:\/\/lab-([a-f])(?:-[a-z0-9]+)?\.onrender\.com$/.exec(BASE);
  const student = m ? `https://15010.ai/l13-${m[1]}` : BASE + '/';
  console.log(`session ${code} ("${name}") is in the lobby.`);
  console.log(`  students: ${student}  code ${code}`);
  console.log(`  dashboard: ${BASE}/manage/${code}${m ? `  (key already in the browser after https://15010.ai/l13-${m[1]}xx)` : ''}`);
  console.log(`  ${rounds} rounds of ${config.roundTime[0]} s, breaks ${config.breakTime} s; wholesale cost $${config.marginalCost.toFixed(2)}, Nash price $${(config.marginalCost + 100 * config.travelCost).toFixed(2)}`);
  s.close();
  process.exit(0);
});
