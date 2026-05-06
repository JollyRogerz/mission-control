// Predator — "Hunt Protocol"
(function () {
  'use strict';

  var _mouseX = 0, _mouseY = 0;
  var _reticleX = 0, _reticleY = 0;
  var _noiseData = null;
  var _noiseCanvas = null;
  var _noiseCtx = null;
  var _mouseMoveHandler = null;

  ThemeEngine.register('predator', {
    name: 'Predator',
    tagline: 'Hunt Protocol Active',
    css: 'themes/predator.css',
    icon: '\u{1F53A}',
    colors: { primary: '#ef4444', accent: '#7f1d1d' },

    activate: function(mc, canvas, ctx) {
      _reticleX = canvas ? canvas.width / 2 : 500;
      _reticleY = canvas ? canvas.height / 2 : 400;
      _mouseX = _reticleX;
      _mouseY = _reticleY;
      if (canvas) {
        _noiseCanvas = document.createElement('canvas');
        _noiseCanvas.width = Math.floor(canvas.width / 4);
        _noiseCanvas.height = Math.floor(canvas.height / 4);
        _noiseCtx = _noiseCanvas.getContext('2d');
        _noiseData = _noiseCtx.createImageData(_noiseCanvas.width, _noiseCanvas.height);
      }
      _mouseMoveHandler = function(e) { _mouseX = e.clientX; _mouseY = e.clientY; };
      document.addEventListener('mousemove', _mouseMoveHandler);
    },

    deactivate: function() {
      if (_mouseMoveHandler) {
        document.removeEventListener('mousemove', _mouseMoveHandler);
        _mouseMoveHandler = null;
      }
      _noiseData = null;
      _noiseCanvas = null;
      _noiseCtx = null;
    },

    renderBackground: function(ctx, timestamp, w, h) {
      ctx.clearRect(0, 0, w, h);

      // --- Thermal noise base layer ---
      if (_noiseData && _noiseCanvas && _noiseCtx) {
        var nw = _noiseCanvas.width, nh = _noiseCanvas.height;
        var data = _noiseData.data;
        for (var i = 0; i < data.length; i += 4) {
          var v = Math.random();
          // Cold blue/purple noise
          data[i] = v * 15;
          data[i + 1] = v * 5;
          data[i + 2] = v * 40 + 15;
          data[i + 3] = 25;
        }
        _noiseCtx.putImageData(_noiseData, 0, 0);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(_noiseCanvas, 0, 0, nw, nh, 0, 0, w, h);
        ctx.restore();
      }

      // --- Thermal heat blobs — drifting warm spots ---
      var blobCount = 6;
      for (var bi = 0; bi < blobCount; bi++) {
        var bx = w * (0.15 + 0.7 * ((Math.sin(timestamp * 0.0002 + bi * 2.1) + 1) / 2));
        var by = h * (0.15 + 0.7 * ((Math.cos(timestamp * 0.00015 + bi * 1.7) + 1) / 2));
        var br = 60 + Math.sin(timestamp * 0.001 + bi) * 20;

        // Multi-stop thermal gradient: center hot (red/yellow) → edges cool (blue/purple)
        var grad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        grad.addColorStop(0, 'rgba(255,200,50,0.06)');    // hot center — yellow
        grad.addColorStop(0.25, 'rgba(239,68,68,0.05)');   // red
        grad.addColorStop(0.5, 'rgba(200,80,20,0.04)');    // orange
        grad.addColorStop(0.75, 'rgba(34,197,94,0.025)');   // green transition
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(bx - br, by - br, br * 2, br * 2);
      }

      // --- Large ambient thermal zones ---
      var z1 = ctx.createRadialGradient(w * 0.3, h * 0.4, 0, w * 0.3, h * 0.4, w * 0.3);
      z1.addColorStop(0, 'rgba(239,68,68,0.04)');
      z1.addColorStop(0.5, 'rgba(245,158,11,0.02)');
      z1.addColorStop(1, 'transparent');
      ctx.fillStyle = z1;
      ctx.fillRect(0, 0, w, h);

      var z2 = ctx.createRadialGradient(w * 0.7, h * 0.6, 0, w * 0.7, h * 0.6, w * 0.25);
      z2.addColorStop(0, 'rgba(59,130,246,0.035)');
      z2.addColorStop(0.6, 'rgba(100,50,150,0.02)');
      z2.addColorStop(1, 'transparent');
      ctx.fillStyle = z2;
      ctx.fillRect(0, 0, w, h);

      // --- Thermal color bar (bottom edge) ---
      var barH = 3;
      var barGrad = ctx.createLinearGradient(0, 0, w, 0);
      barGrad.addColorStop(0, 'rgba(30,40,120,0.3)');     // cold — deep blue
      barGrad.addColorStop(0.2, 'rgba(59,130,246,0.3)');   // cool — blue
      barGrad.addColorStop(0.4, 'rgba(34,197,94,0.3)');    // warm — green
      barGrad.addColorStop(0.6, 'rgba(245,158,11,0.3)');   // hot — yellow
      barGrad.addColorStop(0.8, 'rgba(239,68,68,0.3)');    // very hot — red
      barGrad.addColorStop(1, 'rgba(255,255,200,0.3)');    // extreme — white
      ctx.fillStyle = barGrad;
      ctx.fillRect(0, h - barH, w, barH);

      // --- Reticle (follows mouse) ---
      _reticleX += (_mouseX - _reticleX) * 0.05;
      _reticleY += (_mouseY - _reticleY) * 0.05;

      // Outer triangle
      var size = 22;
      ctx.strokeStyle = 'rgba(239,68,68,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(_reticleX, _reticleY - size);
      ctx.lineTo(_reticleX + size * 0.866, _reticleY + size * 0.5);
      ctx.lineTo(_reticleX - size * 0.866, _reticleY + size * 0.5);
      ctx.closePath();
      ctx.stroke();

      // Inner triangle
      var s2 = size * 0.45;
      ctx.strokeStyle = 'rgba(239,68,68,0.45)';
      ctx.beginPath();
      ctx.moveTo(_reticleX, _reticleY - s2);
      ctx.lineTo(_reticleX + s2 * 0.866, _reticleY + s2 * 0.5);
      ctx.lineTo(_reticleX - s2 * 0.866, _reticleY + s2 * 0.5);
      ctx.closePath();
      ctx.stroke();

      // Center dot with thermal glow
      var dotGrad = ctx.createRadialGradient(_reticleX, _reticleY, 0, _reticleX, _reticleY, 8);
      dotGrad.addColorStop(0, 'rgba(255,100,100,0.6)');
      dotGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = dotGrad;
      ctx.beginPath();
      ctx.arc(_reticleX, _reticleY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(239,68,68,0.7)';
      ctx.beginPath();
      ctx.arc(_reticleX, _reticleY, 2, 0, Math.PI * 2);
      ctx.fill();

      // --- Three-dot laser (top right) ---
      var dotX = w - 30;
      var dotY = 30;
      for (var j = 0; j < 3; j++) {
        var phase = (timestamp / 300 + j * 0.5) % 3;
        var alpha = phase < 1 ? 0.8 : 0.2;
        ctx.fillStyle = 'rgba(239,68,68,' + alpha + ')';
        ctx.beginPath();
        ctx.arc(dotX, dotY + j * 10, 3, 0, Math.PI * 2);
        ctx.fill();
        // Glow
        ctx.fillStyle = 'rgba(239,68,68,' + (alpha * 0.3) + ')';
        ctx.beginPath();
        ctx.arc(dotX, dotY + j * 10, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    onAgentStateChange: function(agent, state) {
      var panel = document.querySelector('[data-agent="' + agent + '"]');
      if (panel && state !== 'idle') {
        panel.style.boxShadow = '0 0 15px rgba(239,68,68,0.3)';
        setTimeout(function() { panel.style.boxShadow = ''; }, 600);
      }
    },

    getSoundProfile: function() {
      return {
        oscillatorType: 'sawtooth', filterType: 'lowpass', filterFrequency: 400, reverbDuration: 0.3,
        ambientDrone: { enabled: false },
        events: {
          spawn: { notes: [1, 1.5, 2], duration: 0.1, attack: 0.005 },
          despawn: { notes: [2, 1.5, 1], duration: 0.1, attack: 0.005 },
          taskComplete: { notes: [1, 1.2, 1.5], duration: 0.12, attack: 0.01 },
          error: { notes: [0.5, 0.5, 0.5], duration: 0.3, attack: 0.005 }
        },
        customSounds: {
          spawn: function(ctx, baseFreq, agentId) {
            try {
              var clickDur = 0.02;
              var clickGap = 0.022;
              for (var i = 0; i < 5; i++) {
                (function(offset) {
                  try {
                    var bufSize = Math.floor(ctx.sampleRate * clickDur);
                    var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
                    var data = buf.getChannelData(0);
                    for (var j = 0; j < bufSize; j++) data[j] = (Math.random() * 2 - 1);
                    var bp = ctx.createBiquadFilter();
                    bp.type = 'bandpass';
                    bp.frequency.setValueAtTime(3000, ctx.currentTime + offset);
                    bp.Q.setValueAtTime(15, ctx.currentTime + offset);
                    var gain = ctx.createGain();
                    gain.gain.setValueAtTime(0.05, ctx.currentTime + offset);
                    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + clickDur);
                    gain.connect(ctx.destination);
                    bp.connect(gain);
                    var src = ctx.createBufferSource();
                    src.buffer = buf;
                    src.connect(bp);
                    src.start(ctx.currentTime + offset);
                  } catch(e) {}
                })(i * clickGap);
              }
            } catch(e) {}
          },
          error: function(ctx, baseFreq, agentId) {
            try {
              var curve = new Float32Array(256);
              for (var k = 0; k < 256; k++) {
                var x = (k * 2) / 256 - 1;
                curve[k] = Math.tanh(x * 6);
              }
              var ws = ctx.createWaveShaper();
              ws.curve = curve;
              var gain = ctx.createGain();
              gain.connect(ctx.destination);
              ws.connect(gain);
              gain.gain.setValueAtTime(0, ctx.currentTime);
              gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.005);
              gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
              var osc = ctx.createOscillator();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(60, ctx.currentTime);
              osc.connect(ws);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.18);
            } catch(e) {}
          },
          chatSend: function(ctx, baseFreq, agentId) {
            try {
              var gain = ctx.createGain();
              gain.connect(ctx.destination);
              gain.gain.setValueAtTime(0.04, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.06);
              var osc = ctx.createOscillator();
              osc.type = 'square';
              osc.frequency.setValueAtTime(1000, ctx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(5000, ctx.currentTime + 0.06);
              var lp = ctx.createBiquadFilter();
              lp.type = 'lowpass';
              lp.frequency.setValueAtTime(4000, ctx.currentTime);
              osc.connect(lp);
              lp.connect(gain);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.06);
            } catch(e) {}
          },
          chatReceive: function(ctx, baseFreq, agentId) {
            try {
              var gain = ctx.createGain();
              gain.connect(ctx.destination);
              gain.gain.setValueAtTime(0.04, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
              var osc = ctx.createOscillator();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(2000, ctx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.2);
              var lp = ctx.createBiquadFilter();
              lp.type = 'lowpass';
              lp.frequency.setValueAtTime(3000, ctx.currentTime);
              osc.connect(lp);
              lp.connect(gain);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.2);
            } catch(e) {}
          },
          navWhoosh: function(ctx, baseFreq, agentId) {
            try {
              var dur = 0.25;
              var bufSize = Math.floor(ctx.sampleRate * dur);
              var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
              var data = buf.getChannelData(0);
              for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
              var hp = ctx.createBiquadFilter();
              hp.type = 'highpass';
              hp.frequency.setValueAtTime(500, ctx.currentTime);
              hp.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + dur);
              var lp = ctx.createBiquadFilter();
              lp.type = 'lowpass';
              lp.frequency.setValueAtTime(600, ctx.currentTime);
              lp.frequency.exponentialRampToValueAtTime(3500, ctx.currentTime + dur);
              var gain = ctx.createGain();
              gain.gain.setValueAtTime(0.04, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
              gain.connect(ctx.destination);
              lp.connect(gain);
              hp.connect(lp);
              var src = ctx.createBufferSource();
              src.buffer = buf;
              src.connect(hp);
              src.start(ctx.currentTime);
            } catch(e) {}
          },
          goalComplete: function(ctx, baseFreq, agentId) {
            try {
              var curve = new Float32Array(256);
              for (var k = 0; k < 256; k++) {
                var x = (k * 2) / 256 - 1;
                curve[k] = Math.tanh(x * 4);
              }
              var ws = ctx.createWaveShaper();
              ws.curve = curve;
              var gain = ctx.createGain();
              gain.connect(ctx.destination);
              ws.connect(gain);
              gain.gain.setValueAtTime(0.04, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
              var osc1 = ctx.createOscillator();
              osc1.type = 'sine';
              osc1.frequency.setValueAtTime(220, ctx.currentTime);
              var osc2 = ctx.createOscillator();
              osc2.type = 'sawtooth';
              osc2.frequency.setValueAtTime(223, ctx.currentTime);
              osc1.connect(ws);
              osc2.connect(ws);
              osc1.start(ctx.currentTime);
              osc2.start(ctx.currentTime);
              osc1.stop(ctx.currentTime + 0.4);
              osc2.stop(ctx.currentTime + 0.4);
            } catch(e) {}
          }
        }
      };
    },

    getTransitionEffect: function() { return 'thermal-blur'; },

    getVocabulary: function() {
      return {
        getAgentLabel: function(agent, index) {
          var labels = ['\u25C9 ORCHESTRATOR', '\u25C9 BUILDER', '\u25C9 ARCHITECT', '\u25C9 SOCIAL'];
          return labels[index] !== undefined ? labels[index] : '\u25C9 AGENT-' + String(index + 1).padStart(2, '0');
        },
        stateLabels: {
          idle: '\u25BC COLD',
          thinking: '\u25B2 WARM',
          tool_running: '\u25B2 HOT',
          reading: '\u25B2 WARM',
          writing: '\u25B2 HOT',
          dispatching: '\u25B2 HOT',
          speaking: '\u25B2 WARM',
          error: '\u25B2 CRITICAL',
          starting: '\u25B2 WARM',
          stopping: '\u25BC COLD',
          completed: '\u25B2 WARM',
        },
        detailLabels: {
          'State': 'THERMAL',
          'Model': 'SIGNATURE',
          'Tool': 'FUNCTION',
          'Tokens': 'SIGNAL',
          'Uptime': 'HUNT TIME',
          'Last seen': 'LAST PING',
          'Errors': 'MISSES',
        },
        toolLabel: function(toolName) {
          return toolName ? toolName.toUpperCase() : '\u2014';
        }
      };
    },

    getCinematicEvent: function(eventType) {
      var events = {
        spawn: function() {
          document.body.style.filter = 'blur(2px) brightness(1.1)';
          setTimeout(function() { document.body.style.filter = 'blur(1px)'; }, 200);
          setTimeout(function() { document.body.style.filter = ''; }, 500);
        },
        error: function() {
          var warn = document.createElement('div');
          warn.textContent = '\u25B2 TARGET LOST \u25B2';
          warn.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#ef4444;font-family:monospace;font-size:18px;letter-spacing:4px;z-index:9999;pointer-events:none;text-shadow:0 0 20px rgba(239,68,68,0.6);';
          document.body.appendChild(warn);
          document.body.style.transform = 'skewX(1deg)';
          setTimeout(function() { document.body.style.transform = ''; }, 100);
          if (typeof anime !== 'undefined') {
            anime({ targets: warn, opacity: [1, 0], duration: 1200, easing: 'easeInQuad', complete: function() { warn.remove(); } });
          } else { setTimeout(function() { warn.remove(); }, 1200); }
        },
        milestone: function() {
          var tag = document.createElement('div');
          tag.textContent = '\u25C9\u25C9\u25C9 TROPHY CLAIMED';
          tag.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#ef4444;font-family:monospace;font-size:16px;letter-spacing:4px;z-index:9999;pointer-events:none;opacity:0;text-shadow:0 0 15px rgba(239,68,68,0.5);';
          document.body.appendChild(tag);
          if (typeof anime !== 'undefined') {
            anime({ targets: tag, opacity: [0, 1, 1, 0], duration: 2000, easing: 'easeInOutQuad', complete: function() { tag.remove(); } });
          } else { setTimeout(function() { tag.remove(); }, 2000); }
        },
        disconnect: function() {
          var countdown = document.createElement('div');
          countdown.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#ef4444;font-family:monospace;font-size:48px;z-index:9999;pointer-events:none;text-shadow:0 0 30px rgba(239,68,68,0.8);';
          document.body.appendChild(countdown);
          var n = 3;
          countdown.textContent = n;
          var tick = setInterval(function() {
            n--;
            if (n <= 0) {
              clearInterval(tick);
              countdown.textContent = '///';
              document.body.style.filter = 'brightness(0.2)';
              setTimeout(function() { countdown.remove(); }, 500);
            } else {
              countdown.textContent = n;
            }
          }, 700);
        },
        reconnect: function() {
          document.body.style.filter = '';
        }
      };
      return events[eventType] || null;
    }
  });
})();
