#!/usr/bin/env node
// A few scripted students for a game that is already in the lobby (teaching23-games, 2026-11-10): each joins with a
// name, prices every round (a random price between the wholesale cost and the max, or --price P for all of them, to the
// cent) and leaves when the game is over. For testing a game on a service next to a real phone.
//
//   node test/bots.mjs --host https://lab-a.onrender.com --code XXXX [--n 2] [--price 3.49] [--names "Ann,Bob"]

import { io } from 'socket.io-client';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
if (!args.host || !args.code) { console.log('usage: node bots.mjs --host <url> --code XXXX [--n 2] [--price P] [--names "A,B"]'); process.exit(1); }
const BASE = /^https?:\/\//.test(args.host) ? args.host.replace(/\/$/, '') : `https://${args.host}`;
const code = String(args.code).toUpperCase();
const n = Number(args.n || 2);
const names = args.names && args.names !== true ? String(args.names).split(',').map(s => s.trim()) : ['Bot Ada', 'Bot Ben', 'Bot Cy', 'Bot Dee', 'Bot Eve', 'Bot Finn', 'Bot Gus', 'Bot Hal'];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let left = n;

for (let i = 0; i < n; i++) {
  const name = names[i % names.length] + (i >= names.length ? ` ${i + 1}` : '');
  const s = io(BASE, { transports: ['websocket'] });
  let bounds = { min: 0, max: 100 }, cost = 0;
  s.on('connect', () => s.emit('joinSession', { sessionCode: code, playerName: name, role: 'student' }));
  s.on('joinedSession', j => {
    bounds = j.config?.priceBounds || bounds; cost = Number(j.config?.marginalCost) || 0;
    log(`${name} joined (${j.studentCode})`);
  });
  s.on('errorMessage', m => log(`${name}: ${m}`));
  s.on('roundStarted', p => {
    const lo = Math.max(bounds.min, cost), hi = bounds.max;
    const price = args.price && args.price !== true ? Number(args.price) : Math.round((lo + Math.random() * (hi - lo) * 0.5) * 100) / 100;
    setTimeout(() => s.emit('submitPrice', { sessionCode: code, price }), 500 + Math.random() * 1500);
    log(`${name} round ${p.round}: $${price.toFixed(2)}`);
  });
  s.on('roundResults', r => log(`${name} round ${r.round}: $${r.price} vs ${r.opponentName} $${r.opponentPrice} -> ${Math.round(r.demand)} gal, profit $${r.profit.toFixed(0)}`));
  s.on('sessionComplete', p => {
    const me = (p.leaderboard || []).find(x => x.name === name);
    log(`${name}: game over, total $${me ? me.totalProfit.toFixed(0) : '?'}`);
    s.close();
    if (--left === 0) process.exit(0);
  });
}
