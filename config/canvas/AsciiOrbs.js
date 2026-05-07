'use strict';

// ---------------------------------------------------------------------------
// AsciiOrbs.js — Morphing ASCII orb entities replacing pixel sprites
// ---------------------------------------------------------------------------
// Sprites are hidden via CSS. Each agent gets a unique orb with:
//   - Theme-inspired color palette (not hardcoded agent colors)
//   - Agent-specific character behavior
//   - State-reactive breathing, morphing, and jitter
// ---------------------------------------------------------------------------

// Hide all pixel sprites globally — orbs replace them
(function() {
  var style = document.createElement('style');
  style.textContent = [
    '.agent-sprite, .desk-sprite, .monitor-sprite, .monitor-screen { display: none !important; }',
    '.agent-sprite-container { min-height: 100px; }',
  ].join('\n');
  document.head.appendChild(style);
})();

// Theme-aware color palettes — each agent gets a distinct color PER theme.
// Keys must cover every agent.id returned from /api/agents (post _getAgentShort
// stripping). Currently: orchestrator, builder, architect, social, discord,
// assistant, researcher.
var ORB_PALETTES = {
  bebop: {
    orchestrator: { r: 217, g: 160, b: 60 },   // warm gold
    builder:      { r: 200, g: 100, b: 50 },   // copper
    architect:    { r: 180, g: 140, b: 90 },   // brass
    social:       { r: 230, g: 180, b: 80 },   // bright amber
    discord:      { r: 220, g: 80,  b: 50 },   // rust orange
    assistant:    { r: 244, g: 211, b: 94 },   // mustard
    researcher:   { r: 168, g: 50,  b: 50 },   // maroon
  },
  matrix: {
    orchestrator: { r: 0,   g: 255, b: 65 },   // bright matrix green
    builder:      { r: 0,   g: 200, b: 50 },   // darker green
    architect:    { r: 100, g: 255, b: 140 },  // mint green
    social:       { r: 0,   g: 180, b: 80 },   // forest green
    discord:      { r: 50,  g: 220, b: 100 },  // lime
    assistant:    { r: 200, g: 255, b: 200 },  // pale phosphor
    researcher:   { r: 60,  g: 160, b: 60 },   // deep green
  },
  eva: {
    orchestrator: { r: 168, g: 85,  b: 247 },  // EVA-01 purple
    builder:      { r: 74,  g: 222, b: 128 },  // EVA-01 green
    architect:    { r: 124, g: 58,  b: 237 },  // deep purple
    social:       { r: 110, g: 231, b: 160 },  // neon green
    discord:      { r: 88,  g: 101, b: 242 },  // discord blue
    assistant:    { r: 250, g: 204, b: 21 },   // hazard yellow
    researcher:   { r: 236, g: 72,  b: 153 },  // pink
  },
  gits: {
    orchestrator: { r: 6,   g: 182, b: 212 },  // cyan
    builder:      { r: 103, g: 232, b: 249 },  // light cyan
    architect:    { r: 20,  g: 140, b: 180 },  // deep teal
    social:       { r: 80,  g: 200, b: 220 },  // aqua
    discord:      { r: 56,  g: 189, b: 248 },  // sky blue
    assistant:    { r: 165, g: 243, b: 252 },  // ice
    researcher:   { r: 14,  g: 116, b: 144 },  // dark cyan
  },
  alien: {
    orchestrator: { r: 74,  g: 222, b: 128 },  // phosphor green
    builder:      { r: 60,  g: 180, b: 100 },  // dark green
    architect:    { r: 100, g: 240, b: 150 },  // bright green
    social:       { r: 50,  g: 160, b: 90 },   // deep green
    discord:      { r: 132, g: 204, b: 22 },   // olive green
    assistant:    { r: 190, g: 242, b: 100 },  // yellow-green
    researcher:   { r: 22,  g: 163, b: 74 },   // forest
  },
  predator: {
    orchestrator: { r: 239, g: 68,  b: 68 },   // thermal red
    builder:      { r: 250, g: 180, b: 50 },   // thermal yellow
    architect:    { r: 200, g: 50,  b: 50 },   // deep red
    social:       { r: 255, g: 140, b: 60 },   // thermal orange
    discord:      { r: 248, g: 113, b: 113 },  // pink-red
    assistant:    { r: 254, g: 240, b: 138 },  // hot yellow
    researcher:   { r: 153, g: 27,  b: 27 },   // dark red
  },
};

function _getAgentShort(agentId) {
  // Strip common prefixes/suffixes to derive a short CSS-safe key from any agent ID
  return (agentId || '').replace(/^[a-z]+-/, '').replace(/-media$/, '');
}

Object.assign(MissionControl.prototype, {

  initAsciiOrbs() {
    this._orbCanvases = new Map();
    this._orbFrameId = null;
    this._orbCharset = '●○◉◎⊙⊛⊚⊕⊗☉∘∙·⚬◌◍◐◑◒◓';
    this._orbEnabled = false;
    this._orbThemeId = 'bebop';
  },

  enableAsciiOrbs(charset, themeId) {
    if (charset) this._orbCharset = charset;
    if (themeId) this._orbThemeId = themeId;
    this._orbEnabled = true;

    var self = this;

    // Find all sprite containers and overlay a canvas
    document.querySelectorAll('.agent-sprite-container').forEach(function(container) {
      var agentId = container.dataset.agent || '';
      if (self._orbCanvases.has(container)) return;

      var canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 120;
      canvas.style.cssText = 'position:absolute;top:0;left:0;width:96px;height:120px;z-index:10;pointer-events:none;';
      container.style.position = 'relative';
      container.appendChild(canvas);

      self._orbCanvases.set(container, {
        canvas: canvas,
        ctx: canvas.getContext('2d'),
        agentId: agentId,
        phase: Math.random() * Math.PI * 2,
        chars: self._generateOrbChars(12),
      });
    });

    // Team card sprites
    document.querySelectorAll('.team-card-sprite-wrap').forEach(function(wrap) {
      if (self._orbCanvases.has(wrap)) return;
      var canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 56;
      canvas.style.cssText = 'position:absolute;top:0;left:0;width:48px;height:56px;z-index:10;pointer-events:none;';
      wrap.style.position = 'relative';
      wrap.appendChild(canvas);
      // Try to find agent id from parent card
      var card = wrap.closest('.team-card');
      var agentId = card ? (card.id || '').replace('team-card-', '') : '';
      self._orbCanvases.set(wrap, {
        canvas: canvas,
        ctx: canvas.getContext('2d'),
        agentId: agentId,
        phase: Math.random() * Math.PI * 2,
        chars: self._generateOrbChars(6),
        small: true,
      });
    });

    // Chat sprite areas
    document.querySelectorAll('.chat-agent-sprite-area').forEach(function(area) {
      if (self._orbCanvases.has(area)) return;
      var canvas = document.createElement('canvas');
      canvas.width = 40;
      canvas.height = 48;
      canvas.style.cssText = 'position:absolute;top:0;left:0;width:40px;height:48px;z-index:10;pointer-events:none;';
      area.appendChild(canvas);
      self._orbCanvases.set(area, {
        canvas: canvas,
        ctx: canvas.getContext('2d'),
        agentId: '',
        phase: Math.random() * Math.PI * 2,
        chars: self._generateOrbChars(8),
        small: true,
      });
    });

    if (!this._orbFrameId) this._renderOrbs();
  },

  disableAsciiOrbs() {
    this._orbEnabled = false;
    if (this._orbFrameId) {
      cancelAnimationFrame(this._orbFrameId);
      this._orbFrameId = null;
    }
    this._orbCanvases.forEach(function(data) {
      if (data.canvas.parentElement) data.canvas.remove();
    });
    this._orbCanvases.clear();
  },

  _generateOrbChars(ringCount) {
    var chars = [];
    for (var r = 0; r < ringCount; r++) {
      var ring = [];
      var count = 6 + r * 4;
      for (var i = 0; i < count; i++) {
        ring.push({
          ch: this._orbCharset[Math.floor(Math.random() * this._orbCharset.length)],
          offset: Math.random() * 0.3 - 0.15,
          speed: 0.8 + Math.random() * 0.4,
        });
      }
      chars.push(ring);
    }
    return chars;
  },

  _getOrbColor(agentId) {
    var palette = ORB_PALETTES[this._orbThemeId] || ORB_PALETTES.bebop;
    var short = _getAgentShort(agentId);
    return palette[short] || palette.orchestrator;
  },

  _renderOrbs() {
    var self = this;
    if (!this._orbEnabled) return;

    var now = performance.now();

    this._orbCanvases.forEach(function(data) {
      var ctx = data.ctx;
      var w = data.canvas.width;
      var h = data.canvas.height;
      var cx = w / 2;
      var cy = h / 2 - (data.small ? 0 : 10);
      var isSmall = data.small;

      ctx.clearRect(0, 0, w, h);

      var agentState = self.agents[data.agentId];
      var currentState = agentState ? agentState.state : 'idle';

      var breathSpeed, breathAmp, morphRate, jitter;
      switch (currentState) {
        case 'thinking': case 'tool_running': case 'reading': case 'writing':
          breathSpeed = 3; breathAmp = 4; morphRate = 0.08; jitter = 2; break;
        case 'error':
          breathSpeed = 8; breathAmp = 6; morphRate = 0.2; jitter = 5; break;
        case 'speaking': case 'dispatching':
          breathSpeed = 2; breathAmp = 3; morphRate = 0.05; jitter = 1; break;
        default:
          breathSpeed = 0.8; breathAmp = 2; morphRate = 0.02; jitter = 0;
      }

      data.phase += 0.016 * breathSpeed;

      var baseR = isSmall ? 12 : 28;
      var breathR = baseR + Math.sin(data.phase) * breathAmp;

      var col = self._getOrbColor(data.agentId);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (var ri = data.chars.length - 1; ri >= 0; ri--) {
        var ring = data.chars[ri];
        var ringR = (breathR * (ri + 1)) / data.chars.length;
        var ringAlpha = 0.15 + (ri / data.chars.length) * 0.6;
        var fontSize = isSmall ? 6 + ri * 0.3 : 7 + ri * 0.5;
        ctx.font = fontSize + 'px monospace';

        for (var ci = 0; ci < ring.length; ci++) {
          var entry = ring[ci];
          if (Math.random() < morphRate * 0.3) {
            entry.ch = self._orbCharset[Math.floor(Math.random() * self._orbCharset.length)];
          }

          var angle = (ci / ring.length) * Math.PI * 2 + now * 0.0003 * entry.speed * (ri % 2 === 0 ? 1 : -1);
          angle += entry.offset;

          var wobble = Math.sin(now * 0.001 + ri * 1.5 + ci * 0.7) * (1 + jitter * 0.5);
          var px = cx + Math.cos(angle) * (ringR + wobble);
          var py = cy + Math.sin(angle) * (ringR * 0.85 + wobble);

          var depthAlpha = ringAlpha * (0.7 + 0.3 * Math.sin(angle + data.phase));
          ctx.fillStyle = 'rgba(' + col.r + ',' + col.g + ',' + col.b + ',' + depthAlpha.toFixed(3) + ')';
          ctx.fillText(entry.ch, px, py);
        }
      }

      // Core glow
      var coreAlpha = 0.3 + Math.sin(data.phase * 1.5) * 0.15;
      ctx.font = (isSmall ? 10 : 16) + 'px monospace';
      ctx.fillStyle = 'rgba(' + Math.min(255, col.r + 80) + ',' + Math.min(255, col.g + 80) + ',' + Math.min(255, col.b + 80) + ',' + coreAlpha.toFixed(3) + ')';
      ctx.fillText('◉', cx, cy);

      // Glow halo
      var gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, breathR * 0.6);
      gradient.addColorStop(0, 'rgba(' + col.r + ',' + col.g + ',' + col.b + ',0.08)');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, breathR * 0.6, 0, Math.PI * 2);
      ctx.fill();
    });

    this._orbFrameId = requestAnimationFrame(function() { self._renderOrbs(); });
  },
});
