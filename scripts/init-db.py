#!/usr/bin/env python3
"""Phase 05 BOOT-03: Initialize the Mission Control SQLite database.

Creates ``config/canvas/mission-control.db`` with the 10 mission-control tables.
Idempotent: uses ``CREATE TABLE IF NOT EXISTS`` so re-running is safe.

Schema is verbatim from ``server/bridge_server.py:_init_mc_db()``,
with the ALTER TABLE migration columns folded inline (this is a fresh-install
script, not a migration tool — see Plan 05-04 BOOT-03 notes).
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_DIR = ROOT / "config" / "canvas"
DB_PATH = DB_DIR / "mission-control.db"

# Verbatim DDL extracted from server/bridge_server.py
# (see _init_mc_db() — keep in sync if the bridge schema changes).
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    assignee TEXT DEFAULT '',
    priority INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    goal_id TEXT DEFAULT NULL,
    parent_task_id TEXT DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL,
    depends_on TEXT NOT NULL,
    PRIMARY KEY (task_id, depends_on),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    agent_id TEXT,
    text TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    task_id TEXT DEFAULT NULL,
    correlation_id TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_task ON chat_messages(task_id);
CREATE TABLE IF NOT EXISTS feed_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT,
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    timestamp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS cost_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents REAL NOT NULL DEFAULT 0.0,
    timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_events_ts ON cost_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_cost_events_agent ON cost_events(agent_id);
CREATE TABLE IF NOT EXISTS cost_daily (
    date TEXT NOT NULL,
    agent_id TEXT NOT NULL DEFAULT '',
    total_cents REAL NOT NULL DEFAULT 0.0,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, agent_id)
);
CREATE TABLE IF NOT EXISTS activity_hourly (
    date TEXT NOT NULL,
    hour INTEGER NOT NULL,
    agent_id TEXT NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 0,
    active_minutes REAL NOT NULL DEFAULT 0.0,
    PRIMARY KEY (date, hour, agent_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_type TEXT NOT NULL DEFAULT 'system',
    actor_id TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    details_json TEXT NOT NULL DEFAULT '{}',
    timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp);
CREATE TABLE IF NOT EXISTS tool_traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    run_id TEXT NOT NULL DEFAULT '',
    correlation_id TEXT NOT NULL DEFAULT '',
    tool_name TEXT NOT NULL,
    tool_category TEXT NOT NULL DEFAULT 'run',
    phase TEXT NOT NULL DEFAULT 'start',
    input_preview TEXT NOT NULL DEFAULT '',
    output_preview TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER DEFAULT NULL,
    timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traces_run ON tool_traces(run_id);
CREATE INDEX IF NOT EXISTS idx_traces_ts ON tool_traces(timestamp);
"""

EXPECTED_TABLES = {
    "tasks", "task_dependencies", "chat_messages", "feed_entries",
    "goals", "cost_events", "cost_daily", "activity_hourly",
    "audit_log", "tool_traces",
}


def main() -> int:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[init-db] target: {DB_PATH}")
    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.executescript(SCHEMA_SQL)
        conn.commit()
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        present = {r[0] for r in rows}
        missing = EXPECTED_TABLES - present
        if missing:
            print(
                f"[init-db] FAIL: missing tables: {sorted(missing)}",
                file=sys.stderr,
            )
            return 1
        social = {n for n in present if n.startswith("social_")}
        if social:
            print(
                f"[init-db] WARN: unexpected social_* tables: {sorted(social)}",
                file=sys.stderr,
            )
        print(f"[init-db] OK: {len(EXPECTED_TABLES)} tables present")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
