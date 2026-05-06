"""PROV-03: Unit tests for providers/gemini.py.

All tests run with zero outbound network calls — the google-genai async
generate_content method is patched via AsyncMock so no real HTTP is made.
"""
from __future__ import annotations

import importlib
import os
import sys
import types as builtin_types
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

# Ensure server/ is importable
SERVER_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SERVER_DIR))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_response(text: str) -> builtin_types.SimpleNamespace:
    """Return a fake GenerateContentResponse with a .text attribute."""
    return builtin_types.SimpleNamespace(text=text)


def _fresh_provider(api_key: str | None = "fake-gemini-key"):
    """Return a new GeminiProvider with a clean cached_property state.

    Re-importing the module is safest to avoid cached_property collisions
    across tests that change env vars.
    """
    # Remove any cached module so cached_property is reset
    for key in list(sys.modules.keys()):
        if "providers.gemini" in key or key == "providers.gemini":
            del sys.modules[key]

    env_patch = {}
    if api_key is not None:
        env_patch["GEMINI_API_KEY"] = api_key
    else:
        env_patch.pop("GEMINI_API_KEY", None)

    with patch.dict(os.environ, env_patch, clear=False):
        # Also remove key from env if api_key is None
        if api_key is None:
            os.environ.pop("GEMINI_API_KEY", None)
        from providers.gemini import GeminiProvider
        return GeminiProvider()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGeminiProviderComplete:
    """Happy-path and error-path tests for GeminiProvider.complete()."""

    @pytest.mark.asyncio
    async def test_complete_happy_path(self):
        """complete() returns the text from the mocked response."""
        provider = _fresh_provider(api_key="fake-key")

        mock_response = _make_response("hello")
        mock_generate = AsyncMock(return_value=mock_response)

        with patch.dict(os.environ, {"GEMINI_API_KEY": "fake-key"}):
            # Patch the async generate_content on the aio.models surface
            mock_aio_models = MagicMock()
            mock_aio_models.generate_content = mock_generate
            mock_aio = MagicMock()
            mock_aio.models = mock_aio_models

            mock_client = MagicMock()
            mock_client.aio = mock_aio

            # Bypass cached_property by setting __dict__ directly
            provider.__dict__["_client"] = mock_client

            result = await provider.complete("hi")

        assert result == "hello"
        mock_generate.assert_awaited_once()
        call_kwargs = mock_generate.call_args.kwargs
        assert call_kwargs["model"] == "gemini-2.0-flash"
        assert call_kwargs["contents"] == "hi"

    @pytest.mark.asyncio
    async def test_complete_uses_gemini_model_env_var(self):
        """complete() respects the GEMINI_MODEL env override."""
        provider = _fresh_provider(api_key="fake-key")

        mock_response = _make_response("world")
        mock_generate = AsyncMock(return_value=mock_response)

        mock_aio_models = MagicMock()
        mock_aio_models.generate_content = mock_generate
        mock_aio = MagicMock()
        mock_aio.models = mock_aio_models
        mock_client = MagicMock()
        mock_client.aio = mock_aio
        provider.__dict__["_client"] = mock_client

        with patch.dict(os.environ, {"GEMINI_MODEL": "gemini-2.5-pro"}):
            result = await provider.complete("test")

        assert result == "world"
        call_kwargs = mock_generate.call_args.kwargs
        assert call_kwargs["model"] == "gemini-2.5-pro"

    @pytest.mark.asyncio
    async def test_complete_uses_model_kwarg(self):
        """complete() respects the model= kwarg over the env var."""
        provider = _fresh_provider(api_key="fake-key")

        mock_response = _make_response("kwarg-model-result")
        mock_generate = AsyncMock(return_value=mock_response)

        mock_aio_models = MagicMock()
        mock_aio_models.generate_content = mock_generate
        mock_aio = MagicMock()
        mock_aio.models = mock_aio_models
        mock_client = MagicMock()
        mock_client.aio = mock_aio
        provider.__dict__["_client"] = mock_client

        with patch.dict(os.environ, {"GEMINI_MODEL": "gemini-2.5-pro"}):
            result = await provider.complete("test", model="gemini-1.5-flash")

        assert result == "kwarg-model-result"
        call_kwargs = mock_generate.call_args.kwargs
        assert call_kwargs["model"] == "gemini-1.5-flash"

    @pytest.mark.asyncio
    async def test_complete_raises_when_no_api_key(self):
        """complete() raises RuntimeError when GEMINI_API_KEY is absent."""
        # Ensure env var is not set
        env = {k: v for k, v in os.environ.items() if k != "GEMINI_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            # Re-import to get fresh provider with no key
            for key in list(sys.modules.keys()):
                if "providers.gemini" in key or key == "providers.gemini":
                    del sys.modules[key]
            from providers.gemini import GeminiProvider
            provider = GeminiProvider()

        with pytest.raises(RuntimeError, match="GEMINI_API_KEY not set"):
            await provider.complete("test")


class TestGeminiProviderHealthCheck:
    """Tests for GeminiProvider.health_check()."""

    @pytest.mark.asyncio
    async def test_health_check_returns_true_on_success(self):
        """health_check() returns True when complete() succeeds."""
        provider = _fresh_provider(api_key="fake-key")

        mock_response = _make_response("ok")
        mock_generate = AsyncMock(return_value=mock_response)

        mock_aio_models = MagicMock()
        mock_aio_models.generate_content = mock_generate
        mock_aio = MagicMock()
        mock_aio.models = mock_aio_models
        mock_client = MagicMock()
        mock_client.aio = mock_aio
        provider.__dict__["_client"] = mock_client

        result = await provider.health_check()

        assert result is True

    @pytest.mark.asyncio
    async def test_health_check_returns_false_when_no_key(self):
        """health_check() returns False when _client is None (no API key)."""
        env = {k: v for k, v in os.environ.items() if k != "GEMINI_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            for key in list(sys.modules.keys()):
                if "providers.gemini" in key or key == "providers.gemini":
                    del sys.modules[key]
            from providers.gemini import GeminiProvider
            provider = GeminiProvider()

        result = await provider.health_check()
        assert result is False
