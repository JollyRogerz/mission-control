"""ModelProvider Protocol — ADAPT-01.

This is a typing Protocol; concrete implementations live in
``server/providers/<name>.py`` and must expose a module-level singleton::

    PROVIDER = MyProvider()

The directory-scan loader (Wave 2) calls ``isinstance(PROVIDER, ModelProvider)``
to verify each discovered module satisfies this contract before registering it.
"""

from typing import Protocol, runtime_checkable


@runtime_checkable
class ModelProvider(Protocol):
    """Contract for a model/LLM backend adapter.

    Attributes:
        name: Unique identifier for this provider (e.g. ``"anthropic"``).

    Methods:
        complete: Generate a completion for *prompt*; returns the response text.
        health_check: Return ``True`` if the provider is reachable and ready.
    """

    name: str

    async def complete(self, prompt: str, **kwargs) -> str: ...

    async def health_check(self) -> bool: ...
