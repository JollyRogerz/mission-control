"""ADAPT-06 / SC-1 / SC-2: new bridge endpoints round-trip tests.

These tests use httpx.AsyncClient + ASGITransport so no actual HTTP socket is opened —
the FastAPI app is invoked in-process, which is the standard pattern for FastAPI testing.
WebSocket tests use starlette TestClient (httpx does not support WS in async mode reliably).
"""
import sys
import pytest
from httpx import AsyncClient, ASGITransport


@pytest.fixture
def fresh_bridge(tmp_path, monkeypatch):
    """Reload bridge_server with empty AGENTS / PROVIDERS / INTEGRATIONS / RUNTIMES.

    These endpoint tests assert empty-state behavior. Real adapter modules always
    register (their PROVIDER/INTEGRATION/RUNTIME singletons exist regardless of env),
    so we clear the dicts after import to isolate the empty-state contract.
    """
    monkeypatch.setenv("MC_AGENTS_DIR", str(tmp_path))
    monkeypatch.setenv("VTUBER_ENABLED", "false")  # prevent VTuber connect during lifespan
    sys.modules.pop("bridge_server", None)
    import bridge_server  # noqa: F401 — trigger module-level _scan + load_all
    bridge_server.PROVIDERS.clear()
    bridge_server.INTEGRATIONS.clear()
    bridge_server.RUNTIMES.clear()
    yield bridge_server
    sys.modules.pop("bridge_server", None)


@pytest.mark.asyncio
async def test_get_agents_empty(fresh_bridge):
    """GET /api/agents returns [] when MC_AGENTS_DIR is empty."""
    transport = ASGITransport(app=fresh_bridge.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/agents")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_get_agents_one_yaml(tmp_path, monkeypatch):
    """GET /api/agents returns one record when one YAML file exists in MC_AGENTS_DIR."""
    (tmp_path / "demo.yml").write_text(
        'id: demo\ndisplay_name: Demo\nemoji: "\U0001f916"\n', encoding="utf-8"
    )
    monkeypatch.setenv("MC_AGENTS_DIR", str(tmp_path))
    monkeypatch.setenv("VTUBER_ENABLED", "false")
    sys.modules.pop("bridge_server", None)
    import bridge_server
    transport = ASGITransport(app=bridge_server.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/agents")
    sys.modules.pop("bridge_server", None)
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["id"] == "demo"
    assert body[0]["display_name"] == "Demo"


@pytest.mark.asyncio
async def test_get_providers_empty(fresh_bridge):
    """GET /api/providers returns [] when no providers are discovered."""
    transport = ASGITransport(app=fresh_bridge.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/providers")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_get_integrations_empty(fresh_bridge):
    """GET /api/integrations returns [] when no integrations are discovered."""
    transport = ASGITransport(app=fresh_bridge.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/integrations")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_post_turn_503_when_no_runtime(fresh_bridge):
    """POST /api/turn returns 503 when RUNTIMES is empty."""
    transport = ASGITransport(app=fresh_bridge.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/api/turn", json={"agent_id": "x", "message": "hi"})
    assert r.status_code == 503
    assert "no runtime adapters" in r.json()["detail"]


@pytest.mark.asyncio
async def test_post_turn_200_with_stub_runtime(fresh_bridge):
    """Inject a stub runtime, hit POST /api/turn, expect 200 + turn_id."""
    class _StubRuntime:
        name = "stub"

        async def dispatch(self, agent_id, message, **kw):
            yield {"event": "started"}
            yield {"event": "token", "text": "hello"}
            yield {"event": "complete"}

        async def health_check(self):
            return True

    fresh_bridge.RUNTIMES["stub"] = _StubRuntime()
    try:
        transport = ASGITransport(app=fresh_bridge.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.post("/api/turn", json={"agent_id": "x", "message": "hi"})
        assert r.status_code == 200
        body = r.json()
        assert "turn_id" in body
        assert isinstance(body["turn_id"], str)
        assert len(body["turn_id"]) > 0
    finally:
        fresh_bridge.RUNTIMES.pop("stub", None)


@pytest.mark.asyncio
async def test_post_turn_unknown_runtime_404(fresh_bridge):
    """POST /api/turn returns 404 when named runtime is not registered."""
    class _StubRuntime:
        name = "stub"

        async def dispatch(self, agent_id, message, **kw):
            yield {"event": "ok"}

        async def health_check(self):
            return True

    fresh_bridge.RUNTIMES["stub"] = _StubRuntime()
    try:
        transport = ASGITransport(app=fresh_bridge.app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.post(
                "/api/turn",
                json={"agent_id": "x", "message": "hi", "runtime": "nope"},
            )
        assert r.status_code == 404
        assert "unknown runtime" in r.json()["detail"]
    finally:
        fresh_bridge.RUNTIMES.pop("stub", None)


@pytest.mark.asyncio
async def test_ws_turn_unknown_id_closes_4404(fresh_bridge):
    """WS connect with an unknown turn_id should close with code 4404."""
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    client = TestClient(fresh_bridge.app)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/ws/turn/does-not-exist") as ws:
            ws.receive_json()
    assert exc_info.value.code == 4404


@pytest.mark.asyncio
async def test_ws_turn_streams_events(fresh_bridge):
    """End-to-end: POST /api/turn with stub runtime, then receive events over WS."""
    from starlette.testclient import TestClient

    class _StubRuntime:
        name = "stub"

        async def dispatch(self, agent_id, message, **kw):
            yield {"event": "started"}
            yield {"event": "token", "text": "hi"}
            yield {"event": "complete"}

        async def health_check(self):
            return True

    fresh_bridge.RUNTIMES["stub"] = _StubRuntime()
    try:
        client = TestClient(fresh_bridge.app)
        r = client.post("/api/turn", json={"agent_id": "x", "message": "go"})
        assert r.status_code == 200
        turn_id = r.json()["turn_id"]

        events = []
        with client.websocket_connect(f"/ws/turn/{turn_id}") as ws:
            try:
                while True:
                    events.append(ws.receive_json())
            except Exception:
                pass

        assert {"event": "started"} in events
        assert any(e.get("event") == "token" for e in events)
        assert {"event": "complete"} in events
    finally:
        fresh_bridge.RUNTIMES.pop("stub", None)
