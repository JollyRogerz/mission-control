// The Matrix — "The Construct"
// Enhanced with pretext for pixel-perfect text measurement & mixed-script rain
(function () {
  'use strict';

  var KATAKANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
  var LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var DIGITS = '0123456789';
  var SYMBOLS = '.:*+=$#@!<>{}[]|/\\~^';
  var CHARSET = KATAKANA + LATIN + DIGITS + SYMBOLS;
  var COL_COUNT = 45;
  var TAIL_LEN = 30;
  var _columns = [];
  var _pretextReady = false;
  var _charWidths = {};  // pretext-measured character widths per font
  var _messages = [
    'WAKE UP NEO', 'THE MATRIX HAS YOU', 'FOLLOW THE WHITE RABBIT',
    'THERE IS NO SPOON', 'FREE YOUR MIND',
    'KNOCK KNOCK NEO', 'THE ONE', 'SYSTEM FAILURE',
  ];
  var _msgCols = [];  // columns that display scrolling messages

  // Use pretext to pre-measure character widths for perfect column spacing
  function _initPretext(canvas) {
    if (!window.__pretext) return;
    try {
      var pt = window.__pretext;
      // Measure a sample of all chars to get max width — used for column spacing
      var sample = CHARSET.split('').join(' ');
      var prepared = pt.prepareWithSegments(sample, '14px monospace');
      var result = pt.layoutWithLines(prepared, canvas.width, 16);
      _pretextReady = true;
      // Also prepare message lines for embedded text rain
      _msgCols = [];
      for (var m = 0; m < 3; m++) {
        var msg = _messages[Math.floor(Math.random() * _messages.length)];
        var msgPrep = pt.prepareWithSegments(msg, 'bold 12px monospace');
        var msgLayout = pt.layoutWithLines(msgPrep, 200, 14);
        _msgCols.push({
          text: msg,
          prepared: msgPrep,
          lines: msgLayout.lines,
          x: 50 + Math.random() * (canvas.width - 250),
          y: Math.random() * -300,
          speed: 0.3 + Math.random() * 0.5,
          alpha: 0,
          fadeIn: true,
          timer: Math.random() * 500
        });
      }
    } catch(e) { _pretextReady = false; }
  }

  ThemeEngine.register('matrix', {
    name: 'The Matrix',
    tagline: 'Free Your Mind',
    css: 'themes/matrix.css',
    icon: '\u{1F48A}',
    colors: { primary: '#00ff41', accent: '#008f11' },

    activate: function(mc, canvas, ctx) {
      _columns = [];
      _msgCols = [];
      if (!canvas) return;
      var colW = Math.floor(canvas.width / COL_COUNT);
      for (var i = 0; i < COL_COUNT; i++) {
        _columns.push({
          x: i * colW + colW / 2,
          y: Math.random() * -canvas.height,
          speed: 1.2 + Math.random() * 3.5,
          chars: Array.from({ length: TAIL_LEN }, function() { return CHARSET[Math.floor(Math.random() * CHARSET.length)]; }),
          cycleTimer: 0,
          brightness: 0.6 + Math.random() * 0.4  // per-column brightness variation
        });
      }
      _initPretext(canvas);
    },

    deactivate: function() { _columns = []; _msgCols = []; },

    renderBackground: function(ctx, timestamp, w, h) {
      // Fade trail — slightly longer persistence for denser rain
      ctx.fillStyle = 'rgba(0,8,0,0.10)';
      ctx.fillRect(0, 0, w, h);

      // --- Main character rain ---
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      _columns.forEach(function(col) {
        col.y += col.speed;
        if (col.y > h + TAIL_LEN * 16) {
          col.y = Math.random() * -300;
          col.speed = 1.2 + Math.random() * 3.5;
          col.brightness = 0.6 + Math.random() * 0.4;
        }
        col.cycleTimer++;
        if (col.cycleTimer > 2) {
          col.cycleTimer = 0;
          // Mutate 1-2 random chars per cycle for the glitch effect
          var mutations = 1 + Math.floor(Math.random() * 2);
          for (var m = 0; m < mutations; m++) {
            var idx = Math.floor(Math.random() * col.chars.length);
            col.chars[idx] = CHARSET[Math.floor(Math.random() * CHARSET.length)];
          }
        }
        col.chars.forEach(function(ch, i) {
          var cy = Math.floor(col.y) - i * 16;
          if (cy < -16 || cy > h + 16) return;
          if (i === 0) {
            // Head glyph — bright white-green with glow
            ctx.fillStyle = 'rgba(220,255,220,0.95)';
            ctx.shadowColor = 'rgba(0,255,65,0.6)';
            ctx.shadowBlur = 8;
          } else if (i === 1) {
            ctx.fillStyle = 'rgba(150,255,150,0.85)';
            ctx.shadowColor = '';
            ctx.shadowBlur = 0;
          } else {
            var alpha = Math.max(0.02, (0.8 * col.brightness) - i * (0.8 / TAIL_LEN));
            var green = Math.max(20, Math.floor(255 * col.brightness) - i * 7);
            ctx.fillStyle = 'rgba(0,' + green + ',65,' + alpha + ')';
            ctx.shadowBlur = 0;
          }
          ctx.fillText(ch, col.x, cy);
        });
        ctx.shadowBlur = 0;
      });
      ctx.textAlign = 'start';

      // --- Pretext-powered embedded message flashes ---
      if (_pretextReady && _msgCols.length > 0) {
        _msgCols.forEach(function(mc) {
          mc.timer++;
          // Cycle messages every ~800 frames
          if (mc.timer > 800) {
            mc.timer = 0;
            mc.text = _messages[Math.floor(Math.random() * _messages.length)];
            mc.x = 50 + Math.random() * (w - 250);
            mc.y = 50 + Math.random() * (h - 100);
            mc.alpha = 0;
            mc.fadeIn = true;
          }
          // Fade in/out
          if (mc.fadeIn) {
            mc.alpha = Math.min(mc.alpha + 0.008, 0.35);
            if (mc.alpha >= 0.35) mc.fadeIn = false;
          } else if (mc.timer > 600) {
            mc.alpha = Math.max(mc.alpha - 0.005, 0);
          }
          if (mc.alpha <= 0) return;

          // Render the message with a scramble effect
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'start';
          var chars = mc.text.split('');
          var xPos = mc.x;
          for (var ci = 0; ci < chars.length; ci++) {
            // Random chance to show scrambled char
            var showReal = (mc.timer > 100 + ci * 8) || Math.random() > 0.3;
            var displayChar = showReal ? chars[ci] : CHARSET[Math.floor(Math.random() * CHARSET.length)];
            var charAlpha = showReal ? mc.alpha : mc.alpha * 0.5;
            ctx.fillStyle = 'rgba(0,255,65,' + charAlpha.toFixed(3) + ')';
            ctx.fillText(displayChar, xPos, mc.y);
            xPos += 8;
          }
        });
      }
    },

    onAgentStateChange: function(agent, state) {
      var panel = document.querySelector('[data-agent="' + agent + '"]');
      if (panel && state !== 'idle') {
        panel.style.textShadow = '0 0 15px rgba(0,255,65,0.5)';
        setTimeout(function() { panel.style.textShadow = ''; }, 600);
      }
    },

    getSoundProfile: function() {
      return {
        oscillatorType: 'sawtooth', filterType: 'lowpass', filterFrequency: 1200, reverbDuration: 0.2,
        ambientDrone: { enabled: false },
        events: {
          spawn: { notes: [1, 2, 3, 4], duration: 0.08, attack: 0.005 },
          despawn: { notes: [4, 3, 2, 1], duration: 0.08, attack: 0.005 },
          taskComplete: { notes: [1, 1.5], duration: 0.15, attack: 0.01 },
          error: { notes: [1, 0.5, 1, 0.5], duration: 0.1, attack: 0.005 }
        },
        customSounds: {
          // Modem chirp ascending — sawtooth rapidly sweeping from 300Hz to 3000Hz through bandpass, very digital
          spawn: function(ctx, baseFreq, agentId) {
            try {
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0.04, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
              var filter = ctx.createBiquadFilter();
              filter.type = 'bandpass';
              filter.frequency.setValueAtTime(600, ctx.currentTime);
              filter.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + 0.3);
              filter.Q.setValueAtTime(3, ctx.currentTime);
              filter.connect(masterGain);
              masterGain.connect(ctx.destination);
              var osc = ctx.createOscillator();
              osc.type = 'sawtooth';
              osc.frequency.setValueAtTime(300, ctx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + 0.3);
              osc.connect(filter);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.35);
            } catch(e) {}
          },

          // Bit-error stutter — rapid repeating square wave at 200Hz with gain stuttering on/off 8 times
          error: function(ctx, baseFreq, agentId) {
            try {
              var masterGain = ctx.createGain();
              masterGain.connect(ctx.destination);
              var osc = ctx.createOscillator();
              osc.type = 'square';
              osc.frequency.setValueAtTime(200, ctx.currentTime);
              osc.connect(masterGain);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.35);
              for (var i = 0; i < 8; i++) {
                var t = ctx.currentTime + i * (0.3 / 8);
                masterGain.gain.setValueAtTime(i % 2 === 0 ? 0.05 : 0, t);
              }
              masterGain.gain.setValueAtTime(0, ctx.currentTime + 0.32);
            } catch(e) {}
          },

          // Keyboard click — very short (40ms) noise burst through highpass at 4000Hz
          chatSend: function(ctx, baseFreq, agentId) {
            try {
              var bufLen = Math.floor(ctx.sampleRate * 0.04);
              var buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
              var data = buffer.getChannelData(0);
              for (var i = 0; i < bufLen; i++) { data[i] = (Math.random() * 2 - 1); }
              var source = ctx.createBufferSource();
              source.buffer = buffer;
              var filter = ctx.createBiquadFilter();
              filter.type = 'highpass';
              filter.frequency.setValueAtTime(4000, ctx.currentTime);
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0.05, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.04);
              source.connect(filter);
              filter.connect(masterGain);
              masterGain.connect(ctx.destination);
              source.start(ctx.currentTime);
            } catch(e) {}
          },

          // Matrix phone ring — descending sine from 2000Hz to 800Hz, clean and eerie
          chatReceive: function(ctx, baseFreq, agentId) {
            try {
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.02);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.45);
              masterGain.connect(ctx.destination);
              var osc = ctx.createOscillator();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(2000, ctx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.4);
              osc.connect(masterGain);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.48);
            } catch(e) {}
          },

          // Bullet-time sweep — noise that starts at low bandpass then rapidly shifts to high freq
          navWhoosh: function(ctx, baseFreq, agentId) {
            try {
              var bufLen = Math.floor(ctx.sampleRate * 0.35);
              var buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
              var data = buffer.getChannelData(0);
              for (var i = 0; i < bufLen; i++) { data[i] = (Math.random() * 2 - 1); }
              var source = ctx.createBufferSource();
              source.buffer = buffer;
              var filter = ctx.createBiquadFilter();
              filter.type = 'bandpass';
              filter.frequency.setValueAtTime(200, ctx.currentTime);
              filter.frequency.exponentialRampToValueAtTime(6000, ctx.currentTime + 0.3);
              filter.Q.setValueAtTime(2, ctx.currentTime);
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0.04, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
              source.connect(filter);
              filter.connect(masterGain);
              masterGain.connect(ctx.destination);
              source.start(ctx.currentTime);
            } catch(e) {}
          },

          // Digital fanfare — fast ascending sawtooth arpeggio (8 notes in 0.4s) doubling each step
          goalComplete: function(ctx, baseFreq, agentId) {
            try {
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0.04, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
              masterGain.connect(ctx.destination);
              var startFreq = 200;
              for (var i = 0; i < 8; i++) {
                var freq = startFreq * Math.pow(2, i * 0.43); // step up roughly doubling over 8 notes toward 3200
                var t = ctx.currentTime + i * 0.05;
                var osc = ctx.createOscillator();
                var noteGain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(freq, t);
                noteGain.gain.setValueAtTime(0.8, t);
                noteGain.gain.linearRampToValueAtTime(0, t + 0.06);
                osc.connect(noteGain);
                noteGain.connect(masterGain);
                osc.start(t);
                osc.stop(t + 0.07);
              }
            } catch(e) {}
          }
        }
      };
    },

    getTransitionEffect: function() { return 'code-dissolve'; },

    getVocabulary: function() {
      return {
        getAgentLabel: function(agent, index) {
          var labels = ['ORCHESTRATOR.exe', 'BUILDER.exe', 'ARCHITECT.exe', 'SOCIAL.exe'];
          return labels[index] !== undefined ? labels[index] : 'AGENT-' + String(index + 1).padStart(2, '0') + '.exe';
        },
        stateLabels: {
          idle: 'PID: sleeping',
          thinking: 'PID: processing',
          tool_running: 'PID: executing',
          reading: 'PID: scanning',
          writing: 'PID: writing',
          dispatching: 'PID: routing',
          speaking: 'PID: responding',
          error: 'PID: FAULT',
          starting: 'PID: loading',
          stopping: 'PID: terminating',
          completed: 'PID: done',
        },
        detailLabels: {
          'State': 'STATUS',
          'Model': 'KERNEL',
          'Tool': 'PROCESS',
          'Tokens': 'CYCLES',
          'Uptime': 'RUNTIME',
          'Last seen': 'LAST SYNC',
          'Errors': 'FAULTS',
        },
        toolLabel: function(toolName) {
          return toolName ? toolName.toLowerCase() + '.sys' : '\u2014';
        }
      };
    },

    getCinematicEvent: function(eventType) {
      var events = {
        spawn: function() {
          _columns.forEach(function(c) { c.speed *= 3; });
          setTimeout(function() { _columns.forEach(function(c) { c.speed /= 3; }); }, 600);
        },
        error: function() {
          document.body.style.transform = 'translateX(3px)';
          setTimeout(function() { document.body.style.transform = 'translateX(-3px)'; }, 50);
          setTimeout(function() { document.body.style.transform = 'translateX(2px)'; }, 100);
          setTimeout(function() { document.body.style.transform = ''; }, 150);
        },
        milestone: function() {
          var tag = document.createElement('div');
          tag.textContent = 'You are The One';
          tag.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#00ff41;font-family:monospace;font-size:20px;letter-spacing:4px;z-index:9999;pointer-events:none;opacity:0;text-shadow:0 0 30px rgba(0,255,65,0.6);';
          document.body.appendChild(tag);
          if (typeof anime !== 'undefined') {
            anime({ targets: tag, opacity: [0, 1, 1, 0], duration: 2000, easing: 'easeInOutQuad', complete: function() { tag.remove(); } });
          } else { setTimeout(function() { tag.remove(); }, 2000); }
        },
        disconnect: function() {
          _columns.forEach(function(c) { c.speed = 0.2; });
          document.body.style.filter = 'brightness(0.4)';
        },
        reconnect: function() {
          _columns.forEach(function(c) { c.speed = 1.5 + Math.random() * 3; });
          document.body.style.filter = '';
        }
      };
      return events[eventType] || null;
    }
  });
})();
