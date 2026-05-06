'use strict';

// ---------------------------------------------------------------------------
// ApprovalPanel.js — Social post approval queue with approve/reject actions
// Extends MissionControl.prototype (must be loaded after terminal.js)
// ---------------------------------------------------------------------------

// ---- CSS --------------------------------------------------------------------

const APPROVAL_PANEL_CSS = `
/* -- Approval Panel -------------------------------------------------------- */

#panel-approvals .panel-content {
  overflow-y: auto;
  padding: 0;
}

.approval-panel-inner {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
  height: 100%;
  font-family: inherit;
  color: var(--text-primary, #c8d6e5);
}

/* -- Header bar ------------------------------------------------------------ */

.approval-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
}

.approval-header-title {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-secondary, #6b7b8d);
}

.approval-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
  background: var(--accent, #f59e0b);
  color: #000;
  font-variant-numeric: tabular-nums;
}

.approval-badge.empty {
  background: rgba(255,255,255,0.06);
  color: var(--text-secondary, #6b7b8d);
}

/* -- Cards ----------------------------------------------------------------- */

.approval-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.approval-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--border, rgba(255,255,255,0.06));
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.approval-card.removing {
  opacity: 0;
  transform: translateX(20px);
}

.approval-card.removing-fade {
  opacity: 0;
  transform: scale(0.95);
}

/* -- Card header ----------------------------------------------------------- */

.approval-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.approval-type-badge {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(139,92,246,0.15);
  color: #a78bfa;
  white-space: nowrap;
}

.approval-type-badge.type-image { background: rgba(59,130,246,0.15); color: #60a5fa; }
.approval-type-badge.type-reply { background: rgba(16,185,129,0.15); color: #34d399; }
.approval-type-badge.type-search { background: rgba(245,158,11,0.15); color: #fbbf24; }
.approval-type-badge.type-retry { background: rgba(239,68,68,0.15); color: #f87171; }

.approval-time {
  font-size: 9px;
  color: var(--text-secondary, #6b7b8d);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* -- Card body ------------------------------------------------------------- */

.approval-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary, #c8d6e5);
  max-height: 4.5em;
  overflow: hidden;
  position: relative;
  word-break: break-word;
}

.approval-text.expanded {
  max-height: none;
}

.approval-text-toggle {
  font-size: 10px;
  color: var(--accent, #f59e0b);
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  font-family: inherit;
}

.approval-text-toggle:hover {
  text-decoration: underline;
}

.approval-thumbnail {
  max-height: 120px;
  max-width: 100%;
  border-radius: 4px;
  object-fit: cover;
  border: 1px solid var(--border, rgba(255,255,255,0.06));
}

/* -- Platform & channel indicators ----------------------------------------- */

.approval-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.approval-platform {
  font-size: 10px;
  color: var(--text-secondary, #6b7b8d);
  display: flex;
  align-items: center;
  gap: 3px;
}

.approval-channel {
  font-size: 10px;
  color: var(--text-secondary, #6b7b8d);
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border, rgba(255,255,255,0.04));
}

/* -- Action buttons -------------------------------------------------------- */

.approval-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.approval-btn {
  font-size: 10px;
  font-weight: 600;
  font-family: inherit;
  padding: 5px 14px;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s, opacity 0.2s;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.approval-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.approval-btn-approve {
  background: rgba(34,197,94,0.15);
  color: #4ade80;
  border-color: rgba(34,197,94,0.25);
}

.approval-btn-approve:hover:not(:disabled) {
  background: rgba(34,197,94,0.25);
  border-color: rgba(34,197,94,0.4);
}

.approval-btn-reject {
  background: rgba(239,68,68,0.1);
  color: #f87171;
  border-color: rgba(239,68,68,0.15);
}

.approval-btn-reject:hover:not(:disabled) {
  background: rgba(239,68,68,0.2);
  border-color: rgba(239,68,68,0.3);
}

/* -- Empty state ----------------------------------------------------------- */

.approval-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 30px 10px;
  color: var(--text-secondary, #6b7b8d);
}

.approval-empty-icon {
  font-size: 28px;
  opacity: 0.4;
}

.approval-empty-text {
  font-size: 12px;
}

/* -- Publishing state ------------------------------------------------------ */

.approval-publishing {
  font-size: 10px;
  color: var(--accent, #f59e0b);
  font-weight: 600;
  letter-spacing: 0.3px;
}

/* -- Reduced motion -------------------------------------------------------- */

@media (prefers-reduced-motion: reduce) {
  .approval-card,
  .approval-card.removing,
  .approval-card.removing-fade {
    transition: none;
  }
}
`;

// ---- Inject CSS on load -----------------------------------------------------

(function() {
  const style = document.createElement('style');
  style.textContent = APPROVAL_PANEL_CSS;
  document.head.appendChild(style);
})();

// ---- Time formatting helper -------------------------------------------------

function _approvalTimeAgo(isoStr) {
  if (!isoStr) return '';
  const now = Date.now();
  const then = new Date(isoStr).getTime();
  const diff = Math.max(0, now - then);
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return secs + 's ago';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}

// ---- Type badge helper ------------------------------------------------------

function _approvalTypeBadge(type) {
  const typeMap = {
    'image': { label: 'Image Post', cls: 'type-image' },
    'reply': { label: 'Reply', cls: 'type-reply' },
    'search': { label: 'Search Engagement', cls: 'type-search' },
    'twitter-retry': { label: 'Twitter Retry', cls: 'type-retry' },
  };
  const info = typeMap[(type || '').toLowerCase()] || { label: type || 'Post', cls: '' };
  return '<span class="approval-type-badge ' + info.cls + '">' + info.label + '</span>';
}

// ---- Platform indicator helper ----------------------------------------------

function _approvalPlatformIcons(platform) {
  const p = (platform || '').toLowerCase();
  const icons = [];
  if (!p || p === 'both') {
    icons.push('<span class="approval-platform" title="Twitter">&#120143; Twitter</span>');
    icons.push('<span class="approval-platform" title="Farcaster">&#9826; Farcaster</span>');
  } else if (p === 'twitter') {
    icons.push('<span class="approval-platform" title="Twitter">&#120143; Twitter</span>');
  } else if (p === 'farcaster') {
    icons.push('<span class="approval-platform" title="Farcaster">&#9826; Farcaster</span>');
  } else {
    icons.push('<span class="approval-platform">' + platform + '</span>');
  }
  return icons.join(' ');
}

// ---- Prototype extension ----------------------------------------------------

Object.assign(MissionControl.prototype, {

  // -- Initialization -------------------------------------------------------

  initApprovalPanel() {
    this._approvalData = [];
    this._approvalRefreshTimer = null;
    this._approvalPublishing = new Set(); // IDs currently being published

    // Initial fetch + start polling
    this._fetchApprovals();
    this._approvalRefreshTimer = setInterval(() => this._fetchApprovals(), 30000);
  },

  // -- Fetch pending approvals from bridge API ------------------------------

  async _fetchApprovals() {
    try {
      const res = await fetch(this.bridgeUrl + '/api/approvals', {
        headers: { 'X-Auth-Token': this.bridgeToken || this.gatewayToken },
      });
      if (!res.ok) return;
      const data = await res.json();

      // Detect new approvals for sound notification
      const oldIds = new Set(this._approvalData.map(a => a.id));
      const newItems = data.filter(a => !oldIds.has(a.id));

      this._approvalData = data;
      this.renderApprovalPanel();

      // Play sound for new items
      if (newItems.length > 0 && this._approvalData.length > 0 && typeof this.playSound === 'function') {
        try { this.playSound('notification'); } catch (_) {}
      }
    } catch (e) {
      console.warn('[ApprovalPanel] Fetch failed:', e.message);
    }
  },

  // -- Approve action -------------------------------------------------------

  async _approvePost(id) {
    this._approvalPublishing.add(id);
    this.renderApprovalPanel();

    try {
      const res = await fetch(this.bridgeUrl + '/api/approvals/' + encodeURIComponent(id) + '/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
      });
      if (!res.ok) {
        console.error('[ApprovalPanel] Approve failed:', res.status);
        this._approvalPublishing.delete(id);
        this.renderApprovalPanel();
        return;
      }

      // Remove from local data with slide animation
      this._approvalPublishing.delete(id);
      const card = document.querySelector('[data-approval-id="' + id + '"]');
      if (card) {
        card.classList.add('removing');
        setTimeout(() => {
          this._approvalData = this._approvalData.filter(a => a.id !== id);
          this.renderApprovalPanel();
        }, 300);
      } else {
        this._approvalData = this._approvalData.filter(a => a.id !== id);
        this.renderApprovalPanel();
      }
    } catch (e) {
      console.error('[ApprovalPanel] Approve error:', e);
      this._approvalPublishing.delete(id);
      this.renderApprovalPanel();
    }
  },

  // -- Reject action --------------------------------------------------------

  async _rejectPost(id) {
    try {
      const res = await fetch(this.bridgeUrl + '/api/approvals/' + encodeURIComponent(id) + '/reject', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
      });
      if (!res.ok) {
        console.error('[ApprovalPanel] Reject failed:', res.status);
        return;
      }

      // Remove with fade animation
      const card = document.querySelector('[data-approval-id="' + id + '"]');
      if (card) {
        card.classList.add('removing-fade');
        setTimeout(() => {
          this._approvalData = this._approvalData.filter(a => a.id !== id);
          this.renderApprovalPanel();
        }, 300);
      } else {
        this._approvalData = this._approvalData.filter(a => a.id !== id);
        this.renderApprovalPanel();
      }
    } catch (e) {
      console.error('[ApprovalPanel] Reject error:', e);
    }
  },

  // -- Render ---------------------------------------------------------------

  renderApprovalPanel() {
    const container = document.getElementById('approval-panel-content');
    if (!container) return;

    const data = this._approvalData || [];
    const pendingCount = data.length;

    // Build badge
    const badgeHtml = pendingCount > 0
      ? '<span class="approval-badge">' + pendingCount + ' pending</span>'
      : '<span class="approval-badge empty">0</span>';

    // Build cards or empty state
    let cardsHtml = '';
    if (pendingCount === 0) {
      cardsHtml = `
        <div class="approval-empty">
          <div class="approval-empty-icon">&#10003;</div>
          <div class="approval-empty-text">No pending approvals</div>
        </div>`;
    } else {
      for (const item of data) {
        const isPublishing = this._approvalPublishing && this._approvalPublishing.has(item.id);
        const textEscaped = (item.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const needsExpand = (item.text || '').length > 200;

        let thumbnailHtml = '';
        if (item.image_url) {
          thumbnailHtml = '<img class="approval-thumbnail" src="' +
            item.image_url.replace(/"/g, '&quot;') +
            '" alt="preview" loading="lazy" onerror="this.style.display=\'none\'" />';
        }

        let channelHtml = '';
        if (item.channel) {
          channelHtml = '<span class="approval-channel">/' + (item.channel || '').replace(/</g, '&lt;') + '</span>';
        }

        const actionsHtml = isPublishing
          ? '<span class="approval-publishing">Publishing...</span>'
          : '<button class="approval-btn approval-btn-approve" data-action="approve" data-id="' + item.id + '">Approve</button>' +
            '<button class="approval-btn approval-btn-reject" data-action="reject" data-id="' + item.id + '">Reject</button>';

        cardsHtml += `
          <div class="approval-card" data-approval-id="${item.id}">
            <div class="approval-card-header">
              ${_approvalTypeBadge(item.type)}
              <span class="approval-time">${_approvalTimeAgo(item.created_at)}</span>
            </div>
            <div class="approval-text${needsExpand ? '' : ' expanded'}">${textEscaped}</div>
            ${needsExpand ? '<button class="approval-text-toggle" data-toggle-text="' + item.id + '">show more</button>' : ''}
            ${thumbnailHtml}
            <div class="approval-meta">
              ${_approvalPlatformIcons(item.platform)}
              ${channelHtml}
            </div>
            <div class="approval-actions">
              ${actionsHtml}
            </div>
          </div>`;
      }
    }

    container.innerHTML = `
      <div class="approval-panel-inner">
        <div class="approval-header">
          <span class="approval-header-title">Pending Approvals</span>
          ${badgeHtml}
        </div>
        <div class="approval-cards">
          ${cardsHtml}
        </div>
      </div>`;

    // Bind action buttons
    container.querySelectorAll('[data-action="approve"]').forEach(btn => {
      btn.onclick = () => this._approvePost(btn.dataset.id);
    });
    container.querySelectorAll('[data-action="reject"]').forEach(btn => {
      btn.onclick = () => this._rejectPost(btn.dataset.id);
    });

    // Bind text expand toggles
    container.querySelectorAll('[data-toggle-text]').forEach(btn => {
      btn.onclick = () => {
        const card = btn.closest('.approval-card');
        if (!card) return;
        const textEl = card.querySelector('.approval-text');
        if (textEl) {
          textEl.classList.toggle('expanded');
          btn.textContent = textEl.classList.contains('expanded') ? 'show less' : 'show more';
        }
      };
    });
  },

  // -- Cleanup --------------------------------------------------------------

  destroyApprovalPanel() {
    if (this._approvalRefreshTimer) {
      clearInterval(this._approvalRefreshTimer);
      this._approvalRefreshTimer = null;
    }
  },
});
