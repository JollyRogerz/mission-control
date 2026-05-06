#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Mission Control — Desktop App Launcher
# ═══════════════════════════════════════════════════════════════
# Launches the Mission Control terminal as a native macOS app.
# Uses pywebview (WebKit) for the native window.
#
# Usage:
#   ./mission-control.sh                    # default
#   ./mission-control.sh --bridge-token <t> # explicit token
#   BRIDGE_AUTH_TOKEN=<t> ./mission-control.sh  # via env
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# Resolve script directory (follows symlinks)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"
APP_SCRIPT="${SCRIPT_DIR}/app.py"

# Check venv exists
if [ ! -d "${VENV_DIR}" ]; then
    echo "Creating virtual environment..."
    /opt/homebrew/bin/python3 -m venv "${VENV_DIR}"
    "${VENV_DIR}/bin/pip" install --quiet pywebview
    echo "Virtual environment created."
fi

# Check pywebview is installed
if ! "${VENV_DIR}/bin/python3" -c "import webview" 2>/dev/null; then
    echo "Installing pywebview..."
    "${VENV_DIR}/bin/pip" install --quiet pywebview
fi

# Launch the app
echo "🎯 Launching Mission Control..."
exec "${VENV_DIR}/bin/python3" "${APP_SCRIPT}" "$@"
