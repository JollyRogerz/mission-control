"""INTEG-01 tests: Discord send-only integration.

Zero real Discord network calls — discord.Client is fully mocked.
"""
from __future__ import annotations

import asyncio
import importlib
import os
import sys
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# conftest.py already inserts server/ into sys.path, so plain imports work.
from adapters.integration import Integration
from integrations.discord.client import DiscordIntegration


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_fresh_integration() -> DiscordIntegration:
    """Return a brand-new DiscordIntegration with no shared state."""
    return DiscordIntegration()


def _build_discord_client_mock(*, ready: bool = True) -> MagicMock:
    """Build a minimal discord.Client mock that satisfies DiscordIntegration._ensure_connected."""
    client_mock = MagicMock()
    client_mock.is_ready.return_value = ready

    # Stub start() — we don't want it to actually block; returning a no-op coroutine.
    async def _start(_token):
        pass

    client_mock.start = _start
    return client_mock


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_protocol_satisfied():
    """INTEGRATION singleton satisfies the Integration Protocol."""
    from integrations.discord import INTEGRATION

    assert isinstance(INTEGRATION, Integration)


@pytest.mark.asyncio
async def test_health_false_without_token(monkeypatch):
    """health_check() returns False when DISCORD_BOT_TOKEN is not set."""
    monkeypatch.delenv("DISCORD_BOT_TOKEN", raising=False)
    integration = _make_fresh_integration()
    result = await integration.health_check()
    assert result is False


@pytest.mark.asyncio
async def test_send_rejects_invalid_channel():
    """send() raises ValueError for non-snowflake channel identifiers."""
    integration = _make_fresh_integration()
    with pytest.raises(ValueError, match="invalid Discord channel id"):
        await integration.send("bad", "hello")

    # Also test other non-snowflake forms.
    with pytest.raises(ValueError):
        await integration.send("@everyone", "oops")

    with pytest.raises(ValueError):
        await integration.send("123", "too short — only 3 digits")


@pytest.mark.asyncio
async def test_send_happy_path(monkeypatch):
    """send() calls channel.send() and returns a well-formed receipt dict."""
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "fake-token-for-testing")

    # Build a fake Message object.
    fake_msg = MagicMock()
    fake_msg.id = 111222333444555666
    fake_msg.created_at = datetime(2026, 5, 5, 12, 0, 0, tzinfo=timezone.utc)

    # Build a fake Channel object.
    fake_channel = MagicMock()
    fake_channel.id = 987654321012345678
    fake_channel.send = AsyncMock(return_value=fake_msg)

    # Build the client mock.
    client_mock = _build_discord_client_mock(ready=True)
    client_mock.get_channel.return_value = fake_channel

    # Patch discord.Client so __init__() gets our mock class.
    mock_discord_module = MagicMock()
    mock_discord_module.Intents.default.return_value = MagicMock()
    mock_discord_module.Client.return_value = client_mock

    integration = _make_fresh_integration()

    # Inject a pre-set _ready_event so we skip the actual wait_for.
    ready_event = asyncio.Event()
    ready_event.set()

    with patch.dict(sys.modules, {"discord": mock_discord_module}):
        # Patch asyncio.create_task so the background start() task is a no-op.
        with patch("asyncio.create_task", return_value=MagicMock()) as mock_task:
            # Pre-inject the ready event so wait_for returns immediately.
            integration._ready_event = ready_event

            # Pre-inject the client mock so _ensure_connected skips the boot path
            # (client.is_ready() returns True → short-circuits).
            integration._client = client_mock

            receipt = await integration.send("987654321012345678", "hello from Phase 4")

    assert receipt["message_id"] == str(fake_msg.id)
    assert receipt["channel_id"] == str(fake_channel.id)
    assert "timestamp" in receipt
    assert receipt["timestamp"] == "2026-05-05T12:00:00+00:00"
    fake_channel.send.assert_called_once_with("hello from Phase 4")


@pytest.mark.asyncio
async def test_appears_in_api(async_client, monkeypatch):
    """GET /api/integrations lists discord when DISCORD_BOT_TOKEN is set.

    We inject a DiscordIntegration instance directly into bridge_server.INTEGRATIONS
    (via sys.modules) so we avoid the sys.path package-name mismatch between the
    test environment (server/ on sys.path → "integrations") and the bridge's loader
    (repo root on sys.path → "server.integrations").
    """
    from integrations.discord.client import DiscordIntegration
    import sys

    bs = sys.modules["bridge_server"]
    discord_integ = DiscordIntegration()

    # Patch INTEGRATIONS to include discord alongside any already-registered entries.
    existing = dict(getattr(bs, "INTEGRATIONS", {}))
    existing["discord"] = discord_integ
    monkeypatch.setattr(bs, "INTEGRATIONS", existing)

    response = await async_client.get("/api/integrations")
    assert response.status_code == 200
    names = [item["name"] for item in response.json()]
    assert "discord" in names
