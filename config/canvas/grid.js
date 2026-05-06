'use strict';

// ---------------------------------------------------------------------------
// Mission Control — Bento-Box Panel Grid Manager
// ---------------------------------------------------------------------------
// Edge-to-edge magnetic snapping with collision detection.
// Panels tile like a Japanese bento box — no gaps, no overlaps.
// Each page has its own layout persisted to localStorage.
// ---------------------------------------------------------------------------

const SNAP_THRESHOLD = 12;  // px — magnetic snap distance
const BENTO_GAP = 2;        // px — thin gap between panels
const MIN_W = 200;
const MIN_H = 140;
const LAYOUT_VERSION = 'v4';

// Panels that can be relocated between pages on page switch
const SHARED_PANELS = {
  'panel-chat': ['dashboard', 'chat'],
  'panel-approvals': ['dashboard', 'approvals'],
};

// Default layouts per page (col%, row%, w%, h%)
const PAGE_LAYOUTS = {
  dashboard: {
    'panel-orchestrator': { x: 0,   y: 0,   w: 25,  h: 50 },
    'panel-builder':      { x: 25,  y: 0,   w: 25,  h: 50 },
    'panel-architect':    { x: 0,   y: 50,  w: 25,  h: 50 },
    'panel-social':       { x: 25,  y: 50,  w: 25,  h: 50 },
    'panel-feed':         { x: 50,  y: 0,   w: 50,  h: 50 },
    'panel-approvals':    { x: 50,  y: 50,  w: 25,  h: 50 },
    'panel-chat':         { x: 75,  y: 50,  w: 25,  h: 50 },
  },
  chat: {
    'panel-chat': { x: 0, y: 0, w: 100, h: 100 },
  },
  tasks: {
    'panel-tasks': { x: 0, y: 0, w: 100, h: 100 },
  },
  memory: {
    'panel-memory': { x: 0, y: 0, w: 100, h: 100 },
  },
  calendar: {
    'panel-calendar': { x: 0, y: 0, w: 100, h: 100 },
  },
  team: {
    'panel-team': { x: 0, y: 0, w: 100, h: 100 },
  },
  costs: {
    'panel-costs': { x: 0, y: 0, w: 55, h: 100 },
    'panel-activity-charts': { x: 55, y: 0, w: 45, h: 100 },
  },
  analytics: {
    'panel-analytics': { x: 0, y: 0, w: 100, h: 100 },
  },
  approvals: {
    'panel-approvals': { x: 0, y: 0, w: 100, h: 100 },
  },
};

class PanelManager {
  constructor() {
    this.pages = new Map();     // pageName -> Map(panelId -> {el, rect})
    this.activePage = null;
    this.dragging = null;
    this.resizing = null;
    this.topZ = 10;
    this.snapGuides = [];       // visible snap guide lines

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
  }

  init() {
    // Register panels for each page
    document.querySelectorAll('.page').forEach(page => {
      const pageName = page.id.replace('page-', '');
      const container = page.querySelector('.grid-container');
      if (!container) return;

      const panels = new Map();
      container.querySelectorAll('.panel').forEach(el => {
        panels.set(el.id, { el });
        this._setupPanel(el, container);
      });
      this.pages.set(pageName, { container, panels });
    });

    // Global listeners
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);

    // ResizeObserver on all containers
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => this._applyLayout());
      this.pages.forEach(({ container }) => ro.observe(container));
    }
    window.addEventListener('resize', () => this._applyLayout());

    // Relocate shared panels into the default page, then load it
    this._relocateSharedPanels('dashboard');
    this.switchPage('dashboard');

    // Fallback: if the container had zero dimensions on DOMContentLoaded
    // (browser hasn't painted yet), re-apply layout on the next frame.
    requestAnimationFrame(() => this._applyLayout());
  }

  switchPage(pageName) {
    this._relocateSharedPanels(pageName);
    this.activePage = pageName;
    this._loadLayout(pageName);
    this._applyLayout();
  }

  /**
   * Move shared panels to the target page's grid container.
   * Panels keep their event listeners — only the container ref is updated.
   */
  _relocateSharedPanels(targetPage) {
    const targetData = this.pages.get(targetPage);
    if (!targetData) return;

    for (const [panelId, pages] of Object.entries(SHARED_PANELS)) {
      if (!pages.includes(targetPage)) continue;

      const el = document.getElementById(panelId);
      if (!el) continue;

      // Move DOM element to target grid if not already there
      if (el.parentElement !== targetData.container) {
        targetData.container.appendChild(el);
        el._gridContainer = targetData.container;
      }

      // Register in target page's panel map if not present
      if (!targetData.panels.has(panelId)) {
        targetData.panels.set(panelId, { el });
        // Set up drag/resize if this panel hasn't been set up for this container
        if (!el._setupDone) {
          this._setupPanel(el, targetData.container);
          el._setupDone = true;
        }
      }
    }
  }

  _layoutKey(pageName) {
    return 'mc_layout_' + pageName + '_' + LAYOUT_VERSION;
  }

  _getActivePageData() {
    return this.pages.get(this.activePage);
  }

  _setupPanel(el, container) {
    // Store container ref on the element so it can be updated on relocation
    el._gridContainer = container;

    const header = el.querySelector('.panel-header');
    const resizeHandle = el.querySelector('.panel-resize');

    if (header) {
      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, input, select, .tab-btn')) return;
        e.preventDefault();
        this._bringToFront(el);
        const activeContainer = el._gridContainer;
        const cr = activeContainer.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        this.dragging = {
          el,
          container: activeContainer,
          id: el.id,
          startX: e.clientX,
          startY: e.clientY,
          origLeft: er.left - cr.left,
          origTop: er.top - cr.top,
        };
        el.classList.add('dragging');
      });
    }

    if (resizeHandle) {
      resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._bringToFront(el);
        const activeContainer = el._gridContainer;
        const cr = activeContainer.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        this.resizing = {
          el,
          container: activeContainer,
          id: el.id,
          startX: e.clientX,
          startY: e.clientY,
          origW: er.width,
          origH: er.height,
          origLeft: er.left - cr.left,
          origTop: er.top - cr.top,
        };
        el.classList.add('resizing');
      });
    }

    el.addEventListener('mousedown', () => this._bringToFront(el));
  }

  _bringToFront(el) {
    this.topZ++;
    el.style.zIndex = this.topZ;
  }

  // Collect edges of all OTHER panels in the same container
  _getSnapEdges(container, excludeId) {
    const pageData = this._getActivePageData();
    if (!pageData) return { horizontal: [], vertical: [] };

    const cr = container.getBoundingClientRect();
    const horizontal = [0, cr.height]; // container top + bottom
    const vertical = [0, cr.width];    // container left + right

    pageData.panels.forEach((data, id) => {
      if (id === excludeId) return;
      const el = data.el;
      const left = parseFloat(el.style.left) || 0;
      const top = parseFloat(el.style.top) || 0;
      const w = el.offsetWidth;
      const h = el.offsetHeight;

      vertical.push(left, left + w);          // left edge, right edge
      horizontal.push(top, top + h);          // top edge, bottom edge
    });

    return { horizontal, vertical };
  }

  _snapValue(value, targets) {
    let closest = value;
    let minDist = SNAP_THRESHOLD + 1;
    for (const target of targets) {
      // Snap with gap
      const gapTargets = [target, target + BENTO_GAP, target - BENTO_GAP];
      for (const gt of gapTargets) {
        const dist = Math.abs(value - gt);
        if (dist < minDist) {
          minDist = dist;
          closest = gt;
        }
      }
    }
    return minDist <= SNAP_THRESHOLD ? closest : value;
  }

  _onMouseMove(e) {
    if (this.dragging) {
      const d = this.dragging;
      const cr = d.container.getBoundingClientRect();
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      let newLeft = d.origLeft + dx;
      let newTop = d.origTop + dy;

      // Clamp
      const maxLeft = cr.width - d.el.offsetWidth;
      const maxTop = cr.height - d.el.offsetHeight;
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      // Bento snap
      const edges = this._getSnapEdges(d.container, d.id);
      const w = d.el.offsetWidth;
      const h = d.el.offsetHeight;

      // Snap left edge and right edge
      const snappedLeft = this._snapValue(newLeft, edges.vertical);
      const snappedRight = this._snapValue(newLeft + w, edges.vertical);
      if (snappedLeft !== newLeft) {
        newLeft = snappedLeft;
      } else if (snappedRight !== newLeft + w) {
        newLeft = snappedRight - w;
      }

      // Snap top edge and bottom edge
      const snappedTop = this._snapValue(newTop, edges.horizontal);
      const snappedBottom = this._snapValue(newTop + h, edges.horizontal);
      if (snappedTop !== newTop) {
        newTop = snappedTop;
      } else if (snappedBottom !== newTop + h) {
        newTop = snappedBottom - h;
      }

      // Re-clamp after snap
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      d.el.style.left = newLeft + 'px';
      d.el.style.top = newTop + 'px';
    }

    if (this.resizing) {
      const r = this.resizing;
      const cr = r.container.getBoundingClientRect();
      const dx = e.clientX - r.startX;
      const dy = e.clientY - r.startY;
      let newW = r.origW + dx;
      let newH = r.origH + dy;

      // Clamp
      newW = Math.max(MIN_W, Math.min(newW, cr.width - r.origLeft));
      newH = Math.max(MIN_H, Math.min(newH, cr.height - r.origTop));

      // Bento snap right edge and bottom edge
      const edges = this._getSnapEdges(r.container, r.id);
      const snappedRight = this._snapValue(r.origLeft + newW, edges.vertical);
      if (snappedRight !== r.origLeft + newW) {
        newW = snappedRight - r.origLeft;
      }
      const snappedBottom = this._snapValue(r.origTop + newH, edges.horizontal);
      if (snappedBottom !== r.origTop + newH) {
        newH = snappedBottom - r.origTop;
      }

      // Re-clamp
      newW = Math.max(MIN_W, Math.min(newW, cr.width - r.origLeft));
      newH = Math.max(MIN_H, Math.min(newH, cr.height - r.origTop));

      r.el.style.width = newW + 'px';
      r.el.style.height = newH + 'px';
    }
  }

  _onMouseUp() {
    if (this.dragging) {
      this.dragging.el.classList.remove('dragging');
      this.dragging = null;
      this._saveLayout();
    }
    if (this.resizing) {
      this.resizing.el.classList.remove('resizing');
      this.resizing = null;
      this._saveLayout();
    }
  }

  _saveLayout() {
    if (!this.activePage) return;
    const pageData = this._getActivePageData();
    if (!pageData) return;
    const cr = pageData.container.getBoundingClientRect();
    if (cr.width === 0 || cr.height === 0) return;

    const layout = {};
    pageData.panels.forEach((data, id) => {
      const el = data.el;
      layout[id] = {
        x: (parseFloat(el.style.left) / cr.width) * 100,
        y: (parseFloat(el.style.top) / cr.height) * 100,
        w: (el.offsetWidth / cr.width) * 100,
        h: (el.offsetHeight / cr.height) * 100,
      };
    });

    try {
      localStorage.setItem(this._layoutKey(this.activePage), JSON.stringify(layout));
    } catch (_) { /* quota */ }
  }

  _loadLayout(pageName) {
    const pageData = this.pages.get(pageName);
    if (!pageData) return;

    let layout = null;
    try {
      const raw = localStorage.getItem(this._layoutKey(pageName));
      if (raw) layout = JSON.parse(raw);
    } catch (_) { /* corrupt */ }

    if (!layout) {
      layout = PAGE_LAYOUTS[pageName] || {};
    }

    // Validate — fill missing panels and reject degenerate saved layouts
    pageData.panels.forEach((_, id) => {
      const pos = layout[id];
      if (!pos || pos.w < 5 || pos.h < 5 || pos.x + pos.w > 105 || pos.y + pos.h > 105) {
        const defaults = PAGE_LAYOUTS[pageName];
        layout[id] = (defaults && defaults[id]) || { x: 0, y: 0, w: 50, h: 50 };
      }
    });

    this._currentLayout = layout;
  }

  _applyLayout() {
    if (!this._currentLayout || !this.activePage) return;
    const pageData = this._getActivePageData();
    if (!pageData) return;
    const cr = pageData.container.getBoundingClientRect();
    if (cr.width === 0 || cr.height === 0) return;

    pageData.panels.forEach((data, id) => {
      const pos = this._currentLayout[id];
      if (!pos) return;
      const el = data.el;
      el.style.position = 'absolute';
      el.style.left = (pos.x / 100 * cr.width) + 'px';
      el.style.top = (pos.y / 100 * cr.height) + 'px';
      el.style.width = (pos.w / 100 * cr.width) + 'px';
      el.style.height = (pos.h / 100 * cr.height) + 'px';
    });
  }

  // Auto-arrange: tile panels in row-major bento layout
  autoArrange() {
    const pageData = this._getActivePageData();
    if (!pageData) return;
    const cr = pageData.container.getBoundingClientRect();
    const count = pageData.panels.size;
    if (count === 0) return;

    // Calculate grid dimensions
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const cellW = cr.width / cols;
    const cellH = cr.height / rows;

    let i = 0;
    pageData.panels.forEach((data) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const el = data.el;
      // Last row may have fewer panels — stretch to fill
      const isLastRow = row === rows - 1;
      const panelsInRow = isLastRow ? count - row * cols : cols;
      const w = isLastRow ? cr.width / panelsInRow : cellW;

      el.style.left = (isLastRow ? (i - row * cols) * w : col * cellW) + 'px';
      el.style.top = (row * cellH) + 'px';
      el.style.width = w + 'px';
      el.style.height = cellH + 'px';
      i++;
    });

    this._saveLayout();
  }

  resetLayout() {
    if (!this.activePage) return;
    localStorage.removeItem(this._layoutKey(this.activePage));
    this._currentLayout = { ...(PAGE_LAYOUTS[this.activePage] || {}) };
    this._applyLayout();
  }
}

// Initialize after DOM loads — exported globally for terminal.js to use
document.addEventListener('DOMContentLoaded', () => {
  const pm = new PanelManager();
  pm.init();
  window.__panelManager = pm;
});
