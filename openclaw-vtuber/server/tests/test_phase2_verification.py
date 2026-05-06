"""Phase 2 verification: one pytest per success criterion.

This module IS the phase-completion contract. If all 5 tests pass, Phase 2 is done.
If any test fails, the failing wave plan must be revised — do NOT patch this file
to make it pass.

Mapping:
    test_sc1_agents_endpoint              -> SC-1 (Waves 2 + 5)
    test_sc2_providers_and_integrations   -> SC-2 (Waves 2 + 5)
    test_sc3_docker_env_vars              -> SC-3 (Wave 3)
    test_sc4_vtuber_default_off           -> SC-4 (Wave 4, part A: default value)
    test_sc4_vtuber_gate_blocks_socket    -> SC-4 (Wave 4, part B: lifespan sentinel)
    test_sc5_canvas_hygiene               -> SC-5 (Wave 6, plus Wave 0 guards)
    test_d7_d12_legacy_routes_still_registered -> D7/D12 regression guard
"""
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from httpx import AsyncClient, ASGITransport

# Resolve project paths once
SERVER_DIR = Path(__file__).resolve().parent.parent
# REPO_ROOT = openclaw-vtuber/  (parent of server/)
REPO_ROOT = SERVER_DIR.parent.parent
BRIDGE_PY = SERVER_DIR / "bridge_server.py"
GUARD_CONTENT_TYPE = SERVER_DIR / "tests" / "guard_content_type.sh"
GUARD_NO_SYNC_XHR = SERVER_DIR / "tests" / "guard_no_sync_xhr.sh"


@pytest.fixture
def fresh_bridge(tmp_path, monkeypatch):
    """Reload bridge_server with isolated env so tests are deterministic."""
    monkeypatch.setenv("MC_AGENTS_DIR", str(tmp_path))
    monkeypatch.setenv("VTUBER_ENABLED", "false")
    monkeypatch.delenv("DOCKER_BIN", raising=False)
    monkeypatch.delenv("DOCKER_CONTAINER", raising=False)
    monkeypatch.delenv("SESSIONS_DIR", raising=False)
    sys.modules.pop("bridge_server", None)
    import bridge_server
    yield bridge_server
    sys.modules.pop("bridge_server", None)


# ---------- SC-1 ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_sc1_agents_endpoint(tmp_path, monkeypatch):
    """SC-1: GET /api/agents returns list loaded from MC_AGENTS_DIR/*.yml."""
    (tmp_path / "smoke.yml").write_text(
        'id: smoke\ndisplay_name: Smoke Test Agent\n', encoding="utf-8"
    )
    monkeypatch.setenv("MC_AGENTS_DIR", str(tmp_path))
    monkeypatch.setenv("VTUBER_ENABLED", "false")
    sys.modules.pop("bridge_server", None)
    import bridge_server

    transport = ASGITransport(app=bridge_server.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/agents")
    assert r.status_code == 200, f"SC-1 failed: status {r.status_code}"
    body = r.json()
    assert isinstance(body, list), f"SC-1 failed: response is {type(body).__name__}, not list"
    ids = {a["id"] for a in body}
    assert "smoke" in ids, f"SC-1 failed: smoke agent not in {ids} (YAML loader broken?)"
    sys.modules.pop("bridge_server", None)


# ---------- SC-2 ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_sc2_providers_and_integrations(fresh_bridge):
    """SC-2: GET /api/providers + /api/integrations both 200 + list (via _scan)."""
    transport = ASGITransport(app=fresh_bridge.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        rp = await client.get("/api/providers")
        ri = await client.get("/api/integrations")
    assert rp.status_code == 200, f"SC-2 failed: /api/providers status {rp.status_code}"
    assert ri.status_code == 200, f"SC-2 failed: /api/integrations status {ri.status_code}"
    assert isinstance(rp.json(), list), "SC-2 failed: /api/providers not a list"
    assert isinstance(ri.json(), list), "SC-2 failed: /api/integrations not a list"
    # Phase 2 leaves these empty; Phase 4 populates. Empty list IS a pass for SC-2.

    # Bonus: the singletons must come from _scan() not from a hardcoded import list.
    # We verify by grepping the source (cheap structural check).
    # Production uses bare package names ("providers") because server/ is sys.path[0]
    # when bridge_server.py runs as `cd server && python bridge_server.py`. Dotted
    # names ("server.providers") would not resolve and silently load empty.
    src = BRIDGE_PY.read_text(encoding="utf-8")
    assert '_scan("providers"' in src or "_scan('providers'" in src, \
        "SC-2 failed: PROVIDERS not assigned from _scan('providers', ...)"
    assert '_scan("integrations"' in src or "_scan('integrations'" in src, \
        "SC-2 failed: INTEGRATIONS not assigned from _scan('integrations', ...)"


# ---------- SC-3 ---------------------------------------------------------------

def test_sc3_docker_env_vars(fresh_bridge):
    """SC-3: Docker constants Linux-portable; no macOS or Horizon-specific literals."""
    # Defaults
    assert fresh_bridge.DOCKER_BIN == "docker", \
        f"SC-3 failed: DOCKER_BIN default is {fresh_bridge.DOCKER_BIN!r}, expected 'docker'"
    assert fresh_bridge.DOCKER_CONTAINER == "openclaw-gateway", \
        f"SC-3 failed: DOCKER_CONTAINER default is {fresh_bridge.DOCKER_CONTAINER!r} " \
        f"(expected 'openclaw-gateway' per D8)"
    assert "/home/node/.openclaw" in fresh_bridge.SESSIONS_DIR, \
        f"SC-3 failed: SESSIONS_DIR is {fresh_bridge.SESSIONS_DIR!r}, expected to contain " \
        f"'/home/node/.openclaw' (Linux-portable default)"

    # Source-level audit: no /Applications/Docker.app hardcoded
    src = BRIDGE_PY.read_text(encoding="utf-8")
    assert "/Applications/Docker.app" not in src, \
        "SC-3 failed: /Applications/Docker.app still present in bridge_server.py"
    # Note: 'openclaw-horizon' may legitimately appear in legacy AGENT_IDS list (D7/D12 overlap),
    # but it MUST NOT appear as the DOCKER_CONTAINER assignment or env-var default.
    # We use line-aware regexes that anchor on DOCKER_CONTAINER to reject both forms.
    forbidden_assign = re.compile(r'DOCKER_CONTAINER\s*=\s*["\']openclaw-horizon["\']')
    assert not forbidden_assign.search(src), \
        "SC-3 failed: DOCKER_CONTAINER assignment still defaults to 'openclaw-horizon' " \
        "(must be 'openclaw-gateway' per D8)"
    forbidden_env = re.compile(
        r'os\.environ\.get\(\s*["\']DOCKER_CONTAINER["\']\s*,\s*["\']openclaw-horizon["\']'
    )
    assert not forbidden_env.search(src), \
        "SC-3 failed: os.environ.get('DOCKER_CONTAINER', 'openclaw-horizon') default not " \
        "updated to 'openclaw-gateway' (D8)"


# ---------- SC-4 ---------------------------------------------------------------

def test_sc4_vtuber_default_off(monkeypatch):
    """SC-4: VTUBER_ENABLED defaults False; bridge module reflects that with no env."""
    monkeypatch.delenv("VTUBER_ENABLED", raising=False)
    sys.modules.pop("bridge_server", None)
    import bridge_server
    assert bridge_server.VTUBER_ENABLED is False, \
        f"SC-4 failed: VTUBER_ENABLED default is {bridge_server.VTUBER_ENABLED}, expected False"
    sys.modules.pop("bridge_server", None)


@pytest.mark.asyncio
async def test_sc4_vtuber_gate_blocks_socket(monkeypatch):
    """SC-4: with VTUBER_ENABLED unset, lifespan must NOT call websockets.connect."""
    monkeypatch.delenv("VTUBER_ENABLED", raising=False)
    sys.modules.pop("bridge_server", None)
    import websockets

    def _fail(*args, **kwargs):
        raise AssertionError(
            f"SC-4 failed: websockets.connect called during disabled lifespan: {args}"
        )
    monkeypatch.setattr(websockets, "connect", _fail)
    import bridge_server
    async with bridge_server.app.router.lifespan_context(bridge_server.app):
        pass  # if gate is missing, _fail above will raise
    sys.modules.pop("bridge_server", None)


# ---------- SC-5 ---------------------------------------------------------------

def test_sc5_canvas_hygiene():
    """SC-5: both Wave 0 guard scripts pass; terminal.js has no synchronous XHR."""
    assert GUARD_CONTENT_TYPE.exists(), f"SC-5 failed: {GUARD_CONTENT_TYPE} missing"
    assert GUARD_NO_SYNC_XHR.exists(), f"SC-5 failed: {GUARD_NO_SYNC_XHR} missing"

    r1 = subprocess.run(
        ["bash", str(GUARD_CONTENT_TYPE)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    assert r1.returncode == 0, \
        f"SC-5 failed: guard_content_type.sh exited {r1.returncode}\n" \
        f"stdout: {r1.stdout}\nstderr: {r1.stderr}"

    r2 = subprocess.run(
        ["bash", str(GUARD_NO_SYNC_XHR)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    assert r2.returncode == 0, \
        f"SC-5 failed: guard_no_sync_xhr.sh exited {r2.returncode}\n" \
        f"stdout: {r2.stdout}\nstderr: {r2.stderr}"

    # terminal.js positive check: must contain await fetch for mission-control.json
    terminal_js = (REPO_ROOT / "config" / "canvas" / "terminal.js").read_text(encoding="utf-8")
    assert re.search(r"await\s+fetch\([^)]*mission-control\.json", terminal_js), \
        "SC-5 failed: terminal.js does not contain `await fetch('mission-control.json'...)`"
    assert "XMLHttpRequest" not in terminal_js, \
        "SC-5 failed: terminal.js still contains XMLHttpRequest"


# ---------- D7/D12 regression guard ------------------------------------------

@pytest.mark.asyncio
async def test_d7_d12_legacy_routes_still_registered(fresh_bridge):
    """D7/D12: legacy /api/agents/{agent_id}/... control routes must still be registered.

    Phase 2 is additive (D7) with two-system overlap (D12). The per-agent control
    endpoints (pause/resume/stop/reassign) were part of the original bridge surface and
    must remain functional through Phase 2; Phase 3 STRIP plans own their deletion.
    If the legacy /api/agents/* control surface has already disappeared in Phase 2, the
    additive contract has been violated and the frontend will break before Phase 3's
    coordinated cutover lands.

    Note: the routes use the /api/agents/ prefix (not bare /agents/) because the bridge
    has always used /api/* for its REST surface. The new GET /api/agents endpoint added
    in Wave 5 (SC-1) coexists with these legacy control routes — that coexistence IS the
    D7/D12 two-system overlap.
    """
    paths = {r.path for r in fresh_bridge.app.routes if hasattr(r, "path")}
    # Legacy control routes: pause, resume, stop, reassign
    legacy = {p for p in paths if p.startswith("/api/agents/") and p != "/api/agents"}
    assert legacy, (
        "D7/D12 violation: all /api/agents/* legacy control routes removed in Phase 2 "
        "(Phase 3 owns deletion — see CONTEXT.md decisions D7 and D12). "
        f"Registered paths containing 'agents': {sorted(p for p in paths if 'agents' in p)}"
    )
