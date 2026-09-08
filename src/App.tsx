import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { AppView, UserSession, ServerStats } from './types.ts';
import { Navbar } from './components/Navbar.tsx';
import { LandingHero } from './components/LandingHero.tsx';
import { RandomTalkView } from './components/RandomTalkView.tsx';
import { RoomsDiscoveryView } from './components/RoomsDiscoveryView.tsx';
import { RoomView } from './components/RoomView.tsx';
import { PermissionsModal } from './components/PermissionsModal.tsx';
import { PrivacyNoticeModal } from './components/PrivacyNoticeModal.tsx';
import { stopMediaStream } from './services/webrtc.ts';
import { Home, Radio, Users, Shield } from 'lucide-react';

export default function App() {
  const [currentView, setCurrentView] = useState<AppView>('landing');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  // Server Stats
  const [stats, setStats] = useState<ServerStats>({
    onlineUsers: 1,
    waitingUsers: 0,
    activeRooms: 3,
  });

  // Modals state
  const [isPermissionsOpen, setIsPermissionsOpen] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    | { type: 'random-talk' }
    | { type: 'join-room'; roomId: string; token?: string }
    | null
  >(null);

  // Active room data when in 'room-active'
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeRoomToken, setActiveRoomToken] = useState<string | undefined>(undefined);

  // Initialize Socket.io connection & session
  useEffect(() => {
    // Generate or retrieve persistent anonymous user token for THIS browser tab session
    let storedSession: UserSession | null = null;
    try {
      const raw = sessionStorage.getItem('randomtalk_tab_session');
      if (raw) storedSession = JSON.parse(raw);
    } catch (e) {
      console.warn('Could not read session from sessionStorage', e);
    }

    if (!storedSession || !storedSession.id) {
      const rand = Math.floor(100 + Math.random() * 900);
      const uniqueTabId = Math.random().toString(36).substring(2, 9);
      storedSession = {
        id: `anon-${uniqueTabId}`,
        name: `Stranger ${rand}`,
        avatarSeed: `seed-${uniqueTabId}`,
      };
      try {
        sessionStorage.setItem('randomtalk_tab_session', JSON.stringify(storedSession));
      } catch (e) {
        // ignore
      }
    }

    setCurrentUser(storedSession);

    // Use polling first with seamless WebSocket upgrade for maximum reverse-proxy reliability
    const s = io({
      transports: ['polling', 'websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    s.on('connect', () => {
      s.emit('session:init', {
        sessionId: storedSession.id,
        name: storedSession.name,
      });
    });

    s.on('stats:update', (updatedStats: ServerStats) => {
      setStats(updatedStats);
    });

    setSocket(s);

    // Initial stats fetch
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'ok') {
          setStats({
            onlineUsers: data.onlineUsers || 1,
            waitingUsers: data.waitingUsers || 0,
            activeRooms: data.activeRooms || 3,
          });
        }
      })
      .catch((err) => console.warn('Could not fetch server stats:', err));

    return () => {
      s.disconnect();
    };
  }, []);

  // Request permissions flow - verify stream tracks are live
  const isStreamValid = (stream: MediaStream | null) => {
    return Boolean(stream && stream.getTracks().length > 0 && stream.getTracks().some((t) => t.readyState === 'live'));
  };

  const handleStartRandomTalk = () => {
    if (isStreamValid(localStream)) {
      setCurrentView('random-talk');
    } else {
      setPendingAction({ type: 'random-talk' });
      setIsPermissionsOpen(true);
    }
  };

  const handleJoinRoom = (roomId: string, token?: string) => {
    setActiveRoomId(roomId);
    setActiveRoomToken(token);
    setCurrentView('room-active');
  };

  const handlePermissionsReady = (stream: MediaStream) => {
    setLocalStream(stream);
    setIsPermissionsOpen(false);

    if (pendingAction?.type === 'random-talk') {
      setCurrentView('random-talk');
    } else if (pendingAction?.type === 'join-room') {
      setActiveRoomId(pendingAction.roomId);
      setActiveRoomToken(pendingAction.token);
      setCurrentView('room-active');
    }
    setPendingAction(null);
  };

  const handleNavigate = (view: AppView) => {
    if (view === 'random-talk') {
      handleStartRandomTalk();
    } else {
      // If leaving active calls
      if (currentView === 'random-talk' && socket) {
        socket.emit('match:cancel');
      }
      if (currentView === 'room-active' && socket) {
        socket.emit('room:leave');
      }
      setCurrentView(view);
    }
  };

  const handleExitRandomTalk = () => {
    if (socket) {
      socket.emit('match:cancel');
    }
    setCurrentView('landing');
  };

  const handleLeaveRoom = () => {
    if (socket) {
      socket.emit('room:leave');
    }
    setActiveRoomId(null);
    setActiveRoomToken(undefined);
    setCurrentView('rooms-discovery');
  };

  return (
    <div className="min-h-screen bg-[#07080c] text-white flex flex-col selection:bg-violet-500 selection:text-white">
      {/* Universal Top Navigation */}
      <Navbar
        currentView={currentView}
        onNavigate={handleNavigate}
        stats={stats}
        onOpenPrivacy={() => setIsPrivacyOpen(true)}
      />

      {/* Main Content Area */}
      <main className={`flex-1 flex flex-col relative ${currentView === 'landing' || currentView === 'rooms-discovery' ? 'pb-16 md:pb-0' : ''}`}>
        {currentView === 'landing' && (
          <LandingHero
            onStartRandomTalk={handleStartRandomTalk}
            onExploreRooms={() => setCurrentView('rooms-discovery')}
            stats={stats}
          />
        )}

        {currentView === 'random-talk' && socket && (
          <RandomTalkView
            socket={socket}
            localStream={localStream}
            currentUser={currentUser}
            onExit={handleExitRandomTalk}
          />
        )}

        {currentView === 'rooms-discovery' && socket && (
          <RoomsDiscoveryView
            socket={socket}
            currentUser={currentUser}
            onJoinRoom={handleJoinRoom}
          />
        )}

        {currentView === 'room-active' && socket && activeRoomId && (
          <RoomView
            socket={socket}
            roomId={activeRoomId}
            roomToken={activeRoomToken}
            localStream={localStream}
            currentUser={currentUser}
            onLeaveRoom={handleLeaveRoom}
          />
        )}
      </main>

      {/* Mobile Floating Bottom Navigation Bar (Shown on Landing and Rooms discovery) */}
      {(currentView === 'landing' || currentView === 'rooms-discovery') && (
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0a0d17]/95 backdrop-blur-2xl border-t border-white/10 pb-safe px-4 py-2 flex items-center justify-around shadow-2xl"
          aria-label="Mobile Bottom Navigation"
        >
          <button
            onClick={() => handleNavigate('landing')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
              currentView === 'landing' ? 'text-violet-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[10px] font-mono">Home</span>
          </button>

          <button
            onClick={() => handleNavigate('random-talk')}
            className="flex flex-col items-center gap-1 py-1 px-3 -mt-4 rounded-2xl bg-gradient-to-r from-violet-600 to-cyan-500 text-white font-bold shadow-lg shadow-violet-600/30 transition-all active:scale-95"
          >
            <Radio className="w-5 h-5" />
            <span className="text-[10px] font-mono">Talk</span>
          </button>

          <button
            onClick={() => handleNavigate('rooms-discovery')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
              currentView === 'rooms-discovery' ? 'text-cyan-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Users className="w-5 h-5" />
            <span className="text-[10px] font-mono">Rooms</span>
          </button>

          <button
            onClick={() => setIsPrivacyOpen(true)}
            className="flex flex-col items-center gap-1 py-1 px-3 rounded-xl text-slate-400 hover:text-white transition-all"
          >
            <Shield className="w-5 h-5 text-emerald-400" />
            <span className="text-[10px] font-mono">Privacy</span>
          </button>
        </nav>
      )}

      {/* Camera & Microphone Setup Modal */}
      <PermissionsModal
        isOpen={isPermissionsOpen}
        onClose={() => {
          setIsPermissionsOpen(false);
          setPendingAction(null);
        }}
        onReadyToStart={handlePermissionsReady}
      />

      {/* Zero-Account Privacy & Security Notice Modal */}
      <PrivacyNoticeModal
        isOpen={isPrivacyOpen}
        onClose={() => setIsPrivacyOpen(false)}
      />
    </div>
  );
}
