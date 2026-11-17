#!/usr/bin/env node
// A rehearsal of the announcement game with Mert on his phone (teaching23-games, 2026-11-17): creates the game with the
// class settings on --host, waits for the instructor to open the lobby on the real page, then 9 simulated classmates
// join; the instructor starts. Whoever is paired with the real phone invites coordination; the other pairs announce a
// mix. Bots announce at random moments in the phase and price after the reveal. At the end: the review's verdicts.
//   node test/rehearse_announce.mjs --host https://lab-a.onrender.com --key KEY [--announce 120] [--price 60] [--n 9]
import { io } from 'socket.io-client';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(x => x.length));
const BASE = (args.host || 'https://lab-a.onrender.com').replace(/\/$/, ''), KEY = args.key || 'applied-econ';
const ANN = Number(args.announce || 120), PRICE = Number(args.price || 60), N = Number(args.n || 9);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

const config = { rounds: 2, roundTime: [PRICE, PRICE], breakTime: 10, announceTime: ANN, modelType: 'hotelling', travelCost: 0.004, consumerValue: 7, marginalCost: 3.3,
  marketSize: 10000, x1: 0, x2: 100, priceBounds: { min: 3.3, max: 10 }, randomPriceMax: 6, aiChatReview: true, hideRoundCount: false, showOpponentName: false, showModelParameters: false };
const s = await (await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'Mert', sessionName: 'Rehearsal: announcement game', config }) })).json();
if (!s.code) { log('could not create the game', JSON.stringify(s)); process.exit(1); }
const code = s.code; log(`GAME ${code} created on ${BASE}; WAITING for the instructor to open the lobby`);

const obs = io(BASE, { transports: ['websocket'] });
let status = 'setup', pairs = [], over = false, review = null, players = [];
obs.on('connect', () => obs.emit('joinSession', { sessionCode: code, playerName: 'Observer', role: 'instructor', key: KEY }));
obs.on('sessionUpdate', p => { status = p.status; if (p.pairs?.length) pairs = p.pairs; players = (p.players || []).filter(q => q.role === 'student'); });
obs.on('announcePhase', p => log(`round ${p.round}: announcement phase, ${p.remaining} s`));
obs.on('announcementsAll', p => log(`announcements revealed (${p.log.length} so far)`));
obs.on('roundStarted', p => log(`round ${p.round}: prices open`));
obs.on('sessionComplete', () => { over = true; log('game over'); });
obs.on('chatReview', r => { review = r; });
while (status !== 'lobby') await sleep(500);
log('lobby open: the classmates join');

const NAMES = ['Ava Chen', 'Ben Ortiz', 'Chloe Park', 'Dev Patel', 'Ella Brooks', 'Finn Murphy', 'Grace Liu', 'Hugo Silva', 'Isla Novak', 'Jack Reed', 'Kira Shah'].slice(0, N);
const bots = NAMES.map((name, k) => {
  const b = { name, so: io(BASE, { transports: ['websocket'] }) };
  b.so.on('connect', () => setTimeout(() => b.so.emit('joinSession', { sessionCode: code, playerName: name, role: 'student', studentCode: b.code }), k * 400));
  b.so.on('joinedSession', p => { b.code = p.studentCode || b.code; });
  return b;
});
let lastCount = -1;
while (status === 'lobby') { if (players.length !== lastCount) { lastCount = players.length; log(`${players.length} in the lobby: ${players.map(p => p.name).filter(n => !NAMES.includes(n)).join(', ') || '(the phone is not in yet)'}`); } await sleep(1000); }
log('started');
while (pairs.length * 2 < players.length - 1 || !pairs[0]?.playerA?.name) await sleep(200);

// scripts: the real phone's rival invites coordination; the others a mix (round 1, round 2)
const isBot = n => NAMES.includes(n);
const RIVAL = ['A price war helps nobody. $6.50 works for both stations on this road.', 'We are at $6.50 again and will stay there as long as our neighbor does.'];
const MIX = [
  ['Our price is $5.20, the best deal on the road.', 'Still $5.20.'], ['We will charge $5.40 this week.', 'Thank you for choosing us.'],
  ['We are raising our price to $6 and expect our competitor to follow.', 'Our price is $5.90.'], ['Fresh coffee with every fill-up.', ''],
  ['Open 24 hours, now with a car wash.', 'Car wash free on Sundays.'], ['Lowest prices in town, guaranteed.', ''],
  ["Let's both set our price at $6.80.", '$6.80 again.'], ['Agreed: $6.80 from us too.', 'Same here.'],
  ['Our price: $5.80.', 'If anyone undercuts $6, we will go to $3.30.'], ['We price independently.', 'Our price is $5.10.']
];
const script = new Map(); let m = 0;
for (const p of pairs) {
  const a = p.playerA?.name, b = p.playerB?.name;
  for (const [me, other] of [[a, b], [b, a]]) if (isBot(me)) script.set(me, !isBot(other) && other ? RIVAL : MIX[m++ % MIX.length]);
}
const hi = new Set(pairs.flatMap(p => [p.playerA?.name, p.playerB?.name]).filter(n => isBot(n) && (script.get(n) === RIVAL || /6\.80/.test(script.get(n)?.[0] || ''))));
for (const b of bots) {
  const lines = script.get(b.name) || ['', ''];
  const say = r => { if (lines[r - 1]) setTimeout(() => b.so.emit('announce', { sessionCode: code, text: lines[r - 1], round: r }), 5000 + Math.random() * (ANN * 1000 - 20000)); };
  b.so.on('announcePhase', p => say(p.round));
  b.so.on('roundStarted', p => { if (p.hasSubmitted) return; setTimeout(() => b.so.emit('submitPrice', { sessionCode: code, price: hi.has(b.name) ? (b.name && script.get(b.name) === RIVAL ? 6.5 : 6.8) : Math.round((4.4 + Math.random() * 1.6) * 100) / 100, round: p.round }), 4000 + Math.random() * (PRICE * 1000 - 15000)); });
}
// round 1's phase started before these handlers: announce now too
for (const b of bots) { const lines = script.get(b.name) || ['', '']; if (lines[0]) setTimeout(() => b.so.emit('announce', { sessionCode: code, text: lines[0], round: 1 }), 5000 + Math.random() * (ANN * 1000 - 20000)); }
const phonePair = pairs.find(p => !isBot(p.playerA?.name) || !isBot(p.playerB?.name));
log(`pairs: ${pairs.length}; the phone (${phonePair ? (isBot(phonePair.playerA.name) ? phonePair.playerB.name : phonePair.playerA.name) : '?'}) is paired with ${phonePair ? (isBot(phonePair.playerA.name) ? phonePair.playerA.name : phonePair.playerB.name) : '?'}`);

while (!over) await sleep(500);
const t0 = Date.now();
while (!(review?.status === 'done') && Date.now() - t0 < 180000) await sleep(500);
log(`review ${review?.status === 'done' ? 'done' : 'NOT DONE'} in ${((Date.now() - t0) / 1000).toFixed(0)} s:`);
for (const r of review?.results || []) log(`  ${r.nameA} & ${r.nameB}: ${r.verdict || 'NOT REVIEWED ' + (r.error || '')} (${r.rule || ''}); red lines ${(r.illegal || []).length}`);
log(`GAME ${code} kept on the service for the dashboard; delete it before class`);
bots.forEach(b => b.so.close()); obs.close();
process.exit(0);
