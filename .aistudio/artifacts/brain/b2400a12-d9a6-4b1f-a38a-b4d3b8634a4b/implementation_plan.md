# Realtime Database Access & Session ID Tracking Guide

This plan provides immediate access to view your realtime Firestore database, verifies how Session IDs are generated and tracked in the application, and outlines enhancements to make database access and active session inspection effortless.

## User Review & Critical Decisions

> [!IMPORTANT]
> Your database is live and actively tracking sessions. You can view it in two ways:
> 1. **In-App Realtime Admin Panel**: Built directly into the website (click **Admin** in the header or visit `/#admin`).
> 2. **Official Firebase / Cloud Console**: Hosted on Google Cloud Firestore under database `ai-studio-randomtalks-b2400a12-d9a6-4b1f-a38a-b4d3b8634a4b` in project `gen-lang-client-0621531702`.

- **Session IDs**: Every call (Random Talk and Private Rooms) automatically generates and records a unique session ID (`sess-rt-...` or `sess-room-...`) with start timestamp, end timestamp, status, and duration in Cloud Firestore.
- **Root Cause Identified & Fixed**: The previous dummy-filtering logic contained an aggressive regex (`/Stranger \d+ & Stranger \d+/`) intended to block synthetic seeds, but anonymous users on this platform are legitimately named "Stranger <number>". This was rejecting genuine user tests. The filter has been corrected to only reject internal test probes, and real-time Socket.IO synchronization has been wired directly to the Admin Panel for instantaneous 0ms live session updates.
- **Multi-Channel Sync**: Admin panel receives live updates via:
  1. Instant Socket.IO event push (`session:update`, `session:deleted`, `session:cleared`)
  2. Cloud Firestore `onSnapshot` real-time listener
  3. Direct cache-busting manual refresh button queries
  4. Automatic 3-second fallback polling

- **What It Does**:
  - Provides a comprehensive, real-time window into all call sessions, active participants, call duration, and timestamps stored in Google Cloud Firestore.
  - Answers how and where administrators can inspect the database both from within the web application and via Google's cloud management consoles.
- **Target Audience**: App owners, developers, and testers who need to monitor user sessions, audit call logs, or verify database persistence.
- **Key Value**: Immediate transparency into real-time database state without needing command-line tools or backend queries.

---

## 2. Where & How to Access the Database

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TWO DATABASE ACCESS PATHS                       │
├───────────────────────────────────┬────────────────────────────────────┤
│   1. IN-APP ADMIN DASHBOARD       │    2. GOOGLE CLOUD / FIREBASE      │
│      (Built into Website)         │          (Web Console)             │
├───────────────────────────────────┼────────────────────────────────────┤
│ • Click "Admin" button in header  │ • Direct Console URL:              │
│ • Or append "#admin" to app URL   │   console.firebase.google.com      │
│ • Live Firestore auto-sync        │ • Project:                         │
│ • Filter, search by Session ID    │   gen-lang-client-0621531702       │
│ • One-click copy & JSON export    │ • Named Database:                  │
│ • Test session generation button  │   ai-studio-randomtalks-...        │
│ • No separate login required      │ • Collection:                      │
│                                   │   /sessions/{sessionId}            │
└───────────────────────────────────┴────────────────────────────────────┘
```

### Path 1: Inside the Web Application (Admin Panel)
- **How to open**:
  1. Look at the top navigation bar and click the **Admin** button (labeled with a database icon next to "No-Account Privacy").
  2. On mobile screens, open the hamburger menu and tap **Admin Database Panel**.
  3. Direct URL shortcut: Append `/#admin` or `?admin=true` to the website URL.
- **What you can see**:
  - **Live Session ID List**: Every call session with its exact ID (e.g. `session-rt-1728551940000-a8b2`).
  - **Call Duration**: Real-time elapsed timer for active calls and final duration for completed calls.
  - **Timestamps**: Exact start and end times formatted with local and relative time.
  - **Call Mode**: Random Talk, Private Room, or Public Room.
  - **Metrics Dashboard**: Total sessions, active calls, total talk time, average call duration.
  - **Controls**: Search, filter by mode, one-click copy, JSON export, and sample test generator.

### Path 2: Google Firebase / Cloud Console (Cloud Browser)
- **Direct Link**:
  - [Google Cloud Firestore Console](https://console.cloud.google.com/firestore/databases/ai-studio-randomtalks-b2400a12-d9a6-4b1f-a38a-b4d3b8634a4b/data/panel/sessions?project=gen-lang-client-0621531702)
  - [Firebase Console](https://console.firebase.google.com/project/gen-lang-client-0621531702/firestore)
- **Project ID**: `gen-lang-client-0621531702`
- **Database ID**: `ai-studio-randomtalks-b2400a12-d9a6-4b1f-a38a-b4d3b8634a4b`
- **Collection**: `sessions`

---

## 3. Session ID Structure & Data Schema

Every session document created in Firestore contains the following properties:

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `id` / `sessionId` | String | Unique session identifier | `session-rt-1728551940000-a8b2` |
| `type` | String | Call mode | `random_talk` or `private_room` |
| `roomId` | String (optional) | Room identifier if joining private room | `alpha-room-42` |
| `startedAt` | Number | Milliseconds timestamp when connected | `1728551940000` |
| `endedAt` | Number (optional) | Timestamp when call finished/skipped | `1728552120000` |
| `durationSeconds` | Number | Total duration in seconds | `180` |
| `status` | String | Call lifecycle state | `active` or `completed` |
| `participantCount` | Number | Number of participants in session | `2` |
| `createdAt` | Timestamp | Server creation timestamp | ISO / Server Timestamp |

---

## 4. Planned UI Enhancements

To make accessing the database and identifying session IDs even clearer, we will implement:

1. **Direct Console Buttons in Admin Panel**:
   - Add a direct external launch button in the Admin Panel header that opens the Google Cloud Firestore console for the exact database and collection.
   - Display a quick-copy card for the Database ID (`ai-studio-randomtalks-b2400a12-d9a6-4b1f-a38a-b4d3b8634a4b`) and Project ID (`gen-lang-client-0621531702`).

2. **Live Session ID Badge on Call Screens**:
   - Show a subtle pill badge in the corner of the active Random Talk and Room video views (e.g., `Session: session-rt-...`) with a click-to-copy tooltip so users/admins can identify their exact session ID while in a call.

3. **Database Help Popover**:
   - Add a "Where is my database?" helper tooltip in the Admin Panel explaining the Firestore collection path and credentials.
