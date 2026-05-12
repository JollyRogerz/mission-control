'use strict';

// ---------------------------------------------------------------------------
// TaskBoardManager.js — Kanban task board with CRUD + structured dependencies
// Supports: todo, in_progress, done, failed columns + archive
// Extends MissionControl.prototype
// ---------------------------------------------------------------------------

function _dropParticleBurst(x, y) {
  const count = 8;
  for (let i = 0; i < count; i++) {
    const particle = document.createElement('div');
    const angle = (Math.PI * 2 * i) / count;
    const dist = 20 + Math.random() * 15;
    particle.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;width:3px;height:3px;border-radius:50%;background:var(--text-primary);z-index:9999;pointer-events:none;opacity:0.8;';
    document.body.appendChild(particle);
    if (typeof anime !== 'undefined') {
      anime({
        targets: particle,
        translateX: Math.cos(angle) * dist,
        translateY: Math.sin(angle) * dist,
        opacity: 0,
        scale: [1, 0],
        duration: 500,
        easing: 'easeOutCubic',
        complete: function() { particle.remove(); }
      });
    } else {
      setTimeout(function() { particle.remove(); }, 500);
    }
  }
}

Object.assign(MissionControl.prototype, {

  initTaskBoard() {
    this._tasks = [];
    this._taskFormVisible = false;

    // Cache elements
    this.kanbanBoard = document.getElementById('kanban-board');
    this.addTaskBtn = document.getElementById('add-task-btn');
    this.archiveBtn = document.getElementById('archive-btn');

    if (this.addTaskBtn) {
      this.addTaskBtn.addEventListener('click', () => this._showTaskForm());
    }

    if (this.archiveBtn) {
      this.archiveBtn.addEventListener('click', () => this._archiveTasks());
    }

    // Enable drag-and-drop between columns
    this._initKanbanDrag();

    // Load tasks from bridge API
    this._loadTasks();
  },

  async _loadTasks() {
    try {
      const res = await fetch(this.bridgeUrl + '/api/tasks', {
        headers: { 'X-Auth-Token': this.bridgeToken || this.gatewayToken },
      });
      if (res.ok) {
        this._tasks = await res.json();
        this._renderTasks();
      }
    } catch (e) {
      console.warn('[TaskBoard] Failed to load tasks:', e.message);
      this._renderTasks();
    }
  },

  /** Build a lookup: taskId -> task for dependency resolution */
  _taskById(taskId) {
    return this._tasks.find(t => t.id === taskId);
  },

  _renderTasks() {
    const columns = { todo: [], in_progress: [], done: [], failed: [] };
    for (const task of this._tasks) {
      const col = columns[task.status] || columns.todo;
      col.push(task);
    }

    for (const [status, tasks] of Object.entries(columns)) {
      const container = document.getElementById('cards-' + status);
      const countEl = document.getElementById('count-' + status);
      if (!container) continue;

      // Clear existing cards (keep form if present)
      const existing = container.querySelectorAll('.kanban-card');
      existing.forEach(c => c.remove());

      if (countEl) countEl.textContent = tasks.length;

      for (const task of tasks) {
        const card = this._createTaskCard(task);
        container.appendChild(card);
      }
    }

    // Show/hide archive button based on done+failed count
    if (this.archiveBtn) {
      const archivable = (columns.done.length + columns.failed.length);
      this.archiveBtn.style.display = archivable > 0 ? '' : 'none';
      this.archiveBtn.title = 'Archive ' + archivable + ' done/failed task' + (archivable !== 1 ? 's' : '');
    }
  },

  _createTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.classList.add('kanban-card-animated');
    card.dataset.taskId = task.id;

    const isBlocked = task.blocked && task.status !== 'done' && task.status !== 'failed';
    const isFailed = task.status === 'failed';

    // Only allow drag if not blocked and not failed
    card.draggable = !isBlocked && !isFailed;

    if (task.priority === 2) card.classList.add('kanban-card-priority-urgent');
    else if (task.priority === 1) card.classList.add('kanban-card-priority-high');

    if (isBlocked) card.classList.add('kanban-card-blocked');
    if (isFailed) card.classList.add('kanban-card-failed');

    // Assignee display
    let assigneeLabel = '';
    if (task.assignee) {
      const agentCfg = typeof AGENTS !== 'undefined' ? AGENTS[task.assignee] : null;
      assigneeLabel = agentCfg
        ? agentCfg.emoji + ' ' + agentCfg.name
        : task.assignee;
    }

    const created = new Date(task.created_at);
    const dateStr = created.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    // Build dependency badges
    let depBadgesHtml = '';
    const depsOn = task.depends_on || [];
    if (depsOn.length > 0) {
      depBadgesHtml = '<div class="kanban-card-deps">';
      for (const depId of depsOn) {
        const depTask = this._taskById(depId);
        const depTitle = depTask ? truncate(depTask.title, 20) : depId.slice(0, 8);
        const depDone = depTask && depTask.status === 'done';
        const badgeClass = depDone ? 'dep-badge done' : 'dep-badge pending';
        depBadgesHtml += '<span class="' + badgeClass + '">' + escapeHtml(depTitle) + '</span>';
      }
      depBadgesHtml += '</div>';
    }

    card.innerHTML =
      '<div class="kanban-card-title">' + escapeHtml(task.title) + '</div>' +
      depBadgesHtml +
      '<div class="kanban-card-meta">' +
        (assigneeLabel ? '<span class="kanban-card-assignee">' + assigneeLabel + '</span>' : '') +
        '<span>' + dateStr + '</span>' +
      '</div>' +
      '<button class="kanban-card-thread-btn" title="Open chat thread for this task">\uD83D\uDCAC</button>';

    // Wire thread button
    const threadBtn = card.querySelector('.kanban-card-thread-btn');
    if (threadBtn) {
      threadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof this.openTaskThread === 'function') {
          this.openTaskThread(task.id, task.title);
          if (typeof this.switchPage === 'function') this.switchPage('chat');
        }
      });
    }

    // Blocked tooltip
    if (isBlocked) {
      const blockerNames = depsOn
        .map(id => { const t = this._taskById(id); return t && t.status !== 'done' ? t.title : null; })
        .filter(Boolean);
      card.title = 'Blocked by: ' + blockerNames.join(', ');
    }

    // Drag events (only if not blocked and not failed)
    if (!isBlocked && !isFailed) {
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });
    }

    return card;
  },

  _initKanbanDrag() {
    if (!this.kanbanBoard) return;

    const columns = this.kanbanBoard.querySelectorAll('.kanban-cards');
    columns.forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.style.background = 'rgba(255,255,255,0.03)';
      });

      col.addEventListener('dragleave', () => {
        col.style.background = '';
      });

      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.style.background = '';
        const taskId = e.dataTransfer.getData('text/plain');
        const newStatus = col.closest('.kanban-column')?.dataset.status;
        if (taskId && newStatus) {
          this._updateTaskStatus(taskId, newStatus);
          _dropParticleBurst(e.clientX, e.clientY);
          // Pulse the destination column header
          var newCol = col.closest('.kanban-column');
          if (newCol) this._pulseColumnHeader(newCol);
        }
      });
    });
  },

  async _updateTaskStatus(taskId, newStatus) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return;

    // Block guard: prevent moving blocked tasks to in_progress
    if (newStatus === 'in_progress' && task.blocked) {
      const cardEl = this.kanbanBoard.querySelector('[data-task-id="' + taskId + '"]');
      if (cardEl) {
        cardEl.style.transition = 'box-shadow 0.2s';
        cardEl.style.boxShadow = '0 0 8px var(--color-error)';
        setTimeout(() => { cardEl.style.boxShadow = ''; }, 600);
      }
      return;
    }

    // FLIP: capture old card position before re-render
    var oldCard = this.kanbanBoard
      ? this.kanbanBoard.querySelector('[data-task-id="' + taskId + '"]')
      : null;
    var oldRect = oldCard ? oldCard.getBoundingClientRect() : null;

    task.status = newStatus;
    if (newStatus === 'done') task.completed_at = Date.now();
    task.updated_at = Date.now();
    this._renderTasks();

    // FLIP: animate from old position to new
    this._animateCardSlide(taskId, oldRect);

    try {
      await fetch(this.bridgeUrl + '/api/tasks/' + taskId, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (e) {
      console.warn('[TaskBoard] Failed to update task:', e.message);
    }
  },

  async _archiveTasks() {
    // Optimistic: remove done+failed from local array
    const before = this._tasks.length;
    this._tasks = this._tasks.filter(t => t.status !== 'done' && t.status !== 'failed');
    const archived = before - this._tasks.length;
    this._renderTasks();

    if (archived === 0) return;

    try {
      const res = await fetch(this.bridgeUrl + '/api/tasks/archive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
      });
      if (res.ok) {
        const data = await res.json();
        console.info('[TaskBoard] Archived ' + data.archived + ' tasks');
      }
    } catch (e) {
      console.warn('[TaskBoard] Failed to archive tasks:', e.message);
      // Reload to restore state
      this._loadTasks();
    }
  },

  _showTaskForm() {
    const todoCards = document.getElementById('cards-todo');
    if (!todoCards || this._taskFormVisible) return;
    this._taskFormVisible = true;

    // Build dependency checkboxes from existing non-done tasks
    const availableDeps = this._tasks.filter(t => t.status !== 'done' && t.status !== 'failed');
    let depsHtml = '';
    if (availableDeps.length > 0) {
      depsHtml =
        '<div class="task-deps-section">' +
          '<label class="task-deps-label">Depends on:</label>' +
          '<div class="task-deps-checkboxes">';
      for (const t of availableDeps) {
        const agentCfg = typeof AGENTS !== 'undefined' ? AGENTS[t.assignee] : null;
        const prefix = agentCfg ? agentCfg.emoji + ' ' : '';
        depsHtml +=
          '<label class="task-dep-option">' +
            '<input type="checkbox" value="' + t.id + '" />' +
            '<span>' + prefix + escapeHtml(truncate(t.title, 30)) + '</span>' +
          '</label>';
      }
      depsHtml += '</div></div>';
    }

    // Build assignee options dynamically from W2 agent cache
    const agentCache = (window._missionControl && window._missionControl._agents) || [];
    let assigneeOptions = '<option value="">Unassigned</option>';
    agentCache.forEach(function(agent) {
      assigneeOptions += '<option value="' + agent.id + '">' + (agent.emoji || '') + ' ' + (agent.display_name || agent.id) + '</option>';
    });

    const form = document.createElement('div');
    form.className = 'task-form';
    form.innerHTML =
      '<input type="text" placeholder="Task title..." class="task-title-input" />' +
      '<select class="task-assignee-input">' + assigneeOptions + '</select>' +
      // Goal selector
      (function(goals) {
        var html = '<select class="task-goal-input"><option value="">No goal</option>';
        for (var i = 0; i < goals.length; i++) {
          var g = goals[i];
          html += '<option value="' + g.id + '">' + escapeHtml((g.title || '').substring(0, 30)) + '</option>';
        }
        html += '</select>';
        return html;
      })(this._goals || []) +
      depsHtml +
      '<div class="task-form-actions">' +
        '<button class="btn-cancel">Cancel</button>' +
        '<button class="btn-save">Save</button>' +
      '</div>';

    todoCards.insertBefore(form, todoCards.firstChild);

    const titleInput = form.querySelector('.task-title-input');
    const assigneeInput = form.querySelector('.task-assignee-input');
    titleInput.focus();

    form.querySelector('.btn-cancel').addEventListener('click', () => {
      form.remove();
      this._taskFormVisible = false;
    });

    const goalInput = form.querySelector('.task-goal-input');

    form.querySelector('.btn-save').addEventListener('click', () => {
      const title = titleInput.value.trim();
      if (!title) return;

      const depCheckboxes = form.querySelectorAll('.task-deps-checkboxes input:checked');
      const dependsOn = Array.from(depCheckboxes).map(cb => cb.value);
      const goalId = goalInput ? goalInput.value : '';

      this._createTask(title, assigneeInput.value, dependsOn, goalId);
      form.remove();
      this._taskFormVisible = false;
    });

    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') form.querySelector('.btn-save').click();
      if (e.key === 'Escape') form.querySelector('.btn-cancel').click();
    });
  },

  async _createTask(title, assignee, dependsOn, goalId) {
    const task = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
      title,
      description: '',
      status: 'todo',
      assignee: assignee || '',
      priority: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
      completed_at: null,
      depends_on: dependsOn || [],
      blocked: (dependsOn && dependsOn.length > 0),
      goal_id: goalId || null,
    };

    this._tasks.push(task);
    this._renderTasks();

    try {
      await fetch(this.bridgeUrl + '/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
        body: JSON.stringify(task),
      });
    } catch (e) {
      console.warn('[TaskBoard] Failed to save task:', e.message);
    }
  },

  _pulseColumnHeader: function(columnEl) {
    if (!columnEl) return;
    var header = columnEl.querySelector('.kanban-column-header, .kanban-header, h3, h4');
    if (!header) return;
    header.classList.remove('pulse');
    void header.offsetWidth;
    header.classList.add('pulse');
    header.addEventListener('animationend', function() {
      header.classList.remove('pulse');
    }, { once: true });
  },

  _animateCardSlide: function(taskId, oldRect) {
    if (!oldRect || typeof anime === 'undefined') return;
    var newCard = this.kanbanBoard
      ? this.kanbanBoard.querySelector('[data-task-id="' + taskId + '"]')
      : null;
    if (!newCard) return;
    var newRect = newCard.getBoundingClientRect();
    var dx = oldRect.left - newRect.left;
    var dy = oldRect.top - newRect.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    anime({
      targets: newCard,
      translateX: [dx, 0],
      translateY: [dy, 0],
      opacity: [0.6, 1],
      duration: 400,
      easing: 'easeOutCubic',
      complete: function() {
        newCard.style.transform = '';
      }
    });
  },

  /** Called by EventHandler when a task_update event arrives via WebSocket */
  _handleTaskUnblocked(payload) {
    if (payload.action === 'unblocked' && payload.task_ids) {
      this._loadTasks();
    }
  },
});
