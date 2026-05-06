'use strict';

// ---------------------------------------------------------------------------
// CommandPalette.js — Cmd+K / Ctrl+K command palette
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------

const CMD_PALETTE_CSS = `
/* ── Command Palette ─────────────────────────────────────────────────────── */

.cmd-palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  opacity: 0;
  visibility: hidden;
  transition: opacity 120ms ease, visibility 120ms ease;
}
.cmd-palette-overlay.open {
  opacity: 1;
  visibility: visible;
}

.cmd-palette-modal {
  width: 100%;
  max-width: 560px;
  max-height: 70vh;
  background: #1a1a2e;
  border: 1px solid #2a2a4a;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);
  transform: scale(0.96);
  transition: transform 120ms ease;
}
.cmd-palette-overlay.open .cmd-palette-modal {
  transform: scale(1);
}

/* ── Search input ── */
.cmd-palette-search {
  width: 100%;
  padding: 16px 20px;
  background: transparent;
  border: none;
  border-bottom: 1px solid #2a2a4a;
  color: var(--text-bright, #e8f0ff);
  font-family: 'Berkeley Mono', monospace;
  font-size: 15px;
  outline: none;
}
.cmd-palette-search::placeholder {
  color: var(--text-dim, #3d4a5c);
}

/* ── Results area ── */
.cmd-palette-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.cmd-palette-results::-webkit-scrollbar { width: 4px; }
.cmd-palette-results::-webkit-scrollbar-track { background: transparent; }
.cmd-palette-results::-webkit-scrollbar-thumb { background: #2a2a4a; border-radius: 2px; }

/* ── Group header ── */
.cmd-palette-group {
  padding: 10px 20px 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-dim, #3d4a5c);
  font-family: 'Berkeley Mono', monospace;
}

/* ── Item ── */
.cmd-palette-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 20px;
  cursor: pointer;
  position: relative;
  font-family: 'Berkeley Mono', monospace;
  font-size: 13px;
  color: var(--text-primary, #c8d6e5);
  border-left: 3px solid transparent;
  transition: background 60ms ease;
}
.cmd-palette-item:hover {
  background: rgba(255, 255, 255, 0.03);
}
.cmd-palette-item.selected {
  background: rgba(255, 255, 255, 0.05);
  border-left-color: #f59e0b;
}
.cmd-palette-item-icon {
  flex-shrink: 0;
  width: 20px;
  text-align: center;
  font-size: 14px;
}
.cmd-palette-item-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmd-palette-item-label mark {
  background: none;
  color: #f59e0b;
  font-weight: 600;
}
.cmd-palette-item-hint {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-dim, #3d4a5c);
  padding: 1px 6px;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 4px;
}

/* ── Empty state ── */
.cmd-palette-empty {
  padding: 32px 20px;
  text-align: center;
  color: var(--text-dim, #3d4a5c);
  font-family: 'Berkeley Mono', monospace;
  font-size: 13px;
}

/* ── Footer ── */
.cmd-palette-footer {
  padding: 10px 20px;
  border-top: 1px solid #2a2a4a;
  font-size: 11px;
  color: var(--text-dim, #3d4a5c);
  font-family: 'Berkeley Mono', monospace;
  display: flex;
  gap: 16px;
}
.cmd-palette-footer kbd {
  display: inline-block;
  padding: 1px 5px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 3px;
  font-family: inherit;
  font-size: 10px;
  color: var(--text-secondary, #6b7b8d);
  background: rgba(255,255,255,0.03);
}
`;

// Inject styles once
(function() {
  const style = document.createElement('style');
  style.textContent = CMD_PALETTE_CSS;
  document.head.appendChild(style);
})();

// ── Command definitions ─────────────────────────────────────────────────────

const CMD_PALETTE_COMMANDS = [
  // Navigate
  { group: 'Navigate', icon: '\uD83C\uDFE0', label: 'Dashboard',  hint: '1', action: 'page',  page: 'dashboard' },
  { group: 'Navigate', icon: '\uD83D\uDCCB', label: 'Tasks',      hint: '2', action: 'page',  page: 'tasks' },
  { group: 'Navigate', icon: '\uD83E\uDDE0', label: 'Memory',     hint: '3', action: 'page',  page: 'memory' },
  { group: 'Navigate', icon: '\uD83D\uDCC5', label: 'Calendar',   hint: '4', action: 'page',  page: 'calendar' },
  { group: 'Navigate', icon: '\uD83D\uDC65', label: 'Team',       hint: '5', action: 'page',  page: 'team' },
  { group: 'Navigate', icon: '\uD83D\uDCAC', label: 'Chat',       hint: '6', action: 'page',  page: 'chat' },

  // Agents are inserted dynamically in initCommandPalette() from the W2 cache (window._missionControl._agents)

  // Actions
  { group: 'Actions', icon: '\uD83D\uDCE4', label: 'Export Chat',        action: 'exportChat' },
  { group: 'Actions', icon: '\uD83D\uDCCA', label: 'Export Cost Report', action: 'exportCostReport' },
  { group: 'Actions', icon: '\uD83D\uDD04', label: 'Reset Layout',       action: 'resetLayout' },
  { group: 'Actions', icon: '\uD83D\uDD0A', label: 'Toggle Audio',       action: 'toggleAudio' },
];

const CMD_GROUP_ICONS = {
  'Navigate': '\uD83D\uDCCD',
  'Agents':   '\uD83E\uDD16',
  'Actions':  '\u26A1',
};

// ── Prototype extension ─────────────────────────────────────────────────────

Object.assign(MissionControl.prototype, {

  initCommandPalette() {
    // Build overlay DOM
    const overlay = document.createElement('div');
    overlay.className = 'cmd-palette-overlay';
    overlay.id = 'cmd-palette-overlay';
    overlay.innerHTML =
      '<div class="cmd-palette-modal">' +
        '<input class="cmd-palette-search" id="cmd-palette-search" type="text" placeholder="Type a command..." autocomplete="off" />' +
        '<div class="cmd-palette-results" id="cmd-palette-results"></div>' +
        '<div class="cmd-palette-footer">' +
          '<span><kbd>ESC</kbd> close</span>' +
          '<span><kbd>\u2191</kbd><kbd>\u2193</kbd> navigate</span>' +
          '<span><kbd>\u21B5</kbd> select</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // Register theme switch commands
    CMD_GROUP_ICONS['Themes'] = '\uD83C\uDFA8';
    if (typeof ThemeEngine !== 'undefined') {
      const themeIds = ThemeEngine.getThemeIds();
      themeIds.forEach(function(id) {
        const theme = ThemeEngine.getTheme(id);
        if (theme) {
          CMD_PALETTE_COMMANDS.push({
            group: 'Themes',
            icon: theme.icon || '\uD83C\uDFA8',
            label: 'Theme: ' + theme.name,
            hint: theme.tagline || '',
            action: 'theme',
            themeId: id,
          });
        }
      });
    }

    // Register agent commands dynamically from W2 cache
    const agentCache = (window._missionControl && window._missionControl._agents) || [];
    agentCache.forEach(function(agent) {
      CMD_PALETTE_COMMANDS.push({
        group: 'Agents',
        icon: agent.emoji || '🤖',
        label: 'Talk to ' + (agent.display_name || agent.id),
        action: 'agent',
        agentId: agent.id,
      });
    });

    this._cmdOverlay = overlay;
    this._cmdSearch = document.getElementById('cmd-palette-search');
    this._cmdResults = document.getElementById('cmd-palette-results');
    this._cmdSelectedIdx = 0;
    this._cmdFiltered = [];

    // Click backdrop to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._closeCommandPalette();
    });

    // Search input
    this._cmdSearch.addEventListener('input', () => {
      this._renderCommandResults(this._cmdSearch.value);
    });

    // Keyboard nav inside search
    this._cmdSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._closeCommandPalette();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._cmdSelectDelta(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._cmdSelectDelta(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = this._cmdFiltered[this._cmdSelectedIdx];
        if (cmd) this._executeCommand(cmd);
      }
    });

    // Global keyboard shortcut: Cmd+K / Ctrl+K
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (this._cmdOverlay.classList.contains('open')) {
          this._closeCommandPalette();
        } else {
          this._openCommandPalette();
        }
      }
    });
  },

  _openCommandPalette() {
    if (typeof this.playPaletteOpen === 'function') this.playPaletteOpen();
    this._cmdSearch.value = '';
    this._cmdSelectedIdx = 0;
    this._renderCommandResults('');
    this._cmdOverlay.classList.add('open');
    // Focus after the frame so transition doesn't swallow it
    requestAnimationFrame(() => this._cmdSearch.focus());
  },

  _closeCommandPalette() {
    if (typeof this.playPaletteClose === 'function') this.playPaletteClose();
    this._cmdOverlay.classList.remove('open');
    this._cmdSearch.value = '';
  },

  _renderCommandResults(query) {
    const q = query.toLowerCase().trim();

    // Filter commands by fuzzy match on label
    let filtered;
    if (!q) {
      filtered = CMD_PALETTE_COMMANDS.map(cmd => ({ cmd, highlighted: escapeHtml(cmd.label) }));
    } else {
      filtered = [];
      for (const cmd of CMD_PALETTE_COMMANDS) {
        const result = this._cmdFuzzyMatch(cmd.label, q);
        if (result) {
          filtered.push({ cmd, highlighted: result });
        }
      }
    }

    this._cmdFiltered = filtered.map(f => f.cmd);
    this._cmdSelectedIdx = Math.min(this._cmdSelectedIdx, Math.max(0, this._cmdFiltered.length - 1));

    // Render grouped
    if (filtered.length === 0) {
      this._cmdResults.innerHTML = '<div class="cmd-palette-empty">No matching commands</div>';
      return;
    }

    let html = '';
    let lastGroup = '';
    for (let i = 0; i < filtered.length; i++) {
      const { cmd, highlighted } = filtered[i];
      if (cmd.group !== lastGroup) {
        lastGroup = cmd.group;
        const gIcon = CMD_GROUP_ICONS[cmd.group] || '';
        html += '<div class="cmd-palette-group">' + gIcon + ' ' + escapeHtml(cmd.group) + '</div>';
      }
      const selected = i === this._cmdSelectedIdx ? ' selected' : '';
      const hint = cmd.hint ? '<span class="cmd-palette-item-hint">' + escapeHtml(cmd.hint) + '</span>' : '';
      html +=
        '<div class="cmd-palette-item' + selected + '" data-cmd-idx="' + i + '">' +
          '<span class="cmd-palette-item-icon">' + cmd.icon + '</span>' +
          '<span class="cmd-palette-item-label">' + highlighted + '</span>' +
          hint +
        '</div>';
    }

    this._cmdResults.innerHTML = html;

    // Click handlers on items
    const items = this._cmdResults.querySelectorAll('.cmd-palette-item');
    items.forEach(el => {
      el.addEventListener('mouseenter', () => {
        const idx = parseInt(el.dataset.cmdIdx, 10);
        if (!isNaN(idx)) {
          this._cmdSelectedIdx = idx;
          this._cmdUpdateSelection();
        }
      });
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.cmdIdx, 10);
        if (!isNaN(idx) && this._cmdFiltered[idx]) {
          this._executeCommand(this._cmdFiltered[idx]);
        }
      });
    });
  },

  /**
   * Fuzzy match: finds all characters of `query` in `text` in order.
   * Returns HTML with <mark> tags around matched chars, or null if no match.
   */
  _cmdFuzzyMatch(text, query) {
    let qi = 0;
    const chars = [];
    const matchIndices = new Set();

    for (let ti = 0; ti < text.length && qi < query.length; ti++) {
      if (text[ti].toLowerCase() === query[qi]) {
        matchIndices.add(ti);
        qi++;
      }
    }

    if (qi < query.length) return null; // not all query chars matched

    // Build highlighted HTML
    let html = '';
    for (let i = 0; i < text.length; i++) {
      const ch = escapeHtml(text[i]);
      if (matchIndices.has(i)) {
        html += '<mark>' + ch + '</mark>';
      } else {
        html += ch;
      }
    }
    return html;
  },

  _cmdSelectDelta(delta) {
    if (this._cmdFiltered.length === 0) return;
    this._cmdSelectedIdx = (this._cmdSelectedIdx + delta + this._cmdFiltered.length) % this._cmdFiltered.length;
    this._cmdUpdateSelection();

    // Scroll selected item into view
    const selected = this._cmdResults.querySelector('.cmd-palette-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  },

  _cmdUpdateSelection() {
    const items = this._cmdResults.querySelectorAll('.cmd-palette-item');
    items.forEach((el, i) => {
      el.classList.toggle('selected', i === this._cmdSelectedIdx);
    });
  },

  _executeCommand(cmd) {
    this._closeCommandPalette();

    switch (cmd.action) {
      case 'page':
        this.switchPage(cmd.page);
        break;

      case 'agent': {
        // Switch to chat page, set agent, focus input
        this.switchPage('chat');
        if (this.chatAgentSelect) {
          this.chatAgentSelect.value = cmd.agentId;
          // Trigger the sticky agent logic
          if (typeof this.onAgentSelectChange === 'function') {
            this.onAgentSelectChange();
          }
        }
        if (this.chatInput) {
          requestAnimationFrame(() => this.chatInput.focus());
        }
        break;
      }

      case 'exportChat':
        if (typeof this.exportChat === 'function') this.exportChat();
        break;

      case 'exportCostReport':
        if (typeof this.exportCostReport === 'function') {
          this.exportCostReport();
        } else {
          this.addFeedEntry(null, 'system', 'Cost report export not available');
        }
        break;

      case 'resetLayout': {
        const btn = document.getElementById('reset-layout-btn');
        if (btn) btn.click();
        break;
      }

      case 'toggleAudio': {
        const btn = document.getElementById('audio-toggle-btn');
        if (btn) btn.click();
        break;
      }

      case 'theme':
        if (typeof ThemeEngine !== 'undefined') {
          ThemeEngine.setTheme(cmd.themeId, window.__missionControl);
        }
        break;
    }
  },

});
