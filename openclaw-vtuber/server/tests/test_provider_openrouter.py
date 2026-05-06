"""PROV-04: Unit tests for OpenRouterProvider.

All outbound HTTP calls are intercepted by respx (via the http_mock fixture
from conftest.py). No real network traffic is made.
"""
from __future__ import annotations

import os

import httpx
import pytest
import respx

from adapters.model_provider import ModelProvider

# ---------------------------------------------------------------------------
# Shared mock response body (minimal valid OpenRouter/OpenAI chat completion)
# ---------------------------------------------------------------------------
_COMPLETION_BODY = {
    "id": "x",
    "object": "chat.completion",
    "created": 0,
    "model": "openrouter/auto",
    "choices": [
        {
            "message": {"role": "assistant", "content": "hello"},
            "finish_reason": "stop",
        }
    ],
    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
}

_API_URL = "https://openrouter.ai/api/v1/chat/completions"


def _make_provider(api_key: str = "test"):
    """Return a fresh OpenRouterProvider with a patched OPENROUTER_API_KEY.

    Uses a fresh instance (not the module-level singleton) so each test
    is isolated — the cached_property is not shared between instances.
    """
    from providers.openrouter import OpenRouterProvider

    os.environ["OPENROUTER_API_KEY"] = api_key
    try:
        provider = OpenRouterProvider()
        # Touch _client while env var is set so cached_property initialises.
        _ = provider._client
        return provider
    finally:
        del os.environ["OPENROUTER_API_KEY"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_complete_happy_path(http_mock):
    """complete() returns the assistant content string on a 200 response."""
    http_mock.post(_API_URL).mock(
        return_value=httpx.Response(200, json=_COMPLETION_BODY)
    )
    provider = _make_provider()
    result = await provider.complete("hi")
    assert result == "hello"


async def test_auth_header_present(http_mock):
    """The Authorization header carries the API key as a Bearer token."""
    route = http_mock.post(_API_URL).mock(
        return_value=httpx.Response(200, json=_COMPLETION_BODY)
    )
    provider = _make_provider(api_key="test")
    await provider.complete("hi")
    assert route.called
    request = route.calls.last.request
    assert request.headers["Authorization"] == "Bearer test"


async def test_no_api_key_returns_none_client():
    """_client is None when OPENROUTER_API_KEY is absent; module still imports."""
    from providers.openrouter import OpenRouterProvider

    os.environ.pop("OPENROUTER_API_KEY", None)
    provider = OpenRouterProvider()
    assert provider._client is None


async def test_health_check_true_on_success(http_mock):
    """health_check() returns True when the API responds with 200."""
    http_mock.post(_API_URL).mock(
        return_value=httpx.Response(200, json=_COMPLETION_BODY)
    )
    provider = _make_provider()
    assert await provider.health_check() is True


async def test_health_check_false_when_no_key():
    """health_check() returns False when OPENROUTER_API_KEY is not set."""
    from providers.openrouter import OpenRouterProvider

    os.environ.pop("OPENROUTER_API_KEY", None)
    provider = OpenRouterProvider()
    assert await provider.health_check() is False


async def test_provider_satisfies_protocol():
    """PROVIDER singleton satisfies the ModelProvider Protocol."""
    from providers.openrouter import PROVIDER

    assert isinstance(PROVIDER, ModelProvider)
