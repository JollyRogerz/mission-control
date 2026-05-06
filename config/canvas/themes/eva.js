// Neon Genesis Evangelion — "NERV HQ"
(function () {
  'use strict';

  var HEX_SIZE = 24;
  var _targetOpacity = 0.03;
  var _currentOpacity = 0.03;
  var _errorCount = 0;
  var _vortex = null;
  var _decode = null;

  ThemeEngine.register('eva', {
    name: 'Evangelion',
    tagline: "God's in His heaven. All's right with the world.",
    css: 'themes/eva.css',
    icon: '\u{2163}',
    colors: { primary: '#a855f7', accent: '#4ade80' },

    activate: function(mc, canvas, ctx) {
      _targetOpacity = 0.03;
      _currentOpacity = 0.03;
      _errorCount = 0;
      // Initialize purple spiral vortex + MAGI decode text
      if (typeof PretextEffects !== 'undefined') {
        _vortex = new PretextEffects.SpiralVortex({
          charset: PretextEffects.CHARSETS.eva,
          font: '11px monospace',
          ringCount: 7,
          charsPerRing: 35,
          speed: 0.0004,
          color: function(ring, maxRings, angle) {
            var alpha = 0.06 + (ring / maxRings) * 0.2;
            return 'rgba(138,43,226,' + alpha.toFixed(3) + ')';
          },
        });
        _decode = new PretextEffects.TextDecode({
          messages: [
            'PATTERN: BLUE', 'MAGI SYSTEM ONLINE', 'CASPAR NOMINAL',
            'MELCHIOR NOMINAL', 'BALTHASAR NOMINAL', 'AT FIELD DETECTED',
            'SYNC RATIO: 97.3%', 'EVANGELION UNIT-01', 'NERV HQ ACTIVE',
            'LANCE OF LONGINUS',
          ],
          charset: PretextEffects.CHARSETS.eva,
          font: 'bold 10px monospace',
          color: 'rgba(138,43,226,0.25)',
          cycleFrames: 600,
        });
        if (canvas) {
          _vortex.init(canvas.width, canvas.height);
          _decode.init(canvas.width, canvas.height, 2);
        }
      }
    },

    deactivate: function() { _errorCount = 0; _currentOpacity = 0.03; _vortex = null; _decode = null; },

    renderBackground: function(ctx, timestamp, w, h) {
      ctx.clearRect(0, 0, w, h);

      // Hex grid
      _currentOpacity += (_targetOpacity - _currentOpacity) * 0.05;
      var hexH = HEX_SIZE * Math.sqrt(3);
      ctx.strokeStyle = 'rgba(138,43,226,' + _currentOpacity + ')';
      ctx.lineWidth = 0.5;
      for (var row = -1; row < h / hexH + 1; row++) {
        for (var col = -1; col < w / (HEX_SIZE * 1.5) + 1; col++) {
          var cx = col * HEX_SIZE * 1.5;
          var cy = row * hexH + (col % 2 === 0 ? 0 : hexH / 2);
          _drawHex(ctx, cx, cy, HEX_SIZE);
        }
      }

      // Spiral vortex overlay
      if (_vortex) _vortex.render(ctx, timestamp, w, h);
      // Text decode overlay
      if (_decode) _decode.render(ctx, w, h);

      var pulse = Math.sin(timestamp / 1000) * 0.005;
      _targetOpacity = _errorCount > 0 ? Math.min(0.12, 0.03 + _errorCount * 0.03) : 0.03;
      _targetOpacity += pulse;
    },

    onAgentStateChange: function(agent, state) {
      if (state === 'error') {
        _errorCount = Math.min(_errorCount + 1, 3);
        setTimeout(function() { _errorCount = Math.max(0, _errorCount - 1); }, 5000);
      }
      var panel = document.querySelector('[data-agent="' + agent + '"]');
      if (panel && state === 'error') {
        panel.style.boxShadow = '0 0 20px rgba(138,43,226,0.4)';
        setTimeout(function() { panel.style.boxShadow = ''; }, 800);
      }
    },

    getSoundProfile: function() {
      return {
        oscillatorType: 'sine', filterType: 'lowpass', filterFrequency: 800, reverbDuration: 0.6,
        ambientDrone: { enabled: false },
        events: {
          spawn: { notes: [0.5, 0.75, 1], duration: 0.3, attack: 0.05 },
          despawn: { notes: [1, 0.75, 0.5], duration: 0.3, attack: 0.05 },
          taskComplete: { notes: [1, 1.25], duration: 0.3, attack: 0.03 },
          error: { notes: [1, 1.06, 1, 1.06], duration: 0.15, attack: 0.005 }
        },
        customSounds: {
          spawn: function(ctx, baseFreq, agentId) {
            try {
              var freq = baseFreq || 440;
              var notes = [freq, freq * 1.33, freq * 1.77];
              for (var i = 0; i < notes.length; i++) {
                (function(noteFreq, offset) {
                  try {
                    var lp = ctx.createBiquadFilter();
                    lp.type = 'lowpass';
                    lp.frequency.setValueAtTime(400, ctx.currentTime + offset);
                    lp.frequency.exponentialRampToValueAtTime(2000, ctx.currentTime + offset + 0.18);
                    var gain = ctx.createGain();
                    gain.connect(ctx.destination);
                    gain.gain.setValueAtTime(0, ctx.currentTime + offset);
                    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + offset + 0.04);
                    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.25);
                    lp.connect(gain);
                    var osc = ctx.createOscillator();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(noteFreq, ctx.currentTime + offset);
                    osc.connect(lp);
                    osc.start(ctx.currentTime + offset);
                    osc.stop(ctx.currentTime + offset + 0.25);
                  } catch(e) {}
                })(notes[i], i * 0.1);
              }
            } catch(e) {}
          },
          error: function(ctx, baseFreq, agentId) {
            try {
              var pulseDur = 0.08;
              var pulseGap = 0.04;
              for (var i = 0; i < 2; i++) {
                (function(offset) {
                  try {
                    var gain = ctx.createGain();
                    gain.connect(ctx.destination);
                    gain.gain.setValueAtTime(0.05, ctx.currentTime + offset);
                    gain.gain.setValueAtTime(0, ctx.currentTime + offset + pulseDur);
                    var osc = ctx.createOscillator();
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(300, ctx.currentTime + offset);
                    osc.connect(gain);
                    osc.start(ctx.currentTime + offset);
                    osc.stop(ctx.currentTime + offset + pulseDur + 0.01);
                  } catch(e) {}
                })(i * (pulseDur + pulseGap));
              }
            } catch(e) {}
          },
          chatSend: function(ctx, baseFreq, agentId) {
            try {
              var gain1 = ctx.createGain();
              gain1.connect(ctx.destination);
              gain1.gain.setValueAtTime(0.04, ctx.currentTime);
              gain1.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.015);
              var osc = ctx.createOscillator();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(1800, ctx.currentTime);
              osc.connect(gain1);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.015);
              var noiseOffset = 0.02;
              var bufSize = Math.floor(ctx.sampleRate * 0.03);
              var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
              var data = buf.getChannelData(0);
              for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
              var bp = ctx.createBiquadFilter();
              bp.type = 'bandpass';
              bp.frequency.setValueAtTime(2000, ctx.currentTime + noiseOffset);
              bp.Q.setValueAtTime(6, ctx.currentTime + noiseOffset);
              var gain2 = ctx.createGain();
              gain2.gain.setValueAtTime(0.03, ctx.currentTime + noiseOffset);
              gain2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + noiseOffset + 0.03);
              gain2.connect(ctx.destination);
              bp.connect(gain2);
              var src = ctx.createBufferSource();
              src.buffer = buf;
              src.connect(bp);
              src.start(ctx.currentTime + noiseOffset);
            } catch(e) {}
          },
          chatReceive: function(ctx, baseFreq, agentId) {
            try {
              var beepDur = 0.06;
              var beepGap = 0.05;
              for (var i = 0; i < 2; i++) {
                (function(offset) {
                  try {
                    var gain = ctx.createGain();
                    gain.connect(ctx.destination);
                    gain.gain.setValueAtTime(0.04, ctx.currentTime + offset);
                    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + beepDur);
                    var osc = ctx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(1000, ctx.currentTime + offset);
                    osc.connect(gain);
                    osc.start(ctx.currentTime + offset);
                    osc.stop(ctx.currentTime + offset + beepDur + 0.01);
                  } catch(e) {}
                })(i * (beepDur + beepGap));
              }
            } catch(e) {}
          },
          navWhoosh: function(ctx, baseFreq, agentId) {
            try {
              var dur = 0.25;
              var gain = ctx.createGain();
              gain.connect(ctx.destination);
              gain.gain.setValueAtTime(0, ctx.currentTime);
              gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.15);
              gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
              var osc = ctx.createOscillator();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(80, ctx.currentTime);
              osc.connect(gain);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + dur);
              var bufSize = Math.floor(ctx.sampleRate * dur);
              var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
              var data = buf.getChannelData(0);
              for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
              var lp = ctx.createBiquadFilter();
              lp.type = 'lowpass';
              lp.frequency.setValueAtTime(300, ctx.currentTime);
              lp.frequency.linearRampToValueAtTime(600, ctx.currentTime + dur);
              var gain2 = ctx.createGain();
              gain2.gain.setValueAtTime(0, ctx.currentTime);
              gain2.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 0.1);
              gain2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
              gain2.connect(ctx.destination);
              lp.connect(gain2);
              var src = ctx.createBufferSource();
              src.buffer = buf;
              src.connect(lp);
              src.start(ctx.currentTime);
            } catch(e) {}
          },
          goalComplete: function(ctx, baseFreq, agentId) {
            try {
              var freq = baseFreq || 440;
              var notes = [freq, freq * 1.25, freq * 1.5];
              var dur = 0.5;
              var lp = ctx.createBiquadFilter();
              lp.type = 'lowpass';
              lp.frequency.setValueAtTime(800, ctx.currentTime);
              lp.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + 0.4);
              var gain = ctx.createGain();
              gain.connect(ctx.destination);
              gain.gain.setValueAtTime(0, ctx.currentTime);
              gain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.04);
              gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
              lp.connect(gain);
              for (var i = 0; i < notes.length; i++) {
                var osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(notes[i], ctx.currentTime);
                osc.connect(lp);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + dur);
              }
            } catch(e) {}
          }
        }
      };
    },

    getTransitionEffect: function() { return 'nerv-cut'; },

    getVocabulary: function() {
      return {
        getAgentLabel: function(agent, index) {
          return 'EVA-' + String(index + 1).padStart(2, '0');
        },
        stateLabels: {
          idle: 'INACTIVE',
          thinking: 'SYNC ACTIVE',
          tool_running: 'SYNC ACTIVE',
          reading: 'SYNC ACTIVE',
          writing: 'SYNC ACTIVE',
          dispatching: 'LAUNCH',
          speaking: 'TRANSMIT',
          error: 'PATTERN BLUE',
          starting: 'ACTIVATION',
          stopping: 'SHUTDOWN',
          completed: 'MISSION COMPLETE',
        },
        detailLabels: {
          'State': 'SYNC',
          'Model': 'PILOT',
          'Tool': 'OPERATION',
          'Tokens': 'POWER',
          'Uptime': 'SORTIE',
          'Last seen': 'LAST CONTACT',
          'Errors': 'ALERTS',
        },
        toolLabel: function(toolName) {
          return toolName ? toolName.toUpperCase() : 'STANDBY';
        }
      };
    },

    getCinematicEvent: function(eventType) {
      var events = {
        spawn: function() {
          var overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;background:rgba(138,43,226,0.08);z-index:9999;pointer-events:none;';
          document.body.appendChild(overlay);
          if (typeof anime !== 'undefined') {
            anime({ targets: overlay, opacity: [1, 0], scale: [0.5, 1.5], duration: 800, easing: 'easeOutQuad', complete: function() { overlay.remove(); } });
          } else { setTimeout(function() { overlay.remove(); }, 800); }
        },
        error: function() {
          var warn = document.createElement('div');
          warn.textContent = '\u26A0 WARNING \u26A0';
          warn.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#a855f7;font-family:monospace;font-size:32px;font-weight:bold;letter-spacing:8px;z-index:9999;pointer-events:none;text-shadow:0 0 30px rgba(138,43,226,0.8);';
          document.body.appendChild(warn);
          document.body.style.filter = 'brightness(1.3)';
          setTimeout(function() { document.body.style.filter = ''; }, 100);
          if (typeof anime !== 'undefined') {
            anime({ targets: warn, opacity: [1, 0], scale: [1, 1.1], duration: 1500, easing: 'easeInQuad', complete: function() { warn.remove(); } });
          } else { setTimeout(function() { warn.remove(); }, 1500); }
        },
        milestone: function() {
          var tag = document.createElement('div');
          tag.textContent = 'ALL SYSTEMS NOMINAL';
          tag.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#3b82f6;font-family:monospace;font-size:18px;letter-spacing:4px;z-index:9999;pointer-events:none;opacity:0;text-shadow:0 0 20px rgba(59,130,246,0.5);';
          document.body.appendChild(tag);
          document.body.style.transition = 'filter 0.5s';
          document.body.style.filter = 'hue-rotate(-30deg) brightness(1.05)';
          setTimeout(function() { document.body.style.filter = ''; document.body.style.transition = ''; }, 2000);
          if (typeof anime !== 'undefined') {
            anime({ targets: tag, opacity: [0, 1, 1, 0], duration: 2000, easing: 'easeInOutQuad', complete: function() { tag.remove(); } });
          } else { setTimeout(function() { tag.remove(); }, 2000); }
        },
        disconnect: function() {
          document.body.style.transition = 'filter 0.3s';
          document.body.style.filter = 'brightness(0.2) saturate(2) hue-rotate(-10deg)';
        },
        reconnect: function() {
          document.body.style.filter = '';
          setTimeout(function() { document.body.style.transition = ''; }, 400);
        }
      };
      return events[eventType] || null;
    }
  });

  function _drawHex(ctx, cx, cy, size) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var angle = Math.PI / 3 * i - Math.PI / 6;
      var x = cx + size * Math.cos(angle);
      var y = cy + size * Math.sin(angle);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
})();
