#!/usr/bin/env node
// Records one game as Mert would see it (teaching23-games, 2026-11-11): a video of the instructor dashboard (laptop
// size, driven through its own buttons: Open the lobby, Start the game) and a video of one student's phone (iPhone
// size, joining through the join page and typing prices into the dollars and cents boxes), with a few scripted
// students (bots.mjs) so there are real pairs. Writes instructor.mp4, student.mp4 and index.html (both side by side).
//
//   node record.mjs --host http://127.0.0.1:4998 --key <key> [--bots 7] [--rounds 3] [--round-time 25] [--out DIR]

import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
const BASE = String(args.host).replace(/\/$/, '');
const KEY = String(args.key);
const OUT = args.out && args.out !== true ? String(args.out) : fs.mkdtempSync(path.join(os.tmpdir(), 'l13-record-'));
fs.mkdirSync(OUT, { recursive: true });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rounds = Number(args.rounds || 3), rt = Number(args['round-time'] || 25);
const config = {
  rounds, roundTime: Array(rounds).fill(rt), breakTime: 10, modelType: 'hotelling', travelCost: 0.01, consumerValue: 7,
  marginalCost: 3.3, marketSize: 10000, x1: 0, x2: 100, priceBounds: { min: 3.3, max: 10 }, randomPriceMax: 6, showOpponentName: false
};
const res = await fetch(BASE + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-instructor-key': KEY },
  body: JSON.stringify({ instructorName: 'Mert', sessionName: 'Game 1 (recorded)', config }) });
const { code } = await res.json();
console.log('session', code);

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });

// the instructor
const ictx = await browser.createBrowserContext();
const dash = await ictx.newPage();
await dash.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await dash.goto(`${BASE}/instructor?key=${encodeURIComponent(KEY)}`, { waitUntil: 'networkidle2' });
await dash.goto(`${BASE}/manage/${code}`, { waitUntil: 'networkidle2' });
const dashRec = await dash.screencast({ path: path.join(OUT, 'instructor.webm') });
const dashT0 = Date.now(); // the instructor video's time zero; the phone frames are placed on the same clock
await sleep(2500);
const clickButton = async (page, text) => {
  const ok = await page.evaluate(t => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t && !x.disabled); if (b) b.click(); return !!b; }, text);
  if (!ok) console.log('no button:', text);
};
await clickButton(dash, 'Open the lobby');
await sleep(2000);

// the student, on a phone
const sctx = await browser.createBrowserContext();
const phone = await sctx.newPage();
await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
// Chrome's screencast draws an emulated phone in a corner of the frame, so the phone is filmed as screenshots, 5 a second
const frames = path.join(OUT, 'frames'); fs.mkdirSync(frames, { recursive: true });
let frameN = 0, filming = true;
const frameTimes = []; // when each phone frame was taken, so the video runs in real time
const film = (async () => { while (filming) { const t = Date.now(); const f = path.join(frames, `f${String(frameN++).padStart(5, '0')}.png`); try { await phone.screenshot({ path: f }); frameTimes.push({ f, t }); } catch {} await sleep(Math.max(0, 200 - (Date.now() - t))); } })();
const phoneRec = { stop: async () => { filming = false; await film; } };
await phone.goto(BASE + '/', { waitUntil: 'networkidle2' });
await sleep(1200);
await phone.type('#student-name', 'Mert', { delay: 90 });
await phone.type('#session-code', code, { delay: 120 });
await sleep(600);
await phone.click('button[type=submit]');
await sleep(1500);

// the rest of the class
const bots = spawn(process.execPath, [path.join(HERE, 'bots.mjs'), '--host', BASE, '--code', code, '--n', String(args.bots || 7)], { stdio: 'ignore' });
await sleep(5000);
await clickButton(dash, 'Start the game');

// the student plays: a price a few seconds into each round
const readCase = () => phone.evaluate(() => document.querySelector('#qcard .case')?.textContent || '').catch(() => '');
const prices = [4.29, 4.55, 3.95, 4.4, 4.1];
for (let r = 1; r <= rounds; r++) {
  while (!new RegExp(`^Round ${r} of`).test(await readCase())) await sleep(300);
  await sleep(4000);
  const p = prices[(r - 1) % prices.length];
  await phone.click('.pin2 .dollars');
  await phone.keyboard.type(String(Math.floor(p)), { delay: 250 });
  await phone.keyboard.type(String(Math.round((p % 1) * 100)).padStart(2, '0'), { delay: 250 });
  await sleep(700);
  await phone.click('form button[type=submit]');
  if (r === 1) { await sleep(2500); await phone.evaluate(() => window.scrollTo({ top: 99999, behavior: 'smooth' })); await sleep(2500); await phone.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }
}
while (!/^Game over/.test(await readCase())) await sleep(400);
await sleep(3000);
await phone.evaluate(() => window.scrollTo({ top: 99999, behavior: 'smooth' }));
await sleep(3000);
await phone.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await sleep(1500);
await phoneRec.stop();

// the instructor looks through the panels, hovers a market, picks one by name
await sleep(1500);
for (const label of ['Average price across rounds', 'Total profit by pair', 'Individual profits by pair']) {
  await dash.evaluate(l => [...document.querySelectorAll('.section-label')].find(e => e.textContent.startsWith(l))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), label);
  await sleep(2200);
}
const dot = await dash.evaluate(() => {
  const svg = [...document.querySelectorAll('.panel')].find(p => p.textContent.includes('Individual profits by pair'))?.querySelector('svg');
  const c = svg?.querySelector('circle'); if (!c) return null; const b = c.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
if (dot) { await dash.mouse.move(dot.x - 120, dot.y + 60, { steps: 10 }); await dash.mouse.move(dot.x, dot.y, { steps: 15 }); await sleep(3500); await dash.mouse.move(dot.x + 300, dot.y + 300, { steps: 10 }); }
await dash.evaluate(() => [...document.querySelectorAll('.section-label')].find(e => e.textContent.startsWith('One market'))?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
await sleep(1500);
await dash.click('input[placeholder="Type a student\'s name"]');
await dash.keyboard.type('Mert', { delay: 150 });
await sleep(3500);
await dashRec.stop();
bots.kill();
await browser.close();

// to mp4 for Safari
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'instructor.webm'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, 'instructor.mp4')]);
// the phone in real time on the instructor's clock: the first frame held from the instructor's time zero, then each
// frame for as long as it was on screen (ffmpeg concat with durations)
const list = [];
const lead = Math.max(0.04, (frameTimes[0].t - dashT0) / 1000);
list.push(`file '${frameTimes[0].f}'`, `duration ${lead.toFixed(3)}`);
frameTimes.forEach((x, k) => { const next = frameTimes[k + 1]?.t ?? x.t + 200; list.push(`file '${x.f}'`, `duration ${((next - x.t) / 1000).toFixed(3)}`); });
list.push(`file '${frameTimes[frameTimes.length - 1].f}'`);
fs.writeFileSync(path.join(frames, 'list.txt'), list.join('\n'));
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(frames, 'list.txt'), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, 'student.mp4')]);
// one video, both screens side by side on the same clock (the phone holds its last frame once it stops)
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'instructor.mp4'), '-i', path.join(OUT, 'student.mp4'),
  '-filter_complex', '[0:v]scale=-2:900,setsar=1[a];[1:v]scale=-2:900,setsar=1,tpad=stop_mode=clone:stop_duration=600[b];[a][b]hstack=inputs=2:shortest=1[v]',
  '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, 'both.mp4')]);
fs.rmSync(frames, { recursive: true, force: true });
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Game 1 recorded</title>
<style>body{margin:16px;font:14px -apple-system,sans-serif;background:#f6f7f9}.row{display:flex;gap:20px;align-items:flex-start}h3{margin:4px 0 8px}</style>
<h2>Game 1, recorded (session ${code}, ${rounds} rounds of ${rt} s, ${Number(args.bots || 7) + 1} students + the AI seat)</h2>
<p>Instructor dashboard on the left, the student's phone on the right, on the same clock.</p>
<video src="both.mp4" controls autoplay muted style="width:100%;max-width:1500px;border:1px solid #ccc;border-radius:8px"></video>`);
console.log('done:', path.join(OUT, 'index.html'));
process.exit(0);
