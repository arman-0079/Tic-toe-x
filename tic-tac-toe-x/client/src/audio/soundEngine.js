/**
 * TIC TAC TOE X - Synthesized Web Audio Sound Engine
 * Zero external audio assets required; generates crisp, futuristic arcade synthesis
 * on the fly with low latency on Android, iOS, and Desktop browsers.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  _ensureContext() {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
  }

  isMuted() {
    return this.muted;
  }

  playTone({ freq = 440, endFreq = null, duration = 0.12, type = 'sine', gain = 0.12, delay = 0 }) {
    const ctx = this._ensureContext();
    if (!ctx) return;

    try {
      const startTime = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);
      if (endFreq !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + duration);
      }

      gainNode.gain.setValueAtTime(0.0001, startTime);
      gainNode.gain.exponentialRampToValueAtTime(gain, startTime + 0.015);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    } catch (_e) {
      // Ignore audio context errors before gesture
    }
  }

  playClick() {
    this.playTone({ freq: 520, endFreq: 760, duration: 0.06, type: 'triangle', gain: 0.08 });
  }

  playMoveX() {
    // Crisp purple-neon laser pulse
    this.playTone({ freq: 380, endFreq: 680, duration: 0.11, type: 'sine', gain: 0.14 });
    this.playTone({ freq: 760, endFreq: 980, duration: 0.08, type: 'triangle', gain: 0.07, delay: 0.03 });
  }

  playMoveO() {
    // Deep cyan harmonic chime
    this.playTone({ freq: 540, endFreq: 420, duration: 0.12, type: 'sine', gain: 0.14 });
    this.playTone({ freq: 810, endFreq: 640, duration: 0.09, type: 'triangle', gain: 0.07, delay: 0.03 });
  }

  playInvalid() {
    this.playTone({ freq: 180, endFreq: 130, duration: 0.16, type: 'sawtooth', gain: 0.09 });
  }

  playWin() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      this.playTone({
        freq,
        endFreq: freq * 1.03,
        duration: idx === notes.length - 1 ? 0.32 : 0.14,
        type: 'triangle',
        gain: 0.13,
        delay: idx * 0.085,
      });
    });
  }

  playLose() {
    const notes = [440, 392, 349.23, 293.66];
    notes.forEach((freq, idx) => {
      this.playTone({
        freq,
        endFreq: freq * 0.96,
        duration: idx === notes.length - 1 ? 0.35 : 0.15,
        type: 'sawtooth',
        gain: 0.09,
        delay: idx * 0.1,
      });
    });
  }

  playDraw() {
    this.playTone({ freq: 440, endFreq: 440, duration: 0.13, type: 'sine', gain: 0.1 });
    this.playTone({ freq: 392, endFreq: 392, duration: 0.22, type: 'triangle', gain: 0.1, delay: 0.14 });
  }

  playRoomJoined() {
    this.playTone({ freq: 440, endFreq: 660, duration: 0.12, type: 'sine', gain: 0.11 });
    this.playTone({ freq: 660, endFreq: 880, duration: 0.16, type: 'sine', gain: 0.11, delay: 0.1 });
  }
}

export const soundEngine = new SoundEngine();
export default soundEngine;
