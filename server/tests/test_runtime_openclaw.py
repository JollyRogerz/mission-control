"""RUN-01: Tests for OpenClawRuntime WebSocket gateway adapter.

All tests are fully offline — zero outbound network calls.
The fake_turn_gateway fixture starts an in-process WebSocket server that
speaks the turn wire protocol (accept one frame, stream N events, send done).

Import notes:
- conftest.py inserts server/ into sys.path so packages like ``runtime``,
  ``adapters``, ``providers`` resolve without a ``server.`` prefix.
  Use ``runtime.openclaw`` (not ``server.runtime.openclaw``).
- The module-level RUNTIMES dict in adapters.loader is populated at import
  time with _scan("server.runtime", ...) which does NOT resolve from the test
  runner's sys.path.  For the loader-discover test we call _scan("runtime", ...)
  directly (same pattern as test_provider_anthropic.py).
"""
from __future__ import annotations

import asyncio
import json
import sys

import pytest

from adapters.runtime import RuntimeAdapter
from adapters.loader import _scan
from runtime.openclaw import OpenClawRuntime, RUNTIME


# ---------------------------------------------------------------------------
# Task 1 — Protocol + singleton
# ---------------------------------------------------------------------------

def test_protocol_satisfied():
    """RUNTIME singleton satisfies the RuntimeAdapter Protocol."""
    assert isinstance(RUNTIME, RuntimeAdapter)


# ---------------------------------------------------------------------------
# Task 2 — Loader discovers "openclaw"
# ---------------------------------------------------------------------------

def test_loader_discovers():
    """_scan('runtime') includes 'openclaw' key."""
    # Force-reload so we get a fresh scan under current sys.path.
    for mod_name in list(sys.modules):
        if "runtime.openclaw" in mod_name:
            del sys.modules[mod_name]

    runtimes = _scan("runtime", "RUNTIME", RuntimeAdapter)
    assert "openclaw" in runtimes


# ---------------------------------------------------------------------------
# Shared fixture: in-process fake WebSocket gateway for turn dispatch
# ---------------------------------------------------------------------------

@pytest.fixture
async def fake_turn_gateway():
    """Start an in-process WebSocket server that speaks the turn wire protocol.

    On each connection:
      1. Reads (and ignores) the opening turn-request frame.
      2. Sends {"event": "tool_result", "data": {"text": "hello"}}.
      3. Sends {"event": "token", "data": {"text": "world"}}.
      4. Sends {"event": "done"}.
      5. Closes.

    Yields:
        str: WebSocket base URL, e.g. ``"ws://127.0.0.1:54321"``
    """
    import websockets
    from websockets.asyncio.server import serve

    async def _handler(ws):
        try:
            await ws.recv()  # consume the turn request frame
        except Exception:
            pass
        await ws.send(json.dumps({"event": "tool_result", "data": {"text": "hello"}}))
        await ws.send(json.dumps({"event": "token", "data": {"text": "world"}}))
        await ws.send(json.dumps({"event": "done"}))

    async with serve(_handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        yield f"ws://127.0.0.1:{port}"


# ---------------------------------------------------------------------------
# Task 2 — dispatch streams events
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_dispatch_streams_events(fake_turn_gateway, monkeypatch):
    """dispatch() yields events from the gateway until {"event":"done"}."""
    monkeypatch.setenv("OPENCLAW_GATEWAY_URL", fake_turn_gateway)
    monkeypatch.delenv("BRIDGE_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("OPENCLAW_GATEWAY_TOKEN", raising=False)

    runtime = OpenClawRuntime()
    events = [e async for e in runtime.dispatch("agent-1", "hi")]

    assert len(events) >= 2
    assert events[-1] == {"event": "done"}
    # At least one non-terminal event should have arrived before "done".
    non_done = [e for e in events if e.get("event") != "done"]
    assert len(non_done) >= 1


# ---------------------------------------------------------------------------
# Task 2 — health_check
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_health_true_with_fake_gateway(fake_turn_gateway, monkeypatch):
    """health_check() returns True when the gateway is reachable."""
    monkeypatch.setenv("OPENCLAW_GATEWAY_URL", fake_turn_gateway)
    monkeypatch.delenv("BRIDGE_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("OPENCLAW_GATEWAY_TOKEN", raising=False)

    runtime = OpenClawRuntime()
    result = await runtime.health_check()
    assert result is True


@pytest.mark.asyncio
async def test_health_false_without_gateway(monkeypatch):
    """health_check() returns False when no gateway is running."""
    # Point at an ephemeral port that nothing is listening on.
    monkeypatch.setenv("OPENCLAW_GATEWAY_URL", "ws://127.0.0.1:19999")
    monkeypatch.delenv("BRIDGE_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("OPENCLAW_GATEWAY_TOKEN", raising=False)

    runtime = OpenClawRuntime()
    result = await runtime.health_check()
    assert result is False


# ---------------------------------------------------------------------------
# Task 3 — E2E via /api/turn + /ws/turn/{turn_id}
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_dispatch_e2e_via_http_and_ws(fake_turn_gateway, monkeypatch):
    """End-to-end: POST /api/turn with openclaw runtime, receive events over WS.

    Strategy (mirrors test_runtime_local.py pattern):
      1. Import bridge_server once so all references (RUNTIMES, app) share the same
         module object, avoiding stale-reference issues from session-scoped fixtures.
      2. Use httpx AsyncClient (ASGI transport) for the POST so that
         bridge_server._drive() runs in the SAME event loop as fake_turn_gateway.
         This lets OpenClawRuntime.dispatch() successfully connect to the fake gateway.
      3. Briefly await to let the background _drive() task drain events into the queue.
      4. Use Starlette's sync TestClient for websocket_connect to consume queued events
         (httpx ASGI transport does not support WebSocket protocol).
    """
    import httpx
    from starlette.testclient import TestClient
    import bridge_server as bs

    monkeypatch.setenv("OPENCLAW_GATEWAY_URL", fake_turn_gateway)
    monkeypatch.delenv("BRIDGE_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("OPENCLAW_GATEWAY_TOKEN", raising=False)

    runtime = OpenClawRuntime()

    # Inject into bridge_server's live RUNTIMES dict.
    # Use bs.RUNTIMES and bs.app — guaranteed to be the same module object.
    bs.RUNTIMES["openclaw"] = runtime
    try:
        # Step 1: POST /api/turn using async ASGI transport (same event loop as gateway).
        transport = httpx.ASGITransport(app=bs.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/turn",
                json={"agent_id": "agent-1", "message": "ping", "runtime": "openclaw"},
            )
        assert resp.status_code == 200, resp.text
        turn_id = resp.json()["turn_id"]
        assert turn_id

        # Step 2: Yield control so that _drive() can run and populate the queue.
        await asyncio.sleep(0.6)

        # Step 3: Consume events via WebSocket using sync TestClient.
        sync_client = TestClient(bs.app, raise_server_exceptions=True)
        received = []
        with sync_client.websocket_connect(f"/ws/turn/{turn_id}") as ws:
            while True:
                data = ws.receive_json()
                received.append(data)
                if data.get("event") == "done":
                    break

        assert len(received) >= 2
        assert received[-1] == {"event": "done"}
    finally:
        bs.RUNTIMES.pop("openclaw", None)
