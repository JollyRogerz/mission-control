#!/bin/bash
# Horizon Security Suite - Install Auto-start on Boot

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_FILE="$SCRIPT_DIR/com.horizon.security-suite.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
INSTALLED_PLIST="$LAUNCH_AGENTS_DIR/com.horizon.security-suite.plist"

echo "🦞 Installing Security Suite Auto-start"
echo ""

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$LAUNCH_AGENTS_DIR"

# Copy plist file
echo "Installing LaunchAgent..."
cp "$PLIST_FILE" "$INSTALLED_PLIST"

# Load the LaunchAgent
echo "Loading LaunchAgent..."
launchctl load "$INSTALLED_PLIST" 2>/dev/null || echo "  (Already loaded or will load on next boot)"

echo ""
echo "✅ Auto-start installed successfully"
echo ""
echo "The Security Suite will now start automatically when you log in."
echo ""
echo "To uninstall:"
echo "  launchctl unload $INSTALLED_PLIST"
echo "  rm $INSTALLED_PLIST"
echo ""
echo "To test (starts manually):"
echo "  launchctl start com.horizon.security-suite"
