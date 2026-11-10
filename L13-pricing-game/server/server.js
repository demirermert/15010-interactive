import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { createGameManager } from './gameLogic.js';
import * as db from './database.js';
import { initializeOpenAI } from './aiPlayer.js';

const PORT = process.env.PORT || 4000;
// With INSTRUCTOR_KEY set (Render), the instructor pages and the session REST calls need it; students never do.
// On the six section services (lab-a..lab-f) the section's existing DASH_KEY serves as the key (2026-11-07).
const INSTRUCTOR_KEY = process.env.INSTRUCTOR_KEY || process.env.DASH_KEY || '';
if (!INSTRUCTOR_KEY) console.warn('⚠ No INSTRUCTOR_KEY set - anyone who finds /instructor can run the game');

// A classroom game must not die on one bad message: log and carry on (2026-11-02 audit)
process.on('uncaughtException', err => console.error('UNCAUGHT EXCEPTION (kept running):', err));
process.on('unhandledRejection', err => console.error('UNHANDLED REJECTION (kept running):', err));
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize OpenAI for AI player
if (OPENAI_API_KEY) {
  initializeOpenAI(OPENAI_API_KEY);
  console.log('✓ OpenAI API initialized for ChatGPT AI player');
} else {
  console.warn('⚠ No OPENAI_API_KEY found - AI player will use random prices');
}
const allowedOriginEnv = process.env.ALLOWED_ORIGINS;
const allowedOrigins = allowedOriginEnv
  ? allowedOriginEnv.split(',').map(origin => origin.trim()).filter(Boolean)
  : ['*'];
const corsConfig = allowedOrigins.includes('*')
  ? { origin: '*', methods: ['GET', 'POST', 'DELETE'] }
  : { origin: allowedOrigins, methods: ['GET', 'POST', 'DELETE'] };

const app = express();
const server = http.createServer(app);
// Pings every 10 s with a 10 s grace (defaults 25 + 20 s), so a phone whose connection died is seen as offline, and
// reconnects, within about 20 s instead of 45 (2026-11-10); the client's own watchdog uses the same pings.
const io = new SocketIOServer(server, { cors: corsConfig, pingInterval: 10000, pingTimeout: 10000 });

app.use(cors(corsConfig));
app.options('*', cors(corsConfig));
app.use(express.json());

const manager = createGameManager(io, { instructorKey: INSTRUCTOR_KEY });

const requireKey = (req, res, next) => {
  if (!INSTRUCTOR_KEY || req.get('x-instructor-key') === INSTRUCTOR_KEY || req.query.key === INSTRUCTOR_KEY) return next();
  res.status(403).json({ error: 'Instructor key required' });
};
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // a name that looks like a spreadsheet formula stays text
  return '"' + s.replace(/"/g, '""') + '"';
};

// One service for the whole game (2026-11-02): when the client has been built, serve it from here too.
// The client calls the API under /api (as through the Vite proxy in development); page addresses get index.html.
const CLIENT_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false }));
  app.use((req, res, next) => {
    if (req.url.startsWith('/api/')) {
      req.url = req.url.slice(4);
      return next();
    }
    if (req.method === 'GET' && req.path !== '/health') {
      return res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    }
    return next();
  });
}

app.get('/', (_req, res) => {
  res.send('Price competition API is running. Use /health for status checks.');
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/session', requireKey, async (req, res) => {
  try {
    const { instructorName, sessionName, config } = req.body || {};
    const session = await manager.createSession(instructorName, sessionName, config);
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all sessions
app.get('/sessions', requireKey, (_req, res) => {
  try {
    const sessions = db.getAllSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get specific session data
app.get('/session/:code', requireKey, (req, res) => {
  try {
    const code = String(req.params.code).toUpperCase();
    const sessionData = db.getSessionData(code);
    if (!sessionData) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(sessionData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export session data as CSV
app.get('/session/:code/export', requireKey, (req, res) => {
  try {
    const code = String(req.params.code).toUpperCase();
    const sessionData = db.getSessionData(code);
    if (!sessionData) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Generate CSV
    let csv = 'Round,Player Name,Price,Opponent Name,Opponent Price,Quantity,Profit,Market Share\n';
    sessionData.rounds.forEach(round => {
      round.results.forEach(result => {
        csv += `${round.round},${csvCell(result.playerName)},${result.price},${csvCell(result.opponentName)},${result.opponentPrice},${Number(result.demand).toFixed(2)},${Number(result.profit).toFixed(2)},${(Number(result.marketShare) * 100).toFixed(2)}%\n`;
      });
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="session-${code}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete session
app.delete('/session/:code', requireKey, (req, res) => {
  try {
    const code = String(req.params.code).toUpperCase();
    const result = db.deleteSession(code);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

io.on('connection', socket => {
  // Socket.io does not catch exceptions thrown in a handler: one malformed message used to stop the whole server
  // (2026-11-02 audit). Every handler gets an object payload and runs inside a try/catch.
  const safe = (name, fn) => socket.on(name, payload => {
    try {
      fn(payload && typeof payload === 'object' ? payload : {});
    } catch (err) {
      console.error(`[${name}] handler error from ${socket.id}:`, err);
      socket.emit('errorMessage', 'Something went wrong on the server. Please try again.');
    }
  });

  safe('joinSession', payload => manager.handleJoin(socket, payload));
  safe('openLobby', ({ sessionCode }) => manager.handleOpenLobby(socket, sessionCode));
  safe('startSession', ({ sessionCode }) => manager.handleStartSession(socket, sessionCode));
  safe('submitPrice', payload => manager.handlePriceSubmission(socket, payload));
  safe('chatMessage', payload => manager.handleChatMessage(socket, payload));
  safe('endSession', ({ sessionCode }) => manager.handleEndSession(socket, sessionCode));
  safe('heartbeat', () => manager.handleHeartbeat(socket.id));
  socket.on('disconnect', () => {
    try { manager.handleDisconnect(socket.id); } catch (err) { console.error('[disconnect] handler error:', err); }
  });
});

server.on('error', err => {
  // the one error that must still stop the process: without a port there is no game to keep alive
  console.error('Cannot listen on port', PORT, err);
  process.exit(1);
});
server.listen(PORT, () => {
  // Log server start. Keep terse per instructions.
  console.log(`Server listening on port ${PORT}`);
});
