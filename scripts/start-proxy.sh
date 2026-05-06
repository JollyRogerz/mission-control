#!/bin/bash
# Start the OpenRouter proxy in background
# Run this inside the container: bash scripts/start-proxy.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$WORKSPACE/logs/proxy.log"

# Check if already running
PID_FILE="$WORKSPACE/logs/proxy.pid"
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Proxy already running (PID: $PID)"
        exit 0
    fi
fi

# Export API key from .env if not set
if [ -z "$OPENROUTER_API_KEY" ]; then
    if [ -f "$WORKSPACE/.env" ]; then
        export OPENROUTER_API_KEY=$(grep OPENROUTER_API_KEY "$WORKSPACE/.env" | cut -d'=' -f2)
    fi
fi

# Start proxy in background
cd "$WORKSPACE"
node scripts/openrouter-proxy.js >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

echo "🦞 Proxy started (PID: $!)"
echo "   Logs: $LOG_FILE"
echo "   Model tracking: $WORKSPACE/logs/model-tracking.jsonl"
echo "   Last model used: $WORKSPACE/memory/last-model-used.json"
