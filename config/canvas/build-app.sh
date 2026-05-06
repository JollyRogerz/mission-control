#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Mission Control — macOS .app Builder
# ═══════════════════════════════════════════════════════════════════════
# Assembles a native macOS .app bundle from the existing Mission Control
# dashboard.  Run once to build, re-run to rebuild.
#
# Usage:
#   cd config/canvas && bash build-app.sh
#
# Output:
#   config/canvas/dist/Mission Control.app
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANVAS_DIR="${SCRIPT_DIR}"
DIST_DIR="${CANVAS_DIR}/dist"
APP_NAME="Mission Control"
APP_BUNDLE="${DIST_DIR}/${APP_NAME}.app"
CONTENTS="${APP_BUNDLE}/Contents"
MACOS_DIR="${CONTENTS}/MacOS"
RESOURCES="${CONTENTS}/Resources"

# Branding image — walk up from config/canvas/ to the Horizon root
HORIZON_ROOT="${CANVAS_DIR}/../../.."
ICON_SOURCE="${HORIZON_ROOT}/Branding/image.png"

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
if [[ ! -f "${ICON_SOURCE}" ]]; then
    echo "WARNING: Branding/image.png not found at ${ICON_SOURCE}"
    echo "         The app will be built without a custom icon."
    SKIP_ICON=true
else
    SKIP_ICON=false
fi

echo "==> Building ${APP_NAME}.app ..."

# ---------------------------------------------------------------------------
# Clean previous build
# ---------------------------------------------------------------------------
rm -rf "${APP_BUNDLE}"
mkdir -p "${MACOS_DIR}" "${RESOURCES}"

# ---------------------------------------------------------------------------
# 1. Icon generation  (sips + iconutil — ships with every Mac)
# ---------------------------------------------------------------------------
if [[ "${SKIP_ICON}" == false ]]; then
    echo "    Generating .icns icon ..."
    ICON_WORK="${DIST_DIR}/.icon_work"
    ICONSET="${ICON_WORK}/HorizonMC.iconset"
    rm -rf "${ICON_WORK}"
    mkdir -p "${ICONSET}"

    # Start from a 1024x1024 master
    sips -z 1024 1024 "${ICON_SOURCE}" --out "${ICON_WORK}/icon_1024.png" >/dev/null 2>&1

    # Generate all required sizes
    for SIZE in 16 32 128 256 512; do
        sips -z ${SIZE} ${SIZE} "${ICON_WORK}/icon_1024.png" \
            --out "${ICONSET}/icon_${SIZE}x${SIZE}.png" >/dev/null 2>&1
        DOUBLE=$((SIZE * 2))
        sips -z ${DOUBLE} ${DOUBLE} "${ICON_WORK}/icon_1024.png" \
            --out "${ICONSET}/icon_${SIZE}x${SIZE}@2x.png" >/dev/null 2>&1
    done

    iconutil -c icns "${ICONSET}" -o "${RESOURCES}/HorizonMC.icns"
    rm -rf "${ICON_WORK}"
    echo "    Icon created."
fi

# ---------------------------------------------------------------------------
# 2. Info.plist
# ---------------------------------------------------------------------------
cat > "${CONTENTS}/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Mission Control</string>
    <key>CFBundleDisplayName</key>
    <string>Mission Control</string>
    <key>CFBundleIdentifier</key>
    <string>com.hrznlabs.mission-control</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleExecutable</key>
    <string>launch</string>
    <key>CFBundleIconFile</key>
    <string>HorizonMC</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleSignature</key>
    <string>????</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSSupportsAutomaticGraphicsSwitching</key>
    <true/>
</dict>
</plist>
PLIST

# ---------------------------------------------------------------------------
# 3. canvas_path breadcrumb (for /Applications/ portability)
# ---------------------------------------------------------------------------
echo "${CANVAS_DIR}" > "${RESOURCES}/canvas_path"

# ---------------------------------------------------------------------------
# 4. Launcher script
# ---------------------------------------------------------------------------
cat > "${MACOS_DIR}/launch" << 'LAUNCHER'
#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Mission Control — .app launcher
# ═══════════════════════════════════════════════════════════════
# Resolves the canvas directory, bootstraps the Python venv,
# and runs app.py.

set -euo pipefail

# ---- Locate the canvas directory ----
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES="${SELF_DIR}/../Resources"

# Try breadcrumb first (set at build time — survives moving to /Applications/)
if [[ -f "${RESOURCES}/canvas_path" ]]; then
    CANVAS_DIR="$(cat "${RESOURCES}/canvas_path")"
fi

# Fallback: assume .app is inside dist/ which is inside canvas/
if [[ -z "${CANVAS_DIR:-}" ]] || [[ ! -d "${CANVAS_DIR}" ]]; then
    # .app is at canvas/dist/App.app  →  MacOS is canvas/dist/App.app/Contents/MacOS
    CANVAS_DIR="$(cd "${SELF_DIR}/../../.." && pwd)"
fi

if [[ ! -f "${CANVAS_DIR}/app.py" ]]; then
    osascript -e 'display alert "Mission Control" message "Cannot find the canvas directory. Please rebuild the app from config/canvas/." as critical'
    exit 1
fi

# ---- Bootstrap venv ----
VENV_DIR="${CANVAS_DIR}/.venv"
PYTHON="/opt/homebrew/bin/python3"

# Fallback for Intel Macs
if [[ ! -x "${PYTHON}" ]]; then
    PYTHON="/usr/local/bin/python3"
fi
if [[ ! -x "${PYTHON}" ]]; then
    PYTHON="$(command -v python3 || true)"
fi
if [[ -z "${PYTHON}" ]]; then
    osascript -e 'display alert "Mission Control" message "Python 3 is required but was not found. Please install Python 3." as critical'
    exit 1
fi

if [[ ! -d "${VENV_DIR}" ]]; then
    "${PYTHON}" -m venv "${VENV_DIR}"
    "${VENV_DIR}/bin/pip" install --quiet pywebview
fi

# Ensure pywebview is installed
if ! "${VENV_DIR}/bin/python3" -c "import webview" 2>/dev/null; then
    "${VENV_DIR}/bin/pip" install --quiet pywebview
fi

# ---- Launch ----
cd "${CANVAS_DIR}"
exec "${VENV_DIR}/bin/python3" "${CANVAS_DIR}/app.py" "$@"
LAUNCHER

chmod +x "${MACOS_DIR}/launch"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "==> Built:  ${APP_BUNDLE}"
echo "    To run:  open \"${APP_BUNDLE}\""
echo "    To install:  cp -R \"${APP_BUNDLE}\" /Applications/"
echo ""
