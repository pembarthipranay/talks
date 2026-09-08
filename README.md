# 🎙️ RandomTalks

> A real-time random voice/video communication platform built with WebRTC.

🌐 **Live Demo:** https://talks-tc4e.onrender.com/

💻 **GitHub:** https://github.com/pembarthipranay/talks

---

## 📌 About

**RandomTalks** is a real-time communication web application that allows users to connect with random people and communicate through voice, video, and text.

This project was built as a practical learning project to understand:

- WebRTC
- Real-time communication
- WebSockets
- User matchmaking
- Browser camera and microphone APIs
- Backend development
- Production deployment

### Basic Flow

```text
User joins
    ↓
Random matchmaking
    ↓
Another user is found
    ↓
Signaling
    ↓
WebRTC connection
    ↓
Real-time communication

✨ Features
🎥 Real-Time Voice & Video

Connect with another user through real-time audio and video using WebRTC.

🎲 Random Matching

Users can enter a matchmaking queue and get paired with another available user.

⏭️ Skip & Find Another User

Users can leave the current conversation and search for another random user.

💬 Real-Time Text Chat

Send text messages during a conversation.

🤖 AI Practice Mode

The project includes an AI practice mode where users can interact with an AI-generated stranger.

🎤 Microphone Control

Mute and unmute the microphone during a call.

📹 Camera Control

Turn the camera on or off during a video conversation.

🌐 Real-Time Connection

The application uses real-time communication technologies to manage users, matching, and connection states.

👤 Anonymous Sessions

Users can join without creating a traditional account.

🛠️ Tech Stack
Frontend
React
TypeScript
Vite
Tailwind CSS
Lucide React
Motion
Three.js
Backend
Node.js
Express
Socket.IO
Real-Time Communication
WebRTC
Socket.IO
Browser Media APIs
Python Version

The repository also contains a Python implementation using:

Python
FastAPI
python-socketio
Uvicorn
WebRTC
AI
Google Gemini API
Deployment
Render
Docker
Version Control
Git
GitHub
🔗 How WebRTC Works

WebRTC stands for Web Real-Time Communication.

It allows browsers to establish real-time audio and video communication.

RandomTalks uses Socket.IO for signaling and WebRTC for the actual real-time media connection.

Simplified Architecture
┌──────────────┐
│    User A    │
│   Browser    │
└──────┬───────┘
       │
       │ Signaling
       ▼
┌────────────────────┐
│   Backend Server    │
│  Matchmaking +     │
│     Signaling       │
└─────────┬──────────┘
          │
          │ Signaling
          ▼
┌──────────────┐
│    User B    │
│   Browser    │
└──────────────┘

After signaling is completed:

┌──────────────┐
│    User A    │
│   Browser    │
└──────┬───────┘
       │
       │ WebRTC
       │ Audio / Video
       │
       ▼
┌──────────────┐
│    User B    │
│   Browser    │
└──────────────┘
🔄 Matchmaking Process

The application uses a matchmaking system to find available users.

User clicks Start
       ↓
User enters queue
       ↓
Server checks waiting users
       ↓
Two users are matched
       ↓
Match information is exchanged
       ↓
WebRTC signaling begins
       ↓
Peer connection established
       ↓
Voice / Video communication

Users can also:

Cancel matchmaking
Skip the current user
End the conversation
Search for another user
🧠 What I Learned

Building RandomTalks helped me understand several real-world development concepts.

WebRTC

I learned about:

RTCPeerConnection
SDP Offer
SDP Answer
ICE Candidates
STUN
TURN
Peer-to-peer communication
Real-Time Communication

I learned how Socket.IO can be used for:

User sessions
Matchmaking
Signaling
Chat messages
Connection state updates
Browser Media APIs

The application uses browser APIs to access:

Microphone
Camera
Audio streams
Video streams
Backend Development

The backend manages:

Connected users
Waiting users
Matches
Rooms
Connection states
Deployment

One of the biggest lessons was:

An application working on localhost does not automatically mean it will work correctly in production.

Real-time applications introduce additional challenges involving:

HTTPS
WebSockets
WebRTC connectivity
Network configuration
Environment variables
STUN/TURN
Server deployment
