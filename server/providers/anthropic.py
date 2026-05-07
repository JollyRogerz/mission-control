"""PROV-01: Anthropic ModelProvider (Sonnet 4.6 default).

Security notes:
  - API key is read from env; never logged or returned in HTTP error responses.
  - health_check() uses max_tokens=1 (cheapest possible call).
    Callers should NOT poll health_check() more than once per minute to avoid
    burning quota unnecessarily.
"""
from __future__ import annotations

import os
from functools import cached_property

DEFAULT_MODEL = "claude-sonnet-4-5-20250929"


class AnthropicProvider:
    name = "anthropic"

    @cached_property
    def _client(self):
        import anthropic  # lazy: avoids ImportError at boot if SDK missing
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return None
        return anthropic.AsyncAnthropic(api_key=api_key)

    async def complete(self, prompt: str, **kwargs) -> str:
        client = self._client
        if client is None:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        model = kwargs.get("model") or os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL)
        max_tokens = int(kwargs.get("max_tokens", 1024))
        resp = await client.messages.create(
            model=model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        # resp.content is a list of TextBlock; join all text.
        return "".join(getattr(b, "text", "") for b in resp.content)

    async def health_check(self) -> bool:
        if self._client is None:
            return False
        try:
            await self.complete("ping", max_tokens=1)
            return True
        except Exception:
            return False


PROVIDER = AnthropicProvider()
