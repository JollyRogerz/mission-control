'use strict';

// ---------------------------------------------------------------------------
// ChatManager.js — chat sending, messages, export, and bridge health
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------

Object.assign(MissionControl.prototype, {

  async handleChatSend() {
    if (!this.chatInput) return;
    const text = this.chatInput.value.trim();
    const hasAttachment = !!(this._attachedImageData);
    if (!text && !hasAttachment) return;
    if (this.chatSendBtn && this.chatSendBtn.disabled) return;

    this.chatInput.value = '';

    // QUAL-01: reset counter after send
    if (this.chatCharCount) {
      this.chatCharCount.textContent = '5000';
      this.chatCharCount.classList.remove('near-limit');
    }

    const selectedAgent = this.chatAgentSelect ? this.chatAgentSelect.value : '';

    // Display user message with optional image thumbnail
    const displayText = hasAttachment
      ? (text || '(image)') + '\n[attached: ' + (this._attachedFileName || 'image') + ']'
      : text;
    this.addChatMessage('user', null, displayText, this._attachedImageData);
    this._mcSentMessages.push({ text: displayText, ts: Date.now() });
    const cutoff = Date.now() - 30000;
    this._mcSentMessages = this._mcSentMessages.filter(m => m.ts > cutoff).slice(-10);

    // Show typing indicator for the selected agent
    this._showTypingIndicator(selectedAgent);

    const postBody = { text: text || '(screenshot attached — please analyze this image)' };
    if (selectedAgent) postBody.target_agent = selectedAgent;
    if (this._threadTaskId) postBody.task_id = this._threadTaskId;

    // Include image attachment as base64 data URL
    if (hasAttachment) {
      postBody.attachment = {
        type: 'image',
        data: this._attachedImageData,
        filename: this._attachedFileName || 'screenshot.png',
      };
    }

    // Clear attachment after capturing
    this._clearAttachment();

    if (this.chatSendBtn) this.chatSendBtn.disabled = true;
    try {
      const res = await fetch(this.bridgeUrl + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': this.bridgeToken },
        body: JSON.stringify(postBody),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        this.addFeedEntry(null, 'error', 'Chat send failed (' + res.status + '): ' + truncate(errText, 80));
      } else {
        this.addFeedEntry(null, 'system', hasAttachment ? 'Chat + image sent' : 'Chat message sent');
        if (typeof this.playChatSend === 'function') this.playChatSend();
      }
    } catch (err) {
      this.addFeedEntry(null, 'error', 'Chat send error: ' + err.message);
    } finally {
      if (this.chatSendBtn) this.chatSendBtn.disabled = false;
    }
  },

  sendChat(text) {
    if (this.chatInput) this.chatInput.value = text;
    return this.handleChatSend();
  },

  async checkBridgeHealth() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.bridgeConnected = true;
      this.setBridgeStatus(true);
      return;
    }
    try {
      const res = await fetch(this.bridgeUrl + '/', { method: 'GET', signal: AbortSignal.timeout(5000) });
      this.bridgeConnected = res.ok;
    } catch (_) {
      this.bridgeConnected = false;
    }
    this.setBridgeStatus(this.bridgeConnected);
  },

  addChatMessage(role, agentId, text, imageDataUrl) {
    if (!this.chatMessages) return;
    // Hide typing indicator when a response arrives
    if (role !== 'user') this._hideTypingIndicator();

    const entry = document.createElement('div');
    entry.className = 'chat-msg chat-msg-' + (role === 'user' ? 'user' : 'agent');

    if (role !== 'user' && agentId && AGENTS[agentId]) {
      entry.style.borderLeftColor = AGENTS[agentId].color;
    }

    // FEAT-STICKY: When an agent speaks, lock the selector to that agent
    // so the user's next message goes directly to them (not back to orchestrator).
    // "system" messages (routing announcements) don't change the target.
    if (role === 'agent' && agentId && this.chatAgentSelect) {
      // Only auto-switch if user hasn't manually picked a different agent recently
      if (!this._manualAgentOverride) {
        this.chatAgentSelect.value = agentId;
        this._stickyAgent = agentId;
        this._updateStickyIndicator();
      }
    }

    let label;
    if (role === 'user') {
      label = '<span class="chat-sender">You</span>';
    } else {
      const meta = agentId
        ? (AGENTS[agentId] || { emoji: '\u{1F916}', name: agentId })
        : { emoji: '\u{1F916}', name: 'Agent' };
      const colorClass = AGENTS[agentId] ? 'color-' + meta.name.toLowerCase() : '';
      // Mini-sprite avatar: reuse sprite CSS class from sprites.css (box-shadow art)
      var shortName = agentId || '';
      var spriteHtml = shortName
        ? '<span class="chat-mini-sprite agent-sprite sprite-' + shortName + '"></span>'
        : '<span class="chat-mini-sprite" style="font-size:14px;line-height:20px;text-align:center">' + meta.emoji + '</span>';
      label = '<div class="chat-sender-row">' + spriteHtml +
        '<span class="chat-sender ' + colorClass + '">' + escapeHtml(meta.name) + '</span></div>';
    }

    // Light markdown: **bold**, *italic*, `code`, and list items
    // Strip the "[attached: ...]" placeholder from display text
    let cleanText = text.replace(/\n?\[attached: [^\]]+\]$/g, '').trim();
    let rendered = escapeHtml(cleanText || '');
    rendered = rendered.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    rendered = rendered.replace(/\*(.+?)\*/g,     '<em>$1</em>');
    rendered = rendered.replace(/`([^`]+)`/g,     '<code>$1</code>');
    rendered = rendered.replace(/^- /gm,          '\u2022 ');

    // QUICK-03: HH:MM timestamp
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const tsHtml = '<span class="chat-ts">' + hh + ':' + mm + '</span>';

    // QUICK-04: agent attribution header (non-user bubbles only)
    let agentHeader = '';
    if (role !== 'user') {
      const headerMeta = agentId
        ? (AGENTS[agentId] || { emoji: '\u{1F916}', name: agentId })
        : { emoji: '\u{1F916}', name: 'Agent' };
      agentHeader = '<div class="chat-agent-header">' +
        headerMeta.emoji + ' ' + escapeHtml(headerMeta.name) + '</div>';
    }

    // Build image HTML if present
    let imageHtml = '';
    if (imageDataUrl) {
      imageHtml = '<img class="chat-image" src="' + imageDataUrl + '" alt="attached image" ' +
        'onclick="window.open(this.src,\'_blank\')" />';
    }

    entry.innerHTML = agentHeader + label +
      (rendered ? '<span class="chat-text">' + rendered + '</span>' : '') +
      imageHtml + tsHtml;
    this.chatMessages.appendChild(entry);

    // Animate message entrance
    if (typeof anime !== 'undefined') {
      const isAgent = role !== 'user';
      // Safety timeout: if anime fails mid-run the element remains visible
      const _safetyTimer = setTimeout(() => {
        entry.style.opacity = '';
        entry.style.transform = '';
      }, 700);
      anime({
        targets: entry,
        opacity: [0, 1],
        translateX: [isAgent ? -12 : 12, 0],
        duration: 300,
        easing: 'easeOutCubic',
        complete: () => clearTimeout(_safetyTimer)
      });
    }

    // FEAT-04: Store in chatLog for export (bounded to 1000)
    const meta = agentId ? (AGENTS[agentId] || { emoji: '\u{1F916}', name: agentId }) : null;
    this.chatLog.push({
      role,
      agentId: agentId || null,
      name:    role === 'user' ? 'You' : (meta ? meta.emoji + ' ' + meta.name : 'Agent'),
      text,
      ts:      Date.now(),
    });
    if (this.chatLog.length > 1000) this.chatLog.shift();

    // QUAL-04: Trim to maxChatMessages, overflow into chatBuffer
    while (this.chatMessages.querySelectorAll('.chat-msg').length > this.maxChatMessages) {
      const oldest = this.chatMessages.querySelector('.chat-msg');
      if (!oldest) break;
      this.chatBuffer.push(oldest);
      oldest.parentNode.removeChild(oldest);
    }
    // DEBT-02: _updateLoadEarlierBtn is defined in FeedManager.js (cross-module dependency).
    // It is mixed into MissionControl.prototype when FeedManager.js loads.
    this._updateLoadEarlierBtn(this.chatMessages, this.chatBuffer, 'chat');

    // Auto-scroll
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    // Increment unread if scrolled up
    if (role !== 'user') this._incrementUnread();
  },

  _showTypingIndicator(agentId) {
    this._hideTypingIndicator();
    if (!this.chatMessages) return;
    var indicator = document.createElement('div');
    indicator.className = 'chat-typing-indicator';
    indicator.id = 'chat-typing-indicator';
    var meta = agentId && AGENTS[agentId] ? AGENTS[agentId] : { emoji: '\u{1F916}', name: agentId || 'Agent' };
    indicator.innerHTML =
      '<span style="color:' + (meta.color || 'var(--text-secondary)') + '">' + meta.emoji + ' ' + escapeHtml(meta.name) + '</span>' +
      '<span class="chat-typing-dots"><span></span><span></span><span></span></span>';
    this.chatMessages.appendChild(indicator);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  },

  _hideTypingIndicator() {
    var el = document.getElementById('chat-typing-indicator');
    if (el) el.remove();
  },

  exportChat() {
    const format = this.exportFormatSelect ? this.exportFormatSelect.value : 'json';
    const now    = new Date();
    const stamp  = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '-' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');

    let content, filename, mime;

    if (format === 'json') {
      content  = JSON.stringify(this.chatLog, null, 2);
      filename = 'mc-chat-' + stamp + '.json';
      mime     = 'application/json';
    } else {
      const lines = [
        '# Mission Control \u2014 Chat Session', '',
        '**Exported:** ' + now.toLocaleString(), '', '---', '',
      ];
      for (const msg of this.chatLog) {
        lines.push('**' + msg.name + '** \u2014 ' + new Date(msg.ts).toLocaleTimeString());
        lines.push(''); lines.push(msg.text); lines.push(''); lines.push('---'); lines.push('');
      }
      content  = lines.join('\n');
      filename = 'mc-chat-' + stamp + '.md';
      mime     = 'text/markdown';
    }

    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },

  // ── Chat Threading per Task ──────────────────────────────────────────────

  /**
   * Open a threaded chat view filtered to a specific task.
   * Shows a thread bar at the top of chat with task title + back button.
   * Loads only messages associated with the given taskId from the bridge.
   */
  async openTaskThread(taskId, taskTitle) {
    this._threadTaskId = taskId;
    this._threadTaskTitle = taskTitle || taskId;

    // Show thread bar
    let threadBar = document.getElementById('chat-thread-bar');
    if (!threadBar) {
      threadBar = document.createElement('div');
      threadBar.id = 'chat-thread-bar';
      threadBar.className = 'chat-thread-bar';
      // Insert before chat messages container
      if (this.chatMessages && this.chatMessages.parentElement) {
        this.chatMessages.parentElement.insertBefore(threadBar, this.chatMessages);
      }
    }
    threadBar.innerHTML =
      '<button class="thread-back-btn" id="thread-back-btn">\u2190</button>' +
      '<span class="thread-label">Thread: </span>' +
      '<span class="thread-title">' + escapeHtml(this._threadTaskTitle) + '</span>';
    threadBar.style.display = 'flex';

    // Wire back button
    const backBtn = document.getElementById('thread-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.closeTaskThread());
    }

    // Clear current messages and load filtered
    if (this.chatMessages) {
      this.chatMessages.innerHTML = '<div class="chat-thread-loading">Loading thread messages...</div>';
    }

    try {
      const res = await fetch(
        this.bridgeUrl + '/api/chat/history?task_id=' + encodeURIComponent(taskId) + '&limit=100',
        { headers: { 'X-Auth-Token': this.bridgeToken || this.gatewayToken } }
      );
      if (res.ok) {
        const messages = await res.json();
        if (this.chatMessages) this.chatMessages.innerHTML = '';
        if (messages && messages.length > 0) {
          for (const msg of messages) {
            this.addChatMessage(
              msg.role || 'agent',
              msg.agent_id || null,
              msg.content || msg.text || ''
            );
          }
        } else {
          if (this.chatMessages) {
            this.chatMessages.innerHTML =
              '<div class="chat-thread-empty">No messages yet for this task. Send a message to start the thread.</div>';
          }
        }
      }
    } catch (e) {
      console.error('[Chat] Failed to load thread:', e.message);
      if (this.chatMessages) {
        this.chatMessages.innerHTML =
          '<div class="chat-thread-empty">Could not load thread messages.</div>';
      }
    }
  },

  /**
   * Close the threaded view and restore full chat.
   */
  closeTaskThread() {
    this._threadTaskId = null;
    this._threadTaskTitle = null;

    const threadBar = document.getElementById('chat-thread-bar');
    if (threadBar) threadBar.style.display = 'none';

    // Reload full chat history
    if (this.chatMessages) {
      this.chatMessages.innerHTML = '';
      // Re-render from chatLog
      for (const msg of this.chatLog) {
        this.addChatMessage(msg.role, msg.agentId, msg.text);
      }
    }
  },

  // ── Sticky Agent Routing ──────────────────────────────────────────────────

  // ── Image Attachment Handling ────────────────────────────────────────────

  /**
   * Initialize attachment UI: file input, attach button, preview, drag-drop.
   * Called once from _initChat or terminal.js boot.
   */
  initAttachmentUI() {
    this._attachedImageData = null;
    this._attachedFileName = null;

    const fileInput = document.getElementById('chat-file-input');
    const attachBtn = document.getElementById('chat-attach-btn');
    const previewEl = document.getElementById('chat-attachment-preview');
    const removeBtn = document.getElementById('chat-attachment-remove');
    const previewImg = document.getElementById('chat-preview-img');
    const nameEl = document.getElementById('chat-attachment-name');
    const sizeEl = document.getElementById('chat-attachment-size');

    if (!fileInput || !attachBtn) return;

    // Click attach button -> open file picker
    attachBtn.addEventListener('click', () => fileInput.click());

    // File selected -> read and show preview
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      this._readImageFile(file);
      fileInput.value = ''; // allow re-selecting same file
    });

    // Remove attachment
    if (removeBtn) {
      removeBtn.addEventListener('click', () => this._clearAttachment());
    }

    // Drag-drop on chat messages area
    const chatPanel = this.chatMessages ? this.chatMessages.closest('.panel-content-flex') : null;
    if (chatPanel) {
      chatPanel.style.position = 'relative'; // for drop zone overlay

      // Create drop zone overlay
      const dropZone = document.createElement('div');
      dropZone.className = 'chat-drop-zone';
      dropZone.id = 'chat-drop-zone';
      dropZone.textContent = 'Drop image here';
      chatPanel.appendChild(dropZone);

      let dragCounter = 0;
      chatPanel.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (this._hasDragImage(e)) dropZone.classList.add('visible');
      });
      chatPanel.addEventListener('dragleave', () => {
        dragCounter--;
        if (dragCounter <= 0) { dragCounter = 0; dropZone.classList.remove('visible'); }
      });
      chatPanel.addEventListener('dragover', (e) => e.preventDefault());
      chatPanel.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropZone.classList.remove('visible');
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
          this._readImageFile(file);
        }
      });
    }

    // Paste image from clipboard (Cmd+V / Ctrl+V)
    const chatInput = this.chatInput;
    if (chatInput) {
      chatInput.addEventListener('paste', (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) this._readImageFile(file);
            return;
          }
        }
      });
    }
  },

  _hasDragImage(e) {
    if (!e.dataTransfer || !e.dataTransfer.types) return false;
    return e.dataTransfer.types.includes('Files');
  },

  _readImageFile(file) {
    // Validate: must be image, max 10 MB
    if (!file.type.startsWith('image/')) return;
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      this.addFeedEntry(null, 'error', 'Image too large (max 10 MB)');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this._attachedImageData = reader.result; // data:image/...;base64,...
      this._attachedFileName = file.name;
      this._showAttachmentPreview(reader.result, file.name, file.size);
    };
    reader.onerror = () => {
      this.addFeedEntry(null, 'error', 'Failed to read image file');
    };
    reader.readAsDataURL(file);
  },

  _showAttachmentPreview(dataUrl, name, size) {
    const previewEl = document.getElementById('chat-attachment-preview');
    const previewImg = document.getElementById('chat-preview-img');
    const nameEl = document.getElementById('chat-attachment-name');
    const sizeEl = document.getElementById('chat-attachment-size');
    const attachBtn = document.getElementById('chat-attach-btn');

    if (previewImg) previewImg.src = dataUrl;
    if (nameEl) nameEl.textContent = name || 'image';
    if (sizeEl) {
      const kb = Math.round(size / 1024);
      sizeEl.textContent = kb < 1024 ? kb + ' KB' : (kb / 1024).toFixed(1) + ' MB';
    }
    if (previewEl) previewEl.classList.add('visible');
    if (attachBtn) attachBtn.classList.add('has-attachment');

    // Focus the text input so user can type a message to go with the image
    if (this.chatInput) this.chatInput.focus();
  },

  _clearAttachment() {
    this._attachedImageData = null;
    this._attachedFileName = null;

    const previewEl = document.getElementById('chat-attachment-preview');
    const attachBtn = document.getElementById('chat-attach-btn');
    if (previewEl) previewEl.classList.remove('visible');
    if (attachBtn) attachBtn.classList.remove('has-attachment');
  },

  /**
   * Called when the user manually changes the agent-select dropdown.
   * Sets manual override flag so auto-sticky doesn't fight the user.
   * Cleared when user picks "Auto" or after 60s of no sends.
   */
  onAgentSelectChange() {
    const val = this.chatAgentSelect ? this.chatAgentSelect.value : '';
    if (val === '') {
      // User picked "Auto" — release sticky lock
      this._manualAgentOverride = false;
      this._stickyAgent = null;
    } else {
      // User explicitly chose an agent — don't let auto-sticky override
      this._manualAgentOverride = true;
      this._stickyAgent = val;
      // Auto-release manual override after 60s so sticky can resume
      clearTimeout(this._manualOverrideTimer);
      this._manualOverrideTimer = setTimeout(() => { this._manualAgentOverride = false; }, 60000);
    }
    this._updateStickyIndicator();
    // Update input glow color for selected agent
    var agentColor = val && AGENTS[val] ? AGENTS[val].color : 'rgba(255,255,255,0.1)';
    var inputBar = document.querySelector('.chat-input-bar');
    if (inputBar) inputBar.style.setProperty('--chat-input-glow', agentColor);
  },

  /**
   * Update visual indicator on the chat input showing who you're talking to.
   */
  _updateStickyIndicator() {
    let indicator = document.getElementById('sticky-agent-indicator');
    const agentId = this._stickyAgent;

    if (!agentId) {
      if (indicator) indicator.style.display = 'none';
      return;
    }

    const meta = AGENTS[agentId];
    if (!meta) {
      if (indicator) indicator.style.display = 'none';
      return;
    }

    // Create indicator if it doesn't exist
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'sticky-agent-indicator';
      indicator.className = 'sticky-agent-indicator';
      // Insert above the chat input row
      const inputRow = this.chatInput ? this.chatInput.closest('.chat-input-bar') : null;
      if (inputRow && inputRow.parentElement) {
        inputRow.parentElement.insertBefore(indicator, inputRow);
      } else {
        return; // can't find a place to put it
      }
    }

    indicator.innerHTML =
      '<span class="sticky-dot" style="background:' + meta.color + '"></span>' +
      '<span>Talking to ' + meta.emoji + ' <strong>' + escapeHtml(meta.name) + '</strong></span>' +
      '<button class="sticky-clear" title="Switch back to Auto routing">✕</button>';
    indicator.style.display = 'flex';

    // Clear button
    const clearBtn = indicator.querySelector('.sticky-clear');
    if (clearBtn) {
      clearBtn.onclick = () => {
        this._manualAgentOverride = false;
        this._stickyAgent = null;
        if (this.chatAgentSelect) this.chatAgentSelect.value = '';
        this._updateStickyIndicator();
      };
    }
  },

  _initChatScrollIndicator() {
    if (!this.chatMessages) return;
    var indicator = document.createElement('div');
    indicator.className = 'chat-scroll-indicator';
    indicator.innerHTML = '\u2193<span class="unread-badge" style="display:none">0</span>';
    var self = this;
    indicator.addEventListener('click', function() {
      self.chatMessages.scrollTop = self.chatMessages.scrollHeight;
    });
    var parent = this.chatMessages.parentElement;
    if (parent) {
      parent.style.position = 'relative';
      parent.appendChild(indicator);
    }
    this._chatScrollIndicator = indicator;
    this._chatUnreadCount = 0;
    this._chatScrolledUp = false;

    this.chatMessages.addEventListener('scroll', function() {
      var el = self.chatMessages;
      var atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      self._chatScrolledUp = !atBottom;
      if (atBottom) {
        self._chatUnreadCount = 0;
        self._updateScrollIndicator();
      }
      if (self._chatScrollIndicator) {
        self._chatScrollIndicator.classList.toggle('visible', !atBottom);
      }
    });
  },

  _incrementUnread() {
    if (!this._chatScrolledUp) return;
    this._chatUnreadCount = (this._chatUnreadCount || 0) + 1;
    this._updateScrollIndicator();
  },

  _updateScrollIndicator() {
    if (!this._chatScrollIndicator) return;
    var badge = this._chatScrollIndicator.querySelector('.unread-badge');
    if (!badge) return;
    if (this._chatUnreadCount > 0) {
      badge.style.display = 'flex';
      badge.textContent = this._chatUnreadCount > 99 ? '99+' : this._chatUnreadCount;
    } else {
      badge.style.display = 'none';
    }
  },

  // ── Dynamic agent rendering (D3: reads from AgentPanel._agents cache) ──────

  /**
   * Render chat-page agent chips into #chat-chips.
   * One chip per agent; each has data-agent-id for event delegation (D3).
   * Must be called after initAgents() has populated window._missionControl._agents.
   */
  renderAgentChips() {
    const container = document.getElementById('chat-chips');
    if (!container) return;
    const agents = (window._missionControl && window._missionControl._agents) || [];
    container.innerHTML = '';
    agents.forEach((agent) => {
      const chip = document.createElement('button');
      chip.className = 'chat-agent-chip';
      chip.dataset.agentId = agent.id;          // D3: event delegation
      chip.title = agent.display_name || agent.id;
      chip.innerHTML =
        (agent.emoji ? '<span class="chip-emoji">' + agent.emoji + '</span>' : '') +
        '<span class="chip-name">' + escapeHtml(agent.display_name || agent.id) + '</span>';
      chip.addEventListener('click', () => {
        if (this.chatAgentSelect) {
          this.chatAgentSelect.value = agent.id;
          this._onAgentSelectChange();
        }
      });
      container.appendChild(chip);
    });
  },

  /**
   * Render the chat sidebar agent list into #chat-agent-list.
   * Each item has data-agent-id for event delegation (D3).
   */
  renderAgentSidebar() {
    const container = document.getElementById('chat-agent-list');
    if (!container) return;
    const agents = (window._missionControl && window._missionControl._agents) || [];
    // Preserve any static children (e.g. #chat-agent-empty placeholder)
    const emptyEl = document.getElementById('chat-agent-empty');
    container.innerHTML = '';
    if (emptyEl) container.appendChild(emptyEl);

    agents.forEach((agent) => {
      const item = document.createElement('div');
      item.className = 'chat-agent-item';
      item.id = 'chat-agent-' + agent.id;
      item.dataset.agentId = agent.id;          // D3: event delegation
      item.style.display = 'none';              // shown dynamically by updateAgentPanels
      item.innerHTML =
        '<span class="chat-agent-emoji">' + (agent.emoji || '') + '</span>' +
        '<div class="chat-agent-info">' +
          '<span class="chat-agent-name">' + escapeHtml(agent.display_name || agent.id) + '</span>' +
          '<span class="chat-agent-state state-idle" id="chat-state-' + agent.id + '">idle</span>' +
        '</div>' +
        '<span class="chat-agent-tool" id="chat-tool-' + agent.id + '"></span>';
      container.appendChild(item);
    });
  },

  /**
   * Render the agent <select> dropdown (#agent-select) with one <option> per agent.
   * Each <option> has data-agent-id for event delegation (D3).
   */
  renderAgentSelect() {
    const select = document.getElementById('agent-select');
    if (!select) return;
    const agents = (window._missionControl && window._missionControl._agents) || [];
    // Preserve the "Auto" option if it exists, then rebuild agent options
    const autoOpt = select.querySelector('option[value=""]') || (() => {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'Auto';
      return o;
    })();
    select.innerHTML = '';
    select.appendChild(autoOpt);

    agents.forEach((agent) => {
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.dataset.agentId = agent.id;           // D3: event delegation
      opt.textContent = (agent.emoji ? agent.emoji + ' ' : '') + (agent.display_name || agent.id);
      select.appendChild(opt);
    });
  },

});
