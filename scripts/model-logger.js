#!/usr/bin/env node
/**
 * Unified Model Logger for Horizon OpenClaw
 *
 * Tails the OpenClaw log in real-time, parses every run start/done/failover,
 * and writes unified tracking to:
 *   workspace/memory/last-model-used.json   (always the latest completed run)
 *   workspace/logs/model-tracking.jsonl     (append-only full history)
 *
 * Works for ALL providers — Antigravity, Codex, OpenRouter, Anthropic — no
 * per-provider proxy needed. OpenClaw logs provider + model on every run start.
 *
 * Usage: node model-logger.js
 */

const fs = require('fs');
const path = require('path');

// --- Paths ---
const LOG_DIR = '/tmp/openclaw';
const WORKSPACE = '/home/node/.openclaw/workspace';
const TRACKING_LOG = path.join(WORKSPACE, 'logs', 'model-tracking.jsonl');
const LAST_MODEL_FILE = path.join(WORKSPACE, 'memory', 'last-model-used.json');

// Ensure dirs
[path.join(WORKSPACE, 'logs'), path.join(WORKSPACE, 'memory')].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// --- State: in-flight runs keyed by runId ---
const runs = {};

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function writeTracked(entry) {
  fs.appendFileSync(TRACKING_LOG, JSON.stringify(entry) + '\n');
  fs.writeFileSync(LAST_MODEL_FILE, JSON.stringify(entry, null, 2));
  log(`✅ Logged: ${entry.provider}/${entry.model} | ${entry.channel} | ${entry.durationMs}ms`
    + (entry.failures.length ? ` | ⚠️ ${entry.failures.length} failover(s)` : ''));
}

// --- Parse a single log line ---
function parseLine(line) {
  let entry;
  try { entry = JSON.parse(line); } catch { return; }

  const msg = entry['1'];
  if (!msg || typeof msg !== 'string') return;

  // --- run start: capture provider + model ---
  // Format: "embedded run start: runId=XXX ... provider=YYY model=ZZZ thinking=... messageChannel=..."
  const startMatch = msg.match(/embedded run start: runId=(\S+).*provider=(\S+)\s+model=(\S+).*messageChannel=(\S+)/);
  if (startMatch) {
    const [, runId, provider, model, channel] = startMatch;
    runs[runId] = {
      runId,
      provider,
      model,
      channel,
      startedAt: entry._meta?.date || entry.time,
      failures: []
    };
    return;
  }

  // --- run done: finalise the entry ---
  // Format: "embedded run done: runId=XXX ... durationMs=NNN aborted=false"
  const doneMatch = msg.match(/embedded run done: runId=(\S+).*durationMs=(\d+)\s+aborted=(\S+)/);
  if (doneMatch) {
    const [, runId, durationMs, aborted] = doneMatch;
    const run = runs[runId];
    if (!run) return; // no matching start (shouldn't happen)

    writeTracked({
      timestamp: entry._meta?.date || entry.time,
      runId,
      provider: run.provider,
      model: run.model,
      channel: run.channel,
      durationMs: parseInt(durationMs),
      aborted: aborted === 'true',
      failures: run.failures
    });

    delete runs[runId]; // clean up
    return;
  }

  // --- failover errors: attach to the most recent in-flight run ---
  // Format: "lane task error: ... error=\"FailoverError: ..."
  const failoverMatch = msg.match(/lane task error:.*error="FailoverError:\s*(.*?)"/);
  if (failoverMatch) {
    const errorMsg = failoverMatch[1];

    // Try to extract model from the error (e.g. "model: claude-haiku-4-5-20251001")
    const modelMatch = errorMsg.match(/model:\s*(\S+)/);
    const statusMatch = errorMsg.match(/HTTP\s+(\d+)/);

    const failure = {
      error: errorMsg.substring(0, 120),
      model: modelMatch ? modelMatch[1] : 'unknown',
      status: statusMatch ? parseInt(statusMatch[1]) : null
    };

    // Attach to the most recent in-flight run (there's usually only one)
    const recentRunId = Object.keys(runs).pop();
    if (recentRunId) {
      runs[recentRunId].failures.push(failure);
    }
    return;
  }
}

// --- Tail a file from a given byte offset, watching for new data ---
function tailFile(filePath, offset) {
  let pos = offset;

  const watcher = fs.watchFile(filePath, { interval: 500 }, (curr) => {
    if (curr.size <= pos) return; // no new data

    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(curr.size - pos);
    fs.readSync(fd, buf, 0, buf.length, pos);
    fs.closeSync(fd);
    pos = curr.size;

    // Split into lines and parse each
    const chunk = buf.toString('utf8');
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.trim()) parseLine(line);
    }
  });

  return watcher;
}

// --- Find today's (and yesterday's) OpenClaw log file ---
function findLogFile() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  const now = new Date();
  // Try today first, then yesterday
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const d = new Date(now);
    d.setDate(d.getDate() - dayOffset);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const candidate = path.join(LOG_DIR, `openclaw-${yyyy}-${mm}-${dd}.log`);
    if (fs.existsSync(candidate)) return candidate;
  }

  // Fallback: grab the most recent .log file
  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.endsWith('.log'))
    .map(f => path.join(LOG_DIR, f));
  if (files.length === 0) return null;
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

// --- Main ---
log('🦞 Horizon Model Logger starting...');

const logFile = findLogFile();
if (!logFile) {
  log('⚠️ No OpenClaw log file found yet. Will retry in 5s...');
  setInterval(() => {
    const f = findLogFile();
    if (f) {
      log(`📄 Found log: ${f} — starting tail`);
      tailFile(f, 0); // start from beginning to catch anything we missed
      clearInterval(arguments.callee); // eslint-disable-line
    }
  }, 5000);
} else {
  // Start tailing from the END of the file (only new entries)
  const size = fs.statSync(logFile).size;
  log(`📄 Tailing: ${logFile} (starting from byte ${size})`);
  tailFile(logFile, size);
}

log('👀 Watching for new runs... (Ctrl+C to stop)');
