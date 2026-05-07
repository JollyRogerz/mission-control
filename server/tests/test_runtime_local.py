"""RUN-02: Tests for the LocalRuntime subprocess RuntimeAdapter.

All tests are fully offline — no network calls, no persistent processes.
The runner_script fixture writes a temp Python script for each parameterisation.
"""
import json
import sys
import textwrap
from pathlib import Path

import pytest

from adapters import RuntimeAdapter
from adapters.loader import RUNTIMES
from runtime.local import RUNTIME


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def runner_script(tmp_path: Path):
    """Write a Python helper that speaks the JSONL protocol; return the command string."""
    def _make(body: str) -> str:
        script = tmp_path / "runner.py"
        script.write_text("import sys, json\n" + textwrap.dedent(body))
        return f"{sys.executable} {script}"
    return _make


# ---------------------------------------------------------------------------
# Task 1 — Protocol + loader
# ---------------------------------------------------------------------------

def test_protocol_satisfied():
    assert isinstance(RUNTIME, RuntimeAdapter)


def test_loader_discovers():
    """Verify _scan finds LocalRuntime when 'runtime' package is scannable.

    In the test environment conftest.py puts server/ on sys.path, so the
    runtime package is importable as 'runtime' (not 'server.runtime').
    We call _scan directly with the correct dotted name for this environment.
    """
    from adapters.loader import _scan
    from adapters import RuntimeAdapter
    result = _scan("runtime", "RUNTIME", RuntimeAdapter)
    assert "local" in result


# ---------------------------------------------------------------------------
# Task 1 — health_check
# ---------------------------------------------------------------------------

def test_health_false_without_env(monkeypatch):
    monkeypatch.delenv("LOCAL_RUNTIME_CMD", raising=False)
    import asyncio
    assert asyncio.run(RUNTIME.health_check()) is False


def test_health_true_with_valid_executable(monkeypatch):
    monkeypatch.setenv("LOCAL_RUNTIME_CMD", f"{sys.executable} -c 'pass'")
    import asyncio
    assert asyncio.run(RUNTIME.health_check()) is True


# ---------------------------------------------------------------------------
# Task 2 — dispatch unit tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_dispatch_streams_events(monkeypatch, runner_script):
    cmd = runner_script('''
        line = sys.stdin.readline()
        req = json.loads(line)
        print(json.dumps({"event":"started","turn_id":req["turn_id"]}))
        print(json.dumps({"event":"token","data":{"text":"hi"}}))
        print(json.dumps({"event":"done"}))
        sys.stdout.flush()
    ''')
    monkeypatch.setenv("LOCAL_RUNTIME_CMD", cmd)
    events = [e async for e in RUNTIME.dispatch("agent-1", "ping")]
    assert events[-1] == {"event": "done"}
    assert any(e.get("event") == "started" for e in events)
    assert any(e.get("event") == "token" for e in events)


@pytest.mark.asyncio
async def test_dispatch_surfaces_stderr_on_nonzero_exit(monkeypatch, runner_script):
    cmd = runner_script('''
        sys.stderr.write("boom\\n")
        sys.exit(2)
    ''')
    monkeypatch.setenv("LOCAL_RUNTIME_CMD", cmd)
    events = [e async for e in RUNTIME.dispatch("agent-1", "ping")]
    assert any(e.get("event") == "error" and "boom" in e.get("detail", "") for e in events)


@pytest.mark.asyncio
async def test_dispatch_handles_invalid_json_line(monkeypatch, runner_script):
    cmd = runner_script('''
        sys.stdin.readline()
        sys.stdout.write("not json\\n")
        sys.stdout.write(json.dumps({"event":"done"}) + "\\n")
        sys.stdout.flush()
    ''')
    monkeypatch.setenv("LOCAL_RUNTIME_CMD", cmd)
    events = [e async for e in RUNTIME.dispatch("agent-1", "ping")]
    # First event should be the parse error, last should be done.
    assert events[0]["event"] == "error"
    assert events[-1] == {"event": "done"}


@pytest.mark.asyncio
async def test_dispatch_raises_without_env(monkeypatch):
    monkeypatch.delenv("LOCAL_RUNTIME_CMD", raising=False)
    with pytest.raises(RuntimeError, match="LOCAL_RUNTIME_CMD"):
        async for _ in RUNTIME.dispatch("a", "b"):
            pass


# ---------------------------------------------------------------------------
# Task 3 — E2E via /api/turn + /ws/turn/{turn_id}
# ---------------------------------------------------------------------------

def test_dispatch_e2e_via_http(monkeypatch, runner_script):
    """POST /api/turn → GET events via WebSocket; end-to-end through bridge_server.

    Uses sync TestClient as a context manager so a single anyio BlockingPortal
    (and its event loop) spans BOTH the POST and the WS. Without `with`, each
    request creates its own portal; the `_drive` task spawned during the POST
    is scheduled on that portal's per-request loop, and portal shutdown calls
    `_cancel_all_tasks()` — which deadlocks because the in-flight subprocess
    `readline()` doesn't respond cleanly to cancellation. Sharing the portal
    keeps the loop alive between calls and avoids that teardown path.
    """
    monkeypatch.delenv("GATEWAY_AUTH_TOKEN", raising=False)
    import bridge_server as bs
    from starlette.testclient import TestClient

    cmd = runner_script('''
        line = sys.stdin.readline()
        req = json.loads(line)
        print(json.dumps({"event":"started","turn_id":req["turn_id"]}))
        print(json.dumps({"event":"token","data":{"text":"hello"}}))
        print(json.dumps({"event":"done"}))
        sys.stdout.flush()
    ''')
    monkeypatch.setenv("LOCAL_RUNTIME_CMD", cmd)

    from runtime.local import RUNTIME as LOCAL_RT
    bs.RUNTIMES["local"] = LOCAL_RT

    received = []
    with TestClient(bs.app, raise_server_exceptions=True) as sync_client:
        resp = sync_client.post(
            "/api/turn",
            json={"agent_id": "a", "message": "hi", "runtime": "local"},
        )
        assert resp.status_code == 200, resp.text
        turn_id = resp.json()["turn_id"]
        assert turn_id

        with sync_client.websocket_connect(f"/ws/turn/{turn_id}") as ws:
            while True:
                data = ws.receive_json()
                received.append(data)
                if data.get("event") == "done":
                    break

    assert len(received) >= 2
    assert received[-1] == {"event": "done"}
