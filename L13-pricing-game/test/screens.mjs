#!/usr/bin/env node
// Plays the first round of a gas-station game on a server so the student page can be photographed between rounds
// (teaching23-games, 2026-11-10): creates the game (round 1 of 15 s, then a long break, then round 2 of 60 s), one
// student "Phone Tester" who prices $3.49 against the AI seat, and prints the student's personal link once the round 1
// result is in, then exits. A browser opening that link takes the seat over and shows the result card for the rest of
// the break, then the round 2 price card. Used with headless Chrome at a phone width:
//   node test/screens.mjs --host http://127.0.0.1:4998 --key <key> [--break 90]

import { io } from 'socket.io-client';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
if (!args.host || !args.key) { console.log('usage: node screens.mjs --host <url> --key <key> [--break S]'); process.exit(1); }
const BASE = /^https?:\/\//.test(args.host) ? args.host.replace(/\/$/, '') : `https://${args.host}`;
const KEY = String(args.key);
const config = {
  rounds: 2, roundTime: [15, 60], breakTime: Number(args.break || 90), modelType: 'hotelling', travelCost: 0.01, consumerValue: 5,
  marginalCost: 2.5, marketSize: 10000, x1: 0, x2: 100, priceBounds: { min: 2.5, max: 10 }, showOpponentName: true
};
const res = await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'Screens', sessionName: 'screens', config }) });
const session = await res.json();
if (res.status !== 201) { console.error('could not create the session:', session); process.exit(1); }
const code = session.code;

const inst = io(BASE, { transports: ['websocket'] });
const stu = io(BASE, { transports: ['websocket'] });
let studentCode = null;
const bail = (msg) => { console.error(msg); inst.close(); stu.close(); process.exit(1); };
setTimeout(() => bail('timed out'), args.finish ? 400000 : 60000); // --finish: play round 2 too and report the game over
inst.on('connect', () => inst.emit('joinSession', { sessionCode: code, playerName: 'Screens', role: 'instructor', key: KEY }));
inst.on('joinedSession', () => inst.emit('openLobby', { sessionCode: code }));
inst.on('errorMessage', m => bail('instructor error: ' + m));
inst.on('sessionUpdate', p => {
  if (p.status === 'lobby' && !studentCode && stu.connected) stu.emit('joinSession', { sessionCode: code, playerName: 'Phone Tester', role: 'student' });
});
stu.on('errorMessage', m => bail('student error: ' + m));
stu.on('joinedSession', j => { studentCode = j.studentCode; setTimeout(() => inst.emit('startSession', { sessionCode: code }), 500); });
stu.on('roundStarted', p => {
  if (p.round === 1) setTimeout(() => stu.emit('submitPrice', { sessionCode: code, price: 3.49 }), 1000);
  if (p.round === 2 && args.finish) setTimeout(() => stu.emit('submitPrice', { sessionCode: code, price: 4 }), 1000);
});
stu.on('roundResults', p => {
  if (p.round !== 1) return;
  console.log(`${BASE}/session/${code}/${studentCode}`);
  console.log(`round 1: $${p.price} vs $${p.opponentPrice}, ${Math.round(p.demand)} gallons, profit $${p.profit.toFixed(0)}; round 2 starts in ${config.breakTime} s and lasts 60 s`);
  if (!args.finish) { inst.close(); stu.close(); process.exit(0); }
});
stu.on('sessionComplete', () => { console.log('game over'); inst.close(); stu.close(); process.exit(0); });
