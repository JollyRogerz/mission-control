"""PROV-02: OpenAI ModelProvider (Responses API, SDK v2.x)."""
from __future__ import annotations
import os
from functools import cached_property

DEFAULT_MODEL = "gpt-4o-mini"


class OpenAIProvider:
    name = "openai"

    @cached_property
    def _client(self):
        import openai
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return None
        return openai.AsyncOpenAI(api_key=api_key)

    async def complete(self, prompt: str, **kwargs) -> str:
        client = self._client
        if client is None:
            raise RuntimeError("OPENAI_API_KEY not set")
        model = kwargs.get("model") or os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)
        max_output_tokens = int(kwargs.get("max_tokens", 1024))
        resp = await client.responses.create(
            model=model,
            input=prompt,
            max_output_tokens=max_output_tokens,
        )
        return resp.output_text or ""

    async def health_check(self) -> bool:
        if self._client is None:
            return False
        try:
            await self.complete("ping", max_tokens=1)
            return True
        except Exception:
            return False


PROVIDER = OpenAIProvider()
