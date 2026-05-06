#!/bin/bash
# Horizon Security Suite - Emergency Stop Trigger
# Usage: ./scripts/emergency-stop.sh [reason]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TRIGGER_FILE="$PROJECT_DIR/.emergency_stop"
INCIDENT_LOG="$PROJECT_DIR/logs/incidents.log"

# Get reason from argument or default
REASON="${1:-operator_triggered}"

# Create logs directory if it doesn't exist
mkdir -p "$PROJECT_DIR/logs"

# Log the incident
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "$TIMESTAMP | EMERGENCY_STOP | Reason: $REASON | Operator initiated shutdown" >> "$INCIDENT_LOG"

# Create trigger file
touch "$TRIGGER_FILE"

echo "🚨 EMERGENCY STOP TRIGGERED"
echo "Reason: $REASON"
echo "Trigger file created: $TRIGGER_FILE"
echo ""
echo "OpenClaw will shut down within 5 seconds..."
echo "To restart: cd $PROJECT_DIR && docker compose up -d"
