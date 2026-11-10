/**
 * TIC TAC TOE X - Platform & YouTube Playables Integration Adapter
 *
 * Keeps the core game 100% independent of YouTube-specific APIs while providing
 * seamless drop-in compatibility with the YouTube Playables SDK (`window.ytgame`).
 *
 * When running inside YouTube Playables (`window.ytgame` present):
 *  - Calls `ytgame.game.firstFrameReady()` and `ytgame.game.gameReady()`
 *  - Syncs audio mute state with `ytgame.system.isAudioEnabled()` and `onAudioEnabledChange`
 *  - Persists serialized player statistics via `ytgame.game.saveData()` / `loadData()`
 *  - Submits high scores via `ytgame.engagement.sendScore({ value })`
 *  - Handles lifecycle pause/resume hooks (`onPause` / `onResume`)
 *
 * When running on standard Web / Android WebView / Desktop:
 *  - Transparently falls back to `localStorage` and standard browser lifecycle events.
 */

const STORAGE_KEY = 'tictactoe_x_persistent_v1';

class PlatformIntegrationAdapter {
  constructor() {
    this.isYouTubePlayable = false;
    this.sdkVersion = 'web-standalone-1.0';
    this.audioListeners = new Set();
    this.lifecycleListeners = new Set();
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return this.getStatus();
    this._initialized = true;

    const yt = typeof window !== 'undefined' ? window.ytgame : undefined;
    if (yt && yt.game) {
      this.isYouTubePlayable = true;
      this.sdkVersion = yt.SDK_VERSION || 'ytgame-v1';

      try {
        if (typeof yt.game.firstFrameReady === 'function') {
          yt.game.firstFrameReady();
        }
        if (typeof yt.game.gameReady === 'function') {
          yt.game.gameReady();
        }
        if (yt.system && typeof yt.system.onAudioEnabledChange === 'function') {
          yt.system.onAudioEnabledChange((isEnabled) => {
            this.audioListeners.forEach((cb) => cb(Boolean(isEnabled)));
          });
        }
        if (yt.system && typeof yt.system.onPause === 'function') {
          yt.system.onPause(() => {
            this.lifecycleListeners.forEach((cb) => cb('PAUSE'));
          });
        }
        if (yt.system && typeof yt.system.onResume === 'function') {
          yt.system.onResume(() => {
            this.lifecycleListeners.forEach((cb) => cb('RESUME'));
          });
        }
      } catch (_err) {
        // Safely continue in standalone mode if SDK bridge throws
      }
    } else if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        const state = document.hidden ? 'PAUSE' : 'RESUME';
        this.lifecycleListeners.forEach((cb) => cb(state));
      });
    }

    return this.getStatus();
  }

  getStatus() {
    return {
      environment: this.isYouTubePlayable ? 'YOUTUBE_PLAYABLES' : 'STANDALONE_WEB',
      sdkVersion: this.sdkVersion,
      ready: this._initialized,
    };
  }

  isAudioEnabled() {
    const yt = typeof window !== 'undefined' ? window.ytgame : undefined;
    if (this.isYouTubePlayable && yt?.system && typeof yt.system.isAudioEnabled === 'function') {
      try {
        return Boolean(yt.system.isAudioEnabled());
      } catch (_e) {
        return true;
      }
    }
    return true;
  }

  onAudioPreferenceChange(callback) {
    this.audioListeners.add(callback);
    return () => this.audioListeners.delete(callback);
  }

  onLifecycleChange(callback) {
    this.lifecycleListeners.add(callback);
    return () => this.lifecycleListeners.delete(callback);
  }

  async savePlayerData(dataObject) {
    const serialized = JSON.stringify(dataObject);
    const yt = typeof window !== 'undefined' ? window.ytgame : undefined;

    if (this.isYouTubePlayable && yt?.game && typeof yt.game.saveData === 'function') {
      try {
        await yt.game.saveData(serialized);
      } catch (_e) {
        // Also mirror to localStorage when available
      }
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, serialized);
    } catch (_e) {
      // Ignore storage quota or sandbox restrictions
    }
    return true;
  }

  async loadPlayerData(defaultData = null) {
    const yt = typeof window !== 'undefined' ? window.ytgame : undefined;

    if (this.isYouTubePlayable && yt?.game && typeof yt.game.loadData === 'function') {
      try {
        const cloudRaw = await yt.game.loadData();
        if (cloudRaw && typeof cloudRaw === 'string' && cloudRaw.trim().length > 0) {
          return JSON.parse(cloudRaw);
        }
      } catch (_e) {
        // Fall through to localStorage
      }
    }

    try {
      const localRaw = window.localStorage.getItem(STORAGE_KEY);
      if (localRaw) {
        return JSON.parse(localRaw);
      }
    } catch (_e) {
      // Fall through to default
    }

    return defaultData;
  }

  async submitScore(scoreValue) {
    const numericScore = Math.max(0, Math.floor(Number(scoreValue) || 0));
    const yt = typeof window !== 'undefined' ? window.ytgame : undefined;
    if (this.isYouTubePlayable && yt?.engagement && typeof yt.engagement.sendScore === 'function') {
      try {
        await yt.engagement.sendScore({ value: numericScore });
        return { submitted: true, provider: 'YOUTUBE_PLAYABLES', score: numericScore };
      } catch (_e) {
        return { submitted: false, provider: 'YOUTUBE_PLAYABLES', score: numericScore };
      }
    }
    return { submitted: true, provider: 'STANDALONE_WEB', score: numericScore };
  }
}

export const platformAdapter = new PlatformIntegrationAdapter();
export default platformAdapter;
