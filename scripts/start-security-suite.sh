#!/bin/bash

# Start Security Suite for OpenClaw
# Starts audit monitor, cost tracker, and emergency monitor

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LOG_DIR="$SCRIPT_DIR/../logs"

echo "🛡️  Starting OpenClaw Security Suite..."

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Start audit monitor
echo "Starting Audit Monitor..."
nohup python3 "$SCRIPT_DIR/audit-monitor.py" > "$LOG_DIR/audit-monitor.log" 2>&1 &
AUDIT_PID=$!
echo "  ✅ Audit Monitor started (PID: $AUDIT_PID)"

# Start cost tracker
echo "Starting Cost Tracker..."
nohup python3 "$SCRIPT_DIR/cost-tracker.py" > "$LOG_DIR/cost-tracker.log" 2>&1 &
COST_PID=$!
echo "  ✅ Cost Tracker started (PID: $COST_PID)"

# Start emergency monitor
echo "Starting Emergency Monitor..."
nohup bash "$SCRIPT_DIR/emergency-monitor.sh" > "$LOG_DIR/emergency-monitor.log" 2>&1 &
EMERGENCY_PID=$!
echo "  ✅ Emergency Monitor started (PID: $EMERGENCY_PID)"

echo ""
echo "🎉 Security Suite started successfully!"
echo ""
echo "PIDs:"
echo "  Audit Monitor: $AUDIT_PID"
echo "  Cost Tracker: $COST_PID"
echo "  Emergency Monitor: $EMERGENCY_PID"
echo ""
echo "To check status: ps aux | grep -E '(audit-monitor|cost-tracker|emergency-monitor)' | grep -v grep"
