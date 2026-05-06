#!/usr/bin/env python3
"""
Horizon Security Suite - Cost Tracker
Monitors Anthropic API usage and tracks costs
"""

import json
import subprocess
import sys
import re
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict

# Configuration
PROJECT_DIR = Path(__file__).parent.parent
COST_LOG = PROJECT_DIR / "logs" / "costs.jsonl"
AUDIT_LOG = PROJECT_DIR / "logs" / "audit.jsonl"
CONTAINER_NAME = "openclaw-horizon"

# Pricing (per million tokens)
PRICING = {
    "claude-sonnet-4-5": {
        "input": 3.00,
        "output": 15.00
    },
    "claude-haiku-4-5": {
        "input": 0.25,
        "output": 1.25
    }
}

# Thresholds
DAILY_LIMIT = 10.00
ALERT_THRESHOLD = 8.00

def write_cost_entry(model: str, input_tokens: int, output_tokens: int, cost: float):
    """Write cost entry to log"""
    COST_LOG.parent.mkdir(parents=True, exist_ok=True)

    entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "model": model,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "cost": round(cost, 4)
    }

    with open(COST_LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")

def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Calculate cost for API call"""
    if model not in PRICING:
        print(f"⚠️  Unknown model: {model}, using sonnet pricing")
        model = "claude-sonnet-4-5"

    pricing = PRICING[model]
    input_cost = (input_tokens / 1_000_000) * pricing["input"]
    output_cost = (output_tokens / 1_000_000) * pricing["output"]

    return input_cost + output_cost

def get_daily_costs() -> float:
    """Get total costs for today"""
    if not COST_LOG.exists():
        return 0.0

    today = datetime.utcnow().date().isoformat()
    total = 0.0

    with open(COST_LOG, "r") as f:
        for line in f:
            if not line.strip():
                continue
            entry = json.loads(line)
            if entry["timestamp"].startswith(today):
                total += entry["cost"]

    return total

def parse_api_call(line: str):
    """Parse API call from Docker logs"""
    # Pattern: input_tokens=X output_tokens=Y model=Z
    input_match = re.search(r"input.*?(\d+)", line, re.IGNORECASE)
    output_match = re.search(r"output.*?(\d+)", line, re.IGNORECASE)
    model_match = re.search(r"(claude-[a-z]+-[\d-]+)", line, re.IGNORECASE)

    if input_match and output_match:
        input_tokens = int(input_match.group(1))
        output_tokens = int(output_match.group(1))
        model = model_match.group(1) if model_match else "claude-sonnet-4-5"

        cost = calculate_cost(model, input_tokens, output_tokens)
        write_cost_entry(model, input_tokens, output_tokens, cost)

        daily_total = get_daily_costs()

        print(f"💰 API Call: {model}")
        print(f"   Input: {input_tokens:,} | Output: {output_tokens:,}")
        print(f"   Cost: ${cost:.4f} | Daily Total: ${daily_total:.2f}")

        if daily_total >= ALERT_THRESHOLD:
            print(f"   ⚠️  WARNING: Daily cost threshold reached!")

        if daily_total >= DAILY_LIMIT:
            print(f"   🚨 ALERT: Daily cost LIMIT exceeded!")

        return True

    return False

def monitor_costs():
    """Monitor Docker logs for API calls"""
    print("🦞 Cost Tracker started")
    print(f"Monitoring container: {CONTAINER_NAME}")
    print(f"Daily limit: ${DAILY_LIMIT:.2f} | Alert threshold: ${ALERT_THRESHOLD:.2f}")
    print(f"Writing to: {COST_LOG}")
    print("")

    try:
        # Follow Docker logs
        process = subprocess.Popen(
            ["docker", "logs", "-f", "--tail", "100", CONTAINER_NAME],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        for line in process.stdout:
            line = line.strip()
            if "anthropic" in line.lower() or "token" in line.lower():
                parse_api_call(line)

    except KeyboardInterrupt:
        print("\n\n🛑 Cost tracker stopped")
        daily_total = get_daily_costs()
        print(f"Final daily total: ${daily_total:.2f}")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)

def show_report():
    """Show cost report"""
    if not COST_LOG.exists():
        print("No cost data available")
        return

    print("📊 Cost Report")
    print("=" * 60)

    # Daily breakdown
    daily_costs = defaultdict(float)
    model_costs = defaultdict(float)

    with open(COST_LOG, "r") as f:
        for line in f:
            if not line.strip():
                continue
            entry = json.loads(line)
            date = entry["timestamp"][:10]
            daily_costs[date] += entry["cost"]
            model_costs[entry["model"]] += entry["cost"]

    # Show last 7 days
    print("\nLast 7 Days:")
    for date in sorted(daily_costs.keys())[-7:]:
        cost = daily_costs[date]
        bar = "█" * int(cost / DAILY_LIMIT * 40)
        print(f"  {date}: ${cost:>7.2f} {bar}")

    print("\nBy Model:")
    for model, cost in sorted(model_costs.items()):
        print(f"  {model}: ${cost:.2f}")

    print(f"\nTotal All Time: ${sum(model_costs.values()):.2f}")
    print("=" * 60)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "report":
        show_report()
    else:
        monitor_costs()
