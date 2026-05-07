"""AgentDefinition (ADAPT-04): YAML-driven agent records loaded from MC_AGENTS_DIR.

YAML schema (one file per agent, e.g., config/agents/assistant.yml):

    id: assistant
    display_name: "General Assistant"
    emoji: "🤖"
    model_pref: "anthropic/claude-sonnet-4-6"
    allowed_tools: [search, code]
    system_prompt: "@file:./prompts/assistant.md"

@file: rules (D5):
    - Path is relative to the YAML file's directory.
    - Single-level resolution only — the content of the loaded file is NOT
      re-scanned for @file: references.
    - Resolved path MUST stay under the YAML's parent directory tree
      (path-traversal guard).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

_FILE_PREFIX = "@file:"

# Default MC_AGENTS_DIR anchored to repo root (D11 — open question resolved):
# Path(__file__) → server/adapters/agent_definition.py
# .parent        → server/adapters/
# .parent        → server/
# .parent        → <repo-root>/
# / "config" / "agents" → <repo-root>/config/agents
_DEFAULT_AGENTS_DIR = (
    Path(__file__).parent.parent.parent / "config" / "agents"
)


@dataclass
class AgentDefinition:
    """A single agent's configuration record, loaded from a YAML file."""

    id: str
    display_name: str
    emoji: str = "\U0001f916"  # 🤖
    model_pref: str = ""
    allowed_tools: list[str] = field(default_factory=list)
    system_prompt: str = ""

    @classmethod
    def load_all(cls, dir: Path) -> list["AgentDefinition"]:  # noqa: A002
        """Load all *.yml files in *dir*, resolving ``@file:`` references.

        Returns an empty list when *dir* does not exist or contains no YAML
        files — never raises on a missing directory.
        Files are processed in lexicographic order so results are deterministic.
        """
        dir = Path(dir)
        if not dir.is_dir():
            return []
        out: list[AgentDefinition] = []
        for yml in sorted(dir.glob("*.yml")):
            with yml.open("r", encoding="utf-8") as fh:
                raw: dict[str, Any] = yaml.safe_load(fh) or {}
            resolved = {
                k: cls._resolve(v, yml.parent) for k, v in raw.items()
            }
            # Only pass known dataclass fields; ignore extra YAML keys silently.
            known = {k: v for k, v in resolved.items() if k in cls.__dataclass_fields__}
            out.append(cls(**known))
        return out

    @staticmethod
    def _resolve(value: Any, base_dir: Path) -> Any:
        """Expand an ``@file:./relative.md`` value to the file's text content.

        Rules (D5):
        - Only strings starting with ``@file:`` are expanded.
        - The relative path is resolved against *base_dir* (the YAML file's dir).
        - The resolved absolute path must remain under *base_dir* — an escape
          attempt raises ``ValueError``.
        - A missing target raises ``FileNotFoundError``.
        - Single-level: the returned content is returned as-is (no nested scan).
        """
        if not (isinstance(value, str) and value.startswith(_FILE_PREFIX)):
            return value
        rel = value[len(_FILE_PREFIX):].strip()
        target = (base_dir / rel).resolve()
        base_resolved = base_dir.resolve()
        try:
            target.relative_to(base_resolved)
        except ValueError as exc:
            raise ValueError(
                f"@file: target {target} escapes agent dir {base_resolved}"
            ) from exc
        if not target.is_file():
            raise FileNotFoundError(f"@file: target not found: {target}")
        return target.read_text(encoding="utf-8")


# Module-level singleton (D11).
# MC_AGENTS_DIR env var lets callers override the directory without code changes.
AGENTS: list[AgentDefinition] = AgentDefinition.load_all(
    Path(os.environ.get("MC_AGENTS_DIR", str(_DEFAULT_AGENTS_DIR)))
)
