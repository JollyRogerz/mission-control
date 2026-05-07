"""INTEG-01: Discord integration impl (send-only).

Connection model: lazy. On first send(), we start a background `discord.Client.start(token)`
task and wait for the `on_ready` event before returning. Subsequent send()s reuse the
already-running client. The client lives for the process lifetime.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from functools import cached_property
from typing import Optional

_CHANNEL_ID_RE = re.compile(r"^\d{17,20}$")  # Discord snowflake length range


class DiscordIntegration:
    name = "discord"

    def __init__(self) -> None:
        self._client = None  # type: Optional["discord.Client"]
        self._ready_event: Optional[asyncio.Event] = None
        self._runner_task: Optional[asyncio.Task] = None

    @cached_property
    def _token(self) -> str:
        return os.environ.get("DISCORD_BOT_TOKEN", "")

    async def _ensure_connected(self) -> None:
        if self._client is not None and self._client.is_ready():
            return
        if not self._token:
            raise RuntimeError("DISCORD_BOT_TOKEN not set")

        import discord  # lazy import — keeps module-import safe when token absent

        # Suppress verbose discord.py gateway logs that could expose token fragments.
        logging.getLogger("discord").setLevel(logging.WARNING)

        intents = discord.Intents.default()  # no message_content needed for send-only
        self._client = discord.Client(intents=intents)
        self._ready_event = asyncio.Event()

        @self._client.event
        async def on_ready():  # noqa: ANN202
            self._ready_event.set()

        # Start the gateway loop in the background.
        self._runner_task = asyncio.create_task(self._client.start(self._token))
        try:
            await asyncio.wait_for(self._ready_event.wait(), timeout=15.0)
        except asyncio.TimeoutError as exc:
            raise RuntimeError("Discord gateway connect timed out") from exc

    async def send(self, channel: str, message: str, **kwargs) -> dict:
        if not _CHANNEL_ID_RE.match(channel):
            raise ValueError(
                f"invalid Discord channel id: {channel!r} (expected 17-20 digit snowflake)"
            )
        await self._ensure_connected()
        ch = self._client.get_channel(int(channel)) or await self._client.fetch_channel(
            int(channel)
        )
        msg = await ch.send(message)
        return {
            "message_id": str(msg.id),
            "channel_id": str(ch.id),
            "timestamp": msg.created_at.isoformat(),
        }

    async def health_check(self) -> bool:
        if not self._token:
            return False
        try:
            await self._ensure_connected()
            return self._client is not None and self._client.is_ready()
        except Exception:
            return False


INTEGRATION = DiscordIntegration()
