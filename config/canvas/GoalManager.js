'use strict';

// ---------------------------------------------------------------------------
// GoalManager.js — Collapsible goal tree sidebar for the tasks page
// Renders goal hierarchy with progress bars, task counts, and nested tasks.
// Extends MissionControl.prototype
// ---------------------------------------------------------------------------

Object.assign(MissionControl.prototype, {

  initGoalManager() {
    this._goals = [];
    this._goalCollapsed = {};  // goalId -> boolean

    // Cache DOM refs
    this.goalTree = document.getElementById('goal-tree');
    this.addGoalBtn = document.getElementById('add-goal-btn');

    if (this.addGoalBtn) {
      this.addGoalBtn.addEventListener('click', () => this._showGoalForm());
    }

    this._loadGoals();
  },

  async _loadGoals() {
    try {
      const res = await fetch(this.bridgeUrl + '/api/goals', {
        headers: { 'X-Auth-Token': this.bridgeToken || this.gatewayToken },
      });
      if (res.ok) {
        this._goals = await res.json();
        this._renderGoalTree();
      }
    } catch (e) {
      console.warn('[GoalManager] Failed to load goals:', e.message);
      this._renderGoalTree();
    }
  },

  _renderGoalTree() {
    if (!this.goalTree) return;
    this.goalTree.innerHTML = '';

    if (!this._goals || this._goals.length === 0) {
      this.goalTree.innerHTML =
        '<div class="goal-tree-placeholder">No goals yet. Click + to create one.</div>';
      return;
    }

    for (const goal of this._goals) {
      const node = this._createGoalNode(goal);
      this.goalTree.appendChild(node);
    }
  },

  _createGoalNode(goal) {
    const node = document.createElement('div');
    node.className = 'goal-node';
    node.dataset.goalId = goal.id;

    const isCollapsed = !!this._goalCollapsed[goal.id];
    const progress = goal.progress != null ? goal.progress : 0;
    const taskCounts = goal.task_counts || {};
    const doneCount = taskCounts.done || 0;
    const totalCount = taskCounts.total || 0;

    // Status classes
    const statusClass = goal.status === 'completed' ? 'goal-status-completed'
                      : goal.status === 'archived'  ? 'goal-status-archived'
                      : '';

    // Header row: toggle + title + badges
    const headerDiv = document.createElement('div');
    headerDiv.className = 'goal-node-header' + (statusClass ? ' ' + statusClass : '');

    const toggle = document.createElement('span');
    toggle.className = 'goal-toggle';
    toggle.textContent = isCollapsed ? '\u25B8' : '\u25BE';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this._goalCollapsed[goal.id] = !this._goalCollapsed[goal.id];
      this._renderGoalTree();
    });

    const titleSpan = document.createElement('span');
    titleSpan.className = 'goal-node-title';
    titleSpan.textContent = goal.title || 'Untitled goal';

    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'goal-task-badge';
    badgeSpan.textContent = doneCount + '/' + totalCount;

    // Context menu (edit / delete)
    const actionsSpan = document.createElement('span');
    actionsSpan.className = 'goal-node-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'goal-action-btn';
    editBtn.textContent = '\u270E';
    editBtn.title = 'Edit goal';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showGoalForm(goal);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'goal-action-btn goal-action-delete';
    deleteBtn.textContent = '\u2715';
    deleteBtn.title = 'Delete goal';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._deleteGoal(goal.id);
    });

    actionsSpan.appendChild(editBtn);
    actionsSpan.appendChild(deleteBtn);

    headerDiv.appendChild(toggle);
    headerDiv.appendChild(titleSpan);
    headerDiv.appendChild(badgeSpan);
    headerDiv.appendChild(actionsSpan);
    node.appendChild(headerDiv);

    // Progress bar
    const progressBar = document.createElement('div');
    progressBar.className = 'goal-progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'goal-progress-fill';
    progressFill.style.width = Math.min(100, Math.max(0, progress)) + '%';
    progressBar.appendChild(progressFill);
    node.appendChild(progressBar);

    // Child tasks (only if expanded)
    if (!isCollapsed) {
      const tasksForGoal = this._getTasksForGoal(goal.id);
      if (tasksForGoal.length > 0) {
        const taskList = document.createElement('div');
        taskList.className = 'goal-task-list';
        for (const task of tasksForGoal) {
          const taskNode = this._createTaskTreeNode(task, 0);
          taskList.appendChild(taskNode);
        }
        node.appendChild(taskList);
      }
    }

    return node;
  },

  _createTaskTreeNode(task, depth) {
    const node = document.createElement('div');
    node.className = 'task-tree-node';
    node.style.paddingLeft = (12 + depth * 16) + 'px';

    // Status dot
    const dot = document.createElement('span');
    dot.className = 'task-tree-dot';
    switch (task.status) {
      case 'in_progress': dot.classList.add('dot-amber');   break;
      case 'done':        dot.classList.add('dot-green');   break;
      case 'failed':      dot.classList.add('dot-red');     break;
      default:            dot.classList.add('dot-dim');     break;
    }

    // Title
    const title = document.createElement('span');
    title.className = 'task-tree-title';
    title.textContent = truncate(task.title || '', 30);

    // Assignee emoji
    const assignee = document.createElement('span');
    assignee.className = 'task-tree-assignee';
    if (task.assignee) {
      const agentCfg = typeof AGENTS !== 'undefined' ? AGENTS[task.assignee] : null;
      assignee.textContent = agentCfg ? agentCfg.emoji : '';
    }

    node.appendChild(dot);
    node.appendChild(title);
    node.appendChild(assignee);

    return node;
  },

  _showGoalForm(existingGoal) {
    // Remove any existing goal form overlay
    const existing = document.getElementById('goal-form-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'goal-form-overlay';
    overlay.className = 'goal-form-overlay';

    const isEdit = !!existingGoal;

    overlay.innerHTML =
      '<div class="goal-form-modal">' +
        '<h3 class="goal-form-heading">' + (isEdit ? 'Edit Goal' : 'New Goal') + '</h3>' +
        '<label class="goal-form-label">Title</label>' +
        '<input type="text" class="goal-form-input goal-title-input" placeholder="Goal title..." ' +
          'value="' + (isEdit ? escapeHtml(existingGoal.title || '') : '') + '" />' +
        '<label class="goal-form-label">Description</label>' +
        '<textarea class="goal-form-input goal-desc-input" placeholder="Optional description..." rows="3">' +
          (isEdit ? escapeHtml(existingGoal.description || '') : '') +
        '</textarea>' +
        '<div class="goal-form-actions">' +
          '<button class="btn-cancel">Cancel</button>' +
          '<button class="btn-save">' + (isEdit ? 'Update' : 'Create') + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // Show with flex display
    overlay.style.display = 'flex';

    const titleInput = overlay.querySelector('.goal-title-input');
    const descInput = overlay.querySelector('.goal-desc-input');
    titleInput.focus();

    // Cancel
    overlay.querySelector('.btn-cancel').addEventListener('click', () => {
      overlay.remove();
    });

    // Close on overlay click (outside modal)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Save
    overlay.querySelector('.btn-save').addEventListener('click', () => {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.style.borderColor = 'var(--color-error)';
        return;
      }
      const description = descInput.value.trim();

      if (isEdit) {
        this._updateGoal(existingGoal.id, title, description);
      } else {
        this._createGoal(title, description);
      }
      overlay.remove();
    });

    // Enter key on title input triggers save
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') overlay.querySelector('.btn-save').click();
      if (e.key === 'Escape') overlay.remove();
    });
  },

  async _createGoal(title, description) {
    try {
      const res = await fetch(this.bridgeUrl + '/api/goals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
        body: JSON.stringify({ title, description }),
      });
      if (res.ok) {
        // Play goal creation sound (ascending chime)
        if (typeof this.playGoalCreate === 'function') this.playGoalCreate();
        this._loadGoals();
      } else {
        console.warn('[GoalManager] Failed to create goal:', res.status);
      }
    } catch (e) {
      console.warn('[GoalManager] Failed to create goal:', e.message);
    }
  },

  async _updateGoal(goalId, title, description) {
    try {
      const res = await fetch(this.bridgeUrl + '/api/goals/' + goalId, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
        body: JSON.stringify({ title, description }),
      });
      if (res.ok) {
        this._loadGoals();
      } else {
        console.warn('[GoalManager] Failed to update goal:', res.status);
      }
    } catch (e) {
      console.warn('[GoalManager] Failed to update goal:', e.message);
    }
  },

  async _updateGoalStatus(goalId, status) {
    try {
      const res = await fetch(this.bridgeUrl + '/api/goals/' + goalId, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        if (status === 'complete' && typeof ThemeEngine !== 'undefined') {
          ThemeEngine.fireCinematic('milestone', { goalId: goalId });
        }
        this._loadGoals();
      } else {
        console.warn('[GoalManager] Failed to update goal status:', res.status);
      }
    } catch (e) {
      console.warn('[GoalManager] Failed to update goal status:', e.message);
    }
  },

  async _deleteGoal(goalId) {
    if (!confirm('Delete this goal? Tasks will be unlinked but not deleted.')) return;

    try {
      const res = await fetch(this.bridgeUrl + '/api/goals/' + goalId, {
        method: 'DELETE',
        headers: {
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
      });
      if (res.ok) {
        this._loadGoals();
      } else {
        console.warn('[GoalManager] Failed to delete goal:', res.status);
      }
    } catch (e) {
      console.warn('[GoalManager] Failed to delete goal:', e.message);
    }
  },

  _getTasksForGoal(goalId) {
    if (!this._tasks || !goalId) return [];
    return this._tasks.filter(t => t.goal_id === goalId);
  },

  // Optional sound: ascending 3-note chime for goal creation
  playGoalCreate() {
    if (!this._canPlaySound('goalcreate')) return;
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const master = this._createMasterGain(0.04);

      // 3-note ascending major chord: C5 -> E5 -> G5
      const notes = [523, 659, 784];
      notes.forEach((freq, i) => {
        const t = now + i * 0.09;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.2);
      });
    } catch (_) { /* Audio may not be available */ }
  },

});
