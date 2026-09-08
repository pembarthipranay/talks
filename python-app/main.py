import os
import time
import random
import string
from typing import Dict, List, Optional, Set, Any
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import socketio
from dotenv import load_dotenv

load_dotenv()

# Setup Socket.IO async ASGI server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
fastapi_app = FastAPI(title="Randomtalks", description="Anonymous Random Voice & Video Social Platform")

# Mount static and templates
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(BASE_DIR, "static")
templates_dir = os.path.join(BASE_DIR, "templates")

if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)
if not os.path.exists(templates_dir):
    os.makedirs(templates_dir, exist_ok=True)

fastapi_app.mount("/static", StaticFiles(directory=static_dir), name="static")
templates = Jinja2Templates(directory=templates_dir)

# --- In-Memory State Models (Anonymous, Zero-Database) ---

class ConnectedUser:
    def __init__(self, socket_id: str, session_id: str, name: str, avatar_seed: str):
        self.socket_id: str = socket_id
        self.session_id: str = session_id
        self.name: str = name
        self.avatar_seed: str = avatar_seed
        self.current_room_id: Optional[str] = None
        self.paired_stranger_id: Optional[str] = None
        self.is_muted: bool = False
        self.is_video_off: bool = False
        self.is_speaking: bool = False
        self.blocked_users: Set[str] = set()
        self.joined_at: float = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.session_id,
            "name": self.name,
            "avatarSeed": self.avatar_seed,
            "isMuted": self.is_muted,
            "isVideoOff": self.is_video_off,
            "isSpeaking": self.is_speaking
        }

class Room:
    def __init__(self, room_id: str, token: str, room_type: str, name: str, description: str, creator_id: str, max_participants: int = 12):
        self.id: str = room_id
        self.token: str = token
        self.type: str = room_type  # 'public' or 'private'
        self.name: str = name
        self.description: str = description
        self.creator_id: str = creator_id
        self.max_participants: int = max_participants
        self.participants: Dict[str, Dict[str, Any]] = {}
        self.created_at: float = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "token": self.token,
            "type": self.type,
            "name": self.name,
            "description": self.description,
            "creatorId": self.creator_id,
            "maxParticipants": self.max_participants,
            "participants": list(self.participants.values()),
            "createdAt": int(self.created_at * 1000)
        }

users_by_session: Dict[str, ConnectedUser] = {}
users_by_socket: Dict[str, ConnectedUser] = {}
waiting_queue: List[str] = []
active_rooms: Dict[str, Room] = {}

# Seed default starter public rooms
def seed_default_rooms():
    defaults = [
        Room("room-latenight", "tok-latenight", "public", "Late Night Thoughts", "Chill conversations about life, universe, and nocturnal thoughts.", "system-bot", 16),
        Room("room-music", "tok-music", "public", "Music & Audio Lounge", "Share favorite artists, vinyl tracks, and acoustic recommendations.", "system-bot", 12),
        Room("room-tech", "tok-tech", "public", "Tech & Future Ideas", "Discuss coding, open source, AI experiments, and side projects.", "system-bot", 14)
    ]
    for r in defaults:
        active_rooms[r.id] = r

seed_default_rooms()

# --- STUN / TURN Configuration ---
STUN_SERVER = "stun:stun.l.google.com:19302"

def get_ice_servers() -> List[Dict[str, Any]]:
    servers = [
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "stun:stun1.l.google.com:19302"},
        {"urls": "stun:stun2.l.google.com:19302"},
    ]
    turn_server = os.getenv("TURN_SERVER", "").strip()
    turn_user = os.getenv("TURN_USERNAME", "").strip()
    turn_pass = os.getenv("TURN_PASSWORD", "").strip()

    if turn_server and turn_user and turn_pass:
        servers.append({
            "urls": turn_server,
            "username": turn_user,
            "credential": turn_pass
        })
    return servers

# --- Gemini AI Lazy Initialization for Icebreakers ---
FALLBACK_ICEBREAKERS = [
    "If you could have dinner with any historical figure for one hour, who would it be and why?",
    "What is the most underrated movie or album you genuinely believe everyone should experience?",
    "If you could teleport to any city in the world right this second, where are you going?",
    "What is a weird or useless talent that you are surprisingly good at?",
    "If your life had a signature soundtrack, what song would play during the opening credits?",
    "What is something you believed as a child that completely blew your mind when you found out it was false?",
    "What is the best piece of advice you've ever received that actually turned out to be useful?"
]

def generate_icebreaker() -> str:
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        try:
            from google import genai
            client = genai.Client(api_key=gemini_key)
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents="Generate one creative, fun, thought-provoking conversation icebreaker question for two strangers meeting online. Output only the single question without quotes or preamble."
            )
            text = response.text.strip()
            if text:
                return text
        except Exception as e:
            print(f"[Gemini] Warning generating icebreaker: {e}")
    return random.choice(FALLBACK_ICEBREAKERS)

# --- Matchmaking Engine ---
async def try_matchmaking():
    global waiting_queue
    # Filter waiting queue to valid active idle users
    waiting_queue = [
        sid for sid in waiting_queue
        if sid in users_by_session and not users_by_session[sid].paired_stranger_id and not users_by_session[sid].current_room_id
    ]

    if len(waiting_queue) < 2:
        return

    i = 0
    while i < len(waiting_queue):
        user_a_id = waiting_queue[i]
        user_a = users_by_session.get(user_a_id)
        if not user_a:
            i += 1
            continue

        matched = False
        j = i + 1
        while j < len(waiting_queue):
            user_b_id = waiting_queue[j]
            user_b = users_by_session.get(user_b_id)
            if not user_b:
                j += 1
                continue

            # Check eligibility
            if (user_a_id != user_b_id and
                user_b_id not in user_a.blocked_users and
                user_a_id not in user_b.blocked_users):
                
                # Matched pair found!
                waiting_queue.pop(j)
                waiting_queue.pop(i)

                user_a.paired_stranger_id = user_b_id
                user_b.paired_stranger_id = user_a_id

                ice_servers = get_ice_servers()

                # User A is initiator (creates SDP offer)
                await sio.emit("match:found", {
                    "stranger": {
                        "id": user_b.session_id,
                        "name": user_b.name,
                        "avatarSeed": user_b.avatar_seed
                    },
                    "isInitiator": True,
                    "iceServers": ice_servers
                }, to=user_a.socket_id)

                # User B is responder (creates SDP answer)
                await sio.emit("match:found", {
                    "stranger": {
                        "id": user_a.session_id,
                        "name": user_a.name,
                        "avatarSeed": user_a.avatar_seed
                    },
                    "isInitiator": False,
                    "iceServers": ice_servers
                }, to=user_b.socket_id)

                await broadcast_stats()
                matched = True
                break
            j += 1

        if not matched:
            i += 1

async def break_pair(user: ConnectedUser, notify_reason: str = "stranger-left"):
    if not user.paired_stranger_id:
        return
    stranger_id = user.paired_stranger_id
    user.paired_stranger_id = None

    stranger = users_by_session.get(stranger_id)
    if stranger:
        stranger.paired_stranger_id = None
        await sio.emit("call:ended", {
            "reason": notify_reason,
            "strangerId": user.session_id
        }, to=stranger.socket_id)

async def leave_current_room(user: ConnectedUser):
    if not user.current_room_id:
        return
    room_id = user.current_room_id
    room = active_rooms.get(room_id)
    user.current_room_id = None

    if not room:
        return

    await sio.leave_room(user.socket_id, room.id)
    if user.session_id in room.participants:
        del room.participants[user.session_id]

    if len(room.participants) == 0:
        # Delete dynamic temporary rooms
        if not room.id.startswith("room-latenight") and not room.id.startswith("room-music") and not room.id.startswith("room-tech"):
            active_rooms.pop(room.id, None)
    else:
        # Transfer host ownership if creator leaves
        if room.creator_id == user.session_id and len(room.participants) > 0:
            first_remaining_id = next(iter(room.participants.keys()))
            room.creator_id = first_remaining_id
            room.participants[first_remaining_id]["isCreator"] = True
            await sio.emit("room:ownership-transferred", {"newCreatorId": first_remaining_id}, room=room.id)

        await sio.emit("room:user-left", {
            "userId": user.session_id,
            "name": user.name,
            "remainingCount": len(room.participants)
        }, room=room.id)

    # Broadcast updated room list
    public_rooms = [r.to_dict() for r in active_rooms.values() if r.type == "public"]
    await sio.emit("rooms:updated", public_rooms)

async def broadcast_stats():
    await sio.emit("stats:update", {
        "onlineUsers": len(users_by_session),
        "waitingUsers": len(waiting_queue),
        "activeRooms": len(active_rooms)
    })

# --- HTTP Endpoints ---

@fastapi_app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@fastapi_app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "onlineUsers": len(users_by_session),
        "waitingUsers": len(waiting_queue),
        "activeRooms": len(active_rooms),
        "timestamp": int(time.time() * 1000)
    }

@fastapi_app.get("/api/rooms")
async def get_rooms():
    return [r.to_dict() for r in active_rooms.values() if r.type == "public"]

@fastapi_app.get("/api/room/{room_id}")
async def get_room(room_id: str):
    room = active_rooms.get(room_id)
    if not room:
        return JSONResponse({"error": "Room not found"}, status_code=404)
    return room.to_dict()

@fastapi_app.post("/api/ai/icebreaker")
async def get_icebreaker_route():
    prompt = generate_icebreaker()
    return {"prompt": prompt}

# --- Socket.IO Event Handlers ---

@sio.event
async def connect(sid, environ):
    pass

@sio.event
async def disconnect(sid):
    user = users_by_socket.get(sid)
    if user:
        global waiting_queue
        waiting_queue = [uid for uid in waiting_queue if uid != user.session_id]
        await break_pair(user, "disconnected")
        await leave_current_room(user)

        users_by_session.pop(user.session_id, None)
        users_by_socket.pop(sid, None)

        await broadcast_stats()

@sio.on("session:init")
async def handle_session_init(sid, data):
    session_id = data.get("sessionId") or f"anon-{''.join(random.choices(string.ascii_lowercase + string.digits, k=7))}"
    rand_num = random.randint(100, 999)
    name = data.get("name") or f"Stranger {rand_num}"
    avatar_seed = f"seed-{session_id}"

    user = ConnectedUser(socket_id=sid, session_id=session_id, name=name, avatar_seed=avatar_seed)
    users_by_session[session_id] = user
    users_by_socket[sid] = user

    await sio.emit("session:ready", {
        "user": {"id": session_id, "name": name, "avatarSeed": avatar_seed},
        "iceServers": get_ice_servers(),
        "onlineCount": len(users_by_session)
    }, to=sid)

    await broadcast_stats()

def ensure_user(sid: str) -> ConnectedUser:
    user = users_by_socket.get(sid)
    if not user:
        session_id = f"anon-{''.join(random.choices(string.ascii_lowercase + string.digits, k=7))}"
        rand_num = random.randint(100, 999)
        name = f"Stranger {rand_num}"
        avatar_seed = f"seed-{session_id}"
        user = ConnectedUser(socket_id=sid, session_id=session_id, name=name, avatar_seed=avatar_seed)
        users_by_session[session_id] = user
        users_by_socket[sid] = user
    return user

# 1-on-1 Matchmaking
@sio.on("match:request")
async def handle_match_request(sid):
    user = ensure_user(sid)

    await break_pair(user, "next")
    if user.current_room_id:
        await leave_current_room(user)

    if user.session_id not in waiting_queue:
        waiting_queue.append(user.session_id)

    await sio.emit("match:queued", to=sid)
    await broadcast_stats()
    await try_matchmaking()

@sio.on("match:cancel")
async def handle_match_cancel(sid):
    user = ensure_user(sid)
    global waiting_queue
    waiting_queue = [uid for uid in waiting_queue if uid != user.session_id]
    await sio.emit("match:cancelled", to=sid)
    await broadcast_stats()

@sio.on("match:next")
async def handle_match_next(sid):
    user = ensure_user(sid)
    await break_pair(user, "stranger-skipped")

    if user.session_id not in waiting_queue:
        waiting_queue.append(user.session_id)

    await sio.emit("match:queued", to=sid)
    await broadcast_stats()
    await try_matchmaking()

@sio.on("match:end")
async def handle_match_end(sid):
    user = users_by_socket.get(sid)
    if not user:
        return
    global waiting_queue
    waiting_queue = [uid for uid in waiting_queue if uid != user.session_id]
    await break_pair(user, "call-ended")
    await sio.emit("match:idle", to=sid)
    await broadcast_stats()

# 1-on-1 WebRTC Signaling
@sio.on("webrtc:offer")
async def handle_webrtc_offer(sid, payload):
    user = users_by_socket.get(sid)
    if not user or not user.paired_stranger_id:
        return
    stranger = users_by_session.get(user.paired_stranger_id)
    if stranger:
        await sio.emit("webrtc:offer", {
            "sdp": payload.get("sdp"),
            "from": user.session_id
        }, to=stranger.socket_id)

@sio.on("webrtc:answer")
async def handle_webrtc_answer(sid, payload):
    user = users_by_socket.get(sid)
    if not user or not user.paired_stranger_id:
        return
    stranger = users_by_session.get(user.paired_stranger_id)
    if stranger:
        await sio.emit("webrtc:answer", {
            "sdp": payload.get("sdp"),
            "from": user.session_id
        }, to=stranger.socket_id)

@sio.on("webrtc:ice-candidate")
async def handle_webrtc_candidate(sid, payload):
    user = users_by_socket.get(sid)
    if not user or not user.paired_stranger_id:
        return
    stranger = users_by_session.get(user.paired_stranger_id)
    if stranger:
        await sio.emit("webrtc:ice-candidate", {
            "candidate": payload.get("candidate"),
            "from": user.session_id
        }, to=stranger.socket_id)

@sio.on("chat:message")
async def handle_chat_message(sid, data):
    user = users_by_socket.get(sid)
    if not user or not user.paired_stranger_id:
        return
    stranger = users_by_session.get(user.paired_stranger_id)
    if stranger:
        text = str(data.get("text", "")).strip()[:500]
        if not text:
            return
        msg = {
            "id": f"msg-{int(time.time()*1000)}",
            "senderId": user.session_id,
            "senderName": user.name,
            "text": text,
            "timestamp": int(time.time()*1000)
        }
        await sio.emit("chat:message", msg, to=stranger.socket_id)
        await sio.emit("chat:message", msg, to=user.socket_id)

# In-Call Peer State Updates
@sio.on("user:mute")
async def handle_user_mute(sid, is_muted):
    user = users_by_socket.get(sid)
    if not user:
        return
    user.is_muted = bool(is_muted)
    if user.paired_stranger_id:
        stranger = users_by_session.get(user.paired_stranger_id)
        if stranger:
            await sio.emit("peer:mute", {"isMuted": user.is_muted}, to=stranger.socket_id)

@sio.on("user:camera")
async def handle_user_camera(sid, is_video_off):
    user = users_by_socket.get(sid)
    if not user:
        return
    user.is_video_off = bool(is_video_off)
    if user.paired_stranger_id:
        stranger = users_by_session.get(user.paired_stranger_id)
        if stranger:
            await sio.emit("peer:camera", {"isVideoOff": user.is_video_off}, to=stranger.socket_id)

@sio.on("user:speaking")
async def handle_user_speaking(sid, is_speaking):
    user = users_by_socket.get(sid)
    if not user:
        return
    user.is_speaking = bool(is_speaking)
    if user.paired_stranger_id:
        stranger = users_by_session.get(user.paired_stranger_id)
        if stranger:
            await sio.emit("peer:speaking", {"isSpeaking": user.is_speaking}, to=stranger.socket_id)
    if user.current_room_id:
        await sio.emit("room:user-speaking", {
            "userId": user.session_id,
            "isSpeaking": user.is_speaking
        }, room=user.current_room_id)

# Safety Tools
@sio.on("user:block")
async def handle_user_block(sid):
    user = users_by_socket.get(sid)
    if not user or not user.paired_stranger_id:
        return
    stranger_id = user.paired_stranger_id
    user.blocked_users.add(stranger_id)
    await break_pair(user, "blocked")
    await sio.emit("user:blocked-success", {"strangerId": stranger_id}, to=sid)

@sio.on("user:report")
async def handle_user_report(sid, data):
    user = users_by_socket.get(sid)
    if not user or not user.paired_stranger_id:
        return
    stranger_id = user.paired_stranger_id
    user.blocked_users.add(stranger_id)
    print(f"[Safety Report] User {user.session_id} reported {stranger_id} for: {data.get('reason')}")
    await break_pair(user, "reported")
    await sio.emit("user:reported-success", {"strangerId": stranger_id}, to=sid)

# --- Room Management ---

@sio.on("room:create")
async def handle_room_create(sid, data):
    user = users_by_socket.get(sid)
    if not user:
        return

    name = str(data.get("name", "Conversation Room")).strip()[:50] or "Conversation Room"
    description = str(data.get("description", "Join to talk")).strip()[:200]
    room_type = "private" if data.get("type") == "private" else "public"
    max_participants = max(3, min(20, int(data.get("maxParticipants", 12))))

    rand_tag = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    room_id = f"room-{rand_tag}"
    token = f"tok-{''.join(random.choices(string.ascii_lowercase + string.digits, k=8))}"

    room = Room(room_id, token, room_type, name, description, user.session_id, max_participants)
    active_rooms[room_id] = room

    await sio.emit("room:created", room.to_dict(), to=sid)
    public_rooms = [r.to_dict() for r in active_rooms.values() if r.type == "public"]
    await sio.emit("rooms:updated", public_rooms)

@sio.on("room:join")
async def handle_room_join(sid, data):
    user = users_by_socket.get(sid)
    if not user:
        return
    room_id = data.get("roomId")
    token = data.get("token")

    room = active_rooms.get(room_id)
    if not room:
        await sio.emit("room:error", {"message": "Room not found or expired."}, to=sid)
        return

    if room.type == "private" and room.token != token:
        await sio.emit("room:error", {"message": "Invalid private room code or invite link."}, to=sid)
        return

    if len(room.participants) >= room.max_participants:
        await sio.emit("room:error", {"message": "Room is currently full."}, to=sid)
        return

    # Leave prior activities
    global waiting_queue
    waiting_queue = [uid for uid in waiting_queue if uid != user.session_id]
    await break_pair(user, "room-joined")
    if user.current_room_id and user.current_room_id != room.id:
        await leave_current_room(user)

    user.current_room_id = room.id
    await sio.enter_room(sid, room.id)

    participant_data = {
        "id": user.session_id,
        "socketId": sid,
        "name": user.name,
        "isMuted": user.is_muted,
        "isVideoOff": user.is_video_off,
        "isSpeaking": user.is_speaking,
        "isCreator": room.creator_id == user.session_id,
        "joinedAt": int(time.time()*1000)
    }
    room.participants[user.session_id] = participant_data

    # Send room details and existing participants to joiner
    await sio.emit("room:joined", {
        "room": room.to_dict(),
        "participants": list(room.participants.values()),
        "iceServers": get_ice_servers()
    }, to=sid)

    # Broadcast new participant to others in room
    await sio.emit("room:user-joined", {"participant": participant_data}, room=room.id, skip_sid=sid)

    public_rooms = [r.to_dict() for r in active_rooms.values() if r.type == "public"]
    await sio.emit("rooms:updated", public_rooms)

@sio.on("room:leave")
async def handle_room_leave(sid):
    user = users_by_socket.get(sid)
    if user:
        await leave_current_room(user)
        await sio.emit("room:left", to=sid)

@sio.on("room:signal")
async def handle_room_signal(sid, data):
    user = users_by_socket.get(sid)
    if not user:
        return
    target_user_id = data.get("targetUserId")
    target_user = users_by_session.get(target_user_id)
    if target_user:
        await sio.emit("room:signal", {
            "fromUserId": user.session_id,
            "signalType": data.get("signalType"),
            "signalData": data.get("signalData")
        }, to=target_user.socket_id)

@sio.on("room:chat")
async def handle_room_chat(sid, data):
    user = users_by_socket.get(sid)
    if not user or not user.current_room_id:
        return
    text = str(data.get("text", "")).strip()[:500]
    if not text:
        return
    msg = {
        "id": f"msg-{int(time.time()*1000)}",
        "senderId": user.session_id,
        "senderName": user.name,
        "text": text,
        "timestamp": int(time.time()*1000)
    }
    await sio.emit("room:chat", msg, room=user.current_room_id)

@sio.on("room:image")
async def handle_room_image(sid, data):
    user = users_by_socket.get(sid)
    if not user or not user.current_room_id:
        return
    image_data = data.get("imageData")
    if not image_data or len(image_data) > 7_000_000: # ~5MB raw payload limit
        return
    msg = {
        "id": f"img-{int(time.time()*1000)}",
        "senderId": user.session_id,
        "senderName": user.name,
        "imageData": image_data,
        "timestamp": int(time.time()*1000)
    }
    await sio.emit("room:image", msg, room=user.current_room_id)

@sio.on("room:kick")
async def handle_room_kick(sid, data):
    user = users_by_socket.get(sid)
    if not user or not user.current_room_id:
        return
    room = active_rooms.get(user.current_room_id)
    if not room or room.creator_id != user.session_id:
        return
    target_id = data.get("targetUserId")
    target_user = users_by_session.get(target_id)
    if target_user and target_user.current_room_id == room.id:
        await leave_current_room(target_user)
        await sio.emit("room:kicked", {"message": "You were removed by the room creator."}, to=target_user.socket_id)

# Combine ASGI applications
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"Starting Randomtalks on http://0.0.0.0:{port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
