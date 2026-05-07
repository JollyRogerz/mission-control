#!/usr/bin/env python3
"""
Mission Control — Desktop App

Native macOS application wrapping the Mission Control terminal dashboard.
Uses pywebview (WebKit) for the native window and auto-configures
authentication tokens from openclaw.json and environment variables.

Run:
  ./mission-control.sh          # preferred (handles venv)
  python3 app.py                # direct (needs pywebview in path)
  python3 app.py --bridge-token <token>  # explicit bridge token
"""

import argparse
import json
import logging
import os
import sys
import time
import threading
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

import webview

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
APP_DIR = Path(__file__).resolve().parent          # config/canvas/
CONFIG_DIR = APP_DIR.parent                         # config/
OPENCLAW_JSON = CONFIG_DIR / "openclaw.json"
BRIDGE_SERVER_DIR = APP_DIR.parent.parent / "server"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("mission-control-app")

# ---------------------------------------------------------------------------
# Token discovery
# ---------------------------------------------------------------------------

def read_gateway_token() -> str:
    """Read the gateway auth token from openclaw.json."""
    try:
        with open(OPENCLAW_JSON, "r") as f:
            config = json.load(f)
        token = config.get("gateway", {}).get("auth", {}).get("token", "")
        if token:
            log.info("Gateway token loaded from openclaw.json")
        return token
    except (FileNotFoundError, json.JSONDecodeError, KeyError) as e:
        log.warning(f"Could not read gateway token from openclaw.json: {e}")
        return ""


def read_bridge_token() -> str:
    """Read the bridge auth token from environment or .env file."""
    # 1. Environment variable
    token = os.environ.get("BRIDGE_AUTH_TOKEN", "")
    if token:
        log.info("Bridge token loaded from BRIDGE_AUTH_TOKEN env var")
        return token

    # 2. Check .env file in bridge server directory
    env_file = BRIDGE_SERVER_DIR / ".env"
    if env_file.exists():
        try:
            with open(env_file, "r") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("BRIDGE_AUTH_TOKEN="):
                        token = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if token:
                            log.info(f"Bridge token loaded from {env_file}")
                            return token
        except Exception as e:
            log.warning(f"Could not read .env file: {e}")

    # 3. Check mission-control config file
    mc_config = APP_DIR / "mission-control.json"
    if mc_config.exists():
        try:
            with open(mc_config, "r") as f:
                cfg = json.load(f)
            token = cfg.get("bridge_token", "")
            if token:
                log.info(f"Bridge token loaded from {mc_config}")
                return token
        except Exception:
            pass

    return ""


# ---------------------------------------------------------------------------
# Silent HTTP server for dashboard assets
# ---------------------------------------------------------------------------

class SilentHandler(SimpleHTTPRequestHandler):
    """HTTP handler that doesn't log to stdout and disables caching."""

    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def end_headers(self):
        # Prevent WebKit from caching CSS/JS — always serve fresh files
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        pass  # Suppress all HTTP logs


def start_asset_server(directory: str, port: int = 0) -> tuple:
    """Start a local HTTP server for dashboard assets. Returns (server, port)."""
    handler = partial(SilentHandler, directory=directory)
    server = HTTPServer(("127.0.0.1", port), handler)
    actual_port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    log.info(f"Asset server started on http://127.0.0.1:{actual_port}")
    return server, actual_port


# ---------------------------------------------------------------------------
# JavaScript bridge API (exposed to the frontend)
# ---------------------------------------------------------------------------

class MissionControlAPI:
    """Python API exposed to JavaScript via window.pywebview.api."""

    def __init__(self, gateway_token: str, bridge_token: str, bridge_url: str):
        self.gateway_token = gateway_token
        self.bridge_token = bridge_token
        self.bridge_url = bridge_url

    def get_config(self) -> dict:
        """Called by terminal.js on startup to get auto-configured tokens."""
        return {
            "gateway_token": self.gateway_token,
            "bridge_token": self.bridge_token,
            "bridge_url": self.bridge_url,
            "app_mode": True,
        }

    def log(self, message: str) -> None:
        """Log a message from the frontend."""
        log.info(f"[frontend] {message}")


# ---------------------------------------------------------------------------
# Window lifecycle
# ---------------------------------------------------------------------------

def on_loaded(window):
    """Called when the page finishes loading — inject tokens into JS."""
    # Wait for pywebview API to be ready, then trigger auto-connect
    window.evaluate_js("""
        (function waitForMC() {
            if (window.__missionControl && window.pywebview && window.pywebview.api) {
                window.pywebview.api.get_config().then(function(config) {
                    var mc = window.__missionControl;
                    mc.gatewayToken = config.gateway_token || '';
                    mc.bridgeToken = config.bridge_token || '';
                    mc.bridgeUrl = config.bridge_url || mc.bridgeUrl;

                    // Store in sessionStorage for reconnects
                    sessionStorage.setItem('gateway_token', mc.gatewayToken);
                    sessionStorage.setItem('bridge_token', mc.bridgeToken);

                    // Hide auth modal and connect
                    mc.hideAuthModal();
                    mc.connect();
                });
            } else {
                setTimeout(waitForMC, 100);
            }
        })();
    """)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Mission Control Desktop App")
    parser.add_argument(
        "--bridge-token",
        default="",
        help="Bridge auth token (overrides env/config file discovery)",
    )
    parser.add_argument(
        "--bridge-url",
        default="http://127.0.0.1:8100",
        help="Bridge server URL (default: http://127.0.0.1:8100)",
    )
    parser.add_argument(
        "--width", type=int, default=1400,
        help="Window width (default: 1400)",
    )
    parser.add_argument(
        "--height", type=int, default=900,
        help="Window height (default: 900)",
    )
    args = parser.parse_args()

    # Discover tokens
    gateway_token = read_gateway_token()
    bridge_token = args.bridge_token or read_bridge_token()

    if not gateway_token and not bridge_token:
        log.warning(
            "No tokens found. The auth modal will appear in the dashboard.\n"
            "  Set BRIDGE_AUTH_TOKEN env var, or pass --bridge-token <token>"
        )

    # Start local asset server for the dashboard files
    asset_server, asset_port = start_asset_server(str(APP_DIR))
    cache_bust = int(time.time())
    dashboard_url = f"http://127.0.0.1:{asset_port}/index.html?v={cache_bust}"

    # Create the Python API bridge
    api = MissionControlAPI(
        gateway_token=gateway_token,
        bridge_token=bridge_token,
        bridge_url=args.bridge_url,
    )

    log.info(f"Opening Mission Control at {dashboard_url}")
    log.info(f"Bridge server: {args.bridge_url}")
    log.info(f"Gateway token: {'set' if gateway_token else 'not set'}")
    log.info(f"Bridge token: {'set' if bridge_token else 'not set'}")

    # Create native window
    window = webview.create_window(
        title="Mission Control",
        url=dashboard_url,
        js_api=api,
        width=args.width,
        height=args.height,
        min_size=(800, 600),
        background_color="#0a0a0f",
        text_select=True,
    )

    # Register page loaded callback
    window.events.loaded += lambda: on_loaded(window)

    # Start the app (blocks until window is closed)
    webview.start(debug=False)

    # Cleanup
    asset_server.shutdown()
    log.info("Mission Control closed.")


if __name__ == "__main__":
    main()
