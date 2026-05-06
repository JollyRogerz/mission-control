# Architecture

Mission Control is a thin coordination layer over **swappable adapters**. The bridge server holds no business logic about specific LLMs, integrations, or runtimes — it dispatches against Protocols defined in `server/adapters/`.

## High-level layout

```
┌──────────────────────────────────────────────────────┐
│  Browser dashboard  (vanilla JS, EVA theme)          │
│  config/canvas/index.html + ChatManager + AgentPanel │
└────────────────┬─────────────────────────────────────┘
                 │ HTTP + WebSocket
┌────────────────▼─────────────────────────────────────┐
│  FastAPI bridge  (server/bridge_server.py)           │
│   - REST: /api/agents /api/providers /api/integrations│
│   - WebSocket: /ws  (telemetry + chat stream)         │
│   - SQLite persistence  (config/canvas/mission-       │
│     control.db)                                       │
└────────┬──────────────┬────────────────┬──────────────┘
         │              │                │
 ┌───────▼───┐  ┌───────▼─────┐   ┌──────▼──────────┐
 │ Providers │  │ Integrations│   │ Runtime adapter │
 │  (LLMs)   │  │ (outbound)  │   │   (dispatch)    │
 └───────────┘  └─────────────┘   └─────────────────┘
      │                  │                │
 Anthropic           Discord         OpenClaw gateway
 OpenAI              Telegram        Local subprocess
 Gemini                              ...
 OpenRouter
 Ollama
```

## Adapter layers

Each adapter is a Python `typing.Protocol` in `server/adapters/`:

| Protocol | File | Purpose | Concrete impls live in |
|---|---|---|---|
| `AgentDefinition` (dataclass, not Protocol) | `agent_definition.py` | YAML-loaded agent record | `config/agents/*.yml` |
| `ModelProvider` | `model_provider.py` | LLM completion | `server/providers/<name>.py` |
| `Integration` | `integration.py` | Outbound send to external surface | `server/integrations/<name>.py` |
| `RuntimeAdapter` | `runtime.py` | Agent dispatch (gateway or subprocess) | `server/runtime/<name>.py` |

All concrete implementations expose a module-level singleton:
- Providers: `PROVIDER = ...`
- Integrations: `INTEGRATION = ...`
- Runtimes: `RUNTIME = ...`

The loader (`server/adapters/loader.py`) scans each directory, imports modules, and verifies the singleton satisfies its Protocol with `isinstance(...)`. There is no manual registration step.

## Bridge contract (HTTP)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/agents` | GET | List loaded `AgentDefinition` records |
| `/api/providers` | GET | List discovered `ModelProvider`s + their `health_check()` |
| `/api/integrations` | GET | List discovered `Integration`s + their `health_check()` |
| `/api/integrations/<name>/send` | POST | Body: `{"channel": "...", "message": "..."}` → receipt dict |
| `/api/tasks` | GET/POST | Mission Control task list (CRUD) |
| `/api/goals` | GET/POST | Goal list (CRUD) |
| `/api/feed` | GET | Recent feed entries |
| `/api/audit` | GET | Recent audit log |

All endpoints require `Authorization: Bearer $BRIDGE_AUTH_TOKEN` when `BRIDGE_AUTH_TOKEN` is set.

## Bridge contract (WebSocket)

- `/ws` — bidirectional telemetry stream:
  - **Server → client**: chat messages, feed entries, cost events, tool traces (JSON envelopes)
  - **Client → server**: terminal input, agent dispatch requests

## SQLite schema

Database: `config/canvas/mission-control.db` (created by `scripts/init-db.py`).

| Table | Purpose | Key columns |
|---|---|---|
| `tasks` | Mission Control tasks | `id`, `title`, `status`, `assignee`, `goal_id`, `parent_task_id` |
| `task_dependencies` | Task DAG edges | `task_id`, `depends_on` |
| `goals` | Higher-level objectives | `id`, `title`, `status` |
| `chat_messages` | Conversation history | `id`, `role`, `agent_id`, `text`, `timestamp` |
| `feed_entries` | Activity feed | `id`, `agent_id`, `action`, `detail`, `timestamp` |
| `cost_events` | Per-call token usage | `id`, `agent_id`, `model`, `input_tokens`, `output_tokens`, `cost_cents` |
| `cost_daily` | Pre-aggregated daily costs | `date`, `agent_id`, `total_cents` |
| `activity_hourly` | Per-hour event counts | `date`, `hour`, `agent_id`, `event_count` |
| `audit_log` | Significant actions | `id`, `actor_type`, `actor_id`, `action`, `entity_id`, `details_json` |
| `tool_traces` | Tool-call telemetry | `id`, `agent_id`, `tool_name`, `tool_category`, `phase`, `input_preview`, `output_preview` |

Schema versioning is **not** included in v1. The init script uses `CREATE TABLE IF NOT EXISTS` and is idempotent; future schema changes will require manual migration scripts (or a switch to Alembic).

## Runtime flow (single dispatch)

```
1. Browser sends { agent_id, message } over /ws
2. Bridge looks up the agent in AGENT_DEFINITIONS (loaded from YAML at startup)
3. Bridge resolves model_pref → routes to PROVIDERS[<provider>].complete()
4. Bridge writes to chat_messages, feed_entries, cost_events tables
5. Bridge streams response chunks back over /ws
6. If the agent invokes an integration, bridge dispatches to INTEGRATIONS[<name>].send()
```

## Configuration precedence

For any tunable: **kwarg → env var → file default → hardcoded fallback**. Examples:
- Model selection: `complete(prompt, model="...")` > `<PROVIDER>_MODEL` env > module `DEFAULT_MODEL`
- Bridge port: `BRIDGE_PORT` env > `8100`
- Agents directory: `MC_AGENTS_DIR` env > `<repo>/config/agents/`

## Where to look next
- Add an agent → [adding-an-agent.md](./adding-an-agent.md)
- Add a model provider → [adding-a-model-provider.md](./adding-a-model-provider.md)
- Add an integration → [adding-an-integration.md](./adding-an-integration.md)
- Quickstart → [getting-started.md](./getting-started.md)
