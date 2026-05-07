"""PROV-02 tests: OpenAIProvider satisfies ModelProvider Protocol.

Design notes:
- The module-level PROVIDER singleton uses cached_property for _client,
  so each test that exercises client behaviour creates a fresh OpenAIProvider()
  instance to avoid cached state leaking between tests.
- respx intercepts httpx calls made by the openai SDK (which uses httpx
  internally) so zero real network traffic is generated.
- test_loader_discovers and test_appears_in_api patch adapters.loader.PROVIDERS
  and bridge_server.PROVIDERS in-place to simulate discovery without reimporting
  the whole module graph.
"""
from __future__ import annotations

import sys

import pytest

from adapters.model_provider import ModelProvider
from providers.openai import OpenAIProvider, PROVIDER

# The Responses API endpoint used by openai SDK v2.x
RESPONSES_URL = "https://api.openai.com/v1/responses"

# Minimal JSON the openai SDK v2 parses into resp.output_text
HAPPY_RESPONSE_JSON = {
    "id": "resp_test123",
    "object": "response",
    "model": "gpt-4o-mini",
    "status": "completed",
    "output_text": "hello",
    "output": [
        {
            "type": "message",
            "id": "msg_test",
            "status": "completed",
            "role": "assistant",
            "content": [{"type": "output_text", "text": "hello"}],
        }
    ],
    "usage": {
        "input_tokens": 1,
        "output_tokens": 1,
        "total_tokens": 2,
    },
}


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
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    provider = OpenAIProvider()  # fresh instance — no cached _client
    result = await provider.health_check()
    assert result is False
    assert http_mock.calls.call_count == 0


# ---------------------------------------------------------------------------
# Test 3: complete() returns text on a mocked 200 response
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_complete_happy_path(monkeypatch, http_mock):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fake-key")
    provider = OpenAIProvider()  # fresh instance with key set

    http_mock.post(RESPONSES_URL).respond(
        json=HAPPY_RESPONSE_JSON,
    )

    result = await provider.complete("hi")
    assert result == "hello"


# ---------------------------------------------------------------------------
# Test 4: loader discovers "openai" when API key is set
# ---------------------------------------------------------------------------

def test_loader_discovers(monkeypatch):
    """_scan('providers') includes 'openai' when OPENAI_API_KEY is set.

    Note: during test runs, conftest.py inserts server/ into sys.path directly,
    so the importable package is 'providers' (not 'server.providers' which is
    only resolvable when bridge_server.py is the entry point).  This test uses
    the same path the scanner would see.
    """
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fake-key")

    # Force-reload so cached_property on the singleton is fresh under this key.
    for mod_name in list(sys.modules):
        if mod_name == "providers.openai" or mod_name == "server.providers.openai":
            del sys.modules[mod_name]

    from adapters.loader import _scan
    providers = _scan("providers", "PROVIDER", ModelProvider)
    assert "openai" in providers


# ---------------------------------------------------------------------------
# Test 5: GET /api/providers contains {"name": "openai"} when key is set
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_appears_in_api(async_client, monkeypatch):
    """GET /api/providers lists openai when OPENAI_API_KEY is set."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fake-key")

    # Patch bridge_server.PROVIDERS to include the openai provider directly.
    import bridge_server as bs
    from providers.openai import OpenAIProvider as OP
    fresh_provider = OP()
    original = dict(bs.PROVIDERS)
    bs.PROVIDERS["openai"] = fresh_provider
    try:
        resp = await async_client.get("/api/providers")
        assert resp.status_code == 200
        names = [item["name"] for item in resp.json()]
        assert "openai" in names
    finally:
        bs.PROVIDERS.clear()
        bs.PROVIDERS.update(original)
