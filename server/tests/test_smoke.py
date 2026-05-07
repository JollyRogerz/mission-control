"""
Smoke tests — Wave 0 infrastructure sanity checks.

These tests only prove that the bridge FastAPI app imports cleanly.
They do NOT test behaviour — that is the job of later waves.
"""


def test_app_imports(bridge_app):
    """Sanity check: the bridge FastAPI app loads without exploding."""
    assert bridge_app is not None
    assert hasattr(bridge_app, "router")
