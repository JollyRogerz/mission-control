# 🦞 Horizon Security Suite - Standalone Scripts

Security monitoring and protection tools for Horizon Protocol OpenClaw agent.

## Quick Start

```bash
# Install git hooks (secrets scanner)
./scripts/install-git-hooks.sh

# Start emergency stop monitor (run in background)
./scripts/emergency-monitor.sh &

# Start audit log monitor (run in background)
./scripts/audit-monitor.py &

# Start cost tracker (run in background)
./scripts/cost-tracker.py &

# OR use the master control script
./scripts/security-suite.sh start
```

## Tools

### 1. Emergency Stop System

**Trigger emergency shutdown:**
```bash
./scripts/emergency-stop.sh "reason for stop"
```

**Monitor for emergency triggers (background):**
```bash
./scripts/emergency-monitor.sh &
```

How it works:
- Creates `.emergency_stop` trigger file
- Monitor detects file and shuts down OpenClaw
- Logs incident to `logs/incidents.log`
- Container can be restarted manually

### 2. Audit Log Monitor

**Start monitoring:**
```bash
./scripts/audit-monitor.py
```

**Run in background:**
```bash
nohup ./scripts/audit-monitor.py > /dev/null 2>&1 &
```

Tracks:
- Git operations (push, commit)
- File writes
- Command executions
- API calls
- Tool usage

Output: `logs/audit.jsonl` (JSONL format)

### 3. Cost Tracker

**Start monitoring:**
```bash
./scripts/cost-tracker.py
```

**Show cost report:**
```bash
./scripts/cost-tracker.py report
```

Features:
- Real-time Anthropic API cost tracking
- Daily limit alerts ($10/day default)
- Per-model breakdown
- 7-day cost history

Output: `logs/costs.jsonl`

### 4. Secrets Scanner

**Install git hooks:**
```bash
./scripts/install-git-hooks.sh
```

Detects:
- OpenAI/Anthropic API keys (`sk-...`)
- GitHub tokens (`ghp_...`, `gho_...`)
- AWS keys (`AKIA...`)
- Telegram bot tokens
- Slack tokens
- Google API keys

Blocks commits containing secrets automatically.

## Log Files

| File | Purpose | Format |
|------|---------|--------|
| `logs/audit.jsonl` | All agent actions | JSONL |
| `logs/costs.jsonl` | API cost tracking | JSONL |
| `logs/incidents.log` | Emergency events | Plain text |

## Master Control Script

**Start all monitors:**
```bash
./scripts/security-suite.sh start
```

**Stop all monitors:**
```bash
./scripts/security-suite.sh stop
```

**Check status:**
```bash
./scripts/security-suite.sh status
```

**View logs:**
```bash
./scripts/security-suite.sh logs
```

## Examples

### View Audit Log
```bash
tail -f logs/audit.jsonl | jq .
```

### View Today's Costs
```bash
./scripts/cost-tracker.py report
```

### Trigger Emergency Stop
```bash
./scripts/emergency-stop.sh "testing emergency system"
```

### Test Secret Detection
```bash
cd horizon
echo "sk-test123456789012345678" > test.txt
git add test.txt
git commit -m "test"  # Should be blocked
```

## Troubleshooting

### Monitors Not Running

Check processes:
```bash
ps aux | grep -E "audit-monitor|cost-tracker|emergency-monitor"
```

### Logs Not Writing

Check permissions:
```bash
ls -la logs/
```

Ensure logs directory is writable.

### Git Hook Not Working

Verify hook is installed:
```bash
ls -la horizon/.git/hooks/pre-commit
```

Should be executable (`-rwxr-xr-x`).

## Automation

### Run Monitors on System Startup

Add to crontab:
```bash
@reboot cd /Users/rubenmacedo/OpenClaw-Sandbox && ./scripts/security-suite.sh start
```

### Daily Cost Reports

```bash
0 9 * * * cd /Users/rubenmacedo/OpenClaw-Sandbox && ./scripts/cost-tracker.py report
```

## Configuration

Edit scripts directly to change:
- Daily cost limits (cost-tracker.py: `DAILY_LIMIT`)
- Alert thresholds (cost-tracker.py: `ALERT_THRESHOLD`)
- Check intervals (emergency-monitor.sh: `CHECK_INTERVAL`)
- Secret patterns (install-git-hooks.sh: `PATTERNS`)

## Architecture

```
┌─────────────────────────────────────────┐
│  OpenClaw Container (openclaw-horizon)  │
│  - Horizon Builder Agent                │
│  - Git operations                       │
│  - API calls                            │
└──────────────┬──────────────────────────┘
               │ Docker logs
               ↓
┌──────────────────────────────────────────┐
│  Security Suite Scripts (Host)           │
│  ┌────────────────────────────────────┐ │
│  │ Audit Monitor → audit.jsonl        │ │
│  └────────────────────────────────────┘ │
│  ┌────────────────────────────────────┐ │
│  │ Cost Tracker → costs.jsonl         │ │
│  └────────────────────────────────────┘ │
│  ┌────────────────────────────────────┐ │
│  │ Emergency Monitor → incidents.log  │ │
│  └────────────────────────────────────┘ │
└──────────────────────────────────────────┘
               ↓
┌──────────────────────────────────────────┐
│  Git Hooks (Pre-commit)                  │
│  - Secrets scanner                       │
│  - Blocks dangerous commits              │
└──────────────────────────────────────────┘
```

## Version

- **1.0.0** (2026-02-02) - Initial release

## Author

Ruben Macedo (JollyV) - Horizon Protocol
