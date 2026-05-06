'use strict';

// ---------------------------------------------------------------------------
// EventHandler.js — event binding, auth, connection, and message handling
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------

Object.assign(MissionControl.prototype, {

  cacheElements() {
    // Auth modal
    this.authModal        = document.getElementById('auth-modal');
    this.authGatewayInput = document.getElementById('auth-gateway-token');
    this.authBridgeInput  = document.getElementById('auth-bridge-token');
    this.authSubmitBtn    = document.getElementById('auth-connect-btn');

    // Header status indicators
    this.gatewayDot = document.getElementById('gateway-dot');
    this.bridgeDot  = document.getElementById('bridge-dot');

    // Tabs
    this.tabFeedBtn = document.getElementById('tab-feed');
    this.tabRawBtn  = document.getElementById('tab-raw');
    this.feedPanel  = document.getElementById('panel-feed-content');
    this.rawPanel   = document.getElementById('panel-raw');

    // Activity feed + raw log
    this.activityFeed       = document.getElementById('panel-feed-content');
    this.rawLog             = document.getElementById('panel-raw');
    this.rawAutoScrollToggle = document.getElementById('auto-scroll-btn');
    this.rawSearchInput     = document.getElementById('log-search');

    // Chat
    this.chatMessages    = document.getElementById('chat-messages');
    this._initChatScrollIndicator();
    this.chatInput       = document.getElementById('chat-input');
    this.chatSendBtn     = document.getElementById('chat-send-btn');
    this.chatAgentSelect = document.getElementById('agent-select');

    // FEAT-01: Agent chips
    this.agentChipsEl = document.getElementById('agent-chips');

    // FEAT-04: Export controls
    this.exportBtn          = document.getElementById('export-btn');
    this.exportFormatSelect = document.getElementById('export-format');

    // FEAT-PAPERCLIP: Cost & Activity export buttons
    this.exportCostBtn  = document.getElementById('export-cost-btn');
    this.exportAuditBtn = document.getElementById('export-audit-btn');

    // FEAT-05: Regex toggle
    this.regexToggleBtn = document.getElementById('regex-toggle');

    // QUAL-01: Character counter
    this.chatCharCount = document.getElementById('chat-char-count');

    // QUICK-02: Audio toggle
    this.audioToggleBtn = document.getElementById('audio-toggle-btn');

    // LAYOUT: Reset layout button
    this.resetLayoutBtn = document.getElementById('reset-layout-btn');
  },

  bindEvents() {
    // Auth modal
    if (this.authSubmitBtn) {
      this.authSubmitBtn.addEventListener('click', () => this.submitAuth());
    }
    if (this.authGatewayInput) {
      this.authGatewayInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.submitAuth(); });
    }
    if (this.authBridgeInput) {
      this.authBridgeInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.submitAuth(); });
    }

    // Tabs
    if (this.tabFeedBtn) this.tabFeedBtn.addEventListener('click', () => this.switchTab('feed'));
    if (this.tabRawBtn)  this.tabRawBtn.addEventListener('click',  () => this.switchTab('raw'));

    // Raw log controls
    if (this.rawAutoScrollToggle) {
      this.rawAutoScrollToggle.addEventListener('click', () => {
        this.rawAutoScroll = !this.rawAutoScroll;
        this.rawAutoScrollToggle.classList.toggle('active', this.rawAutoScroll);
      });
    }
    if (this.rawSearchInput) {
      this.rawSearchInput.addEventListener('input', e => {
        this.rawSearchFilter = e.target.value;
        this.applyRawFilter();
      });
    }

    // FEAT-05: Regex mode toggle
    if (this.regexToggleBtn) {
      this.regexToggleBtn.addEventListener('click', () => {
        this.rawRegexMode = !this.rawRegexMode;
        this.regexToggleBtn.classList.toggle('active', this.rawRegexMode);
        if (this.rawSearchInput) this.rawSearchInput.classList.remove('regex-error');
        this.applyRawFilter();
      });
    }

    // FEAT-01: Agent chip toggles
    if (this.agentChipsEl) {
      this.agentChipsEl.addEventListener('click', e => {
        const chip = e.target.closest('.agent-chip');
        if (!chip) return;
        const agentId = chip.dataset.agentId;
        if (this.activeAgentFilters.has(agentId)) {
          this.activeAgentFilters.delete(agentId);
          chip.classList.remove('active');
        } else {
          this.activeAgentFilters.add(agentId);
          chip.classList.add('active');
        }
        this.applyFeedFilter();
      });
    }

    // FEAT-04: Export button
    if (this.exportBtn) this.exportBtn.addEventListener('click', () => this.exportChat());

    // FEAT-PAPERCLIP: Cost & Activity export buttons
    if (this.exportCostBtn) this.exportCostBtn.addEventListener('click', () => {
      if (typeof this.exportCostReport === 'function') this.exportCostReport();
    });
    if (this.exportAuditBtn) this.exportAuditBtn.addEventListener('click', () => {
      if (typeof this.exportAuditLog === 'function') this.exportAuditLog();
    });

    // QUICK-02: Audio toggle button
    if (this.audioToggleBtn) {
      // Set initial icon from current state
      this.audioToggleBtn.textContent = this.audioEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
      this.audioToggleBtn.addEventListener('click', () => {
        this.audioEnabled = !this.audioEnabled;
        window._mcAudioEnabled = this.audioEnabled;
        localStorage.setItem('mc-audio-enabled', String(this.audioEnabled));
        this.audioToggleBtn.textContent = this.audioEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
        this.audioToggleBtn.title = this.audioEnabled
          ? 'Audio notifications: ON (click to disable)'
          : 'Audio notifications: OFF (click to enable)';
      });
    }

    // LAYOUT: Reset layout button — clears saved layout and restores defaults
    if (this.resetLayoutBtn) {
      this.resetLayoutBtn.addEventListener('click', () => {
        if (window.__panelManager) {
          window.__panelManager.resetLayout();
        }
      });
    }

    // FEAT-STICKY: Agent selector change → manual override tracking
    if (this.chatAgentSelect) {
      this.chatAgentSelect.addEventListener('change', () => this.onAgentSelectChange());
    }

    // Chat send
    if (this.chatSendBtn) {
      this.chatSendBtn.addEventListener('click', () => this.handleChatSend());
    }
    if (this.chatInput) {
      this.chatInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.handleChatSend(); }
      });
    }

    // QUAL-01: Live character counter
    if (this.chatInput && this.chatCharCount) {
      this.chatInput.addEventListener('input', () => {
        const remaining = 5000 - this.chatInput.value.length;
        this.chatCharCount.textContent = remaining;
        this.chatCharCount.classList.toggle('near-limit', remaining < 200);
      });
    }

    // FEAT-IMG: Image attachment UI (file picker, drag-drop, paste)
    if (typeof this.initAttachmentUI === 'function') {
      this.initAttachmentUI();
    }

    // FEAT-02: Global keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (this.authModal && this.authModal.style.display === 'flex') return;
      const isMeta = e.metaKey || e.ctrlKey;
      if      (isMeta && e.key === 'k') { e.preventDefault(); if (this.chatInput) this.chatInput.focus(); }
      else if (isMeta && e.key === '1') { e.preventDefault(); this.switchTab('feed'); }
      else if (isMeta && e.key === '2') { e.preventDefault(); this.switchTab('raw'); }
      else if (isMeta && e.key === '3') { e.preventDefault(); if (this.chatInput) this.chatInput.focus(); }
      else if (e.key === 'Escape') {
        if (document.activeElement && document.activeElement !== document.body) {
          document.activeElement.blur();
        }
      }
    });
  },

  // -- Auth -----------------------------------------------------------------

  showAuthModal() {
    if (this.authModal) this.authModal.style.display = 'flex';
    if (this.authGatewayInput && this.gatewayToken) this.authGatewayInput.value = this.gatewayToken;
    if (this.authBridgeInput  && this.bridgeToken)  this.authBridgeInput.value  = this.bridgeToken;
  },

  hideAuthModal() {
    if (this.authModal) this.authModal.style.display = 'none';
  },

  submitAuth() {
    const gwToken = this.authGatewayInput ? this.authGatewayInput.value.trim() : '';
    const brToken = this.authBridgeInput  ? this.authBridgeInput.value.trim()  : '';
    if (!brToken && !gwToken) return;
    this.gatewayToken = gwToken;
    this.bridgeToken  = brToken;
    sessionStorage.setItem('gateway_token', gwToken);
    sessionStorage.setItem('bridge_token',  brToken);
    if (this.authError) this.authError.style.display = 'none';
    this.hideAuthModal();
    this.connect();
  },

  // -- Connection -----------------------------------------------------------

  // Update the last "system" feed entry in-place instead of creating a new one.
  // Prevents the activity feed from flashing on rapid reconnect cycles.
  _updateSystemStatus(detail) {
    if (!this.activityFeed) return;
    const last = this.activityFeed.querySelector('.feed-entry[data-feed-action="connection-status"]:last-of-type');
    if (last) {
      const detailEl = last.querySelector('.feed-detail');
      if (detailEl) detailEl.textContent = detail;
      const timeEl = last.querySelector('.feed-time');
      if (timeEl) timeEl.textContent = formatTime(new Date());
      last.title = 'system — ' + detail;
      return;
    }
    // First time — create the entry and tag it
    this.addFeedEntry(null, 'system', detail);
    const newest = this.activityFeed.querySelector('.feed-entry:last-of-type');
    if (newest) newest.dataset.feedAction = 'connection-status';
  },

  connect() {
    if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
    this.setGatewayStatus(false);
    this.setBridgeStatus(false);
    this._updateSystemStatus('Connecting to Bridge...');

    const token = encodeURIComponent(this.bridgeToken || this.gatewayToken);
    const wsUrl = this.bridgeUrl.replace(/^http/, 'ws') + '/ws/mission-control?token=' + token;

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      this._updateSystemStatus('WebSocket creation failed: ' + err.message);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.bridgeConnected = true;
      this.setBridgeStatus(true);
      if (typeof ThemeEngine !== 'undefined') {
        ThemeEngine.fireCinematic('reconnect', {});
      }
      this._updateSystemStatus('Bridge WebSocket connected');
    };

    this.ws.onmessage = evt => {
      let data;
      try { data = JSON.parse(evt.data); } catch (e) { this.addRawEntry(evt.data); return; }
      this.addRawEntry(JSON.stringify(data, null, 2));
      this.onBridgeMessage(data);
    };

    this.ws.onerror = () => { this._updateSystemStatus('Bridge WebSocket error'); };

    this.ws.onclose = evt => {
      this.setBridgeStatus(false);
      if (typeof ThemeEngine !== 'undefined') {
        ThemeEngine.fireCinematic('disconnect', {});
      }
      this.setGatewayStatus(false);
      this._updateSystemStatus('Bridge disconnected (code ' + evt.code + ')');
      this.scheduleReconnect();
    };

    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send('ping');
    }, 25000);
  },

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 3000);
  },

  // -- Bridge message handler -----------------------------------------------

  onBridgeMessage(data) {
    if (data.type === 'snapshot') {
      this.setGatewayStatus(!!data.gateway_connected);
      this._updateSystemStatus(
        'Connected \u2014 Gateway ' + (data.gateway_connected ? 'online' : 'offline') +
        ', ' + (data.buffered_events || 0) + ' buffered events');

      const tel = data.latest_telemetry;
      if (tel && tel.session_key) {
        const agentId = this.resolveAgentId({ sessionKey: tel.session_key });
        if (agentId) {
          const agent = this.getOrCreateAgent(agentId);
          if (tel.state)         agent.state     = tel.state;
          if (tel.llm_model)     agent.model     = tel.llm_model;
          if (tel.input_tokens)  agent.tokensIn  += tel.input_tokens;
          if (tel.output_tokens) agent.tokensOut += tel.output_tokens;
          if (tel.tool_name)     agent.tool      = tel.tool_name;
          if (!agent.firstSeen)  agent.firstSeen = Date.now();
          agent.lastActivity = Date.now();
          this.updateUI();
        }
      }
      return;
    }

    if (data.type === 'heartbeat') { this.setGatewayStatus(!!data.gateway_connected); return; }
    if (data.type === 'pong') return;
    if (data.type !== 'event') return;

    const eventType = data.event;
    const payload   = data.payload || {};

    switch (eventType) {
      case 'agent':         this.handleAgentEvent(payload);         break;
      case 'chat':          this.handleChatEvent(payload);          break;
      case 'health':        this.handleHealthEvent(payload);        break;
      case 'heartbeat':     this.handleHeartbeatEvent(payload);     break;
      case 'routing':       this.handleRoutingEvent(payload);       break;
      case 'task_update':   this.handleTaskUpdateEvent(payload);    break;
      case 'agent_control': this.handleAgentControlEvent(payload);  break;
      case 'tick':          break;
      case 'shutdown':      break; // internal gateway event — not actionable
      default: break; // suppress unknown event types to avoid feed noise
    }

    this.updateUI();
  },

  // -- Event helpers --------------------------------------------------------

  resolveAgentId(payload) {
    const sk = payload.sessionKey || '';
    if (sk.startsWith('agent:')) {
      const parts = sk.split(':');
      if (parts.length >= 2) {
        const agentId = parts[1];
        if (payload.runId) this.runIdMap[payload.runId] = agentId;
        return agentId;
      }
    }
    if (payload.agentId) return payload.agentId;
    if (payload.runId && this.runIdMap[payload.runId]) return this.runIdMap[payload.runId];
    return null;
  },

  // -- Event handlers -------------------------------------------------------

  handleAgentEvent(payload) {
    const agentId = this.resolveAgentId(payload);
    if (!agentId) return;

    const agent = this.getOrCreateAgent(agentId);
    const now   = Date.now();
    const stream = payload.stream || '';
    const data   = payload.data   || {};

    agent.lastActivity = now;
    if (!agent.firstSeen) agent.firstSeen = now;

    if (data.model)    agent.model = data.model;
    if (payload.model) agent.model = payload.model;

    const usage = data.usage || payload.usage;
    if (usage) {
      if (usage.inputTokens)  agent.tokensIn  += usage.inputTokens;
      if (usage.outputTokens) agent.tokensOut += usage.outputTokens;
    }

    switch (stream) {
      case 'chat': {
        const chatPayload = {
          sessionKey: payload.sessionKey,
          runId:      payload.runId,
          state:      data.state || 'final',
          message:    data.message || {
            role:    data.role || 'user',
            content: [{ type: 'text', text: data.text || '' }],
          },
        };
        const chatText = data.text ||
          (data.message && data.message.content && data.message.content[0] && data.message.content[0].text) || '';
        if (chatText) this.handleChatEvent(chatPayload);
        return;
      }

      case 'assistant': {
        agent.state = 'speaking';
        const text = data.text || data.delta || '';
        if (text) {
          agent.lastMessage = truncate(text, 80);
          const parsedModel = extractModelFromText(text);
          if (parsedModel) agent.model = parsedModel;
          agent.tokensOut = estimateTokens(text);
        }
        // Coalesce streaming tokens: update the last feed entry in-place
        // instead of flooding with one entry per token chunk.
        this._updateOrCreateSpeakingEntry(agentId, truncate(text, 120));
        return;
      }

      case 'lifecycle': {
        const phase = data.phase || '';
        if (phase === 'start') {
          agent.state = 'thinking';
          agent._errorTimestamp = null;
          this.addFeedEntry(agentId, 'started', '');
          // Matrix spawn effect when agent starts working
          this.triggerAgentSpawn(agentId);
          if (typeof ThemeEngine !== 'undefined') {
            ThemeEngine.fireCinematic('spawn', { agent: agentId });
          }
        } else if (phase === 'end') {
          agent.state = 'idle';
          agent.tool  = '';
          this.addFeedEntry(agentId, 'done', 'Response complete');
          const runId = payload.runId || '';
          if (runId && this._chatStreamText && this._chatStreamText[runId]) {
            if (!this._shownAgentRunIds.has(runId)) {
              const finalText = this._chatStreamText[runId];
              this._shownAgentRunIds.add(runId);
              this.addChatMessage('agent', agentId, finalText);
            }
            delete this._chatStreamText[runId];
          }
          // QUICK-02: Audio notification on agent task completion
          if (this.audioEnabled) this.playEndBeep();
        } else if (phase === 'error') {
          agent.state = 'error';
          agent.errorCount++;
          agent._errorTimestamp = Date.now();
          if (typeof ThemeEngine !== 'undefined') {
            ThemeEngine.fireCinematic('error', { agent: agentId, error: data.error || 'Unknown error' });
          }
          agent.tool = '';
          this.addFeedEntry(agentId, 'error', truncate(data.error || 'Unknown error', 120));
          // Auto-dismiss error after 30 seconds
          const self = this;
          setTimeout(function() {
            if (agent.state === 'error' && agent._errorTimestamp && Date.now() - agent._errorTimestamp >= 29000) {
              agent.state = 'idle';
              agent._errorTimestamp = null;
              self.updateUI();
            }
          }, 30000);
        }
        return;
      }

      case 'tool': {
        const toolName = data.name || data.tool || '';
        const phase    = data.phase || '';
        if (phase === 'end' || phase === 'result') {
          agent.state = 'thinking';
          agent.tool  = '';
          this.addFeedEntry(agentId, 'tool.end', toolName);
        } else {
          agent.state = 'tool_running';
          agent.tool  = toolName;
          this.addFeedEntry(agentId, 'tool.call', toolName + (data.args ? ': ' + truncate(data.args, 80) : ''));
        }
        return;
      }

      case 'error': {
        this.addFeedEntry(agentId, 'warn', 'Stream error: ' + (data.reason || 'unknown'));
        return;
      }
    }

    // Legacy format: payload.action
    const action = payload.action || '';
    switch (action) {
      case 'thinking':
        agent.state = 'thinking';
        this.addFeedEntry(agentId, 'thinking', payload.model ? 'using ' + payload.model : '');
        break;
      case 'tool.call':
      case 'tool_call':
        agent.state = 'tool_running';
        agent.tool  = payload.tool || payload.toolName || '';
        this.addFeedEntry(agentId, 'tool.call', agent.tool);
        break;
      case 'tool.end':
      case 'tool_end':
        agent.state = 'thinking';
        agent.tool  = '';
        this.addFeedEntry(agentId, 'tool.end', payload.tool || '');
        break;
      case 'done':
        agent.state = 'idle';
        this.addFeedEntry(agentId, 'done', '');
        break;
      case 'error':
        agent.state = 'error';
        agent.errorCount++;
        agent._errorTimestamp = Date.now();
        this.addFeedEntry(agentId, 'error', truncate(payload.message || payload.error || '', 100));
        // Auto-dismiss error after 30 seconds
        var self2 = this;
        setTimeout(function() {
          if (agent.state === 'error' && agent._errorTimestamp && Date.now() - agent._errorTimestamp >= 29000) {
            agent.state = 'idle';
            agent._errorTimestamp = null;
            self2.updateUI();
          }
        }, 30000);
        break;
      default:
        if (action) this.addFeedEntry(agentId, action, truncate(JSON.stringify(payload), 100));
        break;
    }
  },

  handleChatEvent(payload) {
    const agentId = this.resolveAgentId(payload);
    const msg   = payload.message || {};
    const role  = msg.role || payload.role || '';
    const state = payload.state || '';
    const runId = payload.runId  || '';
    const now   = Date.now();

    let text = '';
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) text += block.text;
      }
    }
    if (!text) text = msg.text || payload.text || payload.content || '';
    if (!text) return;

    if (agentId) {
      const agent = this.getOrCreateAgent(agentId);
      agent.lastActivity = now;
      if (!agent.firstSeen) agent.firstSeen = now;
    }

    if (role === 'user' || role === 'in' || role === 'incoming') {
      if (runId && this._lastChatUserRunId === runId) return;
      if (runId) this._lastChatUserRunId = runId;

      if (this._mcSentMessages && this._mcSentMessages.length > 0) {
        const cutoff = Date.now() - 30000;
        const idx = this._mcSentMessages.findIndex(m => m.ts > cutoff && m.text === text);
        if (idx !== -1) { this._mcSentMessages.splice(idx, 1); return; }
      }

      if (agentId) {
        const agent = this.agents[agentId];
        if (agent) { agent.state = 'thinking'; agent.tokensIn += estimateTokens(text); }
      }
      this.addFeedEntry(agentId, 'chat.in', truncate(text, 120));
      this.addChatMessage('user', null, text);
      return;
    }

    if (role === 'assistant' || role === 'out' || role === 'outgoing') {
      if (agentId) {
        const agent = this.agents[agentId];
        if (agent) {
          agent.state = 'speaking';
          agent.lastMessage = truncate(text, 80);
          const chatModel = extractModelFromText(text);
          if (chatModel) agent.model = chatModel;
          agent.tokensOut = estimateTokens(text);
        }
      }

      if (state === 'delta') {
        if (runId) { if (!this._chatStreamText) this._chatStreamText = {}; this._chatStreamText[runId] = text; }
        return;
      }

      if (runId && this._shownAgentRunIds.has(runId)) return;

      let finalText = text;
      if (runId && this._chatStreamText && this._chatStreamText[runId]) {
        finalText = this._chatStreamText[runId];
        delete this._chatStreamText[runId];
      }

      if (runId) this._shownAgentRunIds.add(runId);
      if (this._shownAgentRunIds.size > 100) {
        const first = this._shownAgentRunIds.values().next().value;
        this._shownAgentRunIds.delete(first);
      }

      this.addFeedEntry(agentId, 'chat.out', truncate(finalText, 120));
      this.addChatMessage('agent', agentId, finalText);
    }
  },

  handleRoutingEvent(payload) {
    const from      = payload.from || 'orchestrator';
    const to        = payload.to   || 'unknown';
    const task      = payload.task || '';
    const emoji     = this.agentEmoji(to);
    const fromEmoji = this.agentEmoji(from);
    const isSwarm   = payload.swarm || false;
    const isResponseBack = payload.response_back || false;

    if (isResponseBack) {
      // Response flowing back to the requester (synthesis loop)
      this.addFeedEntry(from, 'route',
        fromEmoji + ' \u21A9 ' + emoji + ' ' + this.agentDisplayName(to) + ' [response]: ' + truncate(task, 50));
      this.addChatMessage('system', null,
        fromEmoji + ' ' + this.agentDisplayName(from) + ' returned result to ' + emoji + ' ' + this.agentDisplayName(to));
      // Trigger visual: dispatch ripple on the returning agent
      this.triggerDispatchRipple(from);
    } else if (isSwarm) {
      // Peer-to-peer swarm dispatch (any agent to any agent)
      this.addFeedEntry(from, 'route',
        fromEmoji + ' \u2192 ' + emoji + ' ' + this.agentDisplayName(to) + ' [swarm]: ' + truncate(task, 50));
      this.addChatMessage('system', null,
        fromEmoji + ' ' + this.agentDisplayName(from) + ' dispatched to ' + emoji + ' ' + this.agentDisplayName(to));
      // Trigger visual: dispatch ripple on sender + indicator showing target
      this.triggerDispatchRipple(from);
      this.showDispatchIndicator(from, to);
      // Auto-hide indicator after 3 seconds
      setTimeout(() => this.hideDispatchIndicator(from), 3000);
    } else {
      // Legacy orchestrator-only routing
      this.addFeedEntry(from, 'route',
        fromEmoji + ' \u2192 ' + emoji + ' ' + this.agentDisplayName(to) + ': ' + truncate(task, 60));
      this.addChatMessage('system', null,
        fromEmoji + ' Orchestrator routing to ' + emoji + ' ' + this.agentDisplayName(to));
      // Trigger visual: dispatch ripple on orchestrator
      this.triggerDispatchRipple(from);
      this.showDispatchIndicator(from, to);
      setTimeout(() => this.hideDispatchIndicator(from), 3000);
    }

    // FEAT-VIZ: SVG connection line between panels
    if (typeof this.addConnection === 'function') {
      this.addConnection(from, to, task, isResponseBack);
    }
  },

  handleTaskUpdateEvent(payload) {
    const action = payload.action;

    if (action === 'created') {
      const assignee = payload.assignee || 'unknown';
      const from = payload.from || '';
      const emoji = this.agentEmoji(assignee);
      const fromEmoji = from ? this.agentEmoji(from) + ' ' : '';
      this.addFeedEntry(assignee, 'system',
        '\u{1F4CB} ' + fromEmoji + '\u2192 ' + emoji + ' ' + this.agentDisplayName(assignee) +
        ': ' + truncate(payload.title || 'New task', 50));
    } else if (action === 'completed') {
      const agent = payload.agent || 'unknown';
      const emoji = this.agentEmoji(agent);
      this.addFeedEntry(agent, 'system',
        '\u2705 ' + emoji + ' ' + this.agentDisplayName(agent) + ' completed task');
    } else if (action === 'failed') {
      const agent = payload.agent || 'unknown';
      const emoji = this.agentEmoji(agent);
      const err = payload.error ? ': ' + truncate(payload.error, 60) : '';
      this.addFeedEntry(agent, 'error',
        '\u274C ' + emoji + ' ' + this.agentDisplayName(agent) + ' task failed' + err);
    } else if (action === 'unblocked' && payload.task_ids) {
      const count = payload.task_ids.length;
      this.addFeedEntry(null, 'system',
        '\u{1F513} ' + count + ' task' + (count > 1 ? 's' : '') + ' unblocked');
    }

    // Refresh kanban board for any task_update event
    if (typeof this._loadTasks === 'function') {
      this._loadTasks();
    }
  },

  handleAgentControlEvent(payload) {
    const agentId = payload.agent_id || payload.agentId;
    const action  = payload.action || '';
    const status  = payload.status || 'ok';

    if (!agentId) return;

    const agent = this.getOrCreateAgent(agentId);
    const meta  = AGENTS[agentId] || { emoji: '\uD83E\uDD16', name: agentId };

    switch (action) {
      case 'pause':
        agent._paused = true;
        this.addFeedEntry(agentId, 'system',
          '\u23F8 ' + meta.emoji + ' ' + meta.name + ' paused');
        break;
      case 'resume':
        agent._paused = false;
        this.addFeedEntry(agentId, 'system',
          '\u25B6 ' + meta.emoji + ' ' + meta.name + ' resumed');
        break;
      case 'stop':
        agent._paused = false;
        agent.state = 'idle';
        agent.tool = '';
        this.addFeedEntry(agentId, 'system',
          '\u23F9 ' + meta.emoji + ' ' + meta.name + ' stopped');
        break;
      case 'reassign':
        const targetId = payload.target_agent_id || '';
        const targetMeta = AGENTS[targetId] || { emoji: '\uD83E\uDD16', name: targetId };
        this.addFeedEntry(agentId, 'system',
          '\uD83D\uDD04 Task reassigned from ' + meta.emoji + ' ' + meta.name +
          ' to ' + targetMeta.emoji + ' ' + targetMeta.name);
        break;
      default:
        this.addFeedEntry(agentId, 'system', 'Agent control: ' + action);
    }

    // Update control button visibility
    if (typeof this._updateAgentControlButtons === 'function') {
      this._updateAgentControlButtons(agentId);
    }
  },

  handleHealthEvent(payload) {
    // Only log health changes to the feed — skip routine OK pings (every 3s)
    // to avoid flooding the activity tab with flashing entries.
    const newState = payload.ok ? 'OK' : 'UNHEALTHY';
    if (newState !== this._lastHealthState) {
      this._lastHealthState = newState;
      this.addFeedEntry(null, 'health', newState);
    }
  },

  handleHeartbeatEvent(payload) {
    const agentId = payload.agentId || 'unknown';
    const agent   = this.getOrCreateAgent(agentId);
    const now     = Date.now();
    agent.lastActivity = now;
    if (!agent.firstSeen) agent.firstSeen = now;
    if (agent.state === 'error' && agent._errorTimestamp && (now - agent._errorTimestamp > 30000)) {
      // Heartbeat clears stale errors older than 30s
      agent.state = 'idle';
      agent._errorTimestamp = null;
    } else if (agent.state !== 'error') {
      if (agent.state === 'idle' || !agent.state) agent.state = 'idle';
    }
  },

});
