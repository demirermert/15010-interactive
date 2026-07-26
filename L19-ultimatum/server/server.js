import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { createUltimatumGameManager } from './ultimatumGame.js';
import * as db from './database.js';

const PORT = process.env.PORT || 4002;

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

const ultimatumManager = createUltimatumGameManager(io);

app.get('/', (_req, res) => {
  res.send('Ultimatum game API is running. Use /health for status checks.');
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/session', async (req, res) => {
  try {
    const { instructorName, sessionName, config } = req.body || {};
    const session = ultimatumManager.createSession(instructorName, sessionName, config);
    db.saveSession({
      code: session.code,
      sessionName: session.sessionName,
      instructorName: session.instructorName,
      config: session.config,
      status: session.status,
      gameType: 'ultimatum'
    });
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all sessions (for the instructor history list)
app.get('/sessions', (_req, res) => {
  try {
    res.json(db.getAllSessions());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get specific session data
app.get('/session/:code', (req, res) => {
  try {
    const sessionData = db.getSessionData(req.params.code);
    if (!sessionData) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(sessionData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete session
app.delete('/session/:code', (req, res) => {
  try {
    res.json(db.deleteSession(req.params.code));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

io.on('connection', socket => {
  socket.on('joinSession', payload => {
    ultimatumManager.handleJoin(socket, payload);
  });

  socket.on('openLobby', ({ sessionCode }) => {
    ultimatumManager.handleOpenLobby(socket, sessionCode);
  });

  socket.on('startSession', ({ sessionCode }) => {
    ultimatumManager.handleStartSession(socket, sessionCode);
  });

  socket.on('endSession', ({ sessionCode }) => {
    ultimatumManager.handleEndSession(socket, sessionCode);
  });

  socket.on('ultimatum:makeOffer', payload => {
    ultimatumManager.handleMakeOffer(socket, payload);
  });

  socket.on('ultimatum:makeDecision', payload => {
    ultimatumManager.handleMakeDecision(socket, payload);
  });
});

server.listen(PORT, () => {
  console.log(`Ultimatum server listening on port ${PORT}`);
});
