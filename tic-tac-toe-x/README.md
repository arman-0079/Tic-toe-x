# TIC TAC TOE X – Premium Online Multiplayer Game

**TIC TAC TOE X** is a production-grade, mobile-first Tic Tac Toe game featuring a Dark Luxury glassmorphic UI (`#050508` obsidian background with neon purple `#a855f7` and cyan `#06b6d4` accents), an unbeatable Alpha-Beta pruned **Minimax AI**, **Local 2-Player Pass & Play**, and **Real-Time Server-Validated Online Multiplayer** powered by **Node.js**, **Express**, **Socket.IO**, and a persistent **SQLite3 / Atomic JSON Database**.

---

## 1. Architecture & Directory Structure

```text
tic-tac-toe-x/
├── package.json                          # Monorepo root scripts (install, dev, build, test)
├── README.md                             # Complete setup, API, and architecture guide
├── server/                               # Node.js + Express + Socket.IO Authoritative Backend
│   ├── package.json
│   ├── index.js                          # WebSocket room server, move validation, REST API
│   ├── gameEngine.js                     # Shared deterministic board logic & Minimax AI
│   ├── db.js                             # SQLite3 (better-sqlite3) + Atomic JSON persistence
│   └── test.js                           # Automated test suite (613-tree exhaustive Minimax check)
└── client/                               # React 18 + Vite 5 + CSS3 Frontend
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx                      # React DOM root mount
        ├── App.jsx                       # Complete 8-screen game interface
        ├── adapters/
        │   └── youtubePlayablesAdapter.js # Decoupled YouTube Playables SDK (ytgame) adapter
        ├── audio/
        │   └── soundEngine.js            # Zero-dependency Web Audio API sound synthesizer
        ├── engine/
        │   └── gameLogic.js              # Client game engine & Easy/Medium/Hard Minimax AI
        ├── services/
        │   └── multiplayerService.js     # Socket.IO client + Cross-Tab real-time room sync
        └── styles/
            └── index.css                 # Dark Luxury CSS3 theme & GPU stroke animations
```

---

## 2. Quick Start & Setup Instructions

### Prerequisites
- **Node.js** `v18.0.0` or higher
- **npm** `v9.0.0` or higher

### Step 1: Install Dependencies
From the root directory (`tic-tac-toe-x/`):
```bash
npm run install:all
```

### Step 2: Run Automated Verification Tests
Verify the authoritative game rules, out-of-turn server move rejection, database persistence, and exhaustive Minimax AI proof (0 losses across all 613 reachable game trees):
```bash
npm test
```

### Step 3: Start the Real-Time Multiplayer Backend Server
```bash
npm run dev:server
```
The Node.js + Socket.IO server starts on `http://localhost:3001`.

### Step 4: Start the React + Vite Frontend Client
In a second terminal:
```bash
npm run dev:client
```
Open `http://localhost:5173` on your browser (or use your LAN IP displayed by Vite to connect from Android/iOS phones on the same network).

---

## 3. Game Modes & Core Features

1. **Single Player vs AI**
   - **Easy**: Opportunistic random move exploration.
   - **Medium**: Tactical AI that takes immediate winning moves and blocks 75%+ of immediate threats.
   - **Hard (Unbeatable Minimax)**: Full recursive Minimax search with Alpha-Beta pruning and depth-weighted scoring (`100 - depth`). Mathematically guaranteed never to make a losing mistake.
   - **Play as X or O**: Choose whether to play first (`X`) or second (`O`).

2. **Local Multiplayer (2 Players on Same Device)**
   - Customize Player 1 (`X`) and Player 2 (`O`) names.
   - Alternate turns with live session scoreboard and instant rematch (alternating starting player).

3. **Online Multiplayer (Cross-Device via Socket.IO)**
   - **Private Room Creation**: Generates a collision-free, unambiguous 6-character alphanumeric room code.
   - **Join by Code**: Validates 6-character codes with clear error feedback (`INVALID_CODE_FORMAT`, `ROOM_NOT_FOUND`, `ROOM_FULL`).
   - **Server-Side Move Validation**: Every `game:move` event is verified on the server for active match state, player identity, turn order (`OUT_OF_TURN` prevention), and cell availability (`CELL_OCCUPIED` prevention).
   - **Disconnection & Reconnection Handling**: Detects dropped connections immediately, notifies the opponent (`RECONNECTING`), pauses move submission, and provides a 60-second grace window to reconnect and restore the exact board state.

4. **YouTube Playables Compatibility Adapter (`client/src/adapters/youtubePlayablesAdapter.js`)**
   - Keeps the core game 100% independent of YouTube APIs while providing automatic integration with `window.ytgame` (`firstFrameReady()`, `gameReady()`, `saveData()`, `loadData()`, `sendScore()`, `onPause()`, `onResume()`, and `onAudioEnabledChange()`).
