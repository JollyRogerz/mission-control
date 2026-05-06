'use strict';

// ---------------------------------------------------------------------------
// AgentPanel.js — agent UI updates, tool-aware animations, speech bubbles,
//                 matrix spawn/despawn, dispatch indicators, per-agent sounds
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------

// QUICK-01: State badge tooltip labels
const STATE_TOOLTIPS = {
  idle:         'idle: agent is waiting for work',
  thinking:     'thinking: agent is processing your request',
  tool_running: 'tool_running: agent is executing a tool',
  reading:      'reading: agent is scanning files or searching',
  writing:      'writing: agent is editing or writing code',
  dispatching:  'dispatching: agent is routing to another agent',
  speaking:     'speaking: agent is sending a response',
  error:        'error: agent encountered an error',
  starting:     'starting: agent is coming online',
  stopping:     'stopping: agent is shutting down',
  completed:    'completed: agent finished its task',
};

// ── Tool → animation state mapping (inspired by pixel-agents) ──────────────
// Pixel-agents: READING_TOOLS = Read, Grep, Glob, WebFetch, WebSearch
// We add writing tools and dispatch detection
const READING_TOOLS = new Set([
  'search', 'grep', 'find', 'read', 'browse', 'fetch', 'scan', 'analyze',
  'web_search', 'web_fetch', 'glob', 'list', 'cat', 'head', 'tail',
]);

const WRITING_TOOLS = new Set([
  'write', 'edit', 'create', 'update', 'insert', 'replace', 'delete',
  'patch', 'modify', 'code', 'refactor', 'generate',
]);

const DISPATCH_TOOLS = new Set([
  'dispatch', 'route', 'delegate', 'assign', 'forward',
]);

/**
 * Determine the visual animation state from the agent's raw state + current tool.
 * Returns one of: idle, thinking, reading, writing, dispatching, tool_running,
 *                 speaking, error, starting, stopping, completed
 */
function resolveVisualState(rawState, toolName) {
  // Non-tool states pass through unchanged
  if (!rawState || rawState === 'idle' || rawState === 'error' ||
      rawState === 'starting' || rawState === 'stopping' ||
      rawState === 'speaking' || rawState === 'completed') {
    return rawState || 'idle';
  }

  // For tool_running, inspect the tool name for sub-category
  if (rawState === 'tool_running' && toolName) {
    const lower = toolName.toLowerCase();
    // Check dispatch first (highest priority)
    for (const kw of DISPATCH_TOOLS) {
      if (lower.includes(kw)) return 'dispatching';
    }
    // Check reading
    for (const kw of READING_TOOLS) {
      if (lower.includes(kw)) return 'reading';
    }
    // Check writing
    for (const kw of WRITING_TOOLS) {
      if (lower.includes(kw)) return 'writing';
    }
    // Default: generic tool_running
    return 'tool_running';
  }

  return rawState;
}

/**
 * Get the tool category for speech bubble dot color
 */
function toolCategory(toolName) {
  if (!toolName) return 'think';
  const lower = toolName.toLowerCase();
  for (const kw of DISPATCH_TOOLS) { if (lower.includes(kw)) return 'dispatch'; }
  for (const kw of READING_TOOLS)  { if (lower.includes(kw)) return 'read'; }
  for (const kw of WRITING_TOOLS)  { if (lower.includes(kw)) return 'write'; }
  return 'run';
}

// ── Per-agent sounds now handled by SoundEngine.js ──
// (Replaced _playAgentNote with comprehensive procedural sound engine)


// ── Speech bubble management ────────────────────────────────────────────────
// Track active bubbles to avoid re-creating on every frame
const _activeBubbles = {};
const _bubbleTimers = {};

function _showSpeechBubble(spriteContainer, agentId, toolName) {
  if (!spriteContainer || !toolName) return;

  // Already showing this tool?
  if (_activeBubbles[agentId] === toolName) return;
  _activeBubbles[agentId] = toolName;

  // Remove existing bubble
  _removeSpeechBubble(spriteContainer, agentId);

  const bubble = document.createElement('div');
  bubble.className = 'agent-speech-bubble';
  bubble.id = 'bubble-' + agentId;

  const dot = document.createElement('span');
  dot.className = 'bubble-dot cat-' + toolCategory(toolName);
  bubble.appendChild(dot);

  const text = document.createTextNode(toolName);
  bubble.appendChild(text);

  spriteContainer.appendChild(bubble);

  // After initial appear, switch to floating
  clearTimeout(_bubbleTimers[agentId]);
  _bubbleTimers[agentId] = setTimeout(() => {
    if (bubble.parentElement) bubble.classList.add('floating');
  }, 350);
}

function _removeSpeechBubble(spriteContainer, agentId) {
  delete _activeBubbles[agentId];
  clearTimeout(_bubbleTimers[agentId]);
  const existing = document.getElementById('bubble-' + agentId);
  if (existing) existing.remove();
}


// ── Matrix spawn/despawn ────────────────────────────────────────────────────
const _matrixTimers = {};

function _triggerMatrixSpawn(spriteContainer, agentId) {
  if (!spriteContainer) return;
  spriteContainer.classList.remove('matrix-despawn');
  spriteContainer.classList.add('matrix-spawn');
  clearTimeout(_matrixTimers[agentId]);
  _matrixTimers[agentId] = setTimeout(() => {
    spriteContainer.classList.remove('matrix-spawn');
  }, 900); // Slightly longer than the 0.8s animation
}

function _triggerMatrixDespawn(spriteContainer, agentId) {
  if (!spriteContainer) return;
  spriteContainer.classList.remove('matrix-spawn');
  spriteContainer.classList.add('matrix-despawn');
  clearTimeout(_matrixTimers[agentId]);
  _matrixTimers[agentId] = setTimeout(() => {
    spriteContainer.classList.remove('matrix-despawn');
  }, 900);
}


// ── Dispatch ripple effect ──────────────────────────────────────────────────

function _triggerDispatchRipple(spriteContainer) {
  if (!spriteContainer) return;
  // Create 3 staggered ripple rings
  for (let i = 1; i <= 3; i++) {
    const ripple = document.createElement('div');
    ripple.className = 'dispatch-ripple' + (i > 1 ? ' ring-' + i : '');
    spriteContainer.appendChild(ripple);
    // Auto-cleanup
    setTimeout(() => ripple.remove(), 1000);
  }
}


// ── Dispatch indicator badge ────────────────────────────────────────────────
const _activeDispatches = {};

function _showDispatchIndicator(spriteContainer, agentId, targetName) {
  if (!spriteContainer || !targetName) return;
  if (_activeDispatches[agentId]) return; // already showing
  _activeDispatches[agentId] = true;

  const indicator = document.createElement('div');
  indicator.className = 'dispatch-indicator';
  indicator.id = 'dispatch-' + agentId;

  const arrow = document.createElement('span');
  arrow.className = 'dispatch-arrow';
  arrow.textContent = '\u2192'; // →
  indicator.appendChild(arrow);

  const text = document.createTextNode(targetName.toUpperCase());
  indicator.appendChild(text);

  spriteContainer.appendChild(indicator);
}

function _removeDispatchIndicator(spriteContainer, agentId) {
  delete _activeDispatches[agentId];
  const existing = document.getElementById('dispatch-' + agentId);
  if (existing) existing.remove();
}


// ── Previous states for transition detection ────────────────────────────────
const _prevStates = {};

// ── Theme vocabulary — reset original labels on theme switch ────────────────
document.addEventListener('theme-changed', function() {
  // Pitfall #6 guard: skip entirely if initAgents() hasn't populated the cache yet
  var mc = window._missionControl;
  if (!mc || !mc._agents || !mc._agents.length) return;

  // Restore original detail labels
  document.querySelectorAll('.detail-label[data-orig-label]').forEach(function(label) {
    label.textContent = label.getAttribute('data-orig-label');
  });
  // Restore original panel titles using the dynamic agent cache
  mc._agents.forEach(function(agent) {
    var cardEl = document.getElementById('card-' + agent.id);
    if (!cardEl) return;
    var titleEl = cardEl.querySelector('.panel-title');
    if (titleEl) titleEl.textContent = (agent.emoji || '') + ' ' + (agent.display_name || agent.id).toUpperCase();
  });
});


Object.assign(MissionControl.prototype, {

  /**
   * Fetch agents from /api/agents and clone the W1 template into the grid.
   * Stores the result in this._agents (shared cache for ChatManager and SoundEngine).
   * Also registers window._missionControl so module-scope listeners can reach the cache.
   */
  async initAgents() {
    // Register on window so module-scope event listeners (theme-changed, etc.) can reach the cache
    window._missionControl = this;

    try {
      const resp = await fetch('/api/agents', { headers: { 'Content-Type': 'application/json' } });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const agents = await resp.json();
      this._agents = agents;

      const template = document.getElementById('agent-card-template');
      const grid = document.querySelector('.agent-grid');

      if (template && grid) {
        agents.forEach((agent, index) => {
          const clone = template.content.cloneNode(true);
          const card = clone.querySelector('.agent-card');
          if (!card) return;

          // Replace AGENT_ID placeholder in all descendant element IDs
          card.querySelectorAll('[id]').forEach(el => {
            el.id = el.id.replace('AGENT_ID', agent.id);
          });

          // Set card-level attributes per D2/D3/D6
          card.id = 'card-' + agent.id;
          card.dataset.agentIndex = index;   // D6: CSS [data-agent-index="N"]::after, W3 SoundEngine
          card.dataset.agentId = agent.id;   // D3: event delegation

          // Populate static display fields if present in the template
          const titleEl = card.querySelector('.panel-title');
          if (titleEl) titleEl.textContent = (agent.emoji || '') + ' ' + (agent.display_name || agent.id).toUpperCase();

          grid.appendChild(clone);
        });
      }
    } catch (err) {
      console.error('[AgentPanel] initAgents() failed:', err);
      // Fallback: empty cache so guards in updateAgentPanels/theme-changed don't throw
      this._agents = [];
    }

    // Wire agent controls now that cards exist in the DOM
    if (typeof this.initAgentControls === 'function') this.initAgentControls();
  },

  updateUI() {
    this.updateAgentPanels();
  },

  updateAgentPanels() {
    if (!this._agents || !this._agents.length) return;

    // Get theme vocabulary once per update cycle
    var vocab = (typeof ThemeEngine !== 'undefined') ? ThemeEngine.getVocabulary() : null;

    this._agents.forEach((agentDef, agentIndex) => {
      const agentId = agentDef.id;
      const agent = this.agents[agentId];
      if (!agent) return;

      const rawState = agent.state || 'idle';
      const toolName = agent.tool || null;

      // Resolve to visual state based on tool (pixel-agents approach)
      const visualState = resolveVisualState(rawState, toolName);

      // ── Apply vocabulary overrides ──
      // Panel title (e.g., "ORCHESTRATOR" → "ORCHESTRATOR.exe")
      var cardEl0 = document.getElementById('card-' + agentId);
      var panelTitle = cardEl0 ? cardEl0.querySelector('.panel-title') : null;
      if (panelTitle && vocab && typeof vocab.getAgentLabel === 'function') {
        panelTitle.textContent = vocab.getAgentLabel(agentDef, agentIndex);
      }

      // State text — use theme-specific state label if available
      const stateEl = document.getElementById('state-' + agentId);
      if (stateEl) {
        var stateText = visualState;
        if (vocab && vocab.stateLabels && vocab.stateLabels[visualState]) {
          stateText = vocab.stateLabels[visualState];
        }
        stateEl.textContent = stateText;
        stateEl.className   = 'detail-value state-' + visualState;
        stateEl.title       = STATE_TOOLTIPS[visualState] || visualState;
      }

      // Detail labels — override "State", "Model", "Tool" etc.
      if (vocab && vocab.detailLabels) {
        var detailsEl = document.getElementById('card-' + agentId);
        if (detailsEl) {
          var labels = detailsEl.querySelectorAll('.detail-label');
          labels.forEach(function(label) {
            var origText = label.getAttribute('data-orig-label') || label.textContent;
            if (!label.getAttribute('data-orig-label')) {
              label.setAttribute('data-orig-label', origText);
            }
            if (vocab.detailLabels[origText]) {
              label.textContent = vocab.detailLabels[origText];
            }
          });
        }
      }

      // Model
      const modelEl = document.getElementById('model-' + agentId);
      if (modelEl) modelEl.textContent = agent.model || '\u2014';

      // Tool — use theme-specific tool label if available
      const toolEl = document.getElementById('tool-' + agentId);
      if (toolEl) {
        var toolText = toolName || '\u2014';
        if (vocab && vocab.toolLabel && toolName) {
          toolText = vocab.toolLabel(toolName);
        }
        toolEl.textContent = toolText;
      }

      // Tokens
      const tokensEl = document.getElementById('tokens-' + agentId);
      if (tokensEl) {
        const prefix = (agent.tokensIn > 0 || agent.tokensOut > 0) ? '~' : '';
        tokensEl.textContent =
          prefix + this.formatTokenCount(agent.tokensIn) + ' / ' +
          prefix + this.formatTokenCount(agent.tokensOut);
      }

      // Error count (click to dismiss)
      const errorsEl = document.getElementById('errors-' + agentId);
      if (errorsEl) {
        errorsEl.textContent = agent.errorCount;
        if (agent.errorCount > 0) {
          errorsEl.style.color = 'var(--color-error)';
          errorsEl.style.cursor = 'pointer';
          errorsEl.title = 'Click to dismiss errors';
        } else {
          errorsEl.style.color = '';
          errorsEl.style.cursor = '';
          errorsEl.title = '';
        }
        // Attach click handler once
        if (!errorsEl._dismissHandler) {
          const mc = this;
          errorsEl._dismissHandler = function() {
            if (agent.errorCount > 0) {
              agent.errorCount = 0;
              agent._errorTimestamp = null;
              if (agent.state === 'error') agent.state = 'idle';
              mc.updateUI();
            }
          };
          errorsEl.addEventListener('click', errorsEl._dismissHandler);
        }
      }

      // FEAT-VIZ: Record state change for activity timeline
      if (typeof this.recordStateChange === 'function') {
        this.recordStateChange(agentId, visualState);
      }

      // Sprite container — apply visual state class
      const spriteContainer = document.getElementById('sprite-' + agentId);
      if (spriteContainer) {
        // Strip old state classes (but preserve matrix-spawn/matrix-despawn)
        spriteContainer.className =
          spriteContainer.className
            .replace(/\bstate-\S+/g, '')
            .trim() + ' state-' + visualState;

        // Notify ThemeEngine for theme-specific reactions
        if (typeof ThemeEngine !== 'undefined') {
          ThemeEngine.notifyAgentStateChange(agentId, visualState);
        }

        // ── Speech bubble: show tool name when running ──
        if (toolName && rawState === 'tool_running') {
          _showSpeechBubble(spriteContainer, agentId, toolName);
        } else {
          _removeSpeechBubble(spriteContainer, agentId);
        }

        // ── Transition detection for matrix rain + sounds ──
        const prevState = _prevStates[agentId];

        // Agent came online → matrix spawn + spawn sound
        if (prevState === 'idle' && rawState === 'starting') {
          _triggerMatrixSpawn(spriteContainer, agentId);
          if (typeof this.playSpawnSound === 'function') this.playSpawnSound(agentId);
        }

        // Agent going offline → matrix despawn + despawn sound
        if (prevState !== 'stopping' && rawState === 'stopping') {
          _triggerMatrixDespawn(spriteContainer, agentId);
          if (typeof this.playDespawnSound === 'function') this.playDespawnSound(agentId);
        }

        // Entering thinking state → radar ping
        if (visualState === 'thinking' && prevState !== 'thinking') {
          if (typeof this.playThinkingPing === 'function') this.playThinkingPing(agentId);
        }

        // Entering tool_running → mechanical whir
        if (rawState === 'tool_running' && prevState !== 'tool_running') {
          if (typeof this.playToolWhir === 'function') this.playToolWhir(agentId);
        }

        // Dispatch: entering dispatching state → ripple + indicator + whoosh
        if (visualState === 'dispatching' && prevState !== 'dispatching') {
          _triggerDispatchRipple(spriteContainer);
          const dispatchTarget = toolName || 'agent';
          _showDispatchIndicator(spriteContainer, agentId, dispatchTarget);
          if (typeof this.playDispatchWhoosh === 'function') this.playDispatchWhoosh(agentId);
        } else if (visualState !== 'dispatching') {
          _removeDispatchIndicator(spriteContainer, agentId);
        }

        // Agent completed a task → chat receive sound
        if (prevState === 'tool_running' && rawState === 'speaking') {
          if (typeof this.playChatReceive === 'function') this.playChatReceive(agentId);
        }
        if (prevState !== 'completed' && rawState === 'completed') {
          if (typeof this.playChatReceive === 'function') this.playChatReceive(agentId);
        }

        // Error state → glitchy alarm
        if (rawState === 'error' && prevState !== 'error') {
          if (typeof this.playError === 'function') this.playError(agentId);
        }

        _prevStates[agentId] = rawState;

        // Push sparkline data point for activity visualization
        if (typeof this._pushSparklinePoint === 'function') {
          this._pushSparklinePoint(agentId, visualState);
        }
      }

      // Card active state
      const cardEl = document.getElementById('card-' + agentId);
      if (cardEl) cardEl.classList.toggle('active', rawState !== 'idle');

      // Update agent control buttons (pause/resume/stop/reassign)
      if (typeof this._updateAgentControlButtons === 'function') {
        this._updateAgentControlButtons(agentId);
      }

      // FEAT-LAYOUT: Update chat-page dynamic sidebar mini-cards
      const chatMini = document.getElementById('chat-agent-' + agentId);
      if (chatMini) {
        const isActive = rawState !== 'idle';
        chatMini.style.display = isActive ? 'flex' : 'none';
        const chatStateEl = document.getElementById('chat-state-' + agentId);
        if (chatStateEl) {
          chatStateEl.textContent = visualState;
          chatStateEl.className = 'chat-agent-state state-' + visualState;
        }
        const chatToolEl = document.getElementById('chat-tool-' + agentId);
        if (chatToolEl) chatToolEl.textContent = toolName || '\u2014';
      }
    });

    // FEAT-LAYOUT: Show/hide "no active agents" placeholder in chat sidebar
    const emptyEl = document.getElementById('chat-agent-empty');
    if (emptyEl) {
      const anyActive = this._agents.some(agentDef => {
        const a = this.agents[agentDef.id];
        return a && a.state && a.state !== 'idle';
      });
      emptyEl.style.display = anyActive ? 'none' : 'block';
    }
  },

  // ── Public API for external callers (EventHandler, etc.) ──

  /** Trigger matrix spawn effect from outside (e.g., agent connect event) */
  triggerAgentSpawn(agentId) {
    const container = document.getElementById('sprite-' + agentId);
    if (container) _triggerMatrixSpawn(container, agentId);
  },

  /** Trigger matrix despawn effect from outside */
  triggerAgentDespawn(agentId) {
    const container = document.getElementById('sprite-' + agentId);
    if (container) _triggerMatrixDespawn(container, agentId);
  },

  /** Trigger dispatch ripple from outside (e.g., swarm routing event) */
  triggerDispatchRipple(agentId) {
    const container = document.getElementById('sprite-' + agentId);
    if (container) _triggerDispatchRipple(container);
  },

  /** Show dispatch indicator from outside */
  showDispatchIndicator(fromAgentId, targetAgentId) {
    const container = document.getElementById('sprite-' + fromAgentId);
    if (container) _showDispatchIndicator(container, fromAgentId, targetAgentId);
  },

  /** Hide dispatch indicator from outside */
  hideDispatchIndicator(agentId) {
    const container = document.getElementById('sprite-' + agentId);
    if (container) _removeDispatchIndicator(container, agentId);
  },

  // ── Agent Control API ────────────────────────────────────────────────────

  /**
   * Initialize agent control buttons on each agent card.
   * Called once after DOM is ready.
   */
  initAgentControls() {
    (this._agents || []).forEach((agentDef) => {
      const agentId = agentDef.id;
      const card = document.getElementById('card-' + agentId);
      if (!card) return;
      // Don't add twice
      if (card.querySelector('.agent-controls')) return;

      const controls = document.createElement('div');
      controls.className = 'agent-controls';
      controls.innerHTML =
        '<button class="agent-ctrl-btn ctrl-pause" data-action="pause" title="Pause agent">\u23F8</button>' +
        '<button class="agent-ctrl-btn ctrl-resume" data-action="resume" title="Resume agent" style="display:none">\u25B6</button>' +
        '<button class="agent-ctrl-btn ctrl-stop" data-action="stop" title="Stop agent">\u23F9</button>' +
        '<button class="agent-ctrl-btn ctrl-reassign" data-action="reassign" title="Reassign task">\uD83D\uDD04</button>';

      // Wire up click handlers
      controls.querySelectorAll('.agent-ctrl-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          this._handleAgentControl(agentId, action);
        });
      });

      card.appendChild(controls);
    });
  },

  /**
   * Handle agent control button clicks.
   */
  async _handleAgentControl(agentId, action) {
    const agent = this.agents[agentId];
    const agentDef = (this._agents || []).find(a => a.id === agentId) || { id: agentId, display_name: agentId };

    if (action === 'stop') {
      if (!confirm('Stop agent ' + (agentDef.display_name || agentDef.id) + '? This will terminate its current task.')) return;
    }

    if (action === 'reassign') {
      // Show reassign dialog: pick target agent
      const otherAgentDefs = (this._agents || []).filter(a => a.id !== agentId);
      if (otherAgentDefs.length === 0) {
        alert('No other agents available for reassignment.');
        return;
      }
      const names = otherAgentDefs.map((a, i) => (i + 1) + '. ' + (a.display_name || a.id));
      const choice = prompt('Reassign to which agent?\n\n' + names.join('\n') + '\n\nEnter number:');
      if (!choice) return;
      const idx = parseInt(choice, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= otherAgentDefs.length) {
        alert('Invalid selection.');
        return;
      }
      const targetAgent = otherAgentDefs[idx].id;
      return this._sendAgentControlRequest(agentId, 'reassign', { target_agent_id: targetAgent });
    }

    return this._sendAgentControlRequest(agentId, action);
  },

  /**
   * Send control request to bridge API.
   */
  async _sendAgentControlRequest(agentId, action, extraData) {
    try {
      const body = extraData ? JSON.stringify(extraData) : '{}';
      const res = await fetch(this.bridgeUrl + '/api/agents/' + encodeURIComponent(agentId) + '/' + action, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
        body: body,
      });
      if (res.ok) {
        const result = await res.json();
        this.addFeedEntry(agentId, 'system', 'Agent control: ' + action + ' sent');
        // Play corresponding sound
        if (action === 'pause' && typeof this.playAgentPause === 'function') this.playAgentPause(agentId);
        if (action === 'resume' && typeof this.playAgentResume === 'function') this.playAgentResume(agentId);
        if (action === 'stop' && typeof this.playAgentStop === 'function') this.playAgentStop(agentId);
      } else {
        const errText = await res.text().catch(() => 'Unknown error');
        this.addFeedEntry(agentId, 'error', 'Agent control failed: ' + truncate(errText, 80));
      }
    } catch (e) {
      this.addFeedEntry(agentId, 'error', 'Agent control error: ' + e.message);
    }
  },

  /**
   * Update agent control button visibility based on paused state.
   */
  _updateAgentControlButtons(agentId) {
    const card = document.getElementById('card-' + agentId);
    if (!card) return;
    const agent = this.agents[agentId];
    const isPaused = agent && agent._paused;
    const isActive = agent && agent.state && agent.state !== 'idle';

    const controls = card.querySelector('.agent-controls');
    if (controls) {
      // Show controls only when agent is active
      controls.style.display = isActive ? 'flex' : 'none';

      // Toggle pause/resume
      const pauseBtn = controls.querySelector('.ctrl-pause');
      const resumeBtn = controls.querySelector('.ctrl-resume');
      if (pauseBtn) pauseBtn.style.display = isPaused ? 'none' : '';
      if (resumeBtn) resumeBtn.style.display = isPaused ? '' : 'none';
    }

    // Apply paused overlay
    const spriteContainer = document.getElementById('sprite-' + agentId);
    if (spriteContainer) {
      spriteContainer.classList.toggle('agent-paused', !!isPaused);
    }
  },

  updateUptimes() {
    const now = Date.now();
    (this._agents || []).forEach((agentDef) => {
      const agentId = agentDef.id;
      const agent = this.agents[agentId];
      if (!agent) return;

      const uptimeEl = document.getElementById('uptime-' + agentId);
      if (uptimeEl) {
        uptimeEl.textContent = agent.firstSeen ? formatUptime(now - agent.firstSeen) : '\u2014';
      }

      // FEAT-03: Last seen
      const lastSeenEl = document.getElementById('lastseen-' + agentId);
      if (lastSeenEl) {
        lastSeenEl.textContent = agent.lastActivity ? formatLastSeen(now - agent.lastActivity) : '\u2014';
      }
    });
  },

  formatTokenCount(n) {
    if (!n || n === 0) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(1) + 'k';
    return String(n);
  },

  _connectionStateLabel(connected, hasReconnectTimer) {
    if (connected)          return 'connected';
    if (hasReconnectTimer)  return 'reconnecting';
    return 'disconnected';
  },

  setGatewayStatus(connected) {
    this.gatewayConnected = connected;
    if (this.gatewayDot) {
      this.gatewayDot.classList.toggle('connected', connected);
      this.gatewayDot.title =
        'Gateway \u2014 OpenClaw Docker via bridge relay \u00b7 ' +
        this._connectionStateLabel(connected, !!this.reconnectTimer);
    }
  },

  setBridgeStatus(connected) {
    this.bridgeConnected = connected;
    if (this.bridgeDot) {
      this.bridgeDot.classList.toggle('connected', connected);
      this.bridgeDot.title =
        'Bridge \u2014 HTTP/WS to bridge_server.py \u00b7 ' +
        this._connectionStateLabel(connected, !!this.reconnectTimer);
    }
    const hb = document.getElementById('heartbeat-indicator');
    if (hb) hb.classList.toggle('dead', !connected);
  },

  // ── Activity Sparklines ────────────────────────────────────────────────────

  _initSparklineData(agentId) {
    if (!this._sparklineData) this._sparklineData = {};
    if (!this._sparklineData[agentId]) {
      this._sparklineData[agentId] = new Array(40).fill(0);
    }
  },

  _redrawSparkline(agentId) {
    const card = document.getElementById('card-' + agentId);
    if (!card) return;
    const canvas = card.querySelector('.agent-sparkline');
    if (!canvas) return;
    const data = this._sparklineData[agentId];
    if (!data) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim() || '#3d4a5c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < data.length; i++) {
      var x = (i / (data.length - 1)) * w;
      var y = h - (data[i] * h);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  },

  _pushSparklinePoint(agentId, state) {
    this._initSparklineData(agentId);
    this._sparklineData[agentId].push(state === 'idle' ? 0 : 0.8);
    this._sparklineData[agentId].shift();
    this._redrawSparkline(agentId);
  },

});
