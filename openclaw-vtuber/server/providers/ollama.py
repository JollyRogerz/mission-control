"""PROV-05: Ollama ModelProvider (local/offline fallback)."""
from __future__ import annotations
import os
from functools import cached_property

import httpx

DEFAULT_HOST = "http://127.0.0.1:11434"
DEFAULT_MODEL = "llama3.2"


class OllamaProvider:
    name = "ollama"

    @cached_property
    def _client(self):
        # Discoverability rule (Phase 4 D-decision): Ollama is enabled iff OLLAMA_HOST is
        # explicitly set. We do NOT auto-enable it on the default localhost because most
        # devs won't have Ollama running and we'd pollute /api/providers.
        host = os.environ.get("OLLAMA_HOST")
        if not host:
            return None
        return httpx.AsyncClient(base_url=host, timeout=120.0)  # local LLM = generous timeout

    async def complete(self, prompt: str, **kwargs) -> str:
        client = self._client
        if client is None:
            raise RuntimeError("OLLAMA_HOST not set")
        model = kwargs.get("model") or os.environ.get("OLLAMA_MODEL", DEFAULT_MODEL)
        resp = await client.post(
            "/api/generate",
            json={"model": model, "prompt": prompt, "stream": False},
        )
        resp.raise_for_status()
        return resp.json().get("response", "")

    async def health_check(self) -> bool:
        if self._client is None:
            return False
        try:
            resp = await self._client.get("/api/tags")
            return resp.status_code == 200
        except Exception:
            return False


PROVIDER = OllamaProvider()
