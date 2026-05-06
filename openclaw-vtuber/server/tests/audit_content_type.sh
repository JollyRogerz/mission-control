#!/usr/bin/env bash
# ADAPT-09 audit: list every fetch() in config/canvas/*.js, flag body-sending POSTs without Content-Type.
# Exits 0 with a clean report if all body-sending POSTs already include the header.
# Exits 1 listing offenders if any are missing it.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CANVAS="$ROOT/config/canvas"

echo "== ADAPT-09 audit at $(date -u +%FT%TZ) =="
echo "Scanning $CANVAS for fetch() calls..."
echo

OFFENDERS=0
# Find all fetch() invocations and 6 lines of trailing context
grep -rn -A6 'fetch(' "$CANVAS" --include='*.js' \
  | awk 'BEGIN { RS="--\n" } /method:\s*[\x27"]POST[\x27"]/ {
      has_body = /body:/
      has_ct   = /Content-Type/
      if (has_body && !has_ct) { print "[OFFENDER]", $0; offenders++ }
      else if (has_body)        { print "[OK]      ", $0 }
    }
    END { exit (offenders ? 1 : 0) }'
RC=$?

echo
if [[ $RC -eq 0 ]]; then
  echo "Audit PASS: no body-sending POSTs missing Content-Type."
else
  echo "Audit FAIL: see [OFFENDER] entries above."
fi
exit $RC
