import React, { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  LogOut,
  Copy,
  Check,
  Crown,
  Users,
  MessageSquare,
  Image as ImageIcon,
  Send,
  X,
  Shield,
  Volume2,
  Trash2,
  Lock,
  Globe,
  Upload,
  RefreshCw,
} from 'lucide-react';
import { Room, RoomParticipant, ChatMessage, UserSession, IceServerConfig } from '../types.ts';
import {
  PeerConnectionWrapper,
  startSpeakingDetector,
  stopSpeakingDetector,
  processImageUpload,
  flipCameraStream,
} from '../services/webrtc.ts';

interface RoomViewProps {
  socket: Socket;
  roomId: string;
  roomToken?: string;
  localStream: MediaStream | null;
  currentUser: UserSession | null;
  onLeaveRoom: () => void;
}

export const RoomView: React.FC<RoomViewProps> = ({
  socket,
  roomId,
  roomToken,
  localStream,
  currentUser,
  onLeaveRoom,
}) => {
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [iceServers, setIceServers] = useState<IceServerConfig[]>([]);
  const iceServersRef = useRef<IceServerConfig[]>([]);
  const [roomNotice, setRoomNotice] = useState<string | null>(null);

  // Local media states
  const [isLocalMuted, setIsLocalMuted] = useState(false);
  const [isLocalVideoOff, setIsLocalVideoOff] = useState(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);

  // Chat & Image sharing
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  // Copy feedback
  const [copiedLink, setCopiedLink] = useState(false);

  // Peer connections map for room mesh: Map<targetUserId, PeerConnectionWrapper>
  const peerConnectionsRef = useRef<Map<string, PeerConnectionWrapper>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Bind local stream to local video
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream]);

  // Speaking detection on local stream
  useEffect(() => {
    if (!localStream) return;
    const aTrack = localStream.getAudioTracks()[0];
    if (aTrack) {
      startSpeakingDetector(aTrack, (speaking) => {
        setIsLocalSpeaking(speaking);
        socket.emit('user:speaking', speaking);
      });
    }
    return () => {
      if (aTrack) {
        stopSpeakingDetector(aTrack);
      }
    };
  }, [localStream, socket]);

  // WebRTC mesh peer connection creator for room
  const getOrCreatePeerConnection = (targetUserId: string, isOfferInitiator: boolean) => {
    let pcWrap = peerConnectionsRef.current.get(targetUserId);
    if (pcWrap) return pcWrap;

    let rStream = remoteStreamsRef.current.get(targetUserId);
    if (!rStream) {
      rStream = new MediaStream();
      remoteStreamsRef.current.set(targetUserId, rStream);
    }

    const currentIce = iceServersRef.current.length > 0 ? iceServersRef.current : iceServers;

    pcWrap = new PeerConnectionWrapper(
      currentIce,
      (event) => {
        console.log(`[Room WebRTC] Received track from ${targetUserId}:`, event.track.kind);
        rStream?.addTrack(event.track);
        const el = videoRefs.current.get(targetUserId);
        if (el && rStream) {
          el.srcObject = rStream;
        }
      },
      (candidate) => {
        socket.emit('room:signal', {
          targetUserId,
          signalType: 'candidate',
          signalData: candidate,
        });
      }
    );

    if (localStream) {
      pcWrap.addTracks(localStream);
    }

    peerConnectionsRef.current.set(targetUserId, pcWrap);
    return pcWrap;
  };

  const teardownAllRoomPeers = () => {
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    remoteStreamsRef.current.clear();
    videoRefs.current.clear();
  };

  // Socket setup & room lifecycle
  useEffect(() => {
    // Join room
    socket.emit('room:join', { roomId, token: roomToken });

    const handleRoomJoined = async (data: {
      room: Room;
      participants: RoomParticipant[];
      iceServers: IceServerConfig[];
    }) => {
      console.log('[Room] Successfully joined:', data.room.name, 'Members:', data.participants.length);
      setRoom(data.room);
      setParticipants(data.participants);
      setIceServers(data.iceServers);
      iceServersRef.current = data.iceServers;

      // Connect WebRTC to existing participants in room
      data.participants.forEach(async (p) => {
        if (p.id !== currentUser?.id) {
          const pc = getOrCreatePeerConnection(p.id, true);
          try {
            const offer = await pc.createOffer();
            socket.emit('room:signal', {
              targetUserId: p.id,
              signalType: 'offer',
              signalData: offer,
            });
          } catch (e) {
            console.error('[Room WebRTC] Error creating offer to peer:', p.id, e);
          }
        }
      });
    };

    const handleUserJoined = (data: { participant: RoomParticipant; totalCount: number }) => {
      console.log('[Room] Stranger joined room:', data.participant.name);
      setParticipants((prev) => {
        if (prev.some((p) => p.id === data.participant.id)) return prev;
        return [...prev, data.participant];
      });
      // The joiner will initiate offer to us, or we prepare wrapper
      getOrCreatePeerConnection(data.participant.id, false);
    };

    const handleUserLeft = (data: { userId: string; name: string }) => {
      console.log('[Room] Stranger left room:', data.name);
      setParticipants((prev) => prev.filter((p) => p.id !== data.userId));
      const pc = peerConnectionsRef.current.get(data.userId);
      if (pc) {
        pc.close();
        peerConnectionsRef.current.delete(data.userId);
      }
      remoteStreamsRef.current.delete(data.userId);
      videoRefs.current.delete(data.userId);
    };

    const handleOwnershipTransferred = (data: { newCreatorId: string }) => {
      setRoom((prev) => (prev ? { ...prev, creatorId: data.newCreatorId } : null));
      setParticipants((prev) =>
        prev.map((p) => ({
          ...p,
          isCreator: p.id === data.newCreatorId,
        }))
      );
    };

    const handleParticipantState = (data: {
      userId: string;
      isMuted?: boolean;
      isVideoOff?: boolean;
      isSpeaking?: boolean;
    }) => {
      setParticipants((prev) =>
        prev.map((p) => {
          if (p.id !== data.userId) return p;
          return {
            ...p,
            isMuted: data.isMuted !== undefined ? data.isMuted : p.isMuted,
            isVideoOff: data.isVideoOff !== undefined ? data.isVideoOff : p.isVideoOff,
            isSpeaking: data.isSpeaking !== undefined ? data.isSpeaking : p.isSpeaking,
          };
        })
      );
    };

    const handleRoomSignal = async (data: {
      fromUserId: string;
      signalType: 'offer' | 'answer' | 'candidate';
      signalData: any;
    }) => {
      const pc = getOrCreatePeerConnection(data.fromUserId, false);

      if (data.signalType === 'offer') {
        try {
          await pc.setRemoteDescription(data.signalData);
          const answer = await pc.createAnswer();
          socket.emit('room:signal', {
            targetUserId: data.fromUserId,
            signalType: 'answer',
            signalData: answer,
          });
        } catch (err) {
          console.error('[Room WebRTC] Error responding to offer:', err);
        }
      } else if (data.signalType === 'answer') {
        try {
          await pc.setRemoteDescription(data.signalData);
        } catch (err) {
          console.error('[Room WebRTC] Error setting answer:', err);
        }
      } else if (data.signalType === 'candidate') {
        try {
          await pc.addIceCandidate(data.signalData);
        } catch (err) {
          console.error('[Room WebRTC] Error adding candidate:', err);
        }
      }
    };

    const handleChatMessage = (msg: ChatMessage) => {
      setChatMessages((prev) => [...prev, msg]);
      setUnreadChatCount((prev) => prev + 1);
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    };

    const handleRoomClosed = (data: { message: string }) => {
      teardownAllRoomPeers();
      setRoomNotice(data.message || 'The room was closed by the host.');
    };

    const handleRoomKicked = (data: { message: string }) => {
      teardownAllRoomPeers();
      setRoomNotice(data.message || 'You were removed from the room by the host.');
    };

    const handleRoomError = (data: { message: string }) => {
      teardownAllRoomPeers();
      setRoomNotice(data.message || 'Unable to join or maintain connection to the room.');
    };

    socket.on('room:joined', handleRoomJoined);
    socket.on('room:user-joined', handleUserJoined);
    socket.on('room:user-left', handleUserLeft);
    socket.on('room:ownership-transferred', handleOwnershipTransferred);
    socket.on('room:participant-state', handleParticipantState);
    socket.on('room:signal', handleRoomSignal);
    socket.on('room:chat-message', handleChatMessage);
    socket.on('room:closed', handleRoomClosed);
    socket.on('room:kicked', handleRoomKicked);
    socket.on('room:error', handleRoomError);

    return () => {
      socket.emit('room:leave');
      socket.off('room:joined', handleRoomJoined);
      socket.off('room:user-joined', handleUserJoined);
      socket.off('room:user-left', handleUserLeft);
      socket.off('room:ownership-transferred', handleOwnershipTransferred);
      socket.off('room:participant-state', handleParticipantState);
      socket.off('room:signal', handleRoomSignal);
      socket.off('room:chat-message', handleChatMessage);
      socket.off('room:closed', handleRoomClosed);
      socket.off('room:kicked', handleRoomKicked);
      socket.off('room:error', handleRoomError);
      teardownAllRoomPeers();
    };
  }, [socket, roomId, roomToken, currentUser]);

  // Local media controls
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

  const handleToggleVideo = () => {
    if (!localStream) return;
    const vTrack = localStream.getVideoTracks()[0];
    if (vTrack) {
      vTrack.enabled = !vTrack.enabled;
      const nextVideoOff = !vTrack.enabled;
      setIsLocalVideoOff(nextVideoOff);
      socket.emit('user:camera', nextVideoOff);
    }
  };

  const handleFlipCamera = async () => {
    if (!localStream || isFlippingCamera || isLocalVideoOff) return;
    setIsFlippingCamera(true);
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    try {
      const result = await flipCameraStream(localStream, nextFacing);
      if (!result.error && result.newTrack) {
        setFacingMode(nextFacing);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = result.newStream;
        }
        // Replace track across all peer connections in mesh
        peerConnectionsRef.current.forEach((pc) => {
          pc.replaceTrack(result.newTrack!);
        });
      }
    } catch (err) {
      console.warn('Failed to flip camera in room:', err);
    } finally {
      setIsFlippingCamera(false);
    }
  };

  const handleCopyInviteLink = () => {
    const url = `${window.location.origin}/#room=${roomId}${roomToken ? `&token=${roomToken}` : ''}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit('room:chat-message', { text: chatInput.trim() });
    setChatInput('');
  };

  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageError(null);
    setIsUploadingImage(true);

    const result = await processImageUpload(file, 5);
    setIsUploadingImage(false);

    if (result.error || !result.dataUrl) {
      setImageError(result.error || 'Failed to process image.');
      return;
    }

    // Send ephemeral image to room
    socket.emit('room:chat-message', { imageUrl: result.dataUrl });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const isHost = room?.creatorId === currentUser?.id;

  const handleKickParticipant = (targetUserId: string) => {
    if (!isHost) return;
    if (confirm('Remove this participant from the room?')) {
      socket.emit('room:kick-participant', { targetUserId });
    }
  };

  const handleCloseRoom = () => {
    if (!isHost) return;
    if (confirm('Are you sure you want to close this room for everyone?')) {
      socket.emit('room:close-room');
    }
  };

  // Determine dynamic video grid columns based on participant count
  const allMembers = participants.length > 0 ? participants : [{
    id: currentUser?.id || 'me',
    socketId: '',
    name: currentUser?.name || 'You',
    isMuted: isLocalMuted,
    isVideoOff: isLocalVideoOff,
    isSpeaking: isLocalSpeaking,
    isCreator: isHost,
    joinedAt: Date.now(),
  }];

  const memberCount = allMembers.length;
  let gridColsClass = 'grid-cols-1';
  if (memberCount === 2) gridColsClass = 'grid-cols-1 sm:grid-cols-2';
  else if (memberCount >= 3 && memberCount <= 4) gridColsClass = 'grid-cols-2';
  else if (memberCount >= 5 && memberCount <= 6) gridColsClass = 'grid-cols-2 md:grid-cols-3';
  else if (memberCount >= 7 && memberCount <= 9) gridColsClass = 'grid-cols-3 md:grid-cols-3';
  else if (memberCount >= 10) gridColsClass = 'grid-cols-3 md:grid-cols-4 lg:grid-cols-5';

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] flex flex-col md:flex-row bg-[#07080c] overflow-hidden">
      {/* Main Video Arena */}
      <div className="relative flex-1 flex flex-col justify-between p-3 sm:p-4 overflow-hidden">
        {/* Room Header bar */}
        <div className="flex items-center justify-between gap-3 mb-3 p-2.5 sm:px-4 rounded-2xl bg-black/40 backdrop-blur-md border border-white/5">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div className="truncate">
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold font-display text-white truncate">
                  {room?.name || 'Conversation Room'}
                </h2>
                {room?.type === 'private' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-[10px] font-mono text-violet-300 shrink-0">
                    <Lock className="w-2.5 h-2.5" /> Private
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[10px] font-mono text-cyan-300 shrink-0">
                    <Globe className="w-2.5 h-2.5" /> Public
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 font-mono truncate">
                {participants.length} / {room?.maxParticipants || 20} Active Participants
              </p>
            </div>
          </div>

          {/* Top Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleCopyInviteLink}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-slate-300 flex items-center gap-1.5 border border-white/10 transition-colors cursor-pointer"
              title="Copy room invite link"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copiedLink ? 'Copied Link' : 'Invite'}</span>
            </button>

            {isHost && (
              <button
                onClick={handleCloseRoom}
                className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 text-xs font-mono border border-rose-500/30 flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Close Room for all participants"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Close Room</span>
              </button>
            )}

            {/* Mobile Chat Toggle Button */}
            <button
              onClick={() => {
                setIsMobileChatOpen(!isMobileChatOpen);
                if (!isMobileChatOpen) setUnreadChatCount(0);
              }}
              className="md:hidden relative p-2 rounded-xl bg-white/5 text-slate-300 border border-white/10"
              title="Open Chat"
            >
              <MessageSquare className="w-4 h-4" />
              {unreadChatCount > 0 && !isMobileChatOpen && (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-cyan-500 text-[9px] font-bold text-black font-mono">
                  {unreadChatCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Dynamic Video Tiles Grid */}
        <div className="flex-1 w-full overflow-y-auto p-1">
          <div className={`grid ${gridColsClass} gap-3 h-full auto-rows-fr`}>
            {/* Local Video Card */}
            <div className="relative rounded-2xl bg-[#0d101a] border border-white/10 overflow-hidden flex items-center justify-center group shadow-md min-h-[140px]">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover scale-x-[-1] ${isLocalVideoOff ? 'hidden' : 'block'}`}
              />
              {isLocalVideoOff && (
                <div className="flex flex-col items-center gap-2 text-slate-500">
                  <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 font-bold font-display text-lg">
                    {currentUser?.name.slice(0, 2) || 'ME'}
                  </div>
                  <span className="text-[11px] font-mono">Video Muted</span>
                </div>
              )}

              {/* Speaking Border Indicator */}
              {isLocalSpeaking && (
                <div className="absolute inset-0 border-2 border-emerald-400 pointer-events-none shadow-[inset_0_0_15px_rgba(52,211,153,0.3)] animate-pulse" />
              )}

              {/* Quick Flip Camera Icon on preview */}
              {!isLocalVideoOff && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFlipCamera();
                  }}
                  disabled={isFlippingCamera}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/90 text-slate-300 hover:text-cyan-300 border border-white/10 transition-all active:scale-90 cursor-pointer"
                  title="Flip camera"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isFlippingCamera ? 'animate-spin text-cyan-400' : ''}`} />
                </button>
              )}

              {/* Tag Label */}
              <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                <span className="px-2 py-0.5 rounded-lg bg-black/70 backdrop-blur-md text-[11px] font-mono text-white flex items-center gap-1">
                  {isHost && <Crown className="w-3 h-3 text-amber-400" />}
                  <span>You ({currentUser?.name})</span>
                </span>
                <div className="flex items-center gap-1 bg-black/70 px-1.5 py-0.5 rounded-lg">
                  {isLocalMuted ? <MicOff className="w-3 h-3 text-rose-400" /> : <Mic className="w-3 h-3 text-emerald-400" />}
                </div>
              </div>
            </div>

            {/* Remote Participants Video Cards */}
            {participants
              .filter((p) => p.id !== currentUser?.id)
              .map((p) => {
                return (
                  <div
                    key={p.id}
                    className="relative rounded-2xl bg-[#0d101a] border border-white/10 overflow-hidden flex items-center justify-center group shadow-md min-h-[140px]"
                  >
                    <video
                      ref={(el) => {
                        if (el) {
                          videoRefs.current.set(p.id, el);
                          const st = remoteStreamsRef.current.get(p.id);
                          if (st && el.srcObject !== st) {
                            el.srcObject = st;
                          }
                        }
                      }}
                      autoPlay
                      playsInline
                      className={`w-full h-full object-cover ${p.isVideoOff ? 'hidden' : 'block'}`}
                    />

                    {p.isVideoOff && (
                      <div className="flex flex-col items-center gap-2 text-slate-500">
                        <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-violet-900 to-indigo-900 flex items-center justify-center text-slate-200 font-bold font-display text-lg">
                          {p.name.slice(0, 2) || 'ST'}
                        </div>
                        <span className="text-[11px] font-mono">{p.name} (Camera off)</span>
                      </div>
                    )}

                    {/* Speaking Indicator */}
                    {p.isSpeaking && (
                      <div className="absolute inset-0 border-2 border-emerald-400 pointer-events-none shadow-[inset_0_0_15px_rgba(52,211,153,0.3)] animate-pulse" />
                    )}

                    {/* Host kick control */}
                    {isHost && (
                      <button
                        onClick={() => handleKickParticipant(p.id)}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-rose-600 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove participant"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Participant bottom bar */}
                    <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                      <span className="px-2 py-0.5 rounded-lg bg-black/70 backdrop-blur-md text-[11px] font-mono text-white flex items-center gap-1">
                        {p.isCreator && <Crown className="w-3 h-3 text-amber-400" />}
                        <span>{p.name}</span>
                      </span>
                      <div className="flex items-center gap-1 bg-black/70 px-1.5 py-0.5 rounded-lg">
                        {p.isMuted ? <MicOff className="w-3 h-3 text-rose-400" /> : <Mic className="w-3 h-3 text-emerald-400" />}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Room Bottom Controls Bar */}
        <div className="mt-2 sm:mt-3 flex items-center justify-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3 p-1.5 sm:p-2 rounded-2xl bg-black/70 backdrop-blur-xl border border-white/10 shadow-2xl">
            {/* Mic Toggle */}
            <button
              onClick={handleToggleMic}
              className={`p-2.5 sm:p-3 rounded-xl transition-all cursor-pointer ${
                isLocalMuted
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : 'bg-white/5 hover:bg-white/10 text-white border border-white/5'
              }`}
              title={isLocalMuted ? 'Unmute' : 'Mute'}
            >
              {isLocalMuted ? <MicOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Mic className="w-4 h-4 sm:w-5 sm:h-5" />}
            </button>

            {/* Video Toggle */}
            <button
              onClick={handleToggleVideo}
              className={`p-2.5 sm:p-3 rounded-xl transition-all cursor-pointer ${
                isLocalVideoOff
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : 'bg-white/5 hover:bg-white/10 text-white border border-white/5'
              }`}
              title={isLocalVideoOff ? 'Turn Video On' : 'Turn Video Off'}
            >
              {isLocalVideoOff ? <VideoOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Video className="w-4 h-4 sm:w-5 sm:h-5" />}
            </button>

            {/* Flip Camera Button */}
            <button
              onClick={handleFlipCamera}
              disabled={isLocalVideoOff || isFlippingCamera}
              className={`p-2.5 sm:p-3 rounded-xl transition-all border border-white/5 ${
                isLocalVideoOff
                  ? 'opacity-40 cursor-not-allowed bg-white/5 text-slate-500'
                  : 'bg-white/5 hover:bg-white/10 text-slate-200 hover:text-white cursor-pointer active:scale-95'
              }`}
              title={`Flip camera (${facingMode === 'user' ? 'Front' : 'Back'})`}
            >
              <RefreshCw className={`w-4 h-4 sm:w-5 sm:h-5 ${isFlippingCamera ? 'animate-spin text-cyan-400' : ''}`} />
            </button>

            {/* Mobile Chat Button in Bottom Bar */}
            <button
              onClick={() => {
                setIsMobileChatOpen(!isMobileChatOpen);
                if (!isMobileChatOpen) setUnreadChatCount(0);
              }}
              className="md:hidden relative p-2.5 sm:p-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 hover:text-white border border-white/5 cursor-pointer"
              title="Open Chat"
            >
              <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-400" />
              {unreadChatCount > 0 && !isMobileChatOpen && (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-cyan-500 text-[9px] font-bold text-black font-mono">
                  {unreadChatCount}
                </span>
              )}
            </button>

            {/* Leave Room Button */}
            <button
              onClick={() => {
                teardownAllRoomPeers();
                onLeaveRoom();
              }}
              className="px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/30 text-xs font-bold font-mono transition-all flex items-center gap-1.5 sm:gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>LEAVE</span>
            </button>
          </div>
        </div>
      </div>

      {/* Room Side Panel: Ephemeral Chat & Image Sharing */}
      <div
        className={`w-full md:w-80 lg:w-96 border-l border-white/10 bg-[#0a0d17] flex flex-col justify-between ${
          isMobileChatOpen ? 'fixed inset-0 z-50 flex' : 'hidden md:flex'
        }`}
      >
        {/* Chat Header */}
        <div className="p-3.5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold font-mono text-white">Room Chat & Photos</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-500">Ephemeral</span>
            <button
              onClick={() => setIsMobileChatOpen(false)}
              className="md:hidden p-1 rounded text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Message Log */}
        <div className="flex-1 p-3 overflow-y-auto space-y-3">
          {chatMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-4 text-slate-500 text-xs font-light">
              <MessageSquare className="w-8 h-8 text-slate-600 mb-2" />
              <p>No messages yet.</p>
              <p className="text-[11px] text-slate-600 mt-1">
                Share temporary messages or upload images (max 5MB) for this room session.
              </p>
            </div>
          ) : (
            chatMessages.map((msg) => {
              const isMe = msg.senderId === currentUser?.id;
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <span className="text-[10px] font-mono text-slate-500 mb-1">
                    {isMe ? 'You' : msg.senderName}
                  </span>

                  {/* Image attachment */}
                  {msg.imageUrl && (
                    <div
                      onClick={() => setZoomedImage(msg.imageUrl || null)}
                      className="mb-1.5 max-w-[220px] rounded-2xl overflow-hidden border border-white/10 cursor-zoom-in hover:opacity-95 transition-opacity"
                    >
                      <img
                        src={msg.imageUrl}
                        alt="Shared in room"
                        className="w-full h-auto object-cover max-h-48"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}

                  {/* Text content */}
                  {msg.text && (
                    <div
                      className={`p-2.5 rounded-2xl max-w-[85%] text-xs leading-relaxed break-words ${
                        isMe
                          ? 'bg-gradient-to-r from-violet-600 to-cyan-600 text-white rounded-br-xs'
                          : 'bg-white/10 text-slate-200 rounded-bl-xs'
                      }`}
                    >
                      {msg.text}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Image error warning */}
        {imageError && (
          <div className="px-3 py-1.5 bg-rose-500/10 border-t border-rose-500/20 text-[11px] text-rose-300 flex items-center justify-between">
            <span>{imageError}</span>
            <button onClick={() => setImageError(null)} className="text-rose-400">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Chat Input & Image Share Bar */}
        <form onSubmit={handleSendMessage} className="p-3 border-t border-white/10 flex items-center gap-2">
          {/* File picker for image sharing */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleImageFileSelect}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingImage}
            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
            title="Share image (Max 5MB)"
          >
            {isUploadingImage ? (
              <Upload className="w-4 h-4 text-cyan-400 animate-bounce" />
            ) : (
              <ImageIcon className="w-4 h-4 text-cyan-400" />
            )}
          </button>

          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Send message..."
            maxLength={500}
            className="flex-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />

          <button
            type="submit"
            disabled={!chatInput.trim()}
            className="p-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black font-bold transition-all cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>

      {/* Image Zoom / Lightbox Modal */}
      {zoomedImage && (
        <div
          onClick={() => setZoomedImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md cursor-zoom-out animate-in fade-in"
        >
          <button
            onClick={() => setZoomedImage(null)}
            className="absolute top-5 right-5 p-2 rounded-full bg-white/10 text-white"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={zoomedImage}
            alt="Zoomed attachment"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-2xl shadow-2xl"
            referrerPolicy="no-referrer"
          />
        </div>
      )}

      {/* Room Notice Modal (Host closed, kicked, or error) */}
      {roomNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="w-full max-w-sm rounded-2xl bg-[#0e111a] border border-white/10 p-6 text-center shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
              <LogOut className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Room Notification</h3>
            <p className="text-sm text-slate-300 mb-6">{roomNotice}</p>
            <button
              onClick={() => {
                setRoomNotice(null);
                onLeaveRoom();
              }}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 text-white font-bold text-xs tracking-wider shadow-lg shadow-violet-600/30 transition-all cursor-pointer"
            >
              RETURN TO ROOMS
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
