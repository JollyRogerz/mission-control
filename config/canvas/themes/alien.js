// Alien — "MU-TH-UR 6000"
(function () {
  'use strict';

  var _trackerAngle = 0;
  var _blips = [];
  var _flickerTimer = null;
  var _streams = null;
  var _decode = null;
  var _asciiGrid = null;  // dense character grid
  var _gridCols = 0;
  var _gridRows = 0;
  var _gridCellW = 10;
  var _gridCellH = 13;
  var ALIEN_CHARS = '.:|-=+*#@ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop0123456789<>[]{}()!?/\\~^';

  ThemeEngine.register('alien', {
    name: 'Alien',
    tagline: 'Crew Expendable',
    css: 'themes/alien.css',
    icon: '\u{1F47E}',
    colors: { primary: '#4ade80', accent: '#166534' },

    activate: function(mc, canvas, ctx) {
      _trackerAngle = 0;
      _blips = [];
      _scheduleFlicker();

      if (!canvas) return;

      // Build dense ASCII grid — every cell is a character
      _gridCols = Math.ceil(canvas.width / _gridCellW);
      _gridRows = Math.ceil(canvas.height / _gridCellH);
      _asciiGrid = [];
      for (var r = 0; r < _gridRows; r++) {
        var row = [];
        for (var c = 0; c < _gridCols; c++) {
          row.push({
            ch: ALIEN_CHARS[Math.floor(Math.random() * ALIEN_CHARS.length)],
            mutateTimer: Math.floor(Math.random() * 120),
            brightness: 0,  // current brightness 0-1 (fades over time)
          });
        }
        _asciiGrid.push(row);
      }

      // Text decode overlays
      if (typeof PretextEffects !== 'undefined') {
        _decode = new PretextEffects.TextDecode({
          messages: [
            'CREW EXPENDABLE', 'SPECIAL ORDER 937', 'NOSTROMO SYSTEMS',
            'MU-TH-UR 6000', 'XENOMORPH DETECTED', 'LIFE SIGNS ACTIVE',
            'CRYO LEVEL 3', 'AIRLOCK SEALED',
            'DISTANCE: 20 METERS', 'MULTIPLE CONTACTS', 'THEY\'RE IN THE WALLS',
          ],
          charset: ALIEN_CHARS,
          font: 'bold 10px monospace',
          color: 'rgba(74,222,128,0.3)',
          cycleFrames: 700,
        });
        _decode.init(canvas.width, canvas.height, 3);
      }
    },

    deactivate: function() {
      if (_flickerTimer) clearTimeout(_flickerTimer);
      _flickerTimer = null;
      _blips = [];
      _asciiGrid = null;
      _decode = null;
    },

    renderBackground: function(ctx, timestamp, w, h) {
      ctx.clearRect(0, 0, w, h);

      // --- Dense ASCII character grid with radar-sweep illumination ---
      if (_asciiGrid) {
        var sweepAngle = (timestamp / 2500) % (Math.PI * 2);
        var sweepCx = w * 0.5;
        var sweepCy = h * 0.5;

        ctx.font = '9px monospace';
        ctx.textAlign = 'center';

        for (var r = 0; r < _gridRows; r++) {
          for (var c = 0; c < _gridCols; c++) {
            var cell = _asciiGrid[r][c];
            var cx = c * _gridCellW + _gridCellW / 2;
            var cy = r * _gridCellH + _gridCellH / 2;

            // Mutate characters slowly
            cell.mutateTimer++;
            if (cell.mutateTimer > 100 + Math.random() * 80) {
              cell.ch = ALIEN_CHARS[Math.floor(Math.random() * ALIEN_CHARS.length)];
              cell.mutateTimer = 0;
            }

            // Calculate angle from center to this cell
            var dx = cx - sweepCx;
            var dy = cy - sweepCy;
            var cellAngle = Math.atan2(dy, dx);
            if (cellAngle < 0) cellAngle += Math.PI * 2;

            // How close is this cell's angle to the sweep line?
            var angleDiff = sweepAngle - cellAngle;
            if (angleDiff < 0) angleDiff += Math.PI * 2;
            if (angleDiff > Math.PI * 2) angleDiff -= Math.PI * 2;

            // Sweep trail — chars lit up within ~30 degrees behind the sweep
            if (angleDiff < 0.5) {
              cell.brightness = Math.max(cell.brightness, 0.6 - angleDiff * 1.0);
            }

            // Fade brightness over time
            cell.brightness *= 0.985;

            // Base ambient brightness (very dim)
            var alpha = 0.025 + cell.brightness * 0.4;
            if (alpha < 0.03) continue;  // skip invisible chars for perf

            // Green phosphor — bright heads, dim tails
            var green = Math.floor(120 + cell.brightness * 135);
            ctx.fillStyle = 'rgba(0,' + green + ',60,' + alpha.toFixed(3) + ')';
            ctx.fillText(cell.ch, cx, cy);
          }
        }
        ctx.textAlign = 'start';
      }

      // Text decode overlays
      if (_decode) _decode.render(ctx, w, h);
    },

    // === FOREGROUND — renders ON TOP of all panels ===
    renderForeground: function(ctx, timestamp, w, h) {
      ctx.clearRect(0, 0, w, h);

      // --- Motion tracker (bottom-right, visible on all pages) ---
      var trackerR = 55;
      var tcx = w - trackerR - 18;
      var tcy = h - trackerR - 18;

      // Tracker background glow
      var tGlow = ctx.createRadialGradient(tcx, tcy, 0, tcx, tcy, trackerR * 1.2);
      tGlow.addColorStop(0, 'rgba(74,222,128,0.03)');
      tGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = tGlow;
      ctx.fillRect(tcx - trackerR * 1.2, tcy - trackerR * 1.2, trackerR * 2.4, trackerR * 2.4);

      // Concentric rings
      ctx.strokeStyle = 'rgba(74,222,128,0.12)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.arc(tcx, tcy, trackerR, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(tcx, tcy, trackerR * 0.66, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(tcx, tcy, trackerR * 0.33, 0, Math.PI * 2); ctx.stroke();
      // Crosshairs
      ctx.beginPath(); ctx.moveTo(tcx - trackerR, tcy); ctx.lineTo(tcx + trackerR, tcy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tcx, tcy - trackerR); ctx.lineTo(tcx, tcy + trackerR); ctx.stroke();

      // Sweep line with trail
      _trackerAngle = (timestamp / 2500) % (Math.PI * 2);
      for (var i = 12; i >= 0; i--) {
        var a = _trackerAngle - i * 0.06;
        var alpha = i === 0 ? 0.5 : Math.max(0.02, 0.25 - i * 0.02);
        ctx.strokeStyle = 'rgba(74,222,128,' + alpha.toFixed(3) + ')';
        ctx.lineWidth = i === 0 ? 1.5 : 0.8;
        ctx.beginPath();
        ctx.moveTo(tcx, tcy);
        ctx.lineTo(tcx + Math.cos(a) * trackerR, tcy + Math.sin(a) * trackerR);
        ctx.stroke();
      }

      // Sweep glow wedge
      ctx.fillStyle = 'rgba(74,222,128,0.04)';
      ctx.beginPath();
      ctx.moveTo(tcx, tcy);
      ctx.arc(tcx, tcy, trackerR, _trackerAngle - 0.6, _trackerAngle);
      ctx.closePath();
      ctx.fill();

      // Blips
      _blips.forEach(function(b) {
        b.alpha *= 0.97;
        if (b.alpha < 0.05) return;
        ctx.fillStyle = 'rgba(74,222,128,' + b.alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(tcx + b.x, tcy + b.y, 2, 0, Math.PI * 2);
        ctx.fill();
        // Blip glow
        ctx.fillStyle = 'rgba(74,222,128,' + (b.alpha * 0.3).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(tcx + b.x, tcy + b.y, 5, 0, Math.PI * 2);
        ctx.fill();
      });
      _blips = _blips.filter(function(b) { return b.alpha >= 0.05; });

      // Tracker label
      ctx.font = '7px monospace';
      ctx.fillStyle = 'rgba(74,222,128,0.15)';
      ctx.textAlign = 'center';
      ctx.fillText('MOTION TRACKER', tcx, tcy + trackerR + 10);
      ctx.textAlign = 'start';

      // --- Subtle green scanline sweep (slow, top to bottom) ---
      var scanY = ((timestamp * 0.02) % (h + 40)) - 20;
      var scanGrad = ctx.createLinearGradient(0, scanY - 8, 0, scanY + 8);
      scanGrad.addColorStop(0, 'transparent');
      scanGrad.addColorStop(0.5, 'rgba(74,222,128,0.025)');
      scanGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, scanY - 8, w, 16);

      // --- Corner HUD brackets (Nostromo terminal frame) ---
      ctx.strokeStyle = 'rgba(74,222,128,0.1)';
      ctx.lineWidth = 1;
      var bL = 20; // bracket length
      // Top-left
      ctx.beginPath(); ctx.moveTo(8, 8 + bL); ctx.lineTo(8, 8); ctx.lineTo(8 + bL, 8); ctx.stroke();
      // Top-right
      ctx.beginPath(); ctx.moveTo(w - 8 - bL, 8); ctx.lineTo(w - 8, 8); ctx.lineTo(w - 8, 8 + bL); ctx.stroke();
      // Bottom-left
      ctx.beginPath(); ctx.moveTo(8, h - 8 - bL); ctx.lineTo(8, h - 8); ctx.lineTo(8 + bL, h - 8); ctx.stroke();
      // Bottom-right
      ctx.beginPath(); ctx.moveTo(w - 8 - bL, h - 8); ctx.lineTo(w - 8, h - 8); ctx.lineTo(w - 8, h - 8 - bL); ctx.stroke();

      // --- Subtle system status text (top-left) ---
      ctx.font = '8px monospace';
      ctx.fillStyle = 'rgba(74,222,128,' + (0.08 + Math.sin(timestamp * 0.002) * 0.03).toFixed(3) + ')';
      ctx.fillText('MU-TH-UR 6000 INTERFACE', 14, 22);
      ctx.fillText('NOSTROMO 180286', 14, 32);

      // Status readout (bottom-left)
      ctx.fillStyle = 'rgba(74,222,128,0.07)';
      ctx.fillText('SYS: NOMINAL', 14, h - 24);
      ctx.fillText('LIFE SIGNS: ' + (4 + _blips.length), 14, h - 14);

      // --- Sparse noise (ambient texture) ---
      for (var ni = 0; ni < 4; ni++) {
        ctx.fillStyle = 'rgba(74,222,128,' + (0.01 + Math.random() * 0.02).toFixed(3) + ')';
        ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1);
      }
    },

    onAgentStateChange: function(agent, state) {
      if (state !== 'idle') {
        var angle = Math.random() * Math.PI * 2;
        var dist = Math.random() * 50;
        _blips.push({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, alpha: 0.9 });
      }
    },

    getSoundProfile: function() {
      return {
        oscillatorType: 'sine', filterType: 'lowpass', filterFrequency: 600, reverbDuration: 0.8,
        ambientDrone: { enabled: false },
        events: {
          spawn: { notes: [1], duration: 0.5, attack: 0.1 },
          despawn: { notes: [0.8], duration: 0.6, attack: 0.1 },
          taskComplete: { notes: [1, 1.1], duration: 0.3, attack: 0.05 },
          error: { notes: [1, 0.9, 1, 0.9], duration: 0.2, attack: 0.01 }
        },
        customSounds: {
          spawn: function(ctx, baseFreq, agentId) {
            try {
              var gain = ctx.createGain();
              gain.connect(ctx.destination);
              gain.gain.setValueAtTime(0, ctx.currentTime);
              gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.002);
              gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
              var osc = ctx.createOscillator();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(1200, ctx.currentTime);
              osc.connect(gain);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.5);
            } catch(e) {}
          },
          error: function(ctx, baseFreq, agentId) {
            try {
              var gain = ctx.createGain();
              gain.connect(ctx.destination);
              gain.gain.setValueAtTime(0, ctx.currentTime);
              var t = ctx.currentTime;
              var schedule = [
                [t, t + 0.12],
                [t + 0.14, t + 0.26],
                [t + 0.3, t + 0.42],
                [t + 0.44, t + 0.56]
              ];
              for (var i = 0; i < schedule.length; i++) {
                var start = schedule[i][0];
                var end = schedule[i][1];
                var freq = (i % 2 === 0) ? 400 : 600;
                gain.gain.setValueAtTime(0.05, start);
                gain.gain.setValueAtTime(0, end);
                var osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, start);
                osc.connect(gain);
                osc.start(start);
                osc.stop(end + 0.01);
              }
            } catch(e) {}
          },
          chatSend: function(ctx, baseFreq, agentId) {
            try {
              var bufSize = Math.floor(ctx.sampleRate * 0.03);
              var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
              var data = buf.getChannelData(0);
              for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
              var bp = ctx.createBiquadFilter();
              bp.type = 'bandpass';
              bp.frequency.setValueAtTime(1500, ctx.currentTime);
              bp.Q.setValueAtTime(8, ctx.currentTime);
              var gain = ctx.createGain();
              gain.gain.setValueAtTime(0.04, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03);
              gain.connect(ctx.destination);
              bp.connect(gain);
              var src = ctx.createBufferSource();
              src.buffer = buf;
              src.connect(bp);
              src.start(ctx.currentTime);
            } catch(e) {}
          },
          chatReceive: function(ctx, baseFreq, agentId) {
            try {
              var gain = ctx.createGain();
              gain.connect(ctx.destination);
              gain.gain.setValueAtTime(0, ctx.currentTime);
              gain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.05);
              gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
              var osc = ctx.createOscillator();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(880, ctx.currentTime);
              osc.connect(gain);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.35);
            } catch(e) {}
          },
          navWhoosh: function(ctx, baseFreq, agentId) {
            try {
              var bufSize = Math.floor(ctx.sampleRate * 0.2);
              var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
              var data = buf.getChannelData(0);
              for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
              var lp = ctx.createBiquadFilter();
              lp.type = 'lowpass';
              lp.frequency.setValueAtTime(3000, ctx.currentTime);
              lp.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.2);
              var gain = ctx.createGain();
              gain.gain.setValueAtTime(0.05, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
              gain.connect(ctx.destination);
              lp.connect(gain);
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
              var curve = new Float32Array(256);
              for (var k = 0; k < 256; k++) {
                var x = (k * 2) / 256 - 1;
                curve[k] = x + 0.02 * Math.sin(x * 20);
              }
              for (var i = 0; i < notes.length; i++) {
                (function(noteFreq, offset) {
                  try {
                    var ws = ctx.createWaveShaper();
                    ws.curve = curve;
                    var gain = ctx.createGain();
                    gain.connect(ctx.destination);
                    gain.gain.setValueAtTime(0.04, ctx.currentTime + offset);
                    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.25);
                    ws.connect(gain);
                    var osc = ctx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(noteFreq, ctx.currentTime + offset);
                    osc.connect(ws);
                    osc.start(ctx.currentTime + offset);
                    osc.stop(ctx.currentTime + offset + 0.25);
                  } catch(e) {}
                })(notes[i], i * 0.12);
              }
            } catch(e) {}
          }
        }
      };
    },

    getTransitionEffect: function() { return 'crt-static'; },

    getVocabulary: function() {
      return {
        getAgentLabel: function(agent, index) {
          var labels = ['ORCHESTRATOR', 'BUILDER', 'ARCHITECT', 'SOCIAL'];
          return labels[index] !== undefined ? labels[index] : 'AGENT-' + String(index + 1).padStart(2, '0');
        },
        stateLabels: {
          idle: 'LIFE SIGNS: CRYO',
          thinking: 'LIFE SIGNS: ACTIVE',
          tool_running: 'LIFE SIGNS: ACTIVE',
          reading: 'LIFE SIGNS: ACTIVE',
          writing: 'LIFE SIGNS: ACTIVE',
          dispatching: 'LIFE SIGNS: ACTIVE',
          speaking: 'LIFE SIGNS: ACTIVE',
          error: 'LIFE SIGNS: WARNING',
          starting: 'LIFE SIGNS: WAKING',
          stopping: 'LIFE SIGNS: CRYO',
          completed: 'LIFE SIGNS: ACTIVE',
        },
        detailLabels: {
          'State': 'LIFE SIGNS',
          'Model': 'SYSTEM',
          'Tool': 'FUNCTION',
          'Tokens': 'DATA',
          'Uptime': 'ACTIVE',
          'Last seen': 'LAST SCAN',
          'Errors': 'WARNINGS',
        },
        toolLabel: function(toolName) {
          return toolName ? toolName.toUpperCase() : 'STANDBY';
        }
      };
    },

    getCinematicEvent: function(eventType) {
      var events = {
        spawn: function() {
          for (var i = 0; i < 5; i++) {
            var angle = Math.random() * Math.PI * 2;
            var dist = Math.random() * 50;
            _blips.push({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, alpha: 1 });
          }
          document.body.style.filter = 'brightness(1.3) contrast(1.1)';
          setTimeout(function() { document.body.style.filter = ''; }, 100);
        },
        error: function() {
          var warn = document.createElement('div');
          warn.innerHTML = '<span style="font-size:24px">\u26A0 DANGER \u26A0</span><br><span style="font-size:12px">INTERFACE 2037 \u2014 ALERT CONDITION</span>';
          warn.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#f59e0b;font-family:monospace;text-align:center;z-index:9999;pointer-events:none;text-shadow:0 0 15px rgba(245,158,11,0.5);';
          document.body.appendChild(warn);
          if (typeof anime !== 'undefined') {
            anime({ targets: warn, opacity: [1, 0], duration: 1500, easing: 'easeInQuad', complete: function() { warn.remove(); } });
          } else { setTimeout(function() { warn.remove(); }, 1500); }
        },
        milestone: function() {
          var tag = document.createElement('div');
          tag.textContent = 'MISSION COMPLETE \u2014 RETURN TO CRYO';
          tag.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#4ade80;font-family:monospace;font-size:14px;letter-spacing:3px;z-index:9999;pointer-events:none;opacity:0;text-shadow:0 0 15px rgba(74,222,128,0.4);';
          document.body.appendChild(tag);
          if (typeof anime !== 'undefined') {
            anime({ targets: tag, opacity: [0, 0.8, 0.8, 0], duration: 2000, easing: 'easeInOutQuad', complete: function() { tag.remove(); } });
          } else { setTimeout(function() { tag.remove(); }, 2000); }
        },
        disconnect: function() {
          document.body.style.transition = 'filter 0.3s';
          document.body.style.filter = 'brightness(0.15) sepia(0.5) hue-rotate(-30deg)';
        },
        reconnect: function() {
          document.body.style.filter = '';
          setTimeout(function() { document.body.style.transition = ''; }, 400);
        }
      };
      return events[eventType] || null;
    }
  });

  function _scheduleFlicker() {
    var delay = 10000 + Math.random() * 15000;
    _flickerTimer = setTimeout(function() {
      document.body.style.opacity = '0.94';
      setTimeout(function() { document.body.style.opacity = ''; _scheduleFlicker(); }, 60);
    }, delay);
  }
})();
