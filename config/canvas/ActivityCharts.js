'use strict';

// ---------------------------------------------------------------------------
// ActivityCharts.js — 14-day activity charts, 24h heatmap, and audit log
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------
// Pure CSS stacked bar charts, heatmap cells, and compact audit log.
// No canvas, no SVG, no external libraries.
// ---------------------------------------------------------------------------

// ---- CSS (injected once) --------------------------------------------------

const ACTIVITY_CHARTS_CSS = `
/* ── Activity Charts ──────────────────────────────────────────────────────── */

.activity-chart-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 10px;
  font-family: 'Berkeley Mono', monospace;
}

.activity-section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: var(--text-secondary, #6b7b8d);
  margin-bottom: 4px;
}

/* ── 14-Day Stacked Bar Chart ─────────────────────────────────────────────── */

.daily-chart-wrapper {
  position: relative;
  padding-left: 28px;
  height: 130px;
}

.daily-chart-gridline {
  position: absolute;
  left: 28px;
  right: 0;
  border-top: 1px dashed rgba(255,255,255,0.05);
  pointer-events: none;
}
.daily-chart-gridline-label {
  position: absolute;
  left: 0;
  transform: translateY(-50%);
  font-size: 8px;
  color: var(--text-secondary, #8a9aab);
  width: 24px;
  text-align: right;
}

.daily-chart {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 120px;
  position: relative;
}

.daily-bar {
  display: flex;
  flex-direction: column-reverse;
  flex: 1;
  min-width: 0;
  position: relative;
  cursor: default;
}

.daily-bar-segment {
  min-height: 0;
  transition: height 0.4s ease;
  border-radius: 1px 1px 0 0;
}
.daily-bar-segment:first-child {
  border-radius: 0 0 1px 1px;
}

.daily-bar-label {
  text-align: center;
  font-size: 8px;
  color: var(--text-secondary, #8a9aab);
  margin-top: 3px;
  line-height: 1;
}
.daily-bar-label.today {
  color: var(--text-primary, #c8d6e5);
  font-weight: 500;
}

.daily-bar-tooltip {
  display: none;
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-panel, #12131c);
  border: 1px solid var(--border-active, rgba(255,255,255,0.12));
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 10px;
  white-space: nowrap;
  z-index: 200;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
.daily-bar:hover .daily-bar-tooltip {
  display: block;
}
.tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 0;
}
.tooltip-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.tooltip-agent {
  color: var(--text-primary, #c8d6e5);
}
.tooltip-value {
  color: var(--text-secondary, #6b7b8d);
  margin-left: auto;
  padding-left: 8px;
}
.tooltip-date {
  color: var(--text-secondary, #6b7b8d);
  font-size: 9px;
  padding-bottom: 3px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 2px;
}

/* ── 24h Heatmap ──────────────────────────────────────────────────────────── */

.heatmap-row {
  display: flex;
  gap: 2px;
}

.heatmap-cell {
  flex: 1;
  height: 24px;
  border-radius: 2px;
  min-width: 0;
  background: rgba(255,255,255,0.03);
  transition: background 0.3s ease, opacity 0.3s ease;
  position: relative;
  cursor: default;
}
.heatmap-cell.current-hour {
  outline: 1px solid var(--color-orchestrator, #f59e0b);
  outline-offset: -1px;
}
.heatmap-cell:hover .heatmap-tooltip {
  display: block;
}

.heatmap-labels {
  display: flex;
  gap: 2px;
  margin-top: 2px;
}
.heatmap-label {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 7px;
  color: var(--text-secondary, #8a9aab);
}

.heatmap-tooltip {
  display: none;
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-panel, #12131c);
  border: 1px solid var(--border-active, rgba(255,255,255,0.12));
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 10px;
  white-space: nowrap;
  z-index: 200;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  color: var(--text-primary, #c8d6e5);
}

/* ── Audit Log ────────────────────────────────────────────────────────────── */

.audit-log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.audit-export-btn {
  background: none;
  border: 1px solid var(--border, rgba(255,255,255,0.06));
  color: var(--text-secondary, #6b7b8d);
  font-size: 9px;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-family: 'Berkeley Mono', monospace;
}
.audit-export-btn:hover {
  border-color: var(--border-active, rgba(255,255,255,0.12));
  color: var(--text-primary, #c8d6e5);
}

.audit-log {
  max-height: 200px;
  overflow-y: auto;
  font-size: 11px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.08) transparent;
}
.audit-log::-webkit-scrollbar { width: 4px; }
.audit-log::-webkit-scrollbar-track { background: transparent; }
.audit-log::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

.audit-entry {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 6px;
  border-bottom: 1px solid rgba(255,255,255,0.03);
  line-height: 1.4;
}
.audit-entry:hover {
  background: rgba(255,255,255,0.02);
}

.audit-ts {
  color: var(--text-secondary, #8a9aab);
  flex-shrink: 0;
  width: 50px;
  font-size: 10px;
}
.audit-actor {
  flex-shrink: 0;
  font-size: 11px;
}
.audit-action {
  color: var(--text-primary, #c8d6e5);
  font-size: 11px;
}
.audit-entity {
  color: var(--text-secondary, #6b7b8d);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audit-empty {
  color: var(--text-secondary, #8a9aab);
  text-align: center;
  padding: 16px;
  font-size: 11px;
}
`;

(function() {
  const style = document.createElement('style');
  style.textContent = ACTIVITY_CHARTS_CSS;
  document.head.appendChild(style);
})();


// ---- Constants ------------------------------------------------------------

const ACTIVITY_SAMPLE_INTERVAL_MS = 60000;  // 1 minute
const ACTIVITY_MAX_DAYS = 14;
const ACTIVITY_MAX_AUDIT = 1000;
const ACTIVITY_AUDIT_DISPLAY = 50;
const ACTIVITY_HEATMAP_COLOR = '#3b82f6';   // base hue for heatmap


// ---- Module ---------------------------------------------------------------

Object.assign(MissionControl.prototype, {

  // ── Initialization ────────────────────────────────────────────────────────

  initActivityCharts() {
    const todayStr = this._todayDateStr();

    this.activityData = {
      dailyActivity: [{ date: todayStr, agents: {} }],
      hourlyHeatmap: new Array(24).fill(null).map(() => ({ total: 0, byAgent: {} })),
      auditLog: [],
      _lastSampleTime: Date.now(),
      _agentActiveMinutes: {},
    };

    // Pre-populate agent keys
    for (const agentId of AGENT_IDS) {
      this.activityData.dailyActivity[0].agents[agentId] = 0;
      this.activityData._agentActiveMinutes[agentId] = 0;
    }

    // Sample activity every 60 seconds
    this._activitySampleTimer = setInterval(() => this.sampleAgentActivity(), ACTIVITY_SAMPLE_INTERVAL_MS);

    // FEAT-PERSIST: Hydrate from Bridge (load persisted activity history)
    this._hydrateActivityData();

    // Initial render if container exists
    const container = document.getElementById('activity-charts-content');
    if (container) this.renderActivityCharts(container);
  },

  // ── Persistence: hydrate from Bridge ───────────────────────────────────────

  async _hydrateActivityData() {
    try {
      const res = await fetch(this.bridgeUrl + '/api/activity/summary?days=14', {
        headers: { 'X-Auth-Token': this.bridgeToken || this.gatewayToken },
      });
      if (!res.ok) return;
      const rows = await res.json();

      for (const row of rows) {
        // Hydrate daily activity
        let dayEntry = this.activityData.dailyActivity.find(d => d.date === row.date);
        if (!dayEntry) {
          dayEntry = { date: row.date, agents: {} };
          for (const id of AGENT_IDS) dayEntry.agents[id] = 0;
          this.activityData.dailyActivity.push(dayEntry);
        }
        dayEntry.agents[row.agent_id] = (dayEntry.agents[row.agent_id] || 0) + (row.active_minutes || 0);

        // Hydrate hourly heatmap (today only)
        if (row.date === this._todayDateStr()) {
          const bucket = this.activityData.hourlyHeatmap[row.hour];
          if (bucket) {
            bucket.total += row.event_count || 0;
            bucket.byAgent[row.agent_id] = (bucket.byAgent[row.agent_id] || 0) + (row.event_count || 0);
          }
        }
      }

      // Sort daily by date
      this.activityData.dailyActivity.sort((a, b) => a.date.localeCompare(b.date));

      // Trim to 14 days
      while (this.activityData.dailyActivity.length > ACTIVITY_MAX_DAYS) {
        this.activityData.dailyActivity.shift();
      }

      // Re-render
      const container = document.getElementById('activity-charts-content');
      if (container) this.renderActivityCharts(container);
    } catch (e) {
      console.warn('[ActivityCharts] Hydration failed:', e.message);
    }
  },

  async _persistActivitySample(agentId) {
    try {
      await fetch(this.bridgeUrl + '/api/activity/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': this.bridgeToken || this.gatewayToken },
        body: JSON.stringify({ agent_id: agentId, active_minutes: 1.0 }),
      });
    } catch (_) { /* best-effort */ }
  },

  // ── Activity Sampling ─────────────────────────────────────────────────────

  sampleAgentActivity() {
    if (!this.activityData) return;

    const now = Date.now();
    const todayStr = this._todayDateStr();
    const currentHour = new Date().getHours();

    // Ensure today's entry exists
    let todayEntry = this.activityData.dailyActivity.find(d => d.date === todayStr);
    if (!todayEntry) {
      todayEntry = { date: todayStr, agents: {} };
      for (const agentId of AGENT_IDS) todayEntry.agents[agentId] = 0;
      this.activityData.dailyActivity.push(todayEntry);

      // Trim to 14 days
      while (this.activityData.dailyActivity.length > ACTIVITY_MAX_DAYS) {
        this.activityData.dailyActivity.shift();
      }

      // Reset hourly heatmap for new day
      this.activityData.hourlyHeatmap = new Array(24).fill(null).map(() => ({ total: 0, byAgent: {} }));
      this.activityData._agentActiveMinutes = {};
      for (const agentId of AGENT_IDS) this.activityData._agentActiveMinutes[agentId] = 0;
    }

    // Sample each agent
    for (const agentId of AGENT_IDS) {
      const agent = this.agents[agentId];
      if (!agent) continue;

      const isActive = agent.state && agent.state !== 'idle';
      if (isActive) {
        // Increment daily minutes
        todayEntry.agents[agentId] = (todayEntry.agents[agentId] || 0) + 1;
        this.activityData._agentActiveMinutes[agentId] =
          (this.activityData._agentActiveMinutes[agentId] || 0) + 1;

        // Increment hourly heatmap
        const hourBucket = this.activityData.hourlyHeatmap[currentHour];
        hourBucket.total += 1;
        hourBucket.byAgent[agentId] = (hourBucket.byAgent[agentId] || 0) + 1;

        // FEAT-PERSIST: Persist to bridge
        this._persistActivitySample(agentId);
      }
    }

    this.activityData._lastSampleTime = now;

    // Re-render if visible
    const container = document.getElementById('activity-charts-content');
    if (container && container.offsetParent !== null) {
      this.renderActivityCharts(container);
    }
  },

  // ── Audit Log ─────────────────────────────────────────────────────────────

  recordAuditEvent(actorType, actorId, action, entityType, entityId, details) {
    if (!this.activityData) return;

    const entry = {
      ts: Date.now(),
      actorType: actorType || 'system',
      actorId: actorId || '',
      action: action || '',
      entityType: entityType || '',
      entityId: entityId || '',
      details: details || null,
    };

    this.activityData.auditLog.push(entry);

    // Cap at max entries
    while (this.activityData.auditLog.length > ACTIVITY_MAX_AUDIT) {
      this.activityData.auditLog.shift();
    }

    // Update audit log display if visible
    const logEl = document.getElementById('activity-audit-log');
    if (logEl && logEl.offsetParent !== null) {
      this._renderAuditLogEntries(logEl);
    }
  },

  // ── Rendering ─────────────────────────────────────────────────────────────

  renderActivityCharts(container) {
    if (!container) container = document.getElementById('activity-charts-content');
    if (!container || !this.activityData) return;

    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'activity-chart-container';

    // --- 14-Day Activity Bar Chart ---
    root.appendChild(this._renderDailyChart());

    // --- 24-Hour Heatmap ---
    root.appendChild(this._renderHeatmap());

    // --- Audit Log ---
    root.appendChild(this._renderAuditLog());

    container.appendChild(root);
  },

  // ── 14-Day Stacked Bar Chart ──────────────────────────────────────────────

  _renderDailyChart() {
    const section = document.createElement('div');

    const label = document.createElement('div');
    label.className = 'activity-section-label';
    label.textContent = '14-Day Activity (minutes active)';
    section.appendChild(label);

    const wrapper = document.createElement('div');
    wrapper.className = 'daily-chart-wrapper';

    // Find max total for scaling
    const data = this.activityData.dailyActivity;
    let maxTotal = 0;
    for (const day of data) {
      let dayTotal = 0;
      for (const agentId of AGENT_IDS) dayTotal += (day.agents[agentId] || 0);
      if (dayTotal > maxTotal) maxTotal = dayTotal;
    }
    // Ensure minimum scale
    if (maxTotal < 10) maxTotal = 10;

    // Grid lines at 25%, 50%, 75%, 100%
    const chartHeight = 120;
    for (const pct of [25, 50, 75, 100]) {
      const gridline = document.createElement('div');
      gridline.className = 'daily-chart-gridline';
      gridline.style.bottom = (pct / 100 * chartHeight) + 'px';

      const gridLabel = document.createElement('span');
      gridLabel.className = 'daily-chart-gridline-label';
      gridLabel.style.bottom = (pct / 100 * chartHeight) + 'px';
      gridLabel.textContent = Math.round(maxTotal * pct / 100);

      wrapper.appendChild(gridline);
      wrapper.appendChild(gridLabel);
    }

    // Bar chart
    const chart = document.createElement('div');
    chart.className = 'daily-chart';

    const todayStr = this._todayDateStr();

    // Pad to 14 days (fill missing days with empty)
    const paddedDays = this._padDailyData(data);

    for (const day of paddedDays) {
      const bar = document.createElement('div');
      bar.className = 'daily-bar';

      let dayTotal = 0;

      // Stacked segments (bottom to top)
      for (const agentId of AGENT_IDS) {
        const minutes = day.agents[agentId] || 0;
        dayTotal += minutes;
        if (minutes <= 0) continue;

        const seg = document.createElement('div');
        seg.className = 'daily-bar-segment';
        const heightPx = Math.max(1, (minutes / maxTotal) * chartHeight);
        seg.style.height = heightPx + 'px';
        seg.style.background = AGENTS[agentId] ? AGENTS[agentId].color : '#6b7280';
        seg.style.opacity = '0.85';
        bar.appendChild(seg);
      }

      // If no data, show ghost bar
      if (dayTotal === 0) {
        const ghost = document.createElement('div');
        ghost.className = 'daily-bar-segment';
        ghost.style.height = '2px';
        ghost.style.background = 'rgba(255,255,255,0.04)';
        bar.appendChild(ghost);
      }

      // Day label
      const dayLabel = document.createElement('div');
      dayLabel.className = 'daily-bar-label';
      if (day.date === todayStr) dayLabel.classList.add('today');
      dayLabel.textContent = this._getDayLabel(day.date);
      bar.appendChild(dayLabel);

      // Tooltip
      const tooltip = this._buildBarTooltip(day, dayTotal);
      bar.appendChild(tooltip);

      chart.appendChild(bar);
    }

    wrapper.appendChild(chart);
    section.appendChild(wrapper);
    return section;
  },

  _buildBarTooltip(day, dayTotal) {
    const tooltip = document.createElement('div');
    tooltip.className = 'daily-bar-tooltip';

    const dateRow = document.createElement('div');
    dateRow.className = 'tooltip-date';
    dateRow.textContent = day.date + ' \u2014 ' + dayTotal + 'm total';
    tooltip.appendChild(dateRow);

    for (const agentId of AGENT_IDS) {
      const minutes = day.agents[agentId] || 0;
      if (minutes <= 0) continue;

      const row = document.createElement('div');
      row.className = 'tooltip-row';

      const swatch = document.createElement('span');
      swatch.className = 'tooltip-swatch';
      swatch.style.background = AGENTS[agentId] ? AGENTS[agentId].color : '#6b7280';
      row.appendChild(swatch);

      const name = document.createElement('span');
      name.className = 'tooltip-agent';
      name.textContent = AGENTS[agentId] ? AGENTS[agentId].name : agentId;
      row.appendChild(name);

      const val = document.createElement('span');
      val.className = 'tooltip-value';
      val.textContent = minutes + 'm';
      row.appendChild(val);

      tooltip.appendChild(row);
    }

    return tooltip;
  },

  _padDailyData(data) {
    // Build a 14-day array ending today, filling gaps with empty days
    const result = [];
    const today = new Date();
    for (let i = ACTIVITY_MAX_DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = this._formatDateStr(d);
      const existing = data.find(entry => entry.date === dateStr);
      if (existing) {
        result.push(existing);
      } else {
        const empty = { date: dateStr, agents: {} };
        for (const agentId of AGENT_IDS) empty.agents[agentId] = 0;
        result.push(empty);
      }
    }
    return result;
  },

  // ── 24-Hour Heatmap ───────────────────────────────────────────────────────

  _renderHeatmap() {
    const section = document.createElement('div');

    const label = document.createElement('div');
    label.className = 'activity-section-label';
    label.textContent = 'Today \u2014 Hourly Activity';
    section.appendChild(label);

    const row = document.createElement('div');
    row.className = 'heatmap-row';

    const heatmap = this.activityData.hourlyHeatmap;
    const currentHour = new Date().getHours();

    // Find max for intensity scaling
    let maxEvents = 0;
    for (let h = 0; h < 24; h++) {
      if (heatmap[h].total > maxEvents) maxEvents = heatmap[h].total;
    }
    if (maxEvents < 1) maxEvents = 1;

    for (let h = 0; h < 24; h++) {
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      if (h === currentHour) cell.classList.add('current-hour');

      const total = heatmap[h].total;
      const intensity = total > 0 ? 0.15 + (total / maxEvents) * 0.85 : 0.04;
      cell.style.background = this._heatmapColor(intensity);

      // Tooltip
      const tip = document.createElement('div');
      tip.className = 'heatmap-tooltip';
      const hourLabel = String(h).padStart(2, '0') + ':00';
      let tipText = hourLabel + ' \u2014 ' + total + ' event' + (total !== 1 ? 's' : '');
      // Per-agent breakdown
      if (total > 0) {
        for (const agentId of AGENT_IDS) {
          const agentCount = heatmap[h].byAgent[agentId] || 0;
          if (agentCount > 0) {
            const agentName = AGENTS[agentId] ? AGENTS[agentId].name : agentId;
            tipText += '\n' + agentName + ': ' + agentCount;
          }
        }
      }
      tip.style.whiteSpace = 'pre';
      tip.textContent = tipText;
      cell.appendChild(tip);

      row.appendChild(cell);
    }

    section.appendChild(row);

    // Hour labels
    const labels = document.createElement('div');
    labels.className = 'heatmap-labels';
    for (let h = 0; h < 24; h++) {
      const lbl = document.createElement('div');
      lbl.className = 'heatmap-label';
      // Show label every 3 hours to avoid clutter
      lbl.textContent = (h % 3 === 0) ? String(h).padStart(2, '0') : '';
      labels.appendChild(lbl);
    }
    section.appendChild(labels);

    return section;
  },

  _heatmapColor(intensity) {
    // Blue-tinted color from nearly transparent to solid
    const r = 59, g = 130, b = 246; // matches --color-architect / ACTIVITY_HEATMAP_COLOR
    return 'rgba(' + r + ',' + g + ',' + b + ',' + intensity.toFixed(2) + ')';
  },

  // ── Audit Log ─────────────────────────────────────────────────────────────

  _renderAuditLog() {
    const section = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'audit-log-header';

    const label = document.createElement('div');
    label.className = 'activity-section-label';
    label.textContent = 'Audit Log';
    header.appendChild(label);

    const exportBtn = document.createElement('button');
    exportBtn.className = 'audit-export-btn';
    exportBtn.textContent = 'Export JSON';
    exportBtn.addEventListener('click', () => this.exportAuditLog());
    header.appendChild(exportBtn);

    section.appendChild(header);

    const logEl = document.createElement('div');
    logEl.className = 'audit-log';
    logEl.id = 'activity-audit-log';

    this._renderAuditLogEntries(logEl);

    section.appendChild(logEl);
    return section;
  },

  _renderAuditLogEntries(logEl) {
    logEl.innerHTML = '';
    const entries = this.activityData.auditLog;

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'audit-empty';
      empty.textContent = 'No events recorded yet';
      logEl.appendChild(empty);
      return;
    }

    // Show last N entries, newest first
    const sliceStart = Math.max(0, entries.length - ACTIVITY_AUDIT_DISPLAY);
    const visible = entries.slice(sliceStart).reverse();

    for (const entry of visible) {
      const row = document.createElement('div');
      row.className = 'audit-entry';

      // Timestamp
      const ts = document.createElement('span');
      ts.className = 'audit-ts';
      const d = new Date(entry.ts);
      ts.textContent = String(d.getHours()).padStart(2, '0') + ':' +
                        String(d.getMinutes()).padStart(2, '0');
      row.appendChild(ts);

      // Actor icon
      const actor = document.createElement('span');
      actor.className = 'audit-actor';
      if (entry.actorType === 'agent' && AGENTS[entry.actorId]) {
        actor.textContent = AGENTS[entry.actorId].emoji;
        actor.style.color = AGENTS[entry.actorId].color;
        actor.title = AGENTS[entry.actorId].name;
      } else if (entry.actorType === 'user') {
        actor.textContent = '\u{1F464}';
        actor.title = 'User';
      } else {
        actor.textContent = '\u2699\uFE0F';
        actor.style.color = '#6b7b8d';
        actor.title = 'System';
      }
      row.appendChild(actor);

      // Action
      const action = document.createElement('span');
      action.className = 'audit-action';
      action.textContent = entry.action;
      row.appendChild(action);

      // Entity
      if (entry.entityType || entry.entityId) {
        const entity = document.createElement('span');
        entity.className = 'audit-entity';
        let entityText = '';
        if (entry.entityType) entityText += entry.entityType;
        if (entry.entityId) entityText += (entityText ? ':' : '') + entry.entityId;
        entity.textContent = entityText;
        row.appendChild(entity);
      }

      logEl.appendChild(row);
    }
  },

  // ── Export ─────────────────────────────────────────────────────────────────

  exportAuditLog() {
    if (!this.activityData || !this.activityData.auditLog.length) return;

    const payload = {
      exported: new Date().toISOString(),
      totalEntries: this.activityData.auditLog.length,
      entries: this.activityData.auditLog.map(e => ({
        timestamp: new Date(e.ts).toISOString(),
        actorType: e.actorType,
        actorId: e.actorId,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        details: e.details,
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-log-' + this._todayDateStr() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // ── Helpers ────────────────────────────────────────────────────────────────

  _getDayLabel(dateStr) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = new Date(dateStr + 'T00:00:00');
    return days[d.getDay()] || '???';
  },

  _todayDateStr() {
    return this._formatDateStr(new Date());
  },

  _formatDateStr(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  },
});
