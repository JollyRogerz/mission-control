#!/usr/bin/env bash
# Phase 05 BOOT-02: mission-control.sh — start FastAPI bridge & open dashboard.
# Requires bootstrap.sh has been run (.venv + .env present).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/.venv"

if [ ! -d "$VENV" ]; then
  echo "[mc] venv missing — run ./bootstrap.sh first" >&2
  exit 1
fi
if [ ! -f "$ROOT/.env" ]; then
  echo "[mc] .env missing — run ./bootstrap.sh first" >&2
  exit 1
fi

# Load .env (export every KEY=VALUE; ignore comments/blank lines)
set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a

HOST="${BRIDGE_HOST:-127.0.0.1}"
PORT="${BRIDGE_PORT:-8100}"
URL="http://${HOST}:${PORT}/dashboard/"

# shellcheck disable=SC1091
source "$VENV/bin/activate"

echo "[mc] starting FastAPI bridge on $URL"

# Open the dashboard URL after a short delay (background)
(sleep 2 && {
  case "$(uname -s)" in
    Darwin) open "$URL" >/dev/null 2>&1 || true ;;
    Linux)  xdg-open "$URL" >/dev/null 2>&1 || true ;;
  esac
}) &

cd "$ROOT/openclaw-vtuber/server"
exec python bridge_server.py
