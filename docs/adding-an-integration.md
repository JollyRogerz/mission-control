# Adding an Integration

An integration sends messages from Mission Control to an external surface — Discord, Telegram, Slack, your own dashboard. Add one by writing a single Python module that satisfies the `Integration` Protocol.

## The Protocol
Source: `openclaw-vtuber/server/adapters/integration.py`
```python
from typing import Protocol, runtime_checkable

@runtime_checkable
class Integration(Protocol):
    name: str
    async def send(self, channel: str, message: str, **kwargs) -> dict: ...
    async def health_check(self) -> bool: ...
```

Three requirements:
1. **`name`** — unique string ID (e.g. `"discord"`, `"slack"`)
2. **`send(channel, message, **kwargs)`** — async; deliver `message` to `channel`; return delivery receipt dict (e.g. `{"message_id": 42, "channel": "..."}`)
3. **`health_check()`** — async; return `True` if reachable & ready

Send-only: the v1 Protocol does NOT define inbound webhooks — receiving messages is out of scope.

## Where it lives
- Source: `openclaw-vtuber/server/integrations/<name>.py`
- Loader scans this directory, imports each module, and verifies its module-level `INTEGRATION` satisfies the Protocol via `isinstance(INTEGRATION, Integration)`
- File basename = the registered integration name

## Step-by-step

### 1. Create the module
`openclaw-vtuber/server/integrations/slack.py`:
```python
"""Slack integration — example template."""
from __future__ import annotations
import os
from typing import Any
import httpx


class SlackIntegration:
    name = "slack"

    async def send(self, channel: str, message: str, **kwargs: Any) -> dict:
        token = os.environ.get("SLACK_BOT_TOKEN")
        if not token:
            raise RuntimeError("SLACK_BOT_TOKEN not set")
        target = channel or os.environ.get("SLACK_DEFAULT_CHANNEL", "")
        if not target:
            raise ValueError("Slack channel empty and SLACK_DEFAULT_CHANNEL unset")

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://slack.com/api/chat.postMessage",
                headers={"Authorization": f"Bearer {token}"},
                json={"channel": target, "text": message},
            )
            resp.raise_for_status()
            data = resp.json()
            if not data.get("ok"):
                raise RuntimeError(f"Slack API error: {data.get('error')}")
            return {
                "message_id": data["ts"],
                "channel": data["channel"],
            }

    async def health_check(self) -> bool:
        if not os.environ.get("SLACK_BOT_TOKEN"):
            return False
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.post(
                    "https://slack.com/api/auth.test",
                    headers={"Authorization": f"Bearer {os.environ['SLACK_BOT_TOKEN']}"},
                )
                return r.status_code == 200 and r.json().get("ok") is True
        except Exception:
            return False


INTEGRATION = SlackIntegration()
```

### 2. Document its env vars
Add to `.env.example`:
```
# Slack
SLACK_BOT_TOKEN=
SLACK_DEFAULT_CHANNEL=
```

### 3. Test it
```python
import pytest
from server.integrations.slack import INTEGRATION

@pytest.mark.asyncio
async def test_health_false_without_token(monkeypatch):
    monkeypatch.delenv("SLACK_BOT_TOKEN", raising=False)
    assert await INTEGRATION.health_check() is False

@pytest.mark.asyncio
async def test_send_happy_path(monkeypatch, http_mock):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "test")
    http_mock.post("https://slack.com/api/chat.postMessage").respond(
        json={"ok": True, "ts": "1234.5", "channel": "C1"}
    )
    receipt = await INTEGRATION.send("C1", "hi")
    assert receipt["message_id"] == "1234.5"

@pytest.mark.asyncio
async def test_send_rejects_empty_channel(monkeypatch):
    monkeypatch.setenv("SLACK_BOT_TOKEN", "test")
    monkeypatch.delenv("SLACK_DEFAULT_CHANNEL", raising=False)
    with pytest.raises(ValueError):
        await INTEGRATION.send("", "hi")
```

### 4. Verify discovery
```bash
./mission-control.sh
curl -s http://127.0.0.1:8100/api/integrations | jq '.[] | .name'
# → "discord", "telegram", "slack"
```

## Reference: built-in integrations
| Integration | File | Env vars | Default channel fallback |
|---|---|---|---|
| `discord` | `server/integrations/discord.py` | `DISCORD_BOT_TOKEN` | (none — channel required per send) |
| `telegram` | `server/integrations/telegram.py` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID` | `TELEGRAM_DEFAULT_CHAT_ID` |

## Channel-string conventions
- `discord`: numeric channel ID as string (e.g. `"1234567890"`)
- `telegram`: chat ID (negative for groups/channels, e.g. `"-1001234567890"`); empty string falls back to `TELEGRAM_DEFAULT_CHAT_ID`
- Custom integrations: define your own; document in the module docstring

## Pitfalls
- **Forgetting `INTEGRATION = SlackIntegration()`** — without the singleton, the loader cannot discover the module
- **Returning `None` from `send()`** — the bridge expects a dict receipt; return `{}` if you have no useful metadata
- **Hardcoding channel IDs** — accept `channel` as input and fall back to env var; never bake a chat ID into source
- **Synchronous `send()`** — must be `async`
