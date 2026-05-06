'use strict';
// ADAPT-09 audit (Phase 2): no body-sending fetch() POSTs in this file as of 2026-05-04; CI guard `tests/guard_content_type.sh` prevents future regressions.

// ---------------------------------------------------------------------------
// TraceViewer.js — expandable tool-call trace entries for the activity feed
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------

const TRACE_CATEGORY_COLORS = {
    read:     '#22d3ee',
    write:    '#a855f7',
    dispatch: '#f59e0b',
    run:      '#6b7280',
};

const TRACE_CATEGORY_LABELS = {
    read:     'READ',
    write:    'WRITE',
    dispatch: 'DISPATCH',
    run:      'RUN',
};

Object.assign(MissionControl.prototype, {

  // -- Initialization -------------------------------------------------------

  initTraceViewer() {
    /** Ring buffer of recent trace DOM elements (newest last) */
    this.traceBuffer = [];
    /** Max traces held in memory */
    this.maxTraceBuffer = 200;
  },

  // -- DOM creation ---------------------------------------------------------

  /**
   * Build an expandable trace entry element.
   *
   * @param {string} agentId      - Agent that executed the tool
   * @param {string} toolName     - Name of the tool (e.g. "web_search")
   * @param {string} toolCategory - One of: read | write | dispatch | run
   * @param {string} inputPreview - Truncated preview of tool input/arguments
   * @returns {HTMLDivElement}     - The .trace-entry element
   */
  createTraceEntry(agentId, toolName, toolCategory, inputPreview) {
    const category = TRACE_CATEGORY_COLORS[toolCategory] ? toolCategory : 'run';
    const color    = TRACE_CATEGORY_COLORS[category];
    const label    = TRACE_CATEGORY_LABELS[category];

    // Root wrapper
    const root = document.createElement('div');
    root.className = 'trace-entry';
    root.dataset.category = category;
    if (agentId) root.dataset.agentId = agentId;

    // -- Header row (always visible) --
    const header = document.createElement('div');
    header.className = 'trace-header';

    const dot = document.createElement('span');
    dot.className = 'trace-dot';
    dot.style.background = color;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'trace-tool';
    nameSpan.textContent = toolName || 'unknown';

    const badge = document.createElement('span');
    badge.className = 'trace-category';
    badge.textContent = label;
    badge.style.color = color;

    const expandBtn = document.createElement('span');
    expandBtn.className = 'trace-expand';
    expandBtn.textContent = '+';

    header.appendChild(dot);
    header.appendChild(nameSpan);
    header.appendChild(badge);
    header.appendChild(expandBtn);

    // -- Detail panel (hidden until expanded) --
    const detail = document.createElement('div');
    detail.className = 'trace-detail';
    detail.textContent = inputPreview || '(no input)';

    // -- Toggle expand/collapse --
    header.addEventListener('click', () => {
      const expanded = root.classList.toggle('expanded');
      expandBtn.textContent = expanded ? '\u2212' : '+';   // minus sign or plus
    });

    root.appendChild(header);
    root.appendChild(detail);

    // Push into ring buffer
    this.traceBuffer.push(root);
    if (this.traceBuffer.length > this.maxTraceBuffer) {
      this.traceBuffer.shift();
    }

    return root;
  },

  // -- API fetching ---------------------------------------------------------

  /**
   * Load trace records from the bridge API.
   *
   * @param {Object} [filters]          - Query parameters
   * @param {string} [filters.agent_id] - Filter by agent
   * @param {string} [filters.run_id]   - Filter by run
   * @param {number} [filters.limit]    - Max records to return
   * @returns {Promise<Array>}          - Array of trace objects from the API
   */
  async loadTraces(filters) {
    const params = new URLSearchParams();
    if (filters) {
      if (filters.agent_id) params.set('agent_id', filters.agent_id);
      if (filters.run_id)   params.set('run_id',   filters.run_id);
      if (filters.limit)    params.set('limit',     String(filters.limit));
    }

    const qs  = params.toString();
    const url = this.bridgeUrl + '/api/traces' + (qs ? '?' + qs : '');

    try {
      const res = await fetch(url, {
        headers: { 'X-Auth-Token': this.bridgeToken || this.gatewayToken },
      });
      if (!res.ok) {
        console.warn('[TraceViewer] loadTraces failed:', res.status);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data) ? data : (data.traces || []);
    } catch (err) {
      console.warn('[TraceViewer] loadTraces error:', err);
      return [];
    }
  },

});
