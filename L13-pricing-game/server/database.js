import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'game_sessions.db');

// Initialize database
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    session_name TEXT,
    instructor_name TEXT NOT NULL,
    config TEXT NOT NULL,
    status TEXT NOT NULL,
    game_type TEXT DEFAULT 'pricing',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    socket_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    pair_id TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS round_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    opponent_id INTEGER NOT NULL,
    price REAL NOT NULL,
    opponent_price REAL NOT NULL,
    demand REAL NOT NULL,
    profit REAL NOT NULL,
    market_share REAL NOT NULL,
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (opponent_id) REFERENCES players(id) ON DELETE CASCADE
  );

  -- the chat game's messages (2026-11-11, Mert: "save the chat so that when we download the CSV they show up there")
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    from_name TEXT NOT NULL,
    to_name TEXT,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id);

  CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code);
  CREATE INDEX IF NOT EXISTS idx_players_session ON players(session_id);
  CREATE INDEX IF NOT EXISTS idx_rounds_session ON rounds(session_id);
  CREATE INDEX IF NOT EXISTS idx_results_round ON round_results(round_id);
`);

// whether each price was the student's or a random one given at the deadline (Codex review, 2026-11-11); older
// databases get the columns added
for (const col of ['forced', 'opponent_forced']) {
  try { db.exec(`ALTER TABLE round_results ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`); } catch { /* already there */ }
}

// Prepared statements for better performance
const statements = {
  insertSession: db.prepare(`
    INSERT INTO sessions (code, session_name, instructor_name, config, status, game_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  
  updateSessionStatus: db.prepare(`
    UPDATE sessions SET status = ?, completed_at = CURRENT_TIMESTAMP
    WHERE code = ?
  `),
  
  insertPlayer: db.prepare(`
    INSERT INTO players (session_id, socket_id, name, role, pair_id)
    VALUES (?, ?, ?, ?, ?)
  `),
  
  insertRound: db.prepare(`
    INSERT INTO rounds (session_id, round_number)
    VALUES (?, ?)
  `),
  
  insertRoundResult: db.prepare(`
    INSERT INTO round_results (round_id, player_id, opponent_id, price, opponent_price, demand, profit, market_share, forced, opponent_forced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  
  getSessionByCode: db.prepare(`
    SELECT * FROM sessions WHERE code = ?
  `),
  
  getSessionPlayers: db.prepare(`
    SELECT * FROM players WHERE session_id = ?
  `),
  
  getSessionRounds: db.prepare(`
    SELECT * FROM rounds WHERE session_id = ? ORDER BY round_number
  `),
  
  getRoundResults: db.prepare(`
    SELECT rr.*, p1.name as player_name, p2.name as opponent_name
    FROM round_results rr
    JOIN players p1 ON rr.player_id = p1.id
    JOIN players p2 ON rr.opponent_id = p2.id
    WHERE rr.round_id = ?
  `),
  
  getAllSessions: db.prepare(`
    SELECT * FROM sessions ORDER BY created_at DESC
  `)
};

export function saveSession(sessionData) {
  const { code, sessionName, instructorName, config, status, gameType } = sessionData;
  const result = statements.insertSession.run(
    code,
    sessionName || null,
    instructorName,
    JSON.stringify(config),
    status,
    gameType || 'pricing'
  );
  return result.lastInsertRowid;
}

export function updateSessionStatus(code, status) {
  statements.updateSessionStatus.run(status, code);
}

export function savePlayer(sessionId, playerData) {
  const { socketId, name, role, pairId } = playerData;
  const result = statements.insertPlayer.run(
    sessionId,
    socketId,
    name,
    role,
    pairId || null
  );
  return result.lastInsertRowid;
}

export function saveRound(sessionId, roundNumber) {
  const result = statements.insertRound.run(sessionId, roundNumber);
  return result.lastInsertRowid;
}

export function saveRoundResult(roundId, playerDbId, opponentDbId, resultData) {
  const { price, opponentPrice, demand, profit, share, forced, opponentForced } = resultData;
  statements.insertRoundResult.run(
    roundId,
    playerDbId,
    opponentDbId,
    price,
    opponentPrice,
    demand,
    profit,
    share,
    forced ? 1 : 0,
    opponentForced ? 1 : 0
  );
}

export function getSessionData(code) {
  const session = statements.getSessionByCode.get(code);
  if (!session) return null;

  const players = statements.getSessionPlayers.all(session.id);
  const rounds = statements.getSessionRounds.all(session.id);
  
  const roundsWithResults = rounds.map(round => {
    const results = statements.getRoundResults.all(round.id);
    return {
      round: round.round_number,
      timestamp: round.created_at,
      results: results.map(r => ({
        playerId: r.player_id,
        playerName: r.player_name,
        opponentName: r.opponent_name,
        price: r.price,
        opponentPrice: r.opponent_price,
        demand: r.demand,
        profit: r.profit,
        marketShare: r.market_share,
        forced: !!r.forced,
        opponentForced: !!r.opponent_forced
      }))
    };
  });

  return {
    code: session.code,
    sessionName: session.session_name,
    instructorName: session.instructor_name,
    config: JSON.parse(session.config),
    status: session.status,
    createdAt: session.created_at,
    completedAt: session.completed_at,
    players: players.map(p => ({
      name: p.name,
      role: p.role,
      pairId: p.pair_id
    })),
    rounds: roundsWithResults
  };
}

export function getAllSessions() {
  const sessions = statements.getAllSessions.all();
  return sessions.map(s => {
    // Count students (not instructors) for this session
    const studentCount = db.prepare(`
      SELECT COUNT(*) as count FROM players 
      WHERE session_id = ? AND role = 'student'
    `).get(s.id);
    
    return {
      code: s.code,
      sessionName: s.session_name,
      instructorName: s.instructor_name,
      status: s.status,
      gameType: s.game_type || 'pricing',
      createdAt: s.created_at,
      completedAt: s.completed_at,
      config: JSON.parse(s.config),
      studentCount: studentCount.count
    };
  });
}

export function saveChatMessage(sessionId, { round, fromName, toName, message }) {
  db.prepare('INSERT INTO chat_messages (session_id, round_number, from_name, to_name, message) VALUES (?, ?, ?, ?, ?)')
    .run(sessionId, round, fromName, toName || null, message);
}

// every chat message of a game, oldest first: [{ round, from, to, message, at }]
export function getChatMessages(code) {
  const session = statements.getSessionByCode.get(code);
  if (!session) return [];
  return db.prepare('SELECT round_number, from_name, to_name, message, created_at FROM chat_messages WHERE session_id = ? ORDER BY id')
    .all(session.id).map(m => ({ round: m.round_number, from: m.from_name, to: m.to_name, message: m.message, at: m.created_at }));
}

export function getSessionIdByCode(code) {
  const session = statements.getSessionByCode.get(code);
  return session ? session.id : null;
}

export function deleteSession(code) {
  const session = statements.getSessionByCode.get(code);
  if (!session) {
    throw new Error('Session not found');
  }
  
  // Delete session (cascades to players, rounds, and round_results due to foreign keys)
  const deleteStmt = db.prepare('DELETE FROM sessions WHERE code = ?');
  deleteStmt.run(code);
  
  return { success: true, message: 'Session deleted successfully' };
}

export function closeDatabase() {
  db.close();
}

export default db;

