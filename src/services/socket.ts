import { io, Socket } from 'socket.io-client';
import { UserSession, Room, RoomParticipant, ChatMessage, IceServerConfig } from '../types.ts';

let socket: Socket | null = null;
let currentSession: UserSession | null = null;

// Initialize or retrieve socket connection
export function getSocket(): Socket {
  if (!socket) {
    // Generate an ephemeral anonymous session identifier
    let storedSessionId = sessionStorage.getItem('randomtalks_session_id');
    if (!storedSessionId) {
      storedSessionId = `anonymous-user-${Math.random().toString(36).substring(2, 8)}`;
      sessionStorage.setItem('randomtalks_session_id', storedSessionId);
    }

    let storedName = sessionStorage.getItem('randomtalks_name');
    if (!storedName) {
      const randomNum = Math.floor(10 + Math.random() * 90);
      storedName = `Stranger ${randomNum}`;
      sessionStorage.setItem('randomtalks_name', storedName);
    }

    socket = io({
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected to server, initializing session...');
      socket?.emit('session:init', {
        sessionId: storedSessionId,
        name: storedName,
      });
    });

    socket.on('session:ready', (data: { user: UserSession; iceServers: IceServerConfig[] }) => {
      currentSession = data.user;
      console.log('[Socket] Session ready:', data.user.id, data.user.name);
    });
  }

  return socket;
}

export function getCurrentSession(): UserSession | null {
  return currentSession;
}
