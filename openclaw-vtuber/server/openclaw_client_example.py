"""
Example OpenClaw Client
Simulates an OpenClaw agent sending telemetry to the bridge server.

Use this as a reference for integrating your actual OpenClaw controller.

Run:  BRIDGE_AUTH_TOKEN=<token> python openclaw_client_example.py

The auth token is printed by the bridge server on startup if not set
via environment variable.
"""

import asyncio
import json
import math
import os
import random
from datetime import datetime
from urllib.parse import urlencode

import websockets

BRIDGE_HOST = "localhost"
BRIDGE_PORT = 8100
BRIDGE_AUTH_TOKEN = os.environ.get("BRIDGE_AUTH_TOKEN", "")


def _build_bridge_url() -> str:
    base = f"ws://{BRIDGE_HOST}:{BRIDGE_PORT}/ws/telemetry"
    if BRIDGE_AUTH_TOKEN:
        return f"{base}?{urlencode({'token': BRIDGE_AUTH_TOKEN})}"
    return base


async def simulate_openclaw():
    """Simulate an OpenClaw agent lifecycle: idle -> move -> grip -> release -> repeat."""
    url = _build_bridge_url()

    async with websockets.connect(url) as ws:
        print(f"Connected to bridge at {BRIDGE_HOST}:{BRIDGE_PORT}")
        print("Simulating OpenClaw telemetry... (Ctrl+C to stop)\n")

        cycle_states = [
            ("idle", 3.0),
            ("homing", 2.0),
            ("moving", 4.0),
            ("gripping", 2.0),
            ("moving", 3.0),
            ("releasing", 1.5),
            ("moving", 2.0),
            ("idle", 5.0),
        ]

        t = 0.0
        dt = 0.1  # 10 Hz

        while True:
            for state_name, duration in cycle_states:
                elapsed = 0.0
                print(f"  State: {state_name} ({duration}s)")

                while elapsed < duration:
                    # Simulate joint positions with sinusoidal motion
                    telemetry = {
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                        "robot_id": "openclaw-sim-01",
                        "state": state_name,
                        "gripper": _gripper_for_state(state_name),
                        "gripper_force": _force_for_state(state_name, elapsed),
                        "joint_positions": {
                            "j1": 45.0 * math.sin(t * 0.5),
                            "j2": -30.0 + 20.0 * math.sin(t * 0.3),
                            "j3": 60.0 * math.cos(t * 0.4),
                            "j4": 10.0 * math.sin(t * 0.6),
                            "j5": 15.0 * math.cos(t * 0.2),
                            "j6": 5.0 * math.sin(t * 0.8),
                        },
                        "joint_velocities": {
                            "j1": 20.0 * math.cos(t * 0.5) if state_name == "moving" else 0.0,
                            "j2": 15.0 * math.cos(t * 0.3) if state_name == "moving" else 0.0,
                            "j3": -25.0 * math.sin(t * 0.4) if state_name == "moving" else 0.0,
                            "j4": 5.0 * math.cos(t * 0.6) if state_name == "moving" else 0.0,
                            "j5": -3.0 * math.sin(t * 0.2) if state_name == "moving" else 0.0,
                            "j6": 4.0 * math.cos(t * 0.8) if state_name == "moving" else 0.0,
                        },
                        "battery_pct": max(10.0, 95.0 - t * 0.1),
                        "temperature_c": 35.0 + 5.0 * math.sin(t * 0.05),
                    }

                    # Occasionally inject an error for testing
                    if random.random() < 0.005:
                        telemetry["state"] = "error"
                        telemetry["error_code"] = random.choice([101, 202, 303])
                        telemetry["error_message"] = random.choice([
                            "Joint limit exceeded",
                            "Communication timeout",
                            "Motor overcurrent",
                        ])

                    await ws.send(json.dumps(telemetry))
                    await asyncio.sleep(dt)
                    t += dt
                    elapsed += dt

            print("\n  --- Cycle complete, restarting ---\n")


def _gripper_for_state(state: str) -> str:
    return {
        "gripping": "closed",
        "releasing": "open",
    }.get(state, "open")


def _force_for_state(state: str, elapsed: float) -> float:
    if state == "gripping":
        return min(80.0, elapsed * 40.0)
    return 0.0


if __name__ == "__main__":
    try:
        asyncio.run(simulate_openclaw())
    except KeyboardInterrupt:
        print("\nSimulation stopped.")
    except websockets.exceptions.ConnectionRefused:
        print(f"\nCould not connect to {BRIDGE_HOST}:{BRIDGE_PORT}")
        print("Make sure the bridge server is running: python bridge_server.py")
    except websockets.exceptions.InvalidStatusCode as e:
        if e.status_code == 4003 or e.status_code == 403:
            print(f"\nAuth rejected. Set BRIDGE_AUTH_TOKEN env var to match the bridge server's token.")
        else:
            raise
