"""PROV-01 tests: AnthropicProvider satisfies ModelProvider Protocol.

Design notes:
- The module-level PROVIDER singleton uses cached_property for _client,
  so each test that exercises client behaviour creates a fresh AnthropicProvider()
  instance to avoid cached state leaking between tests.
- respx intercepts httpx calls made by the anthropic SDK (which uses httpx
  internally) so zero real network traffic is generated.
- test_loader_discovers and test_appears_in_api patch adapters.loader.PROVIDERS
  and bridge_server.PROVIDERS in-place to simulate discovery without reimporting
  the whole module graph.
"""
from __future__ import annotations

import importlib
import sys

import httpx
import pytest

import bridge_server as _bridge_server_module  # imported once at collection time
from adapters.model_provider import ModelProvider
from providers.anthropic import AnthropicProvider, PROVIDER


# ---------------------------------------------------------------------------
# Test 1: Protocol structural check
# ---------------------------------------------------------------------------

def test_protocol_satisfied():
    """PROVIDER singleton satisfies the ModelProvider Protocol."""
    assert isinstance(PROVIDER, ModelProvider)


# ---------------------------------------------------------------------------
# Test 2: health_check returns False with no API key (no HTTP calls made)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_health_false_without_api_key(monkeypatch, http_mock):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    provider = AnthropicProvider()  # fresh instance — no cached _client
    result = await provider.health_check()
    assert result is False
    assert http_mock.calls.call_count == 0


# ---------------------------------------------------------------------------
# Test 3: complete() returns text on a mocked 200 response
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_complete_happy_path(monkeypatch, http_mock):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    provider = AnthropicProvider()  # fresh instance with key set

    http_mock.post("https://api.anthropic.com/v1/messages").respond(
        json={
            "id": "msg_abc",
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": "hello"}],
            "model": "claude-sonnet-4-5-20250929",
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }
    )

    result = await provider.complete("hi")
    assert result == "hello"


# ---------------------------------------------------------------------------
# Test 4: loader discovers "anthropic" when API key is set
# ---------------------------------------------------------------------------

def test_loader_discovers(monkeypatch):
    """_scan('providers') includes 'anthropic' when ANTHROPIC_API_KEY is set.

    Note: during test runs, conftest.py inserts server/ into sys.path directly,
    so the importable package is 'providers' (not 'server.providers' which is
    only resolvable when bridge_server.py is the entry point).  This test uses
    the same path the scanner would see.
    """
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")

    # Force-reload so cached_property on the singleton is fresh under this key.
    for mod_name in list(sys.modules):
        if mod_name == "providers.anthropic" or mod_name == "server.providers.anthropic":
            del sys.modules[mod_name]

    from adapters.loader import _scan
    providers = _scan("providers", "PROVIDER", ModelProvider)
    assert "anthropic" in providers


# ---------------------------------------------------------------------------
# Test 5: GET /api/providers contains {"name": "anthropic"} when key is set
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_appears_in_api(monkeypatch):
    """GET /api/providers lists anthropic when ANTHROPIC_API_KEY is set.

    Patches _bridge_server_module.PROVIDERS — the module object captured at
    collection time — so the test is immune to fresh_bridge fixture teardowns
    that pop bridge_server from sys.modules mid-session.
    """
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")

    fresh_provider = AnthropicProvider()
    original = dict(_bridge_server_module.PROVIDERS)
    _bridge_server_module.PROVIDERS["anthropic"] = fresh_provider
    try:
        transport = httpx.ASGITransport(app=_bridge_server_module.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/providers")
        assert resp.status_code == 200
        names = [item["name"] for item in resp.json()]
        assert "anthropic" in names
    finally:
        _bridge_server_module.PROVIDERS.clear()
        _bridge_server_module.PROVIDERS.update(original)
