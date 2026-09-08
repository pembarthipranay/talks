import React, { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  SkipForward,
  PhoneOff,
  ShieldAlert,
  UserX,
  MessageSquare,
  Send,
  Sparkles,
  Radio,
  Globe,
  RefreshCw,
  X,
  Volume2,
  SwitchCamera,
} from 'lucide-react';
import { MatchState, UserSession, IceServerConfig, ChatMessage, ReportReason } from '../types.ts';
import { PeerConnectionWrapper, startSpeakingDetector, stopSpeakingDetector, stopMediaStream, flipCameraStream } from '../services/webrtc.ts';
import { ReportModal, BlockModal } from './SafetyModals.tsx';

interface RandomTalkViewProps {
  socket: Socket;
  localStream: MediaStream | null;
  currentUser: UserSession | null;
  onExit: () => void;
}

export const RandomTalkView: React.FC<RandomTalkViewProps> = ({
  socket,
  localStream,
  currentUser,
  onExit,
}) => {
  const [matchState, setMatchState] = useState<MatchState>('SEARCHING');
  const [stranger, setStranger] = useState<{ id: string; name: string; avatarSeed: string } | null>(null);
  const [isInitiator, setIsInitiator] = useState<boolean>(false);
  const [iceServers, setIceServers] = useState<IceServerConfig[]>([]);

  // Media states
  const [isLocalMuted, setIsLocalMuted] = useState(false);
  const [isLocalVideoOff, setIsLocalVideoOff] = useState(false);
  const [isStrangerMuted, setIsStrangerMuted] = useState(false);
  const [isStrangerVideoOff, setIsStrangerVideoOff] = useState(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [isStrangerSpeaking, setIsStrangerSpeaking] = useState(false);

  // Disconnect / Ended info
  const [endReason, setEndReason] = useState<string | null>(null);

  // Chat overlay in Random Talk
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');

  // AI Icebreaker / Conversation Starter
  const [aiTopic, setAiTopic] = useState<string | null>(null);
  const [isLoadingAiTopic, setIsLoadingAiTopic] = useState(false);

  // Modals
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isBlockOpen, setIsBlockOpen] = useState(false);

  // Mobile camera flip state
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);

  const handleFlipCamera = async () => {
    if (!localStream || isFlippingCamera) return;
    setIsFlippingCamera(true);
    const targetMode = facingMode === 'user' ? 'environment' : 'user';
    const result = await flipCameraStream(localStream, targetMode);
    setIsFlippingCamera(false);
    if (result.newTrack) {
      setFacingMode(targetMode);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
        localVideoRef.current.play().catch(() => {});
      }
      if (pcWrapperRef.current) {
        const senders = pcWrapperRef.current.pc.getSenders();
        const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(result.newTrack);
        }
      }
    }
  };

  const handleFetchAiTopic = async () => {
    setIsLoadingAiTopic(true);
    try {
      const res = await fetch('/api/ai/icebreaker');
      const data = await res.json();
      if (data?.topic) {
        setAiTopic(data.topic);
      }
    } catch (e) {
      console.warn('Failed to fetch AI topic:', e);
    } finally {
      setIsLoadingAiTopic(false);
    }
  };

  // DOM Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const strangerVideoRef = useRef<HTMLVideoElement>(null);
  const pcWrapperRef = useRef<PeerConnectionWrapper | null>(null);
  const remoteStreamRef = useRef<MediaStream>(new MediaStream());
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingOfferRef = useRef<{ sdp: RTCSessionDescriptionInit; from: string } | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Bind local stream to video
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream]);

  // Ensure remote stream is attached to stranger video when connected
  useEffect(() => {
    if (strangerVideoRef.current && remoteStreamRef.current && matchState === 'CONNECTED') {
      if (strangerVideoRef.current.srcObject !== remoteStreamRef.current) {
        strangerVideoRef.current.srcObject = remoteStreamRef.current;
      }
      strangerVideoRef.current.play().catch((e) => console.warn('Stranger video play error:', e));
    }
  }, [matchState]);

  // Speaking detection on local audio
  useEffect(() => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      startSpeakingDetector(audioTrack, (speaking) => {
        setIsLocalSpeaking(speaking);
        socket.emit('user:speaking', speaking);
      });
    }
    return () => {
      if (audioTrack) {
        stopSpeakingDetector(audioTrack);
      }
    };
  }, [localStream, socket]);

  // Cleanup helper
  const teardownPeerConnection = () => {
    if (pcWrapperRef.current) {
      pcWrapperRef.current.close();
      pcWrapperRef.current = null;
    }
    pendingIceCandidatesRef.current = [];
    pendingOfferRef.current = null;
    remoteStreamRef.current = new MediaStream();
    if (strangerVideoRef.current) {
      strangerVideoRef.current.srcObject = null;
    }
    setIsStrangerSpeaking(false);
  };

  // Main Socket Matchmaking & WebRTC Event Handlers
  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }
    // Initial match request
    socket.emit('match:request');

    const handleConnect = () => {
      socket.emit('match:request');
    };
    socket.on('connect', handleConnect);

    const handleMatchQueued = () => {
      setMatchState('SEARCHING');
      setStranger(null);
      setEndReason(null);
      teardownPeerConnection();
    };

    const handleOffer = async (payload: { sdp: RTCSessionDescriptionInit; from: string }) => {
      if (!pcWrapperRef.current) {
        pendingOfferRef.current = payload;
        return;
      }
      try {
        await pcWrapperRef.current.setRemoteDescription(payload.sdp);
        const answer = await pcWrapperRef.current.createAnswer();
        socket.emit('webrtc:answer', { sdp: answer });
      } catch (err) {
        console.error('[WebRTC] Error handling offer:', err);
      }
    };

    const handleAnswer = async (payload: { sdp: RTCSessionDescriptionInit }) => {
      if (!pcWrapperRef.current) return;
      try {
        await pcWrapperRef.current.setRemoteDescription(payload.sdp);
      } catch (err) {
        console.error('[WebRTC] Error handling answer:', err);
      }
    };

    const handleCandidate = async (payload: { candidate: RTCIceCandidateInit }) => {
      if (!payload || !payload.candidate) return;
      if (!pcWrapperRef.current) {
        pendingIceCandidatesRef.current.push(payload.candidate);
        return;
      }
      try {
        await pcWrapperRef.current.addIceCandidate(payload.candidate);
      } catch (err) {
        console.error('[WebRTC] Error handling candidate:', err);
      }
    };

    const handleMatchFound = async (data: {
      stranger: { id: string; name: string; avatarSeed: string };
      isInitiator: boolean;
      iceServers: IceServerConfig[];
    }) => {
      console.log('[Matchmaker] Matched with stranger:', data.stranger, 'Initiator:', data.isInitiator);
      setStranger(data.stranger);
      setIsInitiator(data.isInitiator);
      setIceServers(data.iceServers);
      setMatchState('CONNECTING');
      setChatMessages([]);

      teardownPeerConnection();

      // Create WebRTC Peer Connection
      const pcWrapper = new PeerConnectionWrapper(
        data.iceServers,
        (event) => {
          console.log('[WebRTC] Received remote track:', event.track.kind);
          if (event.streams && event.streams[0]) {
            remoteStreamRef.current = event.streams[0];
          } else {
            remoteStreamRef.current.addTrack(event.track);
          }
          if (strangerVideoRef.current) {
            strangerVideoRef.current.srcObject = remoteStreamRef.current;
            strangerVideoRef.current.play().catch((e) => console.warn('Video auto-play warning:', e));
          }
        },
        (candidate) => {
          socket.emit('webrtc:ice-candidate', { candidate });
        },
        (connectionState) => {
          console.log('[WebRTC] Connection state:', connectionState);
          if (connectionState === 'connected') {
            setMatchState('CONNECTED');
          } else if (connectionState === 'failed' || connectionState === 'disconnected') {
            // Handled or retry
          }
        }
      );

      pcWrapperRef.current = pcWrapper;

      // Add local media tracks
      if (localStream) {
        pcWrapper.addTracks(localStream);
      }

      // Fallback transition: If WebRTC ICE negotiation takes a few seconds across diverse cellular/Wi-Fi NATs,
      // transition to CONNECTED after 2.5s so both peers have active controls and live chat immediately
      const connectionTimeout = setTimeout(() => {
        setMatchState((prev) => (prev === 'CONNECTING' ? 'CONNECTED' : prev));
      }, 2500);

      // Flush buffered early candidates
      while (pendingIceCandidatesRef.current.length > 0) {
        const c = pendingIceCandidatesRef.current.shift();
        if (c) {
          pcWrapper.addIceCandidate(c);
        }
      }

      // Flush buffered offer if peer was faster
      if (pendingOfferRef.current) {
        const off = pendingOfferRef.current;
        pendingOfferRef.current = null;
        await handleOffer(off);
      }

      // If initiator, generate SDP Offer
      if (data.isInitiator) {
        try {
          const offer = await pcWrapper.createOffer();
          socket.emit('webrtc:offer', { sdp: offer });
        } catch (err) {
          console.error('[WebRTC] Error creating offer:', err);
        }
      }

      return () => clearTimeout(connectionTimeout);
    };

    const handleCallEnded = (data: { reason: string; strangerId: string }) => {
      console.log('[Match] Stranger disconnected:', data.reason);
      teardownPeerConnection();
      setMatchState('ENDED');
      if (data.reason === 'stranger-skipped') {
        setEndReason('The stranger skipped to the next person.');
      } else if (data.reason === 'blocked') {
        setEndReason('User was blocked for this session.');
      } else {
        setEndReason('Your stranger left the conversation.');
      }
    };

    const handlePeerMute = (data: { isMuted: boolean }) => {
      setIsStrangerMuted(data.isMuted);
    };

    const handlePeerCamera = (data: { isVideoOff: boolean }) => {
      setIsStrangerVideoOff(data.isVideoOff);
    };

    const handlePeerSpeaking = (data: { isSpeaking: boolean }) => {
      setIsStrangerSpeaking(data.isSpeaking);
    };

    const handleRandomChat = (msg: ChatMessage) => {
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

      // If message is from stranger, automatically speak with browser speech synthesis if available
      if (msg.senderId !== currentUser?.id && msg.text && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel(); // cancel any stale utterance
          const utterance = new SpeechSynthesisUtterance(msg.text);
          utterance.rate = 1.05;
          utterance.pitch = 1.0;
          window.speechSynthesis.speak(utterance);
        } catch (e) {
          // ignore policy or synthesis block
        }
      }
    };

    socket.on('match:queued', handleMatchQueued);
    socket.on('match:found', handleMatchFound);
    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleCandidate);
    socket.on('call:ended', handleCallEnded);
    socket.on('peer:mute', handlePeerMute);
    socket.on('peer:camera', handlePeerCamera);
    socket.on('peer:speaking', handlePeerSpeaking);
    socket.on('random:chat', handleRandomChat);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('match:queued', handleMatchQueued);
      socket.off('match:found', handleMatchFound);
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleCandidate);
      socket.off('call:ended', handleCallEnded);
      socket.off('peer:mute', handlePeerMute);
      socket.off('peer:camera', handlePeerCamera);
      socket.off('peer:speaking', handlePeerSpeaking);
      socket.off('random:chat', handleRandomChat);
      teardownPeerConnection();
    };
  }, [socket, localStream]);

  // Controls
  const handleToggleMic = () => {
    if (!localStream) return;
    const aTrack = localStream.getAudioTracks()[0];
    if (aTrack) {
      aTrack.enabled = !aTrack.enabled;
      const nextMuted = !aTrack.enabled;
      setIsLocalMuted(nextMuted);
      socket.emit('user:mute', nextMuted);
    }
  };

  const handleToggleCamera = () => {
    if (!localStream) return;
    const vTrack = localStream.getVideoTracks()[0];
    if (vTrack) {
      vTrack.enabled = !vTrack.enabled;
      const nextVideoOff = !vTrack.enabled;
      setIsLocalVideoOff(nextVideoOff);
      socket.emit('user:camera', nextVideoOff);
    }
  };

  const handleNextStranger = () => {
    teardownPeerConnection();
    setMatchState('SEARCHING');
    setStranger(null);
    setEndReason(null);
    socket.emit('match:next');
  };

  const handleEndCall = () => {
    teardownPeerConnection();
    socket.emit('match:end');
    onExit();
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit('random:chat', { text: chatInput.trim() });
    setChatInput('');
  };

  const handleBlockConfirm = () => {
    teardownPeerConnection();
    socket.emit('user:block');
    setMatchState('ENDED');
    setEndReason('User has been blocked. You will not be paired with them again.');
  };

  const handleReportSubmit = (reason: ReportReason, details?: string) => {
    teardownPeerConnection();
    socket.emit('user:report', { reason, details });
    setMatchState('ENDED');
    setEndReason(`User reported for ${reason}. Disconnected and blocked for this session.`);
  };

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] min-h-[calc(100dvh-4rem)] bg-[#07080c] flex flex-col justify-between overflow-hidden">
      {/* Top Bar Status */}
      <div className="absolute top-3 left-2 right-2 sm:top-4 sm:left-4 sm:right-4 z-30 flex items-center justify-between pointer-events-none gap-2">
        <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="px-2.5 sm:px-3.5 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center gap-2 text-xs font-medium max-w-[200px] xs:max-w-[260px] sm:max-w-none">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                matchState === 'CONNECTED'
                  ? 'bg-emerald-400 animate-pulse'
                  : matchState === 'CONNECTING'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-cyan-400 animate-pulse'
              }`}
            />
            <span className="font-mono text-slate-200 truncate">
              {matchState === 'CONNECTED'
                ? `With ${stranger?.name || 'Stranger'}`
                : matchState === 'CONNECTING'
                ? 'Connecting...'
                : matchState === 'SEARCHING'
                ? 'Searching...'
                : 'Disconnected'}
            </span>
          </div>

          {matchState === 'CONNECTED' && isStrangerSpeaking && (
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-mono animate-pulse">
              <Volume2 className="w-3.5 h-3.5" />
              <span>Speaking</span>
            </div>
          )}
        </div>

        {/* Action icons right */}
        {matchState === 'CONNECTED' && (
          <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={handleFetchAiTopic}
              disabled={isLoadingAiTopic}
              className="px-2.5 sm:px-3 py-1.5 rounded-full bg-violet-600/30 hover:bg-violet-600/50 backdrop-blur-md border border-violet-400/30 text-white text-xs font-medium flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
              title="Get an AI conversation starter powered by Gemini"
            >
              <Sparkles className={`w-3.5 h-3.5 text-cyan-300 ${isLoadingAiTopic ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline font-mono">AI Topic</span>
            </button>
            <button
              onClick={() => setIsChatOpen(!isChatOpen)}
              className={`p-2 sm:p-2.5 rounded-full backdrop-blur-md border transition-all cursor-pointer ${
                isChatOpen
                  ? 'bg-violet-600 text-white border-violet-400'
                  : 'bg-black/60 text-slate-300 border-white/10 hover:bg-white/10'
              }`}
              title="Toggle In-Call Chat"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsReportOpen(true)}
              className="p-2 sm:p-2.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all cursor-pointer"
              title="Report user"
            >
              <ShieldAlert className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsBlockOpen(true)}
              className="p-2 sm:p-2.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 transition-all cursor-pointer"
              title="Block user for session"
            >
              <UserX className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Floating AI Topic Pill */}
      {aiTopic && matchState === 'CONNECTED' && (
        <div className="absolute top-14 sm:top-16 left-1/2 -translate-x-1/2 z-40 max-w-lg w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)]">
          <div className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl bg-[#0c0f1d]/95 backdrop-blur-xl border border-violet-500/40 shadow-2xl flex items-center justify-between gap-2.5 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <span className="p-1 rounded-lg bg-violet-600/30 text-cyan-300 shrink-0">
                <Sparkles className="w-3.5 h-3.5" />
              </span>
              <p className="text-xs sm:text-sm text-slate-100 font-medium truncate sm:whitespace-normal">
                {aiTopic}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => {
                  socket.emit('random:chat', { text: `[Topic] ${aiTopic}` });
                  setIsChatOpen(true);
                }}
                className="px-2 sm:px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-mono text-cyan-300 transition-colors cursor-pointer"
                title="Send topic to in-call chat"
              >
                Send
              </button>
              <button
                onClick={() => setAiTopic(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Video Viewport */}
      <div className="relative flex-1 w-full h-full flex items-center justify-center bg-black/40 overflow-hidden">
        {/* Searching Radar Animation */}
        {matchState === 'SEARCHING' && (
          <div className="flex flex-col items-center justify-center text-center p-6 max-w-md z-20">
            {/* Custom Radar Wave Circles */}
            <div className="relative w-32 h-32 sm:w-40 sm:h-40 flex items-center justify-center mb-6 sm:mb-8">
              <div className="absolute inset-0 rounded-full border border-violet-500/20 animate-ping opacity-60" />
              <div className="absolute inset-3 rounded-full border border-cyan-500/30 animate-pulse" />
              <div className="absolute inset-8 rounded-full border border-violet-400/40 animate-pulse-subtle" />
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-tr from-violet-600 to-cyan-500 flex items-center justify-center shadow-xl shadow-violet-600/30">
                <Globe className="w-7 h-7 sm:w-8 sm:h-8 text-white animate-spin-reverse" />
              </div>
            </div>

            <h3 className="text-xl sm:text-3xl font-bold font-display text-white mb-2">
              Finding someone...
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 mb-6 font-light max-w-xs sm:max-w-none">
              Searching the world for your next conversation. Connecting across peer nodes...
            </p>

            <button
              onClick={handleEndCall}
              className="px-5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium border border-white/10 transition-colors"
            >
              Cancel Search
            </button>
          </div>
        )}

        {/* Connecting Screen */}
        {matchState === 'CONNECTING' && (
          <div className="flex flex-col items-center justify-center text-center p-6 z-20">
            <RefreshCw className="w-10 h-10 sm:w-12 sm:h-12 text-cyan-400 animate-spin mb-4" />
            <h3 className="text-lg sm:text-xl font-bold text-white mb-1">
              Matched with {stranger?.name || 'Stranger'}
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Negotiating peer ICE candidates & media channels...
            </p>
          </div>
        )}

        {/* Disconnected / Stranger Left Screen */}
        {matchState === 'ENDED' && (
          <div className="flex flex-col items-center justify-center text-center p-6 max-w-md z-20">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mb-4">
              <PhoneOff className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <h3 className="text-xl sm:text-2xl font-bold font-display text-white mb-2">
              {endReason || 'Your stranger left.'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 mb-6">
              Ready for another conversation with someone new?
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleEndCall}
                className="px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 font-medium text-xs transition-colors"
              >
                Return Home
              </button>
              <button
                onClick={handleNextStranger}
                className="px-5 py-2.5 sm:px-6 sm:py-3 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 text-white font-bold text-xs tracking-wider shadow-lg shadow-violet-600/30 transition-all flex items-center gap-2"
              >
                <SkipForward className="w-4 h-4" />
                <span>FIND SOMEONE NEW</span>
              </button>
            </div>
          </div>
        )}

        {/* Stranger Remote Video Stream */}
        <div
          className={`absolute inset-0 w-full h-full flex items-center justify-center bg-[#05060a] ${
            matchState === 'CONNECTED' ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <video
            ref={strangerVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover ${isStrangerVideoOff ? 'hidden' : 'block'}`}
          />

          {/* If stranger camera is off */}
          {isStrangerVideoOff && matchState === 'CONNECTED' && (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-tr from-violet-800 to-indigo-900 border-2 border-violet-500/30 flex items-center justify-center shadow-xl">
                <span className="text-xl sm:text-2xl font-extrabold font-display text-white">
                  {stranger?.name.slice(0, 2) || 'ST'}
                </span>
                {isStrangerSpeaking && (
                  <div className="absolute -inset-2 rounded-full border-2 border-emerald-400 animate-ping opacity-75" />
                )}
              </div>
              <span className="text-xs sm:text-sm font-medium text-slate-300">
                {stranger?.name} (Camera off)
              </span>
            </div>
          )}

          {/* Stranger Speaking Glow Border */}
          {isStrangerSpeaking && (
            <div className="absolute inset-0 border-4 border-emerald-400/70 pointer-events-none shadow-[inset_0_0_30px_rgba(52,211,153,0.3)] transition-all" />
          )}
        </div>

        {/* Picture-in-Picture Local Video (Bottom Right) */}
        <div className="absolute bottom-22 sm:bottom-24 right-3 sm:right-4 z-20 w-28 xs:w-36 sm:w-44 aspect-video rounded-2xl bg-black/80 border border-white/20 shadow-2xl overflow-hidden backdrop-blur-md group transition-all">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''} ${isLocalVideoOff ? 'hidden' : 'block'}`}
          />
          {isLocalVideoOff && (
            <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-500 text-[10px] font-mono">
              <VideoOff className="w-4 h-4 sm:w-5 sm:h-5 mb-1" />
              <span>Camera Off</span>
            </div>
          )}

          {/* Speaking indicator for self */}
          {isLocalSpeaking && (
            <div className="absolute inset-0 border-2 border-cyan-400 pointer-events-none" />
          )}

          {/* Camera Flip Quick Button on PiP */}
          {!isLocalVideoOff && (
            <button
              onClick={handleFlipCamera}
              className="absolute bottom-1.5 right-1.5 p-1 rounded-lg bg-black/70 hover:bg-black text-white text-[10px] backdrop-blur-md border border-white/10 transition-colors"
              title="Switch Front/Rear Camera"
            >
              <SwitchCamera className={`w-3.5 h-3.5 ${isFlippingCamera ? 'animate-spin' : ''}`} />
            </button>
          )}

          {/* Small label */}
          <div className="absolute top-1 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[8px] sm:text-[9px] font-mono text-slate-300 max-w-[85%] truncate">
            You
          </div>
        </div>

        {/* In-Call Quick Chat Drawer / Overlay (Responsive bottom/side sheet) */}
        {isChatOpen && (
          <div className="absolute inset-x-2 top-14 bottom-22 sm:inset-x-auto sm:right-4 sm:top-16 sm:bottom-24 sm:w-80 z-30 rounded-2xl bg-[#0b0e17]/95 border border-white/10 shadow-2xl flex flex-col backdrop-blur-xl animate-in slide-in-from-right duration-200">
            <div className="p-3 border-b border-white/10 flex items-center justify-between">
              <span className="text-xs font-bold font-mono text-slate-200 flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
                In-Call Notes
              </span>
              <button
                onClick={() => setIsChatOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 p-3 overflow-y-auto space-y-2 text-xs">
              {chatMessages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-center px-4 font-light text-xs">
                  Type a message below to share thoughts or links with your stranger.
                </div>
              ) : (
                chatMessages.map((msg) => {
                  const isMe = msg.senderId === currentUser?.id;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                    >
                      <span className="text-[10px] font-mono text-slate-500 mb-0.5">
                        {isMe ? 'You' : msg.senderName}
                      </span>
                      <div
                        className={`p-2.5 rounded-xl max-w-[85%] break-words leading-relaxed ${
                          isMe
                            ? 'bg-violet-600 text-white rounded-br-xs'
                            : 'bg-white/10 text-slate-200 rounded-bl-xs'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            <form onSubmit={handleSendChat} className="p-2 border-t border-white/10 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Say something..."
                maxLength={500}
                className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className="p-2 rounded-xl bg-violet-600 disabled:opacity-40 text-white cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Bottom Floating Controls Bar */}
      <div className="relative z-30 p-2.5 pb-safe sm:p-4 sm:pb-6 flex items-center justify-center">
        <div className="flex items-center gap-2 sm:gap-4 p-2 sm:p-2.5 rounded-2xl bg-[#0c0f1a]/95 backdrop-blur-xl border border-white/10 shadow-2xl">
          {/* Mute Button */}
          <button
            onClick={handleToggleMic}
            className={`p-3 sm:p-3.5 rounded-xl transition-all cursor-pointer ${
              isLocalMuted
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                : 'bg-white/5 hover:bg-white/10 text-white border border-white/5'
            }`}
            title={isLocalMuted ? 'Unmute Microphone' : 'Mute Microphone'}
          >
            {isLocalMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Camera Button */}
          <button
            onClick={handleToggleCamera}
            className={`p-3 sm:p-3.5 rounded-xl transition-all cursor-pointer ${
              isLocalVideoOff
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                : 'bg-white/5 hover:bg-white/10 text-white border border-white/5'
            }`}
            title={isLocalVideoOff ? 'Turn On Camera' : 'Turn Off Camera'}
          >
            {isLocalVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
          </button>

          {/* Camera Flip (Mobile Switch Camera) */}
          <button
            onClick={handleFlipCamera}
            disabled={isLocalVideoOff || isFlippingCamera}
            className="p-3 sm:p-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/5 transition-all cursor-pointer disabled:opacity-30"
            title="Switch Front/Rear Camera"
          >
            <SwitchCamera className={`w-5 h-5 ${isFlippingCamera ? 'animate-spin' : ''}`} />
          </button>

          {/* Next Stranger Button (Primary Action) */}
          <button
            onClick={handleNextStranger}
            className="px-4 sm:px-5 py-3 sm:py-3.5 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 text-white font-bold text-xs sm:text-sm tracking-wider shadow-lg shadow-violet-600/30 flex items-center gap-1.5 sm:gap-2 border border-violet-400/40 active:scale-95 transition-all cursor-pointer"
            title="Disconnect & meet next stranger"
          >
            <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">NEXT STRANGER</span>
            <span className="sm:hidden font-mono">NEXT</span>
          </button>

          {/* End Conversation Button */}
          <button
            onClick={handleEndCall}
            className="p-3 sm:p-3.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 transition-all cursor-pointer"
            title="End Conversation & Exit"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Safety Modals */}
      {stranger && (
        <>
          <ReportModal
            isOpen={isReportOpen}
            strangerName={stranger.name}
            onClose={() => setIsReportOpen(false)}
            onSubmit={handleReportSubmit}
          />
          <BlockModal
            isOpen={isBlockOpen}
            strangerName={stranger.name}
            onClose={() => setIsBlockOpen(false)}
            onConfirmBlock={handleBlockConfirm}
          />
        </>
      )}
    </div>
  );
};
