"""
Mission Control Bridge Server (v3.0.0)

FastAPI bridge between the Mission Control dashboard and the OpenClaw Gateway.

Architecture:
  Gateway (ws://127.0.0.1:18789) --> Bridge Server --> Dashboard (HTTP/WS)

Connects directly to the OpenClaw Gateway WebSocket to observe agent events
and forwards them to connected dashboard clients. Handles adapter scanning
(providers, integrations, runtimes), turn streams, and integration send routes.

Security:
  - Binds to 127.0.0.1 only (not exposed to network)
  - Token-based auth on WebSocket endpoints (set BRIDGE_AUTH_TOKEN env var)
  - Gateway auth uses the token from openclaw.json
  - CORS restricted to localhost origins

Run:  python bridge_server.py
"""

import asyncio
import json
import logging
import os
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from dataclasses import asdict
from typing import Any, Optional

import httpx
import uvicorn
import websockets
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
# SECURITY: Bind to localhost only.
BRIDGE_HOST   = os.environ.get("BRIDGE_HOST", "127.0.0.1")
BRIDGE_PORT   = int(os.environ.get("BRIDGE_PORT", "8100"))
# --- ADAPT-06: adapter discovery singletons (Wave 5) -----------------------------
from adapters import AgentDefinition, ModelProvider, Integration, RuntimeAdapter, _scan  # noqa: E402

# Anchor MC_AGENTS_DIR to the repo root regardless of CWD:
# bridge_server.py → server/ → <repo-root>/
_DEFAULT_AGENTS_DIR = Path(__file__).parent.parent / "config" / "agents"
MC_AGENTS_DIR = Path(os.environ.get("MC_AGENTS_DIR", str(_DEFAULT_AGENTS_DIR)))
try:
    AGENTS: list[AgentDefinition] = AgentDefinition.load_all(MC_AGENTS_DIR)
except Exception as _e:  # noqa: BLE001
    logging.getLogger(__name__).warning(
        "AgentDefinition.load_all failed for %s: %s", MC_AGENTS_DIR, _e
    )
    AGENTS = []
PROVIDERS: dict[str, ModelProvider] = _scan("providers", "PROVIDER", ModelProvider)
INTEGRATIONS: dict[str, Integration] = _scan("integrations", "INTEGRATION", Integration)
RUNTIMES: dict[str, RuntimeAdapter] = _scan("runtime", "RUNTIME", RuntimeAdapter)

# turn_id -> async queue of TurnEvent dicts. Producer: runtime dispatch; consumer: WS handler.
_TURN_STREAMS: dict[str, asyncio.Queue] = {}


class TurnRequest(BaseModel):
    agent_id: str
    message: str
    runtime: str | None = None  # picks first runtime if unspecified


class IntegrationSendRequest(BaseModel):
    integration: str
    channel: str
    message: str
# ---------------------------------------------------------------------------------

# OpenClaw Gateway connection
GATEWAY_WS_URL = os.environ.get(
    "MISSION_CONTROL_GATEWAY_URL", "ws://127.0.0.1:18789"
)
GATEWAY_AUTH_TOKEN = os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")
if not GATEWAY_AUTH_TOKEN:
    # Fallback: read from openclaw.json -> gateway.auth.token
    _oc_config_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "config", "openclaw.json",
    )
    try:
        with open(_oc_config_path, "r") as _f:
            _oc_cfg = json.load(_f)
        GATEWAY_AUTH_TOKEN = _oc_cfg.get("gateway", {}).get("auth", {}).get("token", "")
        if GATEWAY_AUTH_TOKEN:
            logging.getLogger(__name__).info("Gateway token loaded from openclaw.json")
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass

# SECURITY: Auth token for bridge WebSocket endpoints (dashboard, etc.)
# Priority: env var > mission-control.json > auto-generate at startup
BRIDGE_AUTH_TOKEN = os.environ.get("BRIDGE_AUTH_TOKEN", "")
if not BRIDGE_AUTH_TOKEN:
    _mc_config_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "config", "canvas", "mission-control.json",
    )
    try:
        with open(_mc_config_path, "r") as _f:
            _mc_cfg = json.load(_f)
        BRIDGE_AUTH_TOKEN = _mc_cfg.get("bridge_token", "")
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass

# Reconnect delay on connection loss
RECONNECT_DELAY_SEC = 3.0

# Mission Control: Telegram chat relay
# Priority: env var > sandbox .env file
# Both TELEGRAM_BOT_TOKEN and TELEGRAM_DEFAULT_CHAT_ID are needed for the
# dashboard ↔ Telegram message mirror to work. If either is missing, the
# /api/chat handler silently skips the Telegram relay (gateway-only mode).
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_DEFAULT_CHAT_ID = os.environ.get("TELEGRAM_DEFAULT_CHAT_ID", "")
if not TELEGRAM_BOT_TOKEN or not TELEGRAM_DEFAULT_CHAT_ID:
    _sandbox_env = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", ".env",
    )
    try:
        with open(_sandbox_env, "r") as _f:
            for _line in _f:
                _line = _line.strip()
                if not TELEGRAM_BOT_TOKEN and _line.startswith("TELEGRAM_BOT_TOKEN="):
                    TELEGRAM_BOT_TOKEN = _line.split("=", 1)[1].strip().strip('"').strip("'")
                elif not TELEGRAM_DEFAULT_CHAT_ID and _line.startswith("TELEGRAM_DEFAULT_CHAT_ID="):
                    TELEGRAM_DEFAULT_CHAT_ID = _line.split("=", 1)[1].strip().strip('"').strip("'")
    except (FileNotFoundError, PermissionError):
        pass
if not TELEGRAM_DEFAULT_CHAT_ID:
    TELEGRAM_DEFAULT_CHAT_ID = None  # signal "unset" for downstream `if` checks

# Mission Control: Dashboard static files (canvas directory)
_BRIDGE_DIR = os.path.dirname(os.path.abspath(__file__))
DASHBOARD_DIR = os.path.join(_BRIDGE_DIR, "..", "config", "canvas")

# Mission Control: event buffer for dashboard clients
_mission_control_clients: set[WebSocket] = set()
_mc_client_queues: dict = {}  # WebSocket -> asyncio.Queue (per-client outbound queue)
_gateway_event_buffer: list[dict] = []  # ring buffer, max 500
_GATEWAY_EVENT_BUFFER_MAX = 500


def _broadcast_to_mc(event: dict):
    """
    Thread-safe broadcast: enqueue event for all MC clients.
    The per-client handler loop drains the queue and sends.
    This avoids concurrent send_json calls on the same WebSocket.
    """
    for ws, q in list(_mc_client_queues.items()):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass  # Drop event if client is too slow

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("openclaw-bridge")

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
connected_robots: set[WebSocket] = set()
gateway_ws: Optional[websockets.WebSocketClientProtocol] = None
gateway_connected: bool = False
# Separate WebSocket for chat.send (webchat mode)
chat_ws: Optional[websockets.WebSocketClientProtocol] = None
chat_ws_connected: bool = False
_chat_ws_pending: dict = {}  # id -> asyncio.Future for RPC responses
# Track the latest assistant streaming text per runId
_assistant_stream_text: dict = {}  # runId -> latest full text

# Unified chat: track which agent runs were triggered by Mission Control
# or by Telegram auto-routing, so we know to forward responses to Telegram.
#
# Instead of a simple boolean, we store the TARGET session key so only
# the correct agent's lifecycle "start" event consumes the flag.
# This prevents the Orchestrator (processing the same Telegram message)
# from stealing the flag meant for the specialist.
_pending_forward_sessions: set = set()  # session keys waiting for lifecycle start
_forward_run_ids: set = set()           # runIds to forward response to Telegram

# Kanban auto-complete tracker: session_key -> kanban_task_id
# When a chat message creates a kanban task, we track the session so that
# when the agent's final response arrives, we auto-mark it done.
_pending_kanban_sessions: dict[str, str] = {}  # session_key -> task_id
_kanban_run_ids: dict[str, str] = {}           # run_id -> task_id

# ---------------------------------------------------------------------------
# Telegram conversation memory (follow-up routing)
# ---------------------------------------------------------------------------
# When a Telegram message is classified and routed to a specialist, we store
# that agent as the "active conversation partner". Short/ambiguous follow-ups
# (like "yes pls do", "go ahead", "ok") that don't match any specialist
# keywords get routed back to the same agent instead of falling through to
# the Orchestrator.
#
# The memory expires after CONVERSATION_TTL_SEC seconds of inactivity.
_tg_conversation: dict = {
    "agent_id": None,       # e.g. "mc-builder"
    "session_key": None,    # e.g. "agent:mc-builder:main"
    "updated_at": 0.0,      # time.monotonic() timestamp
}
CONVERSATION_TTL_SEC = 300  # 5 minutes

# Agent swarm routing: regex to detect @agent routing commands in ANY agent's response
_ROUTE_PATTERN = re.compile(
    r'@agent\s+(mc-(?:orchestrator|builder|architect|social))\b',
    re.IGNORECASE,
)
# All agent IDs that can be routed to (peer-to-peer swarm communication)
_ROUTABLE_AGENTS = {
    "mc-orchestrator",
    "mc-builder",
    "mc-architect",
    "mc-social",
}
# All agent IDs that can initiate routing (any agent can talk to any other)
_ALL_AGENTS = set(_ROUTABLE_AGENTS)

# Dispatch tracker: maps target_session_key -> requesting agent info
# When Agent A sends a task to Agent B, we track it so B's response
# can be forwarded back to A (Anthropic-style swarm pattern)
_pending_dispatches: dict[str, dict] = {}
# Format: { "agent:mc-builder:main": { "from": "mc-architect", "session": "agent:mc-architect:main", "task_preview": "..." } }

# ---------------------------------------------------------------------------
# Bridge-level message classifier (smart router)
# ---------------------------------------------------------------------------
# The Orchestrator LLM keeps executing tasks itself instead of routing.
# So the bridge server acts as the REAL router: it classifies messages
# and sends them directly to the right specialist agent.

_BUILDER_KEYWORDS = re.compile(
    r'\b(pr|prs|pull request|merge|rebase|commit|push|git|repo|repos|'
    r'code|build|test|tests|fix|bug|deploy|npm|pip|cargo|docker|'
    r'sweep|branch|checkout|lint|ci|cd|release|tag|version|'
    r'refactor|implement|function|class|api|endpoint|database|'
    r'install|package|dependency|dependencies|compile|run|script|'
    r'debug|error|crash|log|file|edit|create|delete|rename|move)\b',
    re.IGNORECASE,
)

_ARCHITECT_KEYWORDS = re.compile(
    r'\b(architect|architecture|design|security|audit|review|'
    r'plan|evaluate|assess|research|analyze|analysis|strategy|'
    r'tradeoff|tradeoffs|approach|pattern|diagram|schema|'
    r'migration|scalab|performance|infra|infrastructure|'
    r'system design|threat model|risk|compliance)\b',
    re.IGNORECASE,
)

_SOCIAL_KEYWORDS = re.compile(
    r'\b(post|tweet|social|twitter|farcaster|x\.com|'
    r'announce|announcement|marketing|brand|blog|'
    r'newsletter|community|discord|telegram post|'
    r'content|publish|share|engage|audience|followers)\b',
    re.IGNORECASE,
)


def _classify_message(text: str) -> Optional[str]:
    """
    Classify a user message and return the best specialist agent ID.
    Returns None if ambiguous / should go to Orchestrator.

    Scoring: count keyword matches for each specialist.
    The agent with the most matches wins, but only if it has >= 1 match
    and clearly beats others (or is the only match).
    """
    builder_score = len(_BUILDER_KEYWORDS.findall(text))
    architect_score = len(_ARCHITECT_KEYWORDS.findall(text))
    social_score = len(_SOCIAL_KEYWORDS.findall(text))

    scores = {
        "mc-builder": builder_score,
        "mc-architect": architect_score,
        "mc-social": social_score,
    }

    # Get the top scorer
    best_agent = max(scores, key=scores.get)
    best_score = scores[best_agent]

    if best_score == 0:
        # No matches at all — let Orchestrator handle it
        return None

    # Check if there's a clear winner (at least 1 match ahead)
    other_scores = [v for k, v in scores.items() if k != best_agent]
    second_best = max(other_scores) if other_scores else 0

    if best_score > second_best:
        return best_agent

    # Tie or close — let Orchestrator decide
    return None

# Telegram session watcher: tails the Docker session file for incoming user messages
DOCKER_BIN       = os.environ.get("DOCKER_BIN", "docker")
DOCKER_CONTAINER = os.environ.get("DOCKER_CONTAINER", "openclaw-gateway")
SESSIONS_DIR     = os.environ.get(
    "SESSIONS_DIR",
    f"/home/node/.openclaw/agents/{os.environ.get('DOCKER_CONTAINER', 'openclaw-gateway')}/sessions",
)
_tg_session_proc: Optional[asyncio.subprocess.Process] = None


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------
def _check_ws_token(token: Optional[str]) -> bool:
    """Validate the WebSocket auth token. Returns True if valid."""
    if not BRIDGE_AUTH_TOKEN:
        return True
    if not token:
        return False
    return secrets.compare_digest(token, BRIDGE_AUTH_TOKEN)


# ---------------------------------------------------------------------------
# OpenClaw Gateway WebSocket connection
# ---------------------------------------------------------------------------
async def connect_to_gateway() -> bool:
    """
    Connect to the OpenClaw Gateway WebSocket and complete the handshake.

    Protocol:
      1. Server sends connect.challenge with nonce
      2. Client sends req/connect with auth token and client info
      3. Server responds with hello-ok (protocol 3)
      4. Events (agent, chat, health, tick) are broadcast automatically

    Returns True if connected, False otherwise.
    """
    global gateway_ws, gateway_connected

    if not GATEWAY_AUTH_TOKEN:
        log.warning("No OPENCLAW_GATEWAY_TOKEN set. Cannot connect to Gateway.")
        log.warning("Set it to the value of gateway.auth.token from openclaw.json")
        return False

    try:
        gateway_ws = await websockets.connect(
            GATEWAY_WS_URL,
            additional_headers={"Authorization": f"Bearer {GATEWAY_AUTH_TOKEN}"},
        )
        log.info(f"WebSocket opened to Gateway at {GATEWAY_WS_URL}")

        # Wait for connect.challenge
        raw = await asyncio.wait_for(gateway_ws.recv(), timeout=10.0)
        data = json.loads(raw)

        if data.get("event") != "connect.challenge":
            log.error(f"Expected connect.challenge, got: {data.get('event', data.get('type'))}")
            await gateway_ws.close()
            gateway_ws = None
            return False

        # Send connect request (local connection -- nonce not required)
        connect_req = {
            "type": "req",
            "id": str(uuid.uuid4()),
            "method": "connect",
            "params": {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": "gateway-client",
                    "displayName": "Mission Control Bridge",
                    "version": "3.0.0",
                    "platform": "macos",
                    "mode": "backend",
                },
                "role": "operator",
                "scopes": ["operator.admin", "operator.read", "operator.write"],
                "caps": [],
                "auth": {"token": GATEWAY_AUTH_TOKEN},
            },
        }
        await gateway_ws.send(json.dumps(connect_req))

        # Wait for hello-ok response
        raw = await asyncio.wait_for(gateway_ws.recv(), timeout=10.0)
        resp = json.loads(raw)

        if resp.get("type") == "res" and resp.get("ok"):
            proto = resp.get("payload", {}).get("protocol", "?")
            log.info(f"Gateway handshake OK (protocol {proto})")
            gateway_connected = True
            return True
        else:
            error = resp.get("payload", {}).get("error", resp)
            log.error(f"Gateway connect rejected: {error}")
            await gateway_ws.close()
            gateway_ws = None
            return False

    except asyncio.TimeoutError:
        log.warning("Gateway handshake timed out")
        if gateway_ws:
            await gateway_ws.close()
        gateway_ws = None
        return False
    except Exception as e:
        log.warning(f"Could not connect to Gateway: {e}")
        gateway_ws = None
        return False


# ---------------------------------------------------------------------------
# Gateway chat WebSocket (webchat mode — for sending messages)
# ---------------------------------------------------------------------------
def _load_device_identity() -> dict:
    """Load device identity (Ed25519 keys) and device-auth token for chat WS."""
    _id_dir = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "config", "identity",
    )
    result = {"token": "", "deviceId": "", "privateKey": None, "publicKeyPem": ""}

    # Load device-auth.json (operator token)
    try:
        with open(os.path.join(_id_dir, "device-auth.json"), "r") as _f:
            _da = json.load(_f)
        result["token"] = _da.get("tokens", {}).get("operator", {}).get("token", "")
        result["deviceId"] = _da.get("deviceId", "")
    except (FileNotFoundError, json.JSONDecodeError, KeyError) as e:
        log.warning(f"Could not load device-auth.json: {e}")

    # Load device.json (Ed25519 keypair for signing)
    try:
        with open(os.path.join(_id_dir, "device.json"), "r") as _f:
            _dv = json.load(_f)
        pem = _dv.get("privateKeyPem", "")
        pub_pem = _dv.get("publicKeyPem", "")
        if pem:
            from cryptography.hazmat.primitives.serialization import load_pem_private_key
            result["privateKey"] = load_pem_private_key(pem.encode(), password=None)
            result["publicKeyPem"] = pub_pem
            log.info(f"Device identity loaded: id={result['deviceId'][:12]}... token={result['token'][:8]}...")
    except (FileNotFoundError, json.JSONDecodeError, KeyError) as e:
        log.warning(f"Could not load device.json: {e}")
    except ImportError:
        log.warning("cryptography library not installed — device signing disabled")

    return result


# Cache at module level
_DEVICE_IDENTITY = _load_device_identity()
_DEVICE_AUTH_TOKEN = _DEVICE_IDENTITY["token"]
_DEVICE_AUTH_ID = _DEVICE_IDENTITY["deviceId"]


async def connect_chat_ws() -> bool:
    """
    Open a second gateway connection in 'webchat' mode for chat.send RPC.
    The event listener (gateway-client) is backend-mode and read-only.
    This connection enables sending user messages through the gateway.
    Uses the device-auth operator token which has operator.write scope.
    """
    global chat_ws, chat_ws_connected

    # Gateway token for HTTP handshake (Authorization header)
    # Device-auth token for connect payload (has operator.write scope)
    if not GATEWAY_AUTH_TOKEN:
        log.error("Chat WS: no gateway auth token for HTTP handshake")
        return False
    connect_auth_token = _DEVICE_AUTH_TOKEN or GATEWAY_AUTH_TOKEN

    try:
        chat_ws = await websockets.connect(
            GATEWAY_WS_URL,
            additional_headers={
                "Authorization": f"Bearer {GATEWAY_AUTH_TOKEN}",
                "Origin": f"http://127.0.0.1:{BRIDGE_PORT}",
            },
        )
        log.info(f"Chat WS: opened to gateway (device-auth={'yes' if _DEVICE_AUTH_TOKEN else 'no'})")

        # Wait for connect.challenge
        raw = await asyncio.wait_for(chat_ws.recv(), timeout=10.0)
        data = json.loads(raw)
        if data.get("event") != "connect.challenge":
            log.error(f"Chat WS: expected connect.challenge, got: {data}")
            await chat_ws.close()
            chat_ws = None
            return False

        # Connect in webchat mode (allows chat.send)
        # Build device-signed auth if Ed25519 key is available
        challenge_nonce = data.get("payload", {}).get("nonce", "")
        connect_params = {
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": {
                "id": "gateway-client",
                "displayName": "Mission Control Chat",
                "version": "3.0.0",
                "platform": "linux",
                "mode": "backend",
            },
            "role": "operator",
            "scopes": ["operator.admin", "operator.approvals", "operator.pairing", "operator.read", "operator.write", "operator.talk.secrets"],
            "caps": [],
        }

        pk = _DEVICE_IDENTITY.get("privateKey")
        if pk and _DEVICE_AUTH_TOKEN and _DEVICE_AUTH_ID:
            # Ed25519-signed device auth — matches gateway's buildDeviceAuthPayloadV3:
            # v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|deviceToken|nonce|platform|deviceFamily
            import base64 as _b64
            from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

            signed_at = int(time.time() * 1000)
            scopes_str = ",".join(connect_params["scopes"])
            # platform and deviceFamily are normalized to lowercase by gateway
            platform = connect_params["client"]["platform"]  # "linux"
            device_family = ""  # not set

            sign_payload = "|".join([
                "v3",
                _DEVICE_AUTH_ID,
                connect_params["client"]["id"],       # "gateway-client"
                connect_params["client"]["mode"],      # "backend"
                connect_params["role"],                # "operator"
                scopes_str,
                str(signed_at),
                _DEVICE_AUTH_TOKEN,                    # deviceToken in auth
                challenge_nonce,
                platform,
                device_family,
            ])

            sig_bytes = pk.sign(sign_payload.encode("utf-8"))
            # base64url encode (matching gateway's base64UrlEncode: +→- /→_ strip =)
            signature = _b64.b64encode(sig_bytes).decode().replace("+", "-").replace("/", "_").rstrip("=")

            pub_raw = pk.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
            pub_b64url = _b64.b64encode(pub_raw).decode().replace("+", "-").replace("/", "_").rstrip("=")

            connect_params["device"] = {
                "id": _DEVICE_AUTH_ID,
                "publicKey": pub_b64url,
                "signature": signature,
                "signedAt": signed_at,
                "nonce": challenge_nonce,
            }
            connect_params["auth"] = {"deviceToken": _DEVICE_AUTH_TOKEN}
            log.info(f"Chat WS: using Ed25519 device auth (nonce={challenge_nonce[:12]}...)")
        else:
            # Fallback: plain gateway token (no operator.write)
            connect_params["auth"] = {"token": GATEWAY_AUTH_TOKEN}
            log.warning("Chat WS: no device identity — falling back to gateway token (no operator.write)")
        connect_req = {
            "type": "req",
            "id": str(uuid.uuid4()),
            "method": "connect",
            "params": connect_params,
        }
        await chat_ws.send(json.dumps(connect_req))

        raw = await asyncio.wait_for(chat_ws.recv(), timeout=10.0)
        resp = json.loads(raw)

        if resp.get("type") == "res" and resp.get("ok"):
            log.info(f"Chat WS: connected (protocol {resp.get('payload', {}).get('protocol', '?')})")
            chat_ws_connected = True
            return True
        else:
            error = resp.get("payload", {}).get("error", resp)
            log.error(f"Chat WS: connect rejected: {error}")
            await chat_ws.close()
            chat_ws = None
            return False

    except Exception as e:
        log.warning(f"Chat WS: could not connect: {e}")
        chat_ws = None
        chat_ws_connected = False
        return False


async def _mirror_chat_event_to_mc(data: dict) -> None:
    """
    Process a gateway broadcast event arriving on the chat WS connection.

    Why this exists: gateway_ws and chat_ws both connect with client.id
    "gateway-client" (an allowlisted value the gateway validates). The
    gateway then routes broadcast events to whichever backend connection
    it picks — in practice that's chat_ws. Without this mirror, the
    dashboard never sees agent replies or routing events.

    Handles only what the dashboard chat panel needs:
      - stream='assistant' chunks → accumulate text per runId
      - stream='lifecycle' phase='end' → broadcast final reply to MC
      - stream='lifecycle' phase='start' on tracked runs → mark for TG forward
    """
    event_type = data.get("event", "")
    if event_type != "agent":
        return

    payload = data.get("payload", {})
    run_id = payload.get("runId", "")
    stream_type = payload.get("stream", "")
    if not run_id:
        return

    # Accumulate streaming assistant text for this run
    if stream_type == "assistant":
        resp_data = payload.get("data", {})
        full_text = resp_data.get("text", "") if isinstance(resp_data, dict) else ""
        if full_text:
            _assistant_stream_text[run_id] = full_text
        return

    if stream_type != "lifecycle":
        return

    phase = (payload.get("data", {}) or {}).get("phase", "")
    session_key = payload.get("sessionKey", "")

    # On lifecycle start, register tracked runs for Telegram forwarding so a
    # later "end" knows whether to forward the reply back to TG. Also mirror
    # Telegram-originated user messages to the dashboard chat panel so the
    # operator sees the inbound message that the agent is responding to.
    if phase == "start":
        if session_key in _pending_forward_sessions:
            _pending_forward_sessions.discard(session_key)
            _forward_run_ids.add(run_id)
            global _draft_counter
            _draft_counter += 1
            _active_drafts[run_id] = _draft_counter
            log.info(
                f"Run tracked for TG forwarding (chat_ws mirror): {run_id[:12]} "
                f"session={session_key} (draft_id={_draft_counter})"
            )
        # Telegram → dashboard mirror: when a Telegram-originated agent run
        # starts, fetch the user's incoming message from the agent session
        # file (Docker exec) and broadcast it to MC clients as a chat event.
        if "telegram" in session_key:
            asyncio.create_task(
                _emit_telegram_user_message_to_mc(session_key, run_id)
            )
        return

    if phase != "end":
        return

    final_text = _assistant_stream_text.pop(run_id, "")
    if not final_text:
        return

    resp_agent_id = _resolve_agent_from_session_key(session_key)

    # Forward to Telegram if tracked
    if run_id in _forward_run_ids:
        _forward_run_ids.discard(run_id)
        _active_drafts.pop(run_id, None)
        _draft_last_sent.pop(run_id, None)
        log.info(
            f"Forwarding response to Telegram (chat_ws mirror): "
            f"{len(final_text)} chars, agent={resp_agent_id}"
        )
        asyncio.create_task(
            _forward_response_to_telegram(final_text, resp_agent_id)
        )
        if resp_agent_id:
            _tg_conversation["agent_id"] = resp_agent_id
            _tg_conversation["session_key"] = session_key
            _tg_conversation["updated_at"] = time.monotonic()

    # Always broadcast the agent reply to MC dashboard
    _mc_chat_event = {
        "type": "event",
        "event": "chat",
        "payload": {
            "role": "assistant",
            "agentId": resp_agent_id or "unknown",
            "text": final_text,
            "runId": run_id,
            "sessionKey": session_key,
            "state": "final",
            "source": "bridge",
        },
    }
    _broadcast_to_mc(_mc_chat_event)
    log.info(
        f"Agent response broadcast to MC chat (chat_ws mirror) "
        f"({len(final_text)} chars, agent={resp_agent_id})"
    )


async def chat_ws_listener():
    """
    Listen for RPC responses on the chat WebSocket.
    Resolves pending futures in _chat_ws_pending.
    Also mirrors broadcast events to MC via _mirror_chat_event_to_mc.
    """
    global chat_ws, chat_ws_connected

    while True:
        if chat_ws is None or not chat_ws_connected:
            await asyncio.sleep(RECONNECT_DELAY_SEC)
            if chat_ws is None:
                success = await connect_chat_ws()
                if not success:
                    continue
        try:
            async for raw in chat_ws:
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                # RPC response to our chat.send request
                if data.get("type") == "res":
                    req_id = data.get("id")
                    if req_id and req_id in _chat_ws_pending:
                        future = _chat_ws_pending.pop(req_id)
                        if not future.done():
                            future.set_result(data)
                # ────────────────────────────────────────────────────────────
                # Mirror broadcast events to MC dashboard.
                # The gateway routes agent-reply events to whichever backend
                # connection it picks; in practice events arrive on chat_ws
                # while gateway_ws only sees health pings. So we need to
                # process the agent-reply lifecycle here to keep the MC chat
                # panel in sync. Processes only the minimum needed: stream
                # text accumulation + final broadcast on lifecycle end.
                # ────────────────────────────────────────────────────────────
                elif data.get("type") == "event":
                    try:
                        await _mirror_chat_event_to_mc(data)
                    except Exception as e:
                        log.warning(f"Chat WS: mirror error: {e}")
        except websockets.exceptions.ConnectionClosed as e:
            log.warning(f"Chat WS: disconnected ({e})")
        except Exception as e:
            log.warning(f"Chat WS: error: {e}")

        chat_ws = None
        chat_ws_connected = False
        await asyncio.sleep(RECONNECT_DELAY_SEC)


def _save_attachment_image(attachment: dict) -> str | None:
    """Save base64 image attachment to uploads/ directory.  Returns filename or None."""
    import base64 as _b64

    data_url = attachment.get("data", "")
    if "," not in data_url:
        return None
    header, b64_data = data_url.split(",", 1)
    mime = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
    ext = mime.split("/")[-1].replace("jpeg", "jpg")
    img_id = f"{uuid.uuid4().hex[:12]}.{ext}"

    uploads_dir = os.path.join(DASHBOARD_DIR, "uploads")
    os.makedirs(uploads_dir, exist_ok=True)

    try:
        img_bytes = _b64.b64decode(b64_data)
        filepath = os.path.join(uploads_dir, img_id)
        with open(filepath, "wb") as f:
            f.write(img_bytes)
        log.info(f"Saved attachment image: {filepath} ({len(img_bytes)//1024} KB)")
        return img_id
    except Exception as e:
        log.warning(f"Failed to save attachment image: {e}")
        return None


async def send_chat_via_gateway(
    text: str,
    session_key: str = "main",
    attachment: dict | None = None,
) -> dict:
    """
    Send a chat message through the gateway using the chat.send RPC method.
    If *attachment* is provided (type=image), the message is sent as a
    multimodal content array so vision-capable models can see the image.
    Returns the RPC response dict or raises an exception.
    """
    global chat_ws, chat_ws_connected

    if chat_ws is None or not chat_ws_connected:
        raise ConnectionError("Chat WebSocket not connected to gateway")

    req_id = str(uuid.uuid4())
    idempotency_key = str(uuid.uuid4())

    # Build the gateway RPC payload.
    # The schema already has: attachments: Type.Optional(Type.Array(Type.Unknown()))
    # so we pass images via the `attachments` field — the gateway's
    # parseMessageWithAttachments() converts them to ChatImageContent and
    # feeds them to the LLM as vision input_image blocks.
    message_payload = text or ("(screenshot attached — please analyze this image)" if attachment else "")
    gateway_attachments = None

    if attachment and attachment.get("type") == "image" and attachment.get("data"):
        data_url = attachment["data"]
        # Extract raw base64 and MIME from "data:image/png;base64,iVBOR..."
        if "," in data_url:
            header, b64_data = data_url.split(",", 1)
            mime = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
        else:
            b64_data = data_url
            mime = "image/png"

        gateway_attachments = [{
            "type": "image",
            "mimeType": mime,
            "content": b64_data,  # raw base64, no data: prefix
            "fileName": attachment.get("filename", "image.png"),
        }]

        # Also save locally for dashboard history / reference
        _save_attachment_image(attachment)

    params = {
        "sessionKey": session_key,
        "message": message_payload,
        "deliver": True,
        "idempotencyKey": idempotency_key,
    }
    if gateway_attachments:
        params["attachments"] = gateway_attachments

    msg = {
        "type": "req",
        "id": req_id,
        "method": "chat.send",
        "params": params,
    }

    loop = asyncio.get_running_loop()
    future = loop.create_future()
    _chat_ws_pending[req_id] = future

    try:
        await chat_ws.send(json.dumps(msg))
        # Wait for response with timeout
        result = await asyncio.wait_for(future, timeout=15.0)
        return result
    except asyncio.TimeoutError:
        _chat_ws_pending.pop(req_id, None)
        raise TimeoutError("Gateway did not respond to chat.send within 15s")
    except Exception:
        _chat_ws_pending.pop(req_id, None)
        raise


async def _dispatch_agent_routing(response_text: str, original_session_key: str):
    """
    Detect @agent routing commands in ANY agent's response and dispatch
    the task to the target agent. Implements Anthropic-style peer-to-peer
    swarm communication.

    Any agent can route to any other agent using '@agent mc-<name> ...'
    The bridge tracks the dispatch so the target's response is forwarded
    back to the requesting agent (bidirectional swarm loop).

    Examples:
      Orchestrator -> @agent mc-builder "build the auth module"
      Architect -> @agent mc-builder "implement the schema I designed"
      Builder -> @agent mc-architect "review this PR before I merge"
    """
    # Resolve which agent sent this response
    source_agent = _resolve_agent_from_session_key(original_session_key)
    if not source_agent or source_agent not in _ALL_AGENTS:
        return

    # Find all @agent mentions (support parallel dispatch like Anthropic pattern)
    matches = list(_ROUTE_PATTERN.finditer(response_text))
    if not matches:
        return

    for match in matches:
        target_agent = match.group(1).lower()
        if target_agent not in _ROUTABLE_AGENTS:
            continue
        # Don't route to self
        if target_agent == source_agent:
            continue

        # Extract the task: text after the @agent command
        route_pos = match.end()
        remaining = response_text[route_pos:].strip()

        # If the @agent mention has minimal text after it, use the full response
        if len(remaining) < 20:
            task_text = response_text.strip()
        else:
            # For multiple @agent mentions, extract text until the next @agent or end
            next_match_start = None
            for m in matches:
                if m.start() > match.start():
                    next_match_start = m.start()
                    break
            if next_match_start:
                task_text = response_text[route_pos:next_match_start].strip()
            else:
                task_text = remaining

        # Clean up
        task_text = task_text.strip()
        if len(task_text) > 4000:
            task_text = task_text[:4000] + "..."

        target_session = f"agent:{target_agent}:main"
        log.info(
            f"🔀 Swarm routing: {source_agent} -> {target_agent} "
            f"(task: '{task_text[:100]}...')"
        )

        try:
            result = await send_chat_via_gateway(task_text, target_session)
            if result.get("ok"):
                log.info(f"✅ Routed to {target_agent} via gateway session {target_session}")

                # Auto-create kanban task for this dispatch
                task_id = str(uuid.uuid4())
                task_title = task_text[:120].split('\n')[0]  # first line, max 120 chars
                now_ms = int(time.time() * 1000)
                try:
                    db = _get_mc_db()
                    db.execute(
                        "INSERT INTO tasks (id, title, description, status, assignee, priority, created_at, updated_at, completed_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (task_id, task_title, task_text[:2000], "in_progress", target_agent, 1, now_ms, now_ms, None),
                    )
                    db.commit()
                    db.close()
                    log.info(f"📋 Auto-created kanban task '{task_title[:60]}' for {target_agent}")

                    # Push task_update event so kanban board refreshes
                    task_event = {
                        "type": "event",
                        "event": "task_update",
                        "payload": {
                            "action": "created",
                            "task_id": task_id,
                            "title": task_title,
                            "assignee": target_agent,
                            "from": source_agent,
                        },
                        "ts": datetime.utcnow().isoformat() + "Z",
                    }
                    _broadcast_to_mc(task_event)
                except Exception as db_err:
                    log.warning(f"Failed to auto-create kanban task: {db_err}")

                # Track dispatch so the response routes back to the requester
                _pending_dispatches[target_session] = {
                    "from": source_agent,
                    "session": f"agent:{source_agent}:main",
                    "task_preview": task_text[:200],
                    "task_id": task_id,  # link kanban card to this dispatch
                    "dispatched_at": datetime.utcnow().isoformat() + "Z",
                }

                # Push routing event to Mission Control dashboard
                routing_event = {
                    "type": "event",
                    "event": "routing",
                    "payload": {
                        "from": source_agent,
                        "to": target_agent,
                        "task": task_text[:200],
                        "sessionKey": target_session,
                        "swarm": True,  # flag for MC to show swarm indicator
                    },
                    "ts": datetime.utcnow().isoformat() + "Z",
                }
                _broadcast_to_mc(routing_event)
            else:
                error = result.get("payload", {}).get("error", result)
                log.warning(f"❌ Routing to {target_agent} failed: {error}")
        except Exception as e:
            log.warning(f"❌ Routing dispatch error: {e}")


async def _dispatch_response_back(response_text: str, responder_session_key: str):
    """
    When an agent finishes a task that was dispatched by another agent,
    forward the result back to the requesting agent (Anthropic-style
    synthesis loop).

    This enables patterns like:
      1. Orchestrator dispatches research to Builder + Architect in parallel
      2. Builder and Architect each complete their work
      3. Their results are forwarded back to the Orchestrator
      4. Orchestrator synthesizes and decides if another round is needed
    """
    dispatch = _pending_dispatches.pop(responder_session_key, None)
    if not dispatch:
        return  # Not a dispatched task, nothing to forward back

    requester = dispatch["from"]
    requester_session = dispatch["session"]
    responder_agent = _resolve_agent_from_session_key(responder_session_key)

    # Auto-mark the kanban task as done
    kanban_task_id = dispatch.get("task_id")
    if kanban_task_id:
        try:
            now_ms = int(time.time() * 1000)
            db = _get_mc_db()
            db.execute(
                "UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?",
                (now_ms, now_ms, kanban_task_id),
            )
            db.commit()
            db.close()
            log.info(f"✅ Auto-completed kanban task {kanban_task_id[:8]}...")

            # Push task_update event so kanban board refreshes
            task_event = {
                "type": "event",
                "event": "task_update",
                "payload": {
                    "action": "completed",
                    "task_id": kanban_task_id,
                    "agent": responder_agent,
                },
                "ts": datetime.utcnow().isoformat() + "Z",
            }
            _broadcast_to_mc(task_event)
        except Exception as db_err:
            log.warning(f"Failed to auto-complete kanban task: {db_err}")

    # Build a structured response-back message
    response_back = (
        f"[Swarm Response from {responder_agent}]\n"
        f"Original task: {dispatch['task_preview']}\n"
        f"---\n"
        f"{response_text}"
    )

    if len(response_back) > 4000:
        response_back = response_back[:4000] + "..."

    log.info(
        f"🔄 Swarm response-back: {responder_agent} -> {requester} "
        f"(result: '{response_text[:100]}...')"
    )

    try:
        result = await send_chat_via_gateway(response_back, requester_session)
        if result.get("ok"):
            log.info(f"✅ Response forwarded back to {requester}")

            # Push response-back event to Mission Control
            routing_event = {
                "type": "event",
                "event": "routing",
                "payload": {
                    "from": responder_agent,
                    "to": requester,
                    "task": f"[Response] {response_text[:150]}",
                    "sessionKey": requester_session,
                    "swarm": True,
                    "response_back": True,
                },
                "ts": datetime.utcnow().isoformat() + "Z",
            }
            _broadcast_to_mc(routing_event)
        else:
            error = result.get("payload", {}).get("error", result)
            log.warning(f"❌ Response-back to {requester} failed: {error}")
    except Exception as e:
        log.warning(f"❌ Response-back dispatch error: {e}")


async def _dispatch_telegram_to_specialist(
    text: str, agent_id: str, session_key: str
):
    """
    Route a Telegram message to a specific agent via gateway chat.send.

    The bridge is the sole Telegram handler — Docker Telegram is disabled.
    Classifies the message and routes to the best specialist (or Orchestrator
    as fallback). The agent's response is forwarded back to Telegram via the
    lifecycle "end" handler with an agent name prefix.
    """
    try:
        result = await send_chat_via_gateway(text, session_key)
        if result.get("ok"):
            log.info(f"✅ Telegram message routed to {agent_id} (tracking {session_key})")
            # Track this session key so only the specialist's lifecycle "start" gets linked
            _pending_forward_sessions.add(session_key)

            # Push routing event to MC dashboard
            routing_event = {
                "type": "event",
                "event": "routing",
                "payload": {
                    "from": "bridge-classifier",
                    "to": agent_id,
                    "task": text[:200],
                    "sessionKey": session_key,
                    "source": "telegram",
                },
                "ts": datetime.utcnow().isoformat() + "Z",
            }
            _broadcast_to_mc(routing_event)
        else:
            error = result.get("payload", {}).get("error", result)
            log.warning(f"❌ Telegram routing to {agent_id} failed: {error}")
    except Exception as e:
        log.warning(f"❌ Telegram routing dispatch error: {e}")


# Agent identity map for Telegram prefixes
_AGENT_DISPLAY = {
    "mc-orchestrator": ("🎯", "Orchestrator"),
    "mc-builder": ("🦞", "Builder"),
    "mc-architect": ("🏗️", "Architect"),
    "mc-social": ("📣", "Social"),
}

# sendMessageDraft: track active drafts per runId
# Maps runId -> draft_id (int) for streaming updates
_active_drafts: dict = {}  # runId -> draft_id
_draft_counter: int = 0    # monotonically increasing draft_id
_draft_last_sent: dict = {}  # runId -> timestamp of last draft sent
_DRAFT_THROTTLE_SEC: float = 1.0  # minimum seconds between draft updates


def _resolve_agent_from_session_key(session_key: str) -> Optional[str]:
    """Extract agent ID from sessionKey format 'agent:<id>:main'."""
    if session_key and session_key.startswith("agent:"):
        parts = session_key.split(":")
        if len(parts) >= 2:
            return parts[1]
    return None


async def _send_message_draft(chat_id: str, draft_id: int, text: str):
    """
    Stream a partial message to Telegram using sendMessageDraft.
    Shows a "typing draft" bubble that updates as the agent generates text.
    """
    if not TELEGRAM_BOT_TOKEN:
        return
    tg_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessageDraft"
    tg_body = {
        "chat_id": int(chat_id),
        "draft_id": draft_id,
        "text": text,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(tg_url, json=tg_body)
            if resp.status_code != 200:
                data = resp.json()
                if not data.get("ok"):
                    log.debug(f"sendMessageDraft failed: {data.get('description', resp.status_code)}")
    except Exception as e:
        log.debug(f"sendMessageDraft error: {e}")


async def _forward_response_to_telegram(text: str, agent_id: Optional[str] = None):
    """
    Forward the agent's response to Telegram so the conversation is
    visible there even when the message was sent from Mission Control.
    Only called for MC-originated messages (not Telegram ones, to avoid
    double-posting since the bot already responds on Telegram natively).

    Prefixes the message with the agent's emoji + name so the user can
    see which specialist handled the task.
    """
    if not TELEGRAM_BOT_TOKEN:
        return
    chat_id = TELEGRAM_DEFAULT_CHAT_ID
    if not chat_id:
        return

    # Prefix with agent identity
    if agent_id and agent_id in _AGENT_DISPLAY:
        emoji, name = _AGENT_DISPLAY[agent_id]
        prefixed_text = f"{emoji} *{name}*\n{text}"
    else:
        prefixed_text = text

    tg_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    tg_body = {"chat_id": chat_id, "text": prefixed_text, "parse_mode": "Markdown"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(tg_url, json=tg_body)
            tg_data = resp.json()
        if resp.status_code == 200 and tg_data.get("ok"):
            log.info(f"Response forwarded to Telegram ({len(text)} chars, agent={agent_id})")
        else:
            # Retry without Markdown if parse fails
            tg_body["text"] = prefixed_text
            tg_body.pop("parse_mode", None)
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(tg_url, json=tg_body)
            log.info(f"Response forwarded to Telegram (plain, {len(text)} chars)")
    except Exception as e:
        log.warning(f"Failed to forward response to Telegram: {e}")


async def gateway_event_loop():
    """
    Listen to Gateway events and forward them to dashboard clients.

    This runs as a background task and handles reconnection automatically.
    It connects directly to the Gateway WebSocket from the host.
    """
    global gateway_ws, gateway_connected

    while True:
        # Connect if not connected
        if gateway_ws is None or not gateway_connected:
            gateway_connected = False
            success = await connect_to_gateway()
            if not success:
                log.info(f"Gateway reconnect in {RECONNECT_DELAY_SEC}s...")
                await asyncio.sleep(RECONNECT_DELAY_SEC)
                continue

            log.info("Gateway listener active.")

        # Listen for events
        try:
            async for raw in gateway_ws:
                try:
                    data = json.loads(raw)
                    msg_type = data.get("type", "")

                    # Debug: log every message type received
                    event_type_dbg = data.get("event", "")
                    if event_type_dbg != "tick":
                        log.info(f"Gateway [{msg_type}/{event_type_dbg}] data={json.dumps(data.get('payload', data.get('data', {})), default=str)[:150]}")

                    if msg_type == "event":
                        event_type = data.get("event", "")
                        payload = data.get("payload", {})

                        # Skip tick events (just keepalive)
                        if event_type == "tick":
                            continue

                        # Capture assistant response text from streaming events
                        # Pattern: agent events with stream="assistant" carry data.text
                        # When stream="lifecycle" phase="end", the response is complete
                        run_id = payload.get("runId", "")
                        stream_type = payload.get("stream", "")

                        if event_type == "agent" and stream_type == "assistant":
                            # Streaming response chunk — save latest full text
                            resp_data = payload.get("data", {})
                            full_text = resp_data.get("text", "") if isinstance(resp_data, dict) else ""
                            if full_text and run_id:
                                _assistant_stream_text[run_id] = full_text

                                # sendMessageDraft: stream partial text to Telegram
                                # For MC-originated and TG-routed specialist runs.
                                # Throttled to avoid Telegram 429 rate limits.
                                is_tracked = run_id in _forward_run_ids
                                if is_tracked and run_id in _active_drafts:
                                    now = time.monotonic()
                                    last = _draft_last_sent.get(run_id, 0)
                                    if now - last >= _DRAFT_THROTTLE_SEC:
                                        _draft_last_sent[run_id] = now
                                        sk = payload.get("sessionKey", "")
                                        aid = _resolve_agent_from_session_key(sk)
                                        if aid and aid in _AGENT_DISPLAY:
                                            emoji, name = _AGENT_DISPLAY[aid]
                                            draft_text = f"{emoji} {name}\n{full_text}"
                                        else:
                                            draft_text = full_text
                                        if TELEGRAM_DEFAULT_CHAT_ID:
                                            asyncio.create_task(
                                                _send_message_draft(
                                                    TELEGRAM_DEFAULT_CHAT_ID,
                                                    _active_drafts[run_id],
                                                    draft_text[:4096],  # Telegram limit
                                                )
                                            )

                        elif event_type == "agent" and stream_type == "lifecycle":
                            phase = (payload.get("data", {}) or {}).get("phase", "")

                            # Track runs for Telegram forwarding.
                            # When a lifecycle "start" fires, check if its sessionKey
                            # matches a pending forward target. This ensures only the
                            # TARGET agent's run is tracked (not the Orchestrator
                            # processing the same Telegram message).
                            if phase == "start" and run_id:
                                event_sk = payload.get("sessionKey", "")
                                log.info(f"Lifecycle start: sk={event_sk} run={run_id[:12]}")

                                # Telegram→MC: if this is a Telegram session,
                                # read the user message from Docker and forward to MC
                                if "telegram" in event_sk:
                                    asyncio.create_task(
                                        _emit_telegram_user_message_to_mc(event_sk, run_id)
                                    )

                                # Track kanban task for auto-complete
                                if event_sk in _pending_kanban_sessions:
                                    _kanban_run_ids[run_id] = _pending_kanban_sessions.pop(event_sk)
                                elif event_sk not in _pending_forward_sessions:
                                    # Untracked run = cron job or self-initiated
                                    # Auto-create a kanban task + forward to Telegram
                                    _cron_agent = _resolve_agent_from_session_key(event_sk)
                                    if _cron_agent and _cron_agent in _ALL_AGENTS:
                                        try:
                                            _cron_tid = str(uuid.uuid4())
                                            _cron_title = f"[cron] {_cron_agent} run"
                                            _now_ms = int(time.time() * 1000)
                                            _db = _get_mc_db()
                                            _db.execute(
                                                "INSERT INTO tasks (id, title, description, status, assignee, priority, created_at, updated_at, completed_at) "
                                                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                                (_cron_tid, _cron_title, "", "in_progress", _cron_agent, 0, _now_ms, _now_ms, None),
                                            )
                                            _db.commit()
                                            _db.close()
                                            _kanban_run_ids[run_id] = _cron_tid
                                            log.info(f"📋 Auto-created kanban task for cron/auto run: {_cron_agent}")
                                            _te = {
                                                "type": "event",
                                                "event": "task_update",
                                                "payload": {"action": "created", "task_id": _cron_tid, "title": _cron_title, "assignee": _cron_agent, "from": "cron"},
                                                "ts": datetime.utcnow().isoformat() + "Z",
                                            }
                                            _broadcast_to_mc(_te)
                                        except Exception as _dbe:
                                            log.warning(f"Failed to auto-create cron kanban: {_dbe}")

                                        # Also forward cron results to Telegram
                                        _forward_run_ids.add(run_id)
                                        log.info(f"📲 Cron run tracked for TG forwarding: {_cron_agent} run_id={run_id[:12]}")

                                if event_sk in _pending_forward_sessions:
                                    _pending_forward_sessions.discard(event_sk)
                                    _forward_run_ids.add(run_id)
                                    global _draft_counter
                                    _draft_counter += 1
                                    _active_drafts[run_id] = _draft_counter
                                    log.info(
                                        f"Run tracked for TG forwarding: {run_id[:12]} "
                                        f"session={event_sk} (draft_id={_draft_counter})"
                                    )

                            if phase == "end" and run_id:
                                final_text = _assistant_stream_text.pop(run_id, "")

                                if final_text:
                                    # Forward response to Telegram if this run was tracked
                                    session_key = payload.get("sessionKey", "")
                                    resp_agent_id = _resolve_agent_from_session_key(session_key)
                                    if run_id in _forward_run_ids:
                                        _forward_run_ids.discard(run_id)
                                        _active_drafts.pop(run_id, None)
                                        _draft_last_sent.pop(run_id, None)
                                        log.info(
                                            f"Forwarding response to Telegram "
                                            f"({len(final_text)} chars, agent={resp_agent_id})"
                                        )
                                        asyncio.create_task(
                                            _forward_response_to_telegram(final_text, resp_agent_id)
                                        )
                                        # Refresh conversation memory — agent just responded,
                                        # so follow-ups should continue going to this agent.
                                        if resp_agent_id:
                                            _tg_conversation["agent_id"] = resp_agent_id
                                            _tg_conversation["session_key"] = session_key
                                            _tg_conversation["updated_at"] = time.monotonic()

                                    # Forward agent response to MC chat panel
                                    # so the dashboard shows both sides of the conversation.
                                    # Wrapped as {type: "event", event: "chat", payload: ...}
                                    # to match the frontend EventHandler dispatch format.
                                    _mc_chat_event = {
                                        "type": "event",
                                        "event": "chat",
                                        "payload": {
                                            "role": "assistant",
                                            "agentId": resp_agent_id or "unknown",
                                            "text": final_text,
                                            "runId": run_id,
                                            "sessionKey": session_key,
                                            "state": "final",
                                            "source": "bridge",
                                        },
                                    }
                                    _broadcast_to_mc(_mc_chat_event)
                                    log.info(
                                        f"Agent response broadcast to MC chat "
                                        f"({len(final_text)} chars, agent={resp_agent_id})"
                                    )

                                    # Swarm routing: if ANY agent's response
                                    # contains @agent <id>, dispatch the task
                                    # to that agent (peer-to-peer swarm).
                                    asyncio.create_task(
                                        _dispatch_agent_routing(final_text, session_key)
                                    )
                                    # Response-back: if this agent was dispatched
                                    # a task by another agent, forward the result
                                    # back to the requester (synthesis loop).
                                    asyncio.create_task(
                                        _dispatch_response_back(final_text, session_key)
                                    )

                                    # Auto-complete kanban task when agent finishes
                                    _kanban_tid = _kanban_run_ids.pop(run_id, None)
                                    if _kanban_tid:
                                        try:
                                            _now_ms = int(time.time() * 1000)
                                            _db = _get_mc_db()
                                            _db.execute(
                                                "UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?",
                                                (_now_ms, _now_ms, _kanban_tid),
                                            )
                                            _db.commit()
                                            _db.close()
                                            log.info(f"✅ Auto-completed kanban task {_kanban_tid[:8]}...")
                                            _te = {
                                                "type": "event",
                                                "event": "task_update",
                                                "payload": {"action": "completed", "task_id": _kanban_tid, "agent": resp_agent_id},
                                                "ts": datetime.utcnow().isoformat() + "Z",
                                            }
                                            _broadcast_to_mc(_te)
                                        except Exception as _dbe:
                                            log.warning(f"Failed to auto-complete kanban: {_dbe}")

                            # Lifecycle error: mark kanban task as failed
                            if phase == "error" and run_id:
                                _fail_tid = _kanban_run_ids.pop(run_id, None)
                                if _fail_tid:
                                    try:
                                        _now_ms = int(time.time() * 1000)
                                        _err_msg = (payload.get("data", {}) or {}).get("error", "Unknown error")
                                        _db = _get_mc_db()
                                        _db.execute(
                                            "UPDATE tasks SET status = 'failed', description = ?, updated_at = ? WHERE id = ?",
                                            (str(_err_msg)[:2000], _now_ms, _fail_tid),
                                        )
                                        _db.commit()
                                        _db.close()
                                        _fail_agent = _resolve_agent_from_session_key(payload.get("sessionKey", ""))
                                        log.info(f"❌ Auto-failed kanban task {_fail_tid[:8]}...")
                                        _te = {
                                            "type": "event",
                                            "event": "task_update",
                                            "payload": {"action": "failed", "task_id": _fail_tid, "agent": _fail_agent, "error": str(_err_msg)[:200]},
                                            "ts": datetime.utcnow().isoformat() + "Z",
                                        }
                                        _broadcast_to_mc(_te)
                                    except Exception as _dbe:
                                        log.warning(f"Failed to mark kanban as failed: {_dbe}")

                        # Log events at INFO for debugging
                        if event_type == "chat":
                            log.info(f"Gateway [chat] payload keys={list(payload.keys())}, preview={str(payload)[:300]}")
                        elif event_type == "agent" and stream_type in ("tool", "lifecycle", "chat"):
                            log.info(f"Gateway [agent/{stream_type}] data={str(payload.get('data',{}))[:300]}")
                        elif event_type == "agent" and stream_type == "assistant":
                            # Only log first assistant event per run (not every delta)
                            pass
                        elif event_type != "health":
                            action = payload.get("action", "")
                            log.info(f"Gateway [{event_type}] stream={stream_type} action={action} keys={list(payload.keys())} data_keys={list((payload.get('data') or {}).keys())}")

                        # Forward raw event to mission control dashboard clients
                        if event_type != "tick":
                            mc_event = {
                                "type": "event",
                                "event": event_type,
                                "payload": payload,
                                "ts": datetime.utcnow().isoformat() + "Z",
                            }
                            _gateway_event_buffer.append(mc_event)
                            if len(_gateway_event_buffer) > _GATEWAY_EVENT_BUFFER_MAX:
                                _gateway_event_buffer.pop(0)
                            # Broadcast to mission control clients (non-blocking)
                            _broadcast_to_mc(mc_event)

                    elif msg_type == "res":
                        # Response to a request we sent (e.g. status query)
                        pass

                    else:
                        # Log non-event/non-res message types (might find chat here)
                        log.info(f"Gateway non-event msg: type={msg_type}, keys={list(data.keys())}, preview={str(data)[:200]}")

                except json.JSONDecodeError:
                    log.warning(f"Invalid JSON from Gateway: {raw[:100]}")
                except Exception as e:
                    log.error(f"Error processing Gateway event: {e}")

        except websockets.exceptions.ConnectionClosed as e:
            log.warning(f"Gateway connection closed: {e}")
        except Exception as e:
            log.error(f"Gateway listener error: {e}")

        # Connection lost -- reset and retry
        gateway_ws = None
        gateway_connected = False

        log.info(f"Gateway reconnect in {RECONNECT_DELAY_SEC}s...")
        await asyncio.sleep(RECONNECT_DELAY_SEC)


# ---------------------------------------------------------------------------
# Telegram session watcher — tail Docker session file for user messages
# ---------------------------------------------------------------------------

def _extract_user_text(raw_content: str) -> Optional[str]:
    """
    Extract the actual user message from OpenClaw session content.

    Session user messages can have several formats:

    1. Simple with metadata header:
       Conversation info (untrusted metadata):
       ```json
       {"timestamp":"..."}
       ```

       <actual user text here>

    2. System exec results prepended + metadata + user text:
       System: [timestamp] Exec completed ...
       ...
       Conversation info (untrusted metadata):
       ```json
       {"timestamp":"..."}
       ```

       <actual user text here>

    3. Pure system messages (no user text after metadata):
       System: [timestamp] Exec completed ...
       (no Conversation info block — skip these entirely)

    We always try to extract text AFTER the last metadata code block.
    Only return None if there's genuinely no user text.
    """
    if not raw_content:
        return None

    text = raw_content

    # Find the LAST "Conversation info" metadata block and extract text after it.
    # This handles cases where System: exec results are prepended before the
    # metadata block, with the actual user message at the end.
    marker = "```\n\n"
    last_json_idx = text.rfind("```json")
    if last_json_idx != -1:
        end = text.find(marker, last_json_idx)
        if end != -1:
            text = text[end + len(marker):]
        else:
            # Try: find the closing ``` after the ```json block
            close_idx = text.find("```", last_json_idx + 7)
            if close_idx != -1:
                text = text[close_idx + 3:]

    # If no metadata block found at all, check if it's a pure System message
    elif text.startswith("System:"):
        return None

    text = text.strip()
    return text if text else None


# Track session keys we already forwarded a user message for (avoid duplicates)
_tg_forwarded_runs: set = set()


async def _emit_telegram_user_message_to_mc(session_key: str, run_id: str):
    """
    When Docker handles Telegram directly, the gateway emits lifecycle events
    but NOT the user's incoming message as a chat event. This function reads
    the user's message from the session JSONL inside Docker and broadcasts
    a synthetic chat event to Mission Control clients.
    """
    # Deduplicate by run_id (not session_key — session_key is the same for all
    # messages from the same Telegram user, so using it would skip all but the first)
    if run_id in _tg_forwarded_runs:
        return
    _tg_forwarded_runs.add(run_id)
    # Keep the set bounded
    if len(_tg_forwarded_runs) > 500:
        _tg_forwarded_runs.clear()

    agent_id = _resolve_agent_from_session_key(session_key)
    log.info(f"📩 TG→MC: attempting to read user message (sk={session_key}, run={run_id[:12]}, agent={agent_id})")

    try:
        # Find the session file inside Docker
        # Session keys are like "agent:orchestrator:telegram:direct:<CHAT_ID>"
        # Split to get the agent directory name
        parts = session_key.split(":")
        agent_dir = parts[1] if len(parts) > 1 else "mc-orchestrator"
        sessions_dir = f"/home/node/.openclaw/agents/{agent_dir}/sessions"

        proc = await asyncio.create_subprocess_exec(
            DOCKER_BIN, "exec", DOCKER_CONTAINER,
            "cat", f"{sessions_dir}/sessions.json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        if proc.returncode != 0:
            log.warning(f"📩 TG→MC: sessions.json read failed (rc={proc.returncode}, err={stderr.decode()[:200]})")
            return
        sessions = json.loads(stdout.decode())
        log.info(f"📩 TG→MC: sessions.json has {len(sessions)} entries, looking for key='{session_key}'")

        # Find matching session — the key in sessions.json uses "session:" prefix
        session_id = None
        # First try exact match with "session:" prefix
        session_sk = "session:" + session_key
        for key, info in sessions.items():
            if (key == session_key or key == session_sk) and info.get("sessionId"):
                session_id = info["sessionId"]
                break

        if not session_id:
            # Try matching by partial key (telegram + user ID)
            _tg_chat_id = os.environ.get("TELEGRAM_DEFAULT_CHAT_ID")
            for key, info in sessions.items():
                if "telegram" in key and _tg_chat_id and _tg_chat_id in key and info.get("sessionId"):
                    session_id = info["sessionId"]
                    log.info(f"📩 TG→MC: partial match key='{key}' -> sessionId={session_id}")
                    break

        if not session_id:
            # Log all keys to help debug
            all_keys = list(sessions.keys())[:10]
            log.warning(f"📩 TG→MC: No session found. Available keys: {all_keys}")
            return

        # Read last 5 lines of the session JSONL
        session_file = f"{sessions_dir}/{session_id}.jsonl"
        proc2 = await asyncio.create_subprocess_exec(
            DOCKER_BIN, "exec", DOCKER_CONTAINER,
            "tail", "-5", session_file,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout2, _ = await asyncio.wait_for(proc2.communicate(), timeout=10)

        # Parse JSONL lines, find the last user message
        # Format: {type: "message", message: {role: "user", content: [...]}}
        user_text = None
        for line in stdout2.decode().strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                # Handle nested format: {type: "message", message: {role, content}}
                msg = entry.get("message", entry)
                role = msg.get("role", "")
                if role == "user":
                    # Extract text from content blocks
                    content = msg.get("content", [])
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "text":
                                raw_text = block.get("text", "")
                                # Strip OpenClaw's metadata prefix blocks
                                # Format: "Conversation info...\n```json\n{...}\n```\nSender...\n```json\n{...}\n```\n\nActual message"
                                if "```" in raw_text:
                                    # The actual user message is AFTER the last ``` block
                                    parts = raw_text.split("```")
                                    user_text = parts[-1].strip()
                                    if not user_text:
                                        # Fallback: try second-to-last
                                        user_text = raw_text
                                else:
                                    user_text = raw_text
                    elif isinstance(content, str):
                        user_text = content
            except json.JSONDecodeError:
                continue

        if not user_text:
            log.warning(f"📩 TG→MC: No user message found in session {session_key}")
            return

        log.info(f"📩 Telegram→MC: '{user_text[:80]}' (session={session_key})")

        # Broadcast synthetic chat event to Mission Control
        mc_event = {
            "type": "event",
            "event": "chat",
            "payload": {
                "sessionKey": session_key,
                "runId": run_id,
                "state": "final",
                "message": {
                    "role": "user",
                    "content": [{"type": "text", "text": user_text}],
                },
            },
            "ts": datetime.utcnow().isoformat() + "Z",
            "source": "telegram",
        }
        _broadcast_to_mc(mc_event)

    except Exception as e:
        log.warning(f"Failed to emit Telegram user message to MC: {e}")


async def _discover_telegram_session_file() -> Optional[str]:
    """
    Read sessions.json inside Docker to find the Telegram session file path.
    Returns the full path inside the container, or None.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            DOCKER_BIN, "exec", DOCKER_CONTAINER,
            "cat", f"{SESSIONS_DIR}/sessions.json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        sessions = json.loads(stdout.decode())

        # Find the Telegram session key
        for key, info in sessions.items():
            if "telegram" in key and info.get("sessionId"):
                session_file = f"{SESSIONS_DIR}/{info['sessionId']}.jsonl"
                log.info(f"Telegram session file: {session_file} (key={key})")
                return session_file

        log.warning("No Telegram session found in sessions.json")
        return None
    except Exception as e:
        log.warning(f"Failed to discover Telegram session file: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Telegram → Mission Control mirror via gateway log tail
#
# When the gateway processes Telegram messages internally (channels.telegram
# enabled in openclaw.json), it does NOT broadcast lifecycle/chat events over
# the WebSocket protocol. The bridge therefore can't catch user messages on
# either gateway_ws or chat_ws — confirmed by zero `event/agent` events
# arriving on either connection during a Telegram-originated run.
#
# The gateway DOES write a structured JSON line to /tmp/openclaw/openclaw-*.log
# whenever Telegram delivers an inbound update, under the
# `gateway/channels/telegram/raw-update` subsystem. This loop tails that file
# inside the Docker container, parses each line, filters for raw-updates, and
# broadcasts a synthetic chat event to MC clients so the operator sees the
# inbound Telegram message in the dashboard chat panel.
#
# Dedup is keyed on Telegram's `update_id` to avoid replaying messages on
# bridge restart (the tail starts at -n 0 so only NEW lines are read).
# ─────────────────────────────────────────────────────────────────────────────

_tg_log_seen_update_ids: set = set()
_tg_log_seen_msg_done_ids: set = set()  # dedup by Telegram inbound messageId for agent-reply mirroring


async def _read_latest_assistant_reply(session_key: str) -> Optional[str]:
    """
    Read the agent's session JSONL inside Docker and return the most recent
    assistant text. Used to surface a Telegram-handled agent reply on the
    dashboard since those runs do not emit chat events over the WS.
    """
    try:
        parts = session_key.split(":")
        agent_dir = parts[1] if len(parts) > 1 else "orchestrator"
        sessions_dir = f"/home/node/.openclaw/agents/{agent_dir}/sessions"

        # Resolve the sessionId for this sessionKey via sessions.json
        proc = await asyncio.create_subprocess_exec(
            DOCKER_BIN, "exec", DOCKER_CONTAINER,
            "cat", f"{sessions_dir}/sessions.json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        if proc.returncode != 0:
            return None
        sessions = json.loads(stdout.decode())

        session_id = None
        for key, info in sessions.items():
            if (key == session_key or key == "session:" + session_key) and info.get("sessionId"):
                session_id = info["sessionId"]
                break
        if not session_id:
            # Fallback: any session matching the chat-id portion
            chat_part = parts[-1] if parts else ""
            for key, info in sessions.items():
                if "telegram" in key and chat_part and chat_part in key and info.get("sessionId"):
                    session_id = info["sessionId"]
                    break
        if not session_id:
            return None

        # Read the JSONL and find the LAST line with role=assistant
        proc2 = await asyncio.create_subprocess_exec(
            DOCKER_BIN, "exec", DOCKER_CONTAINER,
            "tail", "-n", "200", f"{sessions_dir}/{session_id}.jsonl",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout2, _ = await asyncio.wait_for(proc2.communicate(), timeout=10)
        if proc2.returncode != 0:
            return None

        # Parse the session JSONL. Each line has the shape
        #   {"type":"message", "message": {"role":"assistant"|"user"|"toolResult",
        #     "content": [{"type":"text","text":"..."}, {"type":"thinking",...},
        #                 {"type":"toolCall",...}], ...}}
        # We want the LAST assistant turn whose content has at least one
        # text block (skipping thinking-only and tool-call-only turns).
        latest_assistant_text = None
        for line in stdout2.decode("utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Support both nested ({"type":"message","message":{...}}) and flat
            # ({"role":"assistant",...}) shapes.
            inner_msg = row.get("message") if isinstance(row.get("message"), dict) else row
            role = inner_msg.get("role", "")
            if role != "assistant":
                continue

            content = inner_msg.get("content")
            text = ""
            if isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    btype = block.get("type", "")
                    if btype == "text":
                        text += block.get("text", "")
                    # Skip thinking, toolCall, and other non-text blocks
            elif isinstance(content, str):
                text = content
            elif isinstance(inner_msg.get("text"), str):
                text = inner_msg["text"]

            text = text.strip()
            if not text:
                continue

            # Strip the appended model-report footer that the agent's session
            # skill emits at the end of every reply (matches the cleanup that
            # _forward_response_to_telegram does before sending to TG).
            text = re.sub(r'(?m)^node\s+skills/.*$', '', text)
            text = re.sub(r'📊\s*Model\s*\(effective\):.*$', '', text, flags=re.MULTILINE)
            text = text.strip()

            if text:
                latest_assistant_text = text
        return latest_assistant_text
    except Exception as e:
        log.warning("read latest assistant reply failed: %s", e)
        return None


async def _emit_telegram_agent_reply_to_mc(session_key: str, message_id: int):
    """
    Resolve the agent's most recent assistant reply for a Telegram-handled
    run and broadcast it to MC clients as an assistant chat event so the
    dashboard mirrors the Telegram conversation in both directions.
    """
    if message_id in _tg_log_seen_msg_done_ids:
        return
    _tg_log_seen_msg_done_ids.add(message_id)
    if len(_tg_log_seen_msg_done_ids) > 500:
        _tg_log_seen_msg_done_ids.clear()
        _tg_log_seen_msg_done_ids.add(message_id)

    # Small delay so the gateway has time to flush the assistant turn to disk
    await asyncio.sleep(1.5)

    text = await _read_latest_assistant_reply(session_key)
    if not text:
        log.info("📤 TG reply mirror: no assistant text found for sk=%s msgId=%s",
                 session_key, message_id)
        return

    agent_id = _resolve_agent_from_session_key(session_key)
    log.info("📤 TG→MC reply (%d chars, agent=%s, sk=%s)",
             len(text), agent_id, session_key)

    mc_event = {
        "type": "event",
        "event": "chat",
        "payload": {
            "role": "assistant",
            "agentId": agent_id or "orchestrator",
            "text": text,
            "sessionKey": session_key,
            "source": "telegram",
            "state": "final",
        },
    }
    _broadcast_to_mc(mc_event)


async def telegram_log_tail_loop():
    """
    Background task: tail the gateway's daily log file inside Docker for
    Telegram raw-update events and broadcast each as a chat event to MC.
    Restarts on subprocess death with backoff.
    """
    while True:
        proc = None
        try:
            # Tail the most-recent log file (filename includes today's date).
            # `tail -F` follows file rotation. `-n 0` skips backlog so only
            # NEW updates after the bridge starts are mirrored.
            proc = await asyncio.create_subprocess_exec(
                DOCKER_BIN, "exec", DOCKER_CONTAINER,
                "sh", "-c",
                'tail -F -n 0 "$(ls -t /tmp/openclaw/openclaw-*.log 2>/dev/null | head -1)"',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            log.info("📡 Telegram log tail started (container=%s)", DOCKER_CONTAINER)

            async for raw_line in proc.stdout:
                try:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line or not line.startswith("{"):
                        continue

                    entry = json.loads(line)
                    subsystem_str = entry.get("0", "")
                    inner = entry.get("1", "")

                    # Branch B: agent finished processing a Telegram message —
                    # broadcast its reply to MC.  Triggered by diagnostic line:
                    #   "message processed: channel=telegram chatId=... messageId=N
                    #    sessionId=... sessionKey=agent:...:telegram:... outcome=completed"
                    if (
                        "diagnostic" in subsystem_str
                        and isinstance(inner, str)
                        and inner.startswith("message processed:")
                        and "channel=telegram" in inner
                        and "outcome=completed" in inner
                    ):
                        try:
                            sk_pos = inner.find("sessionKey=")
                            mid_pos = inner.find("messageId=")
                            if sk_pos >= 0 and mid_pos >= 0:
                                sk_val = inner[sk_pos + len("sessionKey="):].split()[0].strip()
                                mid_str = inner[mid_pos + len("messageId="):].split()[0].strip()
                                mid_val = int(mid_str) if mid_str.isdigit() else None
                                if sk_val and mid_val is not None:
                                    asyncio.create_task(
                                        _emit_telegram_agent_reply_to_mc(sk_val, mid_val)
                                    )
                        except Exception as parse_err:
                            log.warning("TG reply-mirror trigger parse failed: %s", parse_err)
                        continue

                    if "telegram/raw-update" not in subsystem_str:
                        continue

                    if not isinstance(inner, str):
                        continue

                    json_start = inner.find("{")
                    if json_start < 0:
                        continue

                    update = json.loads(inner[json_start:])
                    update_id = update.get("update_id")
                    msg = update.get("message") or update.get("edited_message") or {}
                    text = msg.get("text", "") or msg.get("caption", "")
                    msg_id = msg.get("message_id")
                    chat = msg.get("chat", {}) or {}
                    chat_id = chat.get("id")
                    from_user = msg.get("from", {}) or {}
                    user_name = (
                        " ".join(filter(None, [from_user.get("first_name", ""), from_user.get("last_name", "")])).strip()
                        or from_user.get("username", "")
                        or "Telegram User"
                    )

                    if update_id is None or update_id in _tg_log_seen_update_ids:
                        continue
                    _tg_log_seen_update_ids.add(update_id)
                    if len(_tg_log_seen_update_ids) > 500:
                        # Bound the dedup set
                        _tg_log_seen_update_ids.clear()
                        _tg_log_seen_update_ids.add(update_id)

                    if not text:
                        continue

                    log.info("📩 TG→MC tail: %s (chat=%s, update=%s) %r",
                             user_name, chat_id, update_id, text[:80])

                    mc_event = {
                        "type": "event",
                        "event": "chat",
                        "payload": {
                            "role": "user",
                            "source": "telegram",
                            "text": text,
                            "chatId": str(chat_id) if chat_id is not None else "",
                            "userName": user_name,
                            "messageId": msg_id,
                            "updateId": update_id,
                            "state": "final",
                        },
                    }
                    _broadcast_to_mc(mc_event)

                except (json.JSONDecodeError, UnicodeDecodeError):
                    pass  # malformed lines — skip silently
                except Exception as parse_err:
                    log.warning("TG log tail parse error: %s", parse_err)

            log.warning("TG log tail subprocess ended; restarting in 5s")
        except asyncio.CancelledError:
            if proc:
                try: proc.terminate()
                except Exception: pass
            raise
        except Exception as e:
            log.warning("TG log tail error: %s; retrying in 5s", e)
        finally:
            if proc:
                try: proc.terminate()
                except Exception: pass
        await asyncio.sleep(5)


async def telegram_polling_loop():
    """
    Poll Telegram Bot API for new messages via getUpdates long-polling.

    The bridge is the SOLE Telegram handler — Docker's Telegram integration
    is disabled (channels.telegram.enabled: false in openclaw.json).

    Flow: getUpdates → classify → route to ONE agent via gateway chat.send →
    agent response forwarded back to Telegram via lifecycle "end" handler.

    This replaces the old telegram_session_watcher() which polled Docker's
    session JSONL file via `docker exec tail`. That approach caused duplicate
    execution: Docker's Telegram plugin delivered to the Orchestrator, while
    the bridge dispatched the same message to a specialist.
    """
    if not TELEGRAM_BOT_TOKEN:
        log.warning("Telegram polling disabled: no TELEGRAM_BOT_TOKEN set")
        return

    await asyncio.sleep(3)  # Let gateway connect first

    poll_timeout = 30  # Long-poll timeout in seconds
    base_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"

    # Seed offset: skip any old/pending updates so bridge restarts don't
    # re-process messages that were already handled before shutdown.
    offset = 0
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{base_url}/getUpdates",
                params={"offset": -1, "limit": 1, "timeout": 0},
            )
            seed = resp.json()
        if seed.get("ok") and seed.get("result"):
            offset = seed["result"][-1]["update_id"] + 1
            log.info(f"Telegram polling: seeded offset={offset} (skipping old updates)")
        else:
            log.info("Telegram polling: no pending updates, starting fresh")
    except Exception as e:
        log.warning(f"Telegram polling: seed failed ({e}), starting from offset=0")

    log.info("Telegram polling loop started (getUpdates, sole handler)")

    while True:
        try:
            params = {
                "offset": offset,
                "timeout": poll_timeout,
                "allowed_updates": ["message"],
            }
            async with httpx.AsyncClient(timeout=poll_timeout + 10) as client:
                resp = await client.get(f"{base_url}/getUpdates", params=params)
                data = resp.json()

            if not data.get("ok"):
                log.warning(f"getUpdates error: {data}")
                await asyncio.sleep(5)
                continue

            for update in data.get("result", []):
                offset = update["update_id"] + 1  # Acknowledge this update

                msg = update.get("message", {})
                chat_id = str(msg.get("chat", {}).get("id", ""))
                user_text = (msg.get("text") or "").strip()

                # Only process messages from the configured operator chat (fail-closed if env var unset)
                if not TELEGRAM_DEFAULT_CHAT_ID or chat_id != TELEGRAM_DEFAULT_CHAT_ID:
                    continue
                if not user_text:
                    continue
                # Skip bot commands like /start, /help
                if user_text.startswith("/"):
                    continue

                log.info(f"📩 Telegram message: '{user_text[:80]}'")

                # Push to Mission Control as synthetic chat event
                mc_event = {
                    "type": "event",
                    "event": "chat",
                    "payload": {
                        "sessionKey": "telegram-incoming",
                        "state": "final",
                        "message": {
                            "role": "user",
                            "content": [{"type": "text", "text": user_text}],
                        },
                    },
                    "ts": datetime.utcnow().isoformat() + "Z",
                    "source": "telegram",
                }
                _broadcast_to_mc(mc_event)

                # Classify and route to ONE agent (no duplicate execution)
                target_agent = _classify_message(user_text)
                if target_agent:
                    # Clear keyword match → route to specialist
                    session_key = f"agent:{target_agent}:main"
                    log.info(
                        f"🎯 Telegram → {target_agent} "
                        f"(session: {session_key}) [keywords]"
                    )
                else:
                    # No keyword match — check conversation memory.
                    # If a specialist recently handled a message, route
                    # follow-ups back to them (e.g. "yes pls do", "ok").
                    conv = _tg_conversation
                    elapsed = time.monotonic() - conv["updated_at"]
                    if conv["agent_id"] and elapsed < CONVERSATION_TTL_SEC:
                        target_agent = conv["agent_id"]
                        session_key = conv["session_key"]
                        log.info(
                            f"🔄 Telegram → {target_agent} "
                            f"(session: {session_key}) "
                            f"[follow-up, {elapsed:.0f}s since last]"
                        )
                    else:
                        # No memory or expired → Orchestrator
                        target_agent = "mc-orchestrator"
                        session_key = "main"
                        log.info("Telegram → Orchestrator (default)")

                # Update conversation memory
                _tg_conversation["agent_id"] = target_agent
                _tg_conversation["session_key"] = session_key
                _tg_conversation["updated_at"] = time.monotonic()

                # Dispatch to gateway — only ONE agent handles this message
                asyncio.create_task(
                    _dispatch_telegram_to_specialist(
                        user_text, target_agent, session_key
                    )
                )

        except asyncio.CancelledError:
            return
        except Exception as e:
            log.warning(f"Telegram polling error: {e}")
            await asyncio.sleep(5)


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global BRIDGE_AUTH_TOKEN

    # Generate a token if none is set
    if not BRIDGE_AUTH_TOKEN:
        BRIDGE_AUTH_TOKEN = secrets.token_urlsafe(32)
        log.warning("=" * 60)
        log.warning("No BRIDGE_AUTH_TOKEN set. Generated a random token.")
        log.warning(f"  Token starts with: {BRIDGE_AUTH_TOKEN[:6]}...")
        log.warning("Set BRIDGE_AUTH_TOKEN env var to use a fixed token.")
        log.warning("=" * 60)

    log.info(f"OpenClaw Bridge v3.0.0 starting on {BRIDGE_HOST}:{BRIDGE_PORT}")

    if not GATEWAY_AUTH_TOKEN:
        log.error("=" * 60)
        log.error("OPENCLAW_GATEWAY_TOKEN is not set!")
        log.error("The bridge needs this to connect to the OpenClaw Gateway.")
        log.error("Find it in openclaw.json -> gateway.auth.token")
        log.error("=" * 60)

    tasks = [
        asyncio.create_task(gateway_event_loop()),       # Listen to Gateway events
        asyncio.create_task(chat_ws_listener()),          # Chat WebSocket (webchat mode)
        # Mirror Telegram-inbound messages to MC dashboard. The gateway
        # processes Telegram internally and does not broadcast WS events for
        # those runs, so we tail the gateway log file inside Docker as the
        # signal source.
        asyncio.create_task(telegram_log_tail_loop()),
        # NOTE: Telegram polling DISABLED here — gateway telegram is enabled in
        # openclaw.json and handles getUpdates natively.  Bridge only relays
        # outbound messages (user chat → TG sendMessage / sendPhoto).
        # asyncio.create_task(telegram_polling_loop()),
    ]
    yield
    for t in tasks:
        t.cancel()
    if gateway_ws:
        await gateway_ws.close()
    if chat_ws:
        await chat_ws.close()
    log.info("Bridge shut down")


app = FastAPI(
    title="Mission Control Bridge",
    version="3.0.0",
    lifespan=lifespan,
)

# SECURITY: Restrict CORS to localhost origins only.
# allow_origin_regex matches any port on localhost/127.0.0.1 (needed for
# the Mission Control desktop app which uses a random port asset server).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$",
    allow_methods=["GET", "POST"],
    allow_headers=["*", "X-Auth-Token"],
)


# ---------------------------------------------------------------------------
# HTTP endpoints (read-only, no auth needed -- localhost only)
# ---------------------------------------------------------------------------
@app.get("/")
async def root():
    return {
        "service": "mission-control-bridge",
        "version": "3.0.0",
        "status": "running",
        "gateway_connected": gateway_connected,
        "connected_robots": len(connected_robots),
    }



# ---------------------------------------------------------------------------
# WebSocket: live dashboard feed
# ---------------------------------------------------------------------------
@app.websocket("/ws/dashboard")
async def ws_dashboard(ws: WebSocket, token: Optional[str] = Query(None)):
    """
    Connect a monitoring dashboard to get a live stream of gateway status.
    """
    if not _check_ws_token(token):
        log.warning(f"Rejected dashboard connection: invalid token from {ws.client}")
        await ws.close(code=4003, reason="Invalid or missing auth token")
        return

    await ws.accept()
    try:
        while True:
            await asyncio.sleep(1.0)
            payload = {
                "gateway_connected": gateway_connected,
                "robots_connected": len(connected_robots),
            }
            await ws.send_json(payload, mode="text")
    except WebSocketDisconnect:
        pass


# ---------------------------------------------------------------------------
# Mission Control: POST /api/chat — relay messages to Telegram bot
# ---------------------------------------------------------------------------
@app.post("/api/chat")
async def api_chat(request: Request):
    """
    Send a chat message to the OpenClaw agent via the Gateway chat.send RPC.
    Falls back to Telegram Bot API relay if gateway chat is unavailable.
    Requires BRIDGE_AUTH_TOKEN in X-Auth-Token header.
    Body: { "text": "message", "session_key": "main" }
    """
    # Auth check
    token = request.headers.get("X-Auth-Token", "")
    if not _check_ws_token(token):
        return JSONResponse(
            status_code=403,
            content={"ok": False, "error": "Invalid or missing auth token"},
        )

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "Invalid JSON body"},
        )

    text = body.get("text", "").strip()
    if not text:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "Missing 'text' field"},
        )

    # (no global needed — _pending_forward_sessions is a mutable set)

    # Determine target session: explicit agent, auto-classify, or default
    target_agent = body.get("target_agent", "").strip()
    routed_by = "explicit"  # tracking who made the routing decision

    if target_agent:
        # User explicitly selected an agent from the dropdown
        session_key = f"agent:{target_agent}:main"
        log.info(f"Routing to agent session (dropdown): {session_key}")
    else:
        # Auto mode: bridge classifies the message and routes to specialist
        classified_agent = _classify_message(text)
        if classified_agent:
            target_agent = classified_agent
            session_key = f"agent:{classified_agent}:main"
            routed_by = "auto-classifier"
            log.info(f"🎯 Auto-routing to {classified_agent} (session: {session_key})")
        else:
            # Ambiguous / simple question → Orchestrator handles it.
            # Use full session key so lifecycle events match for TG forwarding.
            session_key = body.get("session_key", "agent:mc-orchestrator:main")
            routed_by = "default"
            log.info(f"No clear specialist match — using Orchestrator (session: {session_key})")

    chat_id = body.get("chat_id", TELEGRAM_DEFAULT_CHAT_ID)
    gateway_ok = False
    tg_ok = False
    tg_msg_id = None

    # Push routing event to Mission Control dashboard
    if target_agent and routed_by in ("auto-classifier", "explicit"):
        routing_event = {
            "type": "event",
            "event": "routing",
            "payload": {
                "from": "mc-orchestrator",
                "to": target_agent,
                "task": text[:200],
                "method": routed_by,
                "sessionKey": session_key,
            },
            "ts": datetime.utcnow().isoformat() + "Z",
        }
        _broadcast_to_mc(routing_event)

    # Auto-create kanban task for messages sent to agents
    kanban_task_id = None
    resolved_agent = target_agent or _resolve_agent_from_session_key(session_key)
    if resolved_agent and resolved_agent in _ALL_AGENTS:
        try:
            kanban_task_id = str(uuid.uuid4())
            task_title = text[:120].split('\n')[0]
            now_ms = int(time.time() * 1000)
            db = _get_mc_db()
            db.execute(
                "INSERT INTO tasks (id, title, description, status, assignee, priority, created_at, updated_at, completed_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (kanban_task_id, task_title, text[:2000], "in_progress", resolved_agent, 0, now_ms, now_ms, None),
            )
            db.commit()
            db.close()
            log.info(f"📋 Auto-created kanban task for chat: '{task_title[:60]}' -> {resolved_agent}")

            # Push task_update to MC so kanban refreshes live
            task_event = {
                "type": "event",
                "event": "task_update",
                "payload": {
                    "action": "created",
                    "task_id": kanban_task_id,
                    "title": task_title,
                    "assignee": resolved_agent,
                    "from": "user",
                },
                "ts": datetime.utcnow().isoformat() + "Z",
            }
            _broadcast_to_mc(task_event)
            # Track session so we can auto-complete when the agent responds
            if kanban_task_id:
                _pending_kanban_sessions[session_key] = kanban_task_id
        except Exception as db_err:
            log.warning(f"Failed to auto-create kanban task for chat: {db_err}")

    # Extract optional image attachment from body
    attachment = body.get("attachment")
    if attachment:
        # Validate: must be an image with data URL, cap at ~10 MB base64
        att_type = attachment.get("type", "")
        att_data = attachment.get("data", "")
        if att_type != "image" or not att_data.startswith("data:image/"):
            attachment = None
            log.warning("Invalid attachment (not an image data URL) — ignoring")
        elif len(att_data) > 14_000_000:  # ~10 MB decoded
            attachment = None
            log.warning("Attachment too large (>10 MB) — ignoring")
        else:
            log.info(f"Image attachment: {attachment.get('filename', 'unknown')} ({len(att_data)//1024} KB base64)")

    # 1. Send via Gateway chat.send RPC (agent processes the message)
    if chat_ws_connected:
        try:
            result = await send_chat_via_gateway(text, session_key, attachment=attachment)
            if result.get("ok"):
                log.info(f"Chat sent via gateway ({routed_by}): '{text[:80]}'")
                gateway_ok = True
                # Track this session key so the response gets forwarded to Telegram
                _pending_forward_sessions.add(session_key)
                log.info(f"Tracking session for TG forwarding: {session_key}")
            else:
                error = result.get("payload", {}).get("error", result)
                log.warning(f"Gateway chat.send failed: {error}")
        except Exception as e:
            log.warning(f"Gateway chat.send error: {e}")

    # 2. Relay user message to Telegram so the conversation is visible there.
    #    Note: Bot API can only send as the bot, so we style it clearly as a
    #    user relay (italic) to distinguish from bot-generated responses.
    #    If an image is attached, send it as a photo with the text as caption.
    tg_ok = False
    if TELEGRAM_BOT_TOKEN and chat_id:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                if attachment and attachment.get("data", "").startswith("data:image/"):
                    # Send image as photo with caption
                    import base64 as _b64
                    data_url = attachment["data"]
                    # Parse "data:image/png;base64,..." format
                    header, b64_data = data_url.split(",", 1) if "," in data_url else ("", "")
                    mime = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
                    ext = mime.split("/")[-1].replace("jpeg", "jpg")
                    img_bytes = _b64.b64decode(b64_data)
                    caption = f"\U0001f4f1 <i>{text}</i>" if text else "\U0001f4f1 <i>(screenshot)</i>"
                    files = {"photo": (f"image.{ext}", img_bytes, mime)}
                    data = {"chat_id": chat_id, "caption": caption[:1024], "parse_mode": "HTML"}
                    tg_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
                    resp = await client.post(tg_url, data=data, files=files)
                else:
                    # Text-only relay
                    tg_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
                    tg_body = {
                        "chat_id": chat_id,
                        "text": f"\U0001f4f1 <i>{text}</i>",
                        "parse_mode": "HTML",
                    }
                    resp = await client.post(tg_url, json=tg_body)
                tg_data = resp.json()
            if resp.status_code == 200 and tg_data.get("ok"):
                tg_ok = True
                log.info(f"Chat relayed to Telegram: '{text[:80]}'" + (" [+image]" if attachment else ""))
            else:
                log.warning(f"Telegram relay failed: {tg_data.get('description', resp.status_code)}")
        except Exception as e:
            log.warning(f"Telegram relay error: {e}")

    if gateway_ok or tg_ok:
        resp = {
            "ok": True,
            "method": "gateway+telegram" if (gateway_ok and tg_ok) else ("gateway" if gateway_ok else "telegram"),
            "routed_by": routed_by,
        }
        if target_agent:
            resp["routed_to"] = target_agent
        return resp
    else:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "error": "Neither gateway nor Telegram available"},
        )


# ---------------------------------------------------------------------------
# Mission Control V2: SQLite persistence + new API endpoints
# ---------------------------------------------------------------------------
import sqlite3 as _sqlite3
import glob as _glob

_CONFIG_DIR = os.path.join(_BRIDGE_DIR, "..", "config")
_MC_DB_PATH = os.path.join(_CONFIG_DIR, "canvas", "mission-control.db")


def _get_mc_db():
    """Get a SQLite connection to the Mission Control database."""
    db = _sqlite3.connect(_MC_DB_PATH)
    db.row_factory = _sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    return db


def _init_mc_db():
    """Create Mission Control tables if they don't exist."""
    db = _get_mc_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'todo',
            assignee TEXT DEFAULT '',
            priority INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            completed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS task_dependencies (
            task_id TEXT NOT NULL,
            depends_on TEXT NOT NULL,
            PRIMARY KEY (task_id, depends_on),
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
            FOREIGN KEY (depends_on) REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL,
            agent_id TEXT,
            text TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS feed_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT,
            action TEXT NOT NULL,
            detail TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        );

        /* ── Paperclip Feature Pack tables ─────────────────────────────── */

        /* Goals: higher-level objectives that contain multiple tasks */
        CREATE TABLE IF NOT EXISTS goals (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            completed_at INTEGER
        );

        /* Cost events: individual token usage records */
        CREATE TABLE IF NOT EXISTS cost_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL,
            model TEXT NOT NULL DEFAULT '',
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cost_cents REAL NOT NULL DEFAULT 0.0,
            timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cost_events_ts ON cost_events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_cost_events_agent ON cost_events(agent_id);

        /* Cost daily rollups: pre-aggregated per-day summary */
        CREATE TABLE IF NOT EXISTS cost_daily (
            date TEXT NOT NULL,
            agent_id TEXT NOT NULL DEFAULT '',
            total_cents REAL NOT NULL DEFAULT 0.0,
            total_input_tokens INTEGER NOT NULL DEFAULT 0,
            total_output_tokens INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (date, agent_id)
        );

        /* Activity hourly: per-hour event counts per agent */
        CREATE TABLE IF NOT EXISTS activity_hourly (
            date TEXT NOT NULL,
            hour INTEGER NOT NULL,
            agent_id TEXT NOT NULL,
            event_count INTEGER NOT NULL DEFAULT 0,
            active_minutes REAL NOT NULL DEFAULT 0.0,
            PRIMARY KEY (date, hour, agent_id)
        );

        /* Audit log: records all significant actions */
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_type TEXT NOT NULL DEFAULT 'system',
            actor_id TEXT NOT NULL DEFAULT '',
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL DEFAULT '',
            entity_id TEXT NOT NULL DEFAULT '',
            details_json TEXT NOT NULL DEFAULT '{}',
            timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp);

        /* Tool traces: individual tool-call records per agent run */
        CREATE TABLE IF NOT EXISTS tool_traces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL,
            run_id TEXT NOT NULL DEFAULT '',
            correlation_id TEXT NOT NULL DEFAULT '',
            tool_name TEXT NOT NULL,
            tool_category TEXT NOT NULL DEFAULT 'run',
            phase TEXT NOT NULL DEFAULT 'start',
            input_preview TEXT NOT NULL DEFAULT '',
            output_preview TEXT NOT NULL DEFAULT '',
            duration_ms INTEGER DEFAULT NULL,
            timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_traces_run ON tool_traces(run_id);
        CREATE INDEX IF NOT EXISTS idx_traces_ts ON tool_traces(timestamp);
    """)

    # Migrations: add new columns to existing tables (SQLite ALTER TABLE)
    _migrations = [
        "ALTER TABLE tasks ADD COLUMN goal_id TEXT DEFAULT NULL",
        "ALTER TABLE tasks ADD COLUMN parent_task_id TEXT DEFAULT NULL",
        "ALTER TABLE chat_messages ADD COLUMN task_id TEXT DEFAULT NULL",
        "ALTER TABLE chat_messages ADD COLUMN correlation_id TEXT DEFAULT NULL",
    ]
    for sql in _migrations:
        try:
            db.execute(sql)
        except Exception:
            pass  # Column already exists

    try:
        db.execute("CREATE INDEX IF NOT EXISTS idx_chat_task ON chat_messages(task_id)")
    except Exception:
        pass

    db.close()
    log.info(f"Mission Control DB initialized at {_MC_DB_PATH}")


# Initialize DB on startup
try:
    _init_mc_db()
except Exception as _e:
    log.warning(f"Failed to initialize MC database: {_e}")


def _check_api_token(request: Request) -> bool:
    """Validate auth token from X-Auth-Token header or query param."""
    token = request.headers.get("X-Auth-Token", "") or request.query_params.get("token", "")
    return token == BRIDGE_AUTH_TOKEN


# ---- Tasks API ------------------------------------------------------------

@app.get("/api/tasks")
async def api_tasks_list(request: Request):
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    # Exclude archived tasks by default, include with ?include_archived=1
    include_archived = request.query_params.get("include_archived", "0") == "1"
    db = _get_mc_db()
    if include_archived:
        rows = db.execute("SELECT * FROM tasks ORDER BY priority DESC, created_at ASC").fetchall()
    else:
        rows = db.execute("SELECT * FROM tasks WHERE status != 'archived' ORDER BY priority DESC, created_at ASC").fetchall()

    # Build dependency map: task_id -> [depends_on_id, ...]
    dep_rows = db.execute("SELECT task_id, depends_on FROM task_dependencies").fetchall()
    deps_map: dict[str, list[str]] = {}
    for dr in dep_rows:
        deps_map.setdefault(dr["task_id"], []).append(dr["depends_on"])

    # Build status lookup for computing blocked state
    status_map = {r["id"]: r["status"] for r in rows}

    tasks = []
    for r in rows:
        t = dict(r)
        t["depends_on"] = deps_map.get(t["id"], [])
        # A task is blocked if any dependency is not 'done'
        t["blocked"] = any(status_map.get(dep_id, "todo") != "done" for dep_id in t["depends_on"])
        tasks.append(t)

    db.close()
    return tasks


@app.post("/api/tasks")
async def api_tasks_create(request: Request):
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    body = await request.json()
    task_id = body.get("id", str(uuid.uuid4()))
    db = _get_mc_db()
    db.execute(
        "INSERT INTO tasks (id, title, description, status, assignee, priority, created_at, updated_at, completed_at, goal_id, parent_task_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            task_id,
            body["title"],
            body.get("description", ""),
            body.get("status", "todo"),
            body.get("assignee", ""),
            body.get("priority", 0),
            body.get("created_at", int(time.time() * 1000)),
            body.get("updated_at", int(time.time() * 1000)),
            body.get("completed_at"),
            body.get("goal_id"),
            body.get("parent_task_id"),
        ),
    )
    # Insert dependencies if provided
    depends_on = body.get("depends_on", [])
    for dep_id in depends_on:
        db.execute(
            "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on) VALUES (?, ?)",
            (task_id, dep_id),
        )
    db.commit()
    db.close()
    return {"ok": True}


@app.put("/api/tasks/{task_id}")
async def api_tasks_update(task_id: str, request: Request):
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    body = await request.json()
    db = _get_mc_db()
    # Build dynamic update
    fields = []
    values = []
    for key in ("title", "description", "status", "assignee", "priority", "completed_at", "goal_id", "parent_task_id"):
        if key in body:
            fields.append(f"{key} = ?")
            values.append(body[key])
    if fields:
        fields.append("updated_at = ?")
        values.append(int(time.time() * 1000))
        values.append(task_id)
        db.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?", values)

    # Update dependencies if provided
    if "depends_on" in body:
        db.execute("DELETE FROM task_dependencies WHERE task_id = ?", (task_id,))
        for dep_id in body["depends_on"]:
            db.execute(
                "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on) VALUES (?, ?)",
                (task_id, dep_id),
            )

    db.commit()

    # If task was marked 'done', check if this unblocks other tasks
    if body.get("status") == "done":
        # Find tasks that depend on this one
        dependents = db.execute(
            "SELECT td.task_id FROM task_dependencies td "
            "JOIN tasks t ON td.task_id = t.id "
            "WHERE td.depends_on = ? AND t.status != 'done'",
            (task_id,),
        ).fetchall()

        if dependents:
            # For each dependent, check if ALL its dependencies are now done
            unblocked_ids = []
            for dep_row in dependents:
                dep_task_id = dep_row["task_id"]
                still_blocked = db.execute(
                    "SELECT 1 FROM task_dependencies td "
                    "JOIN tasks t ON td.depends_on = t.id "
                    "WHERE td.task_id = ? AND t.status != 'done'",
                    (dep_task_id,),
                ).fetchone()
                if not still_blocked:
                    unblocked_ids.append(dep_task_id)

            if unblocked_ids:
                # Broadcast unblock event to Mission Control
                unblock_event = {
                    "type": "event",
                    "event": "task_update",
                    "payload": {
                        "action": "unblocked",
                        "task_ids": unblocked_ids,
                        "completed_dependency": task_id,
                    },
                    "ts": datetime.utcnow().isoformat() + "Z",
                }
                _broadcast_to_mc(unblock_event)

    db.close()
    return {"ok": True}


@app.delete("/api/tasks/{task_id}")
async def api_tasks_delete(task_id: str, request: Request):
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    db = _get_mc_db()
    db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    db.commit()
    db.close()
    return {"ok": True}


@app.post("/api/tasks/archive")
async def api_tasks_archive(request: Request):
    """Archive all done and failed tasks (bulk move to 'archived' status)."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    db = _get_mc_db()
    now_ms = int(time.time() * 1000)
    cursor = db.execute(
        "UPDATE tasks SET status = 'archived', updated_at = ? WHERE status IN ('done', 'failed')",
        (now_ms,),
    )
    count = cursor.rowcount
    db.commit()
    db.close()
    return {"ok": True, "archived": count}


# ---- Memory API -----------------------------------------------------------

@app.get("/api/memories")
async def api_memories_list(request: Request):
    """List all agent memory files (markdown files from workspace dirs)."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    files = []
    # Scan workspace directories for each agent
    for agent_id in ("mc-orchestrator", "mc-builder", "mc-architect", "mc-social"):
        workspace_dir = os.path.join(_CONFIG_DIR, f"workspace-{agent_id}")
        if not os.path.isdir(workspace_dir):
            continue

        # Top-level markdown files
        for md_file in sorted(_glob.glob(os.path.join(workspace_dir, "*.md"))):
            name = os.path.basename(md_file)
            files.append({
                "agent_id": agent_id,
                "name": name,
                "path": name,
                "size": os.path.getsize(md_file),
                "mtime": int(os.path.getmtime(md_file) * 1000),
            })

        # Memory subdirectory
        memory_dir = os.path.join(workspace_dir, "memory")
        if os.path.isdir(memory_dir):
            for md_file in sorted(_glob.glob(os.path.join(memory_dir, "*.md"))):
                name = os.path.basename(md_file)
                files.append({
                    "agent_id": agent_id,
                    "name": "memory/" + name,
                    "path": "memory/" + name,
                    "size": os.path.getsize(md_file),
                    "mtime": int(os.path.getmtime(md_file) * 1000),
                })

    # Also include global config files
    for name in ("CLAUDE.md", "HEARTBEAT.md"):
        fpath = os.path.join(_CONFIG_DIR, name)
        if os.path.isfile(fpath):
            files.append({
                "agent_id": "global",
                "name": name,
                "path": name,
                "size": os.path.getsize(fpath),
                "mtime": int(os.path.getmtime(fpath) * 1000),
            })

    return files


@app.get("/api/memories/{agent_id}/{path:path}")
async def api_memories_read(agent_id: str, path: str, request: Request):
    """Read a specific memory file content."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    # Validate agent_id (alphanumeric + hyphens only)
    if not re.match(r'^[a-zA-Z0-9\-]+$', agent_id):
        return JSONResponse(status_code=400, content={"error": "Invalid agent_id"})

    # Compute base directory
    from pathlib import Path as _Path
    if agent_id == "global":
        base_dir = _Path(_CONFIG_DIR).resolve()
    else:
        base_dir = (_Path(_CONFIG_DIR) / f"workspace-{agent_id}").resolve()

    # Resolve the requested path and verify it stays within base directory
    try:
        file_path = (base_dir / path).resolve()
        if not str(file_path).startswith(str(base_dir)):
            return JSONResponse(status_code=403, content={"error": "Path traversal denied"})
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid path"})

    if not file_path.is_file():
        return JSONResponse(status_code=404, content={"error": "File not found"})

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"content": content, "path": path, "agent_id": agent_id}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "Read error"})


# ---- Calendar API ---------------------------------------------------------

@app.get("/api/calendar")
async def api_calendar(request: Request):
    """Return cron jobs with computed next-run times."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    jobs_path = os.path.join(_CONFIG_DIR, "cron", "jobs.json")
    if not os.path.isfile(jobs_path):
        return []

    try:
        with open(jobs_path, "r") as f:
            data = json.load(f)
    except (json.JSONDecodeError, IOError):
        return []

    result = []
    now = datetime.now()

    for job in data.get("jobs", []):
        schedule = job.get("schedule", {})
        cron_expr = schedule.get("expr", "")
        tz = schedule.get("tz", "UTC")

        # Compute next runs using simple cron parsing
        next_runs = []
        try:
            # Try to use croniter if available
            from croniter import croniter
            cron = croniter(cron_expr, now)
            for _ in range(7):  # next 7 occurrences
                next_runs.append(cron.get_next(datetime).isoformat())
        except ImportError:
            # Fallback: use state.nextRunAtMs from jobs.json
            next_ms = job.get("state", {}).get("nextRunAtMs")
            if next_ms:
                next_runs.append(datetime.fromtimestamp(next_ms / 1000).isoformat())

        state = job.get("state", {})
        payload = job.get("payload", {})

        result.append({
            "id": job.get("id"),
            "name": job.get("name", "Unknown"),
            "agent_id": job.get("agentId", ""),
            "cron_expr": cron_expr,
            "timezone": tz,
            "enabled": job.get("enabled", True),
            "next_runs": next_runs,
            "last_status": state.get("lastStatus", state.get("lastRunStatus")),
            "last_run_at": state.get("lastRunAtMs"),
            "last_duration_ms": state.get("lastDurationMs"),
            "message": payload.get("message", ""),
        })

    return result


# ---- Team API -------------------------------------------------------------

@app.get("/api/team")
async def api_team(request: Request):
    """Return agent configurations, roles, and workspace metadata."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    agents = []
    # Count cron jobs per agent
    cron_counts = {}
    jobs_path = os.path.join(_CONFIG_DIR, "cron", "jobs.json")
    try:
        with open(jobs_path, "r") as f:
            jobs_data = json.load(f)
        for job in jobs_data.get("jobs", []):
            aid = job.get("agentId", "")
            if job.get("enabled", True):
                cron_counts[aid] = cron_counts.get(aid, 0) + 1
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    for agent_id in ("mc-orchestrator", "mc-builder", "mc-architect", "mc-social"):
        workspace_dir = os.path.join(_CONFIG_DIR, f"workspace-{agent_id}")

        # Read SOUL.md for role description
        role = ""
        soul_path = os.path.join(workspace_dir, "SOUL.md")
        if os.path.isfile(soul_path):
            try:
                with open(soul_path, "r", encoding="utf-8") as f:
                    content = f.read()
                # Extract role from "## Who You Are" section
                m = re.search(r"## Who You Are\s*\n(.*?)(?=\n##|\Z)", content, re.DOTALL)
                if m:
                    role = m.group(1).strip()[:300]
            except Exception:
                pass

        # Read capabilities from TOOLS.md or AGENTS.md
        capabilities = []
        agents_md_path = os.path.join(workspace_dir, "AGENTS.md")
        if os.path.isfile(agents_md_path):
            try:
                with open(agents_md_path, "r", encoding="utf-8") as f:
                    content = f.read()
                # Extract bullet points
                for m in re.finditer(r"^[-*] (.+)$", content, re.MULTILINE):
                    cap = m.group(1).strip()
                    if len(cap) > 5 and len(capabilities) < 6:
                        capabilities.append(cap)
            except Exception:
                pass

        agents.append({
            "id": agent_id,
            "role": role,
            "capabilities": capabilities,
            "cron_job_count": cron_counts.get(agent_id, 0),
        })

    return agents


# ---- Chat History API -----------------------------------------------------

@app.get("/api/chat/history")
async def api_chat_history(request: Request):
    """Load persisted chat history. Optional ?task_id= filter for threading."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    db = _get_mc_db()
    task_id = request.query_params.get("task_id")
    limit = min(int(request.query_params.get("limit", "200")), 500)
    if task_id:
        rows = db.execute(
            "SELECT * FROM chat_messages WHERE task_id = ? ORDER BY timestamp DESC LIMIT ?",
            (task_id, limit),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM chat_messages ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        ).fetchall()
    db.close()
    # Return in chronological order
    return [dict(r) for r in reversed(rows)]


# ---- Goals API -----------------------------------------------------------

@app.get("/api/goals")
async def api_goals_list(request: Request):
    """List all active goals with child task counts and progress."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    db = _get_mc_db()
    goals = db.execute("SELECT * FROM goals WHERE status != 'archived' ORDER BY created_at DESC").fetchall()
    result = []
    for g in goals:
        gd = dict(g)
        task_counts = db.execute(
            "SELECT status, COUNT(*) as cnt FROM tasks WHERE goal_id = ? AND status != 'archived' GROUP BY status",
            (g["id"],),
        ).fetchall()
        gd["task_counts"] = {r["status"]: r["cnt"] for r in task_counts}
        total = sum(gd["task_counts"].values())
        done = gd["task_counts"].get("done", 0)
        gd["progress"] = round(done / total * 100) if total > 0 else 0
        result.append(gd)
    db.close()
    return result


@app.post("/api/goals")
async def api_goals_create(request: Request):
    """Create a new goal."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    body = await request.json()
    goal_id = body.get("id", str(uuid.uuid4()))
    now_ms = int(time.time() * 1000)
    db = _get_mc_db()
    db.execute(
        "INSERT INTO goals (id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (goal_id, body["title"], body.get("description", ""), "active", now_ms, now_ms),
    )
    db.commit()
    db.close()
    return {"ok": True, "id": goal_id}


@app.put("/api/goals/{goal_id}")
async def api_goals_update(goal_id: str, request: Request):
    """Update a goal."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    body = await request.json()
    db = _get_mc_db()
    fields, values = [], []
    for key in ("title", "description", "status", "completed_at"):
        if key in body:
            fields.append(f"{key} = ?")
            values.append(body[key])
    if fields:
        fields.append("updated_at = ?")
        values.append(int(time.time() * 1000))
        values.append(goal_id)
        db.execute(f"UPDATE goals SET {', '.join(fields)} WHERE id = ?", values)
        db.commit()
    db.close()
    return {"ok": True}


@app.delete("/api/goals/{goal_id}")
async def api_goals_delete(goal_id: str, request: Request):
    """Delete a goal and unlink its tasks."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    db = _get_mc_db()
    db.execute("UPDATE tasks SET goal_id = NULL WHERE goal_id = ?", (goal_id,))
    db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    db.commit()
    db.close()
    return {"ok": True}


# ---- Costs Persistence API -----------------------------------------------

_MODEL_RATES = {
    "claude-sonnet-4-6": {"input": 0.003, "output": 0.015},
    "claude-opus-4-6": {"input": 0.015, "output": 0.075},
    "gemini-2.5-flash": {"input": 0.00015, "output": 0.0006},
    "gemini-2.5-pro": {"input": 0.00125, "output": 0.01},
}
_DEFAULT_RATE = {"input": 0.003, "output": 0.015}


@app.post("/api/costs/event")
async def api_costs_event(request: Request):
    """Record a cost event and upsert daily rollup."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    body = await request.json()
    db = _get_mc_db()
    now_ms = int(time.time() * 1000)
    ts = body.get("timestamp", now_ms)
    agent_id = body.get("agent_id", "")
    model = body.get("model", "")
    input_tokens = body.get("input_tokens", 0)
    output_tokens = body.get("output_tokens", 0)
    cost_cents = body.get("cost_cents", 0.0)

    db.execute(
        "INSERT INTO cost_events (agent_id, model, input_tokens, output_tokens, cost_cents, timestamp) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (agent_id, model, input_tokens, output_tokens, cost_cents, ts),
    )

    # Upsert daily rollup
    date_str = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
    db.execute(
        "INSERT INTO cost_daily (date, agent_id, total_cents, total_input_tokens, total_output_tokens) "
        "VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(date, agent_id) DO UPDATE SET "
        "total_cents = total_cents + excluded.total_cents, "
        "total_input_tokens = total_input_tokens + excluded.total_input_tokens, "
        "total_output_tokens = total_output_tokens + excluded.total_output_tokens",
        (date_str, agent_id, cost_cents, input_tokens, output_tokens),
    )
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/costs/summary")
async def api_costs_summary(request: Request):
    """Return aggregated cost data for dashboard hydration."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    db = _get_mc_db()
    days = int(request.query_params.get("days", "14"))

    daily_rows = db.execute(
        "SELECT date, agent_id, total_cents, total_input_tokens, total_output_tokens "
        "FROM cost_daily WHERE date >= date('now', ?) ORDER BY date",
        (f"-{days} days",),
    ).fetchall()

    recent = db.execute(
        "SELECT * FROM cost_events ORDER BY timestamp DESC LIMIT 100"
    ).fetchall()

    db.close()
    return {
        "daily": [dict(r) for r in daily_rows],
        "recent_events": [dict(r) for r in reversed(recent)],
    }


# ---- Activity Persistence API --------------------------------------------

@app.post("/api/activity/sample")
async def api_activity_sample(request: Request):
    """Record an activity sample (upsert hourly bucket)."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    body = await request.json()
    db = _get_mc_db()
    now = datetime.utcnow()
    date_str = now.strftime("%Y-%m-%d")
    hour = now.hour
    agent_id = body.get("agent_id", "")

    db.execute(
        "INSERT INTO activity_hourly (date, hour, agent_id, event_count, active_minutes) "
        "VALUES (?, ?, ?, 1, ?) "
        "ON CONFLICT(date, hour, agent_id) DO UPDATE SET "
        "event_count = event_count + 1, "
        "active_minutes = active_minutes + excluded.active_minutes",
        (date_str, hour, agent_id, body.get("active_minutes", 0.0)),
    )
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/activity/summary")
async def api_activity_summary(request: Request):
    """Return hourly activity data for dashboard hydration."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    db = _get_mc_db()
    days = int(request.query_params.get("days", "14"))

    rows = db.execute(
        "SELECT date, hour, agent_id, event_count, active_minutes "
        "FROM activity_hourly WHERE date >= date('now', ?) ORDER BY date, hour",
        (f"-{days} days",),
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


# ---- Audit Log API -------------------------------------------------------

@app.post("/api/audit")
async def api_audit_create(request: Request):
    """Record an audit event."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    body = await request.json()
    db = _get_mc_db()
    db.execute(
        "INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, details_json, timestamp) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            body.get("actor_type", "system"),
            body.get("actor_id", ""),
            body["action"],
            body.get("entity_type", ""),
            body.get("entity_id", ""),
            json.dumps(body.get("details", {})),
            int(time.time() * 1000),
        ),
    )
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/audit")
async def api_audit_list(request: Request):
    """Paginated audit log."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    db = _get_mc_db()
    limit = min(int(request.query_params.get("limit", "50")), 200)
    offset = int(request.query_params.get("offset", "0"))

    rows = db.execute(
        "SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        (limit, offset),
    ).fetchall()
    total = db.execute("SELECT COUNT(*) as cnt FROM audit_log").fetchone()["cnt"]
    db.close()
    return {"entries": [dict(r) for r in rows], "total": total}


# ---- Tool Traces API -----------------------------------------------------

def _classify_tool_category(tool_name: str) -> str:
    """Classify a tool name into a visual category."""
    name = (tool_name or "").lower()
    dispatch_kw = {"dispatch", "route", "delegate", "assign", "forward"}
    read_kw = {"search", "grep", "find", "read", "browse", "fetch", "scan", "glob", "list", "cat", "head", "tail"}
    write_kw = {"write", "edit", "create", "update", "insert", "replace", "delete", "patch", "modify", "code", "refactor"}
    for kw in dispatch_kw:
        if kw in name:
            return "dispatch"
    for kw in read_kw:
        if kw in name:
            return "read"
    for kw in write_kw:
        if kw in name:
            return "write"
    return "run"


@app.post("/api/traces")
async def api_traces_create(request: Request):
    """Record a tool trace event."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    body = await request.json()
    db = _get_mc_db()
    db.execute(
        "INSERT INTO tool_traces (agent_id, run_id, correlation_id, tool_name, tool_category, phase, input_preview, output_preview, duration_ms, timestamp) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            body.get("agent_id", ""),
            body.get("run_id", ""),
            body.get("correlation_id", ""),
            body["tool_name"],
            body.get("tool_category", _classify_tool_category(body.get("tool_name", ""))),
            body.get("phase", "start"),
            (body.get("input_preview", "") or "")[:500],
            (body.get("output_preview", "") or "")[:500],
            body.get("duration_ms"),
            int(time.time() * 1000),
        ),
    )
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/api/traces")
async def api_traces_list(request: Request):
    """Query tool traces with optional filters."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    db = _get_mc_db()

    conditions, params = [], []
    if request.query_params.get("agent_id"):
        conditions.append("agent_id = ?")
        params.append(request.query_params["agent_id"])
    if request.query_params.get("run_id"):
        conditions.append("run_id = ?")
        params.append(request.query_params["run_id"])
    if request.query_params.get("correlation_id"):
        conditions.append("correlation_id = ?")
        params.append(request.query_params["correlation_id"])

    where = " AND ".join(conditions) if conditions else "1=1"
    limit = min(int(request.query_params.get("limit", "100")), 500)

    rows = db.execute(
        f"SELECT * FROM tool_traces WHERE {where} ORDER BY timestamp DESC LIMIT ?",
        params + [limit],
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


# ---- Calendar CRUD API ---------------------------------------------------

@app.post("/api/calendar")
async def api_calendar_create(request: Request):
    """Create a new cron job (writes to jobs.json)."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    body = await request.json()

    jobs_path = os.path.join(_CONFIG_DIR, "cron", "jobs.json")
    try:
        with open(jobs_path, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {"jobs": []}

    new_job = {
        "id": str(uuid.uuid4()),
        "agentId": body["agent_id"],
        "name": body["name"],
        "enabled": body.get("enabled", True),
        "notify": body.get("notify", True),
        "createdAtMs": int(time.time() * 1000),
        "updatedAtMs": int(time.time() * 1000),
        "schedule": {
            "kind": "cron",
            "expr": body["cron_expr"],
            "tz": body.get("timezone", "Europe/Lisbon"),
        },
        "sessionTarget": "isolated",
        "wakeMode": "now",
        "payload": {
            "kind": "agentTurn",
            "message": body.get("message", ""),
        },
        "state": {},
        "delivery": body.get("delivery", {
            "mode": "announce",
            "channel": "telegram",
            "to": os.environ.get("TELEGRAM_DEFAULT_CHAT_ID") or "",
            "bestEffort": True,
        }),
    }
    data["jobs"].append(new_job)

    with open(jobs_path, "w") as f:
        json.dump(data, f, indent=2)

    return {"ok": True, "id": new_job["id"]}


@app.put("/api/calendar/{job_id}")
async def api_calendar_update(job_id: str, request: Request):
    """Update an existing cron job."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    body = await request.json()

    jobs_path = os.path.join(_CONFIG_DIR, "cron", "jobs.json")
    try:
        with open(jobs_path, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return JSONResponse(status_code=404, content={"error": "Jobs file not found"})

    for job in data.get("jobs", []):
        if job["id"] == job_id:
            if "name" in body:
                job["name"] = body["name"]
            if "enabled" in body:
                job["enabled"] = body["enabled"]
            if "agent_id" in body:
                job["agentId"] = body["agent_id"]
            if "cron_expr" in body:
                job["schedule"]["expr"] = body["cron_expr"]
            if "timezone" in body:
                job["schedule"]["tz"] = body["timezone"]
            if "message" in body:
                job["payload"]["message"] = body["message"]
            if "delivery" in body:
                job["delivery"] = body["delivery"]
            job["updatedAtMs"] = int(time.time() * 1000)
            break

    with open(jobs_path, "w") as f:
        json.dump(data, f, indent=2)

    return {"ok": True}


@app.delete("/api/calendar/{job_id}")
async def api_calendar_delete(job_id: str, request: Request):
    """Delete a cron job."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    jobs_path = os.path.join(_CONFIG_DIR, "cron", "jobs.json")
    try:
        with open(jobs_path, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return JSONResponse(status_code=404, content={"error": "Jobs file not found"})

    data["jobs"] = [j for j in data.get("jobs", []) if j["id"] != job_id]

    with open(jobs_path, "w") as f:
        json.dump(data, f, indent=2)

    return {"ok": True}


# ---- Approval Queue API --------------------------------------------------

# Path to publish.js for subprocess calls
_PUBLISH_JS_PATH = os.path.join(
    _CONFIG_DIR, "workspace-mc-social",
    "skills", "social-composio", "scripts", "publish.js",
)

# Telegram operator notification (best-effort, non-blocking)
TELEGRAM_OPERATOR_CHAT_ID = os.environ.get("TELEGRAM_OPERATOR_CHAT_ID")  # no default — must be set in env


async def _send_telegram_notification(message: str):
    """Send a Telegram message to the operator. Non-blocking, failures logged."""
    if not TELEGRAM_BOT_TOKEN:
        log.warning("[Approvals] No TELEGRAM_BOT_TOKEN set, skipping notification")
        return
    if not TELEGRAM_OPERATOR_CHAT_ID:
        log.warning("[Approvals] No TELEGRAM_OPERATOR_CHAT_ID set, skipping notification")
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={
                "chat_id": TELEGRAM_OPERATOR_CHAT_ID,
                "text": message,
                "parse_mode": "HTML",
            })
            if resp.status_code != 200:
                log.warning(f"[Approvals] Telegram notification failed: {resp.status_code} {resp.text[:200]}")
            else:
                log.info("[Approvals] Telegram notification sent")
    except Exception as e:
        log.warning(f"[Approvals] Telegram notification error: {e}")


@app.get("/api/approvals")
async def api_approvals_list(request: Request):
    """List pending approvals from the social_approvals table."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    db = _get_mc_db()
    try:
        rows = db.execute(
            "SELECT * FROM social_approvals WHERE status = 'pending' ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        log.error(f"[Approvals] Failed to list approvals: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        db.close()


@app.post("/api/approvals/{approval_id}/approve")
async def api_approval_approve(approval_id: str, request: Request):
    """Approve a pending post and trigger immediate publish via publish.js."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    db = _get_mc_db()
    try:
        row = db.execute(
            "SELECT * FROM social_approvals WHERE id = ? AND status = 'pending'",
            (approval_id,),
        ).fetchone()
        if not row:
            return JSONResponse(status_code=404, content={"error": "Approval not found or already processed"})

        approval = dict(row)

        # Mark as approved
        db.execute(
            "UPDATE social_approvals SET status = 'approved', reviewed_at = datetime('now') WHERE id = ?",
            (approval_id,),
        )
        db.commit()

        # Trigger immediate publish via subprocess
        import subprocess as _sp
        cmd = ["node", _PUBLISH_JS_PATH, "--text", approval.get("text", ""), "--publish"]
        if approval.get("image_url"):
            cmd.extend(["--image", approval["image_url"]])
        if approval.get("channel"):
            cmd.extend(["--channel", approval["channel"]])

        # Platform-specific skip flags
        platform = (approval.get("platform") or "").lower()
        if platform == "twitter":
            cmd.append("--skip-farcaster")
        elif platform == "farcaster":
            cmd.append("--skip-twitter")

        log.info(f"[Approvals] Publishing approved post {approval_id}: {' '.join(cmd[:6])}...")
        try:
            proc = _sp.Popen(
                cmd,
                stdout=_sp.PIPE,
                stderr=_sp.PIPE,
                cwd=os.path.dirname(_PUBLISH_JS_PATH),
            )
            # Non-blocking: log result in background thread
            import threading as _threading

            def _log_publish_result():
                try:
                    stdout, stderr = proc.communicate(timeout=60)
                    if proc.returncode == 0:
                        log.info(f"[Approvals] Publish succeeded for {approval_id}")
                    else:
                        log.error(f"[Approvals] Publish failed for {approval_id}: {stderr.decode()[:300]}")
                except Exception as ex:
                    log.error(f"[Approvals] Publish error for {approval_id}: {ex}")

            _threading.Thread(target=_log_publish_result, daemon=True).start()
        except Exception as e:
            log.error(f"[Approvals] Failed to start publish subprocess: {e}")

        # Insert into social_posts table for tracking
        post_id = str(uuid.uuid4())
        try:
            db.execute(
                "INSERT OR IGNORE INTO social_posts (id, platform, text, image_url, status, created_at) "
                "VALUES (?, ?, ?, ?, 'published', datetime('now'))",
                (post_id, approval.get("platform", ""), approval.get("text", ""), approval.get("image_url", "")),
            )
            db.commit()
        except Exception:
            pass  # social_posts table may not exist in this DB instance

        return {"ok": True, "published": True, "post_id": post_id}
    except Exception as e:
        log.error(f"[Approvals] Approve error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        db.close()


@app.post("/api/approvals/{approval_id}/reject")
async def api_approval_reject(approval_id: str, request: Request):
    """Reject a pending post with optional reason."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    body = {}
    try:
        body = await request.json()
    except Exception:
        pass  # Reason is optional

    reason = body.get("reason", "")

    db = _get_mc_db()
    try:
        row = db.execute(
            "SELECT id FROM social_approvals WHERE id = ? AND status = 'pending'",
            (approval_id,),
        ).fetchone()
        if not row:
            return JSONResponse(status_code=404, content={"error": "Approval not found or already processed"})

        db.execute(
            "UPDATE social_approvals SET status = 'rejected', reviewed_at = datetime('now') WHERE id = ?",
            (approval_id,),
        )
        db.commit()

        if reason:
            log.info(f"[Approvals] Rejected {approval_id}: {reason[:100]}")
        else:
            log.info(f"[Approvals] Rejected {approval_id}")

        return {"ok": True, "rejected": True}
    except Exception as e:
        log.error(f"[Approvals] Reject error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        db.close()


@app.post("/api/approvals/notify")
async def api_approval_notify(request: Request):
    """Send a Telegram notification about a new approval in the queue."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    try:
        body = await request.json()
    except Exception:
        body = {}

    approval_type = body.get("type", "post")
    text_preview = (body.get("text", "") or "")[:100]
    msg = (
        f"<b>New approval pending</b>\n"
        f"Type: {approval_type}\n"
        f"Preview: {text_preview}{'...' if len(body.get('text', '')) > 100 else ''}\n\n"
        f"Review in Mission Control dashboard."
    )

    await _send_telegram_notification(msg)
    return {"ok": True, "notified": True}


# ---- Agent Control API ---------------------------------------------------

@app.post("/api/agents/{agent_id}/pause")
async def api_agent_pause(agent_id: str, request: Request):
    """Pause an agent by sending control message to Gateway."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    session_key = f"agent:{agent_id}:main"
    if gateway_ws and gateway_connected:
        try:
            await gateway_ws.send(json.dumps({
                "type": "control", "action": "pause", "sessionKey": session_key,
            }))
            ctrl_event = {
                "type": "event", "event": "agent_control",
                "payload": {"agent_id": agent_id, "action": "paused"},
                "ts": datetime.utcnow().isoformat() + "Z",
            }
            _broadcast_to_mc(ctrl_event)
            return {"ok": True}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})
    return JSONResponse(status_code=503, content={"error": "Gateway not connected"})


@app.post("/api/agents/{agent_id}/resume")
async def api_agent_resume(agent_id: str, request: Request):
    """Resume a paused agent."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    session_key = f"agent:{agent_id}:main"
    if gateway_ws and gateway_connected:
        try:
            await gateway_ws.send(json.dumps({
                "type": "control", "action": "resume", "sessionKey": session_key,
            }))
            ctrl_event = {
                "type": "event", "event": "agent_control",
                "payload": {"agent_id": agent_id, "action": "resumed"},
                "ts": datetime.utcnow().isoformat() + "Z",
            }
            _broadcast_to_mc(ctrl_event)
            return {"ok": True}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})
    return JSONResponse(status_code=503, content={"error": "Gateway not connected"})


@app.post("/api/agents/{agent_id}/stop")
async def api_agent_stop(agent_id: str, request: Request):
    """Stop an agent and mark any in-progress task as failed."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    session_key = f"agent:{agent_id}:main"
    if gateway_ws and gateway_connected:
        try:
            await gateway_ws.send(json.dumps({
                "type": "control", "action": "stop", "sessionKey": session_key,
            }))
            # Mark in-progress tasks as failed
            db = _get_mc_db()
            now_ms = int(time.time() * 1000)
            db.execute(
                "UPDATE tasks SET status = 'failed', updated_at = ? WHERE assignee = ? AND status = 'in_progress'",
                (now_ms, agent_id),
            )
            db.commit()
            db.close()
            ctrl_event = {
                "type": "event", "event": "agent_control",
                "payload": {"agent_id": agent_id, "action": "stopped"},
                "ts": datetime.utcnow().isoformat() + "Z",
            }
            _broadcast_to_mc(ctrl_event)
            return {"ok": True}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})
    return JSONResponse(status_code=503, content={"error": "Gateway not connected"})


@app.post("/api/agents/{agent_id}/reassign")
async def api_agent_reassign(agent_id: str, request: Request):
    """Reassign current in-progress task to another agent."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    body = await request.json()
    target_agent = body.get("target_agent", "")

    db = _get_mc_db()
    task = db.execute(
        "SELECT * FROM tasks WHERE assignee = ? AND status = 'in_progress' ORDER BY updated_at DESC LIMIT 1",
        (agent_id,),
    ).fetchone()

    if task:
        now_ms = int(time.time() * 1000)
        db.execute(
            "UPDATE tasks SET assignee = ?, updated_at = ? WHERE id = ?",
            (target_agent, now_ms, task["id"]),
        )
        db.commit()

        # Dispatch to the target agent via Gateway
        task_text = f"[Reassigned from {agent_id}] {task['title']}\n\n{task['description']}"
        target_session = f"agent:{target_agent}:main"
        if gateway_ws and gateway_connected:
            try:
                await send_chat_via_gateway(task_text, target_session)
            except Exception:
                pass

        db.close()
        return {"ok": True, "task_id": task["id"], "reassigned_to": target_agent}

    db.close()
    return JSONResponse(status_code=404, content={"error": "No in-progress task found"})


# ---------------------------------------------------------------------------
# Mission Control: WebSocket /ws/mission-control — aggregated event stream
# ---------------------------------------------------------------------------
@app.websocket("/ws/mission-control")
async def ws_mission_control(ws: WebSocket, token: Optional[str] = Query(None)):
    """
    Mission Control dashboard WebSocket.
    Streams all gateway events in real-time + sends buffered recent events on connect.
    """
    if not _check_ws_token(token):
        log.warning(f"Rejected mission-control connection: invalid token from {ws.client}")
        await ws.close(code=4003, reason="Invalid or missing auth token")
        return

    await ws.accept()
    _mission_control_clients.add(ws)
    client_queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    _mc_client_queues[ws] = client_queue
    log.info(f"Mission Control client connected ({len(_mission_control_clients)} total)")

    async def _sender():
        """Drain the per-client queue and send events sequentially."""
        try:
            while True:
                evt = await client_queue.get()
                if evt is None:
                    break  # Sentinel to stop
                await ws.send_json(evt)
        except Exception:
            pass  # Connection closed — sender exits

    sender_task = asyncio.create_task(_sender())

    try:
        # Send current state snapshot on connect
        snapshot = {
            "type": "snapshot",
            "gateway_connected": gateway_connected,
            "buffered_events": len(_gateway_event_buffer),
        }
        await ws.send_json(snapshot)

        # Send a small batch of recent events via the queue (sequential, non-flooding)
        for evt in _gateway_event_buffer[-15:]:
            client_queue.put_nowait(evt)

        # Keep connection alive — the _sender() task handles outbound events
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=30.0)
                if msg.strip().lower() == "ping":
                    client_queue.put_nowait({"type": "pong"})
            except asyncio.TimeoutError:
                client_queue.put_nowait({
                    "type": "heartbeat",
                    "gateway_connected": gateway_connected,
                    "ts": datetime.utcnow().isoformat() + "Z",
                })

    except WebSocketDisconnect as wsd:
        log.info(f"MC WS: client disconnected (code={wsd.code})")
    except Exception as e:
        log.warning(f"MC WS: handler error: {type(e).__name__}: {e}")
    finally:
        client_queue.put_nowait(None)  # Stop sender
        sender_task.cancel()
        _mc_client_queues.pop(ws, None)
        _mission_control_clients.discard(ws)
        log.info(f"MC WS: client gone ({len(_mission_control_clients)} remaining)")


# ---- Social Analytics API ------------------------------------------------

@app.get("/api/analytics")
async def api_analytics(request: Request):
    """Return social analytics data for the AnalyticsPanel dashboard widget."""
    if not _check_api_token(request):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    period = request.query_params.get("period", "week")
    days = 7 if period == "week" else 30

    db = _get_mc_db()

    # --- Posts by pillar and platform ---
    posts_by_pillar = db.execute(
        "SELECT pillar, COUNT(*) as count FROM social_posts "
        "WHERE created_at >= datetime('now', ?) GROUP BY pillar ORDER BY count DESC",
        (f"-{days} days",),
    ).fetchall()

    posts_by_platform = db.execute(
        "SELECT platform, COUNT(*) as count FROM social_posts "
        "WHERE created_at >= datetime('now', ?) GROUP BY platform ORDER BY count DESC",
        (f"-{days} days",),
    ).fetchall()

    total_posts = db.execute(
        "SELECT COUNT(*) as count FROM social_posts WHERE created_at >= datetime('now', ?)",
        (f"-{days} days",),
    ).fetchone()["count"]

    # --- Wildcard posts ---
    wildcard_count = db.execute(
        "SELECT COUNT(*) as count FROM social_posts WHERE wildcard = 1 AND created_at >= datetime('now', ?)",
        (f"-{days} days",),
    ).fetchone()["count"]

    # --- Post success/failure rates ---
    status_counts = db.execute(
        "SELECT status, COUNT(*) as count FROM social_posts "
        "WHERE created_at >= datetime('now', ?) GROUP BY status",
        (f"-{days} days",),
    ).fetchall()

    # --- Engagement per pillar (from social_analytics) ---
    pillar_engagement = db.execute(
        "SELECT pillar, SUM(value) as total FROM social_analytics "
        "WHERE metric = 'engagement' AND recorded_at >= datetime('now', ?) "
        "GROUP BY pillar ORDER BY total DESC",
        (f"-{days} days",),
    ).fetchall()

    # --- Relationships stats ---
    total_relationships = db.execute(
        "SELECT COUNT(*) as count FROM social_relationships",
    ).fetchone()["count"]

    mutual_relationships = db.execute(
        "SELECT COUNT(*) as count FROM social_relationships WHERE they_engaged_back = 1",
    ).fetchone()["count"]

    active_conversations = db.execute(
        "SELECT COUNT(*) as count FROM social_relationships WHERE active_conversation = 1",
    ).fetchone()["count"]

    # --- Recent top posts ---
    recent_posts = db.execute(
        "SELECT id, platform, text, pillar, similarity_score, wildcard, status, created_at "
        "FROM social_posts ORDER BY created_at DESC LIMIT 5",
    ).fetchall()

    # --- Stored analytics metrics ---
    analytics_rows = db.execute(
        "SELECT platform, metric, pillar, value, period, recorded_at "
        "FROM social_analytics WHERE recorded_at >= datetime('now', ?) ORDER BY recorded_at DESC LIMIT 100",
        (f"-{days} days",),
    ).fetchall()

    db.close()

    return {
        "period": period,
        "days": days,
        "total_posts": total_posts,
        "wildcard_count": wildcard_count,
        "posts_by_pillar": [dict(r) for r in posts_by_pillar],
        "posts_by_platform": [dict(r) for r in posts_by_platform],
        "status_counts": [dict(r) for r in status_counts],
        "pillar_engagement": [dict(r) for r in pillar_engagement],
        "relationships": {
            "total": total_relationships,
            "mutual": mutual_relationships,
            "active_conversations": active_conversations,
        },
        "recent_posts": [dict(r) for r in recent_posts],
        "analytics": [dict(r) for r in analytics_rows],
    }


# ---------------------------------------------------------------------------
# ADAPT-06: Adapter discovery + turn-dispatch endpoints (Wave 5)
# D6: All registered inline — no APIRouter. D7/D12: existing routes untouched.
# ---------------------------------------------------------------------------

@app.get("/api/agents")
async def list_agents():
    """ADAPT-06: return all agent definitions loaded from MC_AGENTS_DIR/*.yml."""
    return [asdict(a) for a in AGENTS]


@app.get("/api/providers")
async def list_providers():
    """ADAPT-06: return discovered model providers from server/providers/."""
    return [{"name": name} for name in sorted(PROVIDERS.keys())]


@app.get("/api/integrations")
async def list_integrations():
    """ADAPT-06: return discovered integrations from server/integrations/."""
    return [{"name": name} for name in sorted(INTEGRATIONS.keys())]


@app.post("/api/integration/send")
async def integration_send(req: IntegrationSendRequest):
    """ADAPT-06 / Phase 4 SC#3: deliver *message* via a registered Integration.

    Returns 503 if no integrations are registered.
    Returns 404 if the requested integration name is unknown.
    Returns 200 {ok, receipt} on success.

    Note: channel validation is the responsibility of each Integration impl
    (W2 plans); this endpoint passes channel through without sanitisation.
    """
    if not INTEGRATIONS:
        raise HTTPException(status_code=503, detail="no integrations registered")
    integ = INTEGRATIONS.get(req.integration)
    if integ is None:
        raise HTTPException(status_code=404, detail=f"unknown integration: {req.integration}")
    receipt = await integ.send(req.channel, req.message)
    return {"ok": True, "receipt": receipt}


@app.post("/api/turn")
async def create_turn(req: TurnRequest):
    """ADAPT-06: dispatch a turn via the configured RuntimeAdapter.

    Returns 503 if no RuntimeAdapter is registered (Phase 4 will populate RUNTIMES).
    Returns 404 if the requested runtime name is unknown.
    Returns 200 {turn_id} once the dispatch coroutine is scheduled — events stream
    over WS /ws/turn/{turn_id}.
    """
    if not RUNTIMES:
        raise HTTPException(status_code=503, detail="no runtime adapters registered")
    runtime_name = req.runtime or next(iter(RUNTIMES))
    runtime = RUNTIMES.get(runtime_name)
    if runtime is None:
        raise HTTPException(status_code=404, detail=f"unknown runtime: {runtime_name}")

    turn_id = uuid.uuid4().hex
    queue: asyncio.Queue = asyncio.Queue()
    _TURN_STREAMS[turn_id] = queue

    async def _drive() -> None:
        try:
            async for event in runtime.dispatch(req.agent_id, req.message):
                await queue.put(event)
        except Exception as e:  # noqa: BLE001
            await queue.put({"event": "error", "detail": str(e)})
        finally:
            await queue.put(None)  # sentinel: stream closed

    asyncio.create_task(_drive())
    return {"turn_id": turn_id}


@app.websocket("/ws/turn/{turn_id}")
async def turn_stream(ws: WebSocket, turn_id: str):
    """ADAPT-06: stream TurnEvent dicts produced by the runtime dispatch coroutine.

    Closes when the producer puts the sentinel (None) on the queue OR the client
    disconnects. The queue is removed from _TURN_STREAMS on close to bound memory.
    """
    queue = _TURN_STREAMS.get(turn_id)
    if queue is None:
        await ws.close(code=4404, reason="unknown turn_id")
        return
    await ws.accept()
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        _TURN_STREAMS.pop(turn_id, None)
        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------------------
# Static files: Mission Control Dashboard
# ---------------------------------------------------------------------------
# Serve the canvas directory at /dashboard/ — no auth required (localhost only).
# IMPORTANT: This must be mounted AFTER all API routes to avoid catching them.
if os.path.isdir(DASHBOARD_DIR):
    app.mount(
        "/dashboard",
        StaticFiles(directory=DASHBOARD_DIR, html=True),
        name="dashboard",
    )
    log.info(f"Dashboard mounted at /dashboard/ from {DASHBOARD_DIR}")
else:
    log.warning(f"Dashboard directory not found: {DASHBOARD_DIR}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run(
        "bridge_server:app",
        host=BRIDGE_HOST,
        port=BRIDGE_PORT,
        reload=False,  # SECURITY: No hot-reload in production
        log_level="info",
    )
