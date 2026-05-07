'use strict';

// ---------------------------------------------------------------------------
// Mission Control Terminal — core definitions
// ---------------------------------------------------------------------------
// QUAL-02: All URLs are defined in CONFIG below. No raw URL strings elsewhere.
// QUAL-03: Logic is split into EventHandler.js, ChatManager.js,
//          AgentPanel.js, FeedManager.js — all extend MissionControl.prototype.
// ---------------------------------------------------------------------------

// ---- Configuration --------------------------------------------------------

const CONFIG = {
  gatewayUrl: 'ws://127.0.0.1:18789',
  bridgeUrl:  'http://127.0.0.1:8100',
};

// ---- Agent definitions ----------------------------------------------------
// Agent configuration is loaded dynamically from /api/agents (W2 cache: this._agents).
// AGENTS is kept as an empty fallback map for legacy code paths that have not yet
// been migrated to the W2 cache. agentEmoji() / agentDisplayName() resolve from
// this._agents first; AGENTS is the last-resort default.

const AGENTS = {};

const AGENT_IDS = Object.keys(AGENTS); // empty \u2014 agent states created on-demand via _getAgentState

// ---- Helpers --------------------------------------------------------------

function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return String(d.getHours()).padStart(2, '0') + ':' +
         String(d.getMinutes()).padStart(2, '0') + ':' +
         String(d.getSeconds()).padStart(2, '0');
}

function formatUptime(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return totalSec + 's';
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return totalMin + 'm ' + (totalSec % 60) + 's';
  return Math.floor(totalMin / 60) + 'h ' + (totalMin % 60) + 'm';
}

function formatLastSeen(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return totalSec + 's ago';
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return totalMin + 'm ' + (totalSec % 60) + 's ago';
  return Math.floor(totalMin / 60) + 'h ' + (totalMin % 60) + 'm ago';
}

function truncate(str, len) {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.slice(0, len) + '\u2026';
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractModelFromText(text) {
  if (!text) return null;
  const m = text.match(/Model\s*\(effective\):\s*([^\s|]+)/i);
  if (m) {
    const full = m[1];
    const slash = full.lastIndexOf('/');
    return slash >= 0 ? full.substring(slash + 1) : full;
  }
  return null;
}

function estimateTokens(text) {
  return text ? Math.ceil(text.length / 4) : 0;
}

function createAgentState() {
  return {
    state: 'idle',
    model: '',
    tool: '',
    tokensIn: 0,
    tokensOut: 0,
    errorCount: 0,
    lastMessage: '',
    firstSeen: null,
    lastActivity: null,
  };
}

// ---- Config loader (ADAPT-10) ---------------------------------------------

// ADAPT-10: async fetch replaces the former synchronous XHR (removed in Wave 6).
// Called from init() which awaits it before deciding to connect.
async function loadMissionControlConfig() {
  try {
    const r = await fetch('mission-control.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`mission-control.json HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.error('[terminal] failed to load mission-control.json:', e);
    return {};  // safe fallback — bridge calls will fail with clearer auth errors
  }
}

// ---- MissionControl class -------------------------------------------------

class MissionControl {
  constructor() {
    // Connection handles
    this.ws = null;
    this.reconnectTimer = null;
    this.uptimeTimer = null;
    this.bridgeHealthTimer = null;
    this.pingTimer = null;

    // Tokens: bridge token loaded async from mission-control.json in init(),
    // gateway token from sessionStorage
    this.gatewayToken = sessionStorage.getItem('gateway_token') || '';
    // ADAPT-10: bridgeToken starts empty; async fetch in init() populates it
    // before connect() is called (sessionStorage fast-path for pywebview reloads)
    this.bridgeToken = sessionStorage.getItem('bridge_token') || '';

    // QUAL-02: URLs from CONFIG — single source of truth
    this.gatewayUrl = CONFIG.gatewayUrl;
    this.bridgeUrl = CONFIG.bridgeUrl;

    // Agent states keyed by agentId (pre-populate model from config)
    this.agents = {};
    for (const id of AGENT_IDS) {
      const s = createAgentState();
      if (AGENTS[id] && AGENTS[id].defaultModel) s.model = AGENTS[id].defaultModel;
      this.agents[id] = s;
    }

    // Connection state
    this.gatewayConnected = false;
    this.bridgeConnected = false;

    // Track runId → agentId for events that lack sessionKey
    this.runIdMap = {};

    // Chat streaming: accumulate delta text per runId, flush on lifecycle end
    this._chatStreamText = {};
    this._lastChatUserRunId = null;
    this._shownAgentRunIds = new Set();
    this._mcSentMessages = [];

    // Feed / log limits — QUAL-04: raised caps
    this.maxFeedEntries = 1000;
    this.maxRawEntries = 500;
    this.maxChatMessages = 500;

    // QUAL-04: overflow buffers for "Load earlier" buttons
    this.feedBuffer = [];
    this.chatBuffer = [];

    // Raw log
    this.rawAutoScroll = true;
    this.rawSearchFilter = '';
    this.rawRegexMode = false;

    // FEAT-01: Agent feed filter — all visible by default ('' = system/null entries)
    this.activeAgentFilters = new Set([...AGENT_IDS, '']);

    // Current tab
    this.activeTab = 'feed';

    // FEAT-04: Chat log for export
    this.chatLog = [];

    // QUICK-02: Audio notifications
    this.audioEnabled = localStorage.getItem('mc-audio-enabled') !== 'false';
    window._mcAudioEnabled = this.audioEnabled; // expose for AgentPanel per-agent sounds
    this.audioCtx = null;

    // FEAT-VIZ: Connection lines + task chain + timeline + sparkline state
    this.activeConnections = new Map();   // connectionId -> ConnectionData
    this.connectionIdCounter = 0;
    this.taskChain = [];                  // Array of {from, to, connectionId}
    this.connectionAnimFrame = null;      // requestAnimationFrame handle
    this.agentTimeline = {};              // agentId -> [{state, startTime, endTime}]
    this.agentTokenSamples = {};          // agentId -> {in: [], out: [], lastIn, lastOut}
    this.timelineSampleTimer = null;      // setInterval handle for token sampling
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    this.initPageRouter();

    // ADAPT-10: load bridge token from mission-control.json before deciding to connect.
    // pywebview overrides bridgeToken via on_loaded() after this returns, so we only
    // apply the file-loaded token in browser (non-pywebview) mode.
    if (!window.pywebview) {
      const mcCfg = await loadMissionControlConfig();
      if (mcCfg.bridge_token) {
        this.bridgeToken = mcCfg.bridge_token;
        sessionStorage.setItem('bridge_token', this.bridgeToken);
      }
    }

    // In pywebview app mode, on_loaded() injects the correct token and calls connect().
    // Don't auto-connect here — let on_loaded handle it to avoid stale token race.
    if (window.pywebview) {
      // pywebview will call connect() after injecting tokens via on_loaded
    } else if (this.bridgeToken || this.gatewayToken) {
      this.connect();
    } else {
      this.showAuthModal();
    }

    // Uptime tick every second
    this.uptimeTimer = setInterval(() => this.updateUptimes(), 1000);

    // Bridge health check every 10 seconds
    this.checkBridgeHealth();
    this.bridgeHealthTimer = setInterval(() => this.checkBridgeHealth(), 10000);

    // FEAT-VIZ: Initialize visualization features
    if (typeof this.initConnections === 'function') this.initConnections();
    if (typeof this.initTimeline === 'function') this.initTimeline();

    // FEAT-SOUND: Space/techie sound engine
    if (typeof this.initSoundEngine === 'function') this.initSoundEngine();

    // FEAT-PAPERCLIP: Stolen features from Paperclip
    if (typeof this.initCostTracking === 'function') this.initCostTracking();
    if (typeof this.initCommandPalette === 'function') this.initCommandPalette();
    if (typeof this.initActivityCharts === 'function') this.initActivityCharts();

    // FEAT-PAPERCLIP-2: Extended features — tracing, agent controls
    if (typeof this.initTraceViewer === 'function') this.initTraceViewer();
    // initAgents() fetches /api/agents, clones the template into .agent-grid,
    // populates this._agents cache, then calls initAgentControls() internally.
    if (typeof this.initAgents === 'function') await this.initAgents();
    else if (typeof this.initAgentControls === 'function') this.initAgentControls();

    // Initialize theme engine
    if (typeof this.initThemeEngine === 'function') this.initThemeEngine();
    if (typeof this.initThemeSwitcher === 'function') this.initThemeSwitcher();
  }

  // ---- Page Router --------------------------------------------------------

  initPageRouter() {
    this.activePage = 'dashboard';
    this.sidebarBtns = document.querySelectorAll('.sidebar-btn[data-page]');

    this.sidebarBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        if (page) this.switchPage(page);
      });
    });
  }

  switchPage(pageName) {
    if (this.activePage === pageName) return;
    this.activePage = pageName;

    // FEAT-SOUND: Page navigation whoosh
    if (typeof this.playNavWhoosh === 'function') this.playNavWhoosh();

    // Update sidebar active state
    this.sidebarBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === pageName);
    });

    // Show/hide pages with per-theme transitions
    const oldPage = document.querySelector('.page.active');
    if (oldPage) oldPage.classList.add('page-leaving');
    document.querySelectorAll('.page').forEach(page => {
      page.classList.toggle('active', page.id === 'page-' + pageName);
    });
    const newPage = document.getElementById('page-' + pageName);
    if (newPage) {
      newPage.classList.add('page-entering');
      var cleaned = false;
      var cleanup = function() {
        if (cleaned) return;
        cleaned = true;
        if (oldPage) oldPage.classList.remove('page-leaving');
        newPage.classList.remove('page-entering');
      };
      // Guard against bubbling animationend from child elements
      newPage.addEventListener('animationend', function handler(e) {
        if (e.target !== newPage) return;
        cleanup();
        newPage.removeEventListener('animationend', handler);
      });
      // Fallback timeout in case animationend doesn't fire (e.g. reduced-motion)
      setTimeout(cleanup, 500);
    }

    // Tell panel manager to switch layout
    if (window.__panelManager) {
      window.__panelManager.switchPage(pageName);
    }

    // Trigger page-specific init on first visit
    if (!this._visitedPages) this._visitedPages = new Set(['dashboard']);
    if (!this._visitedPages.has(pageName)) {
      this._visitedPages.add(pageName);
      this._initPage(pageName);
    }

    // Reload memory tree on every tab switch (bridge may have started after first visit)
    if (pageName === 'memory' && typeof this._loadMemoryTree === 'function') {
      this._loadMemoryTree();
    }
  }

  _initPage(pageName) {
    switch (pageName) {
      case 'tasks':
        if (typeof this.initTaskBoard === 'function') this.initTaskBoard();
        if (typeof this.initGoalManager === 'function') this.initGoalManager();
        break;
      case 'memory':
        if (typeof this.initMemoryViewer === 'function') this.initMemoryViewer();
        break;
      case 'calendar':
        if (typeof this.initCalendar === 'function') this.initCalendar();
        break;
      case 'team':
        if (typeof this.initTeamView === 'function') this.initTeamView();
        break;
      case 'costs':
        // Cost panel auto-renders on interval; trigger immediate render on first visit
        if (typeof this.renderCostPanel === 'function') this.renderCostPanel();
        if (typeof this.renderActivityCharts === 'function') {
          const actContainer = document.getElementById('activity-charts-content');
          if (actContainer) this.renderActivityCharts(actContainer);
        }
        break;
      case 'approvals':
        if (typeof this.initApprovalPanel === 'function') this.initApprovalPanel();
        break;
      case 'analytics':
        if (typeof this.initAnalyticsPanel === 'function') this.initAnalyticsPanel();
        break;
    }
  }

  getOrCreateAgent(agentId) {
    if (!this.agents[agentId]) {
      this.agents[agentId] = createAgentState();
    }
    return this.agents[agentId];
  }

  agentEmoji(agentId) {
    const cfg = AGENTS[agentId];
    if (cfg) return cfg.emoji;
    // Fall back to W2 cache populated by AgentPanel.initAgents()
    const cached = (this._agents || []).find(a => a.id === agentId);
    return cached ? (cached.emoji || '❓') : '❓';
  }

  agentDisplayName(agentId) {
    const cfg = AGENTS[agentId];
    if (cfg) return cfg.name;
    // Fall back to W2 cache populated by AgentPanel.initAgents()
    const cached = (this._agents || []).find(a => a.id === agentId);
    return cached ? (cached.display_name || agentId) : agentId;
  }

  destroy() {
    if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
    if (this.reconnectTimer)    { clearTimeout(this.reconnectTimer);      this.reconnectTimer    = null; }
    if (this.uptimeTimer)       { clearInterval(this.uptimeTimer);        this.uptimeTimer       = null; }
    if (this.bridgeHealthTimer) { clearInterval(this.bridgeHealthTimer);  this.bridgeHealthTimer = null; }
    if (this.pingTimer)         { clearInterval(this.pingTimer);          this.pingTimer         = null; }
    // FEAT-VIZ: Cleanup visualization features
    if (typeof this.destroyConnections === 'function') this.destroyConnections();
    if (typeof this.destroyTimeline === 'function') this.destroyTimeline();
  }

  playEndBeep() {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = this.audioCtx;
      const oscillator = ctx.createOscillator();
      const gainNode   = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.type      = 'sine';
      oscillator.frequency.setValueAtTime(440, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.1);
    } catch (_) {
      // Silently ignore AudioContext errors (e.g. user gesture requirement not met yet)
    }
  }
}

// ---- Bootstrap ------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const mc = new MissionControl();

  // Expose early so pywebview's on_loaded callback can find it
  window.__missionControl = mc;
  window.mc = mc;  // Short alias for CommandPalette and other modules

  // DEBT-01: Guard against missing module methods — if EventHandler.js (or any
  // module file) failed to load, cacheElements/bindEvents won't be on the
  // prototype and mc.init() would crash silently.
  if (typeof mc.cacheElements !== 'function' || typeof mc.bindEvents !== 'function') {
    console.error(
      '[MissionControl] Bootstrap aborted — module methods missing on prototype. ' +
      'Ensure EventHandler.js, ChatManager.js, AgentPanel.js, and FeedManager.js ' +
      'are loaded via synchronous <script> tags before terminal.js DOMContentLoaded fires.'
    );
    return;
  }

  // ADAPT-10: init() is now async (awaits mission-control.json fetch).
  // Wrap call so unhandled rejections surface in the console.
  mc.init().catch(err => console.error('[MissionControl] init failed:', err));
  if (typeof mc.initAsciiOrbs === 'function') mc.initAsciiOrbs();
});
