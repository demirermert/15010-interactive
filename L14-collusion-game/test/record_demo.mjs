#!/usr/bin/env node
// A video of a whole announcement game (teaching23-games, 2026-11-16; Mert: "record video of the entire thing, both
// dashboard and the phone"): the instructor dashboard on the left, one student's phone on the right, 9 simulated
// classmates. The page clicks Open the lobby and Start; the phone joins with the code, writes its announcements and
// prices; at the end the phone's verdict card and the dashboard's Announcements panel and AI review tab.
// Needs a running server (--host, default http://127.0.0.1:4998) with the Parley settings, and ffmpeg.
//   node test/record_demo.mjs [--host URL] [--key KEY] [--announce 45] [--price 25] [--out FILE.mp4]
import puppeteer from 'puppeteer-core';
import { io } from 'socket.io-client';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(x => x.length));
const BASE = args.host || 'http://127.0.0.1:4998', KEY = args.key || 'applied-econ';
const ANN = Number(args.announce || 45), PRICE = Number(args.price || 25);
const OUT = args.out || path.join(process.cwd(), 'announcement-game-demo.mp4');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

const config = { rounds: 2, roundTime: PRICE, breakTime: 8, announceTime: ANN, modelType: 'hotelling', travelCost: 0.004, consumerValue: 7, marginalCost: 3.3, marketSize: 10000,
  x1: 0, x2: 100, priceBounds: { min: 3.3, max: 10 }, randomPriceMax: 6, aiChatReview: true };
const s = await (await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'Mert', sessionName: 'Announcement game (demo video)', config }) })).json();
const code = s.code; log('game', code);

// an observer socket for the pairs (the dashboard page is the real instructor)
const obs = io(BASE, { transports: ['websocket'] }); let pairs = [], over = false, reviewDone = false;
obs.on('connect', () => obs.emit('joinSession', { sessionCode: code, playerName: 'Observer', role: 'instructor', key: KEY }));
obs.on('sessionUpdate', p => { if (p.pairs?.length) pairs = p.pairs; });
obs.on('sessionComplete', () => { over = true; });
obs.on('chatReview', r => { if (r.status === 'done') reviewDone = true; });

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const dashCtx = await browser.createBrowserContext(), phoneCtx = await browser.createBrowserContext();
const dash = await dashCtx.newPage(); await dash.setViewport({ width: 1440, height: 900 });
const phone = await phoneCtx.newPage(); await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await dash.goto(`${BASE}/instructor?key=${KEY}`, { waitUntil: 'networkidle2' });
await dash.goto(`${BASE}/manage/${code}`, { waitUntil: 'networkidle2' });
await phone.goto(BASE + '/', { waitUntil: 'networkidle2' });
const recD = await dash.screencast({ path: path.join(TMP, 'dash.webm') });
// the phone: Chrome's recorder keeps only the top of an emulated phone screen, so the phone is filmed as screenshots,
// five a second, each kept for as long as it was on screen
const shots = []; let filming = true;
const film = (async () => { let k = 0; while (filming) { const t = Date.now(); const f = path.join(TMP, `p${String(k++).padStart(5, '0')}.png`);
  try { await phone.screenshot({ path: f }); shots.push({ f, t }); } catch {} await sleep(Math.max(0, 200 - (Date.now() - t))); } })();
const recStart = Date.now();
await sleep(2500);
const clickText = async (page, text) => page.evaluate(t => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t && !x.disabled); if (b) b.click(); return !!b; }, text);

// the lobby, the class joins, the phone joins
await clickText(dash, 'Open the lobby'); log('lobby open');
await sleep(1500);
const NAMES = ['Ava Chen', 'Ben Ortiz', 'Chloe Park', 'Dev Patel', 'Ella Brooks', 'Finn Murphy', 'Grace Liu', 'Hugo Silva', 'Isla Novak'];
const bots = NAMES.map((name, k) => { const so = io(BASE, { transports: ['websocket'] }); setTimeout(() => so.emit('joinSession', { sessionCode: code, playerName: name, role: 'student' }), 400 + k * 500); so.on('connect', () => {}); return { name, so }; });
await phone.type('#student-name', 'Maya Rossi', { delay: 90 });
await phone.type('#session-code', code, { delay: 150 });
await sleep(600); await phone.click('button[type=submit]');
await sleep(6000);
await clickText(dash, 'Start the game'); log('started');
while (pairs.length < 5 || !pairs[0].playerA?.name) await sleep(200);

// scripts: the phone's rival invites coordination; the others a mix
const mine = pairs.find(p => p.playerA.name === 'Maya Rossi' || p.playerB.name === 'Maya Rossi');
const rivalName = mine.playerA.name === 'Maya Rossi' ? mine.playerB.name : mine.playerA.name;
const OTHER = [
  [['Our price is $5.20, the best deal on the road.', 'We will charge $5.40 this week.'], ['Still $5.20.', 'Thank you for choosing us.']],
  [['We are raising our price to $6 and expect our competitor to follow.', 'Fresh coffee with every fill-up.'], ['Our price is $5.90.', '']],
  [['Open 24 hours, now with a car wash.', 'Lowest prices in town, guaranteed.'], ['', 'Car wash free on Sundays.']],
  [['We will stay at $6 as long as our competitor does.', 'Our price: $5.80.'], ['If anyone undercuts $6, we will go to $3.30.', 'We price independently.']]
];
const by = n => bots.find(b => b.name === n);
const scriptOf = new Map();
scriptOf.set(rivalName, { 1: 'A price war helps nobody. $6.50 works for both stations on this road.', 2: '$6.50 again, as announced.' });
pairs.filter(p => p !== mine).forEach((p, i) => { scriptOf.set(p.playerA.name, { 1: OTHER[i][0][0], 2: OTHER[i][1][0] }); scriptOf.set(p.playerB.name, { 1: OTHER[i][0][1], 2: OTHER[i][1][1] }); });
const colluders = new Set([rivalName]);
bots.forEach(b => {
  const say = r => { const t = scriptOf.get(b.name)?.[r]; if (t) setTimeout(() => b.so.emit('announce', { sessionCode: code, text: t, round: r }), 4000 + Math.random() * (ANN * 500)); };
  say(1); b.so.on('announcePhase', ph => { if (ph.round === 2) say(2); });
  b.so.on('roundStarted', ph => setTimeout(() => b.so.emit('submitPrice', { sessionCode: code, price: colluders.has(b.name) ? 6.5 : Math.round((4.6 + Math.random() * 1.6) * 100) / 100, round: ph.round }), 3000 + Math.random() * (PRICE * 500)));
});

// the phone plays
async function typePrice(price) {
  const d = String(Math.floor(price)), c = String(Math.round((price - Math.floor(price)) * 100)).padStart(2, '0');
  await phone.click('.pin2 .dollars'); await phone.keyboard.type(d, { delay: 200 });
  const inCents = await phone.evaluate(() => document.activeElement?.classList.contains('cents'));
  if (!inCents) await phone.keyboard.type('.', { delay: 200 });
  await phone.keyboard.type(c, { delay: 200 });
  await sleep(700); await phone.click('form button[type=submit]');
}
for (const [r, text, price] of [[1, 'Our price is $5.50 a gallon this week.', 5.5], [2, 'After hearing our neighbor: we will be at $6.50 too.', 6.5]]) {
  await phone.waitForSelector('#announce-text', { timeout: 60000 });
  await sleep(5000);
  await phone.type('#announce-text', text, { delay: 70 });
  await sleep(800); await phone.click('#announce-card button.go'); log(`round ${r}: announced`);
  // the reveal = the price form (the Announcements card already holds round 1's pair in round 2)
  await phone.waitForSelector('.pin2 .dollars', { timeout: (ANN + 20) * 1000 }); log(`round ${r}: revealed`);
  await sleep(6000); // reading the rival's announcement
  await typePrice(price); log(`round ${r}: price ${price}`);
  await phone.waitForFunction(rr => /Round \d+ result/.test(document.querySelector('#qcard')?.innerText || document.body.innerText), { timeout: (PRICE + 20) * 1000 }, r).catch(() => {});
}
while (!over) await sleep(300); log('game over');
// the end: the phone's verdict, the dashboard's announcements and review
while (!reviewDone) await sleep(300); log('review done');
await sleep(2500);
await phone.evaluate(() => document.querySelector('#ai-verdict')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
await dash.evaluate(() => document.querySelector('#announcements-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
await sleep(7000);
await phone.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' }));
await dash.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await sleep(1500);
await dash.click('#tab-review').catch(() => {});
await sleep(5000);
await dash.evaluate(() => document.querySelector('.review .rv-row')?.click());
await dash.evaluate(() => document.querySelector('.review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
await sleep(7000);
await recD.stop(); filming = false; await film; const recEnd = Date.now();
await browser.close(); bots.forEach(b => b.so.close()); obs.close();

// the phone's screenshots as a video with their real timing (padded at the start to the dashboard's start)
const list = [`file '${shots[0].f}'`, `duration ${((shots[0].t - recStart) / 1000).toFixed(3)}`];
shots.forEach((x, i) => { list.push(`file '${x.f}'`); list.push(`duration ${(((shots[i + 1]?.t ?? recEnd) - x.t) / 1000).toFixed(3)}`); });
list.push(`file '${shots[shots.length - 1].f}'`);
fs.writeFileSync(path.join(TMP, 'phone.txt'), list.join('\n') + '\n');
execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(TMP, 'phone.txt'), '-vf', 'fps=25,format=yuv420p', '-c:v', 'libx264', '-crf', '20', path.join(TMP, 'phone.mp4')]);
// side by side: the dashboard 1440x900 on the left, the phone scaled to 900 high on the right, on a light background
execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(TMP, 'dash.webm'), '-i', path.join(TMP, 'phone.mp4'), '-filter_complex',
  '[0:v]scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=0xf6f7f9,fps=25[d];[1:v]scale=-2:880,pad=iw+40:900:20:10:color=0xd9dde3,fps=25[p];[d][p]hstack=inputs=2,format=yuv420p[v]',
  '-map', '[v]', '-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-movflags', '+faststart', OUT]);
log('video', OUT);
await fetch(BASE + `/api/session/${code}`, { method: 'DELETE', headers: { 'x-instructor-key': KEY } }).catch(() => {});
process.exit(0);
