'use strict';

// ---------------------------------------------------------------------------
// TimelineManager.js — per-agent activity timeline + token burn rate sparkline
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------

// Timeline window: last 5 minutes
const TIMELINE_WINDOW_MS = 5 * 60 * 1000;

// Token sampling interval (5 seconds)
const TOKEN_SAMPLE_INTERVAL_MS = 5000;

// Max samples in circular buffer (5 min / 5s = 60)
const MAX_TOKEN_SAMPLES = 60;

// Sparkline canvas dimensions
const SPARKLINE_W = 80;
const SPARKLINE_H = 20;

// State → color for timeline segments
const TIMELINE_COLORS = {
  thinking:     '#f59e0b',
  tool_running: '#22c55e',
  reading:      '#06b6d4',
  writing:      '#a78bfa',
  dispatching:  '#f59e0b',
  speaking:     '#3b82f6',
  idle:         '#3d4a5c',
  error:        '#ef4444',
  starting:     '#10b981',
  stopping:     '#6b7b8d',
  completed:    '#22c55e',
};


Object.assign(MissionControl.prototype, {

  // ── Initialization ────────────────────────────────────────────────────────

  initTimeline() {
    // Inject timeline rows and sparkline canvases into each agent card
    for (const agentId of AGENT_IDS) {
      const detailsEl = document.querySelector('#card-' + agentId + ' .agent-details');
      if (!detailsEl) continue;

      // Timeline row
      const tlRow = document.createElement('div');
      tlRow.className = 'agent-timeline-row';
      tlRow.id = 'timeline-' + agentId;
      const track = document.createElement('div');
      track.className = 'timeline-track';
      tlRow.appendChild(track);
      detailsEl.appendChild(tlRow);

      // Initialize timeline data
      this.agentTimeline[agentId] = [{
        state: 'idle',
        startTime: Date.now(),
        endTime: null,
      }];

      // Sparkline canvas next to token display
      const tokensEl = document.getElementById('tokens-' + agentId);
      if (tokensEl) {
        const wrap = document.createElement('span');
        wrap.className = 'token-sparkline-wrap';
        const canvas = document.createElement('canvas');
        canvas.className = 'token-sparkline';
        canvas.id = 'sparkline-' + agentId;
        canvas.width = SPARKLINE_W;
        canvas.height = SPARKLINE_H;
        canvas.title = 'Token burn rate (5 min)';
        wrap.appendChild(canvas);
        tokensEl.parentElement.appendChild(wrap);
      }

      // Initialize token sample data
      this.agentTokenSamples[agentId] = {
        inArr: [],
        outArr: [],
        lastIn: 0,
        lastOut: 0,
      };
    }

    // Start token sampling interval
    this._initTokenSampling();

    // Start timeline animation (update current segment width)
    this._timelineAnimFrame = null;
    this._startTimelineRAF();
  },

  // ── State Recording (called from AgentPanel.updateAgentPanels) ────────────

  recordStateChange(agentId, newState) {
    const segments = this.agentTimeline[agentId];
    if (!segments) return;

    const last = segments[segments.length - 1];
    if (last && last.state === newState) return; // same state, no change

    const now = Date.now();

    // Close previous segment
    if (last && last.endTime === null) {
      last.endTime = now;
    }

    // Push new segment
    segments.push({
      state: newState,
      startTime: now,
      endTime: null,
    });

    // Prune old segments (older than window)
    const cutoff = now - TIMELINE_WINDOW_MS;
    while (segments.length > 1 && segments[0].endTime && segments[0].endTime < cutoff) {
      segments.shift();
    }
  },

  // ── Timeline Rendering ────────────────────────────────────────────────────

  _startTimelineRAF() {
    const tick = () => {
      if (this.activePage === 'dashboard') {
        this._renderAllTimelines();
      }
      this._timelineAnimFrame = requestAnimationFrame(tick);
    };
    this._timelineAnimFrame = requestAnimationFrame(tick);
  },

  _renderAllTimelines() {
    const now = Date.now();
    const windowStart = now - TIMELINE_WINDOW_MS;

    for (const agentId of AGENT_IDS) {
      this._renderTimeline(agentId, now, windowStart);
    }
  },

  _renderTimeline(agentId, now, windowStart) {
    const trackEl = document.querySelector('#timeline-' + agentId + ' .timeline-track');
    if (!trackEl) return;

    const segments = this.agentTimeline[agentId];
    if (!segments || segments.length === 0) return;

    // Build HTML for segments (reuse existing if count matches)
    const existingDivs = trackEl.children;
    let divIdx = 0;

    for (const seg of segments) {
      const segStart = Math.max(seg.startTime, windowStart);
      const segEnd = seg.endTime !== null ? Math.min(seg.endTime, now) : now;
      if (segEnd <= windowStart) continue; // fully outside window

      const leftPct = ((segStart - windowStart) / TIMELINE_WINDOW_MS) * 100;
      const widthPct = ((segEnd - segStart) / TIMELINE_WINDOW_MS) * 100;

      let div;
      if (divIdx < existingDivs.length) {
        div = existingDivs[divIdx];
      } else {
        div = document.createElement('div');
        div.className = 'timeline-segment';
        trackEl.appendChild(div);
      }

      div.style.left = leftPct + '%';
      div.style.width = Math.max(widthPct, 0.2) + '%';
      div.style.background = TIMELINE_COLORS[seg.state] || '#3d4a5c';

      // Tooltip data
      const durMs = segEnd - seg.startTime;
      const durStr = durMs < 1000 ? durMs + 'ms'
                   : durMs < 60000 ? (durMs / 1000).toFixed(1) + 's'
                   : (durMs / 60000).toFixed(1) + 'm';
      div.title = seg.state + ' \u00B7 ' + durStr;

      divIdx++;
    }

    // Remove excess divs
    while (trackEl.children.length > divIdx) {
      trackEl.removeChild(trackEl.lastChild);
    }
  },

  // ── Token Sparkline ───────────────────────────────────────────────────────

  _initTokenSampling() {
    // Initial snapshot of current token values
    for (const agentId of AGENT_IDS) {
      const agent = this.agents[agentId];
      if (agent) {
        this.agentTokenSamples[agentId].lastIn = agent.tokensIn || 0;
        this.agentTokenSamples[agentId].lastOut = agent.tokensOut || 0;
      }
    }

    this.timelineSampleTimer = setInterval(() => this._sampleTokens(), TOKEN_SAMPLE_INTERVAL_MS);
  },

  _sampleTokens() {
    for (const agentId of AGENT_IDS) {
      const agent = this.agents[agentId];
      const samples = this.agentTokenSamples[agentId];
      if (!agent || !samples) continue;

      const currentIn = agent.tokensIn || 0;
      const currentOut = agent.tokensOut || 0;
      const deltaIn = currentIn - samples.lastIn;
      const deltaOut = currentOut - samples.lastOut;

      samples.lastIn = currentIn;
      samples.lastOut = currentOut;

      samples.inArr.push(deltaIn);
      samples.outArr.push(deltaOut);

      // Circular buffer trim
      if (samples.inArr.length > MAX_TOKEN_SAMPLES) samples.inArr.shift();
      if (samples.outArr.length > MAX_TOKEN_SAMPLES) samples.outArr.shift();

      // Render sparkline
      if (this.activePage === 'dashboard') {
        this._renderSparkline(agentId);
      }
    }
  },

  _renderSparkline(agentId) {
    const canvas = document.getElementById('sparkline-' + agentId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const samples = this.agentTokenSamples[agentId];
    if (!samples) return;

    const { inArr, outArr } = samples;
    const meta = AGENTS[agentId];
    const color = meta ? meta.color : '#6b7280';

    // Clear
    ctx.clearRect(0, 0, SPARKLINE_W, SPARKLINE_H);

    // Find max value for scaling
    const allVals = [...inArr, ...outArr];
    const maxVal = Math.max(...allVals, 1); // at least 1 to avoid division by zero

    const mid = SPARKLINE_H / 2;

    // Draw center line
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(SPARKLINE_W, mid);
    ctx.stroke();

    // Helper: draw a filled sparkline area
    const drawArea = (arr, yBase, yDir, fillAlpha, strokeAlpha) => {
      if (arr.length < 2) return;
      const step = SPARKLINE_W / (MAX_TOKEN_SAMPLES - 1);
      const startX = (MAX_TOKEN_SAMPLES - arr.length) * step;

      // Fill
      ctx.beginPath();
      ctx.moveTo(startX, yBase);
      for (let i = 0; i < arr.length; i++) {
        const x = startX + i * step;
        const h = (arr[i] / maxVal) * (SPARKLINE_H / 2 - 1);
        ctx.lineTo(x, yBase + yDir * h);
      }
      ctx.lineTo(startX + (arr.length - 1) * step, yBase);
      ctx.closePath();
      ctx.fillStyle = color + Math.round(fillAlpha * 255).toString(16).padStart(2, '0');
      ctx.fill();

      // Stroke
      ctx.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const x = startX + i * step;
        const h = (arr[i] / maxVal) * (SPARKLINE_H / 2 - 1);
        if (i === 0) ctx.moveTo(x, yBase + yDir * h);
        else ctx.lineTo(x, yBase + yDir * h);
      }
      ctx.strokeStyle = color + Math.round(strokeAlpha * 255).toString(16).padStart(2, '0');
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    // Top half: input tokens (grows upward from center)
    drawArea(inArr, mid, -1, 0.25, 0.7);

    // Bottom half: output tokens (grows downward from center)
    drawArea(outArr, mid, 1, 0.2, 0.6);
  },

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroyTimeline() {
    if (this._timelineAnimFrame) {
      cancelAnimationFrame(this._timelineAnimFrame);
      this._timelineAnimFrame = null;
    }
    if (this.timelineSampleTimer) {
      clearInterval(this.timelineSampleTimer);
      this.timelineSampleTimer = null;
    }
  },

});
