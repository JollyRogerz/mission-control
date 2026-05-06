'use strict';
// ADAPT-09 audit (Phase 2): no body-sending fetch() POSTs in this file as of 2026-05-04; CI guard `tests/guard_content_type.sh` prevents future regressions.

// ---------------------------------------------------------------------------
// MemoryManager.js — Agent memory viewer with file tree and search
// Extends MissionControl.prototype
// ---------------------------------------------------------------------------

Object.assign(MissionControl.prototype, {

  initMemoryViewer() {
    this.memoryTree = document.getElementById('memory-tree');
    this.memoryViewerEl = document.getElementById('memory-viewer');
    this.memorySearchInput = document.getElementById('memory-search');
    this._memoryFiles = [];
    this._activeMemoryFile = null;

    if (this.memorySearchInput) {
      this.memorySearchInput.addEventListener('input', () => {
        this._filterMemoryTree(this.memorySearchInput.value);
      });
    }

    this._loadMemoryTree();
  },

  async _loadMemoryTree() {
    if (!this.memoryTree) return;

    try {
      const res = await fetch(this.bridgeUrl + '/api/memories', {
        headers: { 'X-Auth-Token': this.bridgeToken || this.gatewayToken },
      });
      if (res.ok) {
        this._memoryFiles = await res.json();
        this._renderMemoryTree();
      } else {
        this.memoryTree.innerHTML = '<div class="memory-tree-placeholder">Failed to load memories (API not available yet)</div>';
      }
    } catch (e) {
      this.memoryTree.innerHTML = '<div class="memory-tree-placeholder">Bridge API not available. Start bridge server first.</div>';
    }
  },

  _renderMemoryTree(filter) {
    if (!this.memoryTree) return;
    this.memoryTree.innerHTML = '';

    // Group files by agent
    const groups = {};
    for (const file of this._memoryFiles) {
      if (!groups[file.agent_id]) groups[file.agent_id] = [];

      // Apply search filter
      if (filter) {
        const q = filter.toLowerCase();
        if (!file.name.toLowerCase().includes(q) && !file.path.toLowerCase().includes(q)) continue;
      }

      groups[file.agent_id].push(file);
    }

    for (const agentId of Object.keys(groups).sort()) {
      const files = groups[agentId];
      if (files.length === 0) continue;

      const agentCfg = AGENTS[agentId] || { emoji: '?', name: agentId, color: '#888' };

      const group = document.createElement('div');
      group.className = 'memory-agent-group';

      const header = document.createElement('div');
      header.className = 'memory-agent-header';
      header.innerHTML =
        '<span class="caret">&#9660;</span> ' +
        agentCfg.emoji + ' ' +
        '<span style="color:' + agentCfg.color + '">' + escapeHtml(agentCfg.name) + '</span>' +
        ' <span style="color:var(--text-dim)">(' + files.length + ')</span>';

      header.addEventListener('click', () => {
        header.classList.toggle('collapsed');
      });

      const list = document.createElement('div');
      list.className = 'memory-file-list';

      for (const file of files) {
        const item = document.createElement('div');
        item.className = 'memory-file';
        item.textContent = file.name;
        item.title = file.path;
        item.addEventListener('click', () => {
          // Deselect previous
          this.memoryTree.querySelectorAll('.memory-file.active').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          this._loadMemoryFile(file);
        });
        list.appendChild(item);
      }

      group.appendChild(header);
      group.appendChild(list);
      this.memoryTree.appendChild(group);
    }

    if (this.memoryTree.children.length === 0) {
      this.memoryTree.innerHTML = '<div class="memory-tree-placeholder">No memories found</div>';
    }

    // Items are visible immediately — no animation that risks leaving opacity:0
  },

  _filterMemoryTree(query) {
    this._renderMemoryTree(query);
  },

  async _loadMemoryFile(file) {
    if (!this.memoryViewerEl) return;
    this._activeMemoryFile = file;

    this._showMemorySkeleton(this.memoryViewerEl);

    try {
      const res = await fetch(
        this.bridgeUrl + '/api/memories/' + encodeURIComponent(file.agent_id) + '/' + encodeURIComponent(file.path),
        { headers: { 'X-Auth-Token': this.bridgeToken || this.gatewayToken } }
      );
      if (res.ok) {
        const data = await res.json();
        this._hideMemorySkeleton();
        this._renderMemoryContent(data.content, file.name);
      } else {
        this._hideMemorySkeleton();
        this.memoryViewerEl.innerHTML = '<div class="memory-viewer-placeholder">Failed to load file</div>';
      }
    } catch (e) {
      this._hideMemorySkeleton();
      this.memoryViewerEl.innerHTML = '<div class="memory-viewer-placeholder">Error: ' + escapeHtml(e.message) + '</div>';
    }
  },

  _renderMemoryContent(markdown, title) {
    if (!this.memoryViewerEl) return;

    // Simple markdown → HTML renderer
    let html = escapeHtml(markdown);

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold, italic, code
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Code blocks
    html = html.replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // Tables (simple)
    html = html.replace(/^\|(.+)\|$/gm, (match, content) => {
      const cells = content.split('|').map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return ''; // separator row
      const tag = cells.some(c => c.startsWith('**')) ? 'th' : 'td';
      return '<tr>' + cells.map(c => '<' + tag + '>' + c.replace(/\*\*/g, '') + '</' + tag + '>').join('') + '</tr>';
    });
    html = html.replace(/(<tr>[\s\S]*?<\/tr>)/g, '<table>$1</table>');

    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs around block elements
    html = html.replace(/<p>\s*(<h[1-3]>)/g, '$1');
    html = html.replace(/(<\/h[1-3]>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<table>)/g, '$1');
    html = html.replace(/(<\/table>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<blockquote>)/g, '$1');
    html = html.replace(/(<\/blockquote>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*<\/p>/g, '');

    this.memoryViewerEl.innerHTML = '<div class="memory-content">' + html + '</div>';
  },

  _showMemorySkeleton(container) {
    if (!container) return;
    var skeleton = document.createElement('div');
    skeleton.className = 'skeleton-loader';
    skeleton.id = 'memory-skeleton';
    for (var i = 0; i < 5; i++) {
      var line = document.createElement('div');
      line.className = 'skeleton-line';
      skeleton.appendChild(line);
    }
    container.innerHTML = '';
    container.appendChild(skeleton);
  },

  _hideMemorySkeleton() {
    var el = document.getElementById('memory-skeleton');
    if (el) el.remove();
  },
});
