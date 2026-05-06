"""Tests for INTEG-02: Telegram integration (httpx, send-only).

All 6 tests run with zero outbound HTTP calls — respx intercepts every request.
"""
import sys
from pathlib import Path
import pytest
import httpx
import respx

# Ensure server/ is on sys.path (conftest.py does this at session start, but
# direct test discovery may run this module before conftest is applied)
_SERVER_DIR = Path(__file__).parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from adapters.integration import Integration
from integrations.telegram.client import TelegramIntegration


def _fresh() -> TelegramIntegration:
    """Return a brand-new TelegramIntegration so cached_property values reset."""
    return TelegramIntegration()


# ---------------------------------------------------------------------------
# Test 1: Protocol satisfied
# ---------------------------------------------------------------------------

def test_protocol_satisfied():
    """INTEGRATION singleton must satisfy the Integration protocol."""
    from integrations.telegram import INTEGRATION
    assert isinstance(INTEGRATION, Integration)
    assert INTEGRATION.name == "telegram"


# ---------------------------------------------------------------------------
# Test 2: health_check returns False without a token
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_health_false_without_token(monkeypatch):
    """health_check() is False when TELEGRAM_BOT_TOKEN is absent."""
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    integ = _fresh()
    result = await integ.health_check()
    assert result is False


# ---------------------------------------------------------------------------
# Test 3: send() rejects invalid chat id
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_send_rejects_invalid_chat_id(monkeypatch):
    """send() with a chat id that fails the regex raises ValueError."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test")
    integ = _fresh()
    with pytest.raises(ValueError, match="invalid Telegram chat id"):
        await integ.send("not!a!chat", "x")


# ---------------------------------------------------------------------------
# Test 4: send() falls back to TELEGRAM_DEFAULT_CHAT_ID when channel is ""
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_send_uses_default_chat_id(monkeypatch, http_mock):
    """Empty channel resolves to TELEGRAM_DEFAULT_CHAT_ID."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test")
    monkeypatch.setenv("TELEGRAM_DEFAULT_CHAT_ID", "-1001234567890")

    fake_result = {
        "message_id": 42,
        "chat": {"id": -1001234567890, "type": "channel"},
        "text": "hi",
    }
    http_mock.post("https://api.telegram.org/bottest/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": fake_result})
    )

    integ = _fresh()
    receipt = await integ.send("", "hi")

    assert receipt["message_id"] == 42

    # Verify the request body used the default chat id
    call = http_mock.calls.last
    import json as _json
    body = _json.loads(call.request.content)
    assert body["chat_id"] == "-1001234567890"
    assert body["text"] == "hi"


# ---------------------------------------------------------------------------
# Test 5: send() uses the explicitly-passed channel
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_send_explicit_chat_id(monkeypatch, http_mock):
    """Explicit channel @somechan is sent as-is to the Bot API."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test")
    monkeypatch.delenv("TELEGRAM_DEFAULT_CHAT_ID", raising=False)

    fake_result = {
        "message_id": 7,
        "chat": {"id": 0, "type": "channel", "username": "somechan"},
        "text": "hello",
    }
    http_mock.post("https://api.telegram.org/bottest/sendMessage").mock(
        return_value=httpx.Response(200, json={"ok": True, "result": fake_result})
    )

    integ = _fresh()
    receipt = await integ.send("@somechan", "hello")

    assert receipt["message_id"] == 7

    import json as _json
    body = _json.loads(http_mock.calls.last.request.content)
    assert body["chat_id"] == "@somechan"


# ---------------------------------------------------------------------------
# Test 6: health_check returns True when getMe responds ok
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_health_true_when_getme_ok(monkeypatch, http_mock):
    """health_check() returns True when GET /getMe returns {"ok": true}."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test")

    http_mock.get("https://api.telegram.org/bottest/getMe").mock(
        return_value=httpx.Response(
            200,
            json={"ok": True, "result": {"id": 123, "is_bot": True, "username": "test_bot"}},
        )
    )

    integ = _fresh()
    result = await integ.health_check()

    assert result is True
