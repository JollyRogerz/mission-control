// Bebop theme — warm amber CRT with scanline drift and flicker
(function () {
  'use strict';

  let _flickerTimer = null;
  let _scanlineOffset = 0;
  let _decode = null;
  // VHS glitch state — smooth and subtle
  let _glitchTimer = 0;
  let _glitchActive = false;
  let _glitchDuration = 0;
  let _glitchBars = [];
  let _nextGlitch = 300 + Math.random() * 500;  // glitch every 5-12 seconds

  ThemeEngine.register('bebop', {
    name: 'Cowboy Bebop',
    tagline: 'See You Space Cowboy...',
    css: 'themes/bebop.css',
    icon: '\u{1F680}',
    colors: { primary: '#d9a03c', accent: '#c47a34' },

    activate(mc, canvas, ctx) {
      _scheduleFlicker();
      // Initialize jazz text decode effect
      if (typeof PretextEffects !== 'undefined' && canvas) {
        _decode = new PretextEffects.TextDecode({
          messages: [
            'SEE YOU SPACE COWBOY', 'CARRY THAT WEIGHT', '3 2 1 LETS JAM',
            'WHATEVER HAPPENS HAPPENS', 'BANG', 'THE REAL FOLK BLUES',
            'YOU\'RE GONNA CARRY THAT WEIGHT',
            'LIKE A SHOOTING STAR', 'EASY COME EASY GO',
          ],
          charset: PretextEffects.CHARSETS.bebop,
          font: 'bold 11px monospace',
          color: 'rgba(217,160,60,0.25)',
          cycleFrames: 900,
          decodeSpeed: 6,
        });
        _decode.init(canvas.width, canvas.height, 2);
      }
    },

    deactivate() {
      if (_flickerTimer) clearTimeout(_flickerTimer);
      _flickerTimer = null;
      _scanlineOffset = 0;
      _decode = null;
    },

    renderBackground(ctx, timestamp, w, h) {
      ctx.clearRect(0, 0, w, h);

      // Warm ambient glow (background only — VHS effects are in renderForeground)
      var grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.5);
      grad.addColorStop(0, 'rgba(217,160,60,0.05)');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Jazz text decode (on background)
      if (_decode) _decode.render(ctx, w, h);
    },

    // === FOREGROUND — smooth VHS overlay on top of all panels ===
    renderForeground(ctx, timestamp, w, h) {
      ctx.clearRect(0, 0, w, h);

      // --- Subtle scanlines (every 4px, very faint) ---
      ctx.strokeStyle = 'rgba(217,160,60,0.018)';
      ctx.lineWidth = 1;
      for (var y = 0; y < h; y += 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // --- Smooth rolling band — gentle, slow scroll ---
      var rollY = ((timestamp * 0.015) % (h + 100)) - 50;
      var rollGrad = ctx.createLinearGradient(0, rollY - 30, 0, rollY + 30);
      rollGrad.addColorStop(0, 'transparent');
      rollGrad.addColorStop(0.4, 'rgba(217,160,60,0.04)');
      rollGrad.addColorStop(0.5, 'rgba(255,255,255,0.025)');
      rollGrad.addColorStop(0.6, 'rgba(217,160,60,0.04)');
      rollGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = rollGrad;
      ctx.fillRect(0, rollY - 30, w, 60);

      // --- Faint color bleed (top/bottom only) ---
      ctx.fillStyle = 'rgba(239,68,68,0.015)';
      ctx.fillRect(1, 0, w, 1);
      ctx.fillStyle = 'rgba(100,200,255,0.012)';
      ctx.fillRect(-1, h - 1, w, 1);

      // --- Sparse noise — just 4-5 pixels per frame ---
      for (var ni = 0; ni < 5; ni++) {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.015 + Math.random() * 0.025).toFixed(3) + ')';
        ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1);
      }

      // --- Occasional gentle glitch (every 5-12 seconds, short) ---
      _glitchTimer++;
      if (!_glitchActive && _glitchTimer > _nextGlitch) {
        _glitchActive = true;
        _glitchDuration = 4 + Math.floor(Math.random() * 8); // very brief
        _glitchTimer = 0;
        _nextGlitch = 300 + Math.random() * 500;
        _glitchBars = [];
        var barCount = 1 + Math.floor(Math.random() * 3); // just 1-3 bars
        for (var i = 0; i < barCount; i++) {
          _glitchBars.push({
            y: Math.random() * h,
            height: 2 + Math.random() * 6,
            offset: (Math.random() - 0.5) * 12,
            alpha: 0.08 + Math.random() * 0.12,
          });
        }
      }
      if (_glitchActive) {
        _glitchDuration--;
        if (_glitchDuration <= 0) { _glitchActive = false; _glitchBars = []; }
        else {
          for (var gi = 0; gi < _glitchBars.length; gi++) {
            var bar = _glitchBars[gi];
            // Gentle RGB offset
            ctx.fillStyle = 'rgba(239,68,68,' + (bar.alpha * 0.4).toFixed(3) + ')';
            ctx.fillRect(bar.offset + 2, bar.y, w, bar.height);
            ctx.fillStyle = 'rgba(100,200,255,' + (bar.alpha * 0.3).toFixed(3) + ')';
            ctx.fillRect(bar.offset - 2, bar.y, w, bar.height);
            // A few noise pixels
            for (var px = 0; px < 8; px++) {
              ctx.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.08).toFixed(3) + ')';
              ctx.fillRect(Math.random() * w, bar.y + Math.random() * bar.height, 1 + Math.random() * 3, 1);
            }
          }
        }
      }

      // --- HUD overlays (subtle) ---
      ctx.font = '9px monospace';
      var recAlpha = 0.12 + Math.sin(timestamp * 0.003) * 0.04;
      ctx.fillStyle = 'rgba(239,68,68,' + recAlpha.toFixed(3) + ')';
      ctx.fillText('●', 12, 18);
      ctx.fillStyle = 'rgba(217,160,60,' + (recAlpha * 0.8).toFixed(3) + ')';
      ctx.fillText('REC', 22, 18);

      // Timestamp bottom-left
      var now = new Date();
      ctx.fillStyle = 'rgba(217,160,60,0.1)';
      ctx.fillText(
        now.getFullYear() + '.' + String(now.getMonth()+1).padStart(2,'0') + '.' + String(now.getDate()).padStart(2,'0') +
        '  ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0'),
        12, h - 12
      );

      // PLAY (blinks slowly)
      if (Math.floor(timestamp / 1500) % 2 === 0) {
        ctx.fillStyle = 'rgba(217,160,60,0.08)';
        ctx.fillText('▶ PLAY', 12, 30);
      }

      // SP counter top-right
      ctx.fillStyle = 'rgba(217,160,60,0.07)';
      ctx.font = '8px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('SP', w - 12, 18);
      ctx.textAlign = 'start';
    },

    onAgentStateChange(agent, state) {
      // Bebop: warm amber flash on agent panel
      var panel = document.querySelector('[data-agent="' + agent + '"]');
      if (panel && state !== 'idle') {
        panel.style.boxShadow = '0 0 12px rgba(217,160,60,0.2)';
        setTimeout(function() { panel.style.boxShadow = ''; }, 600);
      }
    },

    getSoundProfile() {
      return {
        oscillatorType: 'sine',
        filterType: 'lowpass',
        filterFrequency: 1800,
        reverbDuration: 0.4,
        ambientDrone: { enabled: false },
        events: {
          spawn: { notes: [1, 1.25, 1.5, 2], duration: 0.2, attack: 0.02 },
          despawn: { notes: [2, 1.5, 1.25, 1], duration: 0.2, attack: 0.02 },
          taskComplete: { notes: [1, 1.33], duration: 0.25, attack: 0.02 },
          error: { notes: [1, 0.8], duration: 0.35, attack: 0.01 }
        },
        customSounds: {
          // Walking bass note ascending — sine at low freq with warm LP filter, 3-note jazz lick ascending by 3rds
          spawn: function(ctx, baseFreq, agentId) {
            try {
              var freq = baseFreq > 100 ? baseFreq * 0.5 : 110;
              var notes = [freq, freq * 1.25, freq * 1.5625]; // ascending by major 3rds
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0.04, ctx.currentTime);
              var filter = ctx.createBiquadFilter();
              filter.type = 'lowpass';
              filter.frequency.setValueAtTime(1800, ctx.currentTime);
              filter.connect(masterGain);
              masterGain.connect(ctx.destination);
              notes.forEach(function(f, i) {
                var osc = ctx.createOscillator();
                var noteGain = ctx.createGain();
                var t = ctx.currentTime + i * 0.12;
                osc.type = 'sine';
                osc.frequency.setValueAtTime(f, t);
                noteGain.gain.setValueAtTime(0, t);
                noteGain.gain.linearRampToValueAtTime(1, t + 0.02);
                noteGain.gain.linearRampToValueAtTime(0, t + 0.1);
                osc.connect(noteGain);
                noteGain.connect(filter);
                osc.start(t);
                osc.stop(t + 0.12);
              });
            } catch(e) {}
          },

          // Off-key brass stab — sawtooth with detuned parallel voices at tritone interval, short attack
          error: function(ctx, baseFreq, agentId) {
            try {
              var freq = baseFreq > 0 ? baseFreq : 440;
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.01);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
              masterGain.connect(ctx.destination);
              [freq, freq * 1.414].forEach(function(f) {
                var osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(f, ctx.currentTime);
                osc.connect(masterGain);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.3);
              });
            } catch(e) {}
          },

          // Rhodes electric piano dyad — 2 sine oscillators at a major 3rd interval with gentle attack/decay
          chatSend: function(ctx, baseFreq, agentId) {
            try {
              var freq = baseFreq > 0 ? baseFreq : 440;
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.03);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
              masterGain.connect(ctx.destination);
              [freq, freq * 1.25].forEach(function(f) {
                var osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(f, ctx.currentTime);
                osc.connect(masterGain);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.45);
              });
            } catch(e) {}
          },

          // Vibraphone bell — triangle wave with slight vibrato, bright and clean
          chatReceive: function(ctx, baseFreq, agentId) {
            try {
              var freq = baseFreq > 0 ? baseFreq * 1.5 : 660;
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.01);
              masterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
              masterGain.connect(ctx.destination);
              var osc = ctx.createOscillator();
              osc.type = 'triangle';
              osc.frequency.setValueAtTime(freq, ctx.currentTime);
              // Slight vibrato via LFO
              var lfo = ctx.createOscillator();
              var lfoGain = ctx.createGain();
              lfo.frequency.setValueAtTime(5.5, ctx.currentTime);
              lfoGain.gain.setValueAtTime(3, ctx.currentTime);
              lfo.connect(lfoGain);
              lfoGain.connect(osc.frequency);
              osc.connect(masterGain);
              lfo.start(ctx.currentTime);
              lfo.stop(ctx.currentTime + 0.5);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.5);
            } catch(e) {}
          },

          // Vinyl crackle — very short noise burst through narrow bandpass at 2kHz
          navWhoosh: function(ctx, baseFreq, agentId) {
            try {
              var bufLen = ctx.sampleRate * 0.05;
              var buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
              var data = buffer.getChannelData(0);
              for (var i = 0; i < bufLen; i++) { data[i] = (Math.random() * 2 - 1); }
              var source = ctx.createBufferSource();
              source.buffer = buffer;
              var filter = ctx.createBiquadFilter();
              filter.type = 'bandpass';
              filter.frequency.setValueAtTime(2000, ctx.currentTime);
              filter.Q.setValueAtTime(8, ctx.currentTime);
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0.03, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
              source.connect(filter);
              filter.connect(masterGain);
              masterGain.connect(ctx.destination);
              source.start(ctx.currentTime);
            } catch(e) {}
          },

          // Jazz piano chord — major 7th chord (root, 3rd, 5th, 7th) with soft sine waves and gentle tail
          goalComplete: function(ctx, baseFreq, agentId) {
            try {
              var freq = baseFreq > 0 ? baseFreq : 261.63;
              var ratios = [1, 1.25, 1.5, 1.875]; // root, maj3, p5, maj7
              var masterGain = ctx.createGain();
              masterGain.gain.setValueAtTime(0, ctx.currentTime);
              masterGain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.04);
              masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
              masterGain.connect(ctx.destination);
              ratios.forEach(function(r, i) {
                var osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq * r, ctx.currentTime);
                var noteGain = ctx.createGain();
                noteGain.gain.setValueAtTime(1 - i * 0.1, ctx.currentTime);
                osc.connect(noteGain);
                noteGain.connect(masterGain);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.65);
              });
            } catch(e) {}
          }
        }
      };
    },

    getTransitionEffect() {
      return 'crt-shrink'; // CRT power-off/on
    },

    getVocabulary: function() {
      return {
        getAgentLabel: function(agent, index, context) {
          var shorts = ['ORCH', 'BLDR', 'ARCH', 'SOCL'];
          return shorts[index] !== undefined ? shorts[index] : 'AG-' + String(index + 1).padStart(2, '0');
        },
        stateLabels: {
          idle: 'standby',
          thinking: 'processing',
          tool_running: 'active',
          reading: 'scanning',
          writing: 'writing',
          dispatching: 'dispatch.active',
          speaking: 'responding',
          error: 'MALFUNCTION',
          starting: 'booting',
          stopping: 'shutdown',
          completed: 'complete',
        },
        detailLabels: {
          'State': 'STATUS',
          'Model': 'SYSTEM',
          'Tool': 'PROCESS',
          'Tokens': 'DATA',
          'Uptime': 'UPTIME',
          'Last seen': 'LAST',
          'Errors': 'FAULTS',
        },
        toolLabel: function(toolName) {
          return toolName ? toolName.toLowerCase() + '.run' : 'standby';
        }
      };
    },

    getCinematicEvent(eventType) {
      var events = {
        spawn: function(data) {
          // CRT scanline wipe down
          var overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;background:rgba(217,160,60,0.08);z-index:9999;pointer-events:none;animation:bebop-wipe 0.6s ease-out forwards;';
          document.body.appendChild(overlay);
          setTimeout(function() { overlay.remove(); }, 700);
        },
        error: function(data) {
          // CRT static burst
          document.body.style.filter = 'brightness(1.2) contrast(1.1)';
          setTimeout(function() { document.body.style.filter = ''; }, 150);
        },
        milestone: function() {
          // Jazz tagline fade
          var tag = document.createElement('div');
          tag.textContent = 'SEE YOU SPACE COWBOY...';
          tag.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#d9a03c;font-family:monospace;font-size:18px;letter-spacing:4px;z-index:9999;pointer-events:none;opacity:0;text-shadow:0 0 20px rgba(217,160,60,0.5);';
          document.body.appendChild(tag);
          if (typeof anime !== 'undefined') {
            anime({ targets: tag, opacity: [0, 1, 1, 0], duration: 2000, easing: 'easeInOutQuad', complete: function() { tag.remove(); } });
          } else { setTimeout(function() { tag.remove(); }, 2200); }
        },
        disconnect: function() {
          // CRT dot shrink
          document.body.style.transition = 'filter 0.5s';
          document.body.style.filter = 'brightness(0.3)';
        },
        reconnect: function() {
          document.body.style.filter = '';
          setTimeout(function() { document.body.style.transition = ''; }, 600);
        }
      };
      return events[eventType] || null;
    }
  });

  function _scheduleFlicker() {
    var delay = 8000 + Math.random() * 7000; // 8-15s
    _flickerTimer = setTimeout(function() {
      document.body.style.opacity = '0.92';
      setTimeout(function() {
        document.body.style.opacity = '0.97';
        setTimeout(function() {
          document.body.style.opacity = '';
          _scheduleFlicker();
        }, 50);
      }, 30);
    }, delay);
  }
})();
