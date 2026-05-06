'use strict';

// ---------------------------------------------------------------------------
// SoundEngine.js — Procedural space/techie audio system
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------
// All sounds are generated procedurally with Web Audio API.
// No audio files. Volumes are intentionally low (0.025–0.06) for subtle UI feedback.
// ---------------------------------------------------------------------------

// Agent base frequencies for tonal identity — index-based cycle (D4)
// Index 0: 440 Hz (A4), 1: 330 Hz (E4), 2: 392 Hz (G4), 3: 523 Hz (C5)
// TODO(D4): support agent.audio.base_freq override from AgentDefinition schema
const AGENT_FREQS = [440, 330, 392, 523];

Object.assign(MissionControl.prototype, {

  // ── Infrastructure ────────────────────────────────────────────────────────

  initSoundEngine() {
    this._soundLastPlayed = {};
    this._soundMinInterval = 100;
    this._reverbBufferCache = null;

    // Listen for theme changes to restart ambient drone
    document.addEventListener('theme-changed', () => {
      this._stopAmbientDrone();
      if (window._mcAudioEnabled) this._startAmbientDrone();
    });
  },

  _getThemeSoundProfile() {
    if (typeof ThemeEngine !== 'undefined') {
      return ThemeEngine.getSoundProfile();
    }
    return null;
  },

  _getAudioCtx() {
    if (!this._seAudioCtx) {
      this._seAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._seAudioCtx.state === 'suspended') {
      this._seAudioCtx.resume();
    }
    return this._seAudioCtx;
  },

  _canPlaySound(name) {
    if (!window._mcAudioEnabled) return false;
    const now = performance.now();
    const last = this._soundLastPlayed && this._soundLastPlayed[name];
    if (last && (now - last) < (this._soundMinInterval || 100)) return false;
    if (!this._soundLastPlayed) this._soundLastPlayed = {};
    this._soundLastPlayed[name] = now;
    return true;
  },

  _createNoiseBuffer(duration) {
    const ctx = this._getAudioCtx();
    const length = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  },

  _getReverbBuffer() {
    if (this._reverbBufferCache) return this._reverbBufferCache;
    const ctx = this._getAudioCtx();
    const length = Math.ceil(ctx.sampleRate * 1.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    }
    this._reverbBufferCache = buffer;
    return buffer;
  },

  _createMasterGain(volume) {
    const ctx = this._getAudioCtx();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume != null ? volume : 0.08, ctx.currentTime);
    gain.connect(ctx.destination);
    return gain;
  },

  _createReverbSend(dryGain, wetAmount) {
    const ctx = this._getAudioCtx();
    const convolver = ctx.createConvolver();
    convolver.buffer = this._getReverbBuffer();
    const wetGain = ctx.createGain();
    wetGain.gain.setValueAtTime(wetAmount, ctx.currentTime);
    convolver.connect(wetGain);
    wetGain.connect(dryGain);
    return convolver;
  },

  // Theme sound override — if active theme provides a custom sound, use it
  _playThemeSound(eventName, agentId, agentIndex) {
    try {
      var profile = this._getThemeSoundProfile();
      if (profile && profile.customSounds && typeof profile.customSounds[eventName] === 'function') {
        var ctx = this._getAudioCtx();
        var freq = AGENT_FREQS[agentIndex % AGENT_FREQS.length] || 440;
        profile.customSounds[eventName](ctx, freq, agentId);
        return true;
      }
    } catch (_) {}
    return false;
  },

  // ── Sound Methods ─────────────────────────────────────────────────────────

  // A. Agent comes online — Matrix-style digital materialization
  playSpawnSound(agentId, agentIndex) {
    if (!this._canPlaySound('spawn-' + agentId)) return;
    if (this._playThemeSound('spawn', agentId, agentIndex)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.06);
      const freq = AGENT_FREQS[agentIndex % AGENT_FREQS.length] || 440;

      // Apply theme sound profile
      const profile = this._getThemeSoundProfile();
      const oscType = profile ? profile.oscillatorType : 'square';
      const filterFreq = profile ? profile.filterFrequency : 2000;
      const filterType = profile ? profile.filterType : 'lowpass';

      // Low-pass filter rising from filterFreq to 3500Hz
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(filterFreq, now);
      filter.frequency.linearRampToValueAtTime(3500, now + 0.32);
      filter.connect(master);

      // 4-note ascending arpeggio: root, 5th, octave, 10th
      const intervals = [1, 1.5, 2, 2.5];
      intervals.forEach((mult, i) => {
        const t = now + i * 0.08;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = oscType;
        osc.frequency.setValueAtTime(freq * mult, t);
        osc.detune.setValueAtTime((Math.random() - 0.5) * 10, t); // ±5 cents
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.connect(gain);
        gain.connect(filter);
        osc.start(t);
        osc.stop(t + 0.08);
      });
    } catch (_) { /* Audio may not be available */ }
  },

  // B. Agent goes offline — glitchy descending decay
  playDespawnSound(agentId, agentIndex) {
    if (!this._canPlaySound('despawn-' + agentId)) return;
    if (this._playThemeSound('despawn', agentId, agentIndex)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.05);
      const freq = AGENT_FREQS[agentIndex % AGENT_FREQS.length] || 440;

      // Apply theme sound profile
      const profile = this._getThemeSoundProfile();
      const oscType = profile ? profile.oscillatorType : 'sawtooth';
      const filterType = profile ? profile.filterType : 'lowpass';

      // Low-pass filter closing from 1500Hz to 200Hz
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(1500, now);
      filter.frequency.linearRampToValueAtTime(200, now + 0.4);
      filter.connect(master);

      // 4-note descending: octave, 5th, root, sub-octave
      const intervals = [2, 1.5, 1, 0.5];
      const detunes = [0, -50, -100, -150];
      intervals.forEach((mult, i) => {
        const t = now + i * 0.1;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = oscType;
        osc.frequency.setValueAtTime(freq * mult, t);
        osc.detune.setValueAtTime(detunes[i], t);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.connect(gain);
        gain.connect(filter);
        osc.start(t);
        osc.stop(t + 0.1);
      });
    } catch (_) { /* Audio may not be available */ }
  },

  // C. Enters thinking state — soft radar sonar ping
  playThinkingPing(agentId, agentIndex) {
    if (!this._canPlaySound('thinking-' + agentId)) return;
    if (this._playThemeSound('thinking', agentId, agentIndex)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.04);
      const freq = AGENT_FREQS[agentIndex % AGENT_FREQS.length] || 440;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 2, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.3);
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.4);
    } catch (_) { /* Audio may not be available */ }
  },

  // D. Enters tool_running state — subtle mechanical whir
  playToolWhir(agentId, agentIndex) {
    if (!this._canPlaySound('toolwhir-' + agentId)) return;
    if (this._playThemeSound('toolWhir', agentId, agentIndex)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.03);
      const freq = AGENT_FREQS[agentIndex % AGENT_FREQS.length] || 440;

      // Bandpass filter for mechanical servo character
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, now);
      filter.Q.setValueAtTime(5, now);
      filter.connect(master);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(80, now);
      osc.frequency.linearRampToValueAtTime(120, now + 0.1);
      osc.frequency.linearRampToValueAtTime(100, now + 0.2);
      gain.gain.setValueAtTime(0.6, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(filter);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch (_) { /* Audio may not be available */ }
  },

  // E. Enters dispatching state — teleportation energy whoosh
  playDispatchWhoosh(agentId, agentIndex) {
    if (!this._canPlaySound('dispatch-' + agentId)) return;
    if (this._playThemeSound('dispatch', agentId, agentIndex)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.05);
      const freq = AGENT_FREQS[agentIndex % AGENT_FREQS.length] || 440;

      // White noise burst through rising bandpass
      const noiseBuffer = this._createNoiseBuffer(0.35);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(200, now);
      noiseFilter.frequency.exponentialRampToValueAtTime(4000, now + 0.15);
      noiseFilter.frequency.exponentialRampToValueAtTime(800, now + 0.35);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.3, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(now);
      noise.stop(now + 0.35);

      // Tonal accent: sine rising to 3x base
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 3, now + 0.15);
      oscGain.gain.setValueAtTime(0.3, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(oscGain);
      oscGain.connect(master);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch (_) { /* Audio may not be available */ }
  },

  // F. Connection created (orbs launched) — photon torpedo fire
  playOrbLaunch(agentId, agentIndex) {
    if (!this._canPlaySound('orblaunch-' + agentId)) return;
    if (this._playThemeSound('orbLaunch', agentId, agentIndex)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.05);
      const freq = AGENT_FREQS[agentIndex % AGENT_FREQS.length] || 440;

      // 2 detuned sine oscillators rising and falling
      [0, 7].forEach((detune) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 1.5, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 4, now + 0.1);
        osc.frequency.exponentialRampToValueAtTime(freq * 2, now + 0.2);
        osc.detune.setValueAtTime(detune, now);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.2);
      });

      // Short high-passed noise burst for release transient
      const noiseBuffer = this._createNoiseBuffer(0.08);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.setValueAtTime(3000, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.25, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      noise.connect(hpf);
      hpf.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(now);
      noise.stop(now + 0.08);
    } catch (_) { /* Audio may not be available */ }
  },

  // G. Connection completed (response received) — soft data-received landing
  playOrbArrive(agentId, agentIndex) {
    if (!this._canPlaySound('orbarrive-' + agentId)) return;
    if (this._playThemeSound('orbArrive', agentId, agentIndex)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.04);
      const freq = AGENT_FREQS[agentIndex % AGENT_FREQS.length] || 440;

      // 2-note descending triangle wave chime
      [
        { mult: 2.5, offset: 0 },
        { mult: 2,   offset: 0.1 },
      ].forEach(({ mult, offset }) => {
        const t = now + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq * mult, t);
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.5, t + 0.01);  // 10ms attack
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.3);
      });
    } catch (_) { /* Audio may not be available */ }
  },

  // H. Error state — alarming distorted stutter
  playError(agentId) {
    if (!this._canPlaySound('error-' + agentId)) return;
    if (this._playThemeSound('error', agentId)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.06);

      // WaveShaper for soft clipping distortion
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i / 128) - 1;
        curve[i] = (Math.PI + 2) * x / (Math.PI + 2 * Math.abs(x));
      }
      shaper.curve = curve;
      shaper.oversample = '2x';
      shaper.connect(master);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';

      // Frequency wobble between 185Hz and 165Hz
      osc.frequency.setValueAtTime(185, now);
      osc.frequency.linearRampToValueAtTime(165, now + 0.1);
      osc.frequency.linearRampToValueAtTime(185, now + 0.2);
      osc.frequency.linearRampToValueAtTime(165, now + 0.3);

      // Gain stutter: pulse 0.15 → 0.05 → 0.15
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.setValueAtTime(0.05, now + 0.1);
      gain.gain.setValueAtTime(0.15, now + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(shaper);
      osc.start(now);
      osc.stop(now + 0.35);
    } catch (_) { /* Audio may not be available */ }
  },

  // I. User sends chat message — retro confirm beep
  playChatSend() {
    if (!this._canPlaySound('chatsend')) return;
    if (this._playThemeSound('chatSend', null)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.04);

      // 2-note ascending sine: A5 then C#6
      [
        { freq: 880,     offset: 0 },
        { freq: 1108.73, offset: 0.06 },
      ].forEach(({ freq, offset }) => {
        const t = now + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.12);
      });
    } catch (_) { /* Audio may not be available */ }
  },

  // J. Agent response received — notification ping with reverb
  playChatReceive(agentId, agentIndex) {
    if (!this._canPlaySound('chatrecv-' + agentId)) return;
    if (this._playThemeSound('chatReceive', agentId, agentIndex)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.05);
      const freq = AGENT_FREQS[agentIndex % AGENT_FREQS.length] || 440;

      // Reverb send
      const reverb = this._createReverbSend(master, 0.2);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 3, now);
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(master);   // dry path
      gain.connect(reverb);   // wet path through convolver
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (_) { /* Audio may not be available */ }
  },

  // K. Page navigation — very subtle UI transition whoosh
  playNavWhoosh() {
    if (!this._canPlaySound('navwhoosh')) return;
    if (this._playThemeSound('navWhoosh', null)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.025);

      const noiseBuffer = this._createNoiseBuffer(0.18);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(500, now);
      filter.frequency.exponentialRampToValueAtTime(2500, now + 0.09);
      filter.frequency.exponentialRampToValueAtTime(800, now + 0.18);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      noise.start(now);
      noise.stop(now + 0.18);
    } catch (_) { /* Audio may not be available */ }
  },

  // L. Command palette opens — sci-fi interface activation
  playPaletteOpen() {
    if (!this._canPlaySound('palopen')) return;
    if (this._playThemeSound('paletteOpen', null)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.03);

      // 2 sine oscillators rising in parallel 5th
      [
        { from: 600, to: 1200 },
        { from: 900, to: 1800 },
      ].forEach(({ from, to }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(from, now);
        osc.frequency.exponentialRampToValueAtTime(to, now + 0.15);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now);
        osc.stop(now + 0.15);
      });
    } catch (_) { /* Audio may not be available */ }
  },

  // M. Goal created — ascending chime (hope/ambition)
  playGoalCreate() {
    if (!this._canPlaySound('goalcreate')) return;
    if (this._playThemeSound('goalCreate', null)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.04);

      // 3-note ascending triangle chime: C5 → E5 → G5
      [
        { freq: 523.25, offset: 0 },
        { freq: 659.25, offset: 0.08 },
        { freq: 783.99, offset: 0.16 },
      ].forEach(({ freq, offset }) => {
        const t = now + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.2);
      });
    } catch (_) { /* Audio may not be available */ }
  },

  // N. Goal completed — triumphant major chord resolve
  playGoalComplete() {
    if (!this._canPlaySound('goalcomplete')) return;
    if (this._playThemeSound('goalComplete', null)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.05);
      const reverb = this._createReverbSend(master, 0.3);

      // Major chord: C5 + E5 + G5 simultaneously with soft attack
      [523.25, 659.25, 783.99].forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.4, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc.connect(gain);
        gain.connect(master);
        gain.connect(reverb);
        osc.start(now);
        osc.stop(now + 0.6);
      });
    } catch (_) { /* Audio may not be available */ }
  },

  // O. Agent paused — descending 2-note (powering down)
  playAgentPause(agentId, agentIndex) {
    if (!this._canPlaySound('agentpause-' + agentId)) return;
    if (this._playThemeSound('agentPause', agentId, agentIndex)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.04);
      const freq = AGENT_FREQS[agentIndex % AGENT_FREQS.length] || 440;

      // 2-note descending: base → half
      [
        { mult: 1.5, offset: 0 },
        { mult: 0.75, offset: 0.12 },
      ].forEach(({ mult, offset }) => {
        const t = now + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * mult, t);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.18);
      });
    } catch (_) { /* Audio may not be available */ }
  },

  // P. Agent resumed — ascending 2-note (powering up)
  playAgentResume(agentId, agentIndex) {
    if (!this._canPlaySound('agentresume-' + agentId)) return;
    if (this._playThemeSound('agentResume', agentId, agentIndex)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.04);
      const freq = AGENT_FREQS[agentIndex % AGENT_FREQS.length] || 440;

      // 2-note ascending: half → base
      [
        { mult: 0.75, offset: 0 },
        { mult: 1.5,  offset: 0.1 },
      ].forEach(({ mult, offset }) => {
        const t = now + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * mult, t);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.15);
      });
    } catch (_) { /* Audio may not be available */ }
  },

  // Q. Agent stopped — flat warning buzz
  playAgentStop(agentId) {
    if (!this._canPlaySound('agentstop-' + agentId)) return;
    if (this._playThemeSound('agentStop', agentId)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.04);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.25);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (_) { /* Audio may not be available */ }
  },

  // R. End beep — task completion notification
  playEndBeep() {
    if (!this._canPlaySound('endbeep')) return;
    if (this._playThemeSound('endBeep', null)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.04);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch (_) { /* Audio may not be available */ }
  },

  // S. Command palette closes — sci-fi interface deactivation
  playPaletteClose() {
    if (!this._canPlaySound('palclose')) return;
    if (this._playThemeSound('paletteClose', null)) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.025);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch (_) { /* Audio may not be available */ }
  },

  // ── Ambient Drone (Theme-specific background sound) ────────────────────
  _startAmbientDrone() {
    const profile = this._getThemeSoundProfile();
    if (!profile || !profile.ambientDrone || !profile.ambientDrone.enabled) {
      this._stopAmbientDrone();
      return;
    }
    if (this._droneNode) return; // already running
    const ctx = this._getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = profile.ambientDrone.type || 'sine';
    osc.frequency.value = profile.ambientDrone.frequency || 55;
    gain.gain.value = Math.pow(10, (profile.ambientDrone.gain || -30) / 20);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    this._droneNode = osc;
    this._droneGain = gain;
  },

  _stopAmbientDrone() {
    if (this._droneNode) {
      try { this._droneNode.stop(); } catch (_) {}
      this._droneNode = null;
      this._droneGain = null;
    }
  },

});
