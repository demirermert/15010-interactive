#!/usr/bin/env node
// The fixes from the Codex review of 2026-11-11 (teaching23-games). Starts its own local server on port 4995.
//   node test/review_fixes.mjs
// 1. a price marked for an earlier round is refused, the right round's and an unmarked one are taken
// 2. the page says "Sending" until the server confirms, offers "Send again", and ends on the confirmed price
// 4. a fresh load of a personal link whose game is gone shows the stopped-game card, not an endless "Joining"
// 7. the chat comes back after a reload, with my messages still mine
// 8. in a chat game the student facing the AI seat sees "no chat"
// 9-10. equal profits are a tie (not a win) and equal totals share a place
import puppeteer from 'puppeteer-core';
import { io } from 'socket.io-client';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = 4995, KEY = 'test-key', BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`); };
const server = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), INSTRUCTOR_KEY: KEY, OPENAI_API_KEY: '' }, stdio: 'ignore' });
for (let i = 0; i < 50 && !(await fetch(BASE + '/health').then(r => r.ok).catch(() => false)); i++) await sleep(200);

const base = { rounds: 2, roundTime: 40, breakTime: 3, modelType: 'hotelling', travelCost: 0.01, consumerValue: 7, marginalCost: 3.3,
  marketSize: 10000, x1: 0, x2: 100, priceBounds: { min: 3.3, max: 10 }, randomPriceMax: 6, enableChat: false };
async function game(cfg) {
  const s = await (await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
    body: JSON.stringify({ instructorName: 'T', sessionName: 't', config: { ...base, ...cfg } }) })).json();
  const inst = io(BASE, { transports: ['websocket'] });
  const g = { code: s.code, inst, over: false, round: 0 };
  inst.on('connect', () => inst.emit('joinSession', { sessionCode: s.code, playerName: 'T', role: 'instructor', key: KEY }));
  inst.on('joinedSession', () => inst.emit('openLobby', { sessionCode: s.code }));
  inst.on('roundStarted', p => { g.round = p.round; });
  inst.on('sessionComplete', () => { g.over = true; });
  await sleep(600);
  g.start = () => inst.emit('startSession', { sessionCode: s.code });
  return g;
}
function bot(code, name, onEv = {}) {
  const so = io(BASE, { transports: ['websocket'] });
  so.on('connect', () => so.emit('joinSession', { sessionCode: code, playerName: name, role: 'student' }));
  Object.entries(onEv).forEach(([ev, fn]) => so.on(ev, fn));
  return so;
}
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(200); } return false; };
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
async function joinPage(code, name) {
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await p.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await p.type('#student-name', name); await p.type('#session-code', code); await p.click('button[type=submit]');
  await sleep(1200);
  return p;
}
async function typePrice(p, d, c) {
  await p.waitForSelector('input.dollars:not([disabled])', { timeout: 30000 });
  await p.type('input.dollars', d); await p.focus('input.cents'); await p.type('input.cents', c);
  await p.click('form button.go[type=submit]');
}
const has = (p, sel) => p.$(sel).then(Boolean);

try {
  // 1. late price
  {
    const g = await game({ rounds: 2, roundTime: 5, breakTime: 3 });
    const errs = [], acks = [];
    const a = bot(g.code, 'Ann', { errorMessage: m => errs.push(m), priceAccepted: p => acks.push(p) });
    bot(g.code, 'Bob', { roundStarted: () => {} });
    await sleep(800); g.start();
    await until(() => g.round === 2);
    await sleep(500);
    a.emit('submitPrice', { sessionCode: g.code, price: 9, round: 1 });
    await sleep(500);
    check('a price marked for round 1 is refused in round 2', errs.some(e => /was for round 1/.test(e)) && !acks.some(x => x.price === 9), JSON.stringify(errs));
    a.emit('submitPrice', { sessionCode: g.code, price: 5, round: 2 });
    await sleep(400);
    check("round 2's own price is taken", acks.some(x => x.round === 2 && x.price === 5));
    a.emit('submitPrice', { sessionCode: g.code, price: 6 });
    await sleep(400);
    check('a price with no round (a page from before the change) is still taken', acks.some(x => x.price === 6));
  }

  // 2. Sending / Send again / confirmed
  {
    const g = await game({ rounds: 1, roundTime: 45 });
    bot(g.code, 'Rival', { roundStarted: function () { setTimeout(() => this, 0); } });
    const p = await joinPage(g.code, 'Sam');
    g.start();
    await p.waitForSelector('input.dollars:not([disabled])', { timeout: 20000 });
    // a lost message: the page's socket drops anything carrying submitPrice (offline mode does not cut an open websocket)
    await p.evaluate(() => { const o = WebSocket.prototype.send; window.__drop = true;
      WebSocket.prototype.send = function (d) { if (window.__drop && typeof d === 'string' && d.includes('submitPrice')) return; return o.call(this, d); }; });
    await typePrice(p, '7', '25');
    await sleep(1500);
    check('a lost price: the page says Sending, not Submitted', await has(p, '#price-sending') && !(await has(p, '#price-ok')));
    await sleep(6500);
    check('after 6 s unconfirmed it offers Send again', await has(p, '#send-again'));
    await p.evaluate(() => { window.__drop = false; });
    await p.click('#send-again');
    const ok = await until(() => has(p, '#price-ok'), 8000);
    const txt = ok ? await p.$eval('#price-ok', e => e.textContent) : '';
    check('Send again gets it through and it ends on "Submitted at $7.25"', ok && txt.includes('7.25'), txt);
    await p.close();
  }

  // 4. personal link of a game that is gone
  {
    const p = await browser.newPage();
    await p.goto(BASE + '/session/ZQZQ/ABC123', { waitUntil: 'networkidle2' });
    check('a gone game shows the stopped-game card on a fresh load', await until(() => has(p, '#game-gone'), 10000));
    await p.close();
  }

  // 7 + 8. chat history after a reload; AI rival = no chat
  {
    const g = await game({ rounds: 1, roundTime: 40, enableChat: true, travelCost: 0.004 });
    const b = bot(g.code, 'Rival');
    const p = await joinPage(g.code, 'Sam');
    g.start();
    await p.waitForSelector('.chatrow input', { timeout: 20000 });
    b.emit('chatMessage', { sessionCode: g.code, message: 'hello from rival' });
    await sleep(400);
    await p.type('.chatrow input', 'hello from Sam'); await p.click('.chatrow button');
    await sleep(400);
    b.emit('chatMessage', { sessionCode: g.code, message: 'second from rival' });
    await sleep(600);
    await p.reload({ waitUntil: 'networkidle2' });
    await until(() => p.$$eval('.chat .m', ms => ms.length >= 3).catch(() => false), 15000);
    const ms = await p.$$eval('.chat .m', ms => ms.map(m => ({ me: m.classList.contains('me'), t: m.textContent })));
    check('after a reload the three chat messages are back', ms.length === 3, JSON.stringify(ms));
    check('...and mine is still on my side', ms.find(m => m.t.includes('from Sam'))?.me === true && ms.filter(m => m.me).length === 1, JSON.stringify(ms));
    await p.close();

    const g2 = await game({ rounds: 1, roundTime: 20, enableChat: true, travelCost: 0.004 });
    const p2 = await joinPage(g2.code, 'Solo');
    g2.start();
    check('facing the AI seat, the chat card says there is no chat', await until(() => has(p2, '#chat-off'), 15000) && !(await has(p2, '.chatrow input')));
    await p2.close();
  }

  // 9-10. tie: Game 1, $3.31 vs $4.29 both earn $99
  {
    const g = await game({ rounds: 1, roundTime: 30 });
    const rv = bot(g.code, 'Rival');
    rv.on('roundStarted', () => setTimeout(() => rv.emit('submitPrice', { sessionCode: g.code, price: 4.29 }), 500));
    const p = await joinPage(g.code, 'Sam');
    g.start();
    await typePrice(p, '3', '31');
    await p.waitForSelector('#next-game', { timeout: 45000 });
    const t = await p.evaluate(() => document.body.innerText);
    check('equal profits ($99 each) are not a win', /Rounds won\s+0 of 1\s+0 of 1/.test(t), (t.match(/Rounds won[^\n]*/) || [''])[0]);
    check('equal totals share first place', /You placed 1 of 2 in the class by total profit, tied with 1 other/.test(t), (t.match(/You placed[^\n]*/) || [''])[0]);
    await p.close();
  }
} catch (e) { check('no crash', false, e.stack); }

console.log(`\n${pass} of ${pass + fail} checks passed`);
await browser.close(); server.kill(); process.exit(fail ? 1 : 0);
