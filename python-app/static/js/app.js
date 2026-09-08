/**
 * Randomtalks Single-Page Client Application
 */

import { requestUserMedia, stopMediaStream, startSpeakingDetector, stopSpeakingDetector, PeerConnectionWrapper } from './webrtc.js';

// --- State Store ---
const state = {
  currentUser: null,
  socket: null,
  currentView: 'landing', // 'landing' | 'random-talk' | 'rooms-discovery' | 'room-active'
  stats: { onlineUsers: 1, waitingUsers: 0, activeRooms: 3 },
  localStream: null,
  isMuted: false,
  isVideoOff: false,
  isSpeaking: false,
  
  // Random Talk State
  matchState: 'IDLE', // 'IDLE' | 'SEARCHING' | 'CONNECTING' | 'CONNECTED' | 'ENDED'
  stranger: null,
  isInitiator: false,
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  strangerStream: new MediaStream(),
  pcWrapper: null,
  earlyIceCandidates: [],
  pendingOffer: null,
  isStrangerMuted: false,
  isStrangerVideoOff: false,
  isStrangerSpeaking: false,
  chatMessages: [],
  isChatOpen: false,

  // Rooms State
  rooms: [],
  activeRoom: null,
  roomParticipants: [],
  roomPeerConnections: new Map(), // targetUserId -> PeerConnectionWrapper
  roomRemoteStreams: new Map(),   // targetUserId -> MediaStream
  roomChatMessages: [],
  isRoomChatOpen: false,

  // Modals
  isPermissionsOpen: false,
  pendingAction: null, // { type: 'random-talk' } | { type: 'join-room', roomId, token }
  isPrivacyOpen: false,
  isCreateRoomOpen: false,
  isJoinPrivateOpen: false,
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initSession();
  initSocket();
  initEventListeners();
  initGlobe3D();
  renderView();
});

// Generate or retrieve persistent anonymous tab session
function initSession() {
  let stored = null;
  try {
    const raw = sessionStorage.getItem('randomtalk_tab_session');
    if (raw) stored = JSON.parse(raw);
  } catch (e) {
    console.warn('SessionStorage unavailable', e);
  }

  if (!stored || !stored.id) {
    const rand = Math.floor(100 + Math.random() * 900);
    const uniqueTabId = Math.random().toString(36).substring(2, 9);
    stored = {
      id: `anon-${uniqueTabId}`,
      name: `Stranger ${rand}`,
      avatarSeed: `seed-${uniqueTabId}`,
    };
    try {
      sessionStorage.setItem('randomtalk_tab_session', JSON.stringify(stored));
    } catch (e) {}
  }
  state.currentUser = stored;
  updateUserBadge();
}

function initSocket() {
  const socket = io({
    transports: ['polling', 'websocket'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  state.socket = socket;

  socket.on('connect', () => {
    socket.emit('session:init', {
      sessionId: state.currentUser.id,
      name: state.currentUser.name,
    });
  });

  socket.on('session:ready', (data) => {
    if (data.iceServers) state.iceServers = data.iceServers;
  });

  socket.on('stats:update', (stats) => {
    state.stats = stats;
    updateStatsDisplay();
  });

  // --- Random Talk Signaling ---
  socket.on('match:queued', () => {
    state.matchState = 'SEARCHING';
    state.stranger = null;
    teardownRandomPeer();
    renderView();
  });

  socket.on('match:found', async (data) => {
    state.stranger = data.stranger;
    state.isInitiator = data.isInitiator;
    if (data.iceServers) state.iceServers = data.iceServers;
    state.matchState = 'CONNECTING';
    state.chatMessages = [];
    teardownRandomPeer();

    const strangerVideoEl = document.getElementById('stranger-video');

    state.pcWrapper = new PeerConnectionWrapper(
      state.iceServers,
      (event) => {
        if (event.streams && event.streams[0]) {
          state.strangerStream = event.streams[0];
        } else {
          state.strangerStream.addTrack(event.track);
        }
        if (strangerVideoEl) {
          strangerVideoEl.srcObject = state.strangerStream;
          strangerVideoEl.play().catch(() => {});
        }
        state.matchState = 'CONNECTED';
        renderRandomTalkUI();
      },
      (candidate) => {
        socket.emit('webrtc:ice-candidate', { candidate });
      },
      (connState) => {
        if (connState === 'connected') {
          state.matchState = 'CONNECTED';
          renderRandomTalkUI();
        }
      }
    );

    if (state.localStream) {
      state.pcWrapper.addTracks(state.localStream);
    }

    // Flush any early buffered candidates
    while (state.earlyIceCandidates.length > 0) {
      const c = state.earlyIceCandidates.shift();
      if (c) {
        state.pcWrapper.addIceCandidate(c);
      }
    }

    // Flush buffered offer if peer was faster
    if (state.pendingOffer) {
      const off = state.pendingOffer;
      state.pendingOffer = null;
      await handleOffer(off);
    }

    if (data.isInitiator) {
      try {
        const offer = await state.pcWrapper.createOffer();
        socket.emit('webrtc:offer', { sdp: offer });
      } catch (err) {
        console.error('Error creating offer:', err);
      }
    }
    renderRandomTalkUI();
  });

  const handleOffer = async (payload) => {
    if (!state.pcWrapper) {
      state.pendingOffer = payload;
      return;
    }
    try {
      await state.pcWrapper.setRemoteDescription(payload.sdp);
      const answer = await state.pcWrapper.createAnswer();
      socket.emit('webrtc:answer', { sdp: answer });
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  };

  socket.on('webrtc:offer', handleOffer);

  socket.on('webrtc:answer', async (payload) => {
    if (!state.pcWrapper) return;
    try {
      await state.pcWrapper.setRemoteDescription(payload.sdp);
    } catch (err) {
      console.error('Error handling answer:', err);
    }
  });

  socket.on('webrtc:ice-candidate', async (payload) => {
    if (!payload || !payload.candidate) return;
    if (!state.pcWrapper) {
      state.earlyIceCandidates.push(payload.candidate);
      return;
    }
    try {
      await state.pcWrapper.addIceCandidate(payload.candidate);
    } catch (err) {
      console.error('Error adding candidate:', err);
    }
  });

  socket.on('call:ended', (data) => {
    teardownRandomPeer();
    state.matchState = 'ENDED';
    renderRandomTalkUI(data.reason);
  });

  socket.on('peer:mute', (d) => {
    state.isStrangerMuted = d.isMuted;
    renderRandomTalkUI();
  });

  socket.on('peer:camera', (d) => {
    state.isStrangerVideoOff = d.isVideoOff;
    renderRandomTalkUI();
  });

  socket.on('peer:speaking', (d) => {
    state.isStrangerSpeaking = d.isSpeaking;
    const borderEl = document.getElementById('stranger-border');
    if (borderEl) {
      if (d.isSpeaking) borderEl.classList.add('border-emerald-400');
      else borderEl.classList.remove('border-emerald-400');
    }
  });

  socket.on('chat:message', (msg) => {
    state.chatMessages.push(msg);
    renderChatMessages();
  });

  // --- Rooms Signaling ---
  socket.on('rooms:updated', (rooms) => {
    state.rooms = rooms;
    if (state.currentView === 'rooms-discovery') {
      renderRoomsList();
    }
  });

  socket.on('room:joined', async (data) => {
    state.activeRoom = data.room;
    state.roomParticipants = data.participants;
    if (data.iceServers) state.iceServers = data.iceServers;
    state.currentView = 'room-active';
    renderView();

    // Initiate WebRTC to existing participants
    data.participants.forEach(async (p) => {
      if (p.id !== state.currentUser.id) {
        const pcWrap = getOrCreateRoomPeer(p.id);
        try {
          const offer = await pcWrap.createOffer();
          socket.emit('room:signal', {
            targetUserId: p.id,
            signalType: 'offer',
            signalData: offer,
          });
        } catch (e) {
          console.error('Room offer error:', e);
        }
      }
    });
  });

  socket.on('room:user-joined', (data) => {
    state.roomParticipants.push(data.participant);
    renderRoomVideoGrid();
  });

  socket.on('room:user-left', (data) => {
    state.roomParticipants = state.roomParticipants.filter(p => p.id !== data.userId);
    const pc = state.roomPeerConnections.get(data.userId);
    if (pc) {
      pc.close();
      state.roomPeerConnections.delete(data.userId);
    }
    state.roomRemoteStreams.delete(data.userId);
    renderRoomVideoGrid();
  });

  socket.on('room:signal', async (data) => {
    const pcWrap = getOrCreateRoomPeer(data.fromUserId);
    if (data.signalType === 'offer') {
      try {
        await pcWrap.setRemoteDescription(data.signalData);
        const answer = await pcWrap.createAnswer();
        socket.emit('room:signal', {
          targetUserId: data.fromUserId,
          signalType: 'answer',
          signalData: answer,
        });
      } catch (err) {
        console.error('Error handling room offer:', err);
      }
    } else if (data.signalType === 'answer') {
      try {
        await pcWrap.setRemoteDescription(data.signalData);
      } catch (err) {
        console.error('Error setting room answer:', err);
      }
    } else if (data.signalType === 'candidate') {
      try {
        await pcWrap.addIceCandidate(data.signalData);
      } catch (err) {
        console.error('Error adding room candidate:', err);
      }
    }
  });

  socket.on('room:chat', (msg) => {
    state.roomChatMessages.push(msg);
    renderRoomChatMessages();
  });

  socket.on('room:image', (imgMsg) => {
    state.roomChatMessages.push(imgMsg);
    renderRoomChatMessages();
  });

  socket.on('room:kicked', (data) => {
    alert(data.message || 'You were removed from the room.');
    leaveRoom();
  });

  socket.on('room:error', (err) => {
    alert(err.message || 'Room error occurred');
  });

  // Fetch initial rooms
  fetch('/api/rooms')
    .then(r => r.json())
    .then(rooms => { state.rooms = rooms; })
    .catch(() => {});
}

function teardownRandomPeer() {
  if (state.pcWrapper) {
    state.pcWrapper.close();
    state.pcWrapper = null;
  }
  state.earlyIceCandidates = [];
  state.pendingOffer = null;
  state.strangerStream = new MediaStream();
  const strangerVideoEl = document.getElementById('stranger-video');
  if (strangerVideoEl) strangerVideoEl.srcObject = null;
}

function getOrCreateRoomPeer(targetUserId) {
  let pcWrap = state.roomPeerConnections.get(targetUserId);
  if (pcWrap) return pcWrap;

  let rStream = state.roomRemoteStreams.get(targetUserId);
  if (!rStream) {
    rStream = new MediaStream();
    state.roomRemoteStreams.set(targetUserId, rStream);
  }

  pcWrap = new PeerConnectionWrapper(
    state.iceServers,
    (event) => {
      rStream.addTrack(event.track);
      const vidEl = document.getElementById(`room-video-${targetUserId}`);
      if (vidEl) {
        vidEl.srcObject = rStream;
        vidEl.play().catch(() => {});
      }
    },
    (candidate) => {
      state.socket.emit('room:signal', {
        targetUserId,
        signalType: 'candidate',
        signalData: candidate,
      });
    }
  );

  if (state.localStream) {
    pcWrap.addTracks(state.localStream);
  }

  state.roomPeerConnections.set(targetUserId, pcWrap);
  return pcWrap;
}

// --- Navigation & View Rendering ---
function renderView() {
  const landingSection = document.getElementById('view-landing');
  const randomTalkSection = document.getElementById('view-random-talk');
  const roomsDiscoverySection = document.getElementById('view-rooms-discovery');
  const roomActiveSection = document.getElementById('view-room-active');

  [landingSection, randomTalkSection, roomsDiscoverySection, roomActiveSection].forEach(el => {
    if (el) el.classList.add('hidden');
  });

  if (state.currentView === 'landing') {
    if (landingSection) landingSection.classList.remove('hidden');
  } else if (state.currentView === 'random-talk') {
    if (randomTalkSection) randomTalkSection.classList.remove('hidden');
    renderRandomTalkUI();
  } else if (state.currentView === 'rooms-discovery') {
    if (roomsDiscoverySection) roomsDiscoverySection.classList.remove('hidden');
    renderRoomsList();
  } else if (state.currentView === 'room-active') {
    if (roomActiveSection) roomActiveSection.classList.remove('hidden');
    renderRoomVideoGrid();
  }

  updateNavState();
}

function updateNavState() {
  const navRandomBtn = document.getElementById('nav-btn-random');
  const navRoomsBtn = document.getElementById('nav-btn-rooms');

  if (navRandomBtn) {
    if (state.currentView === 'random-talk') {
      navRandomBtn.className = 'px-3 py-1.5 rounded-lg bg-white/10 text-white font-medium text-xs flex items-center gap-1.5';
    } else {
      navRandomBtn.className = 'px-3 py-1.5 rounded-lg hover:bg-white/5 text-slate-300 hover:text-white text-xs flex items-center gap-1.5';
    }
  }

  if (navRoomsBtn) {
    if (state.currentView === 'rooms-discovery' || state.currentView === 'room-active') {
      navRoomsBtn.className = 'px-3 py-1.5 rounded-lg bg-white/10 text-white font-medium text-xs flex items-center gap-1.5';
    } else {
      navRoomsBtn.className = 'px-3 py-1.5 rounded-lg hover:bg-white/5 text-slate-300 hover:text-white text-xs flex items-center gap-1.5';
    }
  }
}

function updateStatsDisplay() {
  const onlineEl = document.getElementById('stat-online-users');
  const heroOnlineEl = document.getElementById('hero-online-count');
  const heroRoomsEl = document.getElementById('hero-rooms-count');

  if (onlineEl) onlineEl.textContent = `${state.stats.onlineUsers || 1} online`;
  if (heroOnlineEl) heroOnlineEl.textContent = `${state.stats.onlineUsers || 1}`;
  if (heroRoomsEl) heroRoomsEl.textContent = `${state.stats.activeRooms || 3}`;
}

function updateUserBadge() {
  const badge = document.getElementById('user-badge-name');
  if (badge && state.currentUser) {
    badge.textContent = state.currentUser.name;
  }
}

// --- Permissions Modal Handling ---
let permissionsStream = null;
let isAccepted = false;

function openPermissions(action) {
  state.pendingAction = action;
  const modal = document.getElementById('modal-permissions');
  if (!modal) return;
  modal.classList.remove('hidden');

  isAccepted = false;
  const videoPreview = document.getElementById('permissions-video-preview');

  requestUserMedia(true, true).then(({ stream, error }) => {
    if (error || !stream) {
      alert(error || 'Could not access camera/mic');
      return;
    }
    permissionsStream = stream;
    if (videoPreview) {
      videoPreview.srcObject = stream;
      videoPreview.play().catch(() => {});
    }
  });
}

function closePermissions() {
  const modal = document.getElementById('modal-permissions');
  if (modal) modal.classList.add('hidden');
  if (permissionsStream && !isAccepted) {
    stopMediaStream(permissionsStream);
    permissionsStream = null;
  }
}

function startChattingFromPermissions() {
  if (!permissionsStream) return;
  isAccepted = true;
  state.localStream = permissionsStream;

  // Bind local speaking detector
  const aTrack = state.localStream.getAudioTracks()[0];
  if (aTrack) {
    startSpeakingDetector(aTrack, (speaking) => {
      state.isSpeaking = speaking;
      if (state.socket) state.socket.emit('user:speaking', speaking);
      const border = document.getElementById('local-pip-border');
      if (border) {
        if (speaking) border.classList.add('border-emerald-400');
        else border.classList.remove('border-emerald-400');
      }
    });
  }

  const modal = document.getElementById('modal-permissions');
  if (modal) modal.classList.add('hidden');

  if (state.pendingAction?.type === 'random-talk') {
    startRandomTalk();
  } else if (state.pendingAction?.type === 'join-room') {
    joinRoom(state.pendingAction.roomId, state.pendingAction.token);
  }
}

// --- Random Talk View Logic ---
function startRandomTalk() {
  if (!state.localStream) {
    openPermissions({ type: 'random-talk' });
    return;
  }
  state.currentView = 'random-talk';
  renderView();

  const pipVideo = document.getElementById('local-pip-video');
  if (pipVideo && state.localStream) {
    pipVideo.srcObject = state.localStream;
    pipVideo.play().catch(() => {});
  }

  state.socket.emit('match:request');
}

function renderRandomTalkUI(endReason = null) {
  const searchingOverlay = document.getElementById('random-searching-overlay');
  const connectedOverlay = document.getElementById('random-connected-overlay');
  const endedOverlay = document.getElementById('random-ended-overlay');
  const strangerVideo = document.getElementById('stranger-video');
  const strangerInfo = document.getElementById('stranger-header-name');

  if (searchingOverlay) searchingOverlay.classList.add('hidden');
  if (connectedOverlay) connectedOverlay.classList.add('hidden');
  if (endedOverlay) endedOverlay.classList.add('hidden');

  if (state.matchState === 'SEARCHING' || state.matchState === 'IDLE') {
    if (searchingOverlay) searchingOverlay.classList.remove('hidden');
  } else if (state.matchState === 'CONNECTED' || state.matchState === 'CONNECTING') {
    if (connectedOverlay) connectedOverlay.classList.remove('hidden');
    if (strangerInfo && state.stranger) strangerInfo.textContent = state.stranger.name;
    if (strangerVideo && state.strangerStream) {
      if (strangerVideo.srcObject !== state.strangerStream) {
        strangerVideo.srcObject = state.strangerStream;
      }
      strangerVideo.play().catch(() => {});
    }
  } else if (state.matchState === 'ENDED') {
    if (endedOverlay) {
      endedOverlay.classList.remove('hidden');
      const desc = document.getElementById('ended-reason-text');
      if (desc) desc.textContent = endReason || 'Conversation ended.';
    }
  }
}

function skipStranger() {
  teardownRandomPeer();
  state.matchState = 'SEARCHING';
  renderRandomTalkUI();
  state.socket.emit('match:next');
}

function endRandomTalk() {
  teardownRandomPeer();
  state.socket.emit('match:end');
  state.currentView = 'landing';
  renderView();
}

function sendRandomChat() {
  const input = document.getElementById('random-chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  state.socket.emit('chat:message', { text });
  input.value = '';
}

function renderChatMessages() {
  const box = document.getElementById('random-chat-messages');
  if (!box) return;
  box.innerHTML = state.chatMessages.map(m => {
    const isMe = m.senderId === state.currentUser.id;
    return `
      <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} my-1">
        <span class="text-[10px] text-slate-400">${escapeHtml(m.senderName)}</span>
        <div class="px-3 py-1.5 rounded-xl max-w-[80%] text-xs ${isMe ? 'bg-violet-600 text-white' : 'bg-white/10 text-slate-200'}">
          ${escapeHtml(m.text)}
        </div>
      </div>
    `;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

// AI Icebreaker
async function requestIcebreaker() {
  const btn = document.getElementById('btn-icebreaker');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/ai/icebreaker', { method: 'POST' });
    const data = await res.json();
    if (data.prompt && state.socket) {
      state.socket.emit('chat:message', { text: `🧊 [Icebreaker] ${data.prompt}` });
    }
  } catch (e) {
    console.warn('Icebreaker fetch failed', e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- Rooms View Logic ---
function renderRoomsList() {
  const container = document.getElementById('rooms-grid');
  if (!container) return;

  if (state.rooms.length === 0) {
    container.innerHTML = `<div class="col-span-full text-center py-12 text-slate-500">No rooms available. Create one to get started!</div>`;
    return;
  }

  container.innerHTML = state.rooms.map(room => `
    <div class="glass-panel p-5 rounded-2xl flex flex-col justify-between hover:border-violet-500/50 transition-all group">
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="px-2.5 py-0.5 rounded-full text-[11px] font-mono ${room.type === 'private' ? 'bg-amber-500/20 text-amber-300' : 'bg-cyan-500/20 text-cyan-300'}">
            ${room.type === 'private' ? '🔒 Private' : '🌐 Public'}
          </span>
          <span class="text-xs text-slate-400 font-mono">${room.participants.length} / ${room.maxParticipants}</span>
        </div>
        <h3 class="font-display font-bold text-base text-white group-hover:text-violet-400 transition-colors">${escapeHtml(room.name)}</h3>
        <p class="text-xs text-slate-400 mt-1 line-clamp-2">${escapeHtml(room.description || 'Voice and video room')}</p>
      </div>
      <button onclick="window.appJoinRoom('${room.id}')" class="mt-4 w-full py-2 rounded-xl bg-white/5 hover:bg-violet-600 text-white font-medium text-xs transition-all flex items-center justify-center gap-1.5 border border-white/10">
        <span>Join Room</span>
      </button>
    </div>
  `).join('');
}

function joinRoom(roomId, token) {
  if (!state.localStream) {
    openPermissions({ type: 'join-room', roomId, token });
    return;
  }
  state.socket.emit('room:join', { roomId, token });
}

function leaveRoom() {
  state.roomPeerConnections.forEach(pc => pc.close());
  state.roomPeerConnections.clear();
  state.roomRemoteStreams.clear();
  state.activeRoom = null;
  state.roomParticipants = [];
  state.roomChatMessages = [];

  state.socket.emit('room:leave');
  state.currentView = 'rooms-discovery';
  renderView();
}

function renderRoomVideoGrid() {
  const grid = document.getElementById('room-video-grid');
  if (!grid) return;

  const count = state.roomParticipants.length;
  let gridCols = 'grid-cols-1 sm:grid-cols-2';
  if (count > 2) gridCols = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  if (count > 6) gridCols = 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';

  grid.className = `grid ${gridCols} gap-3 w-full h-full auto-rows-fr`;

  // Render cards for all participants
  grid.innerHTML = state.roomParticipants.map(p => {
    const isMe = p.id === state.currentUser.id;
    return `
      <div class="relative rounded-2xl bg-[#0d101a] border border-white/10 overflow-hidden flex items-center justify-center group shadow-md min-h-[140px]">
        <video id="room-video-${p.id}" autoplay playsinline ${isMe ? 'muted class="w-full h-full object-cover video-mirrored"' : 'class="w-full h-full object-cover"'}></video>
        
        <div class="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
          <span class="px-2 py-0.5 rounded-lg bg-black/70 backdrop-blur-md text-[11px] font-mono text-white flex items-center gap-1">
            ${p.isCreator ? '<span class="text-amber-400">👑</span>' : ''}
            <span>${isMe ? `You (${escapeHtml(p.name)})` : escapeHtml(p.name)}</span>
          </span>
          <span class="bg-black/70 px-1.5 py-0.5 rounded-lg text-[10px] text-slate-300">
            ${p.isMuted ? '🔇' : '🎙️'}
          </span>
        </div>
      </div>
    `;
  }).join('');

  // Re-bind video element streams
  state.roomParticipants.forEach(p => {
    const vid = document.getElementById(`room-video-${p.id}`);
    if (!vid) return;
    if (p.id === state.currentUser.id && state.localStream) {
      vid.srcObject = state.localStream;
      vid.play().catch(() => {});
    } else {
      const rStream = state.roomRemoteStreams.get(p.id);
      if (rStream) {
        vid.srcObject = rStream;
        vid.play().catch(() => {});
      }
    }
  });

  const headerTitle = document.getElementById('room-active-title');
  if (headerTitle && state.activeRoom) {
    headerTitle.textContent = state.activeRoom.name;
  }
}

function sendRoomChat() {
  const input = document.getElementById('room-chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  state.socket.emit('room:chat', { text });
  input.value = '';
}

function renderRoomChatMessages() {
  const box = document.getElementById('room-chat-messages');
  if (!box) return;
  box.innerHTML = state.roomChatMessages.map(m => {
    const isMe = m.senderId === state.currentUser.id;
    if (m.imageData) {
      return `
        <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} my-1">
          <span class="text-[10px] text-slate-400">${escapeHtml(m.senderName)} shared an image</span>
          <img src="${m.imageData}" class="rounded-xl max-w-[200px] border border-white/10 mt-1" />
        </div>
      `;
    }
    return `
      <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} my-1">
        <span class="text-[10px] text-slate-400">${escapeHtml(m.senderName)}</span>
        <div class="px-3 py-1.5 rounded-xl max-w-[80%] text-xs ${isMe ? 'bg-violet-600 text-white' : 'bg-white/10 text-slate-200'}">
          ${escapeHtml(m.text)}
        </div>
      </div>
    `;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function handleImageUpload(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Please upload an image file.');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert('Image exceeds 5MB size limit.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.socket.emit('room:image', { imageData: reader.result });
  };
  reader.readAsDataURL(file);
}

// --- Interactive 3D Globe with Three.js ---
function initGlobe3D() {
  const container = document.getElementById('hero-globe-container');
  if (!container || typeof THREE === 'undefined') return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.z = 240;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const globeGroup = new THREE.Group();
  scene.add(globeGroup);

  // Wireframe / Dot sphere
  const sphereGeo = new THREE.SphereGeometry(75, 36, 36);
  const sphereMat = new THREE.MeshBasicMaterial({
    color: 0x8b5cf6,
    wireframe: true,
    transparent: true,
    opacity: 0.15,
  });
  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  globeGroup.add(sphere);

  // Subtle rotation animation using performance.now()
  let startTime = performance.now();
  let lastTime = startTime;

  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const delta = (now - lastTime) * 0.001;
    lastTime = now;

    globeGroup.rotation.y += 0.0015;
    globeGroup.rotation.x = Math.sin(now * 0.0005) * 0.1;

    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    if (!container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}

// --- Global Event Listeners ---
function initEventListeners() {
  // Navigation
  document.getElementById('nav-btn-landing')?.addEventListener('click', () => {
    if (state.currentView === 'random-talk') endRandomTalk();
    if (state.currentView === 'room-active') leaveRoom();
    state.currentView = 'landing';
    renderView();
  });

  document.getElementById('nav-btn-random')?.addEventListener('click', () => {
    startRandomTalk();
  });

  document.getElementById('nav-btn-rooms')?.addEventListener('click', () => {
    if (state.currentView === 'random-talk') endRandomTalk();
    state.currentView = 'rooms-discovery';
    renderView();
  });

  document.getElementById('btn-hero-start')?.addEventListener('click', () => startRandomTalk());
  document.getElementById('btn-hero-rooms')?.addEventListener('click', () => {
    state.currentView = 'rooms-discovery';
    renderView();
  });

  // Permissions modal buttons
  document.getElementById('btn-permissions-start')?.addEventListener('click', () => startChattingFromPermissions());
  document.getElementById('btn-permissions-close')?.addEventListener('click', () => closePermissions());

  // Random Talk Controls
  document.getElementById('btn-random-skip')?.addEventListener('click', () => skipStranger());
  document.getElementById('btn-random-end')?.addEventListener('click', () => endRandomTalk());
  document.getElementById('btn-random-ended-next')?.addEventListener('click', () => skipStranger());
  document.getElementById('btn-random-ended-exit')?.addEventListener('click', () => endRandomTalk());

  document.getElementById('btn-random-mute')?.addEventListener('click', () => {
    if (!state.localStream) return;
    const aTrack = state.localStream.getAudioTracks()[0];
    if (aTrack) {
      aTrack.enabled = !aTrack.enabled;
      state.isMuted = !aTrack.enabled;
      state.socket.emit('user:mute', state.isMuted);
      document.getElementById('btn-random-mute').classList.toggle('bg-rose-600', state.isMuted);
    }
  });

  document.getElementById('btn-random-camera')?.addEventListener('click', () => {
    if (!state.localStream) return;
    const vTrack = state.localStream.getVideoTracks()[0];
    if (vTrack) {
      vTrack.enabled = !vTrack.enabled;
      state.isVideoOff = !vTrack.enabled;
      state.socket.emit('user:camera', state.isVideoOff);
      document.getElementById('btn-random-camera').classList.toggle('bg-rose-600', state.isVideoOff);
    }
  });

  document.getElementById('btn-random-chat-toggle')?.addEventListener('click', () => {
    const drawer = document.getElementById('random-chat-drawer');
    if (drawer) drawer.classList.toggle('hidden');
  });

  document.getElementById('btn-random-chat-send')?.addEventListener('click', sendRandomChat);
  document.getElementById('random-chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendRandomChat();
  });

  document.getElementById('btn-icebreaker')?.addEventListener('click', requestIcebreaker);

  // Safety controls
  document.getElementById('btn-random-block')?.addEventListener('click', () => {
    if (confirm('Block this stranger? You will not be matched with them again in this session.')) {
      state.socket.emit('user:block');
    }
  });

  document.getElementById('btn-random-report')?.addEventListener('click', () => {
    const reason = prompt('Please select a report reason:\n1: inappropriate\n2: harassment\n3: bot\n4: offensive-audio\n5: other', 'inappropriate');
    if (reason) {
      state.socket.emit('user:report', { reason });
      alert('Report submitted. You have been disconnected.');
    }
  });

  // Rooms Controls
  document.getElementById('btn-leave-room')?.addEventListener('click', () => leaveRoom());
  document.getElementById('btn-room-chat-send')?.addEventListener('click', sendRoomChat);
  document.getElementById('room-chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendRoomChat();
  });

  document.getElementById('btn-room-image-upload')?.addEventListener('click', () => {
    document.getElementById('room-image-file-input')?.click();
  });

  document.getElementById('room-image-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleImageUpload(file);
  });

  // Create room modal
  document.getElementById('btn-open-create-room')?.addEventListener('click', () => {
    document.getElementById('modal-create-room')?.classList.remove('hidden');
  });
  document.getElementById('btn-close-create-room')?.addEventListener('click', () => {
    document.getElementById('modal-create-room')?.classList.add('hidden');
  });
  document.getElementById('btn-submit-create-room')?.addEventListener('click', () => {
    const name = document.getElementById('create-room-name')?.value;
    const desc = document.getElementById('create-room-desc')?.value;
    const type = document.getElementById('create-room-type')?.value;
    const capacity = document.getElementById('create-room-capacity')?.value;

    state.socket.emit('room:create', {
      name,
      description: desc,
      type,
      maxParticipants: capacity,
    });
    document.getElementById('modal-create-room')?.classList.add('hidden');
  });

  // Join private room modal
  document.getElementById('btn-open-join-private')?.addEventListener('click', () => {
    document.getElementById('modal-join-private')?.classList.remove('hidden');
  });
  document.getElementById('btn-close-join-private')?.addEventListener('click', () => {
    document.getElementById('modal-join-private')?.classList.add('hidden');
  });
  document.getElementById('btn-submit-join-private')?.addEventListener('click', () => {
    const code = document.getElementById('join-private-code')?.value.trim();
    if (code) {
      document.getElementById('modal-join-private')?.classList.add('hidden');
      joinRoom(code, code);
    }
  });

  // Privacy notice modal
  document.getElementById('btn-nav-privacy')?.addEventListener('click', () => {
    document.getElementById('modal-privacy')?.classList.remove('hidden');
  });
  document.getElementById('btn-close-privacy')?.addEventListener('click', () => {
    document.getElementById('modal-privacy')?.classList.add('hidden');
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Window export for inline HTML onclick attributes
window.appJoinRoom = (roomId) => joinRoom(roomId);
