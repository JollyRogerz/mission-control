"""ADAPT-05: Directory-scan loader for adapter discovery.

Concrete implementations live in server/providers/<name>.py (and
server/integrations/, server/runtime/) — each exposing a module-level
singleton named PROVIDER / INTEGRATION / RUNTIME respectively.

Usage:
    from adapters.loader import _scan
    from adapters import ModelProvider
    PROVIDERS = _scan("server.providers", "PROVIDER", ModelProvider)

Discovery is intentionally resilient:
- A package that does not exist returns {} (not ImportError).
- A submodule that raises on import is logged and skipped.
- A submodule whose singleton fails isinstance() is logged and skipped.
This means one broken third-party adapter never prevents the bridge from booting.
"""
from __future__ import annotations

import importlib
import logging
import os
import pkgutil
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _scan(package: str, attr: str, proto: type) -> dict[str, Any]:
    """Import every submodule of *package*; return ``{instance.name: instance}``
    for those whose module-level attribute *attr* satisfies ``isinstance(_, proto)``.

    Args:
        package: Dotted module name of the package to scan (e.g. ``"server.providers"``).
        attr:    Module-level attribute name to look for (e.g. ``"PROVIDER"``).
        proto:   A ``@runtime_checkable`` Protocol class used for isinstance filtering.

    Returns:
        dict mapping each discovered instance's ``.name`` to the instance.
        Returns ``{}`` when the package is missing, empty, or all submodules fail.
    """
    out: dict[str, Any] = {}
    try:
        pkg = importlib.import_module(package)
    except ImportError:
        logger.debug("adapter package %s not importable; returning empty dict", package)
        return out

    if not hasattr(pkg, "__path__"):
        # Package is not a real package (e.g., a plain module) — skip.
        return out

    for mod_info in pkgutil.iter_modules(pkg.__path__):
        full_name = f"{package}.{mod_info.name}"
        try:
            module = importlib.import_module(full_name)
        except Exception as exc:  # noqa: BLE001 — intentionally broad; bad module ≠ fatal
            logger.warning("failed to import adapter module %s: %s", full_name, exc)
            continue

        instance = getattr(module, attr, None)
        if instance is None:
            logger.debug("module %s has no attribute %s; skipping", full_name, attr)
            continue

        if not isinstance(instance, proto):
            logger.warning(
                "module %s.%s does not satisfy Protocol %s; skipping",
                full_name,
                attr,
                proto.__name__,
            )
            continue

        name: str = getattr(instance, "name", None) or mod_info.name
        out[name] = instance
        logger.debug("registered adapter %r from %s", name, full_name)

    return out


# ---------------------------------------------------------------------------
# Module-level singletons (D11) — populated at import time.
# Phase 2: all three packages are empty → each _scan() returns {}.
# Phase 4 will add concrete implementations under server/providers/ etc.
# ---------------------------------------------------------------------------
from .model_provider import ModelProvider      # noqa: E402
from .integration import Integration           # noqa: E402
from .runtime import RuntimeAdapter            # noqa: E402
from .agent_definition import AgentDefinition  # noqa: E402

_DEFAULT_AGENTS_DIR = (
    Path(__file__).parent.parent.parent.parent / "config" / "agents"
)

PROVIDERS: dict[str, ModelProvider] = _scan("server.providers", "PROVIDER", ModelProvider)
INTEGRATIONS: dict[str, Integration] = _scan("server.integrations", "INTEGRATION", Integration)
RUNTIMES: dict[str, RuntimeAdapter] = _scan("server.runtime", "RUNTIME", RuntimeAdapter)
AGENTS: list[AgentDefinition] = AgentDefinition.load_all(
    Path(os.environ.get("MC_AGENTS_DIR", str(_DEFAULT_AGENTS_DIR)))
)
