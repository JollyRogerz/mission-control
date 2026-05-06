"""RuntimeAdapter Protocol — ADAPT-03.

This is a typing Protocol; concrete implementations live in
``server/runtime/<name>.py`` and must expose a module-level singleton::

    RUNTIME = MyRuntime()

The directory-scan loader (Wave 2) calls ``isinstance(RUNTIME, RuntimeAdapter)``
to verify each discovered module satisfies this contract before registering it.

Note: ``AsyncIterator`` is imported from ``typing`` (not ``collections.abc``) for
Python 3.10 compatibility.
"""

from typing import AsyncIterator, Protocol, runtime_checkable


@runtime_checkable
class RuntimeAdapter(Protocol):
    """Contract for an agent-runtime dispatch adapter.

    Attributes:
        name: Unique identifier for this runtime (e.g. ``"openclaw"``).

    Methods:
        dispatch: Send *message* to *agent_id* and yield streamed response events.
        health_check: Return ``True`` if the runtime is reachable and ready.
    """

    name: str

    async def dispatch(self, agent_id: str, message: str, **kwargs) -> AsyncIterator[dict]: ...

    async def health_check(self) -> bool: ...
