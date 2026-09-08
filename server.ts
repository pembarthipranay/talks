import express from 'express';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { Room, RoomParticipant, ChatMessage, ReportReason } from './src/types.ts';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;

// Set up Socket.IO with CORS, WebSockets + Polling, and ping keepalive for Render
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 6 * 1024 * 1024, // 6 MB for ephemeral image transfer
});

app.use(express.json({ limit: '6mb' }));

// In-memory Ephemeral State
interface ConnectedUser {
  socketId: string;
  sessionId: string;
  name: string;
  avatarSeed: string;
  currentRoomId: string | null;
  pairedStrangerId: string | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeaking: boolean;
  blockedUsers: Set<string>;
  joinedAt: number;
}

const usersBySession = new Map<string, ConnectedUser>();
const usersBySocket = new Map<string, ConnectedUser>();
let waitingQueue: string[] = []; // Session IDs waiting for 1-on-1 random talk
const activeRooms = new Map<string, Room>();

// Seed a few interesting starter public rooms if none exist, so users can explore immediately
function seedDefaultRooms() {
  const defaults = [
    {
      id: 'room-latenight',
      token: 'tok-latenight',
      type: 'public' as const,
      name: 'Late Night Thoughts',
      description: 'Chill voices from around the world discussing life, universe, and everything.',
      creatorId: 'system-ambient',
      maxParticipants: 12,
      participants: [],
      createdAt: Date.now() - 3600000,
    },
    {
      id: 'room-music-chill',
      token: 'tok-music-chill',
      type: 'public' as const,
      name: 'Global Ambient Lounge',
      description: 'Open mic for music enthusiasts, background soundscapes, and relaxed talks.',
      creatorId: 'system-ambient',
      maxParticipants: 16,
      participants: [],
      createdAt: Date.now() - 7200000,
    },
    {
      id: 'room-tech-future',
      token: 'tok-tech-future',
      type: 'public' as const,
      name: 'Deep Tech & Futurism',
      description: 'Robotics, space travel, AI philosophy, and high-frontier exploration.',
      creatorId: 'system-ambient',
      maxParticipants: 8,
      participants: [],
      createdAt: Date.now() - 1800000,
    }
  ];

  for (const r of defaults) {
    if (!activeRooms.has(r.id)) {
      activeRooms.set(r.id, r);
    }
  }
}

seedDefaultRooms();

// ICE Servers configuration:
// For the current MVP, only the STUN server 'stun:stun.l.google.com:19302' is used.
// TURN_SERVER, TURN_USERNAME, and TURN_PASSWORD are completely optional.
// TURN is only configured when all three environment variables are actually present.
const STUN_SERVER = 'stun:stun.l.google.com:19302';

function getIceServers(): RTCIceServer[] {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.services.mozilla.com:3478' },
    { urls: 'stun:stun.syncthing.net:3478' },
  ];

  const turnServer = process.env.TURN_SERVER?.trim();
  const turnUsername = process.env.TURN_USERNAME?.trim();
  const turnPassword = process.env.TURN_PASSWORD?.trim();

  // Only add a TURN server when all three TURN environment variables are actually present
  if (turnServer && turnUsername && turnPassword) {
    iceServers.push({
      urls: turnServer,
      username: turnUsername,
      credential: turnPassword,
    });
  }

  return iceServers;
}

// Gemini AI Lazy Initialization
let aiClient: GoogleGenAI | null = null;
function getAi(): GoogleGenAI | null {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    try {
      aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } catch (e) {
      console.warn('Failed to initialize Gemini AI client:', e);
    }
  }
  return aiClient;
}

const FALLBACK_TOPICS = [
  "If you could teleport anywhere in the world right now for 1 hour, where would you go?",
  "What is a piece of advice you received that completely changed your perspective?",
  "If you had to listen to only one song on repeat for the rest of your life, what is it?",
  "What is an unexpected hobby or skill you picked up recently?",
  "Would you rather live 100 years in the past or 100 years in the future?",
  "What's the best meal you've ever had in your life?",
  "What is something you believed as a child that turned out to be hilarious or false?",
  "If you could instantly master any musical instrument, which one would you pick?",
  "What is a movie, book, or story that left a lasting impact on you?",
  "What is the most underrated superpower in fiction?"
];

// REST API Endpoints
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    onlineUsers: usersBySession.size,
    waitingUsers: waitingQueue.length,
    activeRooms: activeRooms.size,
    timestamp: Date.now(),
  });
});

app.get('/api/ai/icebreaker', async (req, res) => {
  try {
    const ai = getAi();
    if (ai) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: 'Generate a single, fun, thought-provoking conversation starter question for two strangers meeting on voice chat. Keep it under 25 words. Return only the question without quotation marks.',
      });
      const topic = response.text?.trim().replace(/^["']|["']$/g, '');
      if (topic) {
        return res.json({ topic, source: 'gemini-3.8-flash' });
      }
    }
  } catch (err: any) {
    console.warn('Gemini API call error (using fallback):', err?.message || err);
  }

  const randomFallback = FALLBACK_TOPICS[Math.floor(Math.random() * FALLBACK_TOPICS.length)];
  res.json({ topic: randomFallback, source: 'curated' });
});

app.get('/api/ice-servers', (req, res) => {
  res.json({
    iceServers: getIceServers(),
  });
});

app.get('/api/rooms', (req, res) => {
  const publicRooms = Array.from(activeRooms.values())
    .filter(r => r.type === 'public')
    .map(r => ({
      ...r,
      participantCount: r.participants.length,
    }));
  res.json(publicRooms);
});

app.get('/api/room/:roomId', (req, res) => {
  const room = activeRooms.get(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json(room);
});

// REST endpoint to create room directly for maximum network reliability
app.post('/api/rooms', (req, res) => {
  const { name, description, type, maxParticipants, creatorId } = req.body || {};
  const roomName = (name || 'Conversation Room').trim().slice(0, 50);
  const roomDesc = (description || 'Join to talk and share ideas').trim().slice(0, 200);
  const roomType = type === 'private' ? 'private' : 'public';
  const capacity = Math.max(3, Math.min(20, Number(maxParticipants) || 12));

  const roomId = `room-${Math.random().toString(36).substring(2, 9)}`;
  const roomToken = `tok-${Math.random().toString(36).substring(2, 12)}`;

  const newRoom: Room = {
    id: roomId,
    token: roomToken,
    type: roomType,
    name: roomName,
    description: roomDesc,
    creatorId: creatorId || 'anon-creator',
    maxParticipants: capacity,
    participants: [],
    createdAt: Date.now(),
  };

  activeRooms.set(roomId, newRoom);
  io.emit('rooms:updated', Array.from(activeRooms.values()).filter(r => r.type === 'public'));
  io.emit('stats:update', {
    onlineUsers: usersBySession.size,
    waitingUsers: waitingQueue.length,
    activeRooms: activeRooms.size,
  });

  res.json({ status: 'ok', room: newRoom });
});

// AI Strangers for instant 1-on-1 conversations when user is testing alone
interface AiStrangerPersona {
  id: string;
  name: string;
  avatarSeed: string;
  bio: string;
  initialGreeting: string;
}

const AI_STRANGERS: AiStrangerPersona[] = [
  {
    id: 'ai-maya-tokyo',
    name: 'Maya (Tokyo)',
    avatarSeed: 'maya-tokyo',
    bio: 'Photographer and architecture enthusiast exploring Shibuya.',
    initialGreeting: "Hey there! Greetings from Tokyo. Cool connecting with you—what are you up to today?",
  },
  {
    id: 'ai-alex-london',
    name: 'Alex (London)',
    avatarSeed: 'alex-london',
    bio: 'Music producer, synth collector, and night owl.',
    initialGreeting: "Hello! Cool to cross paths. Just sipping some tea and messing with drum machines. How's your day going?",
  },
  {
    id: 'ai-elena-barcelona',
    name: 'Elena (Barcelona)',
    avatarSeed: 'elena-barcelona',
    bio: 'Visual designer and coffee nerd living by the Mediterranean.',
    initialGreeting: "Hola! Nice to meet you from Barcelona. What corner of the world are you tuning in from?",
  },
  {
    id: 'ai-sam-sf',
    name: 'Sam (San Francisco)',
    avatarSeed: 'sam-sf',
    bio: 'Robotics hacker and deep space astronomy fan.',
    initialGreeting: "Hey! Glad to meet you. Just checking out new tech. What is on your mind right now?",
  },
  {
    id: 'ai-liam-melbourne',
    name: 'Liam (Melbourne)',
    avatarSeed: 'liam-melbourne',
    bio: 'Indie game coder and avid cyclist.',
    initialGreeting: "G'day! Good to connect with you. How is everything on your end?",
  },
];

async function generateAiStrangerReply(persona: AiStrangerPersona, userMessage: string): Promise<string> {
  const ai = getAi();
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `You are ${persona.name} on an anonymous real-time chat platform like Omegle.
Your persona background: ${persona.bio}.
The stranger you're talking to just sent: "${userMessage}".
Reply in 1 or 2 friendly, authentic, conversational sentences, just like a real person on a casual call.
Do NOT sound like an AI assistant or robot. Never say "As an AI". Keep it concise, natural, and warm.`,
      });
      const text = response.text?.trim();
      if (text) return text;
    } catch (err) {
      console.warn('Gemini chat error:', err);
    }
  }

  const fallbacks = [
    "That is super interesting! Tell me more about that.",
    "Haha totally, I feel you on that. How long have you been into that?",
    "Nice! It's always cool meeting folks from different parts of the world.",
    "I agree! That makes a lot of sense actually.",
    "Sounds awesome. What else are you working on or thinking about today?",
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

// Helper for matchmaking - CONNECTS ONLY REAL PERSONS
function tryMatchmaking() {
  // Filter queue to ensure all session IDs exist and are not already paired or inside a room
  waitingQueue = waitingQueue.filter(sessionId => {
    const user = usersBySession.get(sessionId);
    return user && !user.pairedStrangerId && !user.currentRoomId;
  });

  // If two or more real users are waiting, pair them immediately in FIFO order
  while (waitingQueue.length >= 2) {
    const userAId = waitingQueue[0];
    const userA = usersBySession.get(userAId);
    if (!userA) {
      waitingQueue.shift();
      continue;
    }

    let pairedIndex = -1;
    for (let j = 1; j < waitingQueue.length; j++) {
      const userBId = waitingQueue[j];
      const userB = usersBySession.get(userBId);
      if (!userB) continue;

      if (
        userAId !== userBId &&
        !userA.blockedUsers.has(userBId) &&
        !userB.blockedUsers.has(userAId)
      ) {
        pairedIndex = j;
        break;
      }
    }

    if (pairedIndex === -1) {
      // User A cannot be paired with anyone currently in queue (e.g. mutual blocks or duplicates)
      break;
    }

    const userBId = waitingQueue[pairedIndex];
    const userB = usersBySession.get(userBId);

    // Remove both from waiting queue
    waitingQueue.splice(pairedIndex, 1);
    waitingQueue.splice(0, 1);

    if (!userA || !userB) continue;

    userA.pairedStrangerId = userBId;
    userB.pairedStrangerId = userAId;

    console.log(`[Matchmaker] 🤝 PAIRED REAL PERSONS: "${userA.name}" (${userA.sessionId}) <---> "${userB.name}" (${userB.sessionId})`);

    // User A is designated initiator (creates offer), User B answers
    io.to(userA.socketId).emit('match:found', {
      stranger: {
        id: userB.sessionId,
        name: userB.name,
        avatarSeed: userB.avatarSeed,
        isAiCompanion: false,
      },
      isInitiator: true,
      iceServers: getIceServers(),
    });

    io.to(userB.socketId).emit('match:found', {
      stranger: {
        id: userA.sessionId,
        name: userA.name,
        avatarSeed: userA.avatarSeed,
        isAiCompanion: false,
      },
      isInitiator: false,
      iceServers: getIceServers(),
    });

    // Broadcast stats update
    io.emit('stats:update', {
      onlineUsers: usersBySession.size,
      waitingUsers: waitingQueue.length,
      activeRooms: activeRooms.size,
    });
  }
}

// Clean up user from active random talk pair
function breakPair(user: ConnectedUser, notifyReason: string = 'stranger-left') {
  if (!user.pairedStrangerId) return;

  const strangerId = user.pairedStrangerId;
  user.pairedStrangerId = null;

  if (strangerId.startsWith('ai-')) {
    return;
  }

  const stranger = usersBySession.get(strangerId);
  if (stranger) {
    stranger.pairedStrangerId = null;
    io.to(stranger.socketId).emit('call:ended', {
      reason: notifyReason,
      strangerId: user.sessionId,
    });
  }
}

// Socket.IO Connection Handler
io.on('connection', (socket: Socket) => {
  let currentUser: ConnectedUser | null = null;

  // 1. Session initialization (Anonymous token generated client or assigned)
  socket.on('session:init', (data: { sessionId?: string; name?: string }) => {
    const sessionId = data.sessionId || `anonymous-user-${Math.random().toString(36).substring(2, 8)}`;
    const randomNum = Math.floor(10 + Math.random() * 90);
    const name = data.name || `Stranger ${randomNum}`;
    const avatarSeed = `seed-${sessionId}`;

    const existing = usersBySession.get(sessionId);
    if (existing) {
      existing.socketId = socket.id;
      if (data.name) existing.name = data.name;
      currentUser = existing;
      usersBySocket.set(socket.id, currentUser);
    } else {
      currentUser = {
        socketId: socket.id,
        sessionId,
        name,
        avatarSeed,
        currentRoomId: null,
        pairedStrangerId: null,
        isMuted: false,
        isVideoOff: false,
        isSpeaking: false,
        blockedUsers: new Set(),
        joinedAt: Date.now(),
      };
      usersBySession.set(sessionId, currentUser);
      usersBySocket.set(socket.id, currentUser);
    }

    socket.emit('session:ready', {
      user: {
        id: sessionId,
        name: currentUser.name,
        avatarSeed: currentUser.avatarSeed,
      },
      iceServers: getIceServers(),
      onlineCount: usersBySession.size,
    });

    // Broadcast updated stats
    io.emit('stats:update', {
      onlineUsers: usersBySession.size,
      waitingUsers: waitingQueue.length,
      activeRooms: activeRooms.size,
    });
  });

  function ensureCurrentUser(): ConnectedUser {
    if (currentUser) {
      currentUser.socketId = socket.id;
      usersBySocket.set(socket.id, currentUser);
      usersBySession.set(currentUser.sessionId, currentUser);
      return currentUser;
    }
    const existing = usersBySocket.get(socket.id);
    if (existing) {
      currentUser = existing;
      currentUser.socketId = socket.id;
      return currentUser;
    }
    const sessionId = `anon-${Math.random().toString(36).substring(2, 9)}`;
    const randomNum = Math.floor(100 + Math.random() * 900);
    currentUser = {
      socketId: socket.id,
      sessionId,
      name: `Stranger ${randomNum}`,
      avatarSeed: `seed-${sessionId}`,
      currentRoomId: null,
      pairedStrangerId: null,
      isMuted: false,
      isVideoOff: false,
      isSpeaking: false,
      blockedUsers: new Set(),
      joinedAt: Date.now(),
    };
    usersBySession.set(sessionId, currentUser);
    usersBySocket.set(socket.id, currentUser);
    return currentUser;
  }

  // 2. Random Match Request
  const handleMatchRequest = () => {
    const user = ensureCurrentUser();

    // Leave any existing pair or room first
    breakPair(user, 'next');
    if (user.currentRoomId) {
      leaveCurrentRoom(user);
    }

    if (!waitingQueue.includes(user.sessionId)) {
      waitingQueue.push(user.sessionId);
    }

    socket.emit('match:queued');
    io.emit('stats:update', {
      onlineUsers: usersBySession.size,
      waitingUsers: waitingQueue.length,
      activeRooms: activeRooms.size,
    });

    tryMatchmaking();
  };

  socket.on('match:request', handleMatchRequest);
  socket.on('match:start', handleMatchRequest);

  // 3. Match Cancel
  const handleMatchCancel = () => {
    const user = ensureCurrentUser();
    waitingQueue = waitingQueue.filter(id => id !== user.sessionId);
    socket.emit('match:cancelled');
    io.emit('stats:update', {
      onlineUsers: usersBySession.size,
      waitingUsers: waitingQueue.length,
      activeRooms: activeRooms.size,
    });
  };

  socket.on('match:cancel', handleMatchCancel);
  socket.on('match:stop', handleMatchCancel);

  // 4. Match Next (Skip stranger and find someone new)
  socket.on('match:next', () => {
    const user = ensureCurrentUser();
    breakPair(user, 'stranger-skipped');

    if (!waitingQueue.includes(user.sessionId)) {
      waitingQueue.push(user.sessionId);
    }

    socket.emit('match:queued');
    io.emit('stats:update', {
      onlineUsers: usersBySession.size,
      waitingUsers: waitingQueue.length,
      activeRooms: activeRooms.size,
    });

    tryMatchmaking();
  });

  // 5. Match End (Return to idle)
  socket.on('match:end', () => {
    const user = ensureCurrentUser();
    waitingQueue = waitingQueue.filter(id => id !== user.sessionId);
    breakPair(user, 'call-ended');
    socket.emit('match:idle');
    io.emit('stats:update', {
      onlineUsers: usersBySession.size,
      waitingUsers: waitingQueue.length,
      activeRooms: activeRooms.size,
    });
  });

  // Optional: User explicitly requests to practice with AI bot for microphone/webcam solo test
  socket.on('match:ai-practice', () => {
    const user = ensureCurrentUser();
    breakPair(user, 'next');
    if (user.currentRoomId) {
      leaveCurrentRoom(user);
    }
    waitingQueue = waitingQueue.filter(id => id !== user.sessionId);

    const persona = AI_STRANGERS[Math.floor(Math.random() * AI_STRANGERS.length)];
    user.pairedStrangerId = persona.id;

    socket.emit('match:found', {
      stranger: {
        id: persona.id,
        name: `${persona.name} (AI Bot Practice)`,
        avatarSeed: persona.avatarSeed,
        isAiCompanion: true,
        bio: persona.bio,
      },
      isInitiator: true,
      iceServers: getIceServers(),
    });

    setTimeout(() => {
      if (user.pairedStrangerId === persona.id) {
        socket.emit('random:chat', {
          id: `msg-greet-${Date.now()}`,
          senderId: persona.id,
          senderName: persona.name,
          text: `[Solo Practice Bot] ${persona.initialGreeting}`,
          timestamp: Date.now(),
        });
      }
    }, 800);
  });

  // 6. WebRTC 1-on-1 Signaling
  socket.on('webrtc:offer', (payload: { sdp: RTCSessionDescriptionInit }) => {
    const user = ensureCurrentUser();
    if (!user.pairedStrangerId) return;
    const stranger = usersBySession.get(user.pairedStrangerId);
    if (stranger) {
      io.to(stranger.socketId).emit('webrtc:offer', {
        sdp: payload.sdp,
        from: user.sessionId,
      });
    }
  });

  socket.on('webrtc:answer', (payload: { sdp: RTCSessionDescriptionInit }) => {
    const user = ensureCurrentUser();
    if (!user.pairedStrangerId) return;
    const stranger = usersBySession.get(user.pairedStrangerId);
    if (stranger) {
      io.to(stranger.socketId).emit('webrtc:answer', {
        sdp: payload.sdp,
        from: user.sessionId,
      });
    }
  });

  socket.on('webrtc:ice-candidate', (payload: { candidate: RTCIceCandidateInit }) => {
    const user = ensureCurrentUser();
    if (!user.pairedStrangerId) return;
    const stranger = usersBySession.get(user.pairedStrangerId);
    if (stranger) {
      io.to(stranger.socketId).emit('webrtc:ice-candidate', {
        candidate: payload.candidate,
        from: user.sessionId,
      });
    }
  });

  // 7. Instant In-Call Text Chat for Random Talk
  socket.on('random:chat', async (data: { text: string }) => {
    const user = ensureCurrentUser();
    if (!user.pairedStrangerId || !data.text) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      senderId: user.sessionId,
      senderName: user.name,
      text: data.text.slice(0, 500),
      timestamp: Date.now(),
    };

    // If paired with an AI Stranger Companion
    if (user.pairedStrangerId.startsWith('ai-')) {
      const persona = AI_STRANGERS.find(p => p.id === user.pairedStrangerId) || AI_STRANGERS[0];
      // Echo user message to client
      socket.emit('random:chat', userMsg);

      // Indicate typing / speaking state
      setTimeout(() => {
        if (user.pairedStrangerId === persona.id) {
          socket.emit('peer:speaking', {
            userId: persona.id,
            isSpeaking: true,
          });
        }
      }, 300);

      try {
        const replyText = await generateAiStrangerReply(persona, data.text);
        setTimeout(() => {
          if (user.pairedStrangerId === persona.id) {
            const aiMsg: ChatMessage = {
              id: `msg-ai-${Date.now()}`,
              senderId: persona.id,
              senderName: persona.name,
              text: replyText,
              timestamp: Date.now(),
            };
            socket.emit('random:chat', aiMsg);
            socket.emit('peer:speaking', {
              userId: persona.id,
              isSpeaking: false,
            });
          }
        }, 1100);
      } catch (err) {
        console.warn('Error generating AI reply:', err);
        socket.emit('peer:speaking', {
          userId: persona.id,
          isSpeaking: false,
        });
      }
      return;
    }

    // Regular human-to-human peer chat
    const stranger = usersBySession.get(user.pairedStrangerId);
    if (stranger) {
      io.to(stranger.socketId).emit('random:chat', userMsg);
      socket.emit('random:chat', userMsg);
    }
  });

  // 8. User State Changes (mute, camera, speaking)
  socket.on('user:mute', (isMuted: boolean) => {
    const user = ensureCurrentUser();
    user.isMuted = isMuted;

    if (user.pairedStrangerId) {
      const stranger = usersBySession.get(user.pairedStrangerId);
      if (stranger) {
        io.to(stranger.socketId).emit('peer:mute', {
          userId: user.sessionId,
          isMuted,
        });
      }
    }

    if (user.currentRoomId) {
      io.to(user.currentRoomId).emit('room:participant-state', {
        userId: user.sessionId,
        isMuted,
      });
    }
  });

  socket.on('user:camera', (isVideoOff: boolean) => {
    const user = ensureCurrentUser();
    user.isVideoOff = isVideoOff;

    if (user.pairedStrangerId) {
      const stranger = usersBySession.get(user.pairedStrangerId);
      if (stranger) {
        io.to(stranger.socketId).emit('peer:camera', {
          userId: user.sessionId,
          isVideoOff,
        });
      }
    }

    if (user.currentRoomId) {
      io.to(user.currentRoomId).emit('room:participant-state', {
        userId: user.sessionId,
        isVideoOff,
      });
    }
  });

  socket.on('user:speaking', (isSpeaking: boolean) => {
    const user = ensureCurrentUser();
    user.isSpeaking = isSpeaking;

    if (user.pairedStrangerId) {
      const stranger = usersBySession.get(user.pairedStrangerId);
      if (stranger) {
        io.to(stranger.socketId).emit('peer:speaking', {
          userId: user.sessionId,
          isSpeaking,
        });
      }
    }

    if (user.currentRoomId) {
      io.to(user.currentRoomId).emit('room:participant-state', {
        userId: user.sessionId,
        isSpeaking,
      });
    }
  });

  // 9. Block User (Session-only block)
  socket.on('user:block', () => {
    const user = ensureCurrentUser();
    if (!user.pairedStrangerId) return;
    const strangerId = user.pairedStrangerId;
    user.blockedUsers.add(strangerId);

    const stranger = usersBySession.get(strangerId);
    if (stranger) {
      stranger.blockedUsers.add(user.sessionId);
    }

    breakPair(user, 'blocked');
    socket.emit('user:blocked-success', { strangerId });
  });

  // 10. Report User
  socket.on('user:report', (data: { reason: ReportReason; details?: string }) => {
    const user = ensureCurrentUser();
    if (!user.pairedStrangerId) return;
    const strangerId = user.pairedStrangerId;
    user.blockedUsers.add(strangerId);

    console.log(`[SAFETY REPORT] Reporter: ${user.sessionId} reported Stranger: ${strangerId}. Reason: ${data.reason}`);
    breakPair(user, 'reported');
    socket.emit('user:reported-success', { strangerId });
  });

  // 11. Room Management
  function leaveCurrentRoom(user: ConnectedUser) {
    if (!user.currentRoomId) return;
    const room = activeRooms.get(user.currentRoomId);
    if (!room) {
      user.currentRoomId = null;
      return;
    }

    socket.leave(room.id);
    user.currentRoomId = null;

    room.participants = room.participants.filter(p => p.id !== user.sessionId);

    if (room.participants.length === 0) {
      // If no one is left and it's not a permanent system room, delete it
      if (!room.id.startsWith('room-latenight') && !room.id.startsWith('room-music') && !room.id.startsWith('room-tech')) {
        activeRooms.delete(room.id);
      }
    } else {
      // Transfer ownership if creator left
      if (room.creatorId === user.sessionId && room.participants.length > 0) {
        room.creatorId = room.participants[0].id;
        room.participants[0].isCreator = true;
        io.to(room.id).emit('room:ownership-transferred', {
          newCreatorId: room.creatorId,
        });
      }

      io.to(room.id).emit('room:user-left', {
        userId: user.sessionId,
        name: user.name,
        remainingCount: room.participants.length,
      });
    }

    io.emit('rooms:updated', Array.from(activeRooms.values()).filter(r => r.type === 'public'));
    io.emit('stats:update', {
      onlineUsers: usersBySession.size,
      waitingUsers: waitingQueue.length,
      activeRooms: activeRooms.size,
    });
  }

  socket.on('room:create', (data: {
    name: string;
    description: string;
    type: 'public' | 'private';
    maxParticipants: number;
  }) => {
    const user = ensureCurrentUser();

    // Validate inputs
    const name = (data.name || 'Conversation Room').trim().slice(0, 50);
    const description = (data.description || 'Join to talk and share ideas').trim().slice(0, 200);
    const type = data.type === 'private' ? 'private' : 'public';
    const maxParticipants = Math.max(3, Math.min(20, Number(data.maxParticipants) || 12));

    const roomId = `room-${Math.random().toString(36).substring(2, 9)}`;
    const roomToken = `tok-${Math.random().toString(36).substring(2, 12)}`;

    const newRoom: Room = {
      id: roomId,
      token: roomToken,
      type,
      name,
      description,
      creatorId: user.sessionId,
      maxParticipants,
      participants: [],
      createdAt: Date.now(),
    };

    activeRooms.set(roomId, newRoom);
    socket.emit('room:created', newRoom);
    io.emit('rooms:updated', Array.from(activeRooms.values()).filter(r => r.type === 'public'));
    io.emit('stats:update', {
      onlineUsers: usersBySession.size,
      waitingUsers: waitingQueue.length,
      activeRooms: activeRooms.size,
    });
  });

  socket.on('room:join', (data: { roomId: string; token?: string }) => {
    const user = ensureCurrentUser();
    const room = activeRooms.get(data.roomId);

    if (!room) {
      return socket.emit('room:error', { message: 'Room not found or has expired.' });
    }

    if (room.type === 'private' && data.token && data.token !== room.token) {
      return socket.emit('room:error', { message: 'Invalid room invite token.' });
    }

    if (room.participants.length >= room.maxParticipants) {
      return socket.emit('room:error', { message: 'This room is currently full (Maximum capacity reached).' });
    }

    // Leave any current room or random match
    if (user.currentRoomId) {
      leaveCurrentRoom(user);
    }
    breakPair(user, 'joined-room');

    socket.join(room.id);
    user.currentRoomId = room.id;

    const participant: RoomParticipant = {
      id: user.sessionId,
      socketId: socket.id,
      name: user.name,
      isMuted: user.isMuted,
      isVideoOff: user.isVideoOff,
      isSpeaking: user.isSpeaking,
      isCreator: room.creatorId === user.sessionId,
      joinedAt: Date.now(),
    };

    // Remove existing if any (idempotency guard)
    room.participants = room.participants.filter(p => p.id !== user.sessionId);
    room.participants.push(participant);

    // Notify joiner with full room state
    socket.emit('room:joined', {
      room,
      participants: room.participants,
      iceServers: getIceServers(),
    });

    // Notify other participants in the room
    socket.to(room.id).emit('room:user-joined', {
      participant,
      totalCount: room.participants.length,
    });

    io.emit('rooms:updated', Array.from(activeRooms.values()).filter(r => r.type === 'public'));
  });

  socket.on('room:leave', () => {
    const user = ensureCurrentUser();
    leaveCurrentRoom(user);
    socket.emit('room:left');
  });

  // Room Multi-Peer WebRTC Signaling
  socket.on('room:signal', (data: {
    targetUserId: string;
    signalType: 'offer' | 'answer' | 'candidate';
    signalData: any;
  }) => {
    const user = ensureCurrentUser();
    if (!user.currentRoomId) return;
    const targetUser = usersBySession.get(data.targetUserId);
    if (targetUser && targetUser.currentRoomId === user.currentRoomId) {
      io.to(targetUser.socketId).emit('room:signal', {
        fromUserId: user.sessionId,
        signalType: data.signalType,
        signalData: data.signalData,
      });
    }
  });

  // Room Temporary Chat Message
  socket.on('room:chat-message', (data: { text?: string; imageUrl?: string }) => {
    const user = ensureCurrentUser();
    if (!user.currentRoomId) return;
    const room = activeRooms.get(user.currentRoomId);
    if (!room) return;

    // Validate text & image
    const text = data.text ? data.text.trim().slice(0, 1000) : undefined;
    let imageUrl = data.imageUrl;

    // Ephemeral image validation: maximum 5MB, base64 image
    if (imageUrl) {
      if (!imageUrl.startsWith('data:image/')) {
        imageUrl = undefined;
      } else if (imageUrl.length > 5.5 * 1024 * 1024) { // Roughly 5MB
        return socket.emit('room:error', { message: 'Image exceeds maximum 5MB size limit.' });
      }
    }

    if (!text && !imageUrl) return;

    const message: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      senderId: user.sessionId,
      senderName: user.name,
      text,
      imageUrl,
      timestamp: Date.now(),
    };

    io.to(room.id).emit('room:chat-message', message);
  });

  // Room Creator Controls: Add simulated guest for testing
  socket.on('room:add-guest', () => {
    const user = ensureCurrentUser();
    if (!user.currentRoomId) return;
    const room = activeRooms.get(user.currentRoomId);
    if (!room) return;

    if (room.participants.length >= room.maxParticipants) {
      return socket.emit('room:error', { message: 'Room has reached maximum capacity.' });
    }

    const guestNames = ['Maya (Tokyo)', 'Alex (London)', 'Elena (Barcelona)', 'Sam (SF)', 'Liam (Melb)'];
    const randomGuestName = guestNames[Math.floor(Math.random() * guestNames.length)];
    const guestId = `guest-${Math.random().toString(36).substring(2, 7)}`;

    const guestParticipant: RoomParticipant = {
      id: guestId,
      socketId: `mock-sock-${guestId}`,
      name: randomGuestName,
      isMuted: false,
      isVideoOff: true,
      isSpeaking: false,
      isCreator: false,
      joinedAt: Date.now(),
    };

    room.participants.push(guestParticipant);

    io.to(room.id).emit('room:user-joined', {
      participant: guestParticipant,
      totalCount: room.participants.length,
    });

    // Simulated welcome chat message
    setTimeout(() => {
      const welcomeMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        senderId: guestId,
        senderName: randomGuestName,
        text: "Hey everyone! Glad to join the room.",
        timestamp: Date.now(),
      };
      io.to(room.id).emit('room:chat-message', welcomeMsg);
    }, 800);
  });

  // Room Creator Controls: Kick participant
  socket.on('room:kick-participant', (data: { targetUserId: string }) => {
    const user = ensureCurrentUser();
    if (!user.currentRoomId) return;
    const room = activeRooms.get(user.currentRoomId);
    if (!room || room.creatorId !== user.sessionId) return;

    // Check if target is a simulated guest
    const guestIdx = room.participants.findIndex(p => p.id === data.targetUserId);
    if (guestIdx !== -1 && data.targetUserId.startsWith('guest-')) {
      room.participants.splice(guestIdx, 1);
      io.to(room.id).emit('room:user-left', {
        userId: data.targetUserId,
        reason: 'removed',
        totalCount: room.participants.length,
      });
      return;
    }

    const targetUser = usersBySession.get(data.targetUserId);
    if (targetUser && targetUser.currentRoomId === room.id) {
      io.to(targetUser.socketId).emit('room:kicked', { message: 'You have been removed from the room by the host.' });
      leaveCurrentRoom(targetUser);
    }
  });

  // Room Creator Controls: Close room
  socket.on('room:close-room', () => {
    const user = ensureCurrentUser();
    if (!user.currentRoomId) return;
    const room = activeRooms.get(user.currentRoomId);
    if (!room || room.creatorId !== user.sessionId) return;

    io.to(room.id).emit('room:closed', { message: 'The host has closed this room.' });
    activeRooms.delete(room.id);
    io.emit('rooms:updated', Array.from(activeRooms.values()).filter(r => r.type === 'public'));
    io.emit('stats:update', {
      onlineUsers: usersBySession.size,
      waitingUsers: waitingQueue.length,
      activeRooms: activeRooms.size,
    });
  });

  // Disconnect Handling
  socket.on('disconnect', () => {
    if (currentUser) {
      waitingQueue = waitingQueue.filter(id => id !== currentUser?.sessionId);
      breakPair(currentUser, 'disconnected');
      leaveCurrentRoom(currentUser);

      const activeUser = usersBySession.get(currentUser.sessionId);
      if (activeUser && activeUser.socketId === socket.id) {
        usersBySession.delete(currentUser.sessionId);
      }
      usersBySocket.delete(socket.id);

      io.emit('stats:update', {
        onlineUsers: usersBySession.size,
        waitingUsers: waitingQueue.length,
        activeRooms: activeRooms.size,
      });
    }
  });
});

// Vite Middleware for development / Static file serving for production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Randomtalks Server listening at http://0.0.0.0:${PORT}`);
  });
}

startServer();
