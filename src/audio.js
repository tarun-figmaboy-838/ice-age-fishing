(function (PopoGame) {
'use strict';

// All sound is synthesised with the Web Audio API: no audio files were supplied.
// Groups: music, sfx and voice (unused, kept so narration can be added later).

const BPM = 84;
const EIGHTH = 60 / BPM / 2;
const CHORDS = [
  [261.63, 329.63, 392.0, 523.25],   // C
  [220.0, 261.63, 329.63, 440.0],    // Am
  [174.61, 220.0, 261.63, 349.23],   // F
  [196.0, 246.94, 293.66, 392.0],    // G
];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = false;
    this.travel = false;
    this.beat = 0;
    this.nextBeat = 0;
    this.timer = null;
    this.effectSources = new Set();
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);
    this.music = this.gainNode(0.5, this.master);
    this.sfx = this.gainNode(0.9, this.master);
    this.voice = this.gainNode(1, this.master);

    // a touch of shimmer for the music bed
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = EIGHTH * 3;
    const feedback = this.gainNode(0.28, this.delay);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    this.delay.connect(tone);
    tone.connect(feedback);
    tone.connect(this.music);

    this.noiseBuffer = this.makeNoise();
    this.startAmbience();
  }

  gainNode(value, dest) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g;
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  startAmbience() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = this.gainNode(0.045, this.music);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = this.gainNode(0.02, g.gain);
    lfo.connect(lfoGain);
    src.connect(lp);
    lp.connect(g);
    src.start();
    lfo.start();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
    this.nextBeat = this.ctx.currentTime + 0.05;
  }

  setTravel(on) {
    this.travel = on;
  }

  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.beat = 0;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 90);
  }

  stopMusic() {
    this.musicOn = false;
    clearInterval(this.timer);
  }

  schedule() {
    if (this.ctx.state !== 'running') return;
    while (this.nextBeat < this.ctx.currentTime + 0.3) {
      this.playBeat(this.beat, this.nextBeat);
      this.beat += 1;
      this.nextBeat += EIGHTH;
    }
  }

  playBeat(i, t) {
    const chord = CHORDS[Math.floor(i / 16) % CHORDS.length];
    const step = i % 16;
    const pattern = [0, 2, 1, 3, 2, 3, 1, 2];
    const note = chord[pattern[step % 8]] * (step >= 8 ? 2 : 1);
    this.tone({ freq: note, type: 'triangle', t, dur: 0.32, gain: 0.07, attack: 0.01, dest: this.music, send: 0.5 });
    if (step % 8 === 0) this.tone({ freq: chord[0] / 2, type: 'sine', t, dur: 1.3, gain: 0.11, attack: 0.03, dest: this.music });
    if (step === 0) this.bell(chord[3] * 2, t, 0.05);
    if (this.travel && step % 4 === 0) this.noise({ t, dur: 0.28, type: 'bandpass', freq: 900, q: 0.8, gain: 0.08, to: 300, dest: this.music });
  }

  duck(ms = 1500) {
    if (!this.ctx) return;
    const g = this.music.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0.18, now, 0.05);
    g.setTargetAtTime(0.5, now + ms / 1000, 0.4);
  }

  tone({ freq, type = 'sine', t, dur = 0.2, gain = 0.2, attack = 0.005, to = null, dest = this.sfx, send = 0 }) {
    if (!this.ctx) return;
    const start = t ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(dest);
    if (send && this.delay) {
      const s = this.gainNode(send, this.delay);
      g.connect(s);
    }
    this.trackEffect(osc, dest);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  bell(freq, t, gain = 0.1) {
    this.tone({ freq, type: 'sine', t, dur: 1.2, gain, dest: this.music, send: 0.6 });
    this.tone({ freq: freq * 2.76, type: 'sine', t, dur: 0.5, gain: gain * 0.25, dest: this.music });
  }

  noise({ t, dur = 0.3, type = 'lowpass', freq = 1000, q = 1, gain = 0.3, to = null, dest = this.sfx }) {
    if (!this.ctx) return;
    const start = t ?? this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, start);
    if (to) f.frequency.exponentialRampToValueAtTime(to, start + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    this.trackEffect(src, dest);
    src.start(start);
    src.stop(start + dur + 0.05);
  }

  trackEffect(source, destination) {
    if (destination !== this.sfx) return;
    this.effectSources.add(source);
    source.onended = () => { this.effectSources.delete(source); source.disconnect(); };
  }

  stopEffects() {
    for (const source of this.effectSources) {
      try { source.stop(); } catch (e) { /* already ended */ }
      source.disconnect();
    }
    this.effectSources.clear();
    if (this.ctx && this.music) {
      this.music.gain.cancelScheduledValues(this.ctx.currentTime);
      this.music.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.04);
    }
  }

  play(name) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const seq = (notes, gap, opts) => notes.forEach((n, i) => this.tone({ freq: n, t: now + i * gap, ...opts }));
    switch (name) {
      case 'ui': this.tone({ freq: 640, to: 520, dur: 0.07, gain: 0.12 }); break;
      case 'fishTap': this.tone({ freq: 320, to: 700, dur: 0.1, gain: 0.2 }); this.noise({ dur: 0.05, type: 'highpass', freq: 2000, gain: 0.08 }); break;
      case 'wiggle': seq([520, 660], 0.07, { type: 'triangle', dur: 0.08, gain: 0.1 }); break;
      case 'whoosh': this.noise({ dur: 0.38, type: 'bandpass', freq: 500, to: 2400, q: 1.2, gain: 0.25 }); break;
      case 'splashSmall': this.noise({ dur: 0.26, type: 'lowpass', freq: 1800, to: 500, gain: 0.3 }); this.tone({ freq: 900, to: 320, dur: 0.14, gain: 0.1 }); break;
      case 'splashBig': this.noise({ dur: 0.55, type: 'lowpass', freq: 1400, to: 300, gain: 0.45 }); this.tone({ freq: 700, to: 200, dur: 0.25, gain: 0.14 }); this.tone({ freq: 500, to: 180, t: now + 0.12, dur: 0.3, gain: 0.1 }); break;
      case 'reel':
        for (let i = 0; i < 9; i += 1) this.noise({ t: now + i * 0.065, dur: 0.03, type: 'highpass', freq: 1800, gain: 0.12 });
        this.tone({ freq: 300, to: 520, dur: 0.6, gain: 0.05, type: 'triangle' });
        break;
      case 'hooked': seq([440, 660], 0.09, { type: 'triangle', dur: 0.12, gain: 0.14 }); break;
      case 'collect': seq([523.25, 659.25, 783.99], 0.08, { dur: 0.25, gain: 0.14 }); this.noise({ dur: 0.12, type: 'lowpass', freq: 500, gain: 0.2 }); break;
      case 'success':
        [523.25, 659.25, 783.99, 1046.5].forEach((n, i) => this.bell(n, now + i * 0.12, 0.12));
        break;
      case 'tug': this.tone({ freq: 230, to: 150, type: 'triangle', dur: 0.22, gain: 0.18 }); break;
      case 'slip': this.tone({ freq: 950, to: 280, dur: 0.38, gain: 0.14 }); break;
      case 'puff': this.tone({ freq: 420, to: 740, dur: 0.09, gain: 0.075 }); this.noise({ dur: 0.06, type: 'lowpass', freq: 750, gain: 0.04 }); break;
      case 'bubbles': seq([360, 480, 620], 0.07, { type: 'sine', dur: 0.07, gain: 0.045 }); break;
      case 'drip': this.tone({ freq: 1100, to: 550, dur: 0.09, gain: 0.05 }); break;
      case 'recover': this.tone({ freq: 380, to: 820, dur: 0.1, gain: 0.14 }); this.tone({ freq: 180, to: 240, t: now + 0.1, type: 'triangle', dur: 0.16, gain: 0.1 }); break;
      case 'paddle': this.noise({ dur: 0.25, type: 'bandpass', freq: 900, to: 300, q: 0.8, gain: 0.14 }); break;
      case 'complete': [392.0, 523.25, 659.25, 783.99].forEach((n, i) => { this.tone({ freq: n, t: now + i * 0.15, type: 'triangle', dur: 0.5, gain: 0.12 }); this.bell(n * 2, now + i * 0.15, 0.06); }); break;
      case 'hint': this.tone({ freq: 880, dur: 0.18, gain: 0.07 }); break;
      case 'talk': { const f = 250 + Math.random() * 130; this.tone({ freq: f, to: f * (1.1 + Math.random() * 0.25), type: 'triangle', dur: 0.07, gain: 0.08 }); break; }
      case 'narrate': this.bell(523.25, now, 0.07); this.bell(783.99, now + 0.12, 0.05); break;
      case 'woah': this.tone({ freq: 380, to: 1150, type: 'sine', dur: 0.34, gain: 0.11 }); this.tone({ freq: 1150, to: 720, t: now + 0.32, type: 'sine', dur: 0.3, gain: 0.08 }); break;
      case 'leap': this.noise({ dur: 0.5, type: 'bandpass', freq: 400, to: 2600, q: 1.1, gain: 0.22 }); this.tone({ freq: 300, to: 760, dur: 0.4, gain: 0.08, type: 'triangle' }); break;
      case 'boing': this.tone({ freq: 170, to: 560, type: 'sine', dur: 0.22, gain: 0.12 }); this.tone({ freq: 560, to: 420, t: now + 0.2, type: 'sine', dur: 0.16, gain: 0.07 }); break;
      case 'hmm': this.tone({ freq: 330, to: 290, type: 'triangle', dur: 0.2, gain: 0.08 }); this.tone({ freq: 290, to: 380, t: now + 0.2, type: 'triangle', dur: 0.24, gain: 0.08 }); break;
      case 'word': { const f = 700 + Math.random() * 260; this.tone({ freq: f, to: f * 1.15, type: 'sine', dur: 0.05, gain: 0.04 }); break; }
      case 'cheer': [523.25, 659.25, 783.99].forEach((n, i) => this.tone({ freq: n, t: now + i * 0.07, type: 'triangle', dur: 0.16, gain: 0.08 })); break;
      case 'bloop': this.tone({ freq: 420, to: 980, dur: 0.12, gain: 0.09 }); this.tone({ freq: 620, to: 1300, t: now + 0.08, dur: 0.09, gain: 0.05 }); break;
      default: break;
    }
  }
}

Object.assign(PopoGame, { AudioEngine });
})(window.PopoGame = window.PopoGame || {});
