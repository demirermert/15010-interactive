import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001';

console.log('🔌 Socket.IO Configuration:');
console.log('  VITE_SOCKET_URL env var:', import.meta.env.VITE_SOCKET_URL);
console.log('  Connecting to:', SOCKET_URL);
console.log('  All env vars:', import.meta.env);

export const socket = io(SOCKET_URL, {
  autoConnect: true,
  // Optimize for reliability with many concurrent users
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  transports: ['websocket', 'polling'], // Prefer websocket, fallback to polling
  upgrade: true,
  rememberUpgrade: true,
  // Enable compression for large payloads
  perMessageDeflate: {
    threshold: 1024
  }
});

// Add connection monitoring for debugging
socket.on('connect', () => {
  console.log('✅ Connected to server:', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('❌ Disconnected from server:', reason);
  if (reason === 'io server disconnect') {
    // Server disconnected us, manually reconnect
    socket.connect();
  }
});

socket.on('reconnect', (attemptNumber) => {
  console.log('🔄 Reconnected after', attemptNumber, 'attempts');
});

socket.on('reconnect_attempt', (attemptNumber) => {
  console.log('🔄 Attempting to reconnect...', attemptNumber);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error.message);
});


