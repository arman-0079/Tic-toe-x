/**
 * TIC TAC TOE X - Real-Time Online Multiplayer Server
 * Built with Node.js, Express, and Socket.IO.
 * Features:
 * - Unique 6-character alphanumeric room codes
 * - Server-authoritative move validation & turn enforcement
 * - Real-time board synchronization & match timer tracking
 * - Player disconnection detection & 60-second reconnection grace window
 * - Rematch negotiation & persistent database statistics API
 */

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const {
  createEmptyBoard,
  validateAndApplyMove,
} = require('./gameEngine');
const { StatsDatabase } = require('./db');

const PORT = process.env.PORT || 3001;
const RECONNECT_GRACE_MS = 60000; // 60 seconds to reconnect before forfeit
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Unambiguous 6-char alphabet

function createServerApp() {
  const app = express();
  const db = new StatsDatabase();
  const rooms = new Map(); // roomCode -> RoomState
  const socketToRoom = new Map(); // socketId -> { roomCode, playerId }

  app.use(cors());
  app.use(express.json());

  /**
   * Generates a unique 6-character room code not currently in use.
   */
  function generateUniqueRoomCode() {
    let code = '';
    do {
      code = '';
      const bytes = crypto.randomBytes(6);
      for (let i = 0; i < 6; i++) {
        code += ROOM_CHARS[bytes[i] % ROOM_CHARS.length];
      }
    } while (rooms.has(code));
    return code;
  }

  /**
   * Sanitizes player name input.
   */
  function sanitizeName(name, fallback = 'Player') {
    if (typeof name !== 'string') return fallback;
    const cleaned = name.replace(/[<>]/g, '').trim().slice(0, 18);
    return cleaned || fallback;
  }

  /**
   * Builds a safe client-facing snapshot of a room state.
   */
  function serializeRoom(room) {
    return {
      roomCode: room.roomCode,
      status: room.status, // 'WAITING' | 'PLAYING' | 'FINISHED'
      board: room.board,
      turn: room.turn,
      startingSymbol: room.startingSymbol,
      winner: room.winner,
      winningLine: room.winningLine,
      winningMeta: room.winningMeta,
      matchStartedAt: room.matchStartedAt,
      elapsedSeconds: room.matchStartedAt
        ? Math.floor(((room.matchEndedAt || Date.now()) - room.matchStartedAt) / 1000)
        : 0,
      scores: room.scores,
      rematchVotes: Array.from(room.rematchVotes),
      players: {
        X: room.players.X
          ? {
              playerId: room.players.X.playerId,
              name: room.players.X.name,
              symbol: 'X',
              connected: room.players.X.connected,
              lastSeen: room.players.X.lastSeen,
            }
          : null,
        O: room.players.O
          ? {
              playerId: room.players.O.playerId,
              name: room.players.O.name,
              symbol: 'O',
              connected: room.players.O.connected,
              lastSeen: room.players.O.lastSeen,
            }
          : null,
      },
    };
  }

  // REST API Endpoints for Persistent Statistics & Health
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'TIC TAC TOE X Multiplayer Server',
      dbEngine: db.engineType,
      activeRooms: rooms.size,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/stats/:playerId', (req, res) => {
    try {
      const playerName = sanitizeName(req.query.name, 'Player 1');
      const stats = db.getPlayerStats(req.params.playerId, playerName);
      res.json({ ok: true, stats });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/stats/:playerId/record', (req, res) => {
    try {
      const stats = db.recordMatch(req.params.playerId, req.body || {});
      res.json({ ok: true, stats });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/stats/:playerId/reset', (req, res) => {
    try {
      const stats = db.resetPlayerStats(req.params.playerId, req.body?.playerName || 'Player 1');
      res.json({ ok: true, stats });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingInterval: 10000,
    pingTimeout: 8000,
  });

  io.on('connection', (socket) => {
    /**
     * Create a new private multiplayer room.
     */
    socket.on('room:create', (payload = {}, callback) => {
      const playerId = String(payload.playerId || socket.id).trim();
      const playerName = sanitizeName(payload.playerName, 'Host Player');
      const preferredSymbol = payload.symbol === 'O' ? 'O' : 'X';
      const roomCode = generateUniqueRoomCode();

      const room = {
        roomCode,
        status: 'WAITING',
        board: createEmptyBoard(),
        turn: 'X',
        startingSymbol: 'X',
        winner: null,
        winningLine: null,
        winningMeta: null,
        matchStartedAt: null,
        matchEndedAt: null,
        scores: { X: 0, O: 0, draws: 0 },
        rematchVotes: new Set(),
        disconnectTimers: {},
        players: {
          X: null,
          O: null,
        },
        moveHistory: [],
      };

      room.players[preferredSymbol] = {
        playerId,
        socketId: socket.id,
        name: playerName,
        symbol: preferredSymbol,
        connected: true,
        lastSeen: Date.now(),
      };

      rooms.set(roomCode, room);
      socketToRoom.set(socket.id, { roomCode, playerId });
      socket.join(roomCode);

      const response = {
        ok: true,
        roomCode,
        symbol: preferredSymbol,
        room: serializeRoom(room),
      };
      if (typeof callback === 'function') callback(response);
      socket.emit('room:updated', serializeRoom(room));
    });

    /**
     * Join an existing room using a 6-character room code (or reconnect if already a member).
     */
    socket.on('room:join', (payload = {}, callback) => {
      const rawCode = String(payload.roomCode || '').toUpperCase().trim();
      const playerId = String(payload.playerId || socket.id).trim();
      const playerName = sanitizeName(payload.playerName, 'Challenger');

      if (!/^[A-Z0-9]{6}$/.test(rawCode)) {
        const errResp = {
          ok: false,
          code: 'INVALID_CODE_FORMAT',
          error: 'Room code must be exactly 6 alphanumeric characters.',
        };
        if (typeof callback === 'function') callback(errResp);
        return;
      }

      const room = rooms.get(rawCode);
      if (!room) {
        const errResp = {
          ok: false,
          code: 'ROOM_NOT_FOUND',
          error: `Room "${rawCode}" does not exist or has expired.`,
        };
        if (typeof callback === 'function') callback(errResp);
        return;
      }

      // Check if player is reconnecting to an existing seat
      for (const sym of ['X', 'O']) {
        const seat = room.players[sym];
        if (seat && seat.playerId === playerId) {
          seat.socketId = socket.id;
          seat.connected = true;
          seat.lastSeen = Date.now();
          if (room.disconnectTimers[sym]) {
            clearTimeout(room.disconnectTimers[sym]);
            delete room.disconnectTimers[sym];
          }
          socketToRoom.set(socket.id, { roomCode: rawCode, playerId });
          socket.join(rawCode);

          const serialized = serializeRoom(room);
          if (typeof callback === 'function') {
            callback({ ok: true, reconnected: true, roomCode: rawCode, symbol: sym, room: serialized });
          }
          io.to(rawCode).emit('opponent:status', {
            symbol: sym,
            status: 'CONNECTED',
            playerName: seat.name,
          });
          io.to(rawCode).emit('room:updated', serialized);
          return;
        }
      }

      // Assign open seat
      const openSymbol = !room.players.X ? 'X' : !room.players.O ? 'O' : null;
      if (!openSymbol) {
        const errResp = {
          ok: false,
          code: 'ROOM_FULL',
          error: `Room "${rawCode}" is already full (2/2 players).`,
        };
        if (typeof callback === 'function') callback(errResp);
        return;
      }

      room.players[openSymbol] = {
        playerId,
        socketId: socket.id,
        name: playerName,
        symbol: openSymbol,
        connected: true,
        lastSeen: Date.now(),
      };

      socketToRoom.set(socket.id, { roomCode: rawCode, playerId });
      socket.join(rawCode);

      if (room.players.X && room.players.O && room.status === 'WAITING') {
        room.status = 'PLAYING';
        room.matchStartedAt = Date.now();
        room.matchEndedAt = null;
      }

      const serialized = serializeRoom(room);
      if (typeof callback === 'function') {
        callback({ ok: true, roomCode: rawCode, symbol: openSymbol, room: serialized });
      }
      io.to(rawCode).emit('room:updated', serialized);
    });

    /**
     * Authoritative server move validation & execution.
     */
    socket.on('game:move', (payload = {}, callback) => {
      const rawCode = String(payload.roomCode || '').toUpperCase().trim();
      const playerId = String(payload.playerId || socket.id).trim();
      const index = Number(payload.index);

      const room = rooms.get(rawCode);
      if (!room) {
        const errResp = { ok: false, code: 'ROOM_NOT_FOUND', error: 'Room not found.' };
        if (typeof callback === 'function') callback(errResp);
        return;
      }

      const playerSymbol =
        room.players.X?.playerId === playerId
          ? 'X'
          : room.players.O?.playerId === playerId
          ? 'O'
          : null;

      if (!playerSymbol) {
        const errResp = { ok: false, code: 'UNAUTHORIZED_PLAYER', error: 'You are not a player in this room.' };
        if (typeof callback === 'function') callback(errResp);
        return;
      }

      if (!room.players.X?.connected || !room.players.O?.connected) {
        const errResp = {
          ok: false,
          code: 'OPPONENT_DISCONNECTED',
          error: 'Waiting for opponent to reconnect before making a move.',
        };
        if (typeof callback === 'function') callback(errResp);
        return;
      }

      const validation = validateAndApplyMove(
        {
          status: room.status,
          board: room.board,
          turn: room.turn,
          players: {
            X: room.players.X?.playerId,
            O: room.players.O?.playerId,
          },
        },
        { playerId, symbol: playerSymbol, index }
      );

      if (!validation.valid) {
        const errResp = { ok: false, code: validation.code, error: validation.error };
        if (typeof callback === 'function') callback(errResp);
        socket.emit('game:error', errResp);
        return;
      }

      room.board = validation.board;
      room.turn = validation.turn;
      room.moveHistory.push(validation.moveRecord);

      if (validation.evaluation.status === 'WIN') {
        room.status = 'FINISHED';
        room.winner = validation.evaluation.winner;
        room.winningLine = validation.evaluation.line;
        room.winningMeta = validation.evaluation.lineMeta;
        room.matchEndedAt = Date.now();
        room.scores[room.winner] += 1;

        const durationSec = Math.max(1, Math.round((room.matchEndedAt - room.matchStartedAt) / 1000));
        const winnerSeat = room.players[room.winner];
        const loserSymbol = room.winner === 'X' ? 'O' : 'X';
        const loserSeat = room.players[loserSymbol];

        if (winnerSeat) {
          db.recordMatch(winnerSeat.playerId, {
            playerName: winnerSeat.name,
            mode: 'ONLINE',
            outcome: 'WIN',
            playerSymbol: room.winner,
            opponentName: loserSeat?.name || 'Opponent',
            durationSec,
            roomCode: room.roomCode,
          });
        }
        if (loserSeat) {
          db.recordMatch(loserSeat.playerId, {
            playerName: loserSeat.name,
            mode: 'ONLINE',
            outcome: 'LOSS',
            playerSymbol: loserSymbol,
            opponentName: winnerSeat?.name || 'Opponent',
            durationSec,
            roomCode: room.roomCode,
          });
        }
      } else if (validation.evaluation.status === 'DRAW') {
        room.status = 'FINISHED';
        room.winner = 'DRAW';
        room.winningLine = null;
        room.winningMeta = null;
        room.matchEndedAt = Date.now();
        room.scores.draws += 1;

        const durationSec = Math.max(1, Math.round((room.matchEndedAt - room.matchStartedAt) / 1000));
        for (const sym of ['X', 'O']) {
          const seat = room.players[sym];
          const opp = room.players[sym === 'X' ? 'O' : 'X'];
          if (seat) {
            db.recordMatch(seat.playerId, {
              playerName: seat.name,
              mode: 'ONLINE',
              outcome: 'DRAW',
              playerSymbol: sym,
              opponentName: opp?.name || 'Opponent',
              durationSec,
              roomCode: room.roomCode,
            });
          }
        }
      }

      const serialized = serializeRoom(room);
      if (typeof callback === 'function') callback({ ok: true, room: serialized });
      io.to(rawCode).emit('room:updated', serialized);
    });

    /**
     * Request or accept a rematch in an online room.
     */
    socket.on('game:rematch', (payload = {}, callback) => {
      const rawCode = String(payload.roomCode || '').toUpperCase().trim();
      const playerId = String(payload.playerId || socket.id).trim();
      const room = rooms.get(rawCode);

      if (!room) {
        if (typeof callback === 'function') callback({ ok: false, error: 'Room not found.' });
        return;
      }

      const playerSymbol =
        room.players.X?.playerId === playerId
          ? 'X'
          : room.players.O?.playerId === playerId
          ? 'O'
          : null;

      if (!playerSymbol) {
        if (typeof callback === 'function') callback({ ok: false, error: 'Unauthorized player.' });
        return;
      }

      room.rematchVotes.add(playerSymbol);

      // Start new match once both players vote for rematch (or allow instant reset if requested)
      if (room.rematchVotes.has('X') && room.rematchVotes.has('O')) {
        room.rematchVotes.clear();
        room.board = createEmptyBoard();
        room.startingSymbol = room.startingSymbol === 'X' ? 'O' : 'X';
        room.turn = room.startingSymbol;
        room.status = 'PLAYING';
        room.winner = null;
        room.winningLine = null;
        room.winningMeta = null;
        room.matchStartedAt = Date.now();
        room.matchEndedAt = null;
        room.moveHistory = [];
      }

      const serialized = serializeRoom(room);
      if (typeof callback === 'function') callback({ ok: true, room: serialized });
      io.to(rawCode).emit('room:updated', serialized);
    });

    /**
     * Handle disconnection and start reconnection grace period timer.
     */
    socket.on('disconnect', () => {
      const mapping = socketToRoom.get(socket.id);
      if (!mapping) return;
      socketToRoom.delete(socket.id);

      const { roomCode, playerId } = mapping;
      const room = rooms.get(roomCode);
      if (!room) return;

      for (const sym of ['X', 'O']) {
        const seat = room.players[sym];
        if (seat && seat.playerId === playerId && seat.socketId === socket.id) {
          seat.connected = false;
          seat.lastSeen = Date.now();

          io.to(roomCode).emit('opponent:status', {
            symbol: sym,
            status: 'RECONNECTING',
            playerName: seat.name,
            gracePeriodSec: RECONNECT_GRACE_MS / 1000,
          });
          io.to(roomCode).emit('room:updated', serializeRoom(room));

          room.disconnectTimers[sym] = setTimeout(() => {
            const currentRoom = rooms.get(roomCode);
            if (!currentRoom) return;
            const currentSeat = currentRoom.players[sym];
            if (currentSeat && !currentSeat.connected) {
              io.to(roomCode).emit('opponent:status', {
                symbol: sym,
                status: 'DISCONNECTED',
                playerName: currentSeat.name,
              });
              // Clean up room if both players are disconnected
              if (!currentRoom.players.X?.connected && !currentRoom.players.O?.connected) {
                rooms.delete(roomCode);
              }
            }
          }, RECONNECT_GRACE_MS);
        }
      }
    });
  });

  return { app, httpServer, io, db, rooms };
}

if (require.main === module) {
  const { httpServer } = createServerApp();
  httpServer.listen(PORT, () => {
    console.log(`[TIC TAC TOE X] Multiplayer Server listening on http://localhost:${PORT}`);
  });
}

module.exports = { createServerApp };
