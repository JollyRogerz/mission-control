"""INTEG-01: Discord integration package.

Re-exports the module-level `INTEGRATION` singleton so the loader's `_scan` finds it
when walking `server.integrations` submodules.
"""
from .client import INTEGRATION  # noqa: F401
