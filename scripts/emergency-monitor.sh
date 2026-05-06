#!/bin/bash
# Horizon Security Suite - Emergency Stop Monitor
# Runs in background, monitors for emergency stop trigger

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TRIGGER_FILE="$PROJECT_DIR/.emergency_stop"
INCIDENT_LOG="$PROJECT_DIR/logs/incidents.log"
CHECK_INTERVAL=5

echo "🦞 Emergency Stop Monitor started"
echo "Watching for: $TRIGGER_FILE"
echo "Check interval: ${CHECK_INTERVAL}s"
echo ""

while true; do
  if [ -f "$TRIGGER_FILE" ]; then
    echo "🚨 EMERGENCY STOP DETECTED"

    # Log the incident
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "$TIMESTAMP | EMERGENCY_STOP | Monitor detected trigger file" >> "$INCIDENT_LOG"

    # Remove trigger file
    rm "$TRIGGER_FILE"

    # Shut down OpenClaw
    cd "$PROJECT_DIR"
    echo "Shutting down OpenClaw container..."
    docker compose down

    echo ""
    echo "✅ Emergency shutdown complete"
    echo "To restart: cd $PROJECT_DIR && docker compose up -d"

    # Exit monitor
    exit 0
  fi

  sleep "$CHECK_INTERVAL"
done
