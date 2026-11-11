#!/usr/bin/env node
// Copies a finished game from a service into the LOCAL database (server/game_sessions.db), so the instructor dashboard
// can be reworked against real results on a local server without replaying the game (teaching23-games, 2026-11-11).
// Run from the L13-pricing-game folder with the local server stopped, then start it and open /manage/<CODE>:
//   node test/import_session.mjs --host https://lab-a.onrender.com --key <instructor key> --code HVHK

import * as db from '../server/database.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(x => x.length));
const BASE = String(args.host).replace(/\/$/, '');
const code = String(args.code).toUpperCase();
const res = await fetch(`${BASE}/api/session/${code}`, { headers: { 'x-instructor-key': String(args.key) } });
if (!res.ok) { console.error('could not read', code, res.status); process.exit(1); }
const s = await res.json();
if (db.getSessionIdByCode(code)) db.deleteSession(code);
const sid = db.saveSession({ code, sessionName: s.sessionName, instructorName: s.instructorName || 'Instructor', config: s.config, status: 'complete' });
const ids = new Map();
const pid = name => { if (!ids.has(name)) ids.set(name, db.savePlayer(sid, { socketId: `import-${name}`, name, role: /ChatGPT|AI Player/.test(name) ? 'ai' : 'student', pairId: null })); return ids.get(name); };
(s.players || []).forEach(p => pid(p.name));
for (const r of s.rounds || []) {
  const rid = db.saveRound(sid, r.round);
  for (const x of r.results) db.saveRoundResult(rid, pid(x.playerName), pid(x.opponentName), { price: x.price, opponentPrice: x.opponentPrice, demand: x.demand, profit: x.profit, share: x.marketShare });
}
db.updateSessionStatus(code, 'complete');
console.log(`imported ${code} "${s.sessionName}": ${ids.size} players, ${(s.rounds || []).length} rounds`);
