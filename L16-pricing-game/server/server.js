import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { createGameManager } from './gameLogic.js';
import { createUltimatumGameManager } from './ultimatumGame.js';
import * as db from './database.js';
import { initializeOpenAI } from './aiPlayer.js';

const PORT = process.env.PORT || 4000;
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
const io = new SocketIOServer(server, { cors: corsConfig });

app.use(cors(corsConfig));
app.options('*', cors(corsConfig));
app.use(express.json());

const manager = createGameManager(io);
const ultimatumManager = createUltimatumGameManager(io);

app.get('/', (_req, res) => {
  res.send('Price competition API is running. Use /health for status checks.');
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/session', async (req, res) => {
  try {
    const { instructorName, sessionName, config, gameType } = req.body || {};
    
    if (gameType === 'ultimatum') {
      const session = ultimatumManager.createSession(instructorName, sessionName, config);
      // Save to database
      db.saveSession({
        code: session.code,
        sessionName: session.sessionName,
        instructorName: session.instructorName,
        config: session.config,
        status: session.status,
        gameType: 'ultimatum'
      });
      res.status(201).json(session);
    } else {
      const session = await manager.createSession(instructorName, sessionName, config);
      res.status(201).json(session);
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all sessions
app.get('/sessions', (_req, res) => {
  try {
    const sessions = db.getAllSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get specific session data
app.get('/session/:code', (req, res) => {
  try {
    const { code } = req.params;
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
app.get('/session/:code/export', (req, res) => {
  try {
    const { code } = req.params;
    const sessionData = db.getSessionData(code);
    if (!sessionData) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Generate CSV
    let csv = 'Round,Player Name,Price,Opponent Name,Opponent Price,Demand,Profit,Market Share\n';
    sessionData.rounds.forEach(round => {
      round.results.forEach(result => {
        csv += `${round.round},"${result.playerName}",${result.price},"${result.opponentName}",${result.opponentPrice},${result.demand.toFixed(2)},${result.profit.toFixed(2)},${(result.marketShare * 100).toFixed(2)}%\n`;
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
app.delete('/session/:code', (req, res) => {
  try {
    const { code } = req.params;
    const result = db.deleteSession(code);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

io.on('connection', socket => {
  socket.on('joinSession', payload => {
    // Try ultimatum first, then pricing game
    const handled = ultimatumManager.handleJoin(socket, payload);
    if (!handled) {
      manager.handleJoin(socket, payload);
    }
  });

  socket.on('openLobby', ({ sessionCode }) => {
    const handled = ultimatumManager.handleOpenLobby(socket, sessionCode);
    if (!handled) {
      manager.handleOpenLobby(socket, sessionCode);
    }
  });

  socket.on('startSession', ({ sessionCode }) => {
    const handled = ultimatumManager.handleStartSession(socket, sessionCode);
    if (!handled) {
      manager.handleStartSession(socket, sessionCode);
    }
  });

  socket.on('submitPrice', payload => {
    manager.handlePriceSubmission(socket, payload);
  });

  socket.on('chatMessage', payload => {
    manager.handleChatMessage(socket, payload);
  });

  socket.on('endSession', ({ sessionCode }) => {
    const handled = ultimatumManager.handleEndSession(socket, sessionCode);
    if (!handled) {
      manager.handleEndSession(socket, sessionCode);
    }
  });

  // Ultimatum game specific events
  socket.on('ultimatum:makeOffer', payload => {
    ultimatumManager.handleMakeOffer(socket, payload);
  });

  socket.on('ultimatum:makeDecision', payload => {
    ultimatumManager.handleMakeDecision(socket, payload);
  });

  socket.on('heartbeat', () => {
    manager.handleHeartbeat(socket.id);
  });

  socket.on('disconnect', () => {
    manager.handleDisconnect(socket.id);
  });
});

server.listen(PORT, () => {
  // Log server start. Keep terse per instructions.
  console.log(`Server listening on port ${PORT}`);
});
