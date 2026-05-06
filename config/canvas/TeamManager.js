'use strict';
// ADAPT-09 audit (Phase 2): no body-sending fetch() POSTs in this file as of 2026-05-04; CI guard `tests/guard_content_type.sh` prevents future regressions.

// ---------------------------------------------------------------------------
// TeamManager.js — Team structure view with agent cards and live stats
// Extends MissionControl.prototype
// ---------------------------------------------------------------------------

Object.assign(MissionControl.prototype, {

  initTeamView() {
    this.teamGrid = document.getElementById('team-grid');
    this._loadTeamData();

    // Refresh stats every 5 seconds
    this._teamStatsRefresh = setInterval(() => this._updateTeamStats(), 5000);
  },

  async _loadTeamData() {
    if (!this.teamGrid) return;

    try {
      const res = await fetch(this.bridgeUrl + '/api/team', {
        headers: { 'X-Auth-Token': this.bridgeToken || this.gatewayToken },
      });
      if (res.ok) {
        const data = await res.json();
        this._renderTeamGrid(data);
      } else {
        // Fall back to local AGENTS config
        this._renderTeamGrid(null);
      }
    } catch (e) {
      // Fall back to local AGENTS config
      this._renderTeamGrid(null);
    }
  },

  _renderTeamGrid(serverData) {
    if (!this.teamGrid) return;
    this.teamGrid.innerHTML = '';

    for (const agentId of AGENT_IDS) {
      const agentCfg = AGENTS[agentId];
      const agentState = this.agents[agentId] || {};
      const serverAgent = serverData ? serverData.find(a => a.id === agentId) : null;

      const card = document.createElement('div');
      card.className = 'team-card';
      card.style.setProperty('--card-accent', agentCfg.color);

      // Role description from server data or fallback
      const role = serverAgent?.role || this._getDefaultRole(agentId);
      const capabilities = serverAgent?.capabilities || this._getDefaultCapabilities(agentId);
      const cronJobs = serverAgent?.cron_job_count || 0;

      var displayName = (agentCfg && agentCfg.display_name) || agentId;
      var spriteHtml = '<div class="team-card-sprite-wrap"><span class="agent-sprite sprite-' + displayName + '"></span></div>';

      card.innerHTML =
        '<div class="team-card-header">' +
          spriteHtml +
          '<div>' +
            '<div class="team-card-name" style="color:' + agentCfg.color + '">' + escapeHtml(agentCfg.name) + '</div>' +
            '<div class="team-card-model">' + escapeHtml(agentCfg.defaultModel || agentState.model) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="team-card-section">' +
          '<div class="team-card-section-title">Role</div>' +
          '<div style="font-size:11px;color:var(--text-secondary)">' + escapeHtml(role) + '</div>' +
        '</div>' +
        '<div class="team-card-section">' +
          '<div class="team-card-section-title">Capabilities</div>' +
          '<ul>' + capabilities.map(c => '<li>' + escapeHtml(c) + '</li>').join('') + '</ul>' +
        '</div>' +
        '<div class="team-card-stats" id="team-stats-' + agentId + '">' +
          '<div class="team-stat">' +
            '<div class="team-stat-value" id="team-tokens-' + agentId + '">' + this._formatTeamTokens(agentState) + '</div>' +
            '<div class="team-stat-label">Tokens</div>' +
          '</div>' +
          '<div class="team-stat">' +
            '<div class="team-stat-value" id="team-errors-' + agentId + '">' + (agentState.errorCount || 0) + '</div>' +
            '<div class="team-stat-label">Errors</div>' +
          '</div>' +
          '<div class="team-stat">' +
            '<div class="team-stat-value" id="team-jobs-' + agentId + '">' + cronJobs + '</div>' +
            '<div class="team-stat-label">Cron Jobs</div>' +
          '</div>' +
        '</div>';

      this.teamGrid.appendChild(card);

      // Add offline visual for idle/offline agents
      var currentState = agentState.state || 'idle';
      if (currentState === 'idle' || currentState === 'offline') {
        card.classList.add('agent-offline');
      }
    }
  },

  _updateTeamStats() {
    for (const agentId of AGENT_IDS) {
      const agentState = this.agents[agentId] || {};
      const tokensEl = document.getElementById('team-tokens-' + agentId);
      const errorsEl = document.getElementById('team-errors-' + agentId);

      if (tokensEl) tokensEl.textContent = this._formatTeamTokens(agentState);
      if (errorsEl) {
        errorsEl.textContent = agentState.errorCount || 0;
        if (agentState.errorCount > 0) errorsEl.style.color = 'var(--color-error)';
      }
    }
  },

  _formatTeamTokens(agentState) {
    const total = (agentState.tokensIn || 0) + (agentState.tokensOut || 0);
    if (total === 0) return '0';
    if (total >= 1000000) return (total / 1000000).toFixed(1) + 'M';
    if (total >= 1000) return (total / 1000).toFixed(1) + 'k';
    return String(total);
  },

  _getDefaultRole(agentId) {
    const roles = {
      'assistant': 'General support role. Handles incoming requests, routes tasks, and provides direct assistance.',
      'researcher': 'Information gathering role. Researches topics, analyzes data, and surfaces insights.',
    };
    return roles[agentId] || 'Agent';
  },

  _getDefaultCapabilities(agentId) {
    const caps = {
      'assistant': ['Request handling', 'Task routing', 'Direct assistance', 'Status reporting'],
      'researcher': ['Information retrieval', 'Data analysis', 'Research synthesis', 'Insight generation'],
    };
    return caps[agentId] || ['General purpose'];
  },
});
