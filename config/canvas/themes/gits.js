// Ghost in the Shell — "Section 9"
(function () {
  'use strict';

  var _streams = null;
  var _grid = null;
  var _decode = null;
  var _scanY = 0;

  ThemeEngine.register('gits', {
    name: 'Ghost in the Shell',
    tagline: 'Stand Alone Complex',
    css: 'themes/gits.css',
    icon: '\u{1F441}',
    colors: { primary: '#06b6d4', accent: '#0e7490' },

    activate: function(mc, canvas, ctx) {
      _scanY = 0;
      if (!canvas || typeof PretextEffects === 'undefined') return;
      // Horizontal data streams — the GITS signature look
      _streams = new PretextEffects.DataStream({
        streamCount: 25,
        charset: PretextEffects.CHARSETS.gits,
        font: '11px monospace',
        charWidth: 9,
        speed: 1.2,
        color: function(stream, i, total) {
          var alpha = 0.06 + (1 - Math.abs(i - total / 2) / (total / 2)) * 0.25;
          return 'rgba(6,182,212,' + alpha.toFixed(3) + ')';
        },
      });
      // Dense background character grid
      _grid = new PretextEffects.CharacterGrid({
        charset: PretextEffects.CHARSETS.gits,
        font: '9px monospace',
        cellWidth: 14,
        cellHeight: 16,
        color: 'rgba(6,182,212,0.08)',
        waveSpeed: 0.001,
      });
      // Text decode overlays
      _decode = new PretextEffects.TextDecode({
        messages: [
          'STAND ALONE COMPLEX', 'SECTION 9 ONLINE', 'GHOST DUBBING DETECTED',
          'LAUGHING MAN TRACE', 'BARRIER MAZE ACTIVE', 'TACHIKOMA SYNC',
          'PUPPET MASTER', 'NET IS VAST AND INFINITE',
        ],
        charset: PretextEffects.CHARSETS.gits,
        font: 'bold 11px monospace',
        color: 'rgba(6,182,212,0.3)',
        cycleFrames: 700,
      });
      _streams.init(canvas.width, canvas.height);
      _grid.init(canvas.width, canvas.height);
      _decode.init(canvas.width, canvas.height, 3);
    },

    deactivate: function() { _streams = null; _grid = null; _decode = null; _scanY = 0; },

    renderBackground: function(ctx, timestamp, w, h) {
      ctx.clearRect(0, 0, w, h);

      // Dense background character grid with wave animation
      if (_grid) _grid.render(ctx, timestamp, w, h);

      // Horizontal data streams flowing across screen
      if (_streams) _streams.render(ctx, w, h);

      // Text decode overlays
      if (_decode) _decode.render(ctx, w, h);

      // Scan line
      _scanY = ((timestamp / 4000) % 1) * h;
      ctx.fillStyle = 'rgba(6,182,212,0.06)';
      ctx.fillRect(0, _scanY - 1, w, 2);
      var scanGrad = ctx.createLinearGradient(0, _scanY - 20, 0, _scanY + 20);
      scanGrad.addColorStop(0, 'transparent');
      scanGrad.addColorStop(0.5, 'rgba(6,182,212,0.03)');
      scanGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, _scanY - 20, w, 40);
    },

    onAgentStateChange: function(agent, state) {
      var panel = document.querySelector('[data-agent="' + agent + '"]');
      if (panel && state !== 'idle') {
        panel.style.boxShadow = '0 0 15px rgba(6,182,212,0.25)';
        setTimeout(function() { panel.style.boxShadow = ''; }, 500);
      }
    },

    getSoundProfile: function() {
      return {
        oscillatorType: 'square', filterType: 'highpass', filterFrequency: 3000, reverbDuration: 0,
        ambientDrone: { enabled: false },
        events: {
          spawn: { notes: [1, 1.5], duration: 0.12, attack: 0.005 },
          despawn: { notes: [1.5, 1], duration: 0.12, attack: 0.005 },
          taskComplete: { notes: [1, 1.33, 1.5], duration: 0.1, attack: 0.005 },
          error: { notes: [1, 0.75, 0.5], duration: 0.15, attack: 0.005 }
        },
        customSounds: {
          // Cyberbrain connection — clean square wave chirp ascending in 3 quick steps through highpass
          spawn: function(ctx, baseFreq, agentId) {
            try {
              var freq = baseFreq > 0 ? baseFreq : 440;
              var steps = [freq, freq * 1.5, freq * 2.25];
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0.04, ctx.currentTime);
              var filter = ctx.createBiquadFilter();
              filter.type = 'highpass';
              filter.frequency.setValueAtTime(800, ctx.currentTime);
              filter.connect(masterGain);
              masterGain.connect(ctx.destination);
              steps.forEach(function(f, i) {
                var osc = ctx.createOscillator();
                var noteGain = ctx.createGain();
                var t = ctx.currentTime + i * 0.08;
                osc.type = 'square';
                osc.frequency.setValueAtTime(f, t);
                noteGain.gain.setValueAtTime(0.8, t);
                noteGain.gain.linearRampToValueAtTime(0, t + 0.07);
                osc.connect(noteGain);
                noteGain.connect(filter);
                osc.start(t);
                osc.stop(t + 0.08);
              });
            } catch(e) {}
          },

          // Firewall breach — sharp high sine burst at 3000Hz with rapid frequency jitter
          error: function(ctx, baseFreq, agentId) {
            try {
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.005);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
              masterGain.connect(ctx.destination);
              var osc = ctx.createOscillator();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(3000, ctx.currentTime);
              // Rapid frequency jitter
              for (var i = 0; i < 12; i++) {
                var t = ctx.currentTime + i * (0.3 / 12);
                var jitter = 3000 + (Math.random() > 0.5 ? 1 : -1) * (200 + Math.random() * 400);
                osc.frequency.setValueAtTime(jitter, t);
              }
              osc.connect(masterGain);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.38);
            } catch(e) {}
          },

          // Encrypted channel encode — 4 rapid (25ms each) alternating tones at 1200Hz and 1800Hz
          chatSend: function(ctx, baseFreq, agentId) {
            try {
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0.04, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
              masterGain.connect(ctx.destination);
              var tones = [1200, 1800, 1200, 1800];
              tones.forEach(function(f, i) {
                var osc = ctx.createOscillator();
                var noteGain = ctx.createGain();
                var t = ctx.currentTime + i * 0.025;
                osc.type = 'square';
                osc.frequency.setValueAtTime(f, t);
                noteGain.gain.setValueAtTime(0.9, t);
                noteGain.gain.linearRampToValueAtTime(0, t + 0.022);
                osc.connect(noteGain);
                noteGain.connect(masterGain);
                osc.start(t);
                osc.stop(t + 0.026);
              });
            } catch(e) {}
          },

          // Decrypted message — clean descending 2-note triangle wave at freq*3 then freq*2.5, slight reverb
          chatReceive: function(ctx, baseFreq, agentId) {
            try {
              var freq = baseFreq > 0 ? baseFreq : 220;
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.01);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
              masterGain.connect(ctx.destination);
              [freq * 3, freq * 2.5].forEach(function(f, i) {
                var osc = ctx.createOscillator();
                var noteGain = ctx.createGain();
                var t = ctx.currentTime + i * 0.12;
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(f, t);
                noteGain.gain.setValueAtTime(0.9, t);
                noteGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
                osc.connect(noteGain);
                noteGain.connect(masterGain);
                osc.start(t);
                osc.stop(t + 0.25);
              });
            } catch(e) {}
          },

          // Optical camo shift — phase-shifted noise through bandpass sweeping from 800Hz to 3000Hz quickly
          navWhoosh: function(ctx, baseFreq, agentId) {
            try {
              var bufLen = Math.floor(ctx.sampleRate * 0.25);
              var buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
              var data = buffer.getChannelData(0);
              for (var i = 0; i < bufLen; i++) { data[i] = (Math.random() * 2 - 1); }
              var source = ctx.createBufferSource();
              source.buffer = buffer;
              var filter = ctx.createBiquadFilter();
              filter.type = 'bandpass';
              filter.frequency.setValueAtTime(800, ctx.currentTime);
              filter.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + 0.22);
              filter.Q.setValueAtTime(4, ctx.currentTime);
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0.03, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
              source.connect(filter);
              filter.connect(masterGain);
              masterGain.connect(ctx.destination);
              source.start(ctx.currentTime);
            } catch(e) {}
          },

          // Section 9 complete — cool ascending triad (root, 5th, octave) with square waves and slight detune
          goalComplete: function(ctx, baseFreq, agentId) {
            try {
              var freq = baseFreq > 0 ? baseFreq : 293.66;
              var ratios = [1, 1.5, 2]; // root, perfect 5th, octave
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.02);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.55);
              masterGain.connect(ctx.destination);
              ratios.forEach(function(r, i) {
                var t = ctx.currentTime + i * 0.1;
                // Two slightly detuned oscillators per note for width
                [-3, 3].forEach(function(detune) {
                  var osc = ctx.createOscillator();
                  var noteGain = ctx.createGain();
                  osc.type = 'square';
                  osc.frequency.setValueAtTime(freq * r, t);
                  osc.detune.setValueAtTime(detune, t);
                  noteGain.gain.setValueAtTime(0.4, t);
                  noteGain.gain.linearRampToValueAtTime(0, t + 0.3);
                  osc.connect(noteGain);
                  noteGain.connect(masterGain);
                  osc.start(t);
                  osc.stop(t + 0.35);
                });
              });
            } catch(e) {}
          }
        }
      };
    },

    getTransitionEffect: function() { return 'holographic-dissolve'; },

    getVocabulary: function() {
      return {
        getAgentLabel: function(agent, index) {
          var labels = ['UNIT.01 ORCHESTRATOR', 'UNIT.02 BUILDER', 'UNIT.03 ARCHITECT', 'UNIT.04 SOCIAL'];
          return labels[index] !== undefined ? labels[index] : 'UNIT.' + String(index + 1).padStart(2, '0') + ' AGENT';
        },
        stateLabels: {
          idle: '\u25C7 STANDBY',
          thinking: '\u25C8 PROCESSING',
          tool_running: '\u25C8 ACTIVE',
          reading: '\u25C8 SCANNING',
          writing: '\u25C8 WRITING',
          dispatching: '\u25C8 DISPATCH',
          speaking: '\u25C8 TRANSMIT',
          error: '\u25C8 BREACH',
          starting: '\u25C8 CONNECTING',
          stopping: '\u25C7 DISCONNECT',
          completed: '\u25C8 COMPLETE',
        },
        detailLabels: {
          'State': 'LINK',
          'Model': 'CORE',
          'Tool': 'PROCESS',
          'Tokens': 'BANDWIDTH',
          'Uptime': 'CONNECTED',
          'Last seen': 'LAST SYNC',
          'Errors': 'BREACHES',
        },
        toolLabel: function(toolName) {
          return toolName ? 'NEURAL.LINK: ' + toolName.toLowerCase() : 'dormant';
        }
      };
    },

    getCinematicEvent: function(eventType) {
      var events = {
        spawn: function() {
          var overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;background:rgba(6,182,212,0.06);z-index:9999;pointer-events:none;';
          document.body.appendChild(overlay);
          var flicks = 0;
          var flick = setInterval(function() {
            overlay.style.opacity = flicks % 2 === 0 ? '0.8' : '0.2';
            if (++flicks >= 6) { clearInterval(flick); overlay.remove(); }
          }, 80);
        },
        error: function() {
          _columns.forEach(function(c) { c.speed *= 2.5; });
          setTimeout(function() { _columns.forEach(function(c) { c.speed /= 2.5; }); }, 1000);
        },
        milestone: function() {
          var tag = document.createElement('div');
          tag.textContent = 'MISSION COMPLETE';
          tag.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#06b6d4;font-family:monospace;font-size:24px;letter-spacing:6px;z-index:9999;pointer-events:none;opacity:0;text-shadow:0 0 30px rgba(6,182,212,0.6);';
          document.body.appendChild(tag);
          if (typeof anime !== 'undefined') {
            anime({ targets: tag, opacity: [0, 1, 1, 0], duration: 2000, easing: 'easeInOutQuad', complete: function() { tag.remove(); } });
          } else { setTimeout(function() { tag.remove(); }, 2000); }
        },
        disconnect: function() { _columns.forEach(function(c) { c.speed = 0; }); },
        reconnect: function() { _columns.forEach(function(c) { c.speed = 0.6 + Math.random() * 1.2; }); }
      };
      return events[eventType] || null;
    }
  });
})();
