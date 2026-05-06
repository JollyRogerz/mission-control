'use strict';

// ---------------------------------------------------------------------------
// CostPanel.js — Cost tracking, budget visualization, and spend analytics
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------

// ---- Cost rates per model ($ per 1k tokens) --------------------------------

const MODEL_RATES = {
  'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
  'claude-opus-4-6':   { input: 0.015, output: 0.075 },
  'gemini-2.5-flash':  { input: 0.00015, output: 0.0006 },
  'gemini-2.5-pro':    { input: 0.00125, output: 0.01 },
};
const DEFAULT_RATE = { input: 0.003, output: 0.015 };

// ---- Max event buffer -------------------------------------------------------

const MAX_COST_EVENTS = 500;
const DAILY_HISTORY_DAYS = 14;
const COST_SAMPLE_INTERVAL_MS = 5000;

// ---- CSS --------------------------------------------------------------------

const COST_PANEL_CSS = `
/* ── Cost Panel ─────────────────────────────────────────────────────────── */

#cost-panel-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 10px 12px;
  height: 100%;
  overflow-y: auto;
  font-family: inherit;
  color: var(--text-primary, #c8d6e5);
}

/* ── Summary bar ─────────────────────────────────────────────────────────── */

.cost-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 6px;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border, rgba(255,255,255,0.06));
}

.cost-summary-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.cost-summary-title {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-secondary, #6b7b8d);
}

.cost-summary-amount {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-bright, #e8f0ff);
  font-variant-numeric: tabular-nums;
}

.cost-summary-budget {
  font-size: 11px;
  color: var(--text-secondary, #6b7b8d);
  font-variant-numeric: tabular-nums;
}

.cost-progress-track {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: rgba(255,255,255,0.06);
  overflow: hidden;
}

.cost-progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.6s ease, background 0.4s ease, box-shadow 0.4s ease;
  min-width: 0;
}

.cost-progress-fill.level-ok {
  background: linear-gradient(90deg, #22c55e, #4ade80);
}
.cost-progress-fill.level-warn {
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
  box-shadow: 0 0 8px rgba(245,158,11,0.3);
}
.cost-progress-fill.level-danger {
  background: linear-gradient(90deg, #ef4444, #f87171);
  box-shadow: 0 0 12px rgba(239,68,68,0.45);
  animation: cost-pulse 1.8s ease-in-out infinite;
}

@keyframes cost-pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(239,68,68,0.35); }
  50%      { box-shadow: 0 0 18px rgba(239,68,68,0.6); }
}

.cost-utilization {
  font-size: 10px;
  color: var(--text-secondary, #8a9aab);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* ── Agent breakdown ─────────────────────────────────────────────────────── */

.cost-agents {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cost-agents-title {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-secondary, #6b7b8d);
}

.cost-agent-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.cost-agent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.cost-agent-name {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-primary, #c8d6e5);
}

.cost-agent-name .agent-emoji {
  font-size: 13px;
}

.cost-agent-stats {
  display: flex;
  gap: 10px;
  color: var(--text-secondary, #6b7b8d);
  font-variant-numeric: tabular-nums;
}

.cost-agent-dollar {
  color: var(--text-bright, #e8f0ff);
  font-weight: 600;
  min-width: 48px;
  text-align: right;
}

.cost-agent-tokens {
  font-size: 10px;
  color: var(--text-secondary, #8a9aab);
}

.cost-agent-bar-track {
  height: 4px;
  border-radius: 2px;
  background: rgba(255,255,255,0.04);
  overflow: hidden;
}

.cost-agent-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
  min-width: 0;
}

/* ── 14-day chart ────────────────────────────────────────────────────────── */

.cost-chart {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
}

.cost-chart-title {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-secondary, #6b7b8d);
}

.cost-chart-container {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  flex: 1;
  min-height: 60px;
  max-height: 140px;
  padding-top: 4px;
}

.cost-chart-day {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.cost-chart-bar {
  width: 100%;
  display: flex;
  flex-direction: column-reverse;
  border-radius: 2px 2px 0 0;
  overflow: hidden;
  min-height: 2px;
  transition: height 0.4s ease;
}

.cost-chart-segment {
  width: 100%;
  min-height: 0;
  transition: height 0.4s ease;
}

.cost-chart-label {
  font-size: 9px;
  color: var(--text-secondary, #8a9aab);
  text-align: center;
  white-space: nowrap;
}

.cost-chart-amount {
  font-size: 8px;
  color: var(--text-secondary, #6b7b8d);
  text-align: center;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cost-chart-day:hover .cost-chart-label,
.cost-chart-day:hover .cost-chart-amount {
  color: var(--text-primary, #c8d6e5);
}

.cost-chart-day.today .cost-chart-label {
  color: var(--text-primary, #c8d6e5);
  font-weight: 600;
}

/* ── Export button ────────────────────────────────────────────────────────── */

.cost-export-row {
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
}

.cost-export-btn {
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border, rgba(255,255,255,0.06));
  color: var(--text-secondary, #6b7b8d);
  font-size: 10px;
  font-family: inherit;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.cost-export-btn:hover {
  background: rgba(255,255,255,0.08);
  color: var(--text-primary, #c8d6e5);
  border-color: var(--border-active, rgba(255,255,255,0.12));
}
`;

// ---- Inject CSS on load -----------------------------------------------------

(function() {
  const style = document.createElement('style');
  style.textContent = COST_PANEL_CSS;
  document.head.appendChild(style);
})();

// ---- Day name helpers -------------------------------------------------------

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function _dateKey(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function _todayKey() {
  return _dateKey(new Date());
}

// ---- Cost number animation helper -------------------------------------------

function _animateNumber(el, from, to, duration) {
  if (typeof anime === 'undefined') {
    el.textContent = '$' + to.toFixed(2);
    return;
  }
  var obj = { val: from };
  anime({
    targets: obj,
    val: to,
    duration: duration || 600,
    easing: 'easeOutExpo',
    update: function() { el.textContent = '$' + obj.val.toFixed(2); }
  });
}

// ---- Prototype extension ----------------------------------------------------

Object.assign(MissionControl.prototype, {

  // ── Initialization ──────────────────────────────────────────────────────────

  initCostTracking() {
    // Data model
    this.costData = {
      totalCostCents: 0,
      budgetCents: 5000,  // $50 default monthly budget
      agents: {},
      dailyCosts: [],
      events: [],
    };

    // Seed per-agent data
    for (const id of AGENT_IDS) {
      this.costData.agents[id] = {
        costCents: 0,
        inputTokens: 0,
        outputTokens: 0,
        runCount: 0,
        model: AGENTS[id] ? AGENTS[id].defaultModel : '',
      };
    }

    // Seed daily array for the last 14 days
    const now = new Date();
    for (let i = DAILY_HISTORY_DAYS - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const byAgent = {};
      for (const id of AGENT_IDS) byAgent[id] = 0;
      this.costData.dailyCosts.push({
        date: _dateKey(d),
        totalCents: 0,
        byAgent,
      });
    }

    // Track previous token counts for delta computation
    this._costPrevTokens = {};
    for (const id of AGENT_IDS) {
      this._costPrevTokens[id] = {
        tokensIn: this.agents[id] ? this.agents[id].tokensIn : 0,
        tokensOut: this.agents[id] ? this.agents[id].tokensOut : 0,
      };
    }

    // Start sampling interval
    this._costSampleTimer = setInterval(() => this._sampleTokenDeltas(), COST_SAMPLE_INTERVAL_MS);

    // Start render interval
    this._costRenderTimer = setInterval(() => this.renderCostPanel(), COST_SAMPLE_INTERVAL_MS);

    // FEAT-PERSIST: Hydrate from Bridge (load persisted cost history)
    this._hydrateCostData();

    // Initial render
    this.renderCostPanel();
  },

  // ── Persistence: hydrate from Bridge ───────────────────────────────────────

  async _hydrateCostData() {
    try {
      const res = await fetch(this.bridgeUrl + '/api/costs/summary?days=14', {
        headers: { 'X-Auth-Token': this.bridgeToken || this.gatewayToken },
      });
      if (!res.ok) return;
      const data = await res.json();

      // Replay daily rollups into cost model
      for (const d of (data.daily || [])) {
        const existing = this.costData.dailyCosts.find(dc => dc.date === d.date);
        if (existing) {
          existing.totalCents += d.total_cents;
          if (d.agent_id && existing.byAgent) {
            existing.byAgent[d.agent_id] = (existing.byAgent[d.agent_id] || 0) + d.total_cents;
          }
        }
        // Update per-agent totals
        if (d.agent_id && this.costData.agents[d.agent_id]) {
          this.costData.agents[d.agent_id].costCents += d.total_cents;
          this.costData.agents[d.agent_id].inputTokens += d.total_input_tokens || 0;
          this.costData.agents[d.agent_id].outputTokens += d.total_output_tokens || 0;
        }
        this.costData.totalCostCents += d.total_cents;
      }

      this.renderCostPanel();
    } catch (e) {
      console.warn('[CostPanel] Hydration failed:', e.message);
    }
  },

  async _persistCostEvent(agentId, model, inputTokens, outputTokens, costCents) {
    try {
      await fetch(this.bridgeUrl + '/api/costs/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': this.bridgeToken || this.gatewayToken },
        body: JSON.stringify({ agent_id: agentId, model, input_tokens: inputTokens, output_tokens: outputTokens, cost_cents: costCents }),
      });
    } catch (_) { /* best-effort persistence */ }
  },

  // ── Token delta sampling ────────────────────────────────────────────────────

  _sampleTokenDeltas() {
    for (const agentId of AGENT_IDS) {
      const agent = this.agents[agentId];
      if (!agent) continue;

      const prev = this._costPrevTokens[agentId];
      const deltaIn = Math.max(0, agent.tokensIn - prev.tokensIn);
      const deltaOut = Math.max(0, agent.tokensOut - prev.tokensOut);

      if (deltaIn > 0 || deltaOut > 0) {
        this.recordCostEvent(agentId, deltaIn, deltaOut);
      }

      prev.tokensIn = agent.tokensIn;
      prev.tokensOut = agent.tokensOut;
    }
  },

  // ── Cost estimation ─────────────────────────────────────────────────────────

  _estimateCostCents(model, inputTokens, outputTokens) {
    const rate = MODEL_RATES[model] || DEFAULT_RATE;
    // Rate is $ per 1k tokens; convert to cents
    const costDollars = (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
    return Math.round(costDollars * 100 * 100) / 100; // 2 decimal cents
  },

  // ── Record cost event ───────────────────────────────────────────────────────

  recordCostEvent(agentId, inputTokensDelta, outputTokensDelta) {
    const agent = this.agents[agentId];
    const model = agent ? agent.model : '';
    const costCents = this._estimateCostCents(model, inputTokensDelta, outputTokensDelta);

    // FEAT-PERSIST: Persist cost event to bridge
    this._persistCostEvent(agentId, model, inputTokensDelta, outputTokensDelta, costCents);

    // Update totals
    this.costData.totalCostCents += costCents;

    // Update per-agent
    const agentCost = this.costData.agents[agentId];
    if (agentCost) {
      agentCost.costCents += costCents;
      agentCost.inputTokens += inputTokensDelta;
      agentCost.outputTokens += outputTokensDelta;
      agentCost.runCount++;
      agentCost.model = model;
    }

    // Update daily costs
    const todayStr = _todayKey();
    let todayEntry = this.costData.dailyCosts[this.costData.dailyCosts.length - 1];

    // If the last entry isn't today, roll forward
    if (!todayEntry || todayEntry.date !== todayStr) {
      const byAgent = {};
      for (const id of AGENT_IDS) byAgent[id] = 0;
      todayEntry = { date: todayStr, totalCents: 0, byAgent };
      this.costData.dailyCosts.push(todayEntry);
      // Trim to DAILY_HISTORY_DAYS
      while (this.costData.dailyCosts.length > DAILY_HISTORY_DAYS) {
        this.costData.dailyCosts.shift();
      }
    }

    todayEntry.totalCents += costCents;
    if (todayEntry.byAgent[agentId] !== undefined) {
      todayEntry.byAgent[agentId] += costCents;
    }

    // Append event
    this.costData.events.push({
      agentId,
      model,
      inputTokens: inputTokensDelta,
      outputTokens: outputTokensDelta,
      costCents,
      ts: Date.now(),
    });

    // Trim events
    while (this.costData.events.length > MAX_COST_EVENTS) {
      this.costData.events.shift();
    }
  },

  // ── Render ──────────────────────────────────────────────────────────────────

  _renderRecentCostEvents() {
    if (!this.costData || !this.costData.events) return '<div style="font-size:10px;color:var(--text-secondary)">No activity yet</div>';
    var events = this.costData.events.slice(-10).reverse();
    if (events.length === 0) return '<div style="font-size:10px;color:var(--text-secondary)">No activity yet</div>';
    return events.map(function(ev) {
      var meta = AGENTS[ev.agentId];
      var name = meta ? meta.emoji + ' ' + meta.name : ev.agentId;
      var time = new Date(ev.ts);
      var hh = String(time.getHours()).padStart(2, '0');
      var mm = String(time.getMinutes()).padStart(2, '0');
      return '<div class="cost-event-entry">' +
        '<span>' + hh + ':' + mm + ' ' + name + '</span>' +
        '<span class="cost-event-amount">$' + (ev.costCents / 100).toFixed(4) + '</span>' +
        '</div>';
    }).join('');
  },

  renderCostPanel() {
    const container = document.getElementById('cost-panel-content');
    if (!container) return;

    const data = this.costData;
    if (!data) return;

    const totalDollars = (data.totalCostCents / 100).toFixed(2);
    const budgetDollars = (data.budgetCents / 100).toFixed(2);
    const utilPct = data.budgetCents > 0
      ? Math.min((data.totalCostCents / data.budgetCents) * 100, 100)
      : 0;

    const levelClass = utilPct >= 80 ? 'level-danger' : utilPct >= 60 ? 'level-warn' : 'level-ok';

    // Find max agent cost for bar scaling
    let maxAgentCents = 0;
    for (const id of AGENT_IDS) {
      const ac = data.agents[id];
      if (ac && ac.costCents > maxAgentCents) maxAgentCents = ac.costCents;
    }

    // Build agent rows
    let agentRowsHtml = '';
    for (const id of AGENT_IDS) {
      const ac = data.agents[id];
      if (!ac) continue;
      const meta = AGENTS[id];
      if (!meta) continue;

      const agentDollars = (ac.costCents / 100).toFixed(2);
      const barPct = maxAgentCents > 0 ? (ac.costCents / maxAgentCents) * 100 : 0;

      agentRowsHtml += `
        <div class="cost-agent-row">
          <div class="cost-agent-header">
            <span class="cost-agent-name">
              <span class="agent-emoji">${meta.emoji}</span>
              ${meta.name}
            </span>
            <span class="cost-agent-stats">
              <span class="cost-agent-tokens">${this.formatTokenCount(ac.inputTokens)} in / ${this.formatTokenCount(ac.outputTokens)} out</span>
              <span class="cost-agent-dollar">$${agentDollars}</span>
            </span>
          </div>
          <div class="cost-agent-bar-track">
            <div class="cost-agent-bar-fill" style="width:${barPct.toFixed(1)}%;background:var(--color-${meta.name.toLowerCase()}, ${meta.color});"></div>
          </div>
        </div>`;
    }

    // Build 14-day chart
    const days = data.dailyCosts;
    let maxDayCents = 0;
    for (const day of days) {
      if (day.totalCents > maxDayCents) maxDayCents = day.totalCents;
    }

    const todayStr = _todayKey();
    let chartHtml = '';
    for (const day of days) {
      const d = new Date(day.date + 'T12:00:00');
      const label = DAY_LABELS[d.getDay()];
      const dayDollars = (day.totalCents / 100).toFixed(2);
      const isToday = day.date === todayStr;

      // Bar height as percentage of max (scale to available chart height)
      const barHeightPct = maxDayCents > 0 ? (day.totalCents / maxDayCents) * 100 : 0;

      // Stacked segments per agent (bottom-up)
      let segmentsHtml = '';
      for (const id of AGENT_IDS) {
        const agentCents = (day.byAgent && day.byAgent[id]) || 0;
        if (agentCents <= 0) continue;
        const segPct = day.totalCents > 0 ? (agentCents / day.totalCents) * 100 : 0;
        const meta = AGENTS[id];
        const cssColor = 'var(--color-' + (meta ? meta.name.toLowerCase() : 'unknown') + ', ' + (meta ? meta.color : '#6b7280') + ')';
        segmentsHtml += `<div class="cost-chart-segment" style="height:${segPct.toFixed(1)}%;background:${cssColor};"></div>`;
      }

      chartHtml += `
        <div class="cost-chart-day${isToday ? ' today' : ''}">
          <div class="cost-chart-amount">$${dayDollars}</div>
          <div class="cost-chart-bar" style="height:${barHeightPct.toFixed(1)}%;">
            ${segmentsHtml}
          </div>
          <div class="cost-chart-label">${label}</div>
        </div>`;
    }

    container.innerHTML = `
      <div class="cost-summary">
        <div class="cost-summary-header">
          <span class="cost-summary-title">Monthly Spend</span>
          <span class="cost-summary-budget">Budget: $${budgetDollars}</span>
        </div>
        <div class="cost-summary-amount">$${totalDollars}</div>
        <div class="cost-progress-track">
          <div class="cost-progress-fill ${levelClass}" style="width:${utilPct.toFixed(1)}%;"></div>
        </div>
        <div class="cost-utilization">${utilPct.toFixed(1)}% utilized</div>
      </div>

      <div class="cost-agents">
        <div class="cost-agents-title">Agent Breakdown</div>
        ${agentRowsHtml}
      </div>

      <div class="cost-chart">
        <div class="cost-chart-title">14-Day Spend</div>
        <div class="cost-chart-container">
          ${chartHtml}
        </div>
      </div>

      <div class="cost-event-log-title">Recent Activity</div>
      <div class="cost-event-log" id="cost-event-log">
        ${this._renderRecentCostEvents()}
      </div>

      <div class="cost-export-row">
        <button class="cost-export-btn" id="cost-export-btn">Export Report</button>
      </div>
    `;

    // Bind export button
    const exportBtn = document.getElementById('cost-export-btn');
    if (exportBtn) {
      exportBtn.onclick = () => this.exportCostReport();
    }

    // Animate last event entry slide-in
    var logEl = document.getElementById('cost-event-log');
    if (logEl && typeof anime !== 'undefined') {
      var firstEntry = logEl.querySelector('.cost-event-entry:first-child');
      if (firstEntry && this._lastCostEventCount !== (this.costData.events || []).length) {
        // Safety timeout: if anime fails mid-run the element remains visible
        var _safetyTimer = setTimeout(function() {
          firstEntry.style.opacity = '';
          firstEntry.style.transform = '';
        }, 600);
        anime({
          targets: firstEntry,
          opacity: [0, 1],
          translateX: [10, 0],
          duration: 250,
          easing: 'easeOutCubic',
          complete: function() { clearTimeout(_safetyTimer); }
        });
      }
      this._lastCostEventCount = (this.costData.events || []).length;
    }

    // Animate total cost number
    const amountEl = container.querySelector('.cost-summary-amount');
    if (amountEl) {
      const prevTotal = this._lastRenderedTotal || 0;
      _animateNumber(amountEl, prevTotal, totalDollars, 600);
      this._lastRenderedTotal = totalDollars;
    }
  },

  // ── Export ──────────────────────────────────────────────────────────────────

  exportCostReport() {
    const data = this.costData;
    if (!data) return;

    const report = {
      exportedAt: new Date().toISOString(),
      summary: {
        totalCostDollars: +(data.totalCostCents / 100).toFixed(2),
        budgetDollars: +(data.budgetCents / 100).toFixed(2),
        utilizationPct: data.budgetCents > 0
          ? +((data.totalCostCents / data.budgetCents) * 100).toFixed(1)
          : 0,
      },
      agents: {},
      dailyCosts: data.dailyCosts.map(day => ({
        date: day.date,
        totalDollars: +(day.totalCents / 100).toFixed(2),
        byAgent: Object.fromEntries(
          Object.entries(day.byAgent).map(([id, cents]) => [id, +(cents / 100).toFixed(2)])
        ),
      })),
      recentEvents: data.events.slice(-100).map(ev => ({
        agentId: ev.agentId,
        model: ev.model,
        inputTokens: ev.inputTokens,
        outputTokens: ev.outputTokens,
        costDollars: +(ev.costCents / 100).toFixed(4),
        timestamp: new Date(ev.ts).toISOString(),
      })),
    };

    for (const id of AGENT_IDS) {
      const ac = data.agents[id];
      if (!ac) continue;
      report.agents[id] = {
        costDollars: +(ac.costCents / 100).toFixed(2),
        inputTokens: ac.inputTokens,
        outputTokens: ac.outputTokens,
        runCount: ac.runCount,
        model: ac.model,
      };
    }

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mission-control-cost-report-' + _todayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // ── Cleanup ────────────────────────────────────────────────────────────────

  destroyCostTracking() {
    if (this._costSampleTimer) { clearInterval(this._costSampleTimer); this._costSampleTimer = null; }
    if (this._costRenderTimer) { clearInterval(this._costRenderTimer); this._costRenderTimer = null; }
  },
});
