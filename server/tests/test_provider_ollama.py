"""PROV-05: Tests for OllamaProvider.

Five tests:
1. test_protocol_satisfied         — PROVIDER is an instance of ModelProvider
2. test_health_false_without_host  — health_check() returns False when OLLAMA_HOST unset
3. test_complete_happy_path        — complete() returns text from /api/generate
4. test_health_true_when_tags_ok   — health_check() returns True when /api/tags → 200
5. test_loader_discovers           — _scan finds "ollama" in server.providers
"""
from __future__ import annotations

import os
import pytest
import httpx
import respx

from adapters import ModelProvider, _scan


# ---------------------------------------------------------------------------
# Helper: clear cached_property between tests so OLLAMA_HOST changes take effect
# ---------------------------------------------------------------------------

def _clear_client_cache(provider):
    """Remove the cached _client from the provider so it is re-evaluated."""
    provider.__dict__.pop("_client", None)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_protocol_satisfied():
    """PROVIDER must satisfy the ModelProvider protocol regardless of env."""
    from providers.ollama import PROVIDER
    assert isinstance(PROVIDER, ModelProvider)


@pytest.mark.asyncio
async def test_health_false_without_host(monkeypatch):
    """health_check() must return False when OLLAMA_HOST is not set."""
    from providers.ollama import PROVIDER
    monkeypatch.delenv("OLLAMA_HOST", raising=False)
    _clear_client_cache(PROVIDER)

    result = await PROVIDER.health_check()
    assert result is False


@pytest.mark.asyncio
async def test_complete_happy_path(monkeypatch):
    """complete('hi') should POST to /api/generate and return the 'response' field."""
    monkeypatch.setenv("OLLAMA_HOST", "http://127.0.0.1:11434")

    from providers.ollama import PROVIDER
    _clear_client_cache(PROVIDER)

    with respx.mock(assert_all_called=True) as router:
        router.post("http://127.0.0.1:11434/api/generate").mock(
            return_value=httpx.Response(
                200,
                json={"model": "llama3.2", "response": "hello", "done": True},
            )
        )
        result = await PROVIDER.complete("hi")

    assert result == "hello"


@pytest.mark.asyncio
async def test_health_true_when_tags_endpoint_responds(monkeypatch):
    """health_check() should return True when GET /api/tags responds 200."""
    monkeypatch.setenv("OLLAMA_HOST", "http://127.0.0.1:11434")

    from providers.ollama import PROVIDER
    _clear_client_cache(PROVIDER)

    with respx.mock(assert_all_called=True) as router:
        router.get("http://127.0.0.1:11434/api/tags").mock(
            return_value=httpx.Response(200, json={"models": []})
        )
        result = await PROVIDER.health_check()

    assert result is True


def test_loader_discovers(monkeypatch):
    """_scan('providers') must include 'ollama' when the module is present.

    conftest.py inserts the server/ directory into sys.path, so providers are
    importable as 'providers.<name>' (not 'server.providers.<name>').
    """
    # The loader discovers by isinstance, not by env var — PROVIDER always satisfies
    # the protocol. Set OLLAMA_HOST so that if loader ever calls health_check it won't
    # error, but discovery itself is purely structural.
    monkeypatch.setenv("OLLAMA_HOST", "http://127.0.0.1:11434")

    result = _scan("providers", "PROVIDER", ModelProvider)
    assert "ollama" in result
