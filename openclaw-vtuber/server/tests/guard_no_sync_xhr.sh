#!/usr/bin/env bash
# guard_no_sync_xhr.sh — fails if any synchronous XMLHttpRequest remains in
# config/canvas/. Pattern: xhr.open(..., false)
#
# Usage: bash tests/guard_no_sync_xhr.sh
# Exit 0: no synchronous XHR found (post-Wave-6 expected state)
# Exit 1: one or more synchronous XHR sites found (pre-Wave-6 expected baseline)
# Exit 2: config/canvas directory not found
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CANVAS="$ROOT/config/canvas"

[ -d "$CANVAS" ] || { echo "no config/canvas dir found at $CANVAS" >&2; exit 2; }

hits=$(grep -nE '\.open\([^,]+,[^,]+,[[:space:]]*false' "$CANVAS"/*.js || true)

if [ -n "$hits" ]; then
  echo "Synchronous XHR sites found (Wave 6 / ADAPT-10 must fix these):"
  echo "$hits"
  exit 1
fi

echo "guard_no_sync_xhr: OK"
