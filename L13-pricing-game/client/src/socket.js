import { io } from 'socket.io-client';

// No URL in a production build means the same server that serves the page (the one-service deployment).
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:4000' : undefined);

export const socket = io(SOCKET_URL, {
  autoConnect: true
});
if (typeof window !== 'undefined') window.__socket = socket; // for testing reconnection from the console

// Send heartbeat every 5 seconds to let server know we're still active
let heartbeatInterval = null;

socket.on('connect', () => {
  // Start sending heartbeats when connected
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  heartbeatInterval = setInterval(() => {
    if (socket.connected) {
      socket.emit('heartbeat');
    }
  }, 5000); // Send every 5 seconds
});

socket.on('disconnect', () => {
  // Stop sending heartbeats when disconnected
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
});

