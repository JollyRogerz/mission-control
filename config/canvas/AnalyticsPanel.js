'use strict';
// ADAPT-09 audit (Phase 2): no body-sending fetch() POSTs in this file as of 2026-05-04; CI guard `tests/guard_content_type.sh` prevents future regressions.

// ---------------------------------------------------------------------------
// AnalyticsPanel.js — Social media analytics dashboard panel
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------
// Per-pillar breakdown, summary cards, recent posts, platform comparison.
// Pure CSS charts — no canvas, no SVG, no external libraries.
// ---------------------------------------------------------------------------

// ---- Constants ------------------------------------------------------------

const ANALYTICS_REFRESH_MS = 60000; // auto-refresh every 60 seconds

// ---- CSS (injected once) --------------------------------------------------

const ANALYTICS_PANEL_CSS = `
/* ── Analytics Panel ─────────────────────────────────────────────────────── */

#analytics-panel-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 10px 12px;
  height: 100%;
  overflow-y: auto;
  font-family: inherit;
  color: var(--text-primary, #c8d6e5);
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.08) transparent;
}
#analytics-panel-content::-webkit-scrollbar { width: 4px; }
#analytics-panel-content::-webkit-scrollbar-track { background: transparent; }
#analytics-panel-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

/* ── Summary cards row ───────────────────────────────────────────────────── */

.analytics-summary-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 8px;
}

.analytics-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border, rgba(255,255,255,0.06));
}

.analytics-card-label {
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-secondary, #6b7b8d);
}

.analytics-card-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-bright, #e8f0ff);
  font-variant-numeric: tabular-nums;
}

.analytics-card-sub {
  font-size: 9px;
  color: var(--text-secondary, #8a9aab);
}

/* ── Section label ───────────────────────────────────────────────────────── */

.analytics-section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: var(--text-secondary, #6b7b8d);
  margin-bottom: 4px;
}

/* ── Pillar bar chart ────────────────────────────────────────────────────── */

.analytics-pillar-chart {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.analytics-pillar-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.analytics-pillar-name {
  font-size: 10px;
  width: 80px;
  flex-shrink: 0;
  text-align: right;
  color: var(--text-primary, #c8d6e5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.analytics-pillar-bar-track {
  flex: 1;
  height: 14px;
  border-radius: 3px;
  background: rgba(255,255,255,0.04);
  overflow: hidden;
  position: relative;
}

.analytics-pillar-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s ease;
  min-width: 0;
  display: flex;
  align-items: center;
  padding-left: 6px;
}

.analytics-pillar-bar-fill.best-pillar {
  box-shadow: 0 0 8px rgba(255,255,255,0.15);
}

.analytics-pillar-bar-label {
  font-size: 8px;
  color: rgba(255,255,255,0.9);
  white-space: nowrap;
}

.analytics-pillar-count {
  font-size: 10px;
  width: 28px;
  text-align: right;
  color: var(--text-secondary, #8a9aab);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* ── Recent posts ────────────────────────────────────────────────────────── */

.analytics-post-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.analytics-post-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  background: rgba(255,255,255,0.02);
  font-size: 11px;
  line-height: 1.4;
}
.analytics-post-item:hover {
  background: rgba(255,255,255,0.04);
}

.analytics-post-platform {
  flex-shrink: 0;
  font-size: 10px;
  width: 16px;
  text-align: center;
}

.analytics-post-text {
  flex: 1;
  color: var(--text-primary, #c8d6e5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.analytics-post-pillar {
  flex-shrink: 0;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255,255,255,0.06);
  color: var(--text-secondary, #8a9aab);
}

.analytics-post-wildcard {
  flex-shrink: 0;
  font-size: 10px;
  color: #f59e0b;
  title: "Wildcard post";
}

.analytics-post-score {
  flex-shrink: 0;
  font-size: 9px;
  color: var(--text-secondary, #6b7b8d);
  font-variant-numeric: tabular-nums;
  width: 32px;
  text-align: right;
}

/* ── Platform comparison ─────────────────────────────────────────────────── */

.analytics-platform-row {
  display: flex;
  gap: 10px;
}

.analytics-platform-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border, rgba(255,255,255,0.06));
}

.analytics-platform-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.analytics-platform-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary, #c8d6e5);
}

.analytics-platform-count {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-bright, #e8f0ff);
  font-variant-numeric: tabular-nums;
}

.analytics-platform-stat {
  font-size: 9px;
  color: var(--text-secondary, #8a9aab);
}

/* ── Period toggle ───────────────────────────────────────────────────────── */

.analytics-period-toggle {
  display: flex;
  gap: 4px;
}

.analytics-period-btn {
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border, rgba(255,255,255,0.06));
  color: var(--text-secondary, #6b7b8d);
  font-size: 9px;
  font-family: inherit;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.analytics-period-btn:hover {
  background: rgba(255,255,255,0.08);
  color: var(--text-primary, #c8d6e5);
}
.analytics-period-btn.active {
  background: var(--accent, #3b82f6);
  border-color: var(--accent, #3b82f6);
  color: #fff;
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

.analytics-empty {
  text-align: center;
  padding: 24px 16px;
  color: var(--text-secondary, #8a9aab);
  font-size: 12px;
}

/* ── Reduced motion ──────────────────────────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
  .analytics-pillar-bar-fill { transition: none; }
}
`;

(function() {
  const style = document.createElement('style');
  style.textContent = ANALYTICS_PANEL_CSS;
  document.head.appendChild(style);
})();


// ---- Prototype extension ----------------------------------------------------

Object.assign(MissionControl.prototype, {

  // ── Initialization ────────────────────────────────────────────────────────

  initAnalyticsPanel() {
    this._analyticsPeriod = 'week';
    this._analyticsData = null;

    // Fetch initial data
    this._fetchAnalyticsData();

    // Auto-refresh
    this._analyticsRefreshTimer = setInterval(
      () => this._fetchAnalyticsData(),
      ANALYTICS_REFRESH_MS
    );
  },

  // ── Data fetching ─────────────────────────────────────────────────────────

  async _fetchAnalyticsData() {
    try {
      const url = this.bridgeUrl + '/api/analytics?period=' + this._analyticsPeriod;
      const res = await fetch(url, {
        headers: { 'X-Auth-Token': this.bridgeToken || this.gatewayToken },
      });
      if (!res.ok) {
        console.warn('[AnalyticsPanel] Fetch failed:', res.status);
        return;
      }
      this._analyticsData = await res.json();
      this.renderAnalyticsPanel();
    } catch (e) {
      console.warn('[AnalyticsPanel] Fetch error:', e.message);
    }
  },

  // ── Render ────────────────────────────────────────────────────────────────

  renderAnalyticsPanel() {
    var container = document.getElementById('analytics-panel-content');
    if (!container) return;

    var data = this._analyticsData;
    if (!data) {
      container.innerHTML = '<div class="analytics-empty">Loading analytics data...</div>';
      return;
    }

    var html = '';

    // --- Header ---
    html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    html += '<div class="analytics-section-label">Analytics</div>';
    html += '</div>';

    // --- Summary cards ---
    var publishedCount = 0;
    var failedCount = 0;
    for (var j = 0; j < (data.status_counts || []).length; j++) {
      var sc = data.status_counts[j];
      if (sc.status === 'published') publishedCount = sc.count;
      if (sc.status === 'failed') failedCount = sc.count;
    }

    var engagementTotal = 0;
    for (var k = 0; k < (data.pillar_engagement || []).length; k++) {
      engagementTotal += data.pillar_engagement[k].total || 0;
    }
    var engagementRatio = data.total_posts > 0
      ? Math.round((engagementTotal / (engagementTotal + data.total_posts)) * 100)
      : 0;

    html += '<div class="analytics-summary-row">';
    html += this._analyticsCard('Posts', data.total_posts, publishedCount + ' published');
    html += this._analyticsCard('Engagement', engagementTotal, engagementRatio + '% ratio');
    html += this._analyticsCard('Relationships', (data.relationships || {}).total || 0, ((data.relationships || {}).mutual || 0) + ' mutual');
    html += this._analyticsCard('Failed', failedCount, '');
    html += '</div>';

    // --- Activity (integrations) — placeholder; async fetch fills it in ---
    html += '<div class="analytics-section-label">Activity</div>';
    html += '<div id="analytics-activity-placeholder" class="analytics-empty">Loading activity...</div>';

    // --- Recent posts ---
    html += '<div class="analytics-section-label">Recent Posts</div>';
    html += this._renderRecentPosts(data);

    container.innerHTML = html;

    // Kick off async activity fetch after DOM is set
    this._fetchActivityData();
  },

  // ── Summary card helper ───────────────────────────────────────────────────

  _analyticsCard(label, value, sub) {
    return '<div class="analytics-card">' +
      '<div class="analytics-card-label">' + label + '</div>' +
      '<div class="analytics-card-value">' + value + '</div>' +
      (sub ? '<div class="analytics-card-sub">' + sub + '</div>' : '') +
      '</div>';
  },

  // ── Activity panel (integrations) ────────────────────────────────────────

  async _fetchActivityData() {
    try {
      var res = await fetch(this.bridgeUrl + '/api/integrations', {
        headers: {
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
          'Content-Type': 'application/json',
        },
      });
      var integrations = res.ok ? await res.json() : [];

      var el = document.getElementById('analytics-activity-placeholder');
      if (!el) return;

      if (!Array.isArray(integrations) || integrations.length === 0) {
        el.innerHTML = '<div class="empty-state">No integrations configured</div>';
        return;
      }

      var html = '<div class="analytics-platform-row">';
      for (var i = 0; i < integrations.length; i++) {
        var intg = integrations[i];
        var name = this._escapeHtml(intg.name || intg.id || 'Integration');
        var status = intg.status || 'unknown';
        var statusColor = status === 'ok' ? '#22c55e' : status === 'error' ? '#ef4444' : '#6b7280';
        html += '<div class="analytics-platform-col">';
        html += '<div class="analytics-platform-header">';
        html += '<span class="analytics-platform-name">' + name + '</span>';
        html += '<span style="font-size:10px;color:' + statusColor + '">' + this._escapeHtml(status) + '</span>';
        html += '</div>';
        if (intg.last_check) {
          html += '<div class="analytics-platform-stat">Last check: ' + this._escapeHtml(intg.last_check) + '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
      el.innerHTML = html;
    } catch (e) {
      var el2 = document.getElementById('analytics-activity-placeholder');
      if (el2) el2.innerHTML = '<div class="empty-state">No integrations configured</div>';
    }
  },

  // ── Recent posts list ─────────────────────────────────────────────────────

  _renderRecentPosts(data) {
    var posts = data.recent_posts || [];
    if (posts.length === 0) {
      return '<div class="analytics-empty">No posts recorded yet</div>';
    }

    var html = '<div class="analytics-post-list">';
    for (var i = 0; i < posts.length; i++) {
      var post = posts[i];
      var platformIcon = post.platform ? this._escapeHtml(post.platform.substring(0, 2).toUpperCase()) : '--';
      var text = (post.text || '').substring(0, 80);
      var pillar = post.pillar || '?';
      var score = post.similarity_score != null ? post.similarity_score.toFixed(2) : '--';
      var isWildcard = post.wildcard === 1 || post.wildcard === true;

      html += '<div class="analytics-post-item">';
      html += '<span class="analytics-post-platform">' + platformIcon + '</span>';
      html += '<span class="analytics-post-text">' + this._escapeHtml(text) + '</span>';
      if (isWildcard) {
        html += '<span class="analytics-post-wildcard" title="Wildcard post">*</span>';
      }
      html += '<span class="analytics-post-pillar">' + pillar + '</span>';
      html += '<span class="analytics-post-score">' + score + '</span>';
      html += '</div>';
    }
    html += '</div>';

    return html;
  },

  // ── HTML escaping ─────────────────────────────────────────────────────────

  _escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  },

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroyAnalyticsPanel() {
    if (this._analyticsRefreshTimer) {
      clearInterval(this._analyticsRefreshTimer);
      this._analyticsRefreshTimer = null;
    }
  },
});
