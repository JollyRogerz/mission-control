"""ADAPT-05 tests: _scan() discovers and filters adapter modules."""
import sys
import textwrap
from pathlib import Path
from adapters import ModelProvider, _scan


def _make_pkg(tmp_path: Path, pkg_name: str, modules: dict[str, str]) -> None:
    """Materialize a temp package on sys.path with the given module sources."""
    root = tmp_path / pkg_name
    root.mkdir()
    (root / "__init__.py").write_text("", encoding="utf-8")
    for name, src in modules.items():
        (root / f"{name}.py").write_text(textwrap.dedent(src), encoding="utf-8")
    if str(tmp_path) not in sys.path:
        sys.path.insert(0, str(tmp_path))


def test_scan_with_dotted_package_name_returns_empty():
    # Production code uses bare names ("providers") because server/ is sys.path root.
    # A dotted "server.providers" name would not resolve and must return {}.
    result = _scan("server.providers", "PROVIDER", ModelProvider)
    assert result == {}


def test_scan_returns_empty_for_missing_package():
    result = _scan("nonexistent.package.xyz", "PROVIDER", ModelProvider)
    assert result == {}


def test_scan_finds_valid_provider(tmp_path, monkeypatch):
    _make_pkg(tmp_path, "scantest_pkg_a", {
        "good": """
            class _P:
                name = "good-provider"
                async def complete(self, prompt, **kw): return ""
                async def health_check(self): return True
            PROVIDER = _P()
        """,
    })
    result = _scan("scantest_pkg_a", "PROVIDER", ModelProvider)
    assert "good-provider" in result


def test_scan_skips_module_without_attr(tmp_path):
    _make_pkg(tmp_path, "scantest_pkg_b", {
        "noattr": "x = 1",
    })
    assert _scan("scantest_pkg_b", "PROVIDER", ModelProvider) == {}


def test_scan_skips_module_failing_isinstance(tmp_path):
    _make_pkg(tmp_path, "scantest_pkg_c", {
        "bad": """
            class _Bad:
                name = "bad"
                # missing complete() and health_check()
            PROVIDER = _Bad()
        """,
    })
    assert _scan("scantest_pkg_c", "PROVIDER", ModelProvider) == {}


def test_scan_continues_on_broken_module(tmp_path):
    _make_pkg(tmp_path, "scantest_pkg_d", {
        "broken": "raise RuntimeError('boom at import')",
        "ok": """
            class _P:
                name = "still-here"
                async def complete(self, prompt, **kw): return ""
                async def health_check(self): return True
            PROVIDER = _P()
        """,
    })
    result = _scan("scantest_pkg_d", "PROVIDER", ModelProvider)
    assert "still-here" in result  # broken module skipped, good one survives
