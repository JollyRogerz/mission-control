#!/bin/bash
# Horizon Security Suite - Master Control Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_DIR="$PROJECT_DIR/.security-suite"

mkdir -p "$PID_DIR"

function start_monitors() {
    echo "🦞 Starting Horizon Security Suite"
    echo ""

    # Start emergency monitor
    if [ ! -f "$PID_DIR/emergency-monitor.pid" ]; then
        echo "Starting Emergency Monitor..."
        nohup "$SCRIPT_DIR/emergency-monitor.sh" > "$PROJECT_DIR/logs/emergency-monitor.log" 2>&1 &
        echo $! > "$PID_DIR/emergency-monitor.pid"
        echo "  ✅ Started (PID: $!)"
    else
        echo "  ⚠️  Emergency Monitor already running"
    fi

    # Start audit monitor
    if [ ! -f "$PID_DIR/audit-monitor.pid" ]; then
        echo "Starting Audit Monitor..."
        nohup "$SCRIPT_DIR/audit-monitor.py" > "$PROJECT_DIR/logs/audit-monitor.log" 2>&1 &
        echo $! > "$PID_DIR/audit-monitor.pid"
        echo "  ✅ Started (PID: $!)"
    else
        echo "  ⚠️  Audit Monitor already running"
    fi

    # Start cost tracker
    if [ ! -f "$PID_DIR/cost-tracker.pid" ]; then
        echo "Starting Cost Tracker..."
        nohup "$SCRIPT_DIR/cost-tracker.py" > "$PROJECT_DIR/logs/cost-tracker.log" 2>&1 &
        echo $! > "$PID_DIR/cost-tracker.pid"
        echo "  ✅ Started (PID: $!)"
    else
        echo "  ⚠️  Cost Tracker already running"
    fi

    echo ""
    echo "✅ Security Suite started"
    echo ""
    echo "To view logs:"
    echo "  tail -f $PROJECT_DIR/logs/audit.jsonl"
    echo "  tail -f $PROJECT_DIR/logs/costs.jsonl"
    echo "  tail -f $PROJECT_DIR/logs/incidents.log"
}

function stop_monitors() {
    echo "🛑 Stopping Horizon Security Suite"
    echo ""

    STOPPED=0

    for PID_FILE in "$PID_DIR"/*.pid; do
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            NAME=$(basename "$PID_FILE" .pid)

            if kill -0 "$PID" 2>/dev/null; then
                echo "Stopping $NAME (PID: $PID)..."
                kill "$PID" 2>/dev/null || true
                rm "$PID_FILE"
                ((STOPPED++))
            else
                echo "  ⚠️  $NAME not running (stale PID file)"
                rm "$PID_FILE"
            fi
        fi
    done

    if [ $STOPPED -eq 0 ]; then
        echo "No monitors were running"
    else
        echo ""
        echo "✅ Stopped $STOPPED monitor(s)"
    fi
}

function show_status() {
    echo "🦞 Horizon Security Suite Status"
    echo ""

    RUNNING=0
    STOPPED=0

    # Check emergency monitor
    if [ -f "$PID_DIR/emergency-monitor.pid" ]; then
        PID=$(cat "$PID_DIR/emergency-monitor.pid")
        if kill -0 "$PID" 2>/dev/null; then
            echo "Emergency Monitor: ✅ Running (PID: $PID)"
            ((RUNNING++))
        else
            echo "Emergency Monitor: ❌ Stopped (stale PID)"
            ((STOPPED++))
        fi
    else
        echo "Emergency Monitor: ❌ Stopped"
        ((STOPPED++))
    fi

    # Check audit monitor
    if [ -f "$PID_DIR/audit-monitor.pid" ]; then
        PID=$(cat "$PID_DIR/audit-monitor.pid")
        if kill -0 "$PID" 2>/dev/null; then
            echo "Audit Monitor: ✅ Running (PID: $PID)"
            ((RUNNING++))
        else
            echo "Audit Monitor: ❌ Stopped (stale PID)"
            ((STOPPED++))
        fi
    else
        echo "Audit Monitor: ❌ Stopped"
        ((STOPPED++))
    fi

    # Check cost tracker
    if [ -f "$PID_DIR/cost-tracker.pid" ]; then
        PID=$(cat "$PID_DIR/cost-tracker.pid")
        if kill -0 "$PID" 2>/dev/null; then
            echo "Cost Tracker: ✅ Running (PID: $PID)"
            ((RUNNING++))
        else
            echo "Cost Tracker: ❌ Stopped (stale PID)"
            ((STOPPED++))
        fi
    else
        echo "Cost Tracker: ❌ Stopped"
        ((STOPPED++))
    fi

    # Check git hooks
    if [ -f "$PROJECT_DIR/horizon/.git/hooks/pre-commit" ]; then
        echo "Git Hooks: ✅ Installed"
    else
        echo "Git Hooks: ⚠️  Not installed (run: ./scripts/install-git-hooks.sh)"
    fi

    echo ""
    echo "Summary: $RUNNING running, $STOPPED stopped"
}

function show_logs() {
    echo "🦞 Security Suite Logs"
    echo ""

    if [ ! -d "$PROJECT_DIR/logs" ]; then
        echo "No logs directory found"
        exit 1
    fi

    echo "Recent audit events (last 10):"
    echo "─────────────────────────────────────────"
    if [ -f "$PROJECT_DIR/logs/audit.jsonl" ]; then
        tail -10 "$PROJECT_DIR/logs/audit.jsonl" | jq -r '"\(.timestamp) | \(.event) | \(.status)"' 2>/dev/null || cat "$PROJECT_DIR/logs/audit.jsonl" | tail -10
    else
        echo "No audit log"
    fi

    echo ""
    echo "Today's costs:"
    echo "─────────────────────────────────────────"
    "$SCRIPT_DIR/cost-tracker.py" report 2>/dev/null | head -20 || echo "No cost data"

    echo ""
    echo "Recent incidents:"
    echo "─────────────────────────────────────────"
    if [ -f "$PROJECT_DIR/logs/incidents.log" ]; then
        tail -5 "$PROJECT_DIR/logs/incidents.log"
    else
        echo "No incidents"
    fi
}

# Main command router
case "${1:-}" in
    start)
        start_monitors
        ;;
    stop)
        stop_monitors
        ;;
    restart)
        stop_monitors
        sleep 2
        start_monitors
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    *)
        echo "🦞 Horizon Security Suite"
        echo ""
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start    - Start all monitoring services"
        echo "  stop     - Stop all monitoring services"
        echo "  restart  - Restart all monitoring services"
        echo "  status   - Show status of all services"
        echo "  logs     - Show recent logs"
        echo ""
        echo "Individual tools:"
        echo "  ./scripts/emergency-stop.sh [reason]  - Trigger emergency shutdown"
        echo "  ./scripts/cost-tracker.py report      - Show cost report"
        echo "  ./scripts/install-git-hooks.sh        - Install git hooks"
        exit 1
        ;;
esac
