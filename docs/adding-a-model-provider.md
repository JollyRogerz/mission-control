# Adding a Model Provider

A model provider is any backend that turns a prompt into a completion: Anthropic, OpenAI, Gemini, OpenRouter, Ollama — or your own. Add one by writing a single Python module that satisfies the `ModelProvider` Protocol.

## The Protocol

Source: `server/adapters/model_provider.py`

```python
from typing import Protocol, runtime_checkable


@runtime_checkable
class ModelProvider(Protocol):
    name: str

    async def complete(self, prompt: str, **kwargs) -> str: ...

    async def health_check(self) -> bool: ...
```

Three requirements:

1. **`name`** — unique string ID (e.g. `"anthropic"`, `"my-llm"`)
2. **`async def complete(prompt, **kwargs) -> str`** — return the completion text
3. **`async def health_check() -> bool`** — return `True` if reachable & ready

## Where it lives

- Source path: `server/providers/<name>.py`
- The directory-scan loader (`server/adapters/loader.py`) imports each submodule and verifies its module-level `PROVIDER` singleton via `isinstance(PROVIDER, ModelProvider)` — modules that fail the check are logged and skipped (one broken adapter never blocks boot)
- The registered provider name comes from the `name` attribute on the singleton (falls back to the file basename if missing)
- No manual registration step: drop the file, restart, done

## Step-by-step

### 1. Create the module

`server/providers/myllm.py`:

```python
"""My LLM provider — example template."""
from __future__ import annotations

import os
from typing import Any

import httpx

DEFAULT_MODEL = "myllm-medium"


class MyLLMProvider:
    name = "myllm"

    async def complete(self, prompt: str, **kwargs: Any) -> str:
        api_key = os.environ.get("MYLLM_API_KEY")
        if not api_key:
            raise RuntimeError("MYLLM_API_KEY not set")
        model = kwargs.get("model") or os.environ.get("MYLLM_MODEL", DEFAULT_MODEL)
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://api.myllm.example/v1/complete",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "prompt": prompt},
            )
            resp.raise_for_status()
            return resp.json()["text"]

    async def health_check(self) -> bool:
        if not os.environ.get("MYLLM_API_KEY"):
            return False
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get("https://api.myllm.example/v1/health")
                return r.status_code == 200
        except Exception:
            return False


PROVIDER = MyLLMProvider()
```

### 2. Document its env vars

Add to `.env.example`:

```
# My LLM
MYLLM_API_KEY=
MYLLM_MODEL=myllm-medium
```

### 3. Test it

The test pattern below mirrors `server/tests/test_provider_anthropic.py` and uses the `http_mock` (respx) and `monkeypatch` fixtures defined in `server/tests/conftest.py`.

```python
import pytest

from adapters.model_provider import ModelProvider
from providers.myllm import PROVIDER, MyLLMProvider


def test_protocol_satisfied():
    assert isinstance(PROVIDER, ModelProvider)


@pytest.mark.asyncio
async def test_health_false_without_key(monkeypatch, http_mock):
    monkeypatch.delenv("MYLLM_API_KEY", raising=False)
    provider = MyLLMProvider()
    assert await provider.health_check() is False
    assert http_mock.calls.call_count == 0


@pytest.mark.asyncio
async def test_complete_happy_path(monkeypatch, http_mock):
    monkeypatch.setenv("MYLLM_API_KEY", "test-key-not-real")
    provider = MyLLMProvider()

    http_mock.post("https://api.myllm.example/v1/complete").respond(
        json={"text": "hello"}
    )

    assert await provider.complete("hi") == "hello"


def test_loader_discovers(monkeypatch):
    monkeypatch.setenv("MYLLM_API_KEY", "test-key-not-real")
    from adapters.loader import _scan
    providers = _scan("providers", "PROVIDER", ModelProvider)
    assert "myllm" in providers
```

### 4. Verify discovery

```bash
./mission-control.sh
curl -s http://127.0.0.1:8100/api/providers | jq '.[] | .name'
# → "anthropic", "openai", "gemini", "openrouter", "ollama", "myllm"
```

## Reference: built-in providers

| Provider | File | Env vars | Default model |
|---|---|---|---|
| `anthropic` | `server/providers/anthropic.py` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | `claude-sonnet-4-5-20250929` |
| `openai` | `server/providers/openai.py` | `OPENAI_API_KEY`, `OPENAI_MODEL` | (model required per call) |
| `gemini` | `server/providers/gemini.py` | `GEMINI_API_KEY`, `GEMINI_MODEL` | (model required per call) |
| `openrouter` | `server/providers/openrouter.py` | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | (model required per call) |
| `ollama` | `server/providers/ollama.py` | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | (model required per call) |

## Pitfalls

- **Forgetting `PROVIDER = MyLLMProvider()`** — without the module-level singleton, the loader cannot discover the module
- **Synchronous `complete()` or `health_check()`** — both methods MUST be `async`; the bridge awaits them
- **Hardcoding the API key** — always read from `os.environ`; gitleaks will block any literal that looks like a key
- **Returning a non-string from `complete()`** — the bridge concatenates the result; return `str` only
- **Logging the API key in error responses** — never include the raw key in raised exceptions or HTTP error bodies
