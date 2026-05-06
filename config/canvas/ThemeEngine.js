// ThemeEngine.js — Theme registration, switching, persistence
(function () {
  'use strict';

  const THEMES = {};          // registry: id → manifest+module
  let _activeThemeId = null;
  let _activeTheme = null;    // the active theme's module object
  let _bgCanvas = null;       // <canvas id="theme-bg-canvas">
  let _bgCtx = null;
  let _fgCanvas = null;       // <canvas id="theme-fg-canvas"> — overlay on top of panels
  let _fgCtx = null;
  let _rafId = null;
  let _lastFrameTime = 0;
  const BG_FRAME_INTERVAL = 1000 / 30; // 30fps cap

  const ThemeEngine = {
    register(id, manifest) {
      THEMES[id] = manifest;
    },

    getThemeIds() {
      return Object.keys(THEMES).sort();
    },

    getTheme(id) {
      return THEMES[id] || null;
    },

    getActiveThemeId() {
      return _activeThemeId;
    },

    getActiveTheme() {
      return _activeTheme;
    },

    init(mc) {
      // Check reduced motion preference
      var reducedMotion = localStorage.getItem('mc_animations_reduced') === 'true' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion) {
        document.documentElement.classList.add('reduced-motion');
      }
      _bgCanvas = document.getElementById('theme-bg-canvas');
      _fgCanvas = document.getElementById('theme-fg-canvas');
      if (_bgCanvas) {
        _bgCtx = _bgCanvas.getContext('2d');
        _resizeBgCanvas();
        window.addEventListener('resize', _resizeBgCanvas);
      }
      if (_fgCanvas) {
        _fgCtx = _fgCanvas.getContext('2d');
      }
      // Visibility API — pause when tab hidden
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          _stopBgLoop();
        } else if (_activeTheme) {
          _startBgLoop();
        }
      });
      // Load saved theme or default
      const saved = localStorage.getItem('mc_theme') || 'eva';
      this.setTheme(saved, mc, { skipCinematic: true });
    },

    setTheme(id, mc, opts = {}) {
      const theme = THEMES[id];
      if (!theme) return;
      // Deactivate current
      if (_activeTheme && typeof _activeTheme.deactivate === 'function') {
        _stopBgLoop();
        _activeTheme.deactivate();
        // Disable ASCII orbs before switching
        if (mc && typeof mc.disableAsciiOrbs === 'function') mc.disableAsciiOrbs();
      }
      // Swap CSS
      const link = document.getElementById('theme-css');
      if (link) {
        const onLoad = () => {
          link.removeEventListener('load', onLoad);
          _activateTheme(id, theme, mc, opts);
        };
        link.addEventListener('load', onLoad);
        link.href = theme.css;
      } else {
        _activateTheme(id, theme, mc, opts);
      }
      // Update data attribute immediately for flash prevention
      document.documentElement.dataset.theme = id;
      localStorage.setItem('mc_theme', id);
    },

    // Called by AgentPanel on state change
    notifyAgentStateChange(agent, newState) {
      if (_activeTheme && typeof _activeTheme.onAgentStateChange === 'function') {
        _activeTheme.onAgentStateChange(agent, newState);
      }
    },

    // Called by EventHandler for cinematic events
    fireCinematic(eventType, data) {
      // Skip cinematics in reduced motion mode
      if (document.documentElement.classList.contains('reduced-motion')) return;
      if (_activeTheme && typeof _activeTheme.getCinematicEvent === 'function') {
        const handler = _activeTheme.getCinematicEvent(eventType);
        if (typeof handler === 'function') handler(data);
      }
    },

    // Get sound profile for SoundEngine
    getSoundProfile() {
      if (_activeTheme && typeof _activeTheme.getSoundProfile === 'function') {
        return _activeTheme.getSoundProfile();
      }
      return null;
    },

    // Get per-theme vocabulary for agent naming, state labels, etc.
    getVocabulary() {
      if (_activeTheme && typeof _activeTheme.getVocabulary === 'function') {
        return _activeTheme.getVocabulary();
      }
      return null;
    }
  };

  // Theme-specific ASCII orb character sets
  var _orbCharsets = {
    matrix: '●○◉⊙⊛01アウエカキ',
    eva: '◉◎⊛⊕⊗△▽◇□○',
    gits: '◉○⊙●◎⊚アイウ01',
    alien: '●○◉◎⊙·.:|-+',
    bebop: '●○◉♪♫♬♩·∘∙',
    predator: '●◉⊙▲▼◆■□◇⊕',
  };

  function _activateTheme(id, theme, mc, opts) {
    _activeThemeId = id;
    _activeTheme = theme;
    if (typeof theme.activate === 'function') {
      theme.activate(mc, _bgCanvas, _bgCtx);
    }
    // Enable ASCII orbs with theme-specific charset and palette
    if (mc && typeof mc.enableAsciiOrbs === 'function') {
      setTimeout(function() { mc.enableAsciiOrbs(_orbCharsets[id] || null, id); }, 200);
    }
    _startBgLoop();
    document.dispatchEvent(new CustomEvent('theme-changed', { detail: { id, theme } }));
  }

  function _startBgLoop() {
    if (_rafId) return;
    _lastFrameTime = 0;
    _rafId = requestAnimationFrame(_bgFrame);
  }

  function _stopBgLoop() {
    if (_rafId) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
  }

  function _bgFrame(timestamp) {
    _rafId = requestAnimationFrame(_bgFrame);
    if (timestamp - _lastFrameTime < BG_FRAME_INTERVAL) return;
    _lastFrameTime = timestamp;
    if (_bgCtx && _activeTheme && typeof _activeTheme.renderBackground === 'function') {
      _activeTheme.renderBackground(_bgCtx, timestamp, _bgCanvas.width, _bgCanvas.height);
    }
    // Foreground overlay — renders ON TOP of panels (VHS glitches, scan lines, etc.)
    if (_fgCtx && _activeTheme && typeof _activeTheme.renderForeground === 'function') {
      _activeTheme.renderForeground(_fgCtx, timestamp, _fgCanvas.width, _fgCanvas.height);
    }
  }

  function _resizeBgCanvas() {
    if (!_bgCanvas) return;
    _bgCanvas.width = window.innerWidth;
    _bgCanvas.height = window.innerHeight;
    if (_fgCanvas) {
      _fgCanvas.width = window.innerWidth;
      _fgCanvas.height = window.innerHeight;
    }
  }

  // Expose globally
  window.ThemeEngine = ThemeEngine;

  // Also attach to MissionControl prototype for manager access
  Object.assign(MissionControl.prototype, {
    initThemeEngine() {
      ThemeEngine.init(this);
    }
  });
})();
