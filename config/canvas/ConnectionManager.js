'use strict';

// ---------------------------------------------------------------------------
// ConnectionManager.js — Flowing light orbs between agent sprites
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

// Connection timeout (auto-remove if no response-back)
const CONNECTION_TIMEOUT_MS = 30000;

// Animation speed: seconds for an orb to travel the full path
const DOT_TRAVEL_SECS = 2.5;

// Bezier curve offset for overlapping connections (px)
const CURVE_OFFSET_PX = 30;

// Number of orbs per connection
const ORB_COUNT = 4;


Object.assign(MissionControl.prototype, {

  // ── Initialization ────────────────────────────────────────────────────────

  initConnections() {
    this._connSvg = document.getElementById('connection-overlay');
    this._connPage = document.getElementById('page-dashboard');
    this._chainBar = document.getElementById('task-chain-bar');
    this._chainPath = document.getElementById('task-chain-path');
    this._chainDepth = document.getElementById('task-chain-depth');
    this._connLastFrame = 0;
  },

  /**
   * Resolve an agent ID to a CSS-friendly hex color, preferring the active
   * theme's orb palette so flowing orbs match the agent panels' orb colors.
   * Falls back to the legacy CSS variable lookup, then a neutral gray.
   */
  _resolveAgentHex(agentId) {
    // 1. AsciiOrbs theme palette via _getOrbColor (returns {r, g, b})
    if (typeof this._getOrbColor === 'function') {
      try {
        const c = this._getOrbColor(agentId);
        if (c && typeof c.r === 'number') {
          const h = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
          return '#' + h(c.r) + h(c.g) + h(c.b);
        }
      } catch (_) { /* fall through */ }
    }
    // 2. CSS variable (e.g. --color-orchestrator)
    try {
      const short = (agentId || '').replace(/^[a-z]+-/, '').replace(/-media$/, '');
      const cssColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-' + short).trim();
      if (cssColor) return cssColor;
    } catch (_) { /* fall through */ }
    // 3. Legacy AGENTS dict
    if (typeof AGENTS === 'object' && AGENTS[agentId] && AGENTS[agentId].color) {
      return AGENTS[agentId].color;
    }
    return '#6b7280';  // neutral gray fallback
  },

  // ── Public API — called from EventHandler.js ──────────────────────────────

  /**
   * Add a new connection between two agent panels using flowing orbs.
   * Called when a routing event fires (non-response_back).
   */
  addConnection(from, to, task, isResponseBack) {
    if (!this._connSvg || !from || !to) return;

    // If this is a response_back, complete the matching outgoing connection
    if (isResponseBack) {
      this._completeConnection(from, to);
      return;
    }

    const id = ++this.connectionIdCounter;

    // Resolve per-agent colors from the active theme's orb palette so the
    // flowing orbs reflect WHICH two agents are talking. Each orb alternates
    // between the FROM color (sender) and the TO color (recipient) so the
    // viewer reads the connection as bidirectional. Falls back to the legacy
    // CSS-var lookup, then a neutral gray.
    const fromColor = this._resolveAgentHex(from);
    const toColor = this._resolveAgentHex(to);

    const conn = {
      id,
      from,
      to,
      task: (task || '').slice(0, 80),
      color: fromColor,             // legacy field (kept for label/trail rendering)
      fromColor,
      toColor,
      state: 'dispatching',  // dispatching → in_progress → returning
      createdAt: Date.now(),
      timeoutTimer: setTimeout(() => this._fadeAndRemove(id), CONNECTION_TIMEOUT_MS),
      svgGroup: null,
      orbs: [],
    };

    // Initialize orbs with staggered positions and randomized properties.
    // Even-indexed orbs carry the sender color, odd-indexed carry the
    // recipient color — visually a two-color stream between the panels.
    for (let i = 0; i < ORB_COUNT; i++) {
      conn.orbs.push({
        progress: i / ORB_COUNT,
        speed: 0.8 + Math.random() * 0.4,
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleAmp: 3 + Math.random() * 5,
        wobbleFreq: 1.5 + Math.random() * 2,
        size: 0.7 + Math.random() * 0.6,
        opacity: 0.6 + Math.random() * 0.4,
        color: (i % 2 === 0) ? fromColor : toColor,
        glowEl: null,
        mainEl: null,
        coreEl: null,
      });
    }

    // Create SVG elements
    conn.svgGroup = this._createConnectionSVG(conn);
    this._connSvg.appendChild(conn.svgGroup);

    this.activeConnections.set(id, conn);

    // Sound effect
    if (typeof this.playOrbLaunch === 'function') this.playOrbLaunch(conn.from);

    // Start animation loop if not already running
    this._startConnRAF();

    // Update task chain bar
    this._updateTaskChain();
  },

  // ── Private: Complete / reverse a connection ──────────────────────────────

  _completeConnection(responderAgent, requesterAgent) {
    for (const [id, conn] of this.activeConnections) {
      if (conn.to === responderAgent && conn.from === requesterAgent && conn.state !== 'returning') {
        clearTimeout(conn.timeoutTimer);
        conn.state = 'returning';

        // Sound effect
        if (typeof this.playOrbArrive === 'function') this.playOrbArrive(responderAgent);

        // Auto-remove after the orbs travel back
        conn.timeoutTimer = setTimeout(() => this._fadeAndRemove(id), DOT_TRAVEL_SECS * 1000 + 500);
        return;
      }
    }
  },

  // ── SVG Creation ──────────────────────────────────────────────────────────

  _createConnectionSVG(conn) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-conn-id', conn.id);

    // Hidden reference path for getPointAtLength calculations
    const refPath = document.createElementNS(SVG_NS, 'path');
    refPath.classList.add('connection-ref-path');
    refPath.setAttribute('stroke', 'none');
    refPath.setAttribute('fill', 'none');
    refPath.setAttribute('opacity', '0');
    g.appendChild(refPath);

    // Create 3 circle layers per orb. Each orb uses its own per-orb color
    // (alternating from-color / to-color set in addConnection) so the
    // bidirectional flow is visually distinguishable.
    for (let i = 0; i < conn.orbs.length; i++) {
      const orb = conn.orbs[i];
      const orbColor = orb.color || conn.color;

      // Outer glow halo
      const glowEl = document.createElementNS(SVG_NS, 'circle');
      glowEl.classList.add('orb-glow');
      glowEl.setAttribute('r', String(12 * orb.size));
      glowEl.setAttribute('fill', orbColor);
      glowEl.setAttribute('fill-opacity', '0.08');
      glowEl.setAttribute('filter', 'url(#glow-filter)');
      g.appendChild(glowEl);
      orb.glowEl = glowEl;

      // Main body
      const mainEl = document.createElementNS(SVG_NS, 'circle');
      mainEl.classList.add('orb-main');
      mainEl.setAttribute('r', String(4.5 * orb.size));
      mainEl.setAttribute('fill', orbColor);
      mainEl.setAttribute('fill-opacity', String(orb.opacity));
      mainEl.setAttribute('filter', 'url(#glow-filter)');
      g.appendChild(mainEl);
      orb.mainEl = mainEl;

      // Diamond core
      const coreEl = document.createElementNS(SVG_NS, 'polygon');
      coreEl.classList.add('orb-core');
      const cs = 2.5 * orb.size;
      coreEl.setAttribute('points', '0,-' + cs + ' ' + cs + ',0 0,' + cs + ' -' + cs + ',0');
      coreEl.setAttribute('fill', '#ffffff');
      coreEl.setAttribute('fill-opacity', '0.85');
      g.appendChild(coreEl);
      orb.coreEl = coreEl;

      // Trail dots (fade behind the orb) — match the orb's color
      orb.trailEls = [];
      for (let t = 1; t <= 3; t++) {
        const trail = document.createElementNS(SVG_NS, 'circle');
        trail.classList.add('packet-trail');
        trail.setAttribute('r', String((3 - t * 0.5) * orb.size));
        trail.setAttribute('fill', orbColor);
        trail.setAttribute('fill-opacity', String(0.3 - t * 0.08));
        g.appendChild(trail);
        orb.trailEls.push(trail);
      }
    }

    // Label background rect
    const labelBg = document.createElementNS(SVG_NS, 'rect');
    labelBg.classList.add('connection-label-bg');
    g.appendChild(labelBg);

    // Label text
    const label = document.createElementNS(SVG_NS, 'text');
    label.classList.add('connection-label-text');
    label.textContent = conn.task ? truncate(conn.task, 40) : '';
    g.appendChild(label);

    return g;
  },

  // ── Position Calculation ──────────────────────────────────────────────────

  /**
   * Get the sprite area's bounding rect in SVG-local coordinates.
   * Falls back to panel rect if sprite area isn't found.
   *
   * Tries multiple element IDs in order:
   *   1. card-<agentId>            (dynamic-clone layout: card-horizon-orchestrator)
   *   2. panel-<shortId>           (legacy per-agent-panel layout: panel-orchestrator)
   *   3. card-<shortId>            (fallback for IDs without the horizon- prefix)
   *
   * The dynamic-clone layout is used after AgentPanel.initAgents() clones the
   * agent-card-template into .agent-grid for each agent returned by /api/agents.
   * Without the card-<agentId> lookup, _getPanelRect returns null and no
   * connection orbs are drawn between agents.
   */
  _getPanelRect(agentId) {
    const shortId = agentId.replace(/^[a-z]+-/, '').replace(/-media$/, '');
    const panelEl =
      document.getElementById('card-' + agentId) ||
      document.getElementById('panel-' + shortId) ||
      document.getElementById('card-' + shortId);
    if (!panelEl || panelEl.offsetWidth === 0) return null;

    // Target the sprite area — the pixel character box (or its container)
    const spriteArea =
      panelEl.querySelector('.agent-sprite-area') ||
      panelEl.querySelector('.agent-sprite-container');
    const target = spriteArea || panelEl;

    const r = target.getBoundingClientRect();
    const p = this._connPage.getBoundingClientRect();
    const x = r.left - p.left;
    const y = r.top - p.top;
    return { x, y, w: r.width, h: r.height, cx: x + r.width / 2, cy: y + r.height / 2 };
  },

  /**
   * Count how many active connections exist between the same pair (for curve offset).
   */
  _pairIndex(from, to, currentId) {
    let idx = 0;
    for (const [id, conn] of this.activeConnections) {
      if (id === currentId) return idx;
      if ((conn.from === from && conn.to === to) ||
          (conn.from === to && conn.to === from)) {
        idx++;
      }
    }
    return idx;
  },

  // ── Animation Loop ────────────────────────────────────────────────────────

  _startConnRAF() {
    if (this.connectionAnimFrame) return; // already running
    this._connLastFrame = performance.now();
    const tick = (now) => {
      if (this.activeConnections.size === 0) {
        this.connectionAnimFrame = null;
        return; // stop loop
      }
      const dt = (now - this._connLastFrame) / 1000; // delta in seconds
      this._connLastFrame = now;
      this._updateAllConnections(dt, now);
      this.connectionAnimFrame = requestAnimationFrame(tick);
    };
    this.connectionAnimFrame = requestAnimationFrame(tick);
  },

  _updateAllConnections(dt, now) {
    if (!this._connSvg || this.activePage !== 'dashboard') return;

    for (const [id, conn] of this.activeConnections) {
      const fromRect = this._getPanelRect(conn.from);
      const toRect = this._getPanelRect(conn.to);
      if (!fromRect || !toRect) continue;

      const g = conn.svgGroup;
      const refPath = g.querySelector('.connection-ref-path');
      const labelBg = g.querySelector('.connection-label-bg');
      const labelText = g.querySelector('.connection-label-text');

      // Bezier control point: perpendicular offset at midpoint
      const mx = (fromRect.cx + toRect.cx) / 2;
      const my = (fromRect.cy + toRect.cy) / 2;
      const dx = toRect.cx - fromRect.cx;
      const dy = toRect.cy - fromRect.cy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len; // perpendicular normal
      const ny = dx / len;
      const pairIdx = this._pairIndex(conn.from, conn.to, id);
      const offset = pairIdx * CURVE_OFFSET_PX;
      const cpx = mx + nx * offset;
      const cpy = my + ny * offset;

      // Update reference path
      const d = `M${fromRect.cx},${fromRect.cy} Q${cpx},${cpy} ${toRect.cx},${toRect.cy}`;
      refPath.setAttribute('d', d);

      const pathLen = refPath.getTotalLength ? refPath.getTotalLength() : len;

      // Label at curve midpoint (slightly offset above)
      const lx = (fromRect.cx + 2 * cpx + toRect.cx) / 4;
      const ly = (fromRect.cy + 2 * cpy + toRect.cy) / 4 - 10;
      labelText.setAttribute('x', lx);
      labelText.setAttribute('y', ly);

      // Label background (measure text)
      const bbox = labelText.getBBox ? labelText.getBBox() : { x: lx - 30, y: ly - 7, width: 60, height: 14 };
      labelBg.setAttribute('x', bbox.x - 4);
      labelBg.setAttribute('y', bbox.y - 2);
      labelBg.setAttribute('width', bbox.width + 8);
      labelBg.setAttribute('height', bbox.height + 4);

      // Update each orb
      for (let i = 0; i < conn.orbs.length; i++) {
        const orb = conn.orbs[i];

        // Update orb progress based on connection state
        if (conn.state === 'dispatching') {
          const p = orb.progress;
          const delta = (dt / DOT_TRAVEL_SECS) * orb.speed * (0.5 + 0.8 * Math.sin(p * Math.PI));
          orb.progress += delta;
          if (orb.progress > 1.0) orb.progress -= 1.0; // wrap for continuous flow
        } else if (conn.state === 'returning') {
          const p = orb.progress;
          const delta = (dt / DOT_TRAVEL_SECS) * orb.speed * (0.5 + 0.8 * Math.sin(p * Math.PI));
          orb.progress -= delta;
          if (orb.progress < 0.0) orb.progress += 1.0; // wrap for continuous flow
        } else if (conn.state === 'in_progress') {
          const freq = 0.8 + i * 0.3;
          orb.progress = 0.85 + 0.12 * Math.sin(now / 1000 * freq + orb.wobblePhase);
        }

        // Clamp for path sampling
        const clampedP = Math.max(0, Math.min(1, orb.progress));
        const pt = refPath.getPointAtLength(clampedP * pathLen);

        // Perpendicular normal at this point (sample nearby)
        const epsilon = 0.5;
        const ptAhead = refPath.getPointAtLength(Math.min(pathLen, clampedP * pathLen + epsilon));
        const tdx = ptAhead.x - pt.x;
        const tdy = ptAhead.y - pt.y;
        const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
        const perpX = -tdy / tlen;
        const perpY = tdx / tlen;

        // Sine wobble perpendicular to path
        const wobble = orb.wobbleAmp * Math.sin(now / 1000 * orb.wobbleFreq * Math.PI * 2 + orb.wobblePhase);
        const finalX = pt.x + perpX * wobble;
        const finalY = pt.y + perpY * wobble;

        // Pulsating opacity
        const pulse = 0.85 + 0.15 * Math.sin(now / 400 + orb.wobblePhase);
        const glowPulse = 0.06 + 0.06 * Math.sin(now / 600 + orb.wobblePhase);

        orb.glowEl.setAttribute('cx', finalX);
        orb.glowEl.setAttribute('cy', finalY);
        orb.glowEl.setAttribute('fill-opacity', String(glowPulse));

        orb.mainEl.setAttribute('cx', finalX);
        orb.mainEl.setAttribute('cy', finalY);
        orb.mainEl.setAttribute('fill-opacity', String(orb.opacity * pulse));

        orb.coreEl.setAttribute('transform', 'translate(' + finalX + ',' + finalY + ')');
        orb.coreEl.setAttribute('fill-opacity', String(0.7 + 0.3 * pulse));

        // Position trail dots behind the orb along the path
        if (orb.trailEls) {
          for (let t = 0; t < orb.trailEls.length; t++) {
            var trailP = Math.max(0, Math.min(1, clampedP - (t + 1) * 0.03));
            var trailPt = refPath.getPointAtLength(trailP * pathLen);
            orb.trailEls[t].setAttribute('cx', trailPt.x);
            orb.trailEls[t].setAttribute('cy', trailPt.y);
          }
        }
      }
    }
  },

  // ── Removal ───────────────────────────────────────────────────────────────

  _fadeAndRemove(connectionId) {
    const conn = this.activeConnections.get(connectionId);
    if (!conn) return;

    conn.svgGroup.style.opacity = '0';
    conn.svgGroup.style.transition = 'opacity 0.8s';

    setTimeout(() => this._removeConnection(connectionId), 900);
  },

  _removeConnection(connectionId) {
    const conn = this.activeConnections.get(connectionId);
    if (!conn) return;

    clearTimeout(conn.timeoutTimer);
    if (conn.svgGroup && conn.svgGroup.parentNode) {
      conn.svgGroup.parentNode.removeChild(conn.svgGroup);
    }
    this.activeConnections.delete(connectionId);

    // Update task chain
    this._updateTaskChain();
  },

  // ── Task Chain Bar ────────────────────────────────────────────────────────

  _updateTaskChain() {
    if (!this._chainBar) return;

    if (this.activeConnections.size === 0) {
      this._chainBar.style.display = 'none';
      return;
    }

    // Build directed graph: from -> to
    const edges = [];
    const incomingSet = new Set();
    let latestTask = '';

    for (const [, conn] of this.activeConnections) {
      if (conn.state !== 'returning') {
        edges.push({ from: conn.from, to: conn.to });
        incomingSet.add(conn.to);
        if (conn.task) latestTask = conn.task;
      }
    }

    if (edges.length === 0) {
      this._chainBar.style.display = 'none';
      return;
    }

    // Find root: agent that dispatches but isn't dispatched TO
    const fromSet = new Set(edges.map(e => e.from));
    let root = null;
    for (const from of fromSet) {
      if (!incomingSet.has(from)) { root = from; break; }
    }
    if (!root) root = edges[0].from; // fallback

    // Walk chain
    const chain = [root];
    const edgeMap = new Map();
    for (const e of edges) edgeMap.set(e.from, e.to);
    let current = root;
    const visited = new Set([current]);
    while (edgeMap.has(current)) {
      const next = edgeMap.get(current);
      if (visited.has(next)) break; // cycle guard
      visited.add(next);
      chain.push(next);
      current = next;
    }

    // Render chain breadcrumbs
    this._chainPath.innerHTML = '';
    chain.forEach((agentId, i) => {
      if (i > 0) {
        const arrow = document.createElement('span');
        arrow.className = 'task-chain-arrow';
        arrow.textContent = '\u2192'; // →
        this._chainPath.appendChild(arrow);
      }
      const node = document.createElement('span');
      node.className = 'task-chain-node';
      const meta = AGENTS[agentId];
      node.style.color = meta ? meta.color : '#6b7280';
      node.textContent = (meta ? meta.emoji + ' ' : '') + (meta ? meta.name : agentId);
      this._chainPath.appendChild(node);
    });

    // Show latest task text
    if (latestTask) {
      const taskEl = document.createElement('span');
      taskEl.className = 'task-chain-task';
      taskEl.textContent = latestTask;
      taskEl.title = latestTask;
      this._chainPath.appendChild(taskEl);
    }

    this._chainDepth.textContent = 'Depth: ' + chain.length;
    this._chainBar.style.display = 'flex';
  },

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroyConnections() {
    if (this.connectionAnimFrame) {
      cancelAnimationFrame(this.connectionAnimFrame);
      this.connectionAnimFrame = null;
    }
    for (const [id] of this.activeConnections) {
      this._removeConnection(id);
    }
    this.activeConnections.clear();
  },

});
