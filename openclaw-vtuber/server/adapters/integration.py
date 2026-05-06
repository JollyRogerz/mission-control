"""Integration Protocol — ADAPT-02.

This is a typing Protocol; concrete implementations live in
``server/integrations/<name>.py`` and must expose a module-level singleton::

    INTEGRATION = MyIntegration()

The directory-scan loader (Wave 2) calls ``isinstance(INTEGRATION, Integration)``
to verify each discovered module satisfies this contract before registering it.
"""

from typing import Protocol, runtime_checkable


@runtime_checkable
class Integration(Protocol):
    """Contract for an outbound messaging/integration adapter.

    Attributes:
        name: Unique identifier for this integration (e.g. ``"discord"``).

    Methods:
        send: Deliver *message* to *channel*; returns a delivery receipt dict.
        health_check: Return ``True`` if the integration is reachable and ready.
    """

    name: str

    async def send(self, channel: str, message: str, **kwargs) -> dict: ...

    async def health_check(self) -> bool: ...
