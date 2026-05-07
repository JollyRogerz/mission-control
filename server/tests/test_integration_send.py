"""Tests for POST /api/integration/send — empty-state contract (Phase 4, W0).

These tests verify the endpoint's behaviour before any concrete Integration
is registered.  Concrete-provider tests live in W2 plans.

Note on monkeypatching: bridge_server is session-scoped (bridge_app fixture).
test_new_endpoints.py::fresh_bridge reloads it between tests, which means the
module object in sys.modules may differ from the top-level import.  We always
patch via sys.modules["bridge_server"] to guarantee we're mutating the same
module object the running async_client fixture's app is bound to.
"""
import sys
import pytest


def _live_bridge():
    """Return the currently active bridge_server module object."""
    return sys.modules["bridge_server"]


@pytest.mark.asyncio
async def test_integration_send_503_when_no_integrations(async_client, monkeypatch):
    """Returns 503 when INTEGRATIONS registry is empty."""
    bs = _live_bridge()
    monkeypatch.setattr(bs, "INTEGRATIONS", {})
    resp = await async_client.post(
        "/api/integration/send",
        json={"integration": "discord", "channel": "123", "message": "hello"},
    )
    assert resp.status_code == 503
    assert resp.json()["detail"] == "no integrations registered"


@pytest.mark.asyncio
async def test_integration_send_404_for_unknown_integration(async_client, monkeypatch):
    """Returns 404 when the named integration is not in the registry.

    We seed INTEGRATIONS with a dummy entry so the 503 branch is not hit,
    then request a name that is not present.
    """
    # Minimal stub that satisfies isinstance(_, Integration)
    class _FakeInteg:
        name = "dummy"

        async def send(self, channel: str, message: str, **kwargs) -> dict:  # pragma: no cover
            return {}

        async def health_check(self) -> bool:  # pragma: no cover
            return True

    bs = _live_bridge()
    monkeypatch.setattr(bs, "INTEGRATIONS", {"dummy": _FakeInteg()})
    resp = await async_client.post(
        "/api/integration/send",
        json={"integration": "nonexistent", "channel": "c", "message": "m"},
    )
    assert resp.status_code == 404
    assert "nonexistent" in resp.json()["detail"]
