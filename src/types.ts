export type AppView = 'landing' | 'random-talk' | 'rooms-discovery' | 'room-active';

export interface UserSession {
  id: string; // e.g. "anonymous-user-8f32a9"
  name: string; // e.g. "Stranger 07"
  avatarSeed: string;
  country?: string;
  city?: string;
  lat?: number;
  lng?: number;
}

export type MatchState =
  | 'IDLE'
  | 'PERMISSIONS'
  | 'SEARCHING'
  | 'MATCHED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTING'
  | 'ENDED'
  | 'ERROR';

export interface RoomParticipant {
  id: string; // session ID
  socketId: string;
  name: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeaking: boolean;
  isCreator: boolean;
  joinedAt: number;
}

export interface Room {
  id: string;
  token: string;
  type: 'public' | 'private';
  name: string;
  description: string;
  creatorId: string;
  maxParticipants: number;
  participants: RoomParticipant[];
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text?: string;
  imageUrl?: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type ReportReason =
  | 'Harassment'
  | 'Spam'
  | 'Sexual content'
  | 'Violence'
  | 'Hate/abuse'
  | 'Other';

export interface ServerStats {
  onlineUsers: number;
  waitingUsers: number;
  activeRooms: number;
}
