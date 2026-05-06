'use strict';

// ---------------------------------------------------------------------------
// CalendarManager.js — Scheduled tasks timeline view with full CRUD
// Extends MissionControl.prototype
// ---------------------------------------------------------------------------

Object.assign(MissionControl.prototype, {

  initCalendar() {
    this.calendarTimeline = document.getElementById('calendar-timeline');
    this.calendarDateEl = document.getElementById('calendar-date');
    this._calendarJobs = [];

    // Show today's date
    if (this.calendarDateEl) {
      this.calendarDateEl.textContent = 'Today: ' + new Date().toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
      });
    }

    // Wire up "New Job" button
    const addJobBtn = document.getElementById('add-job-btn');
    if (addJobBtn) {
      addJobBtn.addEventListener('click', () => this._showJobForm());
    }

    this._loadCalendar();

    // Refresh every 60 seconds
    this._calendarRefresh = setInterval(() => this._loadCalendar(), 60000);
  },

  async _loadCalendar() {
    if (!this.calendarTimeline) return;

    try {
      const res = await fetch(this.bridgeUrl + '/api/calendar', {
        headers: { 'X-Auth-Token': this.bridgeToken || this.gatewayToken },
      });
      if (res.ok) {
        const data = await res.json();
        this._calendarJobs = data || [];
        this._renderCalendar(data);
      } else {
        this.calendarTimeline.innerHTML = '<div class="calendar-placeholder">Calendar API not available yet</div>';
      }
    } catch (e) {
      this.calendarTimeline.innerHTML = '<div class="calendar-placeholder">Bridge API not available. Start bridge server first.</div>';
    }
  },

  _renderCalendar(jobs) {
    if (!this.calendarTimeline) return;
    this.calendarTimeline.innerHTML = '';

    if (!jobs || jobs.length === 0) {
      this.calendarTimeline.innerHTML = '<div class="calendar-placeholder">No scheduled jobs found. Click <strong>+ New Job</strong> to create one.</div>';
      return;
    }

    // Separate enabled / disabled jobs for grouping
    const enabledJobs = jobs.filter(j => j.enabled !== false);
    const disabledJobs = jobs.filter(j => j.enabled === false);

    // Group scheduled runs by day (enabled jobs only)
    const now = new Date();
    const todayStr = now.toDateString();
    const tomorrowStr = new Date(now.getTime() + 86400000).toDateString();

    const groups = { today: [], tomorrow: [], upcoming: [] };

    for (const job of enabledJobs) {
      if (!job.next_runs || job.next_runs.length === 0) {
        // Enabled but no next_runs — still show under upcoming
        groups.upcoming.push({ time: new Date(now.getTime() + 86400000 * 7), job, isPast: false, noSchedule: true });
        continue;
      }
      for (const run of job.next_runs) {
        const runDate = new Date(run);
        const dayStr = runDate.toDateString();

        const entry = {
          time: runDate,
          job,
          isPast: runDate < now,
        };

        if (dayStr === todayStr) groups.today.push(entry);
        else if (dayStr === tomorrowStr) groups.tomorrow.push(entry);
        else groups.upcoming.push(entry);
      }
    }

    // Sort each group by time
    for (const entries of Object.values(groups)) {
      entries.sort((a, b) => a.time - b.time);
    }

    const groupLabels = {
      today: 'TODAY',
      tomorrow: 'TOMORROW',
      upcoming: 'NEXT 7 DAYS',
    };

    // Deduplicate: track which job ids have already been rendered in this group
    const renderedInGroup = {};

    for (const [key, entries] of Object.entries(groups)) {
      if (entries.length === 0) continue;
      renderedInGroup[key] = new Set();

      const groupDiv = document.createElement('div');
      groupDiv.className = 'calendar-group';

      const header = document.createElement('div');
      header.className = 'calendar-group-header';
      header.textContent = groupLabels[key];
      groupDiv.appendChild(header);

      for (const entry of entries) {
        const { job, time, isPast, noSchedule } = entry;

        // Only render each job once per group (first occurrence = next run)
        if (renderedInGroup[key].has(job.id)) continue;
        renderedInGroup[key].add(job.id);

        this._appendJobRow(groupDiv, job, time, isPast, noSchedule, false);
      }

      this.calendarTimeline.appendChild(groupDiv);
    }

    // Render disabled jobs
    if (disabledJobs.length > 0) {
      const disabledGroup = document.createElement('div');
      disabledGroup.className = 'calendar-group';

      const disabledHeader = document.createElement('div');
      disabledHeader.className = 'calendar-group-header';
      disabledHeader.textContent = 'DISABLED';
      disabledGroup.appendChild(disabledHeader);

      for (const job of disabledJobs) {
        this._appendJobRow(disabledGroup, job, null, false, true, true);
      }

      this.calendarTimeline.appendChild(disabledGroup);
    }

    if (this.calendarTimeline.children.length === 0) {
      this.calendarTimeline.innerHTML = '<div class="calendar-placeholder">No upcoming scheduled tasks</div>';
    }

    // Items are visible immediately — no animation that risks leaving opacity:0

    this._initCountdown();
  },

  /**
   * Render a single job row with inline controls into a group container.
   */
  _appendJobRow(container, job, time, isPast, noSchedule, isDisabled) {
    const agentCfg = AGENTS[job.agent_id] || { emoji: '?', name: job.agent_id };

    // Status icon
    let statusIcon = '\u23F3'; // hourglass (upcoming)
    if (isDisabled) statusIcon = '\u23F8'; // pause ⏸
    else if (isPast && job.last_status === 'ok') statusIcon = '\u2705';
    else if (isPast && job.last_status === 'error') statusIcon = '\u274C';

    const timeStr = time
      ? time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : '--:--';

    const jobEl = document.createElement('div');
    jobEl.className = 'calendar-job' + (isDisabled ? ' calendar-job-disabled' : '');
    if (time) jobEl.dataset.nextRun = String(time.getTime());
    jobEl.innerHTML =
      '<span class="calendar-job-time">' + timeStr + '</span>' +
      '<span class="calendar-job-agent">' + agentCfg.emoji + '</span>' +
      '<span class="calendar-job-name">' + escapeHtml(job.name) + '</span>' +
      '<span class="calendar-job-status">' + statusIcon + '</span>' +
      '<span class="calendar-job-controls">' +
        '<button class="cal-ctrl-btn cal-ctrl-toggle" title="' + (isDisabled ? 'Enable' : 'Disable') + '">' +
          (isDisabled ? '\u25B6' : '\u23F8') +
        '</button>' +
        '<button class="cal-ctrl-btn cal-ctrl-edit" title="Edit">\u270E</button>' +
        '<button class="cal-ctrl-btn cal-ctrl-delete" title="Delete">\uD83D\uDDD1</button>' +
      '</span>';

    // Wire control buttons (stop propagation so clicking them doesn't expand the detail)
    const toggleBtn = jobEl.querySelector('.cal-ctrl-toggle');
    const editBtn = jobEl.querySelector('.cal-ctrl-edit');
    const deleteBtn = jobEl.querySelector('.cal-ctrl-delete');

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleJobEnabled(job.id, job.enabled !== false);
    });

    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showJobForm(job);
    });

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._deleteJob(job.id);
    });

    // Detail panel (expandable)
    const detailEl = document.createElement('div');
    detailEl.className = 'calendar-job-detail';

    let detailText = 'Agent: ' + agentCfg.name + '\n';
    detailText += 'Schedule: ' + (job.cron_expr || '\u2014') + ' (' + (job.timezone || 'UTC') + ')\n';
    detailText += 'Status: ' + (isDisabled ? 'DISABLED' : 'ENABLED') + '\n';
    if (job.last_run_at) {
      detailText += 'Last run: ' + new Date(job.last_run_at).toLocaleString('en-GB') + '\n';
      detailText += 'Duration: ' + (job.last_duration_ms ? (job.last_duration_ms / 1000).toFixed(0) + 's' : '\u2014') + '\n';
    }
    if (job.message) {
      detailText += '\nTask:\n' + job.message.slice(0, 500);
      if (job.message.length > 500) detailText += '...';
    }

    detailEl.textContent = detailText;

    jobEl.addEventListener('click', () => {
      jobEl.classList.toggle('expanded');
    });

    container.appendChild(jobEl);
    container.appendChild(detailEl);
  },

  // ---------------------------------------------------------------------------
  // CRUD: Create / Update / Delete / Toggle
  // ---------------------------------------------------------------------------

  /**
   * Show the job form modal. If existingJob is provided, pre-fill for editing.
   */
  _showJobForm(existingJob) {
    // Prevent duplicate modals
    const existing = document.getElementById('calendar-job-modal');
    if (existing) existing.remove();

    const isEdit = !!existingJob;

    // Build agent options
    let agentOptions = '';
    for (const [id, cfg] of Object.entries(AGENTS)) {
      const selected = (isEdit && existingJob.agent_id === id) ? ' selected' : '';
      agentOptions += '<option value="' + id + '"' + selected + '>' + cfg.emoji + ' ' + cfg.name + '</option>';
    }

    // Timezone options
    const timezones = [localStorage.getItem('mc:timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', 'UTC', 'US/Eastern', 'US/Pacific', 'Asia/Tokyo'];
    let tzOptions = '';
    for (const tz of timezones) {
      const selected = (isEdit && existingJob.timezone === tz) ? ' selected' : '';
      tzOptions += '<option value="' + tz + '"' + selected + '>' + tz + '</option>';
    }

    // Cron presets
    const presets = [
      { label: 'Every hour', value: '0 * * * *' },
      { label: 'Daily 9am', value: '0 9 * * *' },
      { label: 'Every 6h', value: '0 */6 * * *' },
      { label: 'Custom', value: '' },
    ];

    let presetBtns = '';
    for (const p of presets) {
      presetBtns +=
        '<button type="button" class="cal-preset-btn" data-cron="' + p.value + '">' +
          escapeHtml(p.label) +
        '</button>';
    }

    const overlay = document.createElement('div');
    overlay.id = 'calendar-job-modal';
    overlay.className = 'cal-modal-overlay';
    overlay.innerHTML =
      '<div class="cal-modal">' +
        '<div class="cal-modal-header">' +
          (isEdit ? 'Edit Scheduled Job' : 'New Scheduled Job') +
        '</div>' +
        '<div class="cal-modal-body">' +
          '<label class="cal-modal-label">Name <span class="cal-required">*</span></label>' +
          '<input type="text" class="cal-modal-input" id="cal-form-name" placeholder="e.g. Daily health check" value="' + (isEdit ? escapeHtml(existingJob.name) : '') + '" />' +

          '<label class="cal-modal-label">Agent</label>' +
          '<select class="cal-modal-select" id="cal-form-agent">' + agentOptions + '</select>' +

          '<label class="cal-modal-label">Cron Expression <span class="cal-required">*</span></label>' +
          '<div class="cal-preset-row">' + presetBtns + '</div>' +
          '<input type="text" class="cal-modal-input" id="cal-form-cron" placeholder="0 * * * *" value="' + (isEdit ? escapeHtml(existingJob.cron_expr || '') : '') + '" />' +
          '<div class="cal-cron-hint">min hour day month weekday &mdash; e.g. <code>0 */6 * * *</code> = every 6 hours</div>' +

          '<label class="cal-modal-label">Timezone</label>' +
          '<select class="cal-modal-select" id="cal-form-tz">' + tzOptions + '</select>' +

          '<label class="cal-modal-label">Message / Instructions</label>' +
          '<textarea class="cal-modal-textarea" id="cal-form-message" rows="4" placeholder="What should the agent do?">' +
            (isEdit ? escapeHtml(existingJob.message || '') : '') +
          '</textarea>' +
        '</div>' +
        '<div class="cal-modal-actions">' +
          '<button type="button" class="cal-modal-btn cal-modal-btn-cancel" id="cal-form-cancel">Cancel</button>' +
          '<button type="button" class="cal-modal-btn cal-modal-btn-save" id="cal-form-save">' +
            (isEdit ? 'Update' : 'Create') +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // Focus the name input
    const nameInput = document.getElementById('cal-form-name');
    const cronInput = document.getElementById('cal-form-cron');
    setTimeout(() => nameInput && nameInput.focus(), 50);

    // Wire preset buttons
    overlay.querySelectorAll('.cal-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cronVal = btn.dataset.cron;
        if (cronVal) {
          cronInput.value = cronVal;
        }
        cronInput.focus();
        // Highlight the active preset
        overlay.querySelectorAll('.cal-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Close on overlay background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._closeJobForm();
    });

    // Cancel button
    document.getElementById('cal-form-cancel').addEventListener('click', () => {
      this._closeJobForm();
    });

    // Save button
    document.getElementById('cal-form-save').addEventListener('click', () => {
      const name = nameInput.value.trim();
      const agent_id = document.getElementById('cal-form-agent').value;
      const cron_expr = cronInput.value.trim();
      const timezone = document.getElementById('cal-form-tz').value;
      const message = document.getElementById('cal-form-message').value.trim();

      // Validate required fields
      if (!name) {
        nameInput.style.borderColor = 'var(--color-error)';
        nameInput.focus();
        return;
      }
      if (!cron_expr) {
        cronInput.style.borderColor = 'var(--color-error)';
        cronInput.focus();
        return;
      }

      const jobData = { agent_id, name, cron_expr, timezone, message };

      if (isEdit) {
        this._updateJob(existingJob.id, jobData);
      } else {
        jobData.enabled = true;
        this._createJob(jobData);
      }
      this._closeJobForm();
    });

    // Keyboard: Escape to close
    const keyHandler = (e) => {
      if (e.key === 'Escape') {
        this._closeJobForm();
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);
    overlay._keyHandler = keyHandler;
  },

  _closeJobForm() {
    const modal = document.getElementById('calendar-job-modal');
    if (modal) {
      if (modal._keyHandler) document.removeEventListener('keydown', modal._keyHandler);
      modal.remove();
    }
  },

  /**
   * POST /api/calendar — Create a new cron job
   */
  async _createJob(jobData) {
    try {
      const res = await fetch(this.bridgeUrl + '/api/calendar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
        body: JSON.stringify(jobData),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('[Calendar] Failed to create job:', res.status, err);
      }
    } catch (e) {
      console.error('[Calendar] Failed to create job:', e.message);
    }
    this._loadCalendar();
  },

  /**
   * PUT /api/calendar/{id} — Update an existing cron job
   */
  async _updateJob(jobId, updates) {
    try {
      const res = await fetch(this.bridgeUrl + '/api/calendar/' + encodeURIComponent(jobId), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('[Calendar] Failed to update job:', res.status, err);
      }
    } catch (e) {
      console.error('[Calendar] Failed to update job:', e.message);
    }
    this._loadCalendar();
  },

  /**
   * DELETE /api/calendar/{id} — Delete a cron job (with confirm dialog)
   */
  async _deleteJob(jobId) {
    const job = this._calendarJobs.find(j => j.id === jobId);
    const jobName = job ? job.name : jobId;

    if (!confirm('Delete scheduled job "' + jobName + '"?\n\nThis cannot be undone.')) {
      return;
    }

    try {
      const res = await fetch(this.bridgeUrl + '/api/calendar/' + encodeURIComponent(jobId), {
        method: 'DELETE',
        headers: {
          'X-Auth-Token': this.bridgeToken || this.gatewayToken,
        },
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('[Calendar] Failed to delete job:', res.status, err);
      }
    } catch (e) {
      console.error('[Calendar] Failed to delete job:', e.message);
    }
    this._loadCalendar();
  },

  /**
   * PUT /api/calendar/{id} { enabled: !current } — Toggle a job on/off
   */
  async _toggleJobEnabled(jobId, currentlyEnabled) {
    await this._updateJob(jobId, { enabled: !currentlyEnabled });
  },

  _initCountdown() {
    if (this._countdownTimer) clearInterval(this._countdownTimer);
    this._countdownTimer = setInterval(this._tickCountdown.bind(this), 1000);
    this._tickCountdown();
    // Pause timer when tab is hidden
    if (!this._countdownVisHandler) {
      this._countdownVisHandler = function() {
        if (document.hidden) {
          clearInterval(this._countdownTimer);
          this._countdownTimer = null;
        } else if (!this._countdownTimer) {
          this._countdownTimer = setInterval(this._tickCountdown.bind(this), 1000);
          this._tickCountdown();
        }
      }.bind(this);
      document.addEventListener('visibilitychange', this._countdownVisHandler);
    }
  },

  _tickCountdown() {
    if (!this.calendarTimeline) return;
    var jobs = this.calendarTimeline.querySelectorAll('.calendar-job[data-next-run]');
    var now = Date.now();
    var nextTime = Infinity;
    var nextLabel = '';
    jobs.forEach(function(job) {
      var ts = parseInt(job.dataset.nextRun, 10);
      if (ts > now && ts < nextTime) {
        nextTime = ts;
        nextLabel = job.querySelector('.calendar-job-name')
          ? job.querySelector('.calendar-job-name').textContent
          : 'Next event';
      }
    });
    var countdownEl = document.getElementById('calendar-countdown');
    if (nextTime === Infinity) {
      if (countdownEl) countdownEl.style.display = 'none';
      return;
    }
    if (!countdownEl) {
      countdownEl = document.createElement('div');
      countdownEl.className = 'calendar-countdown';
      countdownEl.id = 'calendar-countdown';
      this.calendarTimeline.insertBefore(countdownEl, this.calendarTimeline.firstChild);
    }
    countdownEl.style.display = 'flex';
    var diff = Math.max(0, nextTime - now);
    var h = Math.floor(diff / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    var s = Math.floor((diff % 60000) / 1000);
    var timeStr = (h > 0 ? h + 'h ' : '') + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
    countdownEl.innerHTML =
      '<span class="calendar-countdown-label">\u23F1 Next: ' + escapeHtml(nextLabel) + '</span>' +
      '<span class="calendar-countdown-time">' + timeStr + '</span>';
    if (diff < 60000) {
      countdownEl.querySelector('.calendar-countdown-time').style.color = 'var(--color-error, #ef4444)';
    }
  },
});
