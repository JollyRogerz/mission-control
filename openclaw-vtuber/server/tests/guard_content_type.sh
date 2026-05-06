#!/usr/bin/env bash
# guard_content_type.sh — fails if any POST/PUT/PATCH fetch() in config/canvas/
# omits a Content-Type: application/json header within the next 15 lines.
#
# Scope: POST, PUT, PATCH only — DELETE without a body does not require Content-Type.
#
# Usage: bash tests/guard_content_type.sh
# Exit 0: all POST/PUT/PATCH fetch() calls have Content-Type set (or no such calls)
# Exit 1: one or more offending call sites found
# Exit 2: config/canvas directory not found
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CANVAS="$ROOT/config/canvas"

[ -d "$CANVAS" ] || { echo "no config/canvas dir found at $CANVAS" >&2; exit 2; }

# Delegate to Python for reliable quoting-agnostic pattern matching.
# Python is available in the server venv (and system Python 3 on macOS).
PYTHON="${PYTHON:-python3}"

violations=$("$PYTHON" - "$CANVAS" <<'PYEOF'
import sys, re, pathlib

canvas = pathlib.Path(sys.argv[1])
METHOD_RE = re.compile(r"method\s*:\s*['\"]?(POST|PUT|PATCH)", re.IGNORECASE)
CT_RE = re.compile(r"Content-Type.*application/json", re.IGNORECASE)

violations = []
for js_file in sorted(canvas.glob("*.js")):
    lines = js_file.read_text(encoding="utf-8", errors="replace").splitlines()
    i = 0
    while i < len(lines):
        if METHOD_RE.search(lines[i]):
            method_line = i + 1  # 1-based
            window = lines[i:i+16]
            if not any(CT_RE.search(l) for l in window):
                violations.append(f"{js_file}:{method_line}: missing Content-Type header")
            i += 1
        else:
            i += 1

for v in violations:
    print(v)
sys.exit(1 if violations else 0)
PYEOF
) || py_exit=$?

if [ -n "$violations" ]; then
  echo "Content-Type violations found:"
  echo "$violations"
  exit 1
fi

# Count files with POST/PUT/PATCH sites for informational output
post_count=$("$PYTHON" - "$CANVAS" <<'PYEOF'
import sys, re, pathlib

canvas = pathlib.Path(sys.argv[1])
METHOD_RE = re.compile(r"method\s*:\s*['\"]?(POST|PUT|PATCH)", re.IGNORECASE)
count = sum(1 for f in canvas.glob("*.js") if METHOD_RE.search(f.read_text(encoding="utf-8", errors="replace")))
print(count)
PYEOF
)

echo "guard_content_type: OK (${post_count} file(s) with POST/PUT/PATCH fetch sites scanned)"
