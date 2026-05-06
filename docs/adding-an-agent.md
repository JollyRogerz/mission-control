# Adding an Agent

Agents are defined as YAML files in `config/agents/`. Mission Control discovers them on startup — drop a `.yml` file, restart `./mission-control.sh`, and it appears in the agent panel.

## Where agents live

- Default directory: `config/agents/` at the repo root
- Override: set `MC_AGENTS_DIR=/absolute/path/to/agents` in `.env`
- Files are loaded in lexicographic order; the file basename has no semantic meaning (the `id:` field is the agent identifier)
- Only files matching `*.yml` are scanned (`.yaml` is ignored)

## YAML schema

The schema is defined by `AgentDefinition` in `openclaw-vtuber/server/adapters/agent_definition.py`.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | string | yes | — | Unique agent identifier (used in routing keys, e.g. `agent:<id>:main`). Lowercase, dash-separated. |
| `display_name` | string | yes | — | Human-readable name shown in the agent panel. |
| `emoji` | string | no | `🤖` | Single emoji rendered next to the display name. |
| `model_pref` | string | no | `""` | Preferred model in `<provider>/<model>` form (e.g. `anthropic/claude-sonnet-4-5-20250929`). Empty = orchestrator default. |
| `allowed_tools` | list of strings | no | `[]` | Tool IDs this agent may invoke. Empty = no tool restriction. |
| `system_prompt` | string | no | `""` | The system prompt. Use `@file:./prompts/<name>.md` to load from a file (single-level resolution). |

Unknown keys are silently ignored by the loader — safe to add documentation comments via custom keys.

## `@file:` reference rules

Any string value may be replaced with `@file:<relative-path>` to load it from a file:

- Path is relative to the YAML file's directory
- **Single-level only** — the loaded file's content is NOT re-scanned for `@file:` references
- **Path traversal blocked** — the resolved absolute path MUST stay under the YAML's parent directory tree; an escape attempt raises `ValueError`
- A missing target raises `FileNotFoundError`

## Worked examples

### Example 1 — minimal agent (`config/agents/echo.yml`)

```yaml
id: echo
display_name: "Echo"
emoji: "🔁"
```

### Example 2 — agent with model preference (`config/agents/researcher.yml`)

```yaml
id: researcher
display_name: "Researcher"
emoji: "🔍"
model_pref: "anthropic/claude-sonnet-4-5-20250929"
allowed_tools: [web_search, web_fetch]
system_prompt: "You are a careful researcher. Cite every claim."
```

### Example 3 — system prompt loaded from a file (`config/agents/architect.yml`)

```yaml
id: architect
display_name: "Architect"
emoji: "🏗️"
model_pref: "anthropic/claude-opus-4-5"
allowed_tools: [search, code, fetch]
system_prompt: "@file:./prompts/architect.md"
```

With `config/agents/prompts/architect.md`:

```
You are a senior systems architect. When asked to design a system,
produce a numbered list of components followed by a Mermaid diagram.
```

## Verifying your agent loaded

```bash
./mission-control.sh
curl -s http://127.0.0.1:8100/api/agents | jq '.[] | .id'
```

Your agent's `id` should appear in the list.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Agent missing from panel | YAML parse error — check `./mission-control.sh` stdout for the loader's error message |
| `@file:` content not loaded | Path escapes the YAML's parent directory, or file does not exist |
| Emoji renders as `?` in panel | Browser font lacks the glyph; pick a more common emoji |
| "Unknown field" warning ignored | Expected — extra YAML keys are tolerated, not enforced |
| Agent file uses `.yaml` extension and is ignored | Loader only scans `*.yml`; rename to `.yml` |
