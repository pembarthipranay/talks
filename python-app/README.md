# Randomtalks — Python Edition

> Anonymous Real-Time Voice & Video Social Platform built with Python (FastAPI + python-socketio) and WebRTC.

## Features

- **1-on-1 Random Talk**: Anonymous matching queue, direct P2P WebRTC audio/video calls, skip to next stranger, AI icebreaker generation with Gemini.
- **Multi-Peer Topic Rooms**: Create public or private rooms with code, dynamic video grid, real-time in-room text chat and image sharing (up to 5MB).
- **Interactive 3D Earth**: Visual globe rendered using Three.js displaying worldwide connections.
- **Zero-Database Privacy**: All session tokens and room states reside entirely in memory; nothing is written to disk.
- **STUN/TURN Ready**: Configured with `stun:stun.l.google.com:19302`. Optional TURN credentials can be passed via environment variables.

---

## Quickstart

### 1. Prerequisites
- Python 3.10 or higher
- `pip` (Python package manager)

### 2. Setup Virtual Environment & Install Dependencies
```bash
cd python-app

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
# On Linux / macOS:
source venv/bin/activate
# On Windows:
# venv\Scripts\activate

# Install requirements
pip install -r requirements.txt
```

### 3. Environment Variables (Optional)
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Optional settings in `.env`:
- `GEMINI_API_KEY`: Enables AI Icebreaker question generation.
- `PORT`: Set local port (defaults to `8000`).
- `TURN_SERVER`, `TURN_USERNAME`, `TURN_PASSWORD`: Optional TURN relay servers.

### 4. Run the Server
```bash
python3 main:app
# Or using uvicorn directly:
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Open your browser at:
```
http://localhost:8000
```

---

## Docker Deployment

To run with Docker:
```bash
docker build -t randomtalks-python .
docker run -p 8000:8000 randomtalks-python
```
Access at `http://localhost:8000`.
