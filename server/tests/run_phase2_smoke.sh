#!/usr/bin/env bash
# Phase 2 smoke entry point. Run from any directory; resolves paths relative to the script.
# Exit code 0 == all 5 SC verified. Non-zero == something failed; check the line above.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$SERVER_DIR/.." && pwd)"

echo "================================================================"
echo "Phase 2 smoke verification — $(date -u +%FT%TZ)"
echo "  server dir : $SERVER_DIR"
echo "  repo root  : $REPO_ROOT"
echo "================================================================"

# -- Wave 0 guards (SC-5 prerequisites) -------------------------------------
echo
echo "[1/4] guard_content_type.sh ..."
( cd "$REPO_ROOT" && bash "$HERE/guard_content_type.sh" )

echo
echo "[2/4] guard_no_sync_xhr.sh ..."
( cd "$REPO_ROOT" && bash "$HERE/guard_no_sync_xhr.sh" )

# -- ADAPT-09 audit log (informational, also gates SC-5) --------------------
echo
echo "[3/4] audit_content_type.sh ..."
( cd "$REPO_ROOT" && bash "$HERE/audit_content_type.sh" )

# -- Pytest aggregator (all 5 SC) -------------------------------------------
echo
echo "[4/4] test_phase2_verification.py ..."
( cd "$SERVER_DIR" && .venv/bin/pytest tests/test_phase2_verification.py -v )

echo
echo "================================================================"
echo "Phase 2 smoke PASSED — all 5 success criteria verified."
echo "================================================================"
