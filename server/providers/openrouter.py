"""PROV-04: OpenRouter ModelProvider (HTTP, OpenAI-compatible).

Security note: The Authorization header carries the OPENROUTER_API_KEY.
httpx does not log headers by default. Do NOT enable HTTPX_LOG_LEVEL=DEBUG
in production environments as it would expose the bearer token in logs.
"""
from __future__ import annotations

import os
from functools import cached_property

import httpx

DEFAULT_MODEL = "openrouter/auto"
BASE_URL = "https://openrouter.ai/api/v1"


class OpenRouterProvider:
    """ModelProvider implementation for OpenRouter (OpenAI-compatible REST API)."""

    name = "openrouter"

    @cached_property
    def _client(self) -> httpx.AsyncClient | None:
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            return None
        # HTTP-Referer and X-Title are recommended by OpenRouter for analytics;
        # they are harmless if omitted and contain no user data.
        return httpx.AsyncClient(
            base_url=BASE_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": os.environ.get(
                    "OPENROUTER_REFERER", "https://openclaw.local"
                ),
                "X-Title": os.environ.get(
                    "OPENROUTER_APP_NAME", "OpenClaw Mission Control"
                ),
            },
            timeout=60.0,
        )

    async def complete(self, prompt: str, **kwargs) -> str:
        """Send *prompt* to OpenRouter and return the assistant's reply text."""
        client = self._client
        if client is None:
            raise RuntimeError("OPENROUTER_API_KEY not set")
        model = kwargs.get("model") or os.environ.get("OPENROUTER_MODEL", DEFAULT_MODEL)
        max_tokens = int(kwargs.get("max_tokens", 1024))
        resp = await client.post(
            "/chat/completions",
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"] or ""

    async def health_check(self) -> bool:
        """Return True iff a minimal one-token completion succeeds."""
        if self._client is None:
            return False
        try:
            await self.complete("ping", max_tokens=1)
            return True
        except Exception:
            return False


PROVIDER = OpenRouterProvider()
