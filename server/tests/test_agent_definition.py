"""ADAPT-04 tests: AgentDefinition.load_all() YAML + @file: resolution."""
import pytest
from pathlib import Path
from adapters.agent_definition import AgentDefinition


def _write(p: Path, content: str) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


def test_load_all_empty_dir(tmp_path):
    assert AgentDefinition.load_all(tmp_path) == []


def test_load_all_missing_dir(tmp_path):
    assert AgentDefinition.load_all(tmp_path / "nope") == []


def test_load_all_single_agent(tmp_path):
    _write(tmp_path / "assistant.yml", """
id: assistant
display_name: General Assistant
emoji: "🤖"
model_pref: anthropic/claude-sonnet-4-6
allowed_tools: [search, code]
system_prompt: "Inline prompt text"
""")
    agents = AgentDefinition.load_all(tmp_path)
    assert len(agents) == 1
    a = agents[0]
    assert a.id == "assistant"
    assert a.display_name == "General Assistant"
    assert a.allowed_tools == ["search", "code"]
    assert a.system_prompt == "Inline prompt text"


def test_load_all_resolves_file_reference(tmp_path):
    (tmp_path / "prompts").mkdir()
    _write(tmp_path / "prompts" / "researcher.md", "Be a careful researcher.")
    _write(tmp_path / "researcher.yml", """
id: researcher
display_name: Researcher
system_prompt: "@file:./prompts/researcher.md"
""")
    agents = AgentDefinition.load_all(tmp_path)
    assert agents[0].system_prompt == "Be a careful researcher."


def test_load_all_rejects_path_traversal(tmp_path):
    _write(tmp_path / "evil.yml", """
id: evil
display_name: Evil
system_prompt: "@file:../../../etc/passwd"
""")
    with pytest.raises(ValueError, match="escapes agent dir"):
        AgentDefinition.load_all(tmp_path)


def test_load_all_missing_file_target(tmp_path):
    _write(tmp_path / "broken.yml", """
id: broken
display_name: Broken
system_prompt: "@file:./nope.md"
""")
    with pytest.raises(FileNotFoundError):
        AgentDefinition.load_all(tmp_path)


def test_load_all_sorted(tmp_path):
    _write(tmp_path / "b.yml", "id: b\ndisplay_name: B")
    _write(tmp_path / "a.yml", "id: a\ndisplay_name: A")
    ids = [a.id for a in AgentDefinition.load_all(tmp_path)]
    assert ids == ["a", "b"]
