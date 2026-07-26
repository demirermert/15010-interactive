import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export const socket = io(SOCKET_URL, {
  autoConnect: true
});

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

