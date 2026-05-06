"""ADAPT-07 / SC-3: env-var extraction defaults + override behavior."""
import sys
import pytest


@pytest.fixture
def fresh_bridge(monkeypatch):
    """Re-import bridge_server after env mutation so module-level constants re-evaluate."""
    # Drop cached module so the next import re-runs module-level code
    sys.modules.pop("bridge_server", None)
    yield
    sys.modules.pop("bridge_server", None)


def test_defaults(monkeypatch, fresh_bridge):
    # Clear any leaked env from the test environment
    for key in ("BRIDGE_HOST", "BRIDGE_PORT", "VTUBER_WS_URL",
                "DOCKER_BIN", "DOCKER_CONTAINER", "SESSIONS_DIR"):
        monkeypatch.delenv(key, raising=False)
    import bridge_server
    assert bridge_server.BRIDGE_HOST == "127.0.0.1"
    assert bridge_server.BRIDGE_PORT == 8100
    assert isinstance(bridge_server.BRIDGE_PORT, int)
    assert bridge_server.VTUBER_WS_URL == "ws://127.0.0.1:12393/client-ws"
    assert bridge_server.DOCKER_BIN == "docker"
    assert bridge_server.DOCKER_CONTAINER == "openclaw-gateway"
    assert "openclaw-gateway" in bridge_server.SESSIONS_DIR
    assert "mc-orchestrator" not in bridge_server.SESSIONS_DIR


def test_linux_portability(monkeypatch, fresh_bridge):
    for key in ("DOCKER_BIN", "DOCKER_CONTAINER", "SESSIONS_DIR"):
        monkeypatch.delenv(key, raising=False)
    import bridge_server
    assert "/Applications/Docker.app" not in bridge_server.DOCKER_BIN
    assert "/Applications/Docker.app" not in bridge_server.SESSIONS_DIR


def test_overrides(monkeypatch, fresh_bridge):
    monkeypatch.setenv("BRIDGE_HOST", "0.0.0.0")
    monkeypatch.setenv("BRIDGE_PORT", "9999")
    monkeypatch.setenv("VTUBER_WS_URL", "ws://example.com/ws")
    monkeypatch.setenv("DOCKER_BIN", "/usr/local/bin/docker")
    monkeypatch.setenv("DOCKER_CONTAINER", "my-gateway")
    monkeypatch.setenv("SESSIONS_DIR", "/var/sessions")
    import bridge_server
    assert bridge_server.BRIDGE_HOST == "0.0.0.0"
    assert bridge_server.BRIDGE_PORT == 9999
    assert bridge_server.VTUBER_WS_URL == "ws://example.com/ws"
    assert bridge_server.DOCKER_BIN == "/usr/local/bin/docker"
    assert bridge_server.DOCKER_CONTAINER == "my-gateway"
    assert bridge_server.SESSIONS_DIR == "/var/sessions"


def test_sessions_dir_tracks_container(monkeypatch, fresh_bridge):
    monkeypatch.delenv("SESSIONS_DIR", raising=False)
    monkeypatch.setenv("DOCKER_CONTAINER", "custom-name")
    import bridge_server
    # SESSIONS_DIR default should interpolate the (overridden) container name
    assert "custom-name" in bridge_server.SESSIONS_DIR


def test_bridge_port_is_int(monkeypatch, fresh_bridge):
    monkeypatch.setenv("BRIDGE_PORT", "12345")
    import bridge_server
    assert bridge_server.BRIDGE_PORT == 12345
    assert type(bridge_server.BRIDGE_PORT) is int
