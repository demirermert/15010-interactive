import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { createGameManager } from './gameLogic.js';

// Server configuration
const PORT = process.env.PORT || 4001;
const allowedOriginEnv = process.env.ALLOWED_ORIGINS;
const allowedOrigins = allowedOriginEnv
  ? allowedOriginEnv.split(',').map(origin => origin.trim()).filter(Boolean)
  : ['*'];

// CORS configuration for both HTTP and WebSocket
const corsConfig = allowedOrigins.includes('*')
  ? { 
      origin: '*', 
      methods: ['GET', 'POST'],
      credentials: true
    }
  : { 
      origin: allowedOrigins, 
      methods: ['GET', 'POST'],
      credentials: true
    };

const app = express();
const server = http.createServer(app);

// Optimize server for high load (60+ concurrent connections)
server.maxHeadersCount = 0; // No limit on headers
server.timeout = 120000; // 2 minutes timeout
server.keepAliveTimeout = 65000; // Keep connections alive

const io = new SocketIOServer(server, { 
  cors: {
    origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['*']
  },
  transports: ['websocket', 'polling'],
  // Performance optimizations for 60+ students
  pingTimeout: 60000, // Wait 60s for ping response before disconnect
  pingInterval: 25000, // Send ping every 25s
  upgradeTimeout: 30000, // Give 30s for transport upgrade
  maxHttpBufferSize: 1e6, // 1MB max message size
  allowEIO3: true, // Support older clients if needed
  connectTimeout: 45000, // 45s connection timeout
  // Enable compression for large payloads
  perMessageDeflate: {
    threshold: 1024 // Compress messages > 1KB
  }
});

app.use(cors(corsConfig));
app.use(express.json());

const manager = createGameManager(io);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/session', (req, res) => {
  try {
    const { instructorName, config } = req.body || {};
    const session = manager.createSession(instructorName, config);
    res.status(201).json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

io.on('connection', socket => {
  console.log(`✅ Client connected: ${socket.id} (Total: ${io.engine.clientsCount})`);
  
  socket.on('joinSession', payload => {
    try {
      manager.handleJoin(socket, payload);
    } catch (err) {
      console.error(`❌ Error in joinSession for ${socket.id}:`, err);
      socket.emit('errorMessage', 'Failed to join session. Please try again.');
    }
  });

  socket.on('startSession', ({ sessionCode }) => {
    try {
      manager.handleStartSession(socket, sessionCode);
    } catch (err) {
      console.error(`❌ Error in startSession for ${socket.id}:`, err);
      socket.emit('errorMessage', 'Failed to start session. Please try again.');
    }
  });

  socket.on('submitFish', payload => {
    try {
      manager.handleFishSubmission(socket, payload);
    } catch (err) {
      console.error(`❌ Error in submitFish for ${socket.id}:`, err);
      socket.emit('errorMessage', 'Failed to submit. Please try again.');
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`❌ Client disconnected: ${socket.id} (Reason: ${reason}, Remaining: ${io.engine.clientsCount - 1})`);
    try {
      manager.handleDisconnect(socket.id);
    } catch (err) {
      console.error(`❌ Error in disconnect handler for ${socket.id}:`, err);
    }
  });
  
  socket.on('error', (error) => {
    console.error(`❌ Socket error for ${socket.id}:`, error);
  });
});

server.listen(PORT, () => {
  console.log(`Tragedy of Commons server listening on port ${PORT}`);
  console.log(`💪 Performance optimizations enabled for 60+ concurrent students`);
  console.log(`📊 WebSocket: ping=${45000}ms, compression enabled`);
  
  // Monitor memory usage every 30 seconds
  setInterval(() => {
    const used = process.memoryUsage();
    const connections = io.engine.clientsCount;
    console.log(`📊 Stats: ${connections} connections | Memory: ${Math.round(used.heapUsed / 1024 / 1024)}MB / ${Math.round(used.heapTotal / 1024 / 1024)}MB`);
    
    // Warn if memory gets high
    if (used.heapUsed / used.heapTotal > 0.9) {
      console.warn(`⚠️ High memory usage: ${Math.round((used.heapUsed / used.heapTotal) * 100)}%`);
    }
  }, 30000);
});

