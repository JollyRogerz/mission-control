'use strict';

// ---------------------------------------------------------------------------
// PretextEffects.js — Shared canvas text effect primitives using pretext
// ---------------------------------------------------------------------------
// Provides reusable building blocks for all theme backgrounds:
//   - CharacterRain: vertical falling character columns (Matrix-style)
//   - SpiralVortex: rotating circular text pattern (EVA-style)
//   - DataStream: horizontal flowing text streams (GITS-style)
//   - TextDecode: scramble-to-reveal text animation
//   - CharacterGrid: dense ASCII grid with brightness mapping
//
// All effects use pretext for pixel-perfect text measurement when available,
// falling back to canvas measureText when pretext isn't loaded yet.
// ---------------------------------------------------------------------------

var PretextEffects = (function () {

  // ---- Character sets -------------------------------------------------------
  var KATAKANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
  var LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var DIGITS = '0123456789';
  var SYMBOLS = '.:*+=$#@!<>{}[]|/\\~^';
  var BLOCKS = '█▓▒░▄▀■□▪▫';
  var CJK = '無限協議通信接続解析';
  var ARABIC = 'غفعهخحجدشسيبلتنمكطذ';
  var BRAILLE = '⠁⠃⠇⠏⠟⠿⡿⣿';

  var CHARSETS = {
    matrix: KATAKANA + LATIN + DIGITS + SYMBOLS,
    gits: CJK + KATAKANA + LATIN + DIGITS,
    eva: BLOCKS + DIGITS + LATIN + SYMBOLS,
    alien: LATIN + DIGITS + '.:|-=+',
    bebop: LATIN + DIGITS + '♪♫♬♩~*·',
    predator: BLOCKS + BRAILLE + DIGITS,
  };

  function randChar(charset) {
    return charset[Math.floor(Math.random() * charset.length)];
  }

  // ---- Shared text measurement cache ----------------------------------------
  var _charWidthCache = {};

  function measureChar(ctx, ch, font) {
    var key = font + '|' + ch;
    if (_charWidthCache[key] !== undefined) return _charWidthCache[key];
    ctx.font = font;
    var w = ctx.measureText(ch).width;
    _charWidthCache[key] = w;
    return w;
  }

  // ---- 1. CharacterRain — vertical falling columns --------------------------

  function CharacterRain(opts) {
    this.colCount = opts.colCount || 40;
    this.tailLen = opts.tailLen || 28;
    this.charset = opts.charset || CHARSETS.matrix;
    this.font = opts.font || '14px monospace';
    this.lineH = opts.lineHeight || 16;
    this.headColor = opts.headColor || 'rgba(220,255,220,0.95)';
    this.bodyColor = opts.bodyColor || function (i, tailLen, brightness) {
      var alpha = Math.max(0.02, (0.8 * brightness) - i * (0.8 / tailLen));
      var green = Math.max(20, Math.floor(255 * brightness) - i * 7);
      return 'rgba(0,' + green + ',65,' + alpha + ')';
    };
    this.glowColor = opts.glowColor || 'rgba(0,255,65,0.6)';
    this.fadeAlpha = opts.fadeAlpha || 0.10;
    this.fadeBg = opts.fadeBg || 'rgba(0,8,0,0.10)';
    this.columns = [];
  }

  CharacterRain.prototype.init = function (w, h) {
    this.columns = [];
    var colW = Math.floor(w / this.colCount);
    for (var i = 0; i < this.colCount; i++) {
      var chars = [];
      for (var j = 0; j < this.tailLen; j++) chars.push(randChar(this.charset));
      this.columns.push({
        x: i * colW + colW / 2,
        y: Math.random() * -h,
        speed: 1.2 + Math.random() * 3.5,
        chars: chars,
        cycleTimer: 0,
        brightness: 0.6 + Math.random() * 0.4,
      });
    }
  };

  CharacterRain.prototype.render = function (ctx, w, h) {
    ctx.fillStyle = this.fadeBg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = this.font;
    ctx.textAlign = 'center';
    var self = this;

    this.columns.forEach(function (col) {
      col.y += col.speed;
      if (col.y > h + self.tailLen * self.lineH) {
        col.y = Math.random() * -300;
        col.speed = 1.2 + Math.random() * 3.5;
        col.brightness = 0.6 + Math.random() * 0.4;
      }
      col.cycleTimer++;
      if (col.cycleTimer > 2) {
        col.cycleTimer = 0;
        var mutations = 1 + Math.floor(Math.random() * 2);
        for (var m = 0; m < mutations; m++) {
          var idx = Math.floor(Math.random() * col.chars.length);
          col.chars[idx] = randChar(self.charset);
        }
      }
      col.chars.forEach(function (ch, i) {
        var cy = Math.floor(col.y) - i * self.lineH;
        if (cy < -self.lineH || cy > h + self.lineH) return;
        if (i === 0) {
          ctx.fillStyle = self.headColor;
          ctx.shadowColor = self.glowColor;
          ctx.shadowBlur = 8;
        } else if (i === 1) {
          ctx.fillStyle = self.headColor.replace('0.95', '0.7');
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = typeof self.bodyColor === 'function'
            ? self.bodyColor(i, self.tailLen, col.brightness)
            : self.bodyColor;
          ctx.shadowBlur = 0;
        }
        ctx.fillText(ch, col.x, cy);
      });
      ctx.shadowBlur = 0;
    });
    ctx.textAlign = 'start';
  };

  // ---- 2. SpiralVortex — rotating character ring ----------------------------

  function SpiralVortex(opts) {
    this.charset = opts.charset || CHARSETS.eva;
    this.font = opts.font || '12px monospace';
    this.ringCount = opts.ringCount || 8;
    this.charsPerRing = opts.charsPerRing || 40;
    this.color = opts.color || function (ring, maxRings, angle) {
      var alpha = 0.15 + (ring / maxRings) * 0.5;
      return 'rgba(139,92,246,' + alpha.toFixed(3) + ')';
    };
    this.glowColor = opts.glowColor || 'rgba(139,92,246,0.3)';
    this.speed = opts.speed || 0.0005;
    this.chars = [];
  }

  SpiralVortex.prototype.init = function (w, h) {
    this.chars = [];
    for (var r = 0; r < this.ringCount; r++) {
      var ring = [];
      var charCount = this.charsPerRing + r * 8;
      for (var c = 0; c < charCount; c++) {
        ring.push({
          ch: randChar(this.charset),
          mutateTimer: Math.floor(Math.random() * 60),
        });
      }
      this.chars.push(ring);
    }
  };

  SpiralVortex.prototype.render = function (ctx, timestamp, w, h) {
    var cx = w / 2;
    var cy = h / 2;
    var maxR = Math.min(w, h) * 0.42;
    ctx.font = this.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var r = 0; r < this.chars.length; r++) {
      var ring = this.chars[r];
      var radius = (maxR * (r + 1)) / this.ringCount;
      var rotSpeed = this.speed * (r % 2 === 0 ? 1 : -1) * (1 + r * 0.15);
      var baseAngle = timestamp * rotSpeed;

      for (var c = 0; c < ring.length; c++) {
        var entry = ring[c];
        entry.mutateTimer++;
        if (entry.mutateTimer > 40 + Math.random() * 40) {
          entry.ch = randChar(this.charset);
          entry.mutateTimer = 0;
        }

        var angle = baseAngle + (c / ring.length) * Math.PI * 2;
        var x = cx + Math.cos(angle) * radius;
        var y = cy + Math.sin(angle) * radius;

        if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;

        ctx.fillStyle = typeof this.color === 'function'
          ? this.color(r, this.ringCount, angle)
          : this.color;
        ctx.fillText(entry.ch, x, y);
      }
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  };

  // ---- 3. DataStream — horizontal flowing text streams ----------------------

  function DataStream(opts) {
    this.streamCount = opts.streamCount || 20;
    this.charset = opts.charset || CHARSETS.gits;
    this.font = opts.font || '11px monospace';
    this.charW = opts.charWidth || 9;
    this.color = opts.color || function (stream, i, total) {
      var alpha = 0.08 + (1 - Math.abs(i - total / 2) / (total / 2)) * 0.35;
      return 'rgba(6,182,212,' + alpha.toFixed(3) + ')';
    };
    this.speed = opts.speed || 1;
    this.streams = [];
  }

  DataStream.prototype.init = function (w, h) {
    this.streams = [];
    var rowH = h / this.streamCount;
    for (var i = 0; i < this.streamCount; i++) {
      var len = 30 + Math.floor(Math.random() * 60);
      var chars = [];
      for (var c = 0; c < len; c++) chars.push(randChar(this.charset));
      this.streams.push({
        y: i * rowH + rowH / 2,
        x: Math.random() * w,
        speed: (0.5 + Math.random() * 2) * this.speed,
        chars: chars,
        len: len,
        direction: Math.random() > 0.3 ? 1 : -1,
        mutateTimer: 0,
      });
    }
  };

  DataStream.prototype.render = function (ctx, w, h) {
    ctx.font = this.font;
    ctx.textAlign = 'start';
    var self = this;

    this.streams.forEach(function (stream, si) {
      stream.x += stream.speed * stream.direction;
      if (stream.direction > 0 && stream.x > w + stream.len * self.charW) {
        stream.x = -stream.len * self.charW;
      } else if (stream.direction < 0 && stream.x < -stream.len * self.charW) {
        stream.x = w;
      }
      stream.mutateTimer++;
      if (stream.mutateTimer > 3) {
        stream.mutateTimer = 0;
        var idx = Math.floor(Math.random() * stream.chars.length);
        stream.chars[idx] = randChar(self.charset);
      }

      for (var c = 0; c < stream.chars.length; c++) {
        var cx = stream.x + c * self.charW;
        if (cx < -self.charW || cx > w + self.charW) continue;

        // Fade at edges
        var edgeFade = 1;
        if (c < 5) edgeFade = c / 5;
        else if (c > stream.chars.length - 5) edgeFade = (stream.chars.length - c) / 5;

        ctx.fillStyle = typeof self.color === 'function'
          ? self.color(stream, si, self.streamCount)
          : self.color;
        ctx.globalAlpha = edgeFade;
        ctx.fillText(stream.chars[c], cx, stream.y);
      }
      ctx.globalAlpha = 1;
    });
  };

  // ---- 4. TextDecode — scramble-to-reveal text animation --------------------

  function TextDecode(opts) {
    this.messages = opts.messages || ['SYSTEM ONLINE'];
    this.charset = opts.charset || KATAKANA + DIGITS;
    this.font = opts.font || 'bold 12px monospace';
    this.color = opts.color || 'rgba(0,255,65,0.35)';
    this.scrambleColor = opts.scrambleColor || null; // defaults to color at 50% alpha
    this.cycleFrames = opts.cycleFrames || 800;
    this.decodeSpeed = opts.decodeSpeed || 8; // chars decoded per frame
    this.instances = [];
  }

  TextDecode.prototype.init = function (w, h, count) {
    this.instances = [];
    count = count || 3;
    for (var i = 0; i < count; i++) {
      this.instances.push({
        text: this.messages[Math.floor(Math.random() * this.messages.length)],
        x: 50 + Math.random() * (w - 250),
        y: 50 + Math.random() * (h - 100),
        timer: Math.floor(Math.random() * this.cycleFrames),
        revealed: 0,
        alpha: 0,
        fadeIn: true,
      });
    }
  };

  TextDecode.prototype.render = function (ctx, w, h) {
    var self = this;
    ctx.font = this.font;
    ctx.textAlign = 'start';

    this.instances.forEach(function (inst) {
      inst.timer++;

      // Cycle to new message
      if (inst.timer > self.cycleFrames) {
        inst.timer = 0;
        inst.text = self.messages[Math.floor(Math.random() * self.messages.length)];
        inst.x = 50 + Math.random() * (w - 250);
        inst.y = 50 + Math.random() * (h - 100);
        inst.alpha = 0;
        inst.fadeIn = true;
        inst.revealed = 0;
      }

      // Fade in/out
      if (inst.fadeIn) {
        inst.alpha = Math.min(inst.alpha + 0.008, 0.4);
        if (inst.alpha >= 0.4) inst.fadeIn = false;
      } else if (inst.timer > self.cycleFrames * 0.75) {
        inst.alpha = Math.max(inst.alpha - 0.005, 0);
      }
      if (inst.alpha <= 0) return;

      // Decode progress
      inst.revealed = Math.min(inst.text.length, inst.revealed + 0.15);

      var chars = inst.text.split('');
      var xPos = inst.x;
      for (var ci = 0; ci < chars.length; ci++) {
        var isRevealed = ci < Math.floor(inst.revealed);
        var displayChar = isRevealed ? chars[ci] : randChar(self.charset);
        var charAlpha = isRevealed ? inst.alpha : inst.alpha * 0.4;

        ctx.globalAlpha = charAlpha;
        ctx.fillStyle = self.color;
        ctx.fillText(displayChar, xPos, inst.y);
        xPos += 8;
      }
      ctx.globalAlpha = 1;
    });
  };

  // ---- 5. CharacterGrid — dense ASCII field with brightness mapping ---------

  function CharacterGrid(opts) {
    this.charset = opts.charset || BLOCKS + DIGITS;
    this.font = opts.font || '10px monospace';
    this.cellW = opts.cellWidth || 12;
    this.cellH = opts.cellHeight || 14;
    this.color = opts.color || 'rgba(100,200,255,0.15)';
    this.waveSpeed = opts.waveSpeed || 0.002;
    this.grid = [];
    this.cols = 0;
    this.rows = 0;
  }

  CharacterGrid.prototype.init = function (w, h) {
    this.cols = Math.ceil(w / this.cellW);
    this.rows = Math.ceil(h / this.cellH);
    this.grid = [];
    for (var r = 0; r < this.rows; r++) {
      var row = [];
      for (var c = 0; c < this.cols; c++) {
        row.push({
          ch: randChar(this.charset),
          mutateTimer: Math.floor(Math.random() * 100),
        });
      }
      this.grid.push(row);
    }
  };

  CharacterGrid.prototype.render = function (ctx, timestamp, w, h) {
    ctx.font = this.font;
    ctx.textAlign = 'center';

    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        var cell = this.grid[r][c];
        cell.mutateTimer++;
        if (cell.mutateTimer > 80 + Math.random() * 60) {
          cell.ch = randChar(this.charset);
          cell.mutateTimer = 0;
        }

        // Wave-based brightness
        var wave = Math.sin(timestamp * this.waveSpeed + c * 0.3 + r * 0.2);
        var alpha = 0.03 + (wave + 1) * 0.06;

        ctx.fillStyle = this.color.replace(/[\d.]+\)$/, alpha.toFixed(3) + ')');
        ctx.fillText(cell.ch, c * this.cellW + this.cellW / 2, r * this.cellH + this.cellH);
      }
    }
    ctx.textAlign = 'start';
  };

  // ---- Public API -----------------------------------------------------------
  return {
    CHARSETS: CHARSETS,
    CharacterRain: CharacterRain,
    SpiralVortex: SpiralVortex,
    DataStream: DataStream,
    TextDecode: TextDecode,
    CharacterGrid: CharacterGrid,
    randChar: randChar,
  };

})();
