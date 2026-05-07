"""
Pytest fixtures for the Mission Control bridge server test suite.

Import layout:
  bridge_server.py lives at server/bridge_server.py and is run as a top-level
  script via `python bridge_server.py`.  We add the server/ directory to
  sys.path so tests can import it as a module.
"""
import sys
from pathlib import Path

# Ensure the server/ directory is importable as the root for bridge_server
SERVER_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SERVER_DIR))

import asyncio
import json
import os
import pytest
import httpx
import respx

# Delay bridge_server import until the fixture is called so sys.path is set first.
# The import is cached by Python after the first call.


@pytest.fixture(scope="session")
def bridge_app():
    """Return the FastAPI app object from bridge_server.

    Session-scoped: imported once and reused across all tests.
    """
    import bridge_server  # noqa: PLC0415
    return bridge_server.app


@pytest.fixture
async def async_client(bridge_app):
    """Yield an httpx.AsyncClient wired to the in-process FastAPI app.

    Uses ASGITransport — no real network socket is opened.
    """
    transport = httpx.ASGITransport(app=bridge_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
def mc_agents_dir(tmp_path):
    """Yield a temporary agents directory and point MC_AGENTS_DIR at it.

    Tests that exercise AgentDefinition.load_all() should use this fixture
    to drop sample YAML files in an isolated directory.
    """
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    old = os.environ.get("MC_AGENTS_DIR")
    os.environ["MC_AGENTS_DIR"] = str(agents_dir)
    yield agents_dir
    if old is None:
        os.environ.pop("MC_AGENTS_DIR", None)
    else:
        os.environ["MC_AGENTS_DIR"] = old


# ---------------------------------------------------------------------------
# Phase 4 — W0 test-infrastructure fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def http_mock():
    """Yield a respx mock router for outbound HTTP calls.

    Usage::

        async def test_something(http_mock):
            http_mock.post("https://api.example.com/v1/messages").mock(
                return_value=httpx.Response(200, json={"id": "msg_123"})
            )
            ...

    assert_all_called=False so tests may set up mocks speculatively without
    triggering assertion failures when only a subset of mocks are hit.
    """
    with respx.mock(assert_all_called=False) as router:
        yield router


@pytest.fixture
async def fake_ws_gateway():
    """Start an in-process WebSocket echo server; yield its URL.

    The server:
    - Listens on an ephemeral port (port=0) to avoid collisions in parallel
      test runs.
    - For each connection, reads the first JSON message, then sends:
        1. {"event": "tool_result", "data": {"text": "<echo: <msg>>"}}
        2. {"event": "done"}
      then closes.

    Yields:
        str: WebSocket URL, e.g. ``"ws://127.0.0.1:54321/"``
    """
    import websockets
    from websockets.asyncio.server import serve

    async def _handler(ws):
        try:
            raw = await ws.recv()
            msg = json.loads(raw).get("message", raw)
        except Exception:
            msg = "<unparsed>"
        await ws.send(json.dumps({"event": "tool_result", "data": {"text": f"echo: {msg}"}}))
        await ws.send(json.dumps({"event": "done"}))

    async with serve(_handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        yield f"ws://127.0.0.1:{port}/"


@pytest.fixture
def fake_subprocess_cmd(tmp_path):
    """Write a small Python echo script; return the command list for it.

    The script:
    - Reads one JSON line from stdin.
    - Writes three JSONL TurnEvents to stdout::

        {"event": "started"}
        {"event": "tool_result", "data": {"text": "echo: <msg>"}}
        {"event": "done"}

    - Exits 0.

    Returns:
        list[str]: Command suitable for ``asyncio.create_subprocess_exec(*cmd)``.
    """
    import sys as _sys
    script = tmp_path / "echo.py"
    script.write_text(
        'import sys, json\n'
        'line = sys.stdin.readline()\n'
        'try:\n'
        '    msg = json.loads(line).get("message", line.strip())\n'
        'except Exception:\n'
        '    msg = line.strip()\n'
        'print(json.dumps({"event": "started"}))\n'
        'print(json.dumps({"event": "tool_result", "data": {"text": f"echo: {msg}"}}))\n'
        'print(json.dumps({"event": "done"}))\n'
        'sys.stdout.flush()\n'
    )
    return [_sys.executable, str(script)]
