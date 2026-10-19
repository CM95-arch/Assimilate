// Synthesized, soft, tactile sounds via WebAudio (no audio files, §4.5).
// Births are rate-limited so a busy colony sounds like gentle rain, not a hundred clicks.

import { AUDIO } from '../config/balance';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private active = 0;
  private lastPop = 0;
  private volume = 0.6;
  private muted = false;
  private readonly maxVoices = 8;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 3200;
      this.filter.connect(this.master);
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 1.2);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.applyVolume();
    } catch {
      this.ctx = null;
    }
  }

  setVolume(volume: number, muted: boolean) {
    this.volume = volume;
    this.muted = muted;
    this.applyVolume();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  private applyVolume() {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.5;
  }

  private ready(): AudioContext | null {
    if (!this.ctx || !this.filter || this.muted || this.volume <= 0 || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  /** Sound is decoration: a browser that rejects any audio call must never break the game. */
  private voice(freq: number, endFreq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0) {
    try {
      this.voiceUnsafe(freq, endFreq, dur, gain, type, delay);
    } catch (err) {
      console.warn('Audio voice failed', err);
    }
  }

  private voiceUnsafe(freq: number, endFreq: number, dur: number, gain: number, type: OscillatorType, delay: number) {
    const ctx = this.ready();
    if (!ctx || this.active >= this.maxVoices) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), t + dur * 0.8);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.filter!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    this.active++;
    osc.onended = () => {
      this.active--;
      osc.disconnect();
      g.disconnect();
    };
  }

  /**
   * Tiny pop for a cell birth. `busy` (births per second) lowers each pop's loudness so a
   * thriving colony stays calm.
   */
  pop(busy: number) {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastPop < 1 / AUDIO.maxPopsPerSecond) return;
    this.lastPop = now;
    const f = 900 + Math.random() * 500;
    const g = 0.09 / (1 + Math.sqrt(Math.max(0, busy)) * 0.18);
    this.voice(f, f * 1.6, 0.06, g, 'sine');
  }

  click() {
    this.voice(880, 660, 0.06, 0.1, 'triangle');
  }

  deny() {
    this.voice(220, 180, 0.11, 0.09, 'triangle');
  }

  /** Gentle whoosh for a zoom-out: filtered noise sweeping downward, plus a soft chord. */
  whoosh() {
    try {
      this.whooshUnsafe();
    } catch (err) {
      console.warn('Audio whoosh failed', err);
    }
  }

  private whooshUnsafe() {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(260, t + 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    src.connect(bp).connect(g).connect(this.filter!);
    src.start(t);
    src.stop(t + 1.25);
    src.onended = () => {
      src.disconnect();
      bp.disconnect();
      g.disconnect();
    };
    [392, 523.25].forEach((f, i) => this.voice(f, f, 0.9, 0.04, 'sine', 0.15 + i * 0.08));
  }
}
