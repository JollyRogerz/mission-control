"""INTEG-02: Telegram integration (httpx, send-only)."""
from __future__ import annotations
import os
import re
from functools import cached_property

import httpx

_CHAT_ID_RE = re.compile(r"^(@\w{5,32}|-?\d{1,19})$")  # @username OR signed int
_API_BASE = "https://api.telegram.org"


class TelegramIntegration:
    name = "telegram"

    @cached_property
    def _token(self) -> str:
        return os.environ.get("TELEGRAM_BOT_TOKEN", "")

    @cached_property
    def _client(self) -> httpx.AsyncClient | None:
        if not self._token:
            return None
        return httpx.AsyncClient(base_url=f"{_API_BASE}/bot{self._token}", timeout=30.0)

    def _resolve_chat(self, channel: str) -> str:
        if not channel:
            channel = os.environ.get("TELEGRAM_DEFAULT_CHAT_ID", "")
        if not channel:
            raise ValueError("Telegram channel empty and TELEGRAM_DEFAULT_CHAT_ID unset")
        if not _CHAT_ID_RE.match(channel):
            raise ValueError(f"invalid Telegram chat id: {channel!r}")
        return channel

    async def send(self, channel: str, message: str, **kwargs) -> dict:
        client = self._client
        if client is None:
            raise RuntimeError("TELEGRAM_BOT_TOKEN not set")
        chat = self._resolve_chat(channel)
        payload = {"chat_id": chat, "text": message}
        if "parse_mode" in kwargs:
            payload["parse_mode"] = kwargs["parse_mode"]
        resp = await client.post("/sendMessage", json=payload)
        data = resp.json()
        if not data.get("ok"):
            # Sanitize: don't echo raw Telegram error in case it contains the token in URL form
            raise RuntimeError(
                f"telegram send failed: {data.get('error_code')} "
                f"{data.get('description', '')[:200]}"
            )
        return data["result"]

    async def health_check(self) -> bool:
        client = self._client
        if client is None:
            return False
        try:
            resp = await client.get("/getMe")
            return resp.status_code == 200 and resp.json().get("ok") is True
        except Exception:
            return False


INTEGRATION = TelegramIntegration()
