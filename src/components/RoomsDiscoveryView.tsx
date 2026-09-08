import React, { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { Room, UserSession } from '../types.ts';
import {
  Users,
  Plus,
  Lock,
  Globe,
  Radio,
  Search,
  Sparkles,
  ArrowRight,
  Shield,
  X,
  Volume2,
} from 'lucide-react';

interface RoomsDiscoveryViewProps {
  socket: Socket;
  currentUser: UserSession | null;
  onJoinRoom: (roomId: string, token?: string) => void;
}

export const RoomsDiscoveryView: React.FC<RoomsDiscoveryViewProps> = ({
  socket,
  currentUser,
  onJoinRoom,
}) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [privateCodeInput, setPrivateCodeInput] = useState('');

  // Form state
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomDesc, setNewRoomDesc] = useState('');
  const [newRoomType, setNewRoomType] = useState<'public' | 'private'>('public');
  const [newRoomCapacity, setNewRoomCapacity] = useState<number>(12);

  // Fetch rooms on mount and listen to updates
  useEffect(() => {
    fetch('/api/rooms')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setRooms(data);
        }
      })
      .catch((err) => console.warn('Error fetching rooms:', err));

    const handleRoomsUpdated = (updatedRooms: Room[]) => {
      setRooms(updatedRooms);
    };

    socket.on('rooms:updated', handleRoomsUpdated);

    const handleRoomCreated = (createdRoom: Room) => {
      setIsCreating(false);
      setIsCreateOpen(false);
      onJoinRoom(createdRoom.id, createdRoom.token);
    };

    const handleRoomError = (data: { message: string }) => {
      setIsCreating(false);
      setCreateError(data.message || 'Unable to perform room action.');
    };

    socket.on('room:created', handleRoomCreated);
    socket.on('room:error', handleRoomError);

    return () => {
      socket.off('rooms:updated', handleRoomsUpdated);
      socket.off('room:created', handleRoomCreated);
      socket.off('room:error', handleRoomError);
    };
  }, [socket, onJoinRoom]);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    setIsCreating(true);
    setCreateError(null);

    const payload = {
      name: newRoomName.trim(),
      description: newRoomDesc.trim(),
      type: newRoomType,
      maxParticipants: Number(newRoomCapacity) || 12,
    };

    try {
      // Direct REST API creation ensures 100% reliable room creation
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.room) {
          setIsCreating(false);
          setIsCreateOpen(false);
          onJoinRoom(data.room.id, data.room.token);
          return;
        }
      }
    } catch (err) {
      console.warn('REST room creation fallback to socket:', err);
    }

    if (!socket.connected) {
      socket.connect();
    }

    socket.emit('room:create', payload);
  };

  const handleJoinPrivate = (e: React.FormEvent) => {
    e.preventDefault();
    const code = privateCodeInput.trim();
    if (!code) return;

    // Support entering full URL or direct room ID/token
    if (code.includes('room=')) {
      const params = new URLSearchParams(code.split('#')[1] || code);
      const rId = params.get('room');
      const token = params.get('token');
      if (rId) {
        onJoinRoom(rId, token || undefined);
        return;
      }
    }

    onJoinRoom(code);
  };

  const filteredRooms = rooms.filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 py-5 sm:py-8">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8 pb-5 sm:pb-6 border-b border-white/10">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-xs font-mono text-cyan-300 mb-2">
            <Users className="w-3.5 h-3.5" />
            Temporary Voice & Video Hubs
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold font-display text-white">
            ROOMS
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-xl">
            Join a public conversation space or create your own temporary room with up to 20 participants. Ephemeral, zero account required.
          </p>
        </div>

        {/* Create room button */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreateOpen(true)}
            className="w-full sm:w-auto justify-center px-5 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 text-white font-bold text-xs sm:text-sm tracking-wide shadow-lg shadow-violet-600/25 flex items-center gap-2 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Room</span>
          </button>
        </div>
      </div>

      {/* Search and Private Join Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {/* Search */}
        <div className="md:col-span-2 relative">
          <Search className="absolute left-3.5 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search open rooms by topic or name..."
            className="w-full pl-10 sm:pl-11 pr-4 py-2.5 sm:py-3 rounded-2xl bg-white/[0.03] border border-white/10 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
          />
        </div>

        {/* Private room invite input */}
        <form onSubmit={handleJoinPrivate} className="flex gap-2">
          <div className="relative flex-1">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={privateCodeInput}
              onChange={(e) => setPrivateCodeInput(e.target.value)}
              placeholder="Invite link or code..."
              className="w-full pl-10 pr-3 py-2.5 sm:py-3 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50 font-mono"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 sm:py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-200 hover:text-white text-xs font-semibold border border-white/10 transition-colors cursor-pointer shrink-0"
          >
            Join
          </button>
        </form>
      </div>

      {/* Public Rooms Grid */}
      <div className="mb-8">
        <h2 className="text-xs uppercase tracking-wider font-mono text-slate-400 mb-4 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          Popular Now ({filteredRooms.length} Public Rooms)
        </h2>

        {filteredRooms.length === 0 ? (
          <div className="p-8 sm:p-12 text-center rounded-3xl bg-white/[0.02] border border-white/5 flex flex-col items-center">
            <Users className="w-10 h-10 sm:w-12 sm:h-12 text-slate-600 mb-3" />
            <h3 className="text-base sm:text-lg font-semibold text-slate-300">No rooms match your filter</h3>
            <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">
              Be the first to open a conversation room for strangers to discover!
            </p>
            <button
              onClick={() => setIsCreateOpen(true)}
              className="px-4 py-2 rounded-xl bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 text-xs font-medium border border-violet-500/30"
            >
              Create First Room
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {filteredRooms.map((room) => {
              const currentCount = room.participants?.length || 0;
              const isFull = currentCount >= room.maxParticipants;

              return (
                <div
                  key={room.id}
                  className="group relative p-4 sm:p-6 rounded-2xl sm:rounded-3xl bg-[#0d101a] border border-white/10 hover:border-cyan-500/40 transition-all duration-200 flex flex-col justify-between shadow-xl hover:shadow-cyan-950/20"
                >
                  <div>
                    {/* Top badging */}
                    <div className="flex items-center justify-between gap-2 mb-2.5 sm:mb-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 sm:py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-[10px] sm:text-[11px] font-mono border border-cyan-500/20">
                        <Users className="w-3 h-3" />
                        {currentCount} / {room.maxParticipants}
                      </span>
                      {room.participants?.some((p) => p.isSpeaking) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-mono border border-emerald-500/30 animate-pulse">
                          <Volume2 className="w-2.5 h-2.5" />
                          Speaking
                        </span>
                      )}
                    </div>

                    <h3 className="text-base sm:text-lg font-bold font-display text-white group-hover:text-cyan-300 transition-colors">
                      {room.name}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1.5 sm:mt-2 line-clamp-2 leading-relaxed">
                      {room.description || 'Anonymous conversation space.'}
                    </p>
                  </div>

                  {/* Bottom Action */}
                  <div className="mt-5 sm:mt-6 pt-3.5 sm:pt-4 border-t border-white/5 flex items-center justify-between">
                    <span className="text-[10px] sm:text-[11px] font-mono text-slate-500">
                      {isFull ? (
                        <span className="text-rose-400">ROOM FULL</span>
                      ) : (
                        `${room.maxParticipants - currentCount} spots left`
                      )}
                    </span>

                    <button
                      onClick={() => onJoinRoom(room.id)}
                      disabled={isFull}
                      className={`px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                        isFull
                          ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                          : 'bg-white/5 hover:bg-cyan-500/20 text-slate-200 hover:text-cyan-200 border border-white/10 hover:border-cyan-500/30 cursor-pointer'
                      }`}
                    >
                      <span>{isFull ? 'Full' : 'JOIN ROOM'}</span>
                      {!isFull && <ArrowRight className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Room Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3.5 sm:p-4 bg-black/80 backdrop-blur-xl animate-in fade-in">
          <div className="relative w-full max-w-lg rounded-2xl sm:rounded-3xl bg-[#0d101a] border border-white/10 shadow-2xl p-5 sm:p-8 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsCreateOpen(false)}
              className="absolute top-4 right-4 sm:top-5 sm:right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="mb-5 sm:mb-6 pr-8">
              <h3 className="text-xl sm:text-2xl font-bold font-display text-white">Create your room</h3>
              <p className="text-xs text-slate-400 mt-1">
                Temporary space with WebRTC voice/video and image sharing. Disappears when empty.
              </p>
            </div>

            <form onSubmit={handleCreateRoom} className="space-y-3.5 sm:space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Room Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={50}
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="e.g. Late Night Philosophy Lounge"
                  className="w-full px-3.5 sm:px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Room Description
                </label>
                <textarea
                  maxLength={200}
                  rows={2}
                  value={newRoomDesc}
                  onChange={(e) => setNewRoomDesc(e.target.value)}
                  placeholder="What is this conversation space about?"
                  className="w-full px-3.5 sm:px-4 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Room Type
                  </label>
                  <div className="flex rounded-xl bg-white/[0.03] p-1 border border-white/10 text-xs">
                    <button
                      type="button"
                      onClick={() => setNewRoomType('public')}
                      className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
                        newRoomType === 'public'
                          ? 'bg-cyan-500 text-white shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Public
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewRoomType('private')}
                      className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
                        newRoomType === 'private'
                          ? 'bg-violet-600 text-white shadow'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Private
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Capacity (3 - 20)
                  </label>
                  <input
                    type="number"
                    min={3}
                    max={20}
                    value={newRoomCapacity}
                    onChange={(e) => setNewRoomCapacity(Math.max(3, Math.min(20, Number(e.target.value))))}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs sm:text-sm text-white font-mono text-center focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {newRoomType === 'private' && (
                <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/20 text-xs text-violet-300 flex items-start gap-2">
                  <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Private rooms will NOT be displayed in public room discovery. A secure invite link will be generated for you to copy and share.
                  </span>
                </div>
              )}

              {createError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                  {createError}
                </div>
              )}

              <div className="pt-3 sm:pt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="flex-1 py-2.5 sm:py-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newRoomName.trim() || isCreating}
                  className="flex-2 py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 disabled:opacity-40 text-white font-bold text-xs tracking-wider shadow-lg shadow-violet-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isCreating ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>CREATING...</span>
                    </>
                  ) : (
                    <span>CREATE ROOM</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
