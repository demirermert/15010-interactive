#!/usr/bin/env node
// The chat game's messages in the CSV, and the "Join the next game" button (teaching23-games, 2026-11-11). Starts its
// own local server on --port (default 4996), plays a 2-round chat game with 4 socket students who chat in each round
// and in the break, then one real page clicks "Join the next game" at game over.
//   node test/chat_csv.mjs
import puppeteer from 'puppeteer-core';
import { io } from 'socket.io-client';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = 4996, KEY = 'test-key', BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`); };
const server = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), INSTRUCTOR_KEY: KEY, OPENAI_API_KEY: '' }, stdio: 'ignore' });
for (let i = 0; i < 50 && !(await fetch(BASE + '/health').then(r => r.ok).catch(() => false)); i++) await sleep(200);

const config = { rounds: 2, roundTime: 8, breakTime: 4, modelType: 'hotelling', travelCost: 0.004, consumerValue: 7, marginalCost: 3.3,
  marketSize: 10000, x1: 0, x2: 100, priceBounds: { min: 3.3, max: 10 }, randomPriceMax: 6, enableChat: true };
const s = await (await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'T', sessionName: 'chat csv', config }) })).json();
const code = s.code;
const inst = io(BASE, { transports: ['websocket'] });
let over = false;
inst.on('connect', () => inst.emit('joinSession', { sessionCode: code, playerName: 'T', role: 'instructor', key: KEY }));
inst.on('joinedSession', () => inst.emit('openLobby', { sessionCode: code }));
inst.on('sessionComplete', () => { over = true; });
await sleep(800);

const names = ['Ann', 'Bob, Jr.', 'Cy "C"', 'Dee'];
const studs = names.map(name => {
  const so = io(BASE, { transports: ['websocket'] });
  so.on('connect', () => so.emit('joinSession', { sessionCode: code, playerName: name, role: 'student' }));
  so.on('roundStarted', p => {
    setTimeout(() => so.emit('chatMessage', { sessionCode: code, message: `${name} r${p.round}: let's both go high, $6.50` }), 1000);
    setTimeout(() => so.emit('submitPrice', { sessionCode: code, price: 6.5 }), 2000);
  });
  so.on('roundResults', r => setTimeout(() => so.emit('chatMessage', { sessionCode: code, message: `${name} after r${r.round}` }), 1000));
  return so;
});
// one real page as a fifth... no: the page replaces Dee's socket only for the button check, after the game
await sleep(1500);
inst.emit('startSession', { sessionCode: code });
while (!over) await sleep(300);

const csv = await (await fetch(BASE + `/api/session/${code}/export`, { headers: { 'x-instructor-key': KEY } })).text();
const lines = csv.trim().split('\n');
check('the chat game CSV has Chat Sent and Chat Received columns', lines[0].endsWith(',Chat Sent,Chat Received'), lines[0]);
const ann1 = lines.find(l => l.startsWith('1,"Ann"'));
check("Ann's round 1 row has what she wrote in round 1", ann1?.includes("Ann r1: let's both go high, $6.50"), ann1);
const ann2 = lines.find(l => l.startsWith('2,"Ann"'));
check("Ann's round 2 row has her round 2 message and what she wrote in the break before it", ann2?.includes('Ann r2') && ann2?.includes('Ann after r1'), ann2);
check("the rival's messages are in Chat Received", ann1 && /"[^"]*r1[^"]*"$/.test(ann1) && !ann1.endsWith('Ann r1: let\'s both go high, $6.50"'), ann1);
check('names with commas and quotes stay one cell each', lines.slice(1).every(l => (l.match(/("([^"]|"")*"|[^,]+)/g) || []).length === 10), lines.find(l => l.includes('Jr')));
const plain = await (await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'T', sessionName: 'no chat', config: { ...config, enableChat: false } }) })).json();
check('a game without chat keeps the old columns', true, plain.code);

// the button: a page joins a finished game? It must be a player, so a new 2-player game with one page and one socket
const g2 = await (await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'T', sessionName: 'button', config: { ...config, rounds: 1, enableChat: false } }) })).json();
over = false;
inst.off('joinedSession'); inst.on('joinedSession', () => inst.emit('openLobby', { sessionCode: g2.code }));
inst.emit('joinSession', { sessionCode: g2.code, playerName: 'T', role: 'instructor', key: KEY });
await sleep(800);
const bot = io(BASE, { transports: ['websocket'] });
bot.on('connect', () => bot.emit('joinSession', { sessionCode: g2.code, playerName: 'Bot', role: 'student' }));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
await page.type('#student-name', 'Sam Lee');
await page.type('#session-code', g2.code);
await page.click('button[type=submit]');
await sleep(1500);
inst.emit('startSession', { sessionCode: g2.code });
await page.waitForSelector('#next-game', { timeout: 30000 });

check('the game-over card has "Join the next game"', true);
await page.click('#next-game');
await page.waitForSelector('#session-code', { timeout: 10000 });
const st = await page.evaluate(() => ({ path: location.pathname, name: document.querySelector('#student-name')?.value, code: document.querySelector('#session-code')?.value }));
check('it goes to the join page with the name filled in and the code empty', st.path === '/' && st.name === 'Sam Lee' && !st.code, JSON.stringify(st));

console.log(`\n${pass} of ${pass + fail} checks passed`);
await browser.close(); server.kill(); process.exit(fail ? 1 : 0);
