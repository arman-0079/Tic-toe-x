/**
 * TIC TAC TOE X - Persistent Player Statistics Database Layer
 * Uses Node's built-in `node:sqlite` (DatabaseSync, available in Node 22.5+ / Node 26)
 * with automatic fallback to zero-dependency atomic JSON file persistence (`JSON_ATOMIC`).
 * Zero native C++ / node-gyp compilation required on Vercel.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveWritableDataDir() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'tic-tac-toe-x-data');
  }
  return path.join(__dirname, 'data');
}

const DATA_DIR = resolveWritableDataDir();
const JSON_DB_PATH = path.join(DATA_DIR, 'player_stats.json');
const SQLITE_DB_PATH = path.join(DATA_DIR, 'player_stats.sqlite');

function createDefaultStats(playerId, playerName = 'Player 1') {
  return {
    playerId,
    playerName,
    updatedAt: new Date().toISOString(),
    modes: {
      AI_EASY: { wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0, fastestWinSec: null },
      AI_MEDIUM: { wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0, fastestWinSec: null },
      AI_HARD: { wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0, fastestWinSec: null },
      LOCAL_2P: { wins: 0, losses: 0, draws: 0, p1Wins: 0, p2Wins: 0, currentStreak: 0, bestStreak: 0, fastestWinSec: null },
      ONLINE: { wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0, fastestWinSec: null },
    },
    recentMatches: [],
  };
}

class StatsDatabase {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    this.sqlite = null;
    this.engineType = 'JSON_ATOMIC';

    try {
      // Use built-in node:sqlite (Node 22.5+ / Node 26 on Vercel) — zero node-gyp compilation
      const { DatabaseSync } = require('node:sqlite');
      this.sqlite = new DatabaseSync(SQLITE_DB_PATH);
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS player_profiles (
          player_id TEXT PRIMARY KEY,
          player_name TEXT NOT NULL,
          stats_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS match_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          outcome TEXT NOT NULL,
          player_symbol TEXT NOT NULL,
          opponent_name TEXT NOT NULL,
          duration_sec INTEGER NOT NULL,
          room_code TEXT,
          played_at TEXT NOT NULL
        );
      `);
      this.engineType = 'NODE_BUILTIN_SQLITE';
    } catch (_err) {
      this.sqlite = null;
      if (!fs.existsSync(JSON_DB_PATH)) {
        fs.writeFileSync(JSON_DB_PATH, JSON.stringify({ players: {} }, null, 2), 'utf8');
      }
    }
  }

  _readJsonStore() {
    try {
      const raw = fs.readFileSync(JSON_DB_PATH, 'utf8');
      return JSON.parse(raw);
    } catch (_e) {
      return { players: {} };
    }
  }

  _writeJsonStore(data) {
    const tmpPath = `${JSON_DB_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, JSON_DB_PATH);
  }

  getPlayerStats(playerId, playerName = 'Player 1') {
    const safeId = String(playerId || 'default_player').trim().slice(0, 64);
    if (this.sqlite) {
      const row = this.sqlite
        .prepare('SELECT stats_json FROM player_profiles WHERE player_id = ?')
        .get(safeId);
      if (row && row.stats_json) {
        return JSON.parse(row.stats_json);
      }
      const initial = createDefaultStats(safeId, playerName);
      this.sqlite
        .prepare(
          'INSERT INTO player_profiles (player_id, player_name, stats_json, updated_at) VALUES (?, ?, ?, ?)'
        )
        .run(safeId, playerName, JSON.stringify(initial), initial.updatedAt);
      return initial;
    }

    const store = this._readJsonStore();
    if (!store.players[safeId]) {
      store.players[safeId] = createDefaultStats(safeId, playerName);
      this._writeJsonStore(store);
    }
    return store.players[safeId];
  }

  recordMatch(playerId, matchPayload) {
    const {
      playerName = 'Player 1',
      mode = 'AI_HARD',
      outcome = 'DRAW',
      playerSymbol = 'X',
      opponentName = 'AI',
      durationSec = 0,
      roomCode = null,
    } = matchPayload;

    const stats = this.getPlayerStats(playerId, playerName);
    stats.playerName = playerName || stats.playerName;
    stats.updatedAt = new Date().toISOString();

    const bucketKey = stats.modes[mode] ? mode : 'AI_HARD';
    const bucket = stats.modes[bucketKey];

    if (outcome === 'WIN') {
      bucket.wins += 1;
      bucket.currentStreak += 1;
      if (bucket.currentStreak > bucket.bestStreak) {
        bucket.bestStreak = bucket.currentStreak;
      }
      if (durationSec > 0 && (bucket.fastestWinSec === null || durationSec < bucket.fastestWinSec)) {
        bucket.fastestWinSec = durationSec;
      }
      if (bucketKey === 'LOCAL_2P') {
        bucket.p1Wins = (bucket.p1Wins || 0) + 1;
      }
    } else if (outcome === 'LOSS') {
      bucket.losses += 1;
      bucket.currentStreak = 0;
      if (bucketKey === 'LOCAL_2P') {
        bucket.p2Wins = (bucket.p2Wins || 0) + 1;
      }
    } else {
      bucket.draws += 1;
      bucket.currentStreak = 0;
    }

    const record = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      mode: bucketKey,
      outcome,
      playerSymbol,
      opponentName,
      durationSec: Math.max(1, Math.round(Number(durationSec) || 1)),
      roomCode,
      playedAt: stats.updatedAt,
    };

    stats.recentMatches = [record, ...(stats.recentMatches || [])].slice(0, 25);

    if (this.sqlite) {
      this.sqlite
        .prepare(
          'UPDATE player_profiles SET player_name = ?, stats_json = ?, updated_at = ? WHERE player_id = ?'
        )
        .run(stats.playerName, JSON.stringify(stats), stats.updatedAt, stats.playerId);

      this.sqlite
        .prepare(
          `INSERT INTO match_history
           (player_id, mode, outcome, player_symbol, opponent_name, duration_sec, room_code, played_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          stats.playerId,
          bucketKey,
          outcome,
          playerSymbol,
          opponentName,
          record.durationSec,
          roomCode,
          record.playedAt
        );
      return stats;
    }

    const store = this._readJsonStore();
    store.players[stats.playerId] = stats;
    this._writeJsonStore(store);
    return stats;
  }

  resetPlayerStats(playerId, playerName = 'Player 1') {
    const safeId = String(playerId || 'default_player').trim().slice(0, 64);
    const fresh = createDefaultStats(safeId, playerName);

    if (this.sqlite) {
      this.sqlite
        .prepare(
          `INSERT INTO player_profiles (player_id, player_name, stats_json, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(player_id) DO UPDATE SET
           player_name = excluded.player_name,
           stats_json = excluded.stats_json,
           updated_at = excluded.updated_at`
        )
        .run(safeId, playerName, JSON.stringify(fresh), fresh.updatedAt);
      this.sqlite.prepare('DELETE FROM match_history WHERE player_id = ?').run(safeId);
      return fresh;
    }

    const store = this._readJsonStore();
    store.players[safeId] = fresh;
    this._writeJsonStore(store);
    return fresh;
  }
}

module.exports = {
  StatsDatabase,
  createDefaultStats,
};
