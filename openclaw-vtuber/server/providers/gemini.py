"""PROV-03: Gemini ModelProvider (google-genai unified SDK)."""
from __future__ import annotations

import os
from functools import cached_property

DEFAULT_MODEL = "gemini-2.0-flash"


class GeminiProvider:
    name = "gemini"

    @cached_property
    def _client(self):
        from google import genai

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return None
        return genai.Client(api_key=api_key)

    async def complete(self, prompt: str, **kwargs) -> str:
        client = self._client
        if client is None:
            raise RuntimeError("GEMINI_API_KEY not set")
        model = kwargs.get("model") or os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)
        max_output_tokens = int(kwargs.get("max_tokens", 1024))
        resp = await client.aio.models.generate_content(
            model=model,
            contents=prompt,
            config={"maxOutputTokens": max_output_tokens},
        )
        return resp.text or ""

    async def health_check(self) -> bool:
        if self._client is None:
            return False
        try:
            await self.complete("ping", max_tokens=1)
            return True
        except Exception:
            return False


PROVIDER = GeminiProvider()
