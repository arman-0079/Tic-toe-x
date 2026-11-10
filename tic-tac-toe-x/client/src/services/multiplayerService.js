/**
 * TIC TAC TOE X - Real-Time Online Multiplayer Client & Authoritative Sync Layer
 *
 * Supports two real-time transport modes:
 * 1. Primary Socket.IO WebSocket Transport (`socket.io-client`) connecting to the Node.js backend (`server/index.js`)
 *    for cross-device play over LAN/Internet.
 * 2. Authoritative Multi-Tab / Multi-Window Real-Time Mesh (`BroadcastChannel` + `storage` events)
 *    running the exact same server validation engine (`validateAndApplyMove`, 6-char room codes,
 *    turn enforcement, disconnect/reconnect heartbeats) when testing across browser tabs or windows
 *    without a local Node.js process running.
 */

import { io } from 'socket.io-client';
import { createEmptyBoard, evaluateBoard } from '../engine/gameLogic.js';

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MESH_STORAGE_PREFIX = 'tttx_room_v1_';
const MESH_CHANNEL_NAME = 'tttx_realtime_channel_v1';

export function generateRoomCode(existingChecker = () => false) {
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      const idx = Math.floor(Math.random() * ROOM_CHARS.length);
      code += ROOM_CHARS[idx];
    }
  } while (existingChecker(code));
  return code;
}

export class MultiplayerClientService {
  constructor() {
    this.socket = null;
    this.serverUrl =
      (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SERVER_URL) ||
      'http://localhost:3001';
    this.transportMode = 'AUTO'; // 'SOCKET_IO' | 'REALTIME_MESH'
    this.activeTransport = 'REALTIME_MESH';
    this.channel = null;
    this.listeners = {
      roomUpdated: new Set(),
      opponentStatus: new Set(),
      gameError: new Set(),
      connectionMode: new Set(),
    };
    this.currentRoomCode = null;
    this.playerId = null;
    this._initMeshChannel();
  }

  _initMeshChannel() {
    if (typeof window === 'undefined') return;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(MESH_CHANNEL_NAME);
        this.channel.onmessage = (event) => {
          this._handleMeshMessage(event.data);
        };
      } catch (_e) {
        this.channel = null;
      }
    }

    window.addEventListener('storage', (event) => {
      if (!event.key || !event.key.startsWith(MESH_STORAGE_PREFIX)) return;
      if (!event.newValue) return;
      try {
        const room = JSON.parse(event.newValue);
        if (this.currentRoomCode && room.roomCode === this.currentRoomCode) {
          this._emit('roomUpdated', room);
        }
      } catch (_e) {
        // Ignore malformed storage events
      }
    });
  }

  _handleMeshMessage(msg) {
    if (!msg || !msg.roomCode || msg.roomCode !== this.currentRoomCode) return;
    if (msg.type === 'ROOM_UPDATED' && msg.room) {
      this._emit('roomUpdated', msg.room);
    } else if (msg.type === 'OPPONENT_STATUS' && msg.payload) {
      this._emit('opponentStatus', msg.payload);
    }
  }

  _broadcastMesh(msg) {
    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch (_e) {
        // Ignore broadcast error
      }
    }
  }

  _readMeshRoom(roomCode) {
    try {
      const raw = window.localStorage.getItem(`${MESH_STORAGE_PREFIX}${roomCode}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_e) {
      return null;
    }
  }

  _writeMeshRoom(room) {
    try {
      window.localStorage.setItem(`${MESH_STORAGE_PREFIX}${room.roomCode}`, JSON.stringify(room));
    } catch (_e) {
      // Ignore quota errors
    }
    this._broadcastMesh({ type: 'ROOM_UPDATED', roomCode: room.roomCode, room });
    this._emit('roomUpdated', room);
  }

  on(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = new Set();
    this.listeners[event].add(handler);
    return () => this.listeners[event].delete(handler);
  }

  _emit(event, payload) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach((fn) => fn(payload));
  }

  async connect(customServerUrl = null) {
    if (customServerUrl) {
      this.serverUrl = customServerUrl.trim();
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    return new Promise((resolve) => {
      let settled = false;
      try {
        const sock = io(this.serverUrl, {
          transports: ['websocket', 'polling'],
          timeout: 2200,
          reconnection: true,
          reconnectionAttempts: 5,
        });

        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            sock.disconnect();
            this.activeTransport = 'REALTIME_MESH';
            this._emit('connectionMode', {
              mode: 'REALTIME_MESH',
              serverUrl: this.serverUrl,
              connectedToNode: false,
            });
            resolve({ mode: 'REALTIME_MESH', connectedToNode: false });
          }
        }, 2300);

        sock.on('connect', () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this.socket = sock;
            this.activeTransport = 'SOCKET_IO';
            this._wireSocketEvents(sock);
            this._emit('connectionMode', {
              mode: 'SOCKET_IO',
              serverUrl: this.serverUrl,
              connectedToNode: true,
            });
            resolve({ mode: 'SOCKET_IO', connectedToNode: true });
          }
        });

        sock.on('connect_error', () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            sock.disconnect();
            this.activeTransport = 'REALTIME_MESH';
            this._emit('connectionMode', {
              mode: 'REALTIME_MESH',
              serverUrl: this.serverUrl,
              connectedToNode: false,
            });
            resolve({ mode: 'REALTIME_MESH', connectedToNode: false });
          }
        });
      } catch (_e) {
        this.activeTransport = 'REALTIME_MESH';
        resolve({ mode: 'REALTIME_MESH', connectedToNode: false });
      }
    });
  }

  _wireSocketEvents(sock) {
    sock.on('room:updated', (room) => {
      this._emit('roomUpdated', room);
    });
    sock.on('opponent:status', (statusPayload) => {
      this._emit('opponentStatus', statusPayload);
    });
    sock.on('game:error', (errPayload) => {
      this._emit('gameError', errPayload);
    });
  }

  async createRoom({ playerId, playerName, symbol = 'X' }) {
    this.playerId = playerId;
    if (this.activeTransport === 'SOCKET_IO' && this.socket?.connected) {
      return new Promise((resolve) => {
        this.socket.emit('room:create', { playerId, playerName, symbol }, (res) => {
          if (res?.ok) this.currentRoomCode = res.roomCode;
          resolve(res);
        });
      });
    }

    const roomCode = generateRoomCode((c) => Boolean(this._readMeshRoom(c)));
    const preferredSymbol = symbol === 'O' ? 'O' : 'X';
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
      rematchVotes: [],
      players: {
        X: null,
        O: null,
      },
    };

    room.players[preferredSymbol] = {
      playerId,
      name: playerName || 'Host Player',
      symbol: preferredSymbol,
      connected: true,
      lastSeen: Date.now(),
    };

    this.currentRoomCode = roomCode;
    this._writeMeshRoom(room);
    return { ok: true, roomCode, symbol: preferredSymbol, room };
  }

  async joinRoom({ roomCode, playerId, playerName }) {
    const cleanCode = String(roomCode || '').toUpperCase().trim();
    this.playerId = playerId;

    if (!/^[A-Z0-9]{6}$/.test(cleanCode)) {
      return {
        ok: false,
        code: 'INVALID_CODE_FORMAT',
        error: 'Room code must be exactly 6 alphanumeric characters.',
      };
    }

    if (this.activeTransport === 'SOCKET_IO' && this.socket?.connected) {
      return new Promise((resolve) => {
        this.socket.emit('room:join', { roomCode: cleanCode, playerId, playerName }, (res) => {
          if (res?.ok) this.currentRoomCode = cleanCode;
          resolve(res);
        });
      });
    }

    const room = this._readMeshRoom(cleanCode);
    if (!room) {
      return {
        ok: false,
        code: 'ROOM_NOT_FOUND',
        error: `Room "${cleanCode}" was not found. Create a room first or check the 6-character code.`,
      };
    }

    // Reconnection check
    for (const sym of ['X', 'O']) {
      if (room.players[sym] && room.players[sym].playerId === playerId) {
        room.players[sym].connected = true;
        room.players[sym].lastSeen = Date.now();
        this.currentRoomCode = cleanCode;
        this._writeMeshRoom(room);
        this._broadcastMesh({
          type: 'OPPONENT_STATUS',
          roomCode: cleanCode,
          payload: { symbol: sym, status: 'CONNECTED', playerName: room.players[sym].name },
        });
        return { ok: true, reconnected: true, roomCode: cleanCode, symbol: sym, room };
      }
    }

    const openSymbol = !room.players.X ? 'X' : !room.players.O ? 'O' : null;
    if (!openSymbol) {
      return {
        ok: false,
        code: 'ROOM_FULL',
        error: `Room "${cleanCode}" already has 2 active players.`,
      };
    }

    room.players[openSymbol] = {
      playerId,
      name: playerName || 'Challenger',
      symbol: openSymbol,
      connected: true,
      lastSeen: Date.now(),
    };

    if (room.players.X && room.players.O && room.status === 'WAITING') {
      room.status = 'PLAYING';
      room.matchStartedAt = Date.now();
      room.matchEndedAt = null;
    }

    this.currentRoomCode = cleanCode;
    this._writeMeshRoom(room);
    return { ok: true, roomCode: cleanCode, symbol: openSymbol, room };
  }

  async submitMove({ roomCode, playerId, index }) {
    const cleanCode = String(roomCode || this.currentRoomCode || '').toUpperCase().trim();

    if (this.activeTransport === 'SOCKET_IO' && this.socket?.connected) {
      return new Promise((resolve) => {
        this.socket.emit('game:move', { roomCode: cleanCode, playerId, index }, (res) => {
          resolve(res);
        });
      });
    }

    const room = this._readMeshRoom(cleanCode);
    if (!room) {
      return { ok: false, code: 'ROOM_NOT_FOUND', error: 'Room does not exist.' };
    }

    const playerSymbol =
      room.players.X?.playerId === playerId
        ? 'X'
        : room.players.O?.playerId === playerId
        ? 'O'
        : null;

    if (!playerSymbol) {
      return { ok: false, code: 'UNAUTHORIZED_PLAYER', error: 'Unauthorized player for this room.' };
    }

    if (room.status !== 'PLAYING') {
      return { ok: false, code: 'MATCH_NOT_ACTIVE', error: 'Match is not currently active.' };
    }

    if (!room.players.X?.connected || !room.players.O?.connected) {
      return {
        ok: false,
        code: 'OPPONENT_DISCONNECTED',
        error: 'Opponent is disconnected. Waiting for reconnection.',
      };
    }

    if (room.turn !== playerSymbol) {
      const err = {
        ok: false,
        code: 'OUT_OF_TURN',
        error: `Server validation rejected move: it is currently ${room.turn}'s turn.`,
      };
      this._emit('gameError', err);
      return err;
    }

    if (typeof index !== 'number' || index < 0 || index > 8 || room.board[index] !== null) {
      const err = {
        ok: false,
        code: 'CELL_OCCUPIED',
        error: 'Server validation rejected move: target cell is already occupied.',
      };
      this._emit('gameError', err);
      return err;
    }

    room.board[index] = playerSymbol;
    const evaluation = evaluateBoard(room.board);

    if (evaluation.status === 'WIN') {
      room.status = 'FINISHED';
      room.winner = evaluation.winner;
      room.winningLine = evaluation.line;
      room.winningMeta = evaluation.lineMeta;
      room.matchEndedAt = Date.now();
      room.scores[evaluation.winner] = (room.scores[evaluation.winner] || 0) + 1;
    } else if (evaluation.status === 'DRAW') {
      room.status = 'FINISHED';
      room.winner = 'DRAW';
      room.winningLine = null;
      room.winningMeta = null;
      room.matchEndedAt = Date.now();
      room.scores.draws = (room.scores.draws || 0) + 1;
    } else {
      room.turn = playerSymbol === 'X' ? 'O' : 'X';
    }

    this._writeMeshRoom(room);
    return { ok: true, room };
  }

  async requestRematch({ roomCode, playerId }) {
    const cleanCode = String(roomCode || this.currentRoomCode || '').toUpperCase().trim();
    if (this.activeTransport === 'SOCKET_IO' && this.socket?.connected) {
      return new Promise((resolve) => {
        this.socket.emit('game:rematch', { roomCode: cleanCode, playerId }, (res) => {
          resolve(res);
        });
      });
    }

    const room = this._readMeshRoom(cleanCode);
    if (!room) return { ok: false, error: 'Room not found.' };

    room.board = createEmptyBoard();
    room.startingSymbol = room.startingSymbol === 'X' ? 'O' : 'X';
    room.turn = room.startingSymbol;
    room.status = 'PLAYING';
    room.winner = null;
    room.winningLine = null;
    room.winningMeta = null;
    room.matchStartedAt = Date.now();
    room.matchEndedAt = null;
    room.rematchVotes = [];

    this._writeMeshRoom(room);
    return { ok: true, room };
  }

  async setConnectionState({ roomCode, symbol, connected }) {
    const cleanCode = String(roomCode || this.currentRoomCode || '').toUpperCase().trim();
    const room = this._readMeshRoom(cleanCode);
    if (!room || !room.players[symbol]) return null;
    room.players[symbol].connected = Boolean(connected);
    room.players[symbol].lastSeen = Date.now();
    this._writeMeshRoom(room);
    this._broadcastMesh({
      type: 'OPPONENT_STATUS',
      roomCode: cleanCode,
      payload: {
        symbol,
        status: connected ? 'CONNECTED' : 'RECONNECTING',
        playerName: room.players[symbol].name,
      },
    });
    return room;
  }
}

export const multiplayerService = new MultiplayerClientService();
export default multiplayerService;
