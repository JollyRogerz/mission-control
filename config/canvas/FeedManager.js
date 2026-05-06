'use strict';

// ---------------------------------------------------------------------------
// FeedManager.js — tabs, activity feed, raw log, and "Load earlier" buffers
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------

Object.assign(MissionControl.prototype, {

  // -- Tab switching --------------------------------------------------------

  switchTab(tab) {
    this.activeTab = tab;
    if (this.tabFeedBtn)    this.tabFeedBtn.classList.toggle('active', tab === 'feed');
    if (this.tabRawBtn)     this.tabRawBtn.classList.toggle('active',  tab === 'raw');
    if (this.feedPanel)     this.feedPanel.classList.toggle('active',  tab === 'feed');
    if (this.rawPanel)      this.rawPanel.classList.toggle('active',   tab === 'raw');
    if (this.rawSearchInput) this.rawSearchInput.classList.toggle('hidden', tab !== 'raw');
    if (this.regexToggleBtn) this.regexToggleBtn.classList.toggle('hidden',  tab !== 'raw');
  },

  // -- Activity feed --------------------------------------------------------

  addFeedEntry(agentId, action, detail) {
    if (!this.activityFeed) return;

    const now  = new Date();
    const meta = agentId ? (AGENTS[agentId] || { emoji: '\u{2753}', name: agentId, color: '#888' }) : null;

    const entry = document.createElement('div');
    entry.className     = 'feed-entry';
    entry.dataset.agentId = agentId || '';

    if (agentId && AGENTS[agentId]) entry.style.borderLeftColor = AGENTS[agentId].color;

    // FEAT-01: hide immediately if agent is filtered out
    if (!this.activeAgentFilters.has(agentId || '')) entry.style.display = 'none';

    // UX-02: native tooltip for full text on hover
    const tooltipParts = [];
    if (action) tooltipParts.push(action);
    if (detail) tooltipParts.push(detail);
    if (tooltipParts.length) entry.title = tooltipParts.join(' \u2014 ');

    const time       = escapeHtml(formatTime(now));
    const emoji      = meta ? meta.emoji : '\u{2699}\uFE0F';
    const name       = meta ? escapeHtml(meta.name) : 'System';
    const actionText = escapeHtml(action || '');
    const detailText = escapeHtml(detail || '');

    entry.innerHTML =
      '<span class="feed-time">'   + time   + '</span> ' +
      '<span class="feed-emoji">'  + emoji  + '</span> ' +
      '<span class="feed-agent"'   + (meta ? ' style="color:' + meta.color + '"' : '') + '>' + name + '</span> ' +
      '<span class="feed-action">' + actionText + '</span>' +
      (detailText ? ' <span class="feed-detail">' + detailText + '</span>' : '');

    // If action is tool-related, add expandable trace
    if (detail && typeof this.createTraceEntry === 'function') {
      const toolName = detail.split(':')[0]?.trim() || detail.split(' ')[0] || '';
      if (toolName && (action === 'tool' || action === 'tool_running' || action.includes('tool'))) {
        const category = typeof toolCategory === 'function' ? toolCategory(toolName) : 'run';
        const traceEl = this.createTraceEntry(agentId, toolName, category, detail);
        entry.appendChild(traceEl);
      }
    }

    this.activityFeed.appendChild(entry);

    // Animate entry slide-in
    if (typeof anime !== 'undefined') {
      // Safety timeout: if anime fails mid-run the element remains visible
      const _safetyTimer = setTimeout(() => {
        entry.style.opacity = '';
        entry.style.transform = '';
      }, 600);
      anime({
        targets: entry,
        opacity: [0, 1],
        translateX: [20, 0],
        duration: 250,
        easing: 'easeOutCubic',
        complete: () => clearTimeout(_safetyTimer)
      });
    }

    // QUAL-04: Trim oldest feed entries into feedBuffer
    while (this.activityFeed.querySelectorAll('.feed-entry').length > this.maxFeedEntries) {
      const oldest = this.activityFeed.querySelector('.feed-entry');
      if (!oldest) break;
      this.feedBuffer.push(oldest);
      oldest.parentNode.removeChild(oldest);
    }
    this._updateLoadEarlierBtn(this.activityFeed, this.feedBuffer, 'feed');

    // Auto-scroll
    this.activityFeed.scrollTop = this.activityFeed.scrollHeight;
  },

  // -- Streaming coalesce ---------------------------------------------------
  // Instead of creating a new feed entry for every streaming token chunk,
  // reuse the last "speaking" entry for the same agent and update its text.

  _updateOrCreateSpeakingEntry(agentId, detail) {
    if (!this.activityFeed) return;

    // Look for an existing speaking entry for this agent (must be the very
    // last visible entry to avoid stale updates after other events).
    const lastEntry = this.activityFeed.querySelector('.feed-entry:last-of-type');
    if (
      lastEntry &&
      lastEntry.dataset.agentId === (agentId || '') &&
      lastEntry.dataset.feedAction === 'speaking'
    ) {
      // Update detail text in-place
      const detailEl = lastEntry.querySelector('.feed-detail');
      if (detailEl) {
        detailEl.textContent = detail || '';
        lastEntry.title = 'speaking — ' + (detail || '');
      }
      // Keep scrolled to bottom
      this.activityFeed.scrollTop = this.activityFeed.scrollHeight;
      return;
    }

    // No existing speaking entry — create one and tag it
    this.addFeedEntry(agentId, 'speaking', detail);
    // Tag the newly-added entry so we can find it on the next chunk
    const newest = this.activityFeed.querySelector('.feed-entry:last-of-type');
    if (newest) newest.dataset.feedAction = 'speaking';
  },

  // -- Raw log --------------------------------------------------------------

  addRawEntry(json) {
    if (!this.rawLog) return;

    const entry = document.createElement('div');
    entry.className = 'raw-entry';
    entry.textContent = json;

    // Apply current search filter (supports regex mode on new entries)
    if (this.rawSearchFilter) {
      let show;
      if (this.rawRegexMode) {
        try { show = new RegExp(this.rawSearchFilter, 'i').test(json); } catch (_) { show = true; }
      } else {
        show = json.toLowerCase().includes(this.rawSearchFilter.toLowerCase());
      }
      if (!show) entry.style.display = 'none';
    }

    this.rawLog.appendChild(entry);

    // Trim raw log (no buffer — raw log is dev/debug data)
    while (this.rawLog.children.length > this.maxRawEntries) {
      this.rawLog.removeChild(this.rawLog.firstChild);
    }

    if (this.rawAutoScroll) this.rawLog.scrollTop = this.rawLog.scrollHeight;
  },

  applyRawFilter() {
    if (!this.rawLog) return;
    const filter = this.rawSearchFilter;
    let regex = null;

    if (filter && this.rawRegexMode) {
      try {
        regex = new RegExp(filter, 'i');
        if (this.rawSearchInput) this.rawSearchInput.classList.remove('regex-error');
      } catch (e) {
        if (this.rawSearchInput) this.rawSearchInput.classList.add('regex-error');
        const entries = this.rawLog.children;
        for (let i = 0; i < entries.length; i++) entries[i].style.display = '';
        return;
      }
    }

    const entries = this.rawLog.children;
    for (let i = 0; i < entries.length; i++) {
      const el = entries[i];
      if      (!filter) el.style.display = '';
      else if (regex)   el.style.display = regex.test(el.textContent) ? '' : 'none';
      else              el.style.display = el.textContent.toLowerCase().includes(filter.toLowerCase()) ? '' : 'none';
    }
  },

  // FEAT-01: Re-apply feed visibility based on active agent filters
  applyFeedFilter() {
    if (!this.activityFeed) return;
    const entries = this.activityFeed.children;
    for (let i = 0; i < entries.length; i++) {
      const el = entries[i];
      if (el.classList.contains('load-earlier-btn')) continue; // skip the load button
      const agentId = el.dataset.agentId !== undefined ? el.dataset.agentId : '';
      el.style.display = this.activeAgentFilters.has(agentId) ? '' : 'none';
    }
  },

  // -- QUAL-04: "Load earlier" buffer management ----------------------------

  // Show/update or hide the "Load earlier" button at the top of a container
  _updateLoadEarlierBtn(container, buffer, type) {
    const btnId = 'load-earlier-' + type;
    let btn = document.getElementById(btnId);

    if (buffer.length > 0) {
      if (!btn) {
        btn = document.createElement('button');
        btn.id        = btnId;
        btn.className = 'load-earlier-btn';
        btn.addEventListener('click', () => this._loadEarlier(container, buffer, type));
        container.insertBefore(btn, container.firstChild);
      }
      const count = Math.min(buffer.length, 50);
      btn.textContent = '\u2191 Load ' + count + ' earlier message' + (count !== 1 ? 's' : '');
    } else if (btn) {
      btn.remove();
    }
  },

  // Restore up to 50 entries from the buffer into the container
  _loadEarlier(container, buffer, type) {
    const btn    = document.getElementById('load-earlier-' + type);
    const count  = Math.min(buffer.length, 50);
    const toLoad = buffer.splice(buffer.length - count, count);
    const refNode = btn ? btn.nextSibling : container.firstChild;

    for (const el of toLoad) {
      container.insertBefore(el, refNode);
    }

    this._updateLoadEarlierBtn(container, buffer, type);
  },

});
