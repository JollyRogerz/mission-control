// ThemeSwitcherUI.js — Sidebar dropdown, header pill, keyboard shortcuts
(function () {
  'use strict';

  Object.assign(MissionControl.prototype, {
    initThemeSwitcher() {
      this._buildDropdown();
      this._updateHeaderPill();
      this._bindThemeKeys();
      // Listen for theme changes to update UI
      document.addEventListener('theme-changed', () => this._updateHeaderPill());
    }
  });

  MissionControl.prototype._buildDropdown = function () {
    // Create dropdown container
    var dropdown = document.createElement('div');
    dropdown.id = 'theme-dropdown';
    document.body.appendChild(dropdown);

    // Build theme cards
    var ids = ThemeEngine.getThemeIds();
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;';
    ids.forEach(function(id) {
      var theme = ThemeEngine.getTheme(id);
      if (!theme) return;
      var card = document.createElement('div');
      card.className = 'theme-card' + (ThemeEngine.getActiveThemeId() === id ? ' active' : '');
      card.dataset.themeId = id;
      card.innerHTML =
        '<div class="swatch" style="background:linear-gradient(135deg, ' + theme.colors.primary + ', ' + theme.colors.accent + ')"></div>' +
        '<div class="info">' +
        '<div class="name">' + theme.icon + ' ' + theme.name + '</div>' +
        '<div class="tagline">' + theme.tagline + '</div>' +
        '</div>';
      card.addEventListener('click', function() {
        ThemeEngine.setTheme(id, window.__missionControl);
        _closeDropdown();
        _updateCards();
      });
      grid.appendChild(card);
    });
    dropdown.appendChild(grid);

    // Sidebar button toggles dropdown
    var btn = document.getElementById('theme-switcher-btn');
    if (btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var rect = btn.getBoundingClientRect();
        dropdown.style.left = (rect.right + 8) + 'px';
        dropdown.style.top = rect.top + 'px';
        dropdown.classList.toggle('open');
      });
    }

    // Header pill also opens dropdown
    var pill = document.getElementById('theme-indicator');
    if (pill) {
      pill.addEventListener('click', function(e) {
        e.stopPropagation();
        var rect = pill.getBoundingClientRect();
        dropdown.style.left = (rect.left) + 'px';
        dropdown.style.top = (rect.bottom + 4) + 'px';
        dropdown.classList.toggle('open');
      });
    }

    // Click outside to close
    document.addEventListener('click', function() { _closeDropdown(); });

    function _closeDropdown() {
      dropdown.classList.remove('open');
    }
    function _updateCards() {
      dropdown.querySelectorAll('.theme-card').forEach(function(c) {
        c.classList.toggle('active', c.dataset.themeId === ThemeEngine.getActiveThemeId());
      });
    }
  };

  MissionControl.prototype._updateHeaderPill = function () {
    var pill = document.getElementById('theme-indicator');
    if (!pill) return;
    var id = ThemeEngine.getActiveThemeId();
    var theme = ThemeEngine.getTheme(id);
    if (theme) {
      pill.textContent = theme.icon + ' ' + id.toUpperCase();
      pill.style.borderColor = theme.colors.primary + '44';
    }
  };

  MissionControl.prototype._bindThemeKeys = function () {
    document.addEventListener('keydown', function(e) {
      if (!e.ctrlKey || !e.shiftKey) return;
      var ids = ThemeEngine.getThemeIds();
      var current = ids.indexOf(ThemeEngine.getActiveThemeId());
      if (e.key === 'T' || e.key === 't') {
        e.preventDefault();
        var next = (current + 1) % ids.length;
        ThemeEngine.setTheme(ids[next], window.__missionControl);
      } else if (e.key === 'Y' || e.key === 'y') {
        e.preventDefault();
        var prev = (current - 1 + ids.length) % ids.length;
        ThemeEngine.setTheme(ids[prev], window.__missionControl);
      }
    });
  };
})();
