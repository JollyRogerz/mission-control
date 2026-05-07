"""Regression: bridge_server _scan() uses bare package names (matches production sys.path).

Production runs `cd server && python bridge_server.py`, so `server/` is the
process cwd (and sys.path[0]), not a package. The loader must use bare names
("providers", "integrations", "runtime"), NOT dotted ("server.providers", ...),
or PROVIDERS/INTEGRATIONS/RUNTIMES will silently load empty.

This regression test was added after gsd-verifier discovered the dotted-name
bug at bridge_server.py:77-79 hidden by tests that called _scan() directly.
"""
import importlib
import os
import sys

import pytest


@pytest.fixture
def production_env(monkeypatch):
    """Set env vars so all five providers + both integrations + both runtimes load."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-anthropic-key")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("GOOGLE_API_KEY", "test-google-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")
    monkeypatch.setenv("OLLAMA_HOST", "http://127.0.0.1:11434")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "test-discord-token")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-telegram-token")
    monkeypatch.setenv("OPENCLAW_GATEWAY_WS", "ws://127.0.0.1:18789")


def _fresh_bridge():
    sys.modules.pop("bridge_server", None)
    return importlib.import_module("bridge_server")


def test_providers_load_in_production(production_env):
    bs = _fresh_bridge()
    assert len(bs.PROVIDERS) > 0, (
        f"PROVIDERS empty — _scan() failed to discover provider modules. "
        f"Likely cause: bridge_server.py uses dotted package name "
        f"('server.providers') instead of bare name ('providers'). "
        f"Loaded: {list(bs.PROVIDERS.keys())}"
    )
    expected = {"anthropic", "openai", "gemini", "openrouter", "ollama"}
    assert expected <= set(bs.PROVIDERS.keys()), (
        f"Missing providers. Expected ⊇ {expected}, got {set(bs.PROVIDERS.keys())}"
    )


def test_integrations_load_in_production(production_env):
    bs = _fresh_bridge()
    assert len(bs.INTEGRATIONS) > 0, (
        f"INTEGRATIONS empty — _scan() failed to discover integration modules. "
        f"Loaded: {list(bs.INTEGRATIONS.keys())}"
    )
    expected = {"discord", "telegram"}
    assert expected <= set(bs.INTEGRATIONS.keys()), (
        f"Missing integrations. Expected ⊇ {expected}, got {set(bs.INTEGRATIONS.keys())}"
    )


def test_runtimes_load_in_production(production_env):
    bs = _fresh_bridge()
    assert len(bs.RUNTIMES) > 0, (
        f"RUNTIMES empty — _scan() failed to discover runtime modules. "
        f"Loaded: {list(bs.RUNTIMES.keys())}"
    )
    expected = {"openclaw", "local"}
    assert expected <= set(bs.RUNTIMES.keys()), (
        f"Missing runtimes. Expected ⊇ {expected}, got {set(bs.RUNTIMES.keys())}"
    )
