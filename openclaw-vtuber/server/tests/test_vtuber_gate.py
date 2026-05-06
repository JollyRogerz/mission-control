"""ADAPT-08 / SC-4: VTUBER_ENABLED gate.

The Wave 4 gate must default to OFF and must prevent any VTuber WebSocket open
during normal startup when the flag is unset.
"""
import sys
import pytest


@pytest.fixture
def fresh_bridge():
    sys.modules.pop("bridge_server", None)
    yield
    sys.modules.pop("bridge_server", None)


def test_vtuber_enabled_default_false(monkeypatch, fresh_bridge):
    monkeypatch.delenv("VTUBER_ENABLED", raising=False)
    import bridge_server
    assert bridge_server.VTUBER_ENABLED is False


@pytest.mark.parametrize("val,expected", [
    ("true", True),
    ("True", True),
    ("TRUE", True),
    ("1", True),
    ("yes", True),
    ("on", True),
    ("false", False),
    ("False", False),
    ("0", False),
    ("no", False),
    ("", False),
    ("garbage", False),
])
def test_vtuber_enabled_parsing(monkeypatch, fresh_bridge, val, expected):
    monkeypatch.setenv("VTUBER_ENABLED", val)
    import bridge_server
    assert bridge_server.VTUBER_ENABLED is expected, f"VTUBER_ENABLED={val!r} → {bridge_server.VTUBER_ENABLED}"


@pytest.mark.asyncio
async def test_lifespan_does_not_open_vtuber_socket_when_disabled(monkeypatch, fresh_bridge):
    """If VTUBER_ENABLED is unset/false, the lifespan must not call websockets.connect."""
    monkeypatch.delenv("VTUBER_ENABLED", raising=False)

    # Sentinel: replace websockets.connect with a function that fails the test
    import websockets
    def _fail(*args, **kwargs):
        raise AssertionError(
            f"websockets.connect was called with VTUBER_ENABLED disabled: {args} {kwargs}"
        )
    monkeypatch.setattr(websockets, "connect", _fail)

    import bridge_server
    # Run the lifespan context (FastAPI lifespan is a callable returning an async ctx mgr)
    async with bridge_server.app.router.lifespan_context(bridge_server.app):
        # If the gate is broken, the assertion above will fire during startup
        pass
